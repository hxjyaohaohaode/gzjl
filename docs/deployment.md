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
| 文件证据上传、后台导出和下载 | Web + Worker | Web 填写 `S3_ENDPOINT`、`S3_BUCKET`、`S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`、`S3_BROWSER_ORIGIN`；Blueprint 将除浏览器 origin 外的同桶配置私密引用给 Worker；保持私有桶和精确域名 CORS |
| 邮箱自动投递、邮箱绑定验证和自助找回密码 | Web | `SMTP_HOST`、`SMTP_USER`、`SMTP_PASSWORD`、`SMTP_FROM` |
| 短信自动投递、手机号绑定验证和自助找回密码 | Web | `SMS_PROVIDER=twilio`、`TWILIO_ACCOUNT_SID`、`TWILIO_AUTH_TOKEN`、`TWILIO_FROM` |
| 浏览器 Push | Web 与 Worker | Web 填 `VAPID_PUBLIC_KEY`；Worker 填同一个 `VAPID_PUBLIC_KEY`、匹配的 `VAPID_PRIVATE_KEY` 和 `VAPID_SUBJECT=mailto:你的运维邮箱` |
| 部署级 AI 回退 | Web 和 Worker | 两边都添加相同的 `ZHIPU_API_KEY` |

没有配置外部服务时，应用会明确告知“尚未配置”，不会伪造文件上传、邮件、短信或 AI 已完成。成员管理中的默认邀请方式是 **手工复制一次性链接**：填写邮箱、中国大陆 11 位手机号、带国家区号的国际手机号或邮箱与手机号两者后，链接只在当前授权管理员的这次操作中显示；服务端会统一规范化手机号，避免同一号码形成重复账号。请复制后通过企业私聊、受控工单或其他私密渠道单独传递，不要发公开群。界面会禁用尚未配置的邮件/短信自动渠道；若已配置的自动渠道在投递时未能确认成功，系统会写入审计记录并回退为只向当前管理员显示的一次性手工链接。首次 Owner 初始化时邮箱是可用的引导登录方式；可选手机号会安全保存为“待验证”，只有在随后配置 Twilio 并从 **账户安全** 发出、确认真实短信链接后才可用于登录或找回密码。对无法使用自助找回的在职成员，唯一 Owner 可在 **组织与人员 → 成员详情** 以当前密码（和已启用的 TOTP）二次验证后生成手工重置链接；生成新链接会撤销旧的未使用重置链接。老板也可以在系统的 **工作智能 → 组织 AI 配置** 中填写组织级 HTTPS OpenAI-compatible Base URL、模型与 Key；密钥只以密文保存在服务端，员工与浏览器不能读取。

启用 Push 时，在本地运行 `pnpm dlx web-push generate-vapid-keys --json`。把 `publicKey` 填入 Web 的 `VAPID_PUBLIC_KEY`；再把同一个 `publicKey` 和匹配的 `privateKey` 分别填入 Worker 的 `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`，并填写 `VAPID_SUBJECT=mailto:实际运维邮箱`。`PUSH_SUBSCRIPTION_ENCRYPTION_KEY` 已由 Blueprint 自动生成并由 Worker 私有引用，不要手工替换。Render 的规则是：现有 Blueprint 会忽略后来新增的 `sync:false` 项，所以既有服务必须在各自 **Environment** 页面手工添加上述值；未添加时 Push 会安全保持关闭，不影响站内通知或 Worker 启动。保存后等 Web 与 Worker 都完成部署，成员进入 **通知设置 → 启用本设备推送**，授权浏览器并逐类打开推送。不要轮换 VAPID 私钥，除非接受所有现有浏览器重新订阅；常规注销、浏览器撤权与 Push 服务 404/410 会自动清理，不需要管理员查看或复制 endpoint。

文件证据使用公司的私有 S3 兼容桶，不能放入 Render 临时文件系统。`S3_BROWSER_ORIGIN` 必须填写浏览器实际访问的预签名 PUT URL 的 **origin**（协议与主机，不能带路径）；生产 PWA 只允许该精确 origin 进行对象存储连接。工作台支持一次选择任意数量的文件并逐件上传，失败项可重试而不会重复创建证据；`SIGNED_URL_TTL_SECONDS` 默认 900 秒，下载链接始终不超过 300 秒。`ATTACHMENT_MAX_BYTES` 是每件文件上限（Blueprint 默认 100 MiB、上限 5 GiB），不是附件数量上限。所有下载均被强制为二进制附件。

