# Render：一次 Blueprint 创建

仓库根目录的 `render.yaml` 会一次创建 PostgreSQL、Web API/PWA 和 Worker。Web 在启动前自动执行 `pnpm db:migrate`，并以 `../web/dist`（相对 `apps/server`）托管已构建的 PWA；健康检查为 `/healthz`。配置遵循 [Render Blueprint specification](https://render.com/docs/blueprint-spec)。

## 第一次创建只需四步

1. 将仓库的 `main` 分支连接到 Render，选择 **New + → Blueprint**，确认根目录的 `render.yaml`。
2. 审核 Render 展示的 `gzjl-hxjyaohaohaode-postgres`、`gzjl-hxjyaohaohaode-web` 和 `gzjl-hxjyaohaohaode-worker` 的区域与价格。若要立即启用文件附件，填写 Blueprint 提示的五项私有对象存储变量：`S3_ENDPOINT`、`S3_BROWSER_ORIGIN`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`。数据库 URL、会话密钥、初始化令牌和 AI 加密密钥由 Blueprint 自动生成或在 Render 内部引用。
3. 等 Web Service 显示 Live 后打开 `https://你的服务.onrender.com/healthz`，确认返回 HTTP 200。
4. 在 Web Service 的 Environment 页面查看 Render 自动生成的 `SETUP_TOKEN`，访问 `https://你的服务.onrender.com/setup`，用该值创建唯一的首位 Owner。完成后移除或轮换 `SETUP_TOKEN`。

Render 的 `RENDER_EXTERNAL_URL` 会自动提供 Web Service 的 `onrender.com` HTTPS 地址；Blueprint 将它用于 `WEB_ORIGIN` 和 `PUBLIC_APP_URL`。Render 也会自动生成 `SESSION_SECRET` 与 API 服务的 `AI_CONFIG_ENCRYPTION_KEY`，Worker 通过 Render 私有引用获得同一把 AI 加密密钥。因此，初次 Blueprint 创建不会要求人工复制密钥。[Render default environment variables](https://render.com/docs/environment-variables)

## 后续按需开启外部能力

系统的核心账号、组织、工时、项目、审批、薪资、审计、实时同步和 Owner 级 AI 配置页面可先上线。文件附件需要私有对象存储；新 Blueprint 会提示填写，既有 Blueprint 不会因后来新增的 `sync: false` 变量重新弹窗，必须到 **Render → 对应服务 → Environment** 手工添加。邮件和短信仍是可选自动投递渠道：

| 能力 | 服务 | 变量 |
| --- | --- | --- |
| 文件证据上传和下载 | Web | `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BROWSER_ORIGIN`；保持私有桶和精确域名 CORS |
| 邮箱自动投递、邮箱绑定验证和自助找回密码 | Web | `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` |
| 短信自动投递、手机号绑定验证和自助找回密码 | Web | `SMS_PROVIDER=twilio`、`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM` |
| 部署级 AI 回退 | Web 和 Worker | 两边都添加相同的 `ZHIPU_API_KEY` |

没有配置外部服务时，应用会明确告知“尚未配置”，不会伪造文件上传、邮件、短信或 AI 已完成。成员管理中的默认邀请方式是 **手工复制一次性链接**：填写邮箱、中国大陆 11 位手机号、带国家区号的国际手机号或邮箱与手机号两者后，链接只在当前授权管理员的这次操作中显示；服务端会统一规范化手机号，避免同一号码形成重复账号。请复制后通过企业私聊、受控工单或其他私密渠道单独传递，不要发公开群。界面会禁用尚未配置的邮件/短信自动渠道；若已配置的自动渠道在投递时未能确认成功，系统会写入审计记录并回退为只向当前管理员显示的一次性手工链接。首次 Owner 初始化时邮箱是可用的引导登录方式；可选手机号会安全保存为“待验证”，只有在随后配置 Twilio 并从 **账户安全** 发出、确认真实短信链接后才可用于登录或找回密码。对无法使用自助找回的在职成员，唯一 Owner 可在 **组织与人员 → 成员详情** 以当前密码（和已启用的 TOTP）二次验证后生成手工重置链接；生成新链接会撤销旧的未使用重置链接。老板也可以在系统的 **工作智能 → 组织 AI 配置** 中填写组织级 HTTPS OpenAI-compatible Base URL、模型与 Key；密钥只以密文保存在服务端，员工与浏览器不能读取。

文件证据使用公司自己的私有 S3 兼容桶，绝不能改用 Render 临时文件系统。设置表格中的 S3 变量后，保持桶私有并允许 `WEB_ORIGIN` 对签名对象发起 `PUT` / `GET`；CORS 请求头至少包含 `content-type`、`x-amz-checksum-sha256` 及签名所需 `x-amz-*`。`S3_BROWSER_ORIGIN` 必须填浏览器实际访问的预签名 PUT URL 的 **origin**（协议与主机，不能带路径）；它可能与 SDK 使用的 `S3_ENDPOINT` 不同，例如虚拟主机式 bucket 域名。生产 PWA 只允许该精确 origin 进行对象存储连接，少填时会明确禁用文件上传而不是上传到一半被 CSP 阻断。工作台支持一次选择任意数量的文件并逐件上传，失败项可重试而不会重复创建证据；`SIGNED_URL_TTL_SECONDS` 默认 900 秒，下载链接始终不超过 300 秒。`ATTACHMENT_MAX_BYTES` 是每件文件上限（Blueprint 默认 100 MiB、上限 5 GiB），不是附件数量上限。支持任意工作文件格式，所有下载均被强制为二进制附件。

以后若绑定自定义域名，应将 `WEB_ORIGIN` 和 `PUBLIC_APP_URL` 改为该域名的同一 HTTPS origin，并在对象存储 CORS 中替换为该精确域名。不要在证书生效前修改它们。
