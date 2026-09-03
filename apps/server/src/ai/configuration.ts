import { isIP } from "node:net";

import { and, count, eq, gte } from "drizzle-orm";
import {
  decryptSecret,
  encryptSecret,
  SecretCipherError,
  type Database,
} from "@workbench/db";
import {
  aiJobs,
  auditLogs,
  organizationAiSettings,
  organizationOwners,
  organizations,
} from "@workbench/db/schema";

import type { ServerConfig } from "../config.js";

const defaultDailyRequestLimit = 20;
const defaultMonthlyRequestLimit = 300;
const defaultMaxOutputTokens = 1_200;

export interface OrganizationAiActor {
  organizationId: string;
  membershipId: string;
}

export interface EffectiveAiProvider {
  source: "organization" | "deployment_default";
  baseUrl: string;
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  maxAttempts: number;
}

export interface UpdateOrganizationAiSettingsInput {
  enabled: boolean;
  baseUrl: string;
  model: string;
  dailyRequestLimit: number;
  monthlyRequestLimit: number;
  maxOutputTokens: number;
  apiKey?: string | undefined;
  clearApiKey?: boolean | undefined;
}

type QueryExecutor = Pick<Database, "select">;

export class AiConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiConfigurationError";
  }
}

export class AiConfigurationForbiddenError extends Error {
  constructor() {
    super("只有当前唯一 Owner 可以查看或修改组织级 AI 配置。");
    this.name = "AiConfigurationForbiddenError";
  }
}

export class AiQuotaExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiQuotaExceededError";
  }
}

function isBlockedIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  const [first, second] = octets;
  if (first === undefined || second === undefined || octets.length !== 4)
    return true;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19))
  );
}

function isBlockedIpv6(address: string): boolean {
  const normalized = address.toLocaleLowerCase("en-US");
  if (normalized === "::" || normalized === "::1") return true;
  // Reject mapped addresses as well. A public IPv4 endpoint can use its
  // ordinary form; this closes the common ::ffff:127.0.0.1 bypass.
  if (normalized.startsWith("::ffff:")) return true;
  const firstHextet = normalized.split(":").find(Boolean);
  if (!firstHextet) return true;
  const first = Number.parseInt(firstHextet, 16);
  if (!Number.isFinite(first)) return true;
  return (
    (first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
    (first & 0xffc0) === 0xfe80 || // fe80::/10 link local
    (first & 0xff00) === 0xff00 // ff00::/8 multicast/reserved
  );
}

/**
 * Validates an owner-supplied OpenAI-compatible base URL before it can become
 * a server-side fetch target. It intentionally accepts public providers and
 * normal API path prefixes, but not local, private or credential-bearing URLs.
 */
export function normalizeAiBaseUrl(
  value: string,
  nodeEnv: ServerConfig["NODE_ENV"],
): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new AiConfigurationError("AI Base URL 格式不正确。");
  }
  if (
    url.protocol !== "https:" &&
    !(nodeEnv !== "production" && url.protocol === "http:")
  ) {
    throw new AiConfigurationError("生产环境的 AI Base URL 必须使用 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new AiConfigurationError("AI Base URL 不能包含账号、查询参数或片段。");
  }
  const hostname = url.hostname.toLocaleLowerCase("en-US");
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  const addressFamily = isIP(bareHost);
  const isBlockedAddress =
    (addressFamily === 4 && isBlockedIpv4(bareHost)) ||
    (addressFamily === 6 && isBlockedIpv6(bareHost));
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".home.arpa") ||
    isBlockedAddress
  ) {
    throw new AiConfigurationError(
      "AI Base URL 不能指向本机、保留地址或私有网络地址。",
    );
  }
  return url.toString().replace(/\/$/, "");
}

function localBoundary(timezone: string, kind: "day" | "month"): Date {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = read("year");
  const month = read("month");
  const day = kind === "day" ? read("day") : 1;
  const midnightAsUtc = new Date(Date.UTC(year, month - 1, day));
  const offsetParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(midnightAsUtc);
  const readOffset = (type: Intl.DateTimeFormatPartTypes) =>
    Number(offsetParts.find((part) => part.type === type)?.value ?? 0);
  const localAsUtc = Date.UTC(
    readOffset("year"),
    readOffset("month") - 1,
    readOffset("day"),
    readOffset("hour"),
    readOffset("minute"),
    readOffset("second"),
  );
  return new Date(midnightAsUtc.getTime() - (localAsUtc - midnightAsUtc.getTime()));
}

