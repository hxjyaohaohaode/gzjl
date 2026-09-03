# Codex 主提示词：全量开发“工作时间与工作智能管理平台”正式版

你现在是该项目的首席全栈工程师、产品工程师、数据工程师、测试负责人和部署负责人。你的任务不是输出一个 Demo、静态页面或开发计划，而是**在当前仓库中持续实施，直到一个可部署、可测试、可多人使用的正式版工作台完成**。

如果仓库已经存在代码：先完整阅读目录、依赖、环境变量、数据库迁移、测试、README、CI 和部署文件，判断哪些可复用，绝不能凭文件名猜功能。若仓库为空：按本提示词建立完整项目。

除非遇到真正无法从需求推导、并且会导致不可逆错误的外部凭据问题，否则不要停下来反复向我提问。对于可配置事项，采用合理默认值并做成后台设置项。不要以“后续可完善”代替本次实现。

---

## 0. 项目目标

构建一个单公司/单组织内部使用的工作时间与工作智能 Web 工作台，初始规模约 20 人，但数据模型与性能应允许自然扩展到数百人。

它不是传统打卡 OA。核心事实链必须是：

`成员 → 组织/身份 → 项目 → 项目节点/分支 → 工作记录 → 休息 → 证据 → 提交/审批 → 薪资规则 → 工资周期/结算 → 图表 → AI → 提醒`

任何页面都必须基于同一事实源，不允许日历、分析、工资、项目各算一套数据。

最终代码上传 GitHub，并部署到 Render。桌面端和移动端全部功能实时同步，PWA 可安装，浅色/深色/System/自定义强调色可切换。

---

## 1. 不可违背的产品约束

1. 只有一个组织，一个唯一 Owner/老板。
2. 老板可增删/停用成员、调整权限、编辑组织架构、配置薪资。
3. 同一成员可拥有多个专业身份，如“知识库开发”“Agent 开发”，并可自定义；身份变更可走审核。
4. 访问权限、组织岗位、专业身份必须分开建模，不得把所有东西塞进一个 `role` 字段。
5. 普通员工只能看自己的完整工时/工资；同项目成员可看彼此公开工作内容、工作动态、最后工作活动，但看不到对方完整时间段、总工时和工资。
6. “最后活跃”不是在线心跳，而是最新可公开工作记录的结束时间和内容摘要。
7. 工作记录同时支持实时计时和手动补录；一天多个时间段；跨午夜；休息扣除；员工可补录过去 7 天。
8. 工作制度为弹性工作，不能把固定上下班规则写死。老板可选配个人参考工作窗口、目标时长等。
9. 项目必须是可版本化、可分支、可回滚的树/图结构，支持分支、删除、恢复、回滚、依赖与关联关系，并和进度条结合。
10. 证据支持尽可能多的文件/链接/文本类型，默认可选，补充和替换必须有时间和审计。
11. 工作记录有审批，老板平时可少审，但工资结算和异常记录必须可集中审核。
12. 薪资规则由老板配置，支持时薪/日薪/月薪/项目制/混合制，以及可选的工作日、周末、节假日、夜间、加班、补贴、奖金、扣款、取整等规则；未配置即不生效。
13. 员工同时看到实时预估工资和最终结算工资，并能展开计算明细。
14. AI 使用可配置 GLM Provider，默认 `ZHIPU_MODEL=glm-4.7-flash`；采用轻量实时 + 异步自动 + 手动深度分析混合模式。
15. AI 只负责理解、总结、解释、建议和预测；工时、工资、权限、状态由程序确定。AI 不得自动做处罚、晋升、辞退或最终工资决定。
16. 提醒包括忘记填写、异常时长、重叠、连续工作偏长、项目阻塞、结算待审等；支持站内和浏览器通知、勿扰时间、类别开关和去重。
17. 不做员工排行榜，不把“工作时长长”当成优秀指标。
18. 所有图表数据真实、实时、可对账；严禁假数据、裁切、溢出、Tooltip 越界、响应式失效。
19. 正式版必须具备导入/导出、审计、备份、权限、异常恢复、测试和 Render 部署配置。

