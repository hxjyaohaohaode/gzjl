import { defineConfig } from "@playwright/test";
import upgrades from "./playwright.upgrades.config.js";

// Each acceptance matrix has a fresh database and real auth rate-limit state.
// The lifecycle matrix deliberately exhausts anonymous login requests.
export default defineConfig({ ...upgrades, testDir: "./tests/payroll", outputDir: "test-results/payroll" });
