import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";

test.beforeAll(async () => {
  await fs.mkdir("data/test-fixtures", { recursive: true });
  execFileSync(
    "ffmpeg",
    [
      "-f",
      "lavfi",
      "-i",
      "color=c=0x304b3b:s=640x360:r=24",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=440:sample_rate=44100",
      "-t",
      "6",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-movflags",
      "+faststart",
      "-y",
      "data/test-fixtures/sample.mp4",
    ],
    { windowsHide: true, stdio: "ignore" },
  );
});

test("desktop, dialogs and narrow layouts work without page errors", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1080 });
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("heading", { name: "당신의 화면을, 더 넓게." }),
  ).toBeVisible();
  await page.screenshot({
    path: "data/screenshots/desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "TV 연결하기", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByText("TV IP 주소로 직접 연결", { exact: true }).click();
  await page.getByRole("textbox", { name: "TV IP 주소" }).fill("8.8.8.8");
  await page.getByRole("button", { name: "연결", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "내부 IPv4",
  );
  await page.screenshot({
    path: "data/screenshots/cast-dialog.png",
    fullPage: true,
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByRole("button", { name: "알림 닫기" }).click();
  for (const width of [390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: `data/screenshots/layout-${width}.png`,
      fullPage: true,
    });
  }
  expect(errors).toEqual([]);
});

test("main screen has no serious accessibility violations", async ({
  page,
}) => {
  await page.goto("/");
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  await fs.writeFile(
    "data/accessibility.json",
    JSON.stringify(result.violations, null, 2),
  );
  expect(
    result.violations.filter((v) => ["serious", "critical"].includes(v.impact)),
  ).toEqual([]);
});

test("upload, actual playback, Korean captions, seek, filtering and delete", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles("data/test-fixtures/sample.mp4");
  await expect(page.locator("video")).toHaveAttribute("src", /stream/);
  await expect
    .poll(() => page.locator("video").evaluate((el) => el.duration))
    .toBeGreaterThan(5);
  await page.getByRole("button", { name: "재생", exact: true }).click();
  await expect
    .poll(() => page.locator("video").evaluate((el) => el.currentTime))
    .toBeGreaterThan(0.2);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await page
    .locator("input[type=file]")
    .nth(1)
    .setInputFiles({
      name: "sample.srt",
      mimeType: "application/x-subrip",
      buffer: Buffer.from(
        "1\n00:00:00,000 --> 00:00:05,500\n한글 자막 테스트\n",
      ),
    });
  await expect(page.locator("video track")).toHaveAttribute("src", /subtitles/);
  await expect
    .poll(() =>
      page.locator("video").evaluate((el) => el.textTracks[0]?.cues?.[0]?.text),
    )
    .toBe("한글 자막 테스트");
  await page.getByRole("button", { name: "자막 설정", exact: true }).click();
  await page
    .getByRole("spinbutton", { name: "자막 시간 보정 (초)" })
    .fill("1.5");
  await page.getByRole("button", { name: "적용하기", exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator("video")
        .evaluate((el) => el.textTracks[0]?.cues?.[0]?.startTime),
    )
    .toBe(1.5);
  await page.getByRole("switch", { name: "자막 표시" }).click();
  await expect
    .poll(() => page.locator("video").evaluate((el) => el.textTracks[0]?.mode))
    .toBe("hidden");
  await page.getByRole("button", { name: "10초 앞으로" }).click();
  await expect
    .poll(() => page.locator("video").evaluate((el) => el.currentTime))
    .toBeGreaterThan(5);
  await page.getByRole("button", { name: "음악", exact: true }).click();
  await expect(page.getByText("이 종류의 파일이 아직 없어요.")).toBeVisible();
  await page.getByRole("button", { name: "전체", exact: true }).click();
  const state = await (await request.get("/api/state")).json();
  const item = state.items.find((i) => i.name === "sample.mp4");
  const range = await request.get(item.url, {
    headers: { Range: "bytes=0-99" },
  });
  expect(range.status()).toBe(206);
  expect((await range.body()).length).toBe(100);
  expect(range.headers()["access-control-allow-origin"]).toBe("*");
  expect(
    (
      await request.get(item.url.replace(/stream\/[^/]+/, "stream/wrong"))
    ).status(),
  ).toBe(404);
  await page.screenshot({
    path: "data/screenshots/playback.png",
    fullPage: true,
  });
  await page
    .getByRole("button", {
      name: "sample.mp4 라이브러리에서 삭제",
      exact: true,
    })
    .click();
  await expect(page.locator("video")).toHaveCount(0);
});

test("fine volume, simultaneous automatic subtitles and private session cleanup", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "private-title.mp4",
        mimeType: "video/mp4",
        buffer: await fs.readFile("data/test-fixtures/sample.mp4"),
      },
      {
        name: "unrelated.srt",
        mimeType: "text/plain",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:05,000\nwrong"),
      },
      {
        name: "private-title.srt",
        mimeType: "text/plain",
        buffer: Buffer.from("1\n00:00:00,000 --> 00:00:05,000\n자동 자막"),
      },
    ]);
  await expect
    .poll(() =>
      page.locator("video").evaluate((el) => el.textTracks[0]?.cues?.[0]?.text),
    )
    .toBe("자동 자막");
  await page.getByRole("button", { name: "음량 미세 조절" }).click();
  await page.getByRole("button", { name: "음량 1% 줄이기" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "음량 퍼센트" }),
  ).toHaveValue("69");
  await page.getByRole("spinbutton", { name: "음량 퍼센트" }).fill("23");
  await expect
    .poll(() => page.locator("video").evaluate((el) => el.volume))
    .toBe(0.23);
  await page.keyboard.press("Escape");
  const state = await (await request.get("/api/state")).json();
  const item = state.items.find((i) => i.name === "private-title.mp4");
  expect((await request.get(item.url)).headers()["cache-control"]).toBe(
    "no-store",
  );
  expect(JSON.stringify(state)).not.toContain("sourcePath");
  await page.getByRole("button", { name: "기록 없는 재생" }).click();
  await page.getByRole("button", { name: "재생 종료·임시 파일 삭제" }).click();
  await expect(page.locator("video")).toHaveCount(0);
  expect((await request.get(item.url)).status()).toBe(404);
  expect((await (await request.get("/api/state")).json()).items).toEqual([]);
});