---

## 2. 推荐技术栈（除非现有仓库已有更优且成熟方案，否则使用此方案）

采用 pnpm Monorepo：

- `apps/web`：React + TypeScript + Vite
- `apps/server`：Node.js + Fastify + TypeScript
- `apps/worker`：Node.js + TypeScript，处理 AI、导出、提醒、报告等后台任务
- `packages/db`：PostgreSQL + Drizzle ORM + migrations
- `packages/shared`：Zod schemas、权限枚举、共享类型、日期/金额工具
- `packages/ui`：复用 UI 组件与 design tokens

前端：

- Tailwind CSS + shadcn/ui/Radix primitives
- Motion（统一大部分微动效；不要再叠多套动画库）
- Apache ECharts（全部业务分析图）
- `@xyflow/react`（项目树/组织树的可编辑大画布）
- `d3-hierarchy` 或 ELK/Dagre 做自动布局
- TanStack Query（服务端状态）
- Zustand（仅本地 UI 状态/全局筛选等）
- TanStack Table + Virtual（大列表）
- React Hook Form + Zod
- date-fns 或 Temporal polyfill（时间处理）
- IndexedDB（离线草稿/计时器恢复）

服务端：

- Fastify REST API
- WebSocket（可选 Socket.IO，要求自动重连与心跳）
- PostgreSQL 为事实源
- `pg-boss` 或等价可靠 Postgres Job Queue，避免首期为了 20 人额外强依赖 Redis
- Argon2id 密码哈希
- HttpOnly Secure Session Cookie
- CSRF 防护、rate limit、审计日志
- S3-compatible Object Storage（Cloudflare R2/AWS S3 等）存证据附件；绝不能依赖 Render 临时文件系统
- Web Push（VAPID）+ 站内通知
- SMTP + 可插拔 SMS provider，实现邮箱/手机号账号与密码、验证、重置

如果未来扩为多个 Web 实例，再加入 Render Key Value/Redis 做 Pub/Sub 和缓存；首期架构要预留接口但无需强制启用。

---

## 3. 仓库结构

建议：

```text
/
  apps/
    web/
    server/
    worker/
  packages/
    db/
    shared/
    ui/
    config/
  docs/
    architecture.md
    permissions.md
    payroll.md
    analytics.md
    deployment.md
  scripts/
  .github/workflows/
  render.yaml
  docker-compose.yml
  .env.example
  pnpm-workspace.yaml
  package.json
  README.md
```

必须做到：一条命令启动本地开发；一条命令运行全部检查；数据库 migration/seed 明确；`.env.example` 完整但没有真实密钥。

---

## 4. 核心数据模型

不要机械照抄字段名，但必须覆盖这些实体和关系。

### 4.1 用户与组织

- `users`
- `user_credentials`：email/phone/password hash/verified
- `sessions`
- `organization`：单例但保持表结构
- `org_units`：部门/组，树结构
- `org_memberships`
- `access_roles`
- `permissions`
- `role_permissions`
- `member_roles`：可限定 scope
- `professional_identities`
- `member_identities`
- `identity_change_requests`
- `ownership_transfer_events`

Owner 必须数据库层/事务层保证唯一。

### 4.2 项目

- `projects`
- `project_members`
- `project_nodes`
- `project_branches`
- `project_edges`：depends_on / blocks / relates_to / replaces / merges_into
- `project_node_versions`
- `project_branch_versions`
- `project_node_assignees`
- `project_milestones`
- `project_activity_log`
- `recycle_bin_entries`

项目节点至少有：parent、branch、type、title、description、status、progress、progress_mode、weight、start_at、due_at、created_by、version、deleted_at。

### 4.3 工作记录

- `work_sessions`
- `work_breaks`
- `work_session_project_links`
- `work_session_tags`
- `work_session_versions`
- `timer_states`
- `work_types`
- `work_expectation_profiles`

