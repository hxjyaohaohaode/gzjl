import { defineConfig } from "@playwright/test";
import base from "./playwright.config.js";
export default defineConfig({
  testDir: "./tests/upgrades", workers: 1, retries: 0, timeout: 180_000,
  expect: { timeout: 10_000 }, reporter: "list", outputDir: "test-results/upgrades",
  use: { ...base.projects?.[0]?.use, baseURL: "http://127.0.0.1:3100", timezoneId: "Asia/Shanghai", viewport: { width: 390, height: 844 }, hasTouch: true, actionTimeout: 15_000, navigationTimeout: 30_000, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "pnpm --filter @workbench/server exec tsx test/live-server.ts", url: "http://127.0.0.1:3100/readyz", reuseExistingServer: false, timeout: 120_000 },
});
