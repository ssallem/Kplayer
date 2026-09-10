// Files cross only into a user-connected loopback window, never a remote server.
export class Companion {
  constructor(onClose) {
    this.origin = import.meta.env.VITE_COMPANION_URL || "http://localhost:3210";
    this.pending = new Map();
    this.onClose = onClose;
  }
  connect() {
    if (this.port && !this.popup?.closed) return Promise.resolve();
    if (this.connecting) {
      this.popup?.focus();
      return this.connecting;
    }
    const nonce = crypto.randomUUID();
    this.popup = window.open(
      `${this.origin}/web-bridge#${nonce}`,
      "_blank",
      "popup,width=480,height=460",
    );
    if (!this.popup)
      return Promise.reject(new Error("팝업을 허용한 뒤 다시 연결해 주세요."));
    this.connecting = new Promise((resolve, reject) => {
      const cleanup = () => {
        clearInterval(hello);
        clearTimeout(timeout);
        window.removeEventListener("message", receive);
        this.connecting = null;
      };
      const receive = (e) => {
        if (
          e.source !== this.popup ||
          e.origin !== this.origin ||
          e.data?.type !== "kplayer-connected" ||
          e.data.nonce !== nonce ||
          !e.ports[0]
        )
          return;
        cleanup();
        if (e.data.protocolVersion !== 2) {
          e.ports[0].close();
          this.popup.close();
          reject(
            new Error(
              "PC 연결 프로그램을 v1.3.1 이상으로 업데이트한 뒤 다시 연결해 주세요.",
            ),
          );
          return;
        }
        this.port = e.ports[0];
        this.port.onmessage = ({ data }) => {
          const request = this.pending.get(data.id);
          if (!request) return;
          this.pending.delete(data.id);
          clearTimeout(request.timer);
          data.error
            ? request.reject(new Error(data.error))
            : request.resolve(data.result);
        };
        this.watch = setInterval(() => {
          if (this.popup.closed) this.close();
        }, 1500);
        resolve();
      };
      window.addEventListener("message", receive);
      const hello = setInterval(() => {
        if (this.popup.closed) {
          cleanup();
          reject(new Error("PC 연결 창이 닫혔습니다."));
          return;
        }
        this.popup.postMessage({ type: "kplayer-hello", nonce }, this.origin);
      }, 400);
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            "KPLAYER-Connect.exe를 실행하고 최신 버전인지 확인한 뒤 다시 연결해 주세요.",
          ),
        );
      }, 60000);
    });
    return this.connecting;
  }
  request(action, body, transfer = []) {
    if (!this.port || this.popup.closed)
      return Promise.reject(new Error("PC 연결 창을 다시 열어 주세요."));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          this.pending.delete(id);
          reject(
            new Error("PC 응답 시간이 초과됐습니다. 연결 창을 확인해 주세요."),
          );
        },
        action === "upload" ? 30 * 60 * 1000 : 35000,
      );
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.port.postMessage({ id, action, body }, transfer);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async upload(file, onProgress) {
    if (!(file instanceof File))
      throw new Error("영상 파일을 다시 선택해 주세요.");
    const session = await this.request("upload-begin", {
      name: file.name,
      size: file.size,
    });
    try {
      const chunkSize = Math.min(session.chunkSize, 4 * 1024 * 1024);
      if (!Number.isSafeInteger(chunkSize) || chunkSize <= 0)
        throw new Error("PC 연결 프로그램의 전송 설정을 확인해 주세요.");
      for (let offset = 0; offset < file.size;) {
        let bytes;
        try {
          bytes = await file.slice(offset, offset + chunkSize).arrayBuffer();
        } catch {
          throw new Error(
            "선택한 파일을 읽을 수 없습니다. 파일이 이동·변경되지 않았는지 확인하고 다시 선택해 주세요.",
          );
        }
        const expected = offset + bytes.byteLength;
        const result = await this.request(
          "upload-chunk",
          { uploadId: session.id, offset, bytes },
          [bytes],
        );
        if (result.received !== expected)
          throw new Error("파일 전송 확인에 실패했습니다. 다시 시도해 주세요.");
        offset = expected;
        onProgress?.(Math.floor((offset / file.size) * 100));
      }
      return await this.request("upload-finish", { uploadId: session.id });
    } catch (error) {
      try {
        await this.request("upload-abort", { uploadId: session.id });
      } catch {}
      throw error;
    }
  }
  close() {
    clearInterval(this.watch);
    this.port?.close();
    this.port = null;
    this.popup?.close();
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("PC 연결이 종료되었습니다."));
    }
    this.pending.clear();
    this.onClose?.();
  }
}
