import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// CI always installs the Playwright-pinned browser. On a Windows developer machine,
// an already-installed Playwright Chromium is a safe fallback when a CDN is blocked.
const localChromium = process.env.CI || !process.env.LOCALAPPDATA
  ? undefined
  : ["chromium-1234", "chromium-1228", "chromium-1208"]
    .map((revision) => join(process.env.LOCALAPPDATA!, "ms-playwright", revision, "chrome-win64", "chrome.exe"))
    .find((candidate) => existsSync(candidate));
const localLaunch = localChromium
  ? { browserName: "chromium" as const, channel: undefined, launchOptions: { executablePath: localChromium } }
  : {};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  // Dynamic chart modules are intentionally exercised in both viewports. Keep
  // local fallback Chromium from saturating a Windows development machine.
  workers: process.env.CI ? 2 : 4,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...localLaunch } },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"], ...localLaunch } },
  ],
  webServer: {
    command: "pnpm --filter @workbench/web dev",
    url: "http://127.0.0.1:5173",
    // A stale Vite process can disappear midway through a parallel run. Reuse
    // only when a developer explicitly opts in, not as the default test path.
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "true",
    timeout: 120_000,
  },
});
