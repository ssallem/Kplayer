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
  request(action, body) {
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
      this.port.postMessage({ id, action, body });
    });
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
