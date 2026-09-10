import express from "express";
import multer from "multer";
import { randomBytes, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { Discovery } from "./discovery.js";
import { CastManager, buildMedia } from "./cast.js";
import { interfaces, isPrivateIp, routeAddress } from "./network.js";
import { decodeSubtitle, toVtt } from "./subtitles.js";
import { matchingSubtitle } from "../shared/media.js";
import {
  cleanTemporaryFiles,
  migrateLegacyLibrary,
  openLocalMedia,
} from "./private-files.js";
import { OfflineReceiver } from "./offline.js";
import { lockSession } from "./session-lock.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offlineMode = process.env.KPLAYER_MODE === "offline";
const base = path.resolve(
  process.env.KPLAYER_DATA ||
    path.join(root, "data", ...(offlineMode ? ["offline"] : [])),
);
const data = path.join(base, "private-session");
await lockSession(base);
await fs.mkdir(data, { recursive: true });
await cleanTemporaryFiles(data);
const port = Number(process.env.PORT || (offlineMode ? 3213 : 3210));
let token = randomBytes(24).toString("hex");
const castManager = new CastManager();
const offline = new OfflineReceiver();
const player = offlineMode ? offline : castManager;
const discovery = offlineMode
  ? { list: () => [], scan: () => {}, close: () => {}, error: null }
  : new Discovery();
const items = new Map();
const jobs = new Map();
const presence = new Set();
let lastActivity = Date.now(),
  activeUploads = 0,
  clearing = false,
  picking = false,
  stopping = false;
let ffmpegAvailable = false;
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const check = spawn(ffmpeg, ["-version"], {
  windowsHide: true,
  stdio: "ignore",
});
check.on("error", () => {});
check.on("exit", (code) => {
  ffmpegAvailable = code === 0;
});
for (const item of await migrateLegacyLibrary(base, data))
  items.set(item.id, item);
function mediaPath(item) {
  return item.sourcePath || path.join(data, item.file);
}
function exposed(item) {
  const { file, sourcePath, text, ...rest } = item;
  return {
    ...rest,
    url: `/stream/${token}/${item.kind === "subtitle" ? "subtitles" : "media"}/${item.id}`,
  };
}
function getItem(id, kind) {
  const item = items.get(id);
  if (!item || (kind && item.kind !== kind))
    throw Object.assign(new Error("파일을 찾을 수 없습니다."), { status: 404 });
  return item;
}
const mediaTypes = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};
const upload = multer({
  storage: multer.diskStorage({
    destination: data,
    filename: (_, file, cb) =>
      cb(null, randomUUID() + path.extname(file.originalname).toLowerCase()),
  }),
  limits: { files: 1, fileSize: 20 * 1024 ** 3 },
  fileFilter: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(
      mediaTypes[ext] || [".srt", ".vtt"].includes(ext)
        ? null
        : new Error(
            "지원하지 않는 파일입니다. 영상·음악 또는 SRT·VTT 자막을 선택해 주세요.",
          ),
      true,
    );
  },
});
const app = express();
app.disable("x-powered-by");
app.use((req, res, next) => {
  res.set({
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
  });
  next();
});
app.use(express.json({ limit: "32kb" }));
const localAddress = (address) =>
  ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
