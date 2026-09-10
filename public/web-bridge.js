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
  const response = await fetch(
    path,
    body === undefined
      ? {}
      : body instanceof FormData
        ? { method: "POST", body }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
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
          if (action === "upload") {
            if (!(body instanceof File))
              throw new Error("선택한 파일만 전달할 수 있습니다.");
            const form = new FormData();
            form.append("file", body);
            result = await api("/api/upload", form);
            owned.add(result.id);
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
    { type: "kplayer-connected", nonce },
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