export class AiConfigurationService {
  constructor(
    private readonly db: Database,
    private readonly config: ServerConfig,
  ) {}

  async assertOwner(actor: OrganizationAiActor): Promise<void> {
    const [owner] = await this.db
      .select({ membershipId: organizationOwners.membershipId })
      .from(organizationOwners)
      .where(
        and(
          eq(organizationOwners.organizationId, actor.organizationId),
          eq(organizationOwners.membershipId, actor.membershipId),
        ),
      )
      .limit(1);
    if (!owner) throw new AiConfigurationForbiddenError();
  }

  async resolveEffective(
    organizationId: string,
  ): Promise<EffectiveAiProvider | null> {
    const [settings] = await this.db
      .select()
      .from(organizationAiSettings)
      .where(eq(organizationAiSettings.organizationId, organizationId))
      .limit(1);
    if (settings) {
      if (!settings.enabled || !settings.apiKeyCiphertext) return null;
      if (!this.config.AI_CONFIG_ENCRYPTION_KEY) return null;
      try {
        return {
          source: "organization",
          baseUrl: settings.baseUrl,
          apiKey: decryptSecret(
            settings.apiKeyCiphertext,
            this.config.AI_CONFIG_ENCRYPTION_KEY,
          ),
          model: settings.model,
          maxOutputTokens: settings.maxOutputTokens,
          maxAttempts: this.config.AI_MAX_RETRIES,
        };
      } catch (error) {
        if (error instanceof SecretCipherError) return null;
        throw error;
      }
    }
    if (!this.config.AI_ENABLED || !this.config.ZHIPU_API_KEY) return null;
    return {
      source: "deployment_default",
      baseUrl: this.config.ZHIPU_API_BASE_URL.replace(/\/$/, ""),
      apiKey: this.config.ZHIPU_API_KEY,
      model: this.config.ZHIPU_MODEL,
      maxOutputTokens: defaultMaxOutputTokens,
      maxAttempts: this.config.AI_MAX_RETRIES,
    };
  }

