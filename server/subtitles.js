import iconv from "iconv-lite";

export function decodeSubtitle(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe)
    return iconv.decode(buffer, "utf16-le");
  if (buffer[0] === 0xfe && buffer[1] === 0xff)
    return iconv.decode(buffer, "utf16-be");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return iconv.decode(buffer, "cp949");
  }
}

export function toVtt(input, offset = 0) {
  let text = input
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();
  if (!text.includes("-->"))
    throw new Error("시간 정보가 있는 SRT 또는 VTT 자막을 선택해 주세요.");
  text = text.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  if (!/^WEBVTT(?:\s|$)/.test(text)) text = `WEBVTT\n\n${text}`;
  return text.replace(
    /((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2,}:)?\d{2}:\d{2}\.\d{3})/g,
    (_, start, end) =>
      `${formatTime(parseTime(start) + offset)} --> ${formatTime(parseTime(end) + offset)}`,
  );
}
function parseTime(value) {
  return value.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}
function formatTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}