## 当前附件方案：Backblaze B2

B2 是独立的私有对象存储，浏览器通过短时预签名地址直接上传证据，Worker 将 CSV、JSON、XLSX 和 PDF 后台导出写入同一个私有桶。Render 只负责签名、权限校验、实际字节哈希核验、任务生成和元数据，因此重新部署或扩容不会丢失对象。

当前生产配置如下：

| 项目 | 值 |
| --- | --- |
| Bucket | `gzjl-evidence-a7k3`，Private |
| S3 endpoint | `https://s3.us-east-005.backblazeb2.com` |
| Region | `us-east-005` |
| 工作台 origin | `https://gzjl-hxjyaohaohaode-web.onrender.com` |
| 生命周期 | Keep only the last version |
| Object Lock | Disabled |

1. 在 **Application Keys** 创建名为 `workbench-render` 的独立 key，只选择 `gzjl-evidence-a7k3`，能力选择 **Read and Write**，并勾选 **Allow List All Bucket Names**（S3 SDK 列桶兼容所需）。B2 的 Master Application Key 不能用于 S3-compatible API；`keyID` 对应 `S3_ACCESS_KEY_ID`，只显示一次的 `applicationKey` 对应 `S3_SECRET_ACCESS_KEY`。
2. Bucket 保持 **Private**，开启 B2 默认服务端加密。生命周期保持 **Keep only the last version**，防止被替换的旧版本无限计费。当前导出对象还会在完成 24 小时后由 Worker 清理。
3. 在 bucket 的 **CORS Rules** 选择只共享给以下 origin，并填写 `https://gzjl-hxjyaohaohaode-web.onrender.com`。不要选择所有 origin 或所有 HTTPS origin。B2 控制台的精确 origin 规则允许预签名 PUT 所需的 `content-type` 与 `x-amz-meta-*` 请求头。
4. 打开 Render 的 `gzjl-hxjyaohaohaode-web` → **Environment**，填写并保存：

| Render 变量 | 填写值 |
| --- | --- |
| `S3_ENDPOINT` | `https://s3.us-east-005.backblazeb2.com` |
| `S3_BROWSER_ORIGIN` | `https://s3.us-east-005.backblazeb2.com` |
| `S3_BUCKET` | `gzjl-evidence-a7k3` |
| `S3_ACCESS_KEY_ID` | `workbench-render` 的 `keyID` |
| `S3_SECRET_ACCESS_KEY` | `workbench-render` 的 `applicationKey` |
| `S3_REGION` | `us-east-005` |
| `S3_FORCE_PATH_STYLE` | `true` |
| `S3_UPLOAD_INTEGRITY_MODE` | `download_sha256` |

`download_sha256` 模式不会要求 B2 不支持的 `x-amz-checksum-sha256` 签名头。浏览器仍先计算 SHA-256；上传后 Web 服务通过私有凭据流式读取对象并重新计算摘要，只有实际内容、大小和签名元数据全部匹配才把附件标记为可用。这个校验多一次对象读取，用少量带宽换取真实的端到端完整性验证。

5. Render 保存环境变量并完成 Web、Worker 重新部署后，登录工作台上传一个小型测试文件，刷新页面确认附件仍存在且可下载；随后创建 CSV 后台导出，确认任务完成并能获得短时下载链接。若能力提示仍不可用，检查 Web 服务日志列出的缺失变量，并确认 Worker 使用 Web 服务的同桶私有引用。

安全验收：B2 bucket 保持 private；员工浏览器只能看到短时预签名 URL，不能看到 B2 API key；预签名上传地址 15 分钟失效，下载地址最多 5 分钟失效；Master Application Key 已轮换作废，Render 只持有单 bucket 的独立 key；默认服务端加密已开启；业务数据库与对象存储共同让多端在刷新或实时事件到达后看到同一附件和导出状态。

以后若绑定自定义域名，应将 `WEB_ORIGIN` 和 `PUBLIC_APP_URL` 改为该域名的同一 HTTPS origin，并在对象存储 CORS 中替换为该精确域名。不要在证书生效前修改它们。
