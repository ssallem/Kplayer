import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { once } from "node:events";
import castv2 from "castv2";
import { CastManager, buildMedia } from "../server/cast.js";

// Local protocol simulator, not a physical Chromecast certification test.
test("Cast V2 TLS launch, load with captions, pause, seek, volume and connection loss", async () => {
  const server = new castv2.Server({
    key: await fs.readFile(
      new URL("./fixtures/cast-test-key.pem", import.meta.url),
    ),
    cert: await fs.readFile(
      new URL("./fixtures/cast-test-cert.pem", import.meta.url),
    ),
  });
  const manager = new CastManager();
  let load, volume;
  let status = {
    mediaSessionId: 1,
    playerState: "IDLE",
    currentTime: 0,
    activeTrackIds: [],
  };
  const application = {
    appId: "CC1AD845",
    sessionId: "test-session",
    transportId: "test-transport",
    displayName: "Default Media Receiver",
    namespaces: [{ name: "urn:x-cast:com.google.cast.media" }],
  };
  server.on(
    "message",
    (clientId, sourceId, destinationId, namespace, payload) => {
      const request = JSON.parse(payload);
      const respond = (data) =>
        server.send(
          clientId,
          destinationId,
          sourceId,
          namespace,
          JSON.stringify({ ...data, requestId: request.requestId }),
        );
      if (request.type === "PING") return respond({ type: "PONG" });
      if (namespace.endsWith(".receiver")) {
        if (request.type === "SET_VOLUME") volume = request.volume;
        return respond({
          type: "RECEIVER_STATUS",
          status: {
            applications: [application],
            volume: volume || { level: 0.7, muted: false },
          },
        });
      }
      if (namespace.endsWith(".media")) {
        if (request.type === "LOAD") {
          load = request;
          status = {
            ...status,
            playerState: request.autoplay ? "PLAYING" : "PAUSED",
            currentTime: request.currentTime,
            media: { ...request.media, duration: 120 },
            activeTrackIds: request.activeTrackIds,
          };
        }
        if (request.type === "PAUSE") status.playerState = "PAUSED";
        if (request.type === "PLAY") status.playerState = "PLAYING";
        if (request.type === "SEEK") status.currentTime = request.currentTime;
        if (request.type === "EDIT_TRACKS_INFO")
          status.activeTrackIds = request.activeTrackIds;
        if (request.type === "STOP") status.playerState = "IDLE";
        respond({ type: "MEDIA_STATUS", status: [status] });
      }
    },
  );
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    await manager.connect({
      address: "127.0.0.1",
      port: server.server.address().port,
      name: "Simulated TV",
    });
    assert.equal(manager.state.connected, true);
    const media = buildMedia(
      { id: "movie", name: "테스트", contentType: "video/mp4" },
      "http://192.168.1.2:3210/stream/test",
      { id: "caption", name: "한국어" },
    );
    await manager.load(media, "movie", 12, true);
    assert.equal(load.media.tracks[0].trackContentType, "text/vtt");
    assert.deepEqual(load.activeTrackIds, [1]);
    assert.equal(manager.state.playerState, "PLAYING");
    assert.equal(manager.state.currentTime, 12);
    await manager.command("pause");
    assert.equal(manager.state.playerState, "PAUSED");
    await manager.command("seek", 42);
    assert.equal(manager.state.currentTime, 42);
    await manager.command("subtitles", false);
    assert.equal(manager.state.subtitlesEnabled, false);
    await manager.command("volume", 0.25);
    assert.equal(volume.level, 0.25);
    await manager.command("play");
    assert.equal(manager.state.playerState, "PLAYING");
    const closed = once(manager.client.client, "close");
    for (const client of Object.values(server.clients)) client.socket.destroy();
    await closed;
    assert.equal(manager.state.connected, false);
    assert.match(manager.state.error, /종료/);
  } finally {
    manager.close();
    server.close();
  }
});