`work_sessions` 必须保存：start/end、timezone、gross_seconds、net_seconds、source(manual/timer/import)、content、result、blockers、next_step、primary_project_node、visibility、submission_status、approval_status、created/updated/submitted/locked timestamps、version。

原始时长与计费时长严禁混用。

### 4.4 证据

- `attachments`
- `attachment_versions`
- `attachment_links`

保存哈希、对象存储 key、MIME、大小、可见性、上传人、上传时间。外部 URL 类型与文件类型明确区分。

### 4.5 审批

- `approval_requests`
- `approval_actions`
- `approval_rules`

支持单条、批量、退回、通过、管理修正。所有动作写审计。

### 4.6 薪资

- `compensation_plans`
- `compensation_plan_versions`
- `rate_rules`
- `pay_periods`
- `payroll_runs`
- `payroll_items`
- `payroll_item_components`
- `payroll_adjustments`
- `payslips`
- `payroll_snapshots`

金额使用 PostgreSQL NUMERIC/DECIMAL，服务端使用 Decimal 库；严禁浮点误差。

### 4.7 AI、提醒、审计

- `ai_jobs`
- `ai_reports`
- `ai_report_sources`
- `reminder_rules`
- `notifications`
- `notification_preferences`
- `push_subscriptions`
- `audit_logs`
- `exports`
- `saved_views`

---

## 5. 权限系统

实现 RBAC + Scope/ABAC，而不是简单 `if user.role === 'admin'`。

权限至少包括：

- org.manage
- members.manage
- roles.manage
- project.create/manage
- project.view_all
- work.view_own
- work.view_project_public
- work.view_full_scope
- work.review
- evidence.view_management
- payroll.view_own
- payroll.view_scope
- payroll.configure
- payroll.settle
- analytics.view_team
- ai.team_analysis
- audit.view
- export.scope

数据查询必须从服务端根据当前用户和 scope 裁剪。

普通同项目成员接口返回的公开动态对象可以包含：成员、公开工作内容摘要、公开项目/节点、`last_work_activity_at`，但不得泄露完整 `start_at`、`net_seconds`、工资字段。

证据默认 `management_only`，上传时可改为 `project_visible`。

写自动化安全测试：普通成员直接调用他人工时/工资 API 必须 403/404，不能仅在前端隐藏。

---

## 6. 认证与账号

正式实现：

- 邮箱 + 密码
- 手机号 + 密码
- 至少一个账号标识完成验证
- 邀请成员
- 首次设置密码
- 忘记密码/重置
- 登录限流
- 会话管理与踢出其他设备
- Owner/高权限用户可启用 2FA
- Owner 可停用成员账号；停用不删除历史业务数据

手机号验证/SMS 采用 Provider Interface；没有 SMS 凭据时任何环境都必须明确失败，不得以 mock 或令牌回显伪造“已发送”。

---

## 7. 工作记录与计时器

### 7.1 实时计时

实现：开始、暂停、继续、休息、结束。状态在服务端和客户端都有恢复信息。

断网：客户端保留事件日志；重连后向服务端校准。浏览器关闭后，已开始的服务端 timer 仍能恢复。

同一成员默认只允许一个“主计薪计时器”运行；若允许并行记录，必须显式标记并在工资规则中避免重复计薪。

### 7.2 手动补录

员工仅可补录最近 7 天；服务端强制验证，不能只在 UI 限制。管理员可走特殊 override，并记录原因和审计。

支持跨午夜。数据库统一 UTC，保留原时区；日统计按指定时区切片。

### 7.3 双栏编辑器

桌面：左侧表单，右侧日时间轴。时间轴支持拖拽选择、拖动、Resize；修改任一侧立即同步另一侧。

显示：

- 现有工作段
- 休息
- 当前编辑段
- 重叠冲突
- 可选个人参考工作窗口
- 已锁定不可改记录