test("FFmpeg conversion produces seekable H264/AAC MP4", async ({
  request,
}) => {
  const upload = await request.post("/api/upload", {
    multipart: {
      file: {
        name: "convert.mp4",
        mimeType: "video/mp4",
        buffer: await fs.readFile("data/test-fixtures/sample.mp4"),
      },
    },
  });
  const item = await upload.json();
  expect(upload.status()).toBe(201);
  const result = await request.post(`/api/convert/${item.id}`);
  expect(result.status()).toBe(202);
  const { id } = await result.json();
  await expect
    .poll(
      async () =>
        (await (await request.get("/api/state")).json()).jobs.find(
          (j) => j.id === id,
        )?.status,
      { timeout: 30000 },
    )
    .toBe("done");
  const state = await (await request.get("/api/state")).json();
  const converted = state.items.find((i) => i.id === id);
  expect(converted.contentType).toBe("video/mp4");
  const bytes = await (await request.get(converted.url)).body();
  await fs.writeFile("data/test-fixtures/converted.mp4", bytes);
  const probe = JSON.parse(
    execFileSync(
      "ffprobe",
      [
        "-v",
        "quiet",
        "-show_streams",
        "-of",
        "json",
        path.resolve("data/test-fixtures/converted.mp4"),
      ],
      { windowsHide: true },
    ).toString(),
  );
  expect(probe.streams.map((s) => s.codec_name)).toEqual(["h264", "aac"]);
});

test("reject cross-origin writes and malformed uploads", async ({
  request,
}) => {
  expect(
    (
      await request.post("/api/scan", {
        headers: { Origin: "https://untrusted.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/state", {
        headers: { Host: "untrusted.example:3211" },
      })
    ).status(),
  ).toBe(403);
  const bad = await request.post("/api/upload", {
    multipart: {
      file: {
        name: "bad.srt",
        mimeType: "text/plain",
        buffer: Buffer.from("not captions"),
      },
    },
  });
  expect(bad.status()).toBe(400);
  expect(
    (
      await request.post("/api/cast/connect", {
        data: { address: "127.0.0.1" },
      })
    ).status(),
  ).toBe(400);
});
