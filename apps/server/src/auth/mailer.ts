import { createTransport } from "nodemailer";

import type { ServerConfig } from "../config.js";

export interface PasswordResetRecipient {
  email: string;
  token: string;
  expiresAt: Date;
}

/** Deliberately fails closed: a reset link is never returned to a browser. */
export class AuthDeliveryUnavailableError extends Error {
  constructor() {
    super("密码重置邮件服务尚未配置，请联系管理员。");
    this.name = "AuthDeliveryUnavailableError";
  }
}

export class AuthMailer {
  constructor(private readonly config: ServerConfig) {}

  async sendPasswordReset({ email, token, expiresAt }: PasswordResetRecipient): Promise<void> {
    const { SMTP_HOST: host, SMTP_FROM: from } = this.config;
    if (!host || !from) throw new AuthDeliveryUnavailableError();
    const transport = createTransport({
      host,
      port: this.config.SMTP_PORT,
      secure: this.config.SMTP_SECURE,
      ...(this.config.SMTP_USER && this.config.SMTP_PASSWORD
        ? { auth: { user: this.config.SMTP_USER, pass: this.config.SMTP_PASSWORD } }
        : {}),
    });
    const resetUrl = new URL("/reset-password", this.config.PUBLIC_APP_URL);
    resetUrl.searchParams.set("token", token);
    await transport.sendMail({
      from,
      to: email,
      subject: "重置工作智能工作台密码",
      text: `请在 ${expiresAt.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} 前打开以下链接重置密码：\n${resetUrl.toString()}\n\n如果不是你本人发起，请忽略此邮件。`,
    });
  }
}
