# Render 部署

仓库根目录的 `render.yaml` 是 Blueprint：创建 PostgreSQL、Web API/PWA 和 Worker，使用同一私有数据库连接；Web 在启动前执行 `pnpm db:migrate`，健康检查为 `/healthz`，自动部署仅在 GitHub checks 通过后触发。Blueprint 的运行时、预部署命令、健康检查和数据库 connection string 引用均遵循 Render 的当前 Blueprint 规范。[Render Blueprint specification](https://render.com/docs/blueprint-spec)

1. 本地执行 `pnpm check`、`pnpm test:e2e` 和 `git diff --check`；确认 `.env`、用户附件、数据库导出和任何真实个人数据均未被 Git 跟踪。仓库不包含 demo 用户、工时、项目或 AI 报告。
2. 将经检查的仓库推送到 GitHub 的 `main` 分支，再在 Render 选择 **New + → Blueprint** 并确认 `render.yaml`。
3. 初次同步时填写 `WEB_ORIGIN`、`PUBLIC_APP_URL`（同一个 Web 的最终 HTTPS origin）、生产 S3 兼容对象存储变量，以及 `SMTP_HOST`/`SMTP_FROM`（需要认证时再填 `SMTP_USER`/`SMTP_PASSWORD`）。生产启动会拒绝 HTTP、含账号信息或两者 origin 不一致的配置；`S3_ENDPOINT` 必须是浏览器可访问的 HTTPS origin；bucket 不可公开。
4. 生成三个不同的 32+ byte 随机值（例如 `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"`），分别存入 `SESSION_SECRET`、`SETUP_TOKEN` 和 `AI_CONFIG_ENCRYPTION_KEY`。**API 服务和 Worker 的 `AI_CONFIG_ENCRYPTION_KEY` 必须完全相同**；否则 Worker 无法解密 Owner 保存的组织 AI Key。不要在 GitHub、截图或日志中记录这些值。
5. 如果要使用组织级 AI，Owner 登录后在 **工作智能 → 组织 AI 配置** 输入供应商的 HTTPS OpenAI-compatible Base URL、模型与 Key；系统强制每日/月度请求上限和输出 token 上限。也可保留部署级 `ZHIPU_API_KEY` 作为未设置组织配置时的回退。智谱 OpenAI-compatible 端点的当前基址为 `https://open.bigmodel.cn/api/paas/v4`，聊天路径为 `/chat/completions`。[官方兼容接口说明](https://docs.bigmodel.cn/cn/guide/develop/openai/introduction)
6. 如需邮箱邀请/重置，配置真实 SMTP；如需短信，设置 `SMS_PROVIDER=twilio` 与 `TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM`。Owner 发起或重发白名单邀请时，未配置通道会明确失败且不会先创建/废弃令牌；公共密码重置端点始终返回同一句通用回执以防枚举账号，并且对明显未配置的通道不会落库重置令牌。两种情况都不能用 mock 代替。先向测试号码发送一次邀请与一次密码重置，验证链接的最终域名和 TLS。
7. 等 Web 健康检查通过后，用 `SETUP_TOKEN` 仅一次创建 Owner，随后轮换或移除该变量。Owner 建立团队时应通过邮箱或 E.164 手机号创建白名单邀请，不应共享账号。
8. 在 Render 中配置数据库备份/PITR、告警和服务日志保留；执行一次独立恢复演练，并验证新建/编辑工时、云端计划的跨浏览器同步与到期转换、邀请、AI 任务、附件直传与跨浏览器实时同步。

数据库和服务采用当前 Compute plan ID，分别为 `0.1c-256mb` 与 `0.5c-512mb`；实际生产容量应按成员数量、并发计时和保留期上调。[Render compute plans](https://render.com/docs/compute-plans)

对象存储还必须允许来自 `WEB_ORIGIN` 的受限 CORS `PUT/GET`，并允许 `content-type`、`x-amz-checksum-sha256` 与签名请求头；具体边界见 [security.md](./security.md)。
