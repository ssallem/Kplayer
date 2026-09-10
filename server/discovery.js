import multicastDns from "multicast-dns";
import { isPrivateIp } from "./network.js";

export class Discovery {
  constructor() {
    this.records = new Map();
    this.error = null;
    this.dns = multicastDns();
    this.dns.on("error", (error) => {
      this.error = error.message;
    });
    this.dns.on("response", (packet) => {
      for (const r of [...packet.answers, ...packet.additionals]) {
        this.records.set(`${r.type}:${r.name}`, {
          ...r,
          expires: Date.now() + r.ttl * 1000,
        });
      }
    });
    this.scan();
    this.timer = setInterval(() => this.scan(), 10000);
    this.timer.unref();
  }
  scan() {
    this.dns.query([{ name: "_googlecast._tcp.local", type: "PTR" }]);
  }
  list() {
    for (const [key, r] of this.records)
      if (r.expires < Date.now()) this.records.delete(key);
    const devices = [];
    for (const r of this.records.values()) {
      if (r.type !== "SRV" || !r.name.endsWith("._googlecast._tcp.local"))
        continue;
      const txt = this.records.get(`TXT:${r.name}`)?.data || [];
      const metadata = Object.fromEntries(
        txt.map((b) => {
          const s = b.toString();
          const i = s.indexOf("=");
          return [s.slice(0, i), s.slice(i + 1)];
        }),
      );
      const address = this.records.get(`A:${r.data.target}`)?.data;
      if (!address) {
        this.dns.query([{ name: r.data.target, type: "A" }]);
        continue;
      }
      if (isPrivateIp(address))
        devices.push({
          id: metadata.id || r.name,
          name: metadata.fn || "Chromecast",
          model: metadata.md || "Google Cast",
          address,
          port: r.data.port,
        });
    }
    return devices.filter(
      (d, i, a) => a.findIndex((x) => x.address === d.address) === i,
    );
  }
  close() {
    clearInterval(this.timer);
    this.dns.destroy();
  }
}
