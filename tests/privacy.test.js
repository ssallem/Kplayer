import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  cleanTemporaryFiles,
  migrateLegacyLibrary,
  openLocalMedia,
} from "../server/private-files.js";
import { matchingSubtitle } from "../shared/media.js";
import { buildMedia } from "../server/cast.js";

test("native file selection reads matching sibling subtitles without modifying source files", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kplayer-source-test-"));
  await fs.writeFile(path.join(dir, "한글 영상.mp4"), "source bytes");
  await fs.writeFile(
    path.join(dir, "한글 영상.SRT"),
    "1\n00:00:00,000 --> 00:00:05,000\n안녕하세요",
  );
  await fs.writeFile(path.join(dir, "다른 제목.srt"), "not selected");
  const items = await openLocalMedia(path.join(dir, "한글 영상.mp4"), {
    ".mp4": "video/mp4",
  });
  assert.equal(items.length, 2);
  assert.match(items[1].text, /안녕하세요/);
  assert.equal(items[0].file, undefined);
  assert.equal(await fs.readFile(items[0].sourcePath, "utf8"), "source bytes");
  assert.equal(
    matchingSubtitle({ ...items[0], name: "한글 영상 · TV.mp4" }, items).id,
    items[1].id,
  );
  for (const name of ["한글 영상.mp4", "한글 영상.SRT", "다른 제목.srt"])
    await fs.unlink(path.join(dir, name));
  await fs.rmdir(dir);
});
test("legacy history is migrated to temporary copies and cleanup never touches source paths", async () => {
  const base = await fs.mkdtemp(
      path.join(os.tmpdir(), "kplayer-private-test-"),
    ),
    temp = path.join(base, "session");
  await fs.mkdir(temp);
  const file = "12345678-1234-1234-1234-123456789abc.mp4";
  await fs.writeFile(path.join(base, file), "copy");
  await fs.writeFile(path.join(base, "original.mp4"), "keep");
  await fs.writeFile(
    path.join(base, "library.json"),
    JSON.stringify([
      { id: "id", file, name: "secret.mp4" },
      { file: "../original.mp4" },
    ]),
  );
  const migrated = await migrateLegacyLibrary(base, temp);
  assert.equal(migrated.length, 1);
  await assert.rejects(fs.access(path.join(base, "library.json")));
  await cleanTemporaryFiles(temp);
  assert.deepEqual(await fs.readdir(temp), []);
  assert.equal(
    await fs.readFile(path.join(base, "original.mp4"), "utf8"),
    "keep",
  );
  await fs.unlink(path.join(base, "original.mp4"));
  await fs.rmdir(temp);
  await fs.rmdir(base);
});
test("Cast receiver metadata never includes private file names", () => {
  const data = buildMedia(
    { id: "id", name: "sensitive-name.mp4", contentType: "video/mp4" },
    "http://192.168.1.2/stream/token",
    { id: "sub", name: "sensitive-name.srt" },
  );
  assert.equal(data.metadata.title, "KPLAYER");
  assert.equal(JSON.stringify(data).includes("sensitive-name"), false);
});
