import { defineConfig, devices } from "@playwright/test";
import { existsSync } from "node:fs";
import { join } from "node:path";

// Calendar fixtures are intentionally created relative to "today". Fix both
// the Playwright worker and browser context to the same organization timezone
// so a GitHub UTC runner cannot turn a cross-midnight fixture into a different
// local calendar date than a developer machine in Shanghai.
const e2eTimezone = "Asia/Shanghai";
process.env.TZ = e2eTimezone;

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
  // Two workers keep the local API/Vite pair stable while still exercising concurrency;
  // the previous four-worker default could terminate the Vite process mid-suite.
  // GitHub's shared runner can become CPU-bound when two Chromium contexts
  // render the chart-heavy desktop and mobile workspaces at the same time.
  // That produced unrelated navigation timeouts across otherwise stable
  // features. Serialize CI browsers for a deterministic deployment gate while
  // retaining two workers on a developer machine.
  workers: process.env.CI ? 1 : 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: process.env.CI ? 45_000 : 30_000,
  expect: {
    timeout: process.env.CI ? 10_000 : 5_000,
  },
  use: {
    baseURL: "http://127.0.0.1:5173",
    timezoneId: e2eTimezone,
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