移动端：使用分步/底部 Sheet，不挤压双栏。

### 7.4 状态机

`draft -> submitted -> pending_review -> approved | returned -> locked`

允许合理的回退路径，但必须由服务端状态机验证。

已结算记录不可直接编辑；进入 correction/amendment 流程，创建更正差异并影响下一次工资调整，而不是改掉历史快照。

---

## 8. 项目树 / 分支 / 回滚

使用 `@xyflow/react` 自定义节点。

必须实现：

- 大画布 pan/zoom
- fit view
- MiniMap（移动端可隐藏）
- 搜索定位
- collapse/expand
- tree/list/timeline 三视图
- 新建子节点
- 新建分支
- 分支独立发展
- 节点关联边
- 分支 merge/archive
- delete to recycle bin
- restore
- version history
- diff
- rollback
- progress bar
- assignee/avatar group
- status chips
- work session backlinks

结构编辑必须事务化并用 version 做并发控制。

进度模式：manual / weighted_children / milestone_based。AI 只能建议进度，用户确认后写入。

移动端项目树采用全屏 Canvas，顶部/右上角浮动控制，并提供列表视图兜底。

---

## 9. 组织架构

同样提供 tree/list 切换。树状视图风格参考用户提供的组织结构截图：大留白、细连接线、头像、身份标签、缩放控件、清晰层级。

支持部门 CRUD、拖拽移动、负责人、成员、归档、搜索定位。组织关系历史保留。

组织图和项目图可复用部分 Canvas primitives，但不能把两种业务数据混成一张表。

---

## 10. 日历

实现 Day / Week / Month / List。

员工个人日历：完整工作时间块；拖拽创建和调整未锁定记录。

管理人员：按权限查看 scope 内人员；普通员工不能通过日历查看他人完整工时。

月视图不要塞全文，显示摘要/总量；点击打开 Day Detail。

支持个人参考工作窗口、项目里程碑、结算节点的可选叠加层。

---

## 11. 审批

审批不是每天强制逐条审核。

实现：

- 提交前规则校验
- 异常标签
- 批量通过
- 退回并填写原因
- 管理修正（保留前后值）
- 工资结算前待审汇总
- 补录/重大时间异常/影响薪资较大记录优先
- 详情侧栏含证据、历史版本、工资影响预览

不能让 Owner 的直接修改覆盖员工原记录而无痕。

---

## 12. 薪资规则引擎

这是高风险模块，必须先写完整单元测试再实现 UI。

支持：

- hourly
- daily
- monthly
- fixed_period
- project_based
- hybrid

可选规则：

- weekday rate
- weekend rate
- holiday rate
- night window rate
- overtime threshold/multiplier
- allowance
- bonus
- deduction
- rounding increment
- minimum billable unit
- whether pending review counts in estimate

所有规则版本化并带 `effective_from/effective_to`。

默认组织可设置“每月 10 日结算上一个自然月”，但必须可配置。

实时预估工资：显示 approved + submitted/pending 的不同组成，并明确“预估”。

最终工资：只来自结算 snapshot。工资单必须可追溯到每个 component。

金额使用 Decimal，至少写这些测试：

- 0.1/0.2 浮点陷阱
- 跨周末
- 月中费率变更
- 跨午夜夜间区间
- 加班阈值
- 休息扣除
- 补录待审
- 负扣款
- 跨工资周期
- 已结算记录更正

---

## 13. 数据分析与 ECharts

建立统一 `AnalyticsFilterState`，所有图共享：

- dateRange
- granularity
- projectIds
- nodeIds
- workTypeIds
- approvalStates
- sourceTypes
- memberIds（按权限）
- orgUnitIds（按权限）
- payrollStatus

后端提供聚合 API，前端不能从大量原始记录自己重复算工资和复杂统计。

### 13.1 员工图表

至少实现：

