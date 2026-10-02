# 前端组件与交互入口追踪清单

由 `node scripts/audit-ui-interactions.mjs` 从 TypeScript AST 生成。数字是源码入口数，循环中的多个实例不重复计数；不是业务功能完成率。

公共运行层为实际挂载的按钮、链接、输入、选择、折叠、表单、卡片、详情面板、状态和指标分配当前实例标识；门户中的图表和弹层同样覆盖。标识不包含成员、薪资、输入值或请求正文。

扫描 27 个 TSX 文件；操作入口 390，字段 238，容器 248，折叠入口 58。

| 模块 | 操作 | 字段 | 容器 | 折叠 |
| --- | ---: | ---: | ---: | ---: |
| apps/web/src/accent-picker.tsx | 1 | 3 | 0 | 0 |
| apps/web/src/analytics-chart.tsx | 3 | 0 | 0 | 2 |
| apps/web/src/app.tsx | 1 | 0 | 1 | 0 |
| apps/web/src/calendar-workbench.tsx | 10 | 0 | 8 | 2 |
| apps/web/src/error-boundary.tsx | 2 | 0 | 1 | 0 |
| apps/web/src/fact-explorer.tsx | 8 | 2 | 3 | 2 |
| apps/web/src/history-range.tsx | 2 | 3 | 1 | 0 |
| apps/web/src/interaction-system.tsx | 3 | 0 | 0 | 0 |
| apps/web/src/lifecycle-workbench.tsx | 18 | 4 | 3 | 16 |
| apps/web/src/main.tsx | 0 | 0 | 0 | 0 |
| apps/web/src/organization-workbench.tsx | 28 | 26 | 22 | 6 |
| apps/web/src/pages.tsx | 184 | 138 | 171 | 14 |
| apps/web/src/payroll-period-list.tsx | 5 | 0 | 1 | 0 |
| apps/web/src/payroll-workspace.tsx | 4 | 0 | 1 | 0 |
| apps/web/src/project-canvas.tsx | 5 | 0 | 0 | 0 |
| apps/web/src/project-workbench.tsx | 55 | 41 | 27 | 8 |
| apps/web/src/reimbursement-panel.tsx | 10 | 7 | 3 | 2 |
| apps/web/src/shell.tsx | 34 | 3 | 1 | 0 |
| apps/web/src/submission-policy.tsx | 3 | 5 | 2 | 2 |
| apps/web/src/work-progress-reporter.tsx | 4 | 4 | 1 | 0 |
| apps/web/src/work-recovery.tsx | 4 | 0 | 0 | 2 |
| apps/web/src/work-review.tsx | 3 | 2 | 1 | 2 |
| apps/web/src/workspace-navigation.tsx | 1 | 0 | 0 | 0 |
| apps/web/src/workspace-primitives.tsx | 1 | 0 | 0 | 0 |
| packages/ui/src/badge.tsx | 0 | 0 | 0 | 0 |
| packages/ui/src/button.tsx | 1 | 0 | 0 | 0 |
| packages/ui/src/card.tsx | 0 | 0 | 1 | 0 |

## 组件索引

### apps/web/src/accent-picker.tsx

- AccentPicker (L27)

### apps/web/src/analytics-chart.tsx

- AnalyticsChart (L63)

### apps/web/src/app.tsx

- AppConnectionState (L60)
- App (L117)

### apps/web/src/calendar-workbench.tsx

- MiniCalendar (L164)
- CalendarEvent (L224)
- CalendarMilestone (L267)
- CalendarPage (L299)

### apps/web/src/fact-explorer.tsx

- FactExplorer (L12)
- RecordReadiness (L40)

### apps/web/src/history-range.tsx

- HistoricalRangePicker (L6)

### apps/web/src/interaction-system.tsx

- InteractionProvider (L13)
- WorkspaceOrientation (L30)
- MotionSettings (L63)

### apps/web/src/lifecycle-workbench.tsx

- QueryFailure (L13)
- CycleOverview (L24)
- WorkFactContext (L53)
- CitedText (L73)
- AiFactAnswer (L86)
- AiDraftEditor (L91)
- PayrollHandoffPanel (L113)

### apps/web/src/organization-workbench.tsx

- ManualCapabilityLink (L214)
- CategoryLabel (L282)
- UnitTree (L297)
- LayerChip (L388)
- MemberLayerSummary (L400)
- MemberInspector (L466)
- UnitInspector (L1342)
- OrganizationSidebar (L1521)
- OrganizationPage (L2120)

