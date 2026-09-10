import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mediaStem } from "../shared/media.js";
import { decodeSubtitle, toVtt } from "./subtitles.js";

const generatedFile = /^[0-9a-f-]{36}\.[a-z0-9]+$/i;
export async function cleanTemporaryFiles(directory) {
  const resolved = path.resolve(directory);
  const stat = await fs.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("임시 폴더 경로를 확인할 수 없습니다.");
  for (const entry of await fs.readdir(resolved, { withFileTypes: true })) {
    if (!generatedFile.test(entry.name) || entry.isDirectory()) continue;
    const target = path.resolve(resolved, entry.name);
    if (path.dirname(target) !== resolved)
      throw new Error("임시 파일 경로 오류");
    await fs.unlink(target);
  }
}

export async function migrateLegacyLibrary(base, temporary) {
  const library = path.join(base, "library.json");
  let records;
  try {
    records = JSON.parse(await fs.readFile(library, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return [];
    throw new Error("기존 라이브러리를 정리하지 못했습니다.");
  }
  const result = [];
  for (const item of records) {
    if (!generatedFile.test(item.file || "")) continue;
    const source = path.resolve(base, item.file);
    if (path.dirname(source) !== path.resolve(base)) continue;
    try {
      await fs.rename(source, path.join(temporary, item.file));
      result.push(item);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
  }
  await fs.unlink(library);
  await fs.rm(path.join(base, "library.tmp"), { force: true });
  return result;
}

export async function openLocalMedia(sourcePath, mediaTypes) {
  const extension = path.extname(sourcePath).toLowerCase();
  if (!mediaTypes[extension])
    throw new Error("지원하는 영상 또는 음악 파일을 선택해 주세요.");
  const stat = await fs.stat(sourcePath);
  if (!stat.isFile()) throw new Error("일반 파일만 열 수 있습니다.");
  const item = {
    id: randomUUID(),
    name: path.basename(sourcePath),
    sourcePath,
    kind: "media",
    size: stat.size,
    contentType: mediaTypes[extension],
    createdAt: Date.now(),
    needsConversion: [".mkv", ".avi", ".mov"].includes(extension),
  };
  const results = [item];
  const directory = path.dirname(sourcePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const match = entries
    .filter(
      (e) =>
        e.isFile() &&
        [".srt", ".vtt"].includes(path.extname(e.name).toLowerCase()) &&
        mediaStem(e.name) === mediaStem(item.name),
    )
    .sort((a, b) => a.name.localeCompare(b.name))[0];
  if (match) {
    const subtitlePath = path.join(directory, match.name);
    const subStat = await fs.stat(subtitlePath);
    if (subStat.size <= 10 * 1024 ** 2) {
      const text = toVtt(decodeSubtitle(await fs.readFile(subtitlePath)));
      results.push({
        id: randomUUID(),
        name: match.name,
        kind: "subtitle",
        text,
        size: subStat.size,
        contentType: "text/vtt",
        createdAt: Date.now(),
      });
    }
  }
  return results;
}
