/* This window is a same-origin API client. No cross-origin API access is enabled. */
const status = document.querySelector("#status");
const connect = document.querySelector("#connect");
const disconnect = document.querySelector("#disconnect");
const nonce = location.hash.slice(1);
history.replaceState(null, "", location.pathname);
let peer,
  channel,
  presence,
  busy = false;
const owned = new Set();
const pendingUploads = new Set();
window.addEventListener("message", (event) => {
  if (
    channel ||
    event.source !== window.opener ||
    event.origin !== window.KPLAYER_WEB_ORIGIN ||
    event.data?.type !== "kplayer-hello" ||
    event.data.nonce !== nonce ||
    !/^[a-f0-9-]{36}$/.test(nonce)
  )
    return;
  peer = event.source;
  connect.disabled = false;
  status.textContent = "공개 웹 플레이어가 연결을 요청했습니다.";
});
async function api(path, body) {
  let response;
  try {
    response = await fetch(
      path,
      body === undefined
        ? {}
        : body instanceof ArrayBuffer
          ? {
              method: "POST",
              headers: { "Content-Type": "application/octet-stream" },
              body,
            }
          : {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            },
    );
  } catch {
    throw new Error(
      "PC 연결 서버에 요청을 보내지 못했습니다. 연결 EXE와 PC 연결 창을 다시 열어 주세요.",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/json"))
    throw new Error(
      "PC 연결 프로그램을 최신 버전으로 업데이트하고 연결 창을 다시 열어 주세요.",
    );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "PC 요청에 실패했습니다.");
  return result;
}
connect.onclick = () => {
  if (!peer || channel) return;
  channel = new MessageChannel();
  channel.port1.onmessage = async ({ data }) => {
    if (!data || typeof data.id !== "string") return;
    const { id, action, body } = data;
    try {
      let result;
      if (action === "state") {
        result = await api("/api/state");
        result.items = result.items.filter((item) => owned.has(item.id));
        result.jobs = result.jobs.filter((job) => owned.has(job.itemId));
        delete result.network;
        delete result.pairingCode;
      } else {
        if (busy) throw new Error("PC 작업이 끝난 뒤 다시 시도해 주세요.");
        busy = true;
        try {
          if (action === "upload-begin") {
            result = await api("/api/uploads", {
              name: body?.name,
              size: body?.size,
            });
            pendingUploads.add(result.id);
          } else if (
            ["upload-chunk", "upload-finish", "upload-abort"].includes(action)
          ) {
            if (!pendingUploads.has(body?.uploadId))
              throw new Error(
                "이 연결 창에서 시작한 파일 전송만 처리할 수 있습니다.",
              );
            const base = "/api/uploads/" + encodeURIComponent(body.uploadId);
            if (action === "upload-chunk") {
              if (
                !(body.bytes instanceof ArrayBuffer) ||
                !Number.isSafeInteger(body.offset) ||
                body.offset < 0
              )
                throw new Error("파일 조각이 올바르지 않습니다.");
              result = await api(
                base + "/chunk?offset=" + body.offset,
                body.bytes,
              );
            } else {
              result = await api(
                base + (action === "upload-finish" ? "/finish" : "/abort"),
                {},
              );
              pendingUploads.delete(body.uploadId);
              if (action === "upload-finish") owned.add(result.id);
            }
          } else if (action === "upload") {
            throw new Error("웹 플레이어를 새로고침한 뒤 다시 연결해 주세요.");
          } else if (action === "scan") result = await api("/api/scan", {});
          else if (action === "connect")
            result = await api("/api/cast/connect", { address: body?.address });
          else if (action === "load") {
            if (
              !owned.has(body?.itemId) ||
              (body.subtitleId && !owned.has(body.subtitleId))
            )
              throw new Error(
                "이 웹 화면에서 선택한 파일만 재생할 수 있습니다.",
              );
            result = await api("/api/cast/load", {
              itemId: body.itemId,
              subtitleId: body.subtitleId || null,
              currentTime: body.currentTime,
              offset: body.offset,
              subtitlesEnabled: body.subtitlesEnabled,
              autoplay: body.autoplay,
            });
          } else if (action === "control")
            result = await api("/api/cast/control", body);
          else if (action === "clear") {
            result = await api("/api/privacy/clear", {});
            owned.clear();
            pendingUploads.clear();
          } else throw new Error("허용되지 않은 요청입니다.");
        } finally {
          busy = false;
        }
      }
      channel.port1.postMessage({ id, result });
    } catch (error) {
      channel.port1.postMessage({ id, error: error.message });
    }
  };
  presence = new EventSource("/api/presence");
  peer.postMessage(
    { type: "kplayer-connected", nonce, protocolVersion: 2 },
    window.KPLAYER_WEB_ORIGIN,
    [channel.port2],
  );
  connect.hidden = true;
  disconnect.hidden = false;
  status.textContent = "연결되었습니다. 원래 웹 화면에서 TV를 선택하세요.";
};
disconnect.onclick = async () => {
  try {
    await api("/api/privacy/clear", {});
    window.close();
  } catch (e) {
    status.textContent = e.message;
  }
};
setInterval(() => {
  if (peer?.closed) {
    presence?.close();
    window.close();
  }
}, 2000);
window.addEventListener("pagehide", () => presence?.close());
