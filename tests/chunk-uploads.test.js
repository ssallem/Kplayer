import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { ChunkUploads, CHUNK_SIZE } from "../server/chunk-uploads.js";

test("disk import preserves bytes across chunks, rejects incorrect order, and publishes only completed files", async () => {
  const directory = await fs.mkdtemp(path.resolve("data/test-chunks-"));
  const uploads = new ChunkUploads(directory, { ".mp4": "video/mp4" });
  const bytes = Buffer.alloc(CHUNK_SIZE + 31, 0xa5);
  const session = await uploads.begin("영화.mp4", bytes.length);
  await assert.rejects(uploads.finish(session.id), /완료되지/);
  await assert.rejects(
    uploads.append(session.id, 1, bytes.subarray(0, 4)),
    /순서/,
  );
  await uploads.append(session.id, 0, bytes.subarray(0, CHUNK_SIZE));
  await assert.rejects(
    uploads.append(session.id, 0, bytes.subarray(0, 4)),
    /순서/,
  );
  await uploads.append(session.id, CHUNK_SIZE, bytes.subarray(CHUNK_SIZE));
  const item = await uploads.finish(session.id);
  const saved = await fs.readFile(path.join(directory, item.file));
  assert.equal(
    createHash("sha256").update(saved).digest("hex"),
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(item.name, "영화.mp4");
  assert.equal(uploads.sessions.size, 0);
  await fs.unlink(path.join(directory, item.file));
  await fs.rmdir(directory);
});

test("interrupted imports expire or clear and subtitle chunks become UTF8 WebVTT", async () => {
  const directory = await fs.mkdtemp(path.resolve("data/test-chunks-"));
  const uploads = new ChunkUploads(directory, { ".mp4": "video/mp4" });
  await assert.rejects(uploads.begin("../../private.mp4", 12), /이름/);
  await assert.rejects(uploads.begin("subtitle.srt", 11 * 1024 ** 2), /10MB/);
  const abandoned = await uploads.begin("movie.mp4", 100);
  await uploads.append(abandoned.id, 0, Buffer.alloc(12));
  await uploads.expire(Date.now() + 121000);
  assert.deepEqual(await fs.readdir(directory), []);
  await uploads.begin("cancel.mp4", 100);
  await uploads.clear();
  assert.deepEqual(await fs.readdir(directory), []);
  const caption = Buffer.from("1\n00:00:00,000 --> 00:00:05,000\n한글 자막");
  const sub = await uploads.begin("movie.srt", caption.length);
  await uploads.append(sub.id, 0, caption);
  const item = await uploads.finish(sub.id);
  assert.match(
    await fs.readFile(path.join(directory, item.file), "utf8"),
    /^WEBVTT[\s\S]*한글 자막/,
  );
  assert.equal(uploads.busyCount, 0);
  await fs.unlink(path.join(directory, item.file));
  await fs.rmdir(directory);
});