app.get("/tv", (req, res) =>
  offlineMode
    ? res.sendFile(path.join(root, "public/tv.html"))
    : res.sendStatus(404),
);
app.use("/tv", (req, res, next) => {
  if (
    !offlineMode ||
    (!localAddress(req.socket.remoteAddress) &&
      !isPrivateIp(req.socket.remoteAddress?.replace("::ffff:", "")))
  )
    return res.sendStatus(403);
  next();
});
app.post("/tv/pair", (req, res) => {
  res.json({ token: offline.pair(req.body.code, req.socket.remoteAddress) });
});
app.use("/tv/:action/:key", (req, res, next) =>
  offline.authorized(req.params.key, req.socket.remoteAddress)
    ? next()
    : res.sendStatus(403),
);
app.get("/tv/events/:key", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
  res.flushHeaders();
  offline.attach(res);
});
app.get("/tv/check/:key", (req, res) => res.json({ ok: true }));
app.post("/tv/status/:key", (req, res) => {
  offline.status(req.body);
  res.json({ ok: true });
});
app.use("/stream/:token", (req, res, next) => {
  const address = req.socket.remoteAddress;
  const permitted =
    req.params.token === token &&
    (localAddress(address) ||
      (!offlineMode &&
        address?.replace("::ffff:", "") === castManager.state.device?.address));
  if (
    !permitted &&
    !(offlineMode && offline.authorized(req.params.token, address))
  )
    return res.sendStatus(404);
  res.set({
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers":
      "Content-Length, Content-Range, Accept-Ranges",
    "Cross-Origin-Resource-Policy": "cross-origin",
  });
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.get("/stream/:token/media/:id", (req, res) => {
  const item = getItem(req.params.id, "media");
  res.type(item.contentType);
  res.sendFile(mediaPath(item), { cacheControl: false });
});
app.get("/stream/:token/subtitles/:id", async (req, res) => {
  const item = getItem(req.params.id, "subtitle");
  const offset = Number(req.query.offset || 0);
  if (!Number.isFinite(offset) || Math.abs(offset) > 600)
    return res.status(400).json({ error: "자막 보정은 ±600초 범위입니다." });
  res
    .type("text/vtt")
    .set("Cache-Control", "no-store")
    .send(
      toVtt(item.text || (await fs.readFile(mediaPath(item), "utf8")), offset),
    );
});
// Only the local computer can control the app. TVs get token-scoped media URLs.
app.use((req, res, next) => {
  const remote = req.socket.remoteAddress;
  if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remote))
    return res
      .status(403)
      .send("KPLAYER는 실행 중인 PC의 localhost에서 열어 주세요.");
  const allowed = [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`];
  if (!allowed.includes(req.headers.host)) return res.sendStatus(403);
  if (
    req.headers.origin &&
    !allowed.some((host) => req.headers.origin === `http://${host}`)
  )
    return res.sendStatus(403);
  next();
});
app.get("/api/presence", (req, res) => {
  res.set({ "Content-Type": "text/event-stream", Connection: "keep-alive" });
  res.flushHeaders();
  presence.add(res);
  res.write(": active\n\n");
  const keepalive = setInterval(() => res.write(": active\n\n"), 15000);
  keepalive.unref();
  res.once("close", () => {
    clearInterval(keepalive);
    presence.delete(res);
    lastActivity = Date.now();
  });
});
app.get("/api/state", (_, res) => {
  lastActivity = Date.now();
  res.json({
    items: [...items.values()].map(exposed),
    devices: discovery.list(),
    discoveryError: discovery.error,
    network: interfaces(),
    cast: offlineMode ? offline.snapshot() : castManager.state,
    mode: offlineMode ? "offline" : "internet",
    port,
    pairingCode: offlineMode ? offline.pairingCode() : undefined,
    nativePicker: process.platform === "win32",
    privacy: { persistentHistory: false, cleanupAfterSeconds: 30 },
    jobs: [...jobs.values()].map(({ process, ...job }) => job),
    ffmpegAvailable,
  });
});
app.use("/api", (req, res, next) => {
  if (clearing || stopping)
    return res.status(409).json({ error: "임시 데이터를 정리 중입니다." });
  next();
});
app.post("/api/open-local", async (req, res) => {
  if (process.platform !== "win32")
    throw new Error("이 환경에서는 파일 끌어 놓기를 사용해 주세요.");
  if (picking) throw new Error("열려 있는 파일 선택 창을 확인해 주세요.");
  picking = true;
  try {
    const selected = await new Promise((resolve, reject) => {
      const proc = spawn(
        "powershell.exe",
        [
          "-NoProfile",
          "-STA",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          path.join(root, "scripts/select-media.ps1"),
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] },
      );
      let output = "";
      proc.stdout.on("data", (b) => {
        output += b.toString("utf8");
      });
      proc.once("error", () =>
        reject(new Error("파일 선택 창을 열지 못했습니다.")),
      );
      proc.once("close", (code) => {
        if (code !== 0)
          return reject(new Error("파일 선택 창 실행에 실패했습니다."));
        try {
          resolve(output.trim() ? JSON.parse(output.trim()) : null);
        } catch {
          reject(new Error("선택한 파일을 읽을 수 없습니다."));
        }
      });
    });
    if (!selected) return res.json({ items: [] });
    const opened = await openLocalMedia(selected, mediaTypes);
    for (const item of opened) items.set(item.id, item);
    lastActivity = Date.now();
    res.json({ items: opened.map(exposed) });
  } finally {
    picking = false;
  }
});
app.post("/api/privacy/clear", async (req, res) => {
  await clearSession();
  res.json({ ok: true });
});
app.post("/api/shutdown", (req, res) => {
  res.json({ ok: true });
  setImmediate(shutdown);
});
app.post("/api/scan", (_, res) => {
  discovery.scan();
  res.json({ ok: true });
});
app.post(
  "/api/upload",
  (req, res, next) => {
    activeUploads++;
    let ended = false;
    const done = () => {
      if (!ended) {
        ended = true;
        activeUploads--;
      }
    };
    res.once("finish", done);
    res.once("close", done);
    next();
  },
  upload.single("file"),
  async (req, res) => {
    if (!req.file) throw new Error("파일을 선택해 주세요.");
    const ext = path.extname(req.file.originalname).toLowerCase();
    const kind = [".srt", ".vtt"].includes(ext) ? "subtitle" : "media";
    try {
      if (kind === "subtitle") {
        if (req.file.size > 10 * 1024 ** 2)
          throw new Error("자막 파일은 10MB 이하만 지원합니다.");
        await fs.writeFile(
          req.file.path,
          toVtt(decodeSubtitle(await fs.readFile(req.file.path))),
        );
      }
      const item = {
        id: randomUUID(),
        file: req.file.filename,
        name: Buffer.from(req.file.originalname, "latin1").toString("utf8"),
        kind,
        size: req.file.size,
        contentType: kind === "subtitle" ? "text/vtt" : mediaTypes[ext],
        createdAt: Date.now(),
        needsConversion: [".mkv", ".avi", ".mov"].includes(ext),
      };
      items.set(item.id, item);
      res.status(201).json(exposed(item));
    } catch (e) {
      await fs.rm(req.file.path, { force: true });
      throw e;
    }
  },
);
app.delete("/api/items/:id", async (req, res) => {
  const item = getItem(req.params.id);
  if (player.state.itemId === item.id && player.state.connected)
    throw new Error("TV 재생을 종료한 뒤 삭제해 주세요.");
  if (
    [...jobs.values()].some(
      (j) => j.itemId === item.id && j.status === "running",
    )
  )
    throw new Error("변환 중인 파일은 삭제할 수 없습니다.");
  if (item.file) await fs.rm(path.join(data, item.file), { force: true });
  items.delete(item.id);
  res.json({ ok: true });
});
app.post("/api/cast/connect", async (req, res) => {
  if (offlineMode)
    throw new Error("TV 브라우저에서 연결 번호를 입력해 주세요.");
  if (!isPrivateIp(req.body.address))
    throw new Error("TV의 내부 IPv4 주소를 입력해 주세요. 예: 192.168.0.20");
  if (castManager.busy)
    return res.status(409).json({ error: "TV 연결 작업이 진행 중입니다." });
  castManager.busy = true;
  try {
    const device = discovery
      .list()
      .find((d) => d.address === req.body.address) || {
      id: req.body.address,
      address: req.body.address,
      name: "내 TV",
      model: "Google Cast",
    };
    await castManager.connect(device);
    res.json(castManager.state);
  } finally {
    castManager.busy = false;
  }
});
app.post("/api/cast/load", async (req, res) => {
  if (castManager.busy)
    return res.status(409).json({ error: "TV 작업이 진행 중입니다." });
  const item = getItem(req.body.itemId, "media");
  const subtitle = req.body.subtitleId
    ? getItem(req.body.subtitleId, "subtitle")
    : req.body.subtitleId === null
      ? null
      : matchingSubtitle(item, [...items.values()]);
  const currentTime = Number(req.body.currentTime || 0),
    offset = Number(req.body.offset || 0);
  if (
    !Number.isFinite(currentTime) ||
    currentTime < 0 ||
    !Number.isFinite(offset) ||
    Math.abs(offset) > 600
  )
    throw new Error("재생 시간 또는 자막 보정 값이 올바르지 않습니다.");
  if (!player.state.connected) throw new Error("먼저 TV를 연결해 주세요.");
  castManager.busy = true;
  try {
    const address = await routeAddress(
      player.state.device.address.replace("::ffff:", ""),
    );
    const media = buildMedia(
      item,
      `http://${address}:${port}/stream/${offlineMode ? offline.token : token}`,
      subtitle,
      offset,
    );
    await player.load(
      media,
      item.id,
      currentTime,
      req.body.subtitlesEnabled !== false,
      req.body.autoplay !== false,
    );
    player.state.subtitleId = subtitle?.id || "";
    res.json(player.state);
  } finally {
    castManager.busy = false;
  }
});
app.post("/api/cast/control", async (req, res) => {
  const { action, value } = req.body;
  if (castManager.busy)
    return res.status(409).json({ error: "TV 작업이 진행 중입니다." });
  if (
    ![
      "play",
      "pause",
      "stop",
      "seek",
      "volume",
      "subtitles",
      "disconnect",
    ].includes(action)
  )
    throw new Error("알 수 없는 재생 명령입니다.");
  if (
    ["seek", "volume"].includes(action) &&
    (typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      (action === "volume" && value > 1))
  )
    throw new Error("올바르지 않은 값입니다.");
  if (action === "disconnect") {
    try {
      if (player.state.connected) await player.command("stop");
    } finally {
      player.close();
    }
  } else await player.command(action, value);
  res.json(player.state);
});
app.post("/api/convert/:id", async (req, res) => {
  if (!ffmpegAvailable)
    throw new Error(
      "FFmpeg가 필요합니다. 설치 후 KPLAYER를 다시 실행해 주세요.",
    );
  if ([...jobs.values()].some((j) => j.status === "running"))
    throw new Error("현재 변환이 끝난 뒤 다시 시도해 주세요.");
  const item = getItem(req.params.id, "media");
  const id = randomUUID(),
    filename = `${id}.mp4`;
  const job = { id, itemId: item.id, status: "running", seconds: 0 };
  const proc = spawn(
    ffmpeg,
    [
      "-nostdin",
      "-i",
      mediaPath(item),
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "22",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      "-c:a",
      "aac",
      "-ac",
      "2",
      "-b:a",
      "192k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-y",
      path.join(data, filename),
    ],
    { windowsHide: true },
  );
  job.process = proc;
  jobs.set(id, job);
  proc.stdout.on("data", (b) => {
    const match = b.toString().match(/out_time_us=(\d+)/);
    if (match) job.seconds = Number(match[1]) / 1e6;
  });
  let error = "";
  proc.stderr.on("data", (b) => {
    error = (error + b.toString()).slice(-1500);
  });
  proc.on("error", () => {
    job.status = "error";
    job.error = "FFmpeg를 실행할 수 없습니다.";
  });
  proc.on("close", async (code) => {
    try {
      if (code !== 0 || job.cancelled) {
        job.status = "error";
        job.error =
          "변환에 실패했습니다. 영상 파일과 저장 공간을 확인해 주세요.";
        await fs.rm(path.join(data, filename), { force: true });
        return;
      }
      const converted = {
        ...item,
        id,
        file: filename,
        sourcePath: undefined,
        name: `${path.parse(item.name).name} · TV.mp4`,
        contentType: "video/mp4",
        needsConversion: false,
        size: (await fs.stat(path.join(data, filename))).size,
        createdAt: Date.now(),
      };
      items.set(id, converted);
      job.status = "done";
      job.resultId = id;
    } catch {
      job.status = "error";
      job.error = "변환 파일을 저장하지 못했습니다. 저장 공간을 확인해 주세요.";
    }
  });
  res.status(202).json({ id });
});
if (process.argv.includes("--production")) {
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_, res) =>
    res.sendFile(path.join(root, "dist/index.html")),
  );
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const message = /load failed/i.test(err.message)
    ? "TV가 영상을 열지 못했습니다. 방화벽의 TCP 3210 허용 여부를 확인하거나 TV 호환 변환을 사용해 주세요."
    : err.message;
  res
    .status(err.status || 400)
    .json({ error: message || "요청을 처리하지 못했습니다." });
});
const server = app.listen(port, "0.0.0.0", () =>
  console.log(`KPLAYER ready at http://localhost:${port}`),
);
server.on("error", (e) => {
  console.error(e.message);
  process.exit(1);
});
async function clearSession() {
  if (activeUploads || picking || castManager.busy || clearing)
    throw new Error("파일 열기 또는 TV 작업이 끝나면 다시 시도해 주세요.");
  clearing = true;
  try {
    try {
      if (player.state.connected) await player.command("stop");
    } catch {}
    player.close();
    const running = [...jobs.values()].filter((j) => j.status === "running");
    await Promise.all(
      running.map(async (job) => {
        job.cancelled = true;
        const closed = once(job.process, "close");
        job.process.kill();
        await closed;
      }),
    );
    items.clear();
    jobs.clear();
    token = randomBytes(24).toString("hex");
    offline.rotateCode();
    await cleanTemporaryFiles(data);
  } finally {
    clearing = false;
  }
}
const privacyTimer = setInterval(() => {
  if (presence.size === 0 && Date.now() - lastActivity > 30_000 && !clearing)
    clearSession()
      .then(() => {
        lastActivity = Date.now();
      })
      .catch(() => {});
}, 2000);
privacyTimer.unref();
async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(privacyTimer);
  discovery.close();
  try {
    await clearSession();
  } catch {}
  castManager.close();
  offline.close();
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
if (process.send)
  process.on("message", (message) => {
    if (message === "shutdown") shutdown();
  });
