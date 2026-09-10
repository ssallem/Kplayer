import cast from "castv2-client";

export function connectionError(error) {
  if (["EACCES", "EPERM"].includes(error.code)) {
    return Object.assign(
      new Error(
        "PC 실행 환경에서 TV 통신이 차단되었습니다. KPLAYER 서버를 종료하고 KPLAYER.vbs로 다시 실행해 주세요. 계속 실패하면 보안 프로그램의 네트워크 차단을 확인해 주세요.",
      ),
      { code: error.code },
    );
  }
  return error;
}

export function buildMedia(item, base, subtitle, offset = 0) {
  return {
    contentId: `${base}/media/${item.id}`,
    contentType: item.contentType,
    streamType: "BUFFERED",
    metadata: { type: 0, metadataType: 0, title: "KPLAYER" },
    ...(subtitle
      ? {
          tracks: [
            {
              trackId: 1,
              type: "TEXT",
              trackContentId: `${base}/subtitles/${subtitle.id}?offset=${offset}`,
              trackContentType: "text/vtt",
              subtype: "SUBTITLES",
              name: "자막",
              language: "ko",
            },
          ],
          textTrackStyle: {
            backgroundColor: "#00000099",
            foregroundColor: "#FFFFFFFF",
            edgeType: "OUTLINE",
            edgeColor: "#000000FF",
            fontScale: 1.1,
            fontFamily: "sans-serif",
          },
        }
      : {}),
  };
}

export class CastManager {
  constructor() {
    this.state = { connected: false };
    this.busy = false;
  }
  async call(fn, timeout = 12000) {
    return new Promise((resolve, reject) => {
      const client = this.client;
      const transport = client?.client;
      let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        client?.removeListener("error", onError);
        transport?.removeListener("close", onClose);
        error ? reject(connectionError(error)) : resolve(result);
      };
      const onError = (error) => finish(error);
      const onClose = () =>
        finish(new Error("TV와 연결이 종료되었습니다. 다시 연결해 주세요."));
      const timer = setTimeout(
        () =>
          finish(
            new Error(
              "TV 응답 시간이 초과됐습니다. 같은 Wi-Fi인지 확인해 주세요.",
            ),
          ),
        timeout,
      );
      client?.once("error", onError);
      transport?.once("close", onClose);
      try {
        fn(finish);
      } catch (e) {
        finish(e);
      }
    });
  }
  status(status) {
    if (!status) return;
    if (this.player?.media) this.player.media.currentSession = status;
    Object.assign(this.state, {
      playerState: status.playerState,
      currentTime: status.currentTime || 0,
      duration: status.media?.duration ?? this.state.duration ?? 0,
      updatedAt: Date.now(),
      idleReason: status.idleReason,
      subtitlesEnabled: (status.activeTrackIds || []).includes(1),
    });
  }
  async connect(device) {
    this.close();
    const client = (this.client = new cast.Client());
    client.on("status", (status) => {
      if (this.client === client && typeof status.volume?.level === "number")
        this.state.volume = status.volume.level;
    });
    client.on("error", (error) => {
      if (this.client === client) {
        this.close();
        this.state.error = connectionError(error).message;
      }
    });
    client.client.once("close", () => {
      if (this.client === client) {
        clearInterval(this.poll);
        this.client = null;
        this.player = null;
        this.state = {
          connected: false,
          error: "TV와 연결이 종료되었습니다. TV를 다시 연결해 주세요.",
        };
      }
    });
    try {
      await this.call(
        (cb) =>
          client.connect(
            { host: device.address, port: device.port || 8009 },
            () => cb(null),
          ),
        10000,
      );
      this.player = await this.call((cb) =>
        client.launch(cast.DefaultMediaReceiver, cb),
      );
      this.player.on("status", (s) => {
        if (this.client === client) this.status(s);
      });
      this.state = {
        connected: true,
        device,
        playerState: "IDLE",
        currentTime: 0,
        duration: 0,
      };
      const receiverVolume = await this.call((cb) => client.getVolume(cb));
      if (typeof receiverVolume?.level === "number")
        this.state.volume = receiverVolume.level;
      this.poll = setInterval(() => {
        if (this.polling || !this.player) return;
        this.polling = true;
        this.call((cb) => this.player.getStatus(cb), 6000)
          .then((s) => {
            if (this.client === client) this.status(s);
          })
          .catch(() => {
            if (this.client === client) {
              this.close();
              this.state.error =
                "TV 응답이 없습니다. 연결을 다시 확인해 주세요.";
            }
          })
          .finally(() => {
            this.polling = false;
          });
      }, 2000);
      this.poll.unref();
    } catch (e) {
      this.close();
      this.state.error = e.message;
      throw e;
    }
  }
  async load(
    media,
    itemId,
    currentTime = 0,
    subtitles = true,
    autoplay = true,
  ) {
    if (!this.player) throw new Error("먼저 TV를 연결해 주세요.");
    const result = await this.call(
      (cb) =>
        this.player.load(
          media,
          {
            autoplay,
            currentTime,
            activeTrackIds: media.tracks && subtitles ? [1] : [],
          },
          cb,
        ),
      20000,
    );
    this.state.itemId = itemId;
    this.status(result);
  }
  async command(action, value) {
    if (!this.player) throw new Error("연결된 TV가 없습니다.");
    let result;
    if (action === "play" || action === "pause" || action === "stop")
      result = await this.call((cb) => this.player[action](cb));
    else if (action === "seek")
      result = await this.call((cb) => this.player.seek(value, cb));
    else if (action === "volume") {
      const result = await this.call((cb) =>
        this.client.setVolume({ level: value }, cb),
      );
      this.state.volume = result?.level ?? value;
    } else if (action === "subtitles")
      result = await this.call((cb) =>
        this.player.media.sessionRequest(
          { type: "EDIT_TRACKS_INFO", activeTrackIds: value ? [1] : [] },
          cb,
        ),
      );
    this.status(result);
  }
  close() {
    clearInterval(this.poll);
    const client = this.client;
    this.client = null;
    this.player = null;
    if (client) {
      try {
        client.close();
      } catch {}
    }
    this.state = { connected: false };
    this.polling = false;
  }
}
