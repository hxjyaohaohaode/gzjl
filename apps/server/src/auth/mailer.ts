import { createTransport } from "nodemailer";

import type { ServerConfig } from "../config.js";

export type CredentialDeliveryKind = "email" | "phone";

export interface PasswordResetRecipient {
  identifier: string;
  kind: CredentialDeliveryKind;
  token: string;
  expiresAt: Date;
}

export interface InvitationRecipient {
  displayName: string;
  identifier: string;
  kind: CredentialDeliveryKind;
  token: string;
  expiresAt: Date;
}

/**
 * Delivery is deliberately fail-closed. Neither an invitation nor a reset
 * token is ever returned to a browser as a fallback when the configured
 * channel cannot deliver it.
 */
export class AuthDeliveryUnavailableError extends Error {
  constructor(message = "消息投递服务尚未配置或暂不可用，请联系管理员。") {
    super(message);
    this.name = "AuthDeliveryUnavailableError";
  }
}

function expiryLabel(expiresAt: Date): string {
  return expiresAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export class AuthMailer {
  constructor(private readonly config: ServerConfig) {}

  /**
   * Validate the selected channel before an invitation transaction creates a
   * pending identity. A network failure can still leave a safely resendable
   * invitation, but a plainly absent or half-configured channel never does.
   */
  assertDeliveryConfigured(kind: CredentialDeliveryKind): void {
    if (kind === "email") {
      const hasCredentials = Boolean(
        this.config.SMTP_USER || this.config.SMTP_PASSWORD,
      );
      if (!this.config.SMTP_HOST || !this.config.SMTP_FROM) {
        throw new AuthDeliveryUnavailableError(
          "邮件服务尚未配置，不能安全发送邀请或密码重置链接。",
        );
      }
      if (hasCredentials && (!this.config.SMTP_USER || !this.config.SMTP_PASSWORD)) {
        throw new AuthDeliveryUnavailableError(
          "SMTP 用户名和密码必须同时配置，不能使用不完整的邮件凭据发送邀请。",
        );
      }
      return;
    }
    if (
      this.config.SMS_PROVIDER !== "twilio" ||
      !this.config.TWILIO_ACCOUNT_SID ||
      !this.config.TWILIO_AUTH_TOKEN ||
      !this.config.TWILIO_FROM
    ) {
      throw new AuthDeliveryUnavailableError(
        "短信服务尚未配置。请在 Render 配置 Twilio 凭据，或改用已配置的邮箱白名单。",
      );
    }
  }

  async sendPasswordReset({
    identifier,
    kind,
    token,
    expiresAt,
  }: PasswordResetRecipient): Promise<void> {
    const resetUrl = new URL("/reset-password", this.config.PUBLIC_APP_URL);
    resetUrl.searchParams.set("token", token);
    const body =
      kind === "phone"
        ? `工作智能工作台密码重置：${resetUrl.toString()}（${expiryLabel(expiresAt)} 前有效；非本人操作请忽略）`
        : `请在 ${expiryLabel(expiresAt)} 前打开以下链接重置工作智能工作台密码：\n${resetUrl.toString()}\n\n如果不是你本人发起，请忽略此消息。`;
    await this.send(kind, identifier, "重置工作智能工作台密码", body);
  }

  async sendInvitation({
    displayName,
    identifier,
    kind,
    token,
    expiresAt,
  }: InvitationRecipient): Promise<void> {
    const invitationUrl = new URL("/invite", this.config.PUBLIC_APP_URL);
    invitationUrl.searchParams.set("token", token);
    const body =
      kind === "phone"
        ? `工作智能工作台邀请：${invitationUrl.toString()}（${expiryLabel(expiresAt)} 前有效，仅限本人使用一次）`
        : `${displayName}，你已被加入工作智能工作台的组织白名单。请在 ${expiryLabel(expiresAt)} 前打开以下链接设置密码并加入组织：\n${invitationUrl.toString()}\n\n链接只能使用一次；如果不是你本人，请忽略此消息。`;
    await this.send(kind, identifier, "加入工作智能工作台", body);
  }

  private async send(
    kind: CredentialDeliveryKind,
    identifier: string,
    subject: string,
    body: string,
  ): Promise<void> {
    if (kind === "email") {
      await this.sendEmail(identifier, subject, body);
      return;
    }
    await this.sendSms(identifier, body);
  }

  private async sendEmail(
    email: string,
    subject: string,
    text: string,
  ): Promise<void> {
    this.assertDeliveryConfigured("email");
    const { SMTP_HOST: host, SMTP_FROM: from } = this.config;
    const transport = createTransport({
      host: host!,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      ...(this.config.SMTP_USER && this.config.SMTP_PASSWORD
        ? { auth: { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } }
        : {}),
    });
    try {
      await transport.sendMail({ from: from!, to: email, subject, text });
    } catch {
      throw new AuthDeliveryUnavailableError(
        "邮件服务无法完成本次投递，请核验 SMTP 配置、发件域名和收件地址后重试。",
      );
    }
  }

  private async sendSms(phone: string, body: string): Promise<void> {
    this.assertDeliveryConfigured("phone");
    // assertDeliveryConfigured establishes these values at runtime. Keep the
    // values local as well so optional environment variables cannot leak into
    // a request when this method is refactored later.
    const accountSid = this.config.TWILIO_ACCOUNT_SID!;
    const authToken = this.config.TWILIO_AUTH_TOKEN!;
    const from = this.config.TWILIO_FROM!;

    const endpoint = new URL(
      `/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
      "https://api.twilio.com",
    );
    const credentials = Buffer.from(
      `${accountSid}:${authToken}`,
      "utf8",
    ).toString("base64");
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: {
          authorization: `Basic ${credentials}`,
          "content-type": "application/x-www-form-urlencoded;charset=UTF-8",
        },
        body: new URLSearchParams({
          To: phone,
          From: from,
          Body: body,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new AuthDeliveryUnavailableError(
        "短信服务暂时无法连接，请稍后重试或改用已配置的邮箱白名单。",
      );
    }
    if (!response.ok) {
      throw new AuthDeliveryUnavailableError(
        "短信服务拒绝了本次投递，请核验号码、发送方和 Render 环境变量。",
      );
    }
  }
}
