import { afterEach, describe, expect, it, vi } from "vitest";
import { aiChatEndpoint, aiGenerationOptionsSchema, AiProviderResponseError, buildAiChatBody, requestAiChatCompletion, type AiChatProvider } from "./ai-provider.js";

const provider: AiChatProvider = {
  baseUrl: "https://provider.example/v1", apiKey: "test-secret", model: "vendor/model:free", maxOutputTokens: 4096,
  generationOptions: aiGenerationOptionsSchema.parse({}),
};
const messages = [{ role: "user" as const, content: "Only reply OK" }];
afterEach(() => vi.useRealTimers());

describe("configurable OpenAI-compatible transport", () => {
  it("normalizes base URLs and pasted completion endpoints without duplicating paths", () => {
    for (const url of ["https://provider.example/v1", "https://provider.example/v1/", "https://provider.example/v1/chat/completions/"]) {
      expect(aiChatEndpoint(url)).toBe("https://provider.example/v1/chat/completions");
    }
  });
  it("omits optional parameters for providers that reject sampling overrides", () => {
    expect(buildAiChatBody(provider, messages)).toEqual({ model: "vendor/model:free", messages, stream: false, max_tokens: 4096 });
  });
  it("honors explicit zero sampling values, the selected token dialect and JSON mode", () => {
    expect(buildAiChatBody({ ...provider, generationOptions: aiGenerationOptionsSchema.parse({ temperature: 0, topP: 0.9, tokenLimitParameter: "max_completion_tokens", responseFormat: "json_object" }) }, messages)).toEqual({ model: provider.model, messages, stream: false, max_completion_tokens: 4096, temperature: 0, top_p: 0.9, response_format: { type: "json_object" } });
  });
  it("uses the saved endpoint and credentials and accepts text content parts", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: [{ type: "text", text: "OK" }] } }], id: "test-id", usage: { prompt_tokens: 1, completion_tokens: 1 } }))) as typeof fetch;
    await expect(requestAiChatCompletion(provider, messages, fetcher)).resolves.toMatchObject({ content: "OK", id: "test-id", httpStatus: 200 });
    expect(fetcher).toHaveBeenCalledWith("https://provider.example/v1/chat/completions", expect.objectContaining({ redirect: "error", headers: { authorization: "Bearer test-secret", "content-type": "application/json" } }));
  });
  it.each([[401, false], [404, false], [422, false], [429, true], [503, true]])("classifies HTTP %s without leaking provider response bodies", async (status, retryable) => {
    const fetcher = vi.fn(async () => new Response("secret=upstream-key", { status })) as typeof fetch;
    const error = await requestAiChatCompletion(provider, messages, fetcher).catch((error: unknown) => error);
    expect(error).toMatchObject({ httpStatus: status, retryable });
    expect(String(error)).not.toContain("upstream-key");
  });
  it("times out even when headers arrived but response text is stalled", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async (_url, init) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))) })) as unknown as typeof fetch;
    const result = requestAiChatCompletion({ ...provider, generationOptions: { ...provider.generationOptions, requestTimeoutMs: 5000 } }, messages, fetcher).catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(5001);
    expect(await result).toMatchObject({ retryable: true, message: expect.stringContaining("超时") });
    expect(vi.getTimerCount()).toBe(0);
  });
  it("identifies truncated responses as an actionable token configuration error", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "partial JSON" } }] }))) as typeof fetch;
    await expect(requestAiChatCompletion(provider, messages, fetcher)).rejects.toMatchObject({ retryable: false, message: expect.stringContaining("Token 上限") });
  });
  it("accepts a usable answer when compatible gateways omit request metadata", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: null, usage: null, choices: [{ message: { content: "OK" } }] }))) as typeof fetch;
    await expect(requestAiChatCompletion(provider, messages, fetcher)).resolves.toMatchObject({ content: "OK" });
  });
  it("rejects malformed provider payloads without exposing parser input", async () => {
    const fetcher = vi.fn(async () => new Response("<html>secret-provider-key</html>")) as typeof fetch;
    await expect(requestAiChatCompletion(provider, messages, fetcher)).rejects.toBeInstanceOf(AiProviderResponseError);
  });
});
