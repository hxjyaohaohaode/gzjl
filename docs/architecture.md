# 架构与事实链

平台是一个 pnpm workspace：React/Vite PWA 位于 `apps/web`，Fastify API 与 WebSocket 位于 `apps/server`，pg-boss 后台任务位于 `apps/worker`，Drizzle schema、迁移和确定性开发 seed 位于 `packages/db`。所有业务真相只写入 PostgreSQL；前端缓存、Service Worker 缓存、AI 输出和导出文件都不是权威状态。

## 关键写入链

`认证会话 → 成员/授权 → 工时或计时事件 → 审核与版本快照 → 薪资快照/结算 → 分析聚合/AI 报告`。

计时事件带客户端 UUID 并在数据库中唯一约束；工时、项目节点、审批、工资运行和附件分别保留版本或审计快照。Outbox 表驱动跨实例 WebSocket 通知与后台任务，避免把进程内内存当作可靠队列。

## 边界

- PostgreSQL 是唯一事实源，迁移必须先于 API 启动。
- AI 仅消费服务端按现有授权过滤后的聚合事实，并保存输入哈希和输出；它不具备写入工时、审批或薪资的能力。
- 文件证据不经 API 服务器转存：客户端取得 15 分钟 PUT 签名后直传 S3 兼容存储，随后服务端以大小和 SHA-256 完整性复核，失败对象标为 `quarantined`。
- PWA 只缓存应用壳和静态资源，绝不缓存 `/api` 响应；离线仅队列化带 UUID 的计时命令，恢复网络后按顺序重放。
