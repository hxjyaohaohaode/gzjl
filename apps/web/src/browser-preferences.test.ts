/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from "vitest";
import { readPreference, writePreference } from "./browser-preferences.js";
afterEach(() => vi.restoreAllMocks());
it("keeps preferences optional when privacy settings deny storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new DOMException("denied", "SecurityError"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("full", "QuotaExceededError"); });
  expect(readPreference("theme")).toBeNull();
  expect(() => writePreference("theme", "dark")).not.toThrow();
});
it("persists and restores an allowed browser preference", () => {
  writePreference("test-theme", "dark");
  expect(readPreference("test-theme")).toBe("dark");
  localStorage.removeItem("test-theme");
});
