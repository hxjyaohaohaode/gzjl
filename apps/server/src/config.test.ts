import { describe, expect, it } from "vitest";

import { loadServerConfig } from "./config.js";

const productionEnvironment = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://workbench:workbench@example.test:5432/workbench",
  SESSION_SECRET: "a".repeat(32),
  WEB_ORIGIN: "https://app.example.test",
  PUBLIC_APP_URL: "https://app.example.test",
  ZHIPU_API_BASE_URL: "https://provider.example.test/v1",
};

describe("production public URLs", () => {
  it("uses the server-package-relative PWA build directory by default", () => {
    expect(loadServerConfig(productionEnvironment).WEB_DIST_DIR).toBe("../web/dist");
  });

  it("gives a contact verification link a bounded one-day lifetime by default", () => {
    expect(
      loadServerConfig(productionEnvironment).CREDENTIAL_VERIFICATION_TTL_SECONDS,
    ).toBe(86_400);
  });

  it("uses a bounded signed-upload capability lifetime by default", () => {
    expect(loadServerConfig(productionEnvironment).SIGNED_URL_TTL_SECONDS).toBe(
      900,
    );
  });

  it("accepts matching HTTPS browser URLs", () => {
    expect(loadServerConfig(productionEnvironment).PUBLIC_APP_URL).toBe(
      "https://app.example.test",
    );
  });

  it("rejects HTTP, credential-bearing, and mismatched public URLs", () => {
    expect(() =>
      loadServerConfig({ ...productionEnvironment, WEB_ORIGIN: "http://app.example.test" }),
    ).toThrow();
    expect(() =>
      loadServerConfig({
        ...productionEnvironment,
        PUBLIC_APP_URL: "https://other.example.test",
      }),
    ).toThrow();
    expect(() =>
      loadServerConfig({
        ...productionEnvironment,
        ZHIPU_API_BASE_URL: "https://key:secret@provider.example.test/v1",
      }),
    ).toThrow();
    expect(() =>
      loadServerConfig({
        ...productionEnvironment,
        S3_BROWSER_ORIGIN: "https://storage.example.test/private-bucket",
      }),
    ).toThrow();
  });
});
