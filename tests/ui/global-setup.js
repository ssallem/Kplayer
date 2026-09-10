import { fork } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";

export default async function setup() {
  await fs.mkdir("data", { recursive: true });
  const data = await fs.mkdtemp(path.resolve("data/test-run-"));
  const child = fork("server/index.js", ["--production"], {
    env: { ...process.env, PORT: "3212", KPLAYER_DATA: data },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
    windowsHide: true,
  });
  let error = "";
  child.stderr.on("data", (b) => {
    error += b.toString();
  });
  let ready = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    if (child.exitCode !== null)
      throw new Error(`Test server failed: ${error}`);
    try {
      const response = await fetch("http://localhost:3212/api/state");
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) {
    child.kill();
    throw new Error("Test server startup timed out.");
  }
  return async () => {
    if (child.exitCode !== null) return;
    const stopped = once(child, "exit");
    child.send("shutdown");
    const timer = setTimeout(() => child.kill(), 4000);
    await stopped;
    clearTimeout(timer);
  };
}
