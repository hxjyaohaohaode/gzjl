import { defineConfig, devices } from "@playwright/test";
import live from "./playwright.live.config.js";

// Start another isolated runtime so the seven browser configurations do not
// deliberately exhaust the real login rate limit of the same localhost IP.
export default defineConfig({
  ...live,
  outputDir: "test-results/engines",
  use: { baseURL: "http://127.0.0.1:3100", timezoneId: "Asia/Shanghai", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "firefox-desktop", use: { ...devices["Desktop Firefox"], browserName: "firefox", viewport: { width: 1440, height: 900 } } },
    { name: "webkit-mobile", use: { ...devices["iPhone 13"], browserName: "webkit" } },
  ],
});