  async getSettings(actor: OrganizationAiActor) {
    await this.assertOwner(actor);
    const [[settings], [organization]] = await Promise.all([
      this.db
        .select()
        .from(organizationAiSettings)
        .where(eq(organizationAiSettings.organizationId, actor.organizationId))
        .limit(1),
      this.db
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, actor.organizationId))
        .limit(1),
    ]);
    const timezone = organization?.timezone ?? "Asia/Shanghai";
    const [daily, monthly] = await Promise.all([
      this.countRequests(actor.organizationId, localBoundary(timezone, "day")),
      this.countRequests(actor.organizationId, localBoundary(timezone, "month")),
    ]);
    const effective = await this.resolveEffective(actor.organizationId);
    return {
      source: settings ? "organization" : "deployment_default",
      enabled: settings ? settings.enabled : this.config.AI_ENABLED,
      baseUrl: settings?.baseUrl ?? this.config.ZHIPU_API_BASE_URL,
      model: settings?.model ?? this.config.ZHIPU_MODEL,
      hasApiKey: Boolean(settings?.apiKeyCiphertext || this.config.ZHIPU_API_KEY),
      encryptionReady: Boolean(this.config.AI_CONFIG_ENCRYPTION_KEY),
      usable: Boolean(effective),
      dailyRequestLimit:
        settings?.dailyRequestLimit ?? defaultDailyRequestLimit,
      monthlyRequestLimit:
        settings?.monthlyRequestLimit ?? defaultMonthlyRequestLimit,
      maxOutputTokens: settings?.maxOutputTokens ?? defaultMaxOutputTokens,
      usage: { daily, monthly, timezone },
    };
  }

  async updateSettings(
    actor: OrganizationAiActor,
    input: UpdateOrganizationAiSettingsInput,
  ) {
    await this.assertOwner(actor);
    if (input.monthlyRequestLimit < input.dailyRequestLimit) {
      throw new AiConfigurationError("月度请求上限不能低于每日请求上限。");
    }
    const baseUrl = normalizeAiBaseUrl(input.baseUrl, this.config.NODE_ENV);
    const model = input.model.trim();
    if (!/^[A-Za-z0-9._:-]{1,160}$/.test(model)) {
      throw new AiConfigurationError("模型标识只能包含字母、数字、点、下划线、连字符或冒号。");
    }
    const apiKey = input.apiKey?.trim();
    if (apiKey && !this.config.AI_CONFIG_ENCRYPTION_KEY) {
      throw new AiConfigurationError(
        "服务端尚未配置 AI_CONFIG_ENCRYPTION_KEY，不能安全保存组织 API Key。",
      );
    }
    const now = new Date();
    await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(organizationAiSettings)
        .where(eq(organizationAiSettings.organizationId, actor.organizationId))
        .for("update")
        .limit(1);
      const apiKeyCiphertext = input.clearApiKey
        ? null
        : apiKey
          ? encryptSecret(apiKey, this.config.AI_CONFIG_ENCRYPTION_KEY!)
          : current?.apiKeyCiphertext ?? null;
      if (input.enabled && !apiKeyCiphertext) {
        throw new AiConfigurationError(
          "启用组织级 AI 前必须填写 API Key；密钥只会加密保存，之后无法再次读取。",
        );
      }
      const next = {
        enabled: input.enabled,
        baseUrl,
        model,
        apiKeyCiphertext,
        dailyRequestLimit: input.dailyRequestLimit,
        monthlyRequestLimit: input.monthlyRequestLimit,
        maxOutputTokens: input.maxOutputTokens,
        updatedAt: now,
      };
      if (current) {
        await tx
          .update(organizationAiSettings)
          .set({ ...next, version: current.version + 1 })
          .where(eq(organizationAiSettings.organizationId, actor.organizationId));
      } else {
        await tx.insert(organizationAiSettings).values({
          organizationId: actor.organizationId,
          ...next,
        });
      }
      await tx.insert(auditLogs).values({
        organizationId: actor.organizationId,
        actorMembershipId: actor.membershipId,
        action: "organization.ai_settings_updated",
        entityType: "organization",
        entityId: actor.organizationId,
        after: {
          enabled: input.enabled,
          baseUrl,
          model,
          hasApiKey: Boolean(apiKeyCiphertext),
          dailyRequestLimit: input.dailyRequestLimit,
          monthlyRequestLimit: input.monthlyRequestLimit,
          maxOutputTokens: input.maxOutputTokens,
        },
      });
    });
    return this.getSettings(actor);
  }

  async assertQuota(
    organizationId: string,
    executor: QueryExecutor = this.db,
  ): Promise<void> {
    const [[settings], [organization]] = await Promise.all([
      executor
        .select()
        .from(organizationAiSettings)
        .where(eq(organizationAiSettings.organizationId, organizationId))
        .limit(1),
      executor
        .select({ timezone: organizations.timezone })
        .from(organizations)
        .where(eq(organizations.id, organizationId))
        .limit(1),
    ]);
    const timezone = organization?.timezone ?? "Asia/Shanghai";
    const dailyLimit = settings?.dailyRequestLimit ?? defaultDailyRequestLimit;
    const monthlyLimit = settings?.monthlyRequestLimit ?? defaultMonthlyRequestLimit;
    const [daily, monthly] = await Promise.all([
      this.countRequests(
        organizationId,
        localBoundary(timezone, "day"),
        executor,
      ),
      this.countRequests(
        organizationId,
        localBoundary(timezone, "month"),
        executor,
      ),
    ]);
    if (daily >= dailyLimit) {
      throw new AiQuotaExceededError("组织今日 AI 请求额度已用尽，请明日再试或由 Owner 调整上限。");
    }
    if (monthly >= monthlyLimit) {
      throw new AiQuotaExceededError("组织本月 AI 请求额度已用尽，请由 Owner 调整上限。");
    }
  }

  private async countRequests(
    organizationId: string,
    since: Date,
    executor: QueryExecutor = this.db,
  ): Promise<number> {
    const [result] = await executor
      .select({ value: count() })
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.organizationId, organizationId),
          gte(aiJobs.queuedAt, since),
        ),
      );
    return Number(result?.value ?? 0);
  }
}
