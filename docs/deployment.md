# Render 部署

仓库根目录的 `render.yaml` 是 Blueprint：创建 PostgreSQL、Web API/PWA 和 Worker，使用同一私有数据库连接；Web 在启动前执行 `pnpm db:migrate`，健康检查为 `/healthz`，自动部署仅在 GitHub checks 通过后触发。Blueprint 的运行时、预部署命令、健康检查和数据库 connection string 引用均遵循 Render 的当前 Blueprint 规范。[Render Blueprint specification](https://render.com/docs/blueprint-spec)

1. 将仓库推送到 GitHub 的 `main` 分支。
2. 在 Render 选择 **New + → Blueprint**，连接该仓库并确认 `render.yaml`。
3. 初次同步时填入 `WEB_ORIGIN`、`PUBLIC_APP_URL`（Web 的最终 https URL）、`ZHIPU_API_KEY`、生产 S3 兼容对象存储变量，以及 `SMTP_HOST`/`SMTP_FROM`（需要认证时再填 `SMTP_USER`/`SMTP_PASSWORD`）。`S3_ENDPOINT` 必须是浏览器可访问的 HTTPS origin；该 bucket 不可公开。
4. 等 Web 健康检查通过后，用 `SETUP_TOKEN` 仅一次创建 Owner，随后轮换或移除该变量。
5. 在 Render 中配置数据库备份/PITR、告警和服务日志保留；执行一次独立恢复演练。

数据库和服务采用当前 Compute plan ID，分别为 `0.1c-256mb` 与 `0.5c-512mb`；实际生产容量应按成员数量、并发计时和保留期上调。[Render compute plans](https://render.com/docs/compute-plans)

对象存储还必须允许来自 `WEB_ORIGIN` 的受限 CORS `PUT/GET`，并允许 `content-type`、`x-amz-checksum-sha256` 与签名请求头；具体边界见 [security.md](./security.md)。
