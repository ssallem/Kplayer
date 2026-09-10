import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";

const publicUrl = "https://ssallem.github.io/Kplayer/";
async function servePublic(context) {
  await context.route("https://ssallem.github.io/Kplayer/**", async (route) => {
    const relative =
      new URL(route.request().url()).pathname.replace("/Kplayer/", "") ||
      "index.html";
    const target = path.resolve("site-dist", relative);
    if (!target.startsWith(path.resolve("site-dist") + path.sep))
      return route.abort();
    let body = await fs.readFile(target);
    if (relative.endsWith(".js"))
      body = Buffer.from(
        body
          .toString()
          .replaceAll("http://localhost:3210", "http://localhost:3212"),
      );
    await route.fulfill({
      body,
      contentType: relative.endsWith(".js")
        ? "application/javascript"
        : relative.endsWith(".css")
          ? "text/css"
          : relative.endsWith(".woff2")
            ? "font/woff2"
            : "text/html",
    });
  });
}
test("public HTTPS page connects via popup, transfers only selected files and controls Cast", async ({
  page,
  context,
  request,
}) => {
  await request.post("/api/privacy/clear");
  const unrelated = await (
    await request.post("/api/upload", {
      multipart: {
        file: {
          name: "private-other-session.mp4",
          mimeType: "video/mp4",
          buffer: Buffer.from("unrelated"),
        },
      },
    })
  ).json();
  await servePublic(context);
  const errors = [],
    uploads = [],
    commands = [];
  context.on("page", (popup) =>
    popup.on("pageerror", (e) => errors.push(e.message)),
  );
  page.on("pageerror", (e) => errors.push(e.message));
  context.on("request", (req) => {
    if (req.url().endsWith("/api/upload")) uploads.push(req.url());
  });
  // The bridge/API/file transfer is real; only TV hardware responses are simulated.
  const device = {
    id: "test",
    name: "테스트 TV",
    model: "Google Cast",
    address: "192.168.1.20",
  };
  let cast = { connected: false },
    loaded;
  await context.route("http://localhost:3212/api/state", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ json: { ...body, devices: [device], cast } });
  });
  await context.route("http://localhost:3212/api/cast/**", async (route) => {
    const body = route.request().postDataJSON();
    if (route.request().url().endsWith("connect"))
      cast = { connected: true, device, volume: 0.7, playerState: "IDLE" };
    else if (route.request().url().endsWith("load")) {
      loaded = body;
      cast = {
        ...cast,
        itemId: body.itemId,
        subtitleId: body.subtitleId,
        currentTime: body.currentTime,
        playerState: body.autoplay ? "PLAYING" : "PAUSED",
      };
    } else {
      commands.push(body);
      if (body.action === "volume") cast.volume = body.value;
      if (body.action === "pause") cast.playerState = "PAUSED";
      if (body.action === "play") cast.playerState = "PLAYING";
      if (body.action === "disconnect") cast = { connected: false };
    }
    await route.fulfill({ json: cast });
  });
  await page.goto(publicUrl);
  await page.evaluate(() =>
    window.addEventListener("message", (event) => {
      if (event.data?.type === "kplayer-connected")
        window.testPort = event.ports[0];
    }),
  );
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles([
      {
        name: "bridge.mp4",
        mimeType: "video/mp4",
        buffer: await fs.readFile("data/test-fixtures/sample.mp4"),
      },
      {
        name: "bridge.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "1\n00:00:00,000 --> 00:00:05,000\n웹에서 TV로 자동 자막",
        ),
      },
      {
        name: "unrelated.srt",
        mimeType: "text/plain",
        buffer: Buffer.from(
          "1\n00:00:00,000 --> 00:00:05,000\n보내지 않을 자막",
        ),
      },
    ]);
  await expect(page.getByText("자막 연결됨", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Chromecast 연결", exact: true }),
  ).toBeEnabled();
  expect(uploads).toEqual([]);
  const popupPromise = page.waitForEvent("popup");
  await page
    .getByRole("button", { name: "Chromecast 연결", exact: true })
    .click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("button", { name: "웹 플레이어 연결", exact: true }),
  ).toBeEnabled();
  expect(uploads).toEqual([]);
  await popup
    .getByRole("button", { name: "웹 플레이어 연결", exact: true })
    .click();
  const bridgeRequest = (action, body) =>
    page.evaluate(
      ({ action, body }) =>
        new Promise((resolve) => {
          const id = crypto.randomUUID();
          const listener = ({ data }) => {
            if (data.id === id) {
              window.testPort.removeEventListener("message", listener);
              resolve(data);
            }
          };
          window.testPort.addEventListener("message", listener);
          window.testPort.postMessage({ id, action, body });
        }),
      { action, body },
    );
  const dialog = page.getByRole("dialog", { name: "TV 연결" });
  await expect(dialog.getByRole("button", { name: /테스트 TV/ })).toBeEnabled();
  expect((await bridgeRequest("state")).result.items).toEqual([]);
  expect((await bridgeRequest("open-local", {})).error).toContain(
    "허용되지 않은",
  );
  expect(
    (await bridgeRequest("load", { itemId: unrelated.id })).error,
  ).toContain("이 웹 화면에서 선택한 파일만");
  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.screenshot({
    path: "data/screenshots/web-tv-dialog.png",
    fullPage: true,
  });
  await dialog.getByRole("button", { name: /테스트 TV/ }).click();
  await expect(
    page.getByText("테스트 TV에서 재생 중", { exact: true }),
  ).toBeVisible();
  expect(uploads).toHaveLength(2);
  expect(uploads.every((url) => url.startsWith("http://localhost:3212/"))).toBe(
    true,
  );
  const state = await (await request.get("/api/state")).json();
  expect(
    (await bridgeRequest("state")).result.items.map((i) => i.name).sort(),
  ).toEqual(["bridge.mp4", "bridge.srt"]);
  expect(loaded.subtitleId).toBe(
    state.items.find((i) => i.kind === "subtitle").id,
  );
  const sub = await request.get(
    state.items.find((i) => i.kind === "subtitle").url,
  );
  expect(await sub.text()).toContain("웹에서 TV로 자동 자막");
  const mediaUrl = state.items.find((i) => i.id === loaded.itemId).url;
  expect(
    (
      await request.get(mediaUrl, { headers: { Range: "bytes=0-31" } })
    ).status(),
  ).toBe(206);
  await page.getByRole("button", { name: "음량 1% 줄이기" }).click();
  await expect.poll(() => cast.volume).toBe(0.69);
  await page.getByRole("button", { name: "TV 재생 전환" }).click();
  await expect.poll(() => cast.playerState).toBe("PAUSED");
  await page.getByRole("button", { name: "자막 표시 전환" }).click();
  await expect
    .poll(() =>
      commands.some((c) => c.action === "subtitles" && c.value === false),
    )
    .toBe(true);
  await page.getByRole("button", { name: "프라이버시", exact: true }).click();
  await page
    .getByRole("button", { name: "재생 종료·이번 세션 비우기" })
    .click();
  await expect(page.locator("video")).toHaveCount(0);
  expect((await (await request.get("/api/state")).json()).items).toEqual([]);
  expect((await request.get(mediaUrl)).status()).toBe(404);
  expect(errors).toEqual([]);
  await popup.close();
});

test("untrusted opener cannot authorize the bridge and direct cross-origin APIs remain blocked", async ({
  page,
  request,
}) => {
  await page.route("https://untrusted.example/", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<button id="open">Open</button><script>const nonce=crypto.randomUUID();let popup;document.querySelector("button").onclick=()=>{popup=window.open("http://localhost:3212/web-bridge#"+nonce);setInterval(()=>popup.postMessage({type:"kplayer-hello",nonce},"http://localhost:3212"),100)};</script>',
    }),
  );
  await page.goto("https://untrusted.example/");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open" }).click();
  const popup = await popupPromise;
  await expect(
    popup.getByRole("button", { name: "웹 플레이어 연결", exact: true }),
  ).toBeDisabled();
  await expect(popup.getByRole("status")).toContainText("기다리고");
  expect(
    (
      await request.post("/api/privacy/clear", {
        headers: { Origin: "https://ssallem.github.io" },
      })
    ).status(),
  ).toBe(403);
  const response = await request.get("/web-bridge");
  expect(response.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers()["cache-control"]).toBe("no-store");
  await popup.close();
});
