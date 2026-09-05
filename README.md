# 工作时间与工作智能管理平台

面向单组织内部使用的工作记录、项目演进、审批、薪资与工作智能工作台。系统以 PostgreSQL 中的统一事实链为权威来源；AI 只解释经过程序计算的数据，不参与权限、工时、工资或最终人事决策。

## 本地要求

- Node.js 24+
- pnpm 11+
- Docker Desktop 或可访问的 PostgreSQL 17+

## 快速开始

```bash
pnpm install
docker compose up -d postgres
copy .env.example .env
# Fill SESSION_SECRET and SETUP_TOKEN with separate random 32+ byte values.
pnpm db:migrate
pnpm dev
```

Web 默认运行在 `http://localhost:5173`，API 默认运行在 `http://localhost:3000`。开发命令会并行启动 Web、API 和后台 Worker。

## 质量检查

```bash
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行 lint、类型检查、单元/集成测试和生产构建。仓库不附带任何演示账号、演示工时或演示项目；首次 Owner 必须通过 `/setup` 创建。生产环境不得把附件写入 Render 的临时文件系统。

## 上线与数据边界

- 组织的 Owner 可在 **工作智能 → 组织 AI 配置** 中保存本组织的 OpenAI-compatible `base_url`、模型和 API Key。Key 仅以 AES-256-GCM 密文存入 PostgreSQL，浏览器与日志永不返回；API 与 Worker 必须配置同一个 `AI_CONFIG_ENCRYPTION_KEY`。
- 团队成员只能由有成员管理权限的人通过邮箱、手机号或两者同时加入白名单。中国大陆手机号可直接填写 11 位，国际号码填写国家区号；服务端统一保存为规范形式。默认会只向当前授权管理员显示一次可复制的邀请链接，由管理员通过私密渠道人工交付，因此无需 SMTP 或短信服务；界面会把尚未配置的自动邮件/短信渠道禁用。若已配置的自动渠道在投递时失败，系统会审计该失败并只向当前授权管理员返回同一条一次性手工链接，避免成员被卡在“待邀请”状态。邀请页会先向服务端核验令牌并显示真实截止时间；只有完成首次设密后才会单次失效。重新生成前会明确确认旧链接作废。待加入成员可撤销邀请并立即释放邮箱/手机号以便重邀；已激活成员只能逻辑移除，撤销所有会话但保留工时、项目、审批、薪资和审计历史，之后可恢复。成员总览同时显示接受邀请时间、最近活动、当前在线与活跃端数量。若当前浏览器已经登录 Owner，邀请或密码重置页会明确要求先退出当前会话再继续，并在内存中保留一次性凭据，绝不会把链接操作套用到 Owner。成员接受一次邀请后，填写的全部联系方式都会验证为同一账号的登录方式和同一套密码。每个成员也可在 **账户安全** 增加并验证另一种登录/找回方式；未验证的标识绝不能登录或重置密码，且系统禁止移除最后一个已验证标识。公共密码重置仍使用已配置的真实渠道和统一回执防止枚举；无外部通道时，唯一 Owner 可在成员详情完成当前密码（及已启用的 TOTP）二次验证后，生成一次性手工重置链接。所有新一次性链接都把令牌放在 URL fragment，避免令牌进入普通访问日志。
- 每条真实工时记录必须至少有一项审核人可见且已完成核验的证据后才能提交审批；可保存任意数量的文件、外部链接和文字证据。文件以队列方式逐件直传私有 S3 兼容对象存储，浏览器与服务端分别完成 SHA-256 校验；失败可续传、替换保留版本链、删除保留审计记录。文件种类不以脆弱 MIME 白名单限制，图片、视频、音频、PDF、README、TXT、CSV、JSON、ZIP、Office、代码和未知格式均可选择并上传。对象始终按 `application/octet-stream` 保存；经服务端权限复核后，图片、音视频、PDF 和保守的纯文本格式可在隔离的对象存储 origin 中短时预览，HTML、SVG、脚本、压缩包、Office 和未知格式只显示完整元数据并强制下载，绝不在应用 origin 中执行。附件总数不设应用层上限；单件大小由 `ATTACHMENT_MAX_BYTES` 配置（Blueprint 默认 100 MiB），仍须服从公司对象存储配额与保留策略。生产环境还必须填写实际预签名 PUT/GET 域名的 `S3_BROWSER_ORIGIN`，应用会把它加入精确的 CSP 连接、图片、媒体和文档框架来源；没有该 origin 时会明确禁用文件入口，而不会让浏览器静默阻断。
- 授权用户可创建 CSV、JSON、XLSX 或 PDF 工时后台导出。任务由 Worker 从服务端权限快照读取真实事实，显示进度并支持取消/失败重试；文件写入同一私有 S3/B2 桶、下载前再次鉴权，短时签名且 24 小时后由 Worker 清理。电子表格文本会阻断公式注入，PDF 嵌入中文字体；任务完成或失败会产生站内/可选 Push 通知和审计记录。
- 浏览器 Push 是可选增强通道：配置同一组 VAPID 密钥后，成员在 **通知设置** 对当前浏览器授权，再逐类启用推送。订阅 endpoint 与浏览器密钥以独立 AES-256-GCM 域加密保存；Worker 以幂等投递记录、并发抢占、有限指数退避发送，供应商返回 404/410 时自动停用并在 30 天后清理失效订阅。跨午夜免打扰按保存的 IANA 时区执行；退出账号会撤销当前浏览器订阅，避免切换账号后继续收到前一账号通知。未配置 VAPID 或浏览器不支持 Push 时，站内提醒不受影响。
- 提前安排保存为本人可跨端同步的云端计划草稿，而非工时事实。计划在明确转换、且结束时间已到后才成为可审核的真实草稿；计划不会进入统计、AI、薪资、证据、项目投入或 CSV 工时导出。
- 生产发布前使用 `pnpm check`、`pnpm test:e2e` 和 `git diff --check`。不要提交 `.env`、Render 密钥、数据库导出、用户附件或任何真实个人数据；详细 Render 步骤见 [部署文档](./docs/deployment.md)。

## 工程布局

```text
apps/web       React/Vite PWA 工作台
apps/server    Fastify REST API 与 WebSocket
apps/worker    AI、导出、提醒和报告任务
packages/db    Drizzle schema、迁移和无演示数据的 seed 防护
packages/shared 共享 schema、权限、日期和金额规则
packages/ui    设计令牌和可访问组件
docs           架构、权限、薪资、分析、部署与运维文档
```

完整环境变量见 [`.env.example`](./.env.example)。上线前请依次阅读：

- [`docs/architecture.md`](./docs/architecture.md)：统一事实源、异步任务与离线边界。
- [`docs/permissions.md`](./docs/permissions.md)：角色 grant、Scope 收敛和证据可见性。
- [`docs/payroll.md`](./docs/payroll.md)：可复算工资、周期状态、结算与更正。
- [`docs/analytics.md`](./docs/analytics.md)：真实聚合、AI 边界和可解释导出。
- [`docs/security.md`](./docs/security.md)：认证、Scope 授权、附件与密钥处置。
- [`docs/deployment.md`](./docs/deployment.md)：Render Blueprint 配置与首次初始化。
- [`docs/operations.md`](./docs/operations.md)：健康检查、备份、恢复演练与事故恢复。