### apps/web/src/pages.tsx

- PasswordInput (L102)
- AnalyticsChart (L171)
- ProjectCanvas (L188)
- LoginPage (L345)
- SecurityPage (L578)
- NotificationPreferencesPage (L1537)
- ImportPage (L1867)
- PasswordResetRequestPage (L2063)
- ExistingSessionHandoff (L2128)
- PasswordResetPage (L2174)
- VerifyContactPage (L2258)
- AuthFrame (L2324)
- SetupPage (L2396)
- InvitationPage (L2552)
- WorkVersionHistory (L2759)
- DirectEvidenceFields (L3065)
- HomePage (L3165)
- StatusLine (L3424)
- WorkRow (L3433)
- WorkDayTimeline (L3522)
- EvidenceInlinePreview (L3695)
- EvidenceTextPreview (L3740)
- LocalEvidenceFilePreview (L3750)
- EvidenceFileActions (L3803)
- EvidencePanel (L3822)
- ReadOnlyEvidenceList (L4531)
- TimerProjectAssociation (L4616)
- WorkPage (L4823)
- ProjectsPage (L6942)
- LegacyProjectDetailPage (L7153)
- ApprovalsPage (L7484)
- PayrollManagementPanel (L8228)
- PayrollPage (L8877)
- LegacyCalendarPageV2 (L9546)
- LegacyCalendarPage (L9946)
- TeamPage (L10122)
- BackgroundExportPanel (L10462)
- AnalyticsPage (L10721)
- Metric (L11529)
- AiSettingsPanel (L11682)
- AiSettingsEditor (L11729)
- AiPage (L12088)
- InsightList (L12677)
- LegacyOrganizationPage (L12729)
- NotFoundPage (L13050)

### apps/web/src/payroll-period-list.tsx

- PayrollPeriodList (L15)

### apps/web/src/payroll-workspace.tsx

- AccessUnavailable (L12)
- PersonalPayrollWorkspace (L19)
- PayrollManagementWorkspace (L40)
- PayrollHandoffPage (L57)
- ReimbursementsPage (L81)
- WorkPolicyPage (L95)

### apps/web/src/project-canvas.tsx

- ProjectCanvas (L175)

### apps/web/src/project-workbench.tsx

- RelationTargetPicker (L312)
- AssigneeAvatarGroup (L492)
- Timeline (L538)
- TreeList (L714)
- ProjectOverview (L829)
- ProjectBranchRail (L894)
- WorkSessionEvidence (L952)
- ProjectTeamPanel (L993)
- NodeInspectorContent (L1258)
- NodeInspector (L2169)
- ProjectDetailPage (L2206)

### apps/web/src/reimbursement-panel.tsx

- ReimbursementPanel (L25)

### apps/web/src/shell.tsx

- CommandPalette (L411)
- AppShell (L589)

### apps/web/src/submission-policy.tsx

- WorkPolicyPanel (L8)

### apps/web/src/work-progress-reporter.tsx

- WorkProgressReporter (L16)

### apps/web/src/work-recovery.tsx

- DraftArchiveButton (L6)
- ArchivedDrafts (L12)

### apps/web/src/work-review.tsx

- WorkReviewDraft (L8)

### apps/web/src/workspace-navigation.tsx

- WorkspaceNavigation (L8)
- ApprovalNavigation (L22)

### apps/web/src/workspace-primitives.tsx

- PageHeader (L7)
- Field (L33)
- EmptyState (L61)
- ErrorMessage (L86)
- LoadingBlock (L103)

### packages/ui/src/badge.tsx

- Badge (L17)

### packages/ui/src/button.tsx

- Button (L38)

### packages/ui/src/card.tsx

- Card (L5)
- CardHeader (L18)
- CardContent (L34)

## 动态覆盖验证

`tests/live/workspace.spec.ts` 在真实 API、数据库与文件服务下遍历管理员和员工页面，导出每个可见控件的实例标识、类型、尺寸和业务入口，并断言没有未注册的可交互控件。结果保存到每种尺寸的 `rendered-controls.json`。
`interaction-controller.test.ts` 检查请求归属、并发、迟到完成、真实指标变化、原生校验与清理；浏览器回归检查手机、键盘、动效偏好和跨页编辑。独立业务控件的权限、持久化和业务规则仍由各自业务测试验证。
