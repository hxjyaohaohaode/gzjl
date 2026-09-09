import { defineConfig, devices } from "@playwright/test";
import base from "./playwright.config.js";

const chromium = base.projects?.[0]?.use ?? {};
export default defineConfig({
  testDir: "./tests/live", workers: 1, retries: 0, timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: "list", outputDir: "test-results/live",
  use: { ...chromium, baseURL: "http://127.0.0.1:3100", timezoneId: "Asia/Shanghai", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop-1440", use: { viewport: { width: 1440, height: 900 } } },
    { name: "desktop-1920", use: { viewport: { width: 1920, height: 1080 } } },
    { name: "mobile-360", use: { ...chromium, ...devices["Pixel 7"], viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true } },
    { name: "mobile-390", use: { ...chromium, ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: "tablet-768", use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  ],
  webServer: { command: "pnpm --filter @workbench/server exec tsx test/live-server.ts", url: "http://127.0.0.1:3100/readyz", reuseExistingServer: false, timeout: 120_000 },
});
