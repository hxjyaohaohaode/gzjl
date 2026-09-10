import { describe, expect, it } from "vitest";
import { deploymentAiSettings } from "./ai-provider.js";

const config = { AI_ENABLED: false, AI_REQUEST_TIMEOUT_MS: 60000, AI_MAX_RETRIES: 2 };
describe("deployment provider configuration", () => {
  it("does not invent a provider or model for a fresh installation", () => {
    expect(deploymentAiSettings(config)).toEqual({ baseUrl: undefined, model: undefined, apiKey: undefined });
  });
  it("preserves explicitly configured legacy providers without mixing credentials into a new endpoint", () => {
    const legacy = { ...config, ZHIPU_API_BASE_URL: "https://legacy.example/v1", ZHIPU_MODEL: "legacy-model", ZHIPU_API_KEY: "legacy-key" };
    expect(deploymentAiSettings(legacy)).toEqual({ baseUrl: legacy.ZHIPU_API_BASE_URL, model: "legacy-model", apiKey: "legacy-key" });
    expect(deploymentAiSettings({ ...legacy, AI_API_BASE_URL: "https://new.example/v1" })).toEqual({ baseUrl: "https://new.example/v1", model: undefined, apiKey: undefined });
    expect(deploymentAiSettings({ ...legacy, AI_API_BASE_URL: "https://new.example/v1", AI_MODEL: "new-model", AI_API_KEY: "new-key" })).toEqual({ baseUrl: "https://new.example/v1", model: "new-model", apiKey: "new-key" });
  });
});
