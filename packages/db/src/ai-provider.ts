import { eq } from "drizzle-orm";
import { aiGenerationOptionsSchema, type AiChatProvider } from "@workbench/shared";
import type { Database } from "./client.js";
import { organizationAiSettings } from "./schema/core.js";
import { decryptSecret, SecretCipherError } from "./secret.js";

export interface AiDeploymentConfig {
  AI_ENABLED: boolean;
  AI_CONFIG_ENCRYPTION_KEY?: string | undefined;
  AI_API_KEY?: string | undefined;
  AI_API_BASE_URL?: string | undefined;
  AI_MODEL?: string | undefined;
  ZHIPU_API_KEY?: string | undefined;
  ZHIPU_API_BASE_URL?: string | undefined;
  ZHIPU_MODEL?: string | undefined;
  AI_REQUEST_TIMEOUT_MS: number;
  AI_MAX_RETRIES: number;
}
export interface EffectiveAiProvider extends AiChatProvider {
  source: "organization" | "deployment_default";
  configurationVersion: number;
  maxAttempts: number;
}

export function deploymentAiSettings(config: AiDeploymentConfig) {
  const generic = Boolean(config.AI_API_BASE_URL || config.AI_MODEL || config.AI_API_KEY);
  return {
    baseUrl: generic ? config.AI_API_BASE_URL : config.ZHIPU_API_BASE_URL,
    model: generic ? config.AI_MODEL : config.ZHIPU_MODEL,
    apiKey: generic ? config.AI_API_KEY : config.ZHIPU_API_KEY,
  };
}

/** Resolve the whole provider together so a changed URL never receives an old model. */
export async function resolveOrganizationAiProvider(db: Database, organizationId: string, config: AiDeploymentConfig): Promise<EffectiveAiProvider | null> {
  const [settings] = await db.select().from(organizationAiSettings).where(eq(organizationAiSettings.organizationId, organizationId)).limit(1);
  if (settings) {
    if (!settings.enabled || !settings.apiKeyCiphertext || !config.AI_CONFIG_ENCRYPTION_KEY) return null;
    try {
      const generationOptions = aiGenerationOptionsSchema.parse(settings.generationOptions);
      return {
        source: "organization",
        configurationVersion: settings.version,
        baseUrl: settings.baseUrl,
        apiKey: decryptSecret(settings.apiKeyCiphertext, config.AI_CONFIG_ENCRYPTION_KEY),
        model: settings.model,
        maxOutputTokens: settings.maxOutputTokens,
        maxAttempts: generationOptions.maxAttempts,
        generationOptions,
      };
    } catch (error) {
      if (error instanceof SecretCipherError) return null;
      throw error;
    }
  }
  const { baseUrl, model, apiKey } = deploymentAiSettings(config);
  if (!config.AI_ENABLED || !baseUrl || !model || !apiKey) return null;
  const generationOptions = aiGenerationOptionsSchema.parse({ requestTimeoutMs: config.AI_REQUEST_TIMEOUT_MS, maxAttempts: config.AI_MAX_RETRIES });
  return { source: "deployment_default", configurationVersion: 0, baseUrl, model, apiKey, maxOutputTokens: 4_096, maxAttempts: generationOptions.maxAttempts, generationOptions };
}
