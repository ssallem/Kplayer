import { randomBytes, randomInt, randomUUID } from "node:crypto";

export class OfflineReceiver {
  constructor() {
    this.state = { connected: false };
    this.pending = new Map();
    this.attempts = new Map();
    this.rotateCode();
  }
  rotateCode() {
    this.code = String(randomInt(100000, 1000000));
    this.codeExpires = Date.now() + 5 * 60_000;
  }
  pairingCode() {
    if (Date.now() > this.codeExpires) this.rotateCode();
    return this.code;
  }
  pair(code, address) {
    const now = Date.now();
    const recent = (this.attempts.get(address) || []).filter(
      (t) => now - t < 60_000,
    );
    if (recent.length >= 5)
      throw new Error("시도가 너무 많습니다. 1분 후 다시 연결해 주세요.");
    recent.push(now);
    this.attempts.set(address, recent);
    if (code !== this.pairingCode())
      throw new Error("PC 화면의 6자리 연결 번호를 확인해 주세요.");
    this.close();
    this.token = randomBytes(24).toString("hex");
    this.address = address;
    this.lastSeen = Date.now();
    this.rotateCode();
    return this.token;
  }
  authorized(token, address) {
    return !!this.token && token === this.token && address === this.address;
  }
  attach(res) {
    this.events?.end();
    this.events = res;
    this.state = {
      ...this.state,
      connected: true,
      device: {
        name: "오프라인 TV",
        address: this.address,
        model: "로컬 브라우저",
      },
    };
    res.write(": connected\n\n");
    res.on("close", () => {
      if (this.events === res) {
        this.events = null;
        this.state.connected = false;
      }
    });
  }
  status(body) {
    this.lastSeen = Date.now();
    for (const key of ["currentTime", "duration", "volume"])
      if (typeof body[key] === "number" && Number.isFinite(body[key]))
        this.state[key] = body[key];
    if (["PLAYING", "PAUSED", "BUFFERING", "IDLE"].includes(body.playerState))
      this.state.playerState = body.playerState;
    this.state.updatedAt = Date.now();
    if (typeof body.subtitlesEnabled === "boolean")
      this.state.subtitlesEnabled = body.subtitlesEnabled;
    const pending = this.pending.get(body.ackId);
    if (pending) {
      this.pending.delete(body.ackId);
      body.error
        ? pending.reject(
            new Error(
              "TV 브라우저에서 재생하지 못했습니다. TV 화면의 재생 버튼 또는 호환 변환을 확인해 주세요.",
            ),
          )
        : pending.resolve();
    }
  }
  async send(action, data = {}) {
    if (!this.events || !this.state.connected)
      throw new Error("TV 브라우저를 먼저 연결해 주세요.");
    const id = randomUUID();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error("TV 브라우저 응답이 없습니다. TV 화면을 확인해 주세요."),
        );
      }, 8000);
      this.pending.set(id, {
        resolve: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.events.write(`data: ${JSON.stringify({ id, action, ...data })}\n\n`);
    });
  }
  async load(media, itemId, currentTime, subtitles, autoplay = true) {
    await this.send("load", { media, currentTime, subtitles, autoplay });
    this.state.itemId = itemId;
  }
  async command(action, value) {
    await this.send(action, { value });
  }
  snapshot() {
    if (this.state.connected && Date.now() - this.lastSeen > 15000)
      this.state.connected = false;
    return this.state;
  }
  close() {
    this.events?.end();
    this.events = null;
    this.token = null;
    for (const task of this.pending.values())
      task.reject(new Error("TV 연결이 종료되었습니다."));
    this.pending.clear();
    this.state = { connected: false };
  }
}
