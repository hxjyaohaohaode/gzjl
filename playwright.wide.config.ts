import { defineConfig } from "@playwright/test";
import live from "./playwright.live.config.js";

// Every flow signs in two accounts. Keep each isolated server at five flows
// or fewer so coverage never disables or exhausts the real 10/15min IP limit.
export default defineConfig({
  ...live,
  outputDir: "test-results/wide",
  projects: [
    { name: "desktop-2560", use: { viewport: { width: 2560, height: 1440 } } },
    { name: "desktop-3840", use: { viewport: { width: 3840, height: 2160 } } },
  ],
});
