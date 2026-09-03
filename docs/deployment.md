# Render：一次 Blueprint 创建

仓库根目录的 `render.yaml` 会一次创建 PostgreSQL、Web API/PWA 和 Worker。Web 在启动前自动执行 `pnpm db:migrate`，健康检查为 `/healthz`。配置遵循 [Render Blueprint specification](https://render.com/docs/blueprint-spec)。

## 第一次创建只需四步

1. 将仓库的 `main` 分支连接到 Render，选择 **New + → Blueprint**，确认根目录的 `render.yaml`。
2. 审核 Render 展示的 `gzjl-hxjyaohaohaode-postgres`、`gzjl-hxjyaohaohaode-web` 和 `gzjl-hxjyaohaohaode-worker` 的区域与价格，随后点击创建。初次创建不需要手填域名、数据库 URL、会话密钥、初始化令牌或 AI 加密密钥：Blueprint 会自动生成或在 Render 内部引用它们。
3. 等 Web Service 显示 Live 后打开 `https://你的服务.onrender.com/healthz`，确认返回 HTTP 200。
4. 在 Web Service 的 Environment 页面查看 Render 自动生成的 `SETUP_TOKEN`，访问 `https://你的服务.onrender.com/setup`，用该值创建唯一的首位 Owner。完成后移除或轮换 `SETUP_TOKEN`。

Render 的 `RENDER_EXTERNAL_URL` 会自动提供 Web Service 的 `onrender.com` HTTPS 地址；Blueprint 将它用于 `WEB_ORIGIN` 和 `PUBLIC_APP_URL`。Render 也会自动生成 `SESSION_SECRET` 与 API 服务的 `AI_CONFIG_ENCRYPTION_KEY`，Worker 通过 Render 私有引用获得同一把 AI 加密密钥。因此，初次 Blueprint 创建不会要求人工复制密钥。[Render default environment variables](https://render.com/docs/environment-variables)

## 后续按需开启外部能力

系统的核心账号、组织、工时、项目、审批、薪资、审计、实时同步和 Owner 级 AI 配置页面可先上线。下列能力依赖公司自己的第三方账号，初次部署不要求提供它们；准备好后再到 **Render → 对应服务 → Environment** 添加真实值：

| 能力 | 服务 | 变量 |
| --- | --- | --- |
| 文件证据上传和下载 | Web | `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`；保持私有桶和精确域名 CORS |
| 邮箱邀请和找回密码 | Web | `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` |
| 短信邀请和找回密码 | Web | `SMS_PROVIDER=twilio`、`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM` |
| 部署级 AI 回退 | Web 和 Worker | 两边都添加相同的 `ZHIPU_API_KEY` |

没有配置外部服务时，应用会明确告知“尚未配置”，不会伪造文件上传、邮件、短信或 AI 已完成。老板也可以在系统的 **工作智能 → 组织 AI 配置** 中填写组织级 HTTPS OpenAI-compatible Base URL、模型与 Key；密钥只以密文保存在服务端，员工与浏览器不能读取。

以后若绑定自定义域名，应将 `WEB_ORIGIN` 和 `PUBLIC_APP_URL` 改为该域名的同一 HTTPS origin，并在对象存储 CORS 中替换为该精确域名。不要在证书生效前修改它们。