- KPI cards
- 工时/收入/进度多轴时间序列
- 项目投入堆叠面积
- 24 小时工作节奏曲线（按小时/按天切换）
- Calendar heatmap
- Sankey：时间/项目/节点/类型/状态
- Funnel：记录→提交→审核→计薪→结算
- Salary waterfall
- donut/sunburst + 明细表
- cumulative hours/income
- approval status distribution
- forecast band（与事实视觉区分）

### 13.2 管理图表

- team workload distribution，不做排名
- department/project allocation
- project hours vs progress
- project cost vs forecast
- approval backlog
- anomaly category trend
- salary cycle cost forecast
- project branch risk/blocked nodes

### 13.3 每张图必须满足

- 使用真实 API 数据
- loading skeleton
- empty state
- error state
- legend toggle
- tooltip
- responsive resize
- long label strategy
- full screen
- data/image export
- click drill-down where meaningful
- brush/dataZoom where meaningful
- cross-filter linked highlighting where meaningful

写 visual regression/E2E：1440×900、1920×1080、390×844，确保无文字溢出、裁切、Tooltip 越界、图例遮挡。

图表旁优先提供可对账明细表，尤其金额/占比类。

---

## 14. AI：GLM Provider Adapter

不要把 AI 做成一个孤立聊天框。

实现 Provider Interface：

```ts
interface LlmProvider {
  healthCheck(): Promise<ProviderHealth>
  chat(req: StructuredChatRequest): Promise<StructuredChatResult>
  stream?(req: StructuredChatRequest): AsyncIterable<StreamChunk>
}
```

环境变量：

```text
ZHIPU_API_KEY=
ZHIPU_API_BASE_URL=
ZHIPU_MODEL=glm-4.7-flash
AI_ENABLED=true
```

模型能力与 Base URL 不要散落在业务代码，集中配置；启动/后台健康检查验证可用性。

AI 分四层：Record / Personal / Project / Organization Intelligence。

使用结构化输入：先由 SQL/规则引擎生成可信 metrics 和 relevant record IDs，再给模型解释。AI 不自行求和工资。

AI 输出记录：scope、time range、source IDs、prompt template version、model、generated_at、status。

UI：

- 独立 AI 工作洞察中心：左历史，中间大输入框 + 预设任务卡，右上下文助手。
- 项目/分析/工资等页面有右侧 Copilot，可自动带当前页面筛选。
- AI 结果提供“查看依据”。
- AI 提议修改时只生成 proposal，用户确认后通过正常 API 写入。

后台任务：排队、取消、重试、幂等、缓存、超时、限流、失败不影响核心业务。

预设任务：

- 总结今日/本周/月度工作
- 汇总项目进展
- 跟踪任务/分支状态
- 找出项目阻塞
- 分析工作节奏
- 解释工资变化
- 生成周报/月报
- 总结团队周报（管理权限）

---

## 15. 提醒引擎

提醒先由确定性规则处理，再允许 AI 做解释。

规则包括：

- 可能忘记填工作
- timer 长时间未结束
- work session overlap
- 连续工作偏长
- 近期时长相对个人基线显著变化
- 休息间隔过短
- project due soon
- blocked node aging
- approval returned
- payroll cutoff pending review
- identity/permission request result
- export/AI job finished

每条 reminder 有：severity、channel、dedupe key、cooldown、valid_until、action URL。

用户设置：

- 站内开关
- 浏览器 Push 开关
- 类别开关
- quiet hours
- “本次忽略”
- “不再提醒此类”

避免医疗化文案。使用“可能”“确认一下”“基于近期记录”等表达。

---

## 16. 证据/文件

支持上传：图片、视频、音频、PDF、Office、文本、CSV/JSON、压缩包、代码/日志等；另支持 URL、GitHub/GitLab 链接、纯文本证据。

对象存储私有；使用 presigned URL。不要在服务器运行目录永久保存文件。

不要自动执行、解压或渲染未知可执行文件。

文件元数据与版本必须审计。

UI：普通列表/文件树为主；图片证据可选 Masonry；多附件可用 Stack/Folder 视觉组件，但最终必须能进入真实可搜索列表。

