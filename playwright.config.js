import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/ui",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://localhost:3212",
    channel: "msedge",
    headless: true,
    screenshot: "only-on-failure",
  },
  globalSetup: "./tests/ui/global-setup.js",
  reporter: "list",
});
