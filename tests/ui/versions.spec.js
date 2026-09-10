import { test, expect } from "@playwright/test";
import { fork } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import express from "express";
import AxeBuilder from "@axe-core/playwright";
let child, siteServer, offlineData;
test.beforeAll(async () => {
  offlineData = await fs.mkdtemp(path.resolve("data/test-offline-"));
  child = fork("server/index.js", ["--production"], {
    env: {
      ...process.env,
      PORT: "3214",
      KPLAYER_MODE: "offline",
      KPLAYER_DATA: offlineData,
    },
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    windowsHide: true,
  });
  const app = express();
  app.use(express.static("site-dist"));
  siteServer = app.listen(3215, "127.0.0.1");
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch("http://localhost:3214/api/state")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Offline server not ready");
});
test.afterAll(async () => {
  siteServer?.close();
  if (child?.exitCode === null) {
    const done = once(child, "exit");
    child.send("shutdown");
    await done;
  }
  expect(await fs.readdir(path.join(offlineData, "private-session"))).toEqual(
    [],
  );
});

test("public site plays files and same-name captions without upload or external requests", async ({
  page,
}) => {
  const external = [],
    writes = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://localhost:3215") &&
      !r.url().startsWith("blob:")
    )
      external.push(r.url());
    if (r.method() !== "GET") writes.push(r.url());
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto("http://localhost:3215");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "data/screenshots/public-desktop.png",
    fullPage: true,
  });
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(
    axe.violations.map((v) => ({
      id: v.id,
      targets: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "browser.mp4",
        mimeType: "video/mp4",
        buffer: await fs.readFile("data/test-fixtures/sample.mp4"),
      },
      {
        name: "browser.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "1\n00:00:00,000 --> 00:00:05,000\n브라우저 자동 자막",
        ),
      },
    ]);
  await expect
    .poll(() =>
      page.locator("video").evaluate((v) => v.textTracks[0]?.cues?.[0]?.text),
    )
    .toBe("브라우저 자동 자막");
  await page.locator("video").evaluate((v) => v.play());
  await expect
    .poll(() => page.locator("video").evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.1);
  await page.getByRole("button", { name: "음량 1% 줄이기" }).click();
  await expect(
    page.getByRole("spinbutton", { name: "음량 퍼센트" }),
  ).toHaveValue("69");
  expect(external).toEqual([]);
  expect(writes).toEqual([]);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  await page.getByRole("button", { name: "프라이버시", exact: true }).click();
  await page
    .getByRole("button", { name: "재생 종료·이번 세션 비우기" })
    .click();
  await expect(page.locator("video")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 900 });
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    )
    .toBe(true);
  await page.screenshot({
    path: "data/screenshots/public-mobile.png",
    fullPage: true,
  });
});

test("offline receiver plays, displays auto captions, changes volume and revokes access without WAN", async ({
  page,
  request,
  context,
}) => {
  await context.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  const base = "http://localhost:3214";
  await page.goto(base);
  const state = await (await request.get(base + "/api/state")).json();
  expect(state.mode).toBe("offline");
  expect(state.devices).toEqual([]);
  const receiver = await context.newPage();
  await receiver.goto(base + "/tv");
  await receiver
    .getByRole("textbox", { name: "6자리 연결 번호" })
    .fill(state.pairingCode);
  await receiver.getByRole("button", { name: "연결", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await (await request.get(base + "/api/state")).json()).cast.connected,
    )
    .toBe(true);
  const uploaded = await (
    await request.post(base + "/api/upload", {
      multipart: {
        file: {
          name: "offline.mp4",
          mimeType: "video/mp4",
          buffer: await fs.readFile("data/test-fixtures/sample.mp4"),
        },
      },
    })
  ).json();
  await request.post(base + "/api/upload", {
    multipart: {
      file: {
        name: "offline.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "1\n00:00:00,000 --> 00:00:05,500\n인터넷 없는 자막",
        ),
      },
    },
  });
  const load = await request.post(base + "/api/cast/load", {
    data: { itemId: uploaded.id, currentTime: 0 },
  });
  expect(load.status(), await load.text()).toBe(200);
  await expect
    .poll(() => receiver.locator("video").evaluate((v) => v.currentTime))
    .toBeGreaterThan(0.1);
  await expect
    .poll(() =>
      receiver
        .locator("video")
        .evaluate((v) => v.textTracks[0]?.cues?.[0]?.text),
    )
    .toBe("인터넷 없는 자막");
  expect(
    (
      await request.post(base + "/api/cast/control", {
        data: { action: "volume", value: 0.36 },
      })
    ).status(),
  ).toBe(200);
  await expect
    .poll(() => receiver.locator("video").evaluate((v) => v.volume))
    .toBe(0.36);
  const tvUrl = await receiver.locator("video").getAttribute("src");
  expect((await request.post(base + "/api/privacy/clear")).status()).toBe(200);
  expect((await request.get(tvUrl)).status()).toBe(404);
  expect((await (await request.get(base + "/api/state")).json()).items).toEqual(
    [],
  );
  await receiver.close();
});