---

## 17. UI 设计系统

整体：现代个人工作台，不做传统拥挤 OA。

- 默认浅色
- 深色模式
- System 模式
- 可配置 Accent Color
- 清晰留白
- 轻阴影
- 10–16px 圆角层级
- 统一 4/8px spacing system
- 数据密集区域保持高可读性
- 字体优先系统字体/中文无衬线
- 状态色语义固定，不受 Accent Color 完全覆盖

桌面主框架：左侧 Sidebar + 顶部 Command Bar + Main + 可选 Right AI Panel。

移动端：Bottom Nav + FAB/Quick Action + Sheet/Drawer。

必须支持 `prefers-reduced-motion`。

---

## 18. 将参考界面高质量融入，而不是照抄

用户提供 10 类截图，必须采用这些“交互规律”：

1. 组织树：树/列表切换、大画布、头像节点、连接线、缩放；用于组织和项目。
2. 仪表盘：卡片网格、顶部筛选、全屏图、AI 解读；用于分析。
3. 左表单右时间轴：用于工作记录编辑器。
4. 智能总结：首页式大输入 + 预设任务卡 + 历史；用于 AI 中心。
5. 月历：日/周/月/列表切换 + 迷你日历；用于工作日历。
6. 内容列表 + 右 AI：用于 AI 历史/证据聚合/上下文 Copilot。
7. 占比图 + 明细表：用于项目/工作类型/成本结构。
8. 流转宽带：用于 Sankey/审批/计薪/项目投入路径。
9. 多轴趋势 + 精确 Tooltip：用于工时/收入/进度。
10. 移动树：用于移动端项目/组织全屏画布。

不要复制品牌 Logo、业务名、销售排行等不相关元素。

---

## 19. 用户提供的前端组件包：采用策略

如果仓库中存在该组件资料，必须**读取实际文件内容后再使用，不能按文件名猜**。

已确认适合正式工作台的组件/模式：

- Sidebar (44)：主侧边栏基础
- Files (45)：文件树
- Stepper (37)：复杂配置/导入
- Avatar Group (42)：项目成员
- AnimatedList (18)：动态/通知
- MagicBento (21)：只借鉴卡片 grid 与轻焦点反馈，降低光效
- BorderGlow (32)：仅正在计时/AI 处理中/需处理异常
- Folder (28)：多附件入口
- Masonry (25)：图片证据画廊
- Stack (23)：多附件缩略
- LineSidebar (17)：长页/项目二级索引，不做主导航
- Carousel (31)：仅移动窄屏 KPI 横滑
- Code (43)：代码证据展示，不用妨碍复制的打字动画

可极少量：TextType、RotatingText、ScrollReveal、ScrollFloat，只用于登录/引导/空状态。

不要用于正式业务页：TextPressure、FallingText、VariableProximity、OrbitImages、MagicRings、LaserFlow、Strands/Siri 球、ShapeBlur、ImageTrail、CircularGallery、TiltedCard、DomeGallery、ChromaGrid、ProfileCard、FlyingPosters、DecayCard、InfiniteMenu、Lightfall、WebGL Radar、Particles、PixelSnow 等。

不要把整个 Anime.js 源码仓库直接复制到应用。优先 Motion + CSS，避免 Motion/GSAP/Anime.js 三套动画同时存在。若移植任何第三方源码，检查并保留兼容许可证/NOTICE。

---

## 20. 今日首页具体布局

桌面大致顺序：

1. 顶部：日期、快速记录、当前 timer、通知
2. 第一行：正在计时 / 今日净工时 / 待提交与待审 / 预计工资
3. 第二行：今日时间轴（大卡） + 智能提醒
4. 第三行：项目推进 + 团队动态
5. 第四行：工时/收入短趋势 + AI 一句话洞察

允许用户拖拽布局，但核心工作入口不可完全删除。

移动：

