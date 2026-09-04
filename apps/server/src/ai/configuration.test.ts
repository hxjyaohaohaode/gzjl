import { describe, expect, it } from "vitest";

import {
  AiConfigurationError,
  normalizeAiBaseUrl,
  safeAiProviderError,
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

describe("AI provider error redaction", () => {
  it("keeps a safe HTTP status for diagnosis", () => {
    expect(safeAiProviderError(new Error("AI provider returned HTTP 401"))).toBe(
      "供应商返回 HTTP 401",
    );
  });

  it("does not persist network error details or upstream URLs", () => {
    const message = safeAiProviderError(
      new Error("connect failed https://secret:token@internal.example/v1"),
    );
    expect(message).toBe("无法连接 AI 供应商，请检查地址、密钥、模型和供应商状态。");
    expect(message).not.toContain("token");
    expect(message).not.toContain("internal.example");
  });

  it("turns aborts into a clear timeout message", () => {
    expect(safeAiProviderError(new DOMException("aborted", "AbortError"))).toContain(
      "连接超时",
    );
  });
});
