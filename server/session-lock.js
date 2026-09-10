import fs from "node:fs/promises";
import { unlinkSync } from "node:fs";
import path from "node:path";

export async function lockSession(base) {
  await fs.mkdir(base, { recursive: true });
  const lockPath = path.join(base, "session.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(String(process.pid));
      await handle.close();
      const release = () => {
        try {
          unlinkSync(lockPath);
        } catch {}
      };
      process.once("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = Number(await fs.readFile(lockPath, "utf8"));
      if (!Number.isInteger(owner) || owner <= 0)
        throw new Error("세션 잠금 파일을 확인할 수 없습니다.");
      let running = true;
      try {
        process.kill(owner, 0);
      } catch (e) {
        if (e.code === "ESRCH") running = false;
      }
      if (running)
        throw new Error(
          "이 데이터 폴더를 사용하는 KPLAYER가 이미 실행 중입니다.",
        );
      await fs.unlink(lockPath);
    }
  }
  throw new Error("세션 잠금을 만들지 못했습니다.");
}
