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
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Web 默认运行在 `http://localhost:5173`，API 默认运行在 `http://localhost:3000`。开发命令会并行启动 Web、API 和后台 Worker。

## 质量检查

```bash
pnpm check
pnpm test:e2e
```

`pnpm check` 依次执行 lint、类型检查、单元/集成测试和生产构建。生产环境不得使用 seed 数据，也不得把附件写入 Render 的临时文件系统。

## 工程布局

```text
apps/web       React/Vite PWA 工作台
apps/server    Fastify REST API 与 WebSocket
apps/worker    AI、导出、提醒和报告任务
packages/db    Drizzle schema、迁移和 seed
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
