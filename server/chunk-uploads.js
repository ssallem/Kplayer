import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { decodeSubtitle, toVtt } from "./subtitles.js";

export const CHUNK_SIZE = 4 * 1024 * 1024;
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });

// Only generated UUID filenames ever reach the filesystem. Unfinished imports
// are private and cannot be streamed until the declared byte count is complete.
export class ChunkUploads {
  constructor(directory, mediaTypes) {
    this.directory = directory;
    this.mediaTypes = mediaTypes;
    this.sessions = new Map();
    this.busyCount = 0;
    this.creating = 0;
  }
  async begin(name, size) {
    if (
      typeof name !== "string" ||
      !name ||
      name.length > 1024 ||
      /[\\/\0]/.test(name)
    )
      throw fail("파일 이름이 올바르지 않습니다.");
    const ext = path.extname(name).toLowerCase();
    const subtitle = [".srt", ".vtt"].includes(ext);
    if (!subtitle && !this.mediaTypes[ext])
      throw fail("지원하지 않는 파일 형식입니다.");
    if (
      !Number.isSafeInteger(size) ||
      size <= 0 ||
      size > (subtitle ? 10 * 1024 ** 2 : 20 * 1024 ** 3)
    )
      throw fail(
        subtitle
          ? "자막은 10MB 이하만 지원합니다."
          : "영상은 0바이트 초과, 20GB 이하만 지원합니다.",
      );
    if (this.sessions.size + this.creating >= 4)
      throw fail("진행 중인 파일 전송을 마친 뒤 다시 시도해 주세요.", 409);
    const id = randomUUID(),
      file = id + ext;
    this.busyCount++;
    this.creating++;
    try {
      await fs.writeFile(path.join(this.directory, file), Buffer.alloc(0), {
        flag: "wx",
      });
      this.sessions.set(id, {
        id,
        file,
        name,
        size,
        ext,
        subtitle,
        received: 0,
        updatedAt: Date.now(),
        busy: false,
      });
      return { id, received: 0, chunkSize: CHUNK_SIZE };
    } finally {
      this.busyCount--;
      this.creating--;
    }
  }
  async operation(id, callback) {
    const session = this.sessions.get(id);
    if (!session)
      throw fail("파일 전송 세션이 만료되었습니다. 다시 전송해 주세요.", 404);
    if (session.busy) throw fail("이 파일의 이전 조각을 처리 중입니다.", 409);
    session.busy = true;
    this.busyCount++;
    session.updatedAt = Date.now();
    try {
      return await callback(session, path.join(this.directory, session.file));
    } finally {
      session.busy = false;
      session.updatedAt = Date.now();
      this.busyCount--;
    }
  }
  async append(id, offset, bytes) {
    return this.operation(id, async (session, file) => {
      if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > CHUNK_SIZE)
        throw fail("파일 조각 크기가 올바르지 않습니다.");
      if (!Number.isSafeInteger(offset) || offset !== session.received)
        throw fail("파일 조각 순서가 일치하지 않습니다.", 409);
      if (session.received + bytes.length > session.size)
        throw fail("선택한 파일 크기를 초과했습니다.");
      await fs.appendFile(file, bytes);
      session.received += bytes.length;
      return { received: session.received };
    });
  }
  async finish(id) {
    return this.operation(id, async (session, file) => {
      if (session.received !== session.size)
        throw fail("파일 전송이 완료되지 않았습니다.", 409);
      if (session.subtitle)
        await fs.writeFile(
          file,
          toVtt(decodeSubtitle(await fs.readFile(file))),
        );
      this.sessions.delete(id);
      return {
        id,
        file: session.file,
        name: session.name,
        size: session.size,
        kind: session.subtitle ? "subtitle" : "media",
        contentType: session.subtitle
          ? "text/vtt"
          : this.mediaTypes[session.ext],
        createdAt: Date.now(),
        needsConversion: [".mkv", ".avi", ".mov"].includes(session.ext),
      };
    });
  }
  async abort(id) {
    if (!this.sessions.has(id)) return;
    await this.operation(id, async (_, file) => {
      await fs.rm(file, { force: true });
      this.sessions.delete(id);
    });
  }
  async expire(now = Date.now()) {
    for (const session of this.sessions.values()) {
      if (!session.busy && now - session.updatedAt > 120000)
        await this.abort(session.id);
    }
  }
  async clear() {
    for (const id of this.sessions.keys()) await this.abort(id);
  }
}
