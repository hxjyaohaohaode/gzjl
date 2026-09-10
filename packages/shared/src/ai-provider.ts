import { z } from "zod";

export const maximumAiRequestTimeoutMs = 300_000;
export const aiGenerationOptionsSchema = z.object({
  requestTimeoutMs: z.number().int().min(5_000).max(maximumAiRequestTimeoutMs).default(60_000),
  maxAttempts: z.number().int().min(1).max(5).default(2),
  temperature: z.number().min(0).max(2).nullable().default(null),
  topP: z.number().min(0).max(1).nullable().default(null),
  tokenLimitParameter: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  responseFormat: z.enum(["text", "json_object"]).default("text"),
});
export type AiGenerationOptions = z.infer<typeof aiGenerationOptionsSchema>;
export interface AiChatProvider {
  baseUrl: string;
  model: string;
  apiKey: string;
  maxOutputTokens: number;
  generationOptions: AiGenerationOptions;
}

export class AiProviderResponseError extends Error {
  constructor(message: string, readonly httpStatus: number | null = null, readonly retryable = false) {
    super(message);
    this.name = "AiProviderResponseError";
  }
}

export function aiChatEndpoint(baseUrl: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "")}/chat/completions`;
}

export function buildAiChatBody(provider: AiChatProvider, messages: Array<{ role: "system" | "user"; content: string }>) {
  const options = provider.generationOptions;
  return {
    model: provider.model,
    messages,
    stream: false,
    [options.tokenLimitParameter]: provider.maxOutputTokens,
    ...(options.temperature === null ? {} : { temperature: options.temperature }),
    ...(options.topP === null ? {} : { top_p: options.topP }),
    ...(options.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
  };
}

const completionSchema = z.object({
  id: z.string().nullish(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable().optional(),
    message: z.object({ content: z.union([
      z.string(),
      z.array(z.object({ type: z.string(), text: z.string().optional() })),
    ]).nullable().optional() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().nullish(),
    completion_tokens: z.number().int().nonnegative().nullish(),
  }).nullish(),
});

/** Shared by the health check and Worker; timeout covers the response body too. */
export async function requestAiChatCompletion(
  provider: AiChatProvider,
  messages: Array<{ role: "system" | "user"; content: string }>,
  providerFetch: typeof fetch = fetch,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), provider.generationOptions.requestTimeoutMs);
  try {
    const response = await providerFetch(aiChatEndpoint(provider.baseUrl), {
      method: "POST",
      redirect: "error",
      headers: { authorization: `Bearer ${provider.apiKey}`, "content-type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(buildAiChatBody(provider, messages)),
    });
    if (!response.ok) {
      const status = response.status;
      await response.body?.cancel();
      const hint = status === 401 || status === 403 ? "，请检查 API Key 与模型权限。"
        : status === 404 ? "，请检查 Base URL 和模型标识。"
          : status === 400 || status === 422 ? "，请检查模型支持的 Token 参数、温度和响应格式。"
            : status === 429 ? "，供应商额度不足或请求过于频繁。" : "。";
      throw new AiProviderResponseError(`供应商返回 HTTP ${status}${hint}`, status, status === 408 || status === 429 || status >= 500);
    }
    const parsed = completionSchema.safeParse(await response.json());
    if (!parsed.success) throw new AiProviderResponseError("供应商响应格式不兼容。", response.status);
    const payload = parsed.data;
    const choice = payload.choices[0]!;
    if (choice.finish_reason === "length") throw new AiProviderResponseError("输出已达到 Token 上限，请提高最大输出 Token 后重试。", response.status);
    const raw = choice.message.content;
    const content = typeof raw === "string" ? raw : raw?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("");
    if (!content?.trim()) throw new AiProviderResponseError("供应商未返回可用内容，请检查模型和输出 Token 配置。", response.status);
    return { content, id: payload.id?.slice(0, 255), usage: payload.usage, httpStatus: response.status };
  } catch (error) {
    if (controller.signal.aborted) throw new AiProviderResponseError("连接超时，请检查 Base URL、网络或提高请求超时。", null, true);
    if (error instanceof AiProviderResponseError) throw error;
    if (error instanceof SyntaxError) throw new AiProviderResponseError("供应商返回了无法解析的 JSON 响应。");
    throw new AiProviderResponseError("无法连接 AI 供应商，请检查地址、网络和供应商状态。", null, true);
  } finally {
    clearTimeout(timeout);
  }
}
