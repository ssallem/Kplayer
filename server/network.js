import os from "node:os";
import dgram from "node:dgram";

export function isPrivateIp(ip) {
  if (typeof ip !== "string" || !/^(\d{1,3}\.){3}\d{1,3}$/.test(ip))
    return false;
  const p = ip.split(".").map(Number);
  if (p.some((n) => n > 255)) return false;
  return (
    p[0] === 10 ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
  );
}
export function interfaces() {
  return Object.entries(os.networkInterfaces()).flatMap(([name, addresses]) =>
    addresses
      .filter(
        (a) => a.family === "IPv4" && !a.internal && isPrivateIp(a.address),
      )
      .map((a) => ({ name, address: a.address })),
  );
}
export function routeAddress(ip) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket("udp4");
    socket.once("error", (e) => {
      socket.close();
      reject(e);
    });
    socket.connect(8009, ip, () => {
      const address = socket.address().address;
      socket.close();
      resolve(address);
    });
  });
}
