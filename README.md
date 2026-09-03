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
- 团队成员只能由有成员管理权限的人通过邮箱或 E.164 手机号加入白名单。邀请与密码重置仅通过已配置的 SMTP 或 Twilio 真实投递；Owner 邀请的未配置通道会明确失败且不创建无效白名单，公共密码重置则始终使用通用回执防止枚举账号，二者都不会伪造“已发送”或把令牌暴露给前端。
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