- timer 置顶
- 今日 KPI 横滑
- Quick record
- 时间轴
- 项目推进
- 提醒/动态

---

## 21. 团队动态与最后工作活动

普通成员的 member card/API 公开字段示例：

```ts
{
  id,
  displayName,
  avatar,
  professionalIdentities,
  sharedProjects,
  lastWorkActivity: {
    endedAt,
    contentSummary,
    projectId,
    projectNodeId
  }
}
```

不要返回 `startAt/netSeconds/payRate/salary`。

当最新记录不可见时，选择当前查看者有权限看到的上一条记录。

---

## 22. 实时同步、离线和冲突

WebSocket 事件示例：

- work_session.created/updated/submitted/approved
- timer.started/paused/resumed/stopped
- project.node.updated
- project.structure.changed
- payroll.estimate.changed
- notification.created
- ai_job.completed

事件包含 entity id + version，不把敏感实体完整广播给不相关用户。

客户端断线重连后先做增量 sync 或 refetch，不认为错过的 WebSocket 就永远丢失。

编辑实体使用 optimistic concurrency；冲突返回 409 + serverVersion + clientBaseVersion + diff hints。

离线只允许安全草稿和 timer 恢复，不允许离线执行薪资结算/权限更改等高风险操作。

---

## 23. 导入、导出和报告

导入：CSV/XLSX 工作记录模板，先 preview + validation，用户确认后 batch transaction；错误行可下载。

导出：CSV/XLSX/PDF/JSON，后台生成并通知。支持：工时、项目投入、工资单、审批、图表数据、AI 报告。

导出必须遵守服务端权限和字段脱敏。

---

## 24. PWA 与浏览器通知

- manifest
- installable PWA
- service worker
- app shell cache
- offline fallback
- IndexedDB drafts
- VAPID Web Push
- Push subscription lifecycle
- 不把工资详情长期缓存到公开 Cache Storage

浏览器不支持 Push 时，站内通知仍然正常。

---

## 25. Render 部署要求

创建 `render.yaml`，至少可配置：

- Web Service
- Worker
- Postgres

静态资源可以由 Web Service 同源托管，或使用 Render Static Site；优先选择能最小化 CORS/Cookie/WebSocket 复杂度的架构。

要求：

- bind `0.0.0.0:$PORT`
- health endpoint `/healthz`
- readiness `/readyz`
- DB migration 在安全阶段执行
- secrets 仅环境变量
- production 禁止使用本地 filesystem 存附件
- WebSocket keepalive + reconnect
- graceful shutdown
- worker idempotency
- GitHub main 通过 CI 才触发生产部署

正式生产不要依赖会闲置休眠的免费 Web Service。

---

## 26. 安全要求

必须实现：

- Argon2id
- secure cookie
- CSRF protection
- rate limiting
- brute-force protection
- input validation
- output encoding
- file MIME/size validation
- presigned object access
- no secrets in logs
- audit trail
- least privilege DB/service accounts where possible
- SQL injection protection via ORM/parameterized queries
- XSS prevention in rich text/markdown rendering
- authorization tests

支持软删除和回收站。Owner、薪资、权限操作需要更严格审计。

---

## 27. 测试体系

不要等最后再补测试。

### Unit

- duration calculation
- overlap
- break subtraction
- timezone split
- payroll engine
- permissions
- reminder dedupe
- progress roll-up

### Integration

- auth/session
- work CRUD/state machine
- project branch/version/rollback
- approval
- payroll run
- object metadata
- AI job fallback
- export

### E2E (Playwright)

至少覆盖：

1. Owner 初始化组织、邀请成员。
2. 员工登录→开始 timer→休息→结束→上传证据→提交。
3. 员工补录跨午夜记录。
4. 管理人员审核。
5. Owner 配薪资规则→员工看到预估→结算→员工查看明细。
6. 项目节点新建分支→关联工作→回滚。
7. 同项目员工看公开动态但无法看工时工资。
8. 手机宽度完整走一遍工作记录流程。
9. WebSocket 多端同步。
10. AI 不可用时核心业务不受影响。

