import { describe, expect, it } from "vitest";

import {
  AiConfigurationError,
  normalizeAiBaseUrl,
} from "./configuration.js";

describe("organization AI base URL validation", () => {
  it("accepts a public OpenAI-compatible provider path", () => {
    expect(
      normalizeAiBaseUrl(
        "https://open.bigmodel.cn/api/paas/v4/",
        "production",
      ),
    ).toBe("https://open.bigmodel.cn/api/paas/v4");
  });

  it.each([
    "http://open.bigmodel.cn/api/paas/v4",
    "https://localhost:3000/v1",
    "https://127.0.0.1/v1",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/v1",
    "https://[::1]/v1",
    "https://[fc00::1]/v1",
    "https://api.internal/v1",
    "https://key:secret@provider.example/v1",
  ])("rejects an unsafe production target: %s", (value) => {
    expect(() => normalizeAiBaseUrl(value, "production")).toThrow(
      AiConfigurationError,
    );
  });
});
