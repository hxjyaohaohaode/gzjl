# 权限与数据范围

## 结论

权限判断只在 API 服务端进行。前端的菜单隐藏、路由守卫和筛选器仅改善使用体验，不能作为授权依据。每个授权由 `permission + scopeKind + scopeId` 组成；组织级授权可覆盖下级范围，项目和组织单元授权只匹配明确的同一对象。

## 内置职责

|职责|典型能力|数据范围|
|---|---|---|
|Owner|组织、成员、角色、薪资配置和结算、审计|组织|
|Manager|项目维护、工时审核、团队分析、范围内导出|组织单元或项目|
|Member|本人计时、手工补录、证据、查看个人薪资|self|

真正生效的能力来自角色的 grant，而不是角色名称。Owner 可以用 `roles.manage` 将单项能力授予项目或组织单元，并在成员停用时撤销授权。

## 关键权限

|权限|用途|
|---|---|
|`project.create` / `project.manage`|创建项目、维护节点、分支、边和版本|
|`work.view_own` / `work.view_project_public` / `work.view_full_scope`|本人、项目公开或完整范围内的工时读取|
|`work.review`|提交审核决定；服务端禁止审批人审批自己提交的记录|
|`evidence.view_management`|读取管理范围证据；私有证据不会因该权限而公开|
|`payroll.view_own` / `payroll.view_scope` / `payroll.configure` / `payroll.settle`|个人薪资、范围薪资、规则配置与锁定结算|
|`analytics.view_team` / `ai.team_analysis`|范围内聚合分析与 AI 洞察请求|
|`audit.view` / `export.scope`|审计查询和按既有范围过滤后的导出|

## 数据收敛顺序

1. 身份验证取得会话中的组织、成员和 grant 快照。
2. 服务端先将 grant 编译为组织单元、项目或本人范围的 SQL 条件。
3. 数据查询应用该条件，再应用日期、状态等业务筛选。
4. 对内容、结果和证据再应用字段可见性；无权字段不会在响应中返回。
5. 导出、AI、看板和实时事件复用同一范围逻辑，不另建“管理员全量读取”的旁路。

## 证据的特殊规则

证据可见性为 `private`、`management_only` 或 `project_visible`。对象存储 bucket 永不公开；文件直传和下载均为短时预签名 URL。替换与删除写审计日志，替换前的哈希、对象键和版本快照保存在 `attachment_versions`，以便追踪，不会被常规列表返回。
