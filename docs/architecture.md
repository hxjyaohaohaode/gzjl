# 架构与事实链

平台是一个 pnpm workspace：React/Vite PWA 位于 `apps/web`，Fastify API 与 WebSocket 位于 `apps/server`，pg-boss 后台任务位于 `apps/worker`，Drizzle schema 与迁移位于 `packages/db`。仓库的 seed 命令是显式无数据操作，不创建任何 demo 账号或业务事实；首次 Owner 只能通过受保护的 `/setup` 流程建立。所有业务真相只写入 PostgreSQL；前端缓存、Service Worker 缓存、AI 输出和导出文件都不是权威状态。

## 关键写入链

`认证会话 → 成员/授权 → 工时或计时事件 → 审核与版本快照 → 薪资快照/结算 → 分析聚合/AI 报告`。

计时事件带客户端 UUID 并在数据库中唯一约束；工时、项目节点、审批、工资运行和附件分别保留版本或审计快照。Outbox 表驱动跨实例 WebSocket 通知与后台任务，避免把进程内内存当作可靠队列。

## 边界

- PostgreSQL 是唯一事实源，迁移必须先于 API 启动。
- 云端计划以 `work_sessions.record_kind = 'plan'` 保存为私有、版本化的跨端草稿，复用同一不可变版本链以便恢复和追溯；它不是工作事实。所有统计、AI、薪资、证据、项目投入、审批、导出与提醒查询都显式筛选 `record_kind = 'fact'`。计划结束后仍须由本人明确转换为真实草稿，转换操作本身也产生版本与审计事件。
- AI 仅消费服务端按现有授权过滤后的聚合事实，并保存输入哈希和输出；它不具备写入工时、审批或薪资的能力。
- 文件证据不经 API 服务器转存：客户端取得 15 分钟 PUT 签名后直传 S3 兼容存储，随后服务端以大小和 SHA-256 完整性复核，失败对象标为 `quarantined`。
- 后台工时导出通过事务 Outbox 与 pg-boss 投递。API 在入队事务中固化时间范围、快照时点、行级 scope 和字段级权限；Worker 原子抢占任务，生成 CSV/JSON/XLSX/PDF 后写入私有 S3/R2。取消与完成采用条件更新竞争，取消成功的任务不会被 Worker 复活；上传后落库失败或取消时删除孤儿对象，超时运行任务自动恢复，过期对象定期清理。
- PWA 只缓存应用壳和静态资源，绝不缓存 `/api` 响应；离线仅队列化带 UUID 的计时命令，恢复网络后按顺序重放。