### Visual/Chart Regression

至少：1440×900、1920×1080、390×844。

检查：无 overflow、无裁切、无重叠、Tooltip 不出屏、Legend 不遮挡、Tree controls 可达。

### Accessibility

使用 axe 或等价工具；关键路径键盘可用；`prefers-reduced-motion` 有效。

---

## 28. Seed 数据

提供可重复 seed：1 Owner、2 Managers、约 15–20 Employees、多个专业身份、3–5 项目、复杂项目分支、跨午夜工时、休息、审批、不同薪资规则、附件元数据、提醒和 AI 报告示例。

Seed 仅用于开发/测试。生产初始化不得自动插入假数据。

所有图表在开发环境可由 seed 展示，但生产必须严格使用真实数据库。

---

## 29. UI 质量底线

不要：

- 满屏玻璃拟态
- 大量粒子/3D/GPU 背景
- 夸张光效
- 强制 typewriter AI 输出
- 隐藏重要信息的轮播
- Hover 才能完成核心操作
- 超小点击区域
- 只有图无表的金额分析
- 复制参考截图品牌皮肤

要：

- 一致的 spacing
- 一致的 empty/loading/error
- 合理 skeleton
- 快捷键/command palette（可选但建议）
- destructive action 二次确认 + 可恢复
- toast 不代替重要状态
- 长任务显示后台状态
- 表格 sticky header + virtual list
- Mobile touch target >= 44px

---

## 30. 开发顺序（内部执行，不是缩减范围）

虽然目标是一次完成正式版，但实现顺序必须控制依赖：

1. Monorepo/CI/config/design system
2. DB schema + migrations + auth + permission
3. Work sessions + timer + breaks + evidence metadata
4. Projects tree/branch/version
5. Approval
6. Payroll engine + tests
7. Calendar + dashboard
8. Analytics APIs + ECharts
9. AI provider + worker
10. Reminder/Push
11. Org admin + payroll admin
12. Import/export
13. PWA/offline/realtime hardening
14. Security/audit
15. Full E2E/visual/a11y/performance
16. render.yaml + deployment docs + production readiness

每一阶段完成后继续下一阶段，不要只输出 TODO。

---

## 31. 完成定义（Definition of Done）

只有同时满足以下条件才算完成：

- `pnpm install`、`pnpm dev`、`pnpm build` 文档明确且可执行。
- migrations 和 seed 可执行。
- 所有核心页面不是静态假 UI，而是连接真实 API/DB。
- 关键测试通过。
- lint/typecheck/test/build 通过。
- 角色越权测试通过。
- 工资计算可对账。
- 图表与明细一致。
- 项目树可分支、删除、恢复、回滚。
- 同项目公开动态规则正确。
- WebSocket 多端同步可恢复。
- PWA 可安装。
- Render 配置完整。
- README 包含本地开发、环境变量、部署、备份、故障恢复。
- 没有真实密钥、密码、Token 或测试敏感信息提交到 Git。

---

## 32. 你现在应该执行

1. 先审查当前仓库状态并输出一个很短的实施摘要到终端/工作日志，不要用长篇计划替代开发。
2. 建立/修正架构与数据库。
3. 按上面的正式版范围持续实现。
4. 每完成关键模块立即运行测试并修复。
5. 对 UI 进行真实浏览器验收，不仅凭代码判断。
6. 对图表做多尺寸截图/视觉回归检查。
7. 对项目树做大数据量交互测试。
8. 对工资做边界测试。
9. 最后给出：已完成模块、测试结果、部署步骤、仍需用户提供的生产外部凭据（例如对象存储、SMTP/SMS、GLM API Key），除此之外不要把未完成业务功能推给用户。

最终目标是一个真正能让约 20 人日常使用、数据可信、权限清晰、薪资可解释、项目能演进、AI 能辅助、图表能分析、移动端完整可用的正式工作台。
