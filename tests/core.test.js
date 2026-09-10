import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import iconv from "iconv-lite";
import { toVtt, decodeSubtitle } from "../server/subtitles.js";
import { isPrivateIp } from "../server/network.js";
import { buildMedia, CastManager } from "../server/cast.js";

test("socket access errors reject pending operations immediately and remove listeners", async () => {
  const manager = new CastManager();
  const client = new EventEmitter();
  client.client = new EventEmitter();
  manager.client = client;
  const request = manager.call(() => {}, 10000);
  client.emit(
    "error",
    Object.assign(new Error("connect EACCES"), { code: "EACCES" }),
  );
  await assert.rejects(
    request,
    (error) =>
      error.code === "EACCES" && error.message.includes("PC 실행 환경"),
  );
  assert.equal(client.listenerCount("error"), 0);
  assert.equal(client.client.listenerCount("close"), 0);
});

test("SRT conversion preserves Korean, normalizes CRLF and applies positive sync", () => {
  assert.equal(
    toVtt("\uFEFF1\r\n00:00:01,000 --> 00:00:03,200\r\n안녕하세요!\r\n", 0.5),
    "WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.700\n안녕하세요!",
  );
});
test("WebVTT short timestamps, negative sync and existing headers", () => {
  assert.equal(
    toVtt("WEBVTT\n\n00:01.000 --> 00:03.000\nHello", -2),
    "WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello",
  );
  assert.throws(() => toVtt("not a subtitle"));
});
test("decode UTF8, CP949 and UTF16 Korean subtitles", () => {
  const value = "한글 자막이 잘 보여요.";
  for (const encoding of ["utf8", "cp949", "utf16-le", "utf16-be"]) {
    const b = iconv.encode(value, encoding, {
      addBOM: encoding.startsWith("utf16"),
    });
    assert.equal(decodeSubtitle(b), value);
  }
});
test("manual Cast endpoint only accepts private IPv4", () => {
  for (const ip of ["192.168.0.20", "10.0.0.1", "172.16.0.1", "172.31.255.254"])
    assert.equal(isPrivateIp(ip), true);
  for (const ip of [
    "127.0.0.1",
    "8.8.8.8",
    "172.32.0.1",
    "192.168.1.999",
    "example.com",
    "192.168.1.1/path",
    "::1",
    null,
    123,
  ])
    assert.equal(isPrivateIp(ip), false);
});
test("Cast load contains receiver-fetchable media and active text track metadata", () => {
  const media = buildMedia(
    { id: "video-id", name: "Movie", contentType: "video/mp4" },
    "http://192.168.1.5:3210/stream/secret",
    { id: "sub-id", name: "한글.srt" },
    1.5,
  );
  assert.equal(
    media.contentId,
    "http://192.168.1.5:3210/stream/secret/media/video-id",
  );
  assert.equal(
    media.tracks[0].trackContentId,
    "http://192.168.1.5:3210/stream/secret/subtitles/sub-id?offset=1.5",
  );
  assert.equal(media.tracks[0].trackContentType, "text/vtt");
  assert.equal(media.tracks[0].type, "TEXT");
  assert.equal(media.streamType, "BUFFERED");
});
test("Cast manager passes resume, subtitles and pause state and controls active tracks", async () => {
  const manager = new CastManager();
  let loadOptions, request;
  manager.player = {
    media: {
      currentSession: null,
      sessionRequest: (data, cb) => {
        request = data;
        cb(null, {
          currentTime: 45,
          playerState: "PAUSED",
          activeTrackIds: [],
        });
      },
    },
    load: (media, options, cb) => {
      loadOptions = options;
      cb(null, {
        mediaSessionId: 7,
        currentTime: 45,
        playerState: "PAUSED",
        activeTrackIds: [1],
      });
    },
  };
  await manager.load({ tracks: [{}] }, "id", 45, true, false);
  assert.deepEqual(loadOptions, {
    autoplay: false,
    currentTime: 45,
    activeTrackIds: [1],
  });
  assert.equal(manager.player.media.currentSession.mediaSessionId, 7);
  await manager.command("subtitles", false);
  assert.deepEqual(request, { type: "EDIT_TRACKS_INFO", activeTrackIds: [] });
});
test("unresponsive Cast operations time out", async () => {
  const manager = new CastManager();
  await assert.rejects(
    manager.call(() => {}, 10),
    /초과/,
  );
});
