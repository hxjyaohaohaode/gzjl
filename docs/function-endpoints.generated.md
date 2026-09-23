# 可复查的服务入口全集

由 `node scripts/audit-inventory.mjs` 从 TypeScript AST 生成，禁止手工更改。这里只证明代码注册了入口；不代表需求完整或所有分支已通过测试。权限还可能在服务内部按数据范围检查，状态码还受认证、限流、CSRF 和统一错误处理影响。

当前包含 **162 个服务入口、17 个注册文件**。前端功能、异步模式、隐性需求和验收状态见 [全量功能与需求核验](./functional-audit-2026-09-22.md)。

## apps/server/src/ai/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/ai/reports` | authenticate | 默认 200；其余见统一错误处理 | [140](../apps/server/src/ai/routes.ts#L140) |
| GET | `/api/ai/reports/:reportId` | authenticate | 404 | [145](../apps/server/src/ai/routes.ts#L145) |
| POST | `/api/ai/reports` | [app.csrfProtection, authenticate] | 202 / 403 / 429 / 503 | [157](../apps/server/src/ai/routes.ts#L157) |
| POST | `/api/ai/jobs/:jobId/cancel` | [app.csrfProtection, authenticate] | 404 / 409 | [222](../apps/server/src/ai/routes.ts#L222) |
| POST | `/api/ai/jobs/:jobId/retry` | [app.csrfProtection, authenticate] | 202 / 404 / 409 / 429 / 503 | [240](../apps/server/src/ai/routes.ts#L240) |
| GET | `/api/ai/settings` | authenticate | 默认 200；其余见统一错误处理 | [264](../apps/server/src/ai/routes.ts#L264) |
| PUT | `/api/ai/settings` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [275](../apps/server/src/ai/routes.ts#L275) |
| GET | `/api/ai/settings/checks` | authenticate | 默认 200；其余见统一错误处理 | [293](../apps/server/src/ai/routes.ts#L293) |
| POST | `/api/ai/settings/check` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [304](../apps/server/src/ai/routes.ts#L304) |

## apps/server/src/analytics/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/analytics/summary` | authenticate | 默认 200；其余见统一错误处理 | [51](../apps/server/src/analytics/routes.ts#L51) |
| GET | `/api/team-activity` | authenticate | 默认 200；其余见统一错误处理 | [69](../apps/server/src/analytics/routes.ts#L69) |

## apps/server/src/app.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/healthz` | 见处理器及全局钩子 | 默认 200；其余见统一错误处理 | [184](../apps/server/src/app.ts#L184) |
| GET | `/readyz` | 见处理器及全局钩子 | 503 | [190](../apps/server/src/app.ts#L190) |
| GET | `/api/auth/csrf` | 见处理器及全局钩子 | 默认 200；其余见统一错误处理 | [203](../apps/server/src/app.ts#L203) |

## apps/server/src/approvals/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/approvals` | readHooks | 默认 200；其余见统一错误处理 | [46](../apps/server/src/approvals/routes.ts#L46) |
| POST | `/api/approvals/:requestId/decision` | writeHooks | 404 / 409 | [51](../apps/server/src/approvals/routes.ts#L51) |
| POST | `/api/approvals/:requestId/corrections` | writeHooks | 404 / 409 | [67](../apps/server/src/approvals/routes.ts#L67) |

## apps/server/src/auth/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | app.csrfProtection | 202 / 401 / 423 | [153](../apps/server/src/auth/routes.ts#L153) |
| POST | `/api/auth/login/mfa` | app.csrfProtection | 401 | [197](../apps/server/src/auth/routes.ts#L197) |
| POST | `/api/auth/logout` | [app.csrfProtection, authenticate] | 204 | [225](../apps/server/src/auth/routes.ts#L225) |
| GET | `/api/auth/mfa/totp` | authenticate | 默认 200；其余见统一错误处理 | [235](../apps/server/src/auth/routes.ts#L235) |
| POST | `/api/auth/mfa/totp/setup` | [app.csrfProtection, authenticate] | 409 | [241](../apps/server/src/auth/routes.ts#L241) |
| POST | `/api/auth/mfa/totp/confirm` | [app.csrfProtection, authenticate] | 409 | [254](../apps/server/src/auth/routes.ts#L254) |
| DELETE | `/api/auth/mfa/totp` | [app.csrfProtection, authenticate] | 401 | [268](../apps/server/src/auth/routes.ts#L268) |
| GET | `/api/auth/credentials` | authenticate | 默认 200；其余见统一错误处理 | [282](../apps/server/src/auth/routes.ts#L282) |
| POST | `/api/auth/credentials` | [app.csrfProtection, authenticate] | 202 | [288](../apps/server/src/auth/routes.ts#L288) |
| POST | `/api/auth/credentials/:credentialId/resend` | [app.csrfProtection, authenticate] | 202 | [315](../apps/server/src/auth/routes.ts#L315) |
| DELETE | `/api/auth/credentials/:credentialId` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [341](../apps/server/src/auth/routes.ts#L341) |
| POST | `/api/auth/credentials/verify` | app.csrfProtection | 默认 200；其余见统一错误处理 | [358](../apps/server/src/auth/routes.ts#L358) |
| POST | `/api/auth/password-reset/request` | app.csrfProtection | 202 | [374](../apps/server/src/auth/routes.ts#L374) |
| POST | `/api/auth/password-reset/complete` | app.csrfProtection | 409 | [406](../apps/server/src/auth/routes.ts#L406) |
| GET | `/api/me` | authenticate | 默认 200；其余见统一错误处理 | [422](../apps/server/src/auth/routes.ts#L422) |
| POST | `/api/auth/sessions/revoke-others` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [440](../apps/server/src/auth/routes.ts#L440) |

## apps/server/src/evidence/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/evidence/capabilities` | authenticate | 默认 200；其余见统一错误处理 | [86](../apps/server/src/evidence/routes.ts#L86) |
| POST | `/api/work-sessions/:sessionId/attachments/upload-intent` | [app.csrfProtection, authenticate] | 201 | [92](../apps/server/src/evidence/routes.ts#L92) |
| POST | `/api/reimbursements/:sessionId/attachments/upload-intent` | [app.csrfProtection, authenticate] | 201 | [92](../apps/server/src/evidence/routes.ts#L92) |
| POST | `/api/attachments/:attachmentId/complete` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [108](../apps/server/src/evidence/routes.ts#L108) |
| POST | `/api/attachments/:attachmentId/upload-url` | [app.csrfProtection, authenticate] | 201 | [121](../apps/server/src/evidence/routes.ts#L121) |
| POST | `/api/attachments/:attachmentId/replacement-intent` | [app.csrfProtection, authenticate] | 201 | [136](../apps/server/src/evidence/routes.ts#L136) |
| POST | `/api/work-sessions/:sessionId/attachments/reference` | [app.csrfProtection, authenticate] | 201 | [152](../apps/server/src/evidence/routes.ts#L152) |
| POST | `/api/reimbursements/:sessionId/attachments/reference` | [app.csrfProtection, authenticate] | 201 | [152](../apps/server/src/evidence/routes.ts#L152) |
| PATCH | `/api/attachments/:attachmentId` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [168](../apps/server/src/evidence/routes.ts#L168) |
| GET | `/api/work-sessions/:sessionId/attachments` | authenticate | 默认 200；其余见统一错误处理 | [188](../apps/server/src/evidence/routes.ts#L188) |
| GET | `/api/reimbursements/:sessionId/attachments` | authenticate | 默认 200；其余见统一错误处理 | [188](../apps/server/src/evidence/routes.ts#L188) |
| GET | `/api/attachments/:attachmentId/download` | authenticate | 默认 200；其余见统一错误处理 | [202](../apps/server/src/evidence/routes.ts#L202) |
| GET | `/api/attachments/:attachmentId/content` | authenticate | 默认 200；其余见统一错误处理 | [215](../apps/server/src/evidence/routes.ts#L215) |
| GET | `/api/attachments/:attachmentId/open` | authenticate | 默认 200；其余见统一错误处理 | [223](../apps/server/src/evidence/routes.ts#L223) |
| GET | `/api/attachments/:attachmentId/versions` | authenticate | 默认 200；其余见统一错误处理 | [239](../apps/server/src/evidence/routes.ts#L239) |
| DELETE | `/api/attachments/:attachmentId` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [252](../apps/server/src/evidence/routes.ts#L252) |

## apps/server/src/notifications/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/notifications` | authenticate | 默认 200；其余见统一错误处理 | [146](../apps/server/src/notifications/routes.ts#L146) |
| POST | `/api/notifications/read-all` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [197](../apps/server/src/notifications/routes.ts#L197) |
| POST | `/api/notifications/:notificationId/read` | [app.csrfProtection, authenticate] | 404 | [235](../apps/server/src/notifications/routes.ts#L235) |
| POST | `/api/notifications/:notificationId/unread` | [app.csrfProtection, authenticate] | 404 | [275](../apps/server/src/notifications/routes.ts#L275) |
| POST | `/api/notifications/:notificationId/handled` | [app.csrfProtection, authenticate] | 404 | [315](../apps/server/src/notifications/routes.ts#L315) |
| POST | `/api/notifications/:notificationId/ignore` | [app.csrfProtection, authenticate] | 404 | [343](../apps/server/src/notifications/routes.ts#L343) |
| GET | `/api/notification-preferences` | authenticate | 默认 200；其余见统一错误处理 | [371](../apps/server/src/notifications/routes.ts#L371) |
| PUT | `/api/notification-preferences/quiet-hours` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [387](../apps/server/src/notifications/routes.ts#L387) |
| PUT | `/api/notification-preferences` | [app.csrfProtection, authenticate] | 409 | [416](../apps/server/src/notifications/routes.ts#L416) |
| GET | `/api/push/configuration` | authenticate | 默认 200；其余见统一错误处理 | [474](../apps/server/src/notifications/routes.ts#L474) |
| POST | `/api/push/subscriptions` | [app.csrfProtection, authenticate] | 201 / 503 | [509](../apps/server/src/notifications/routes.ts#L509) |
| DELETE | `/api/push/subscriptions` | [app.csrfProtection, authenticate] | 204 / 404 | [618](../apps/server/src/notifications/routes.ts#L618) |

## apps/server/src/operations/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/exports/capabilities` | [authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [32](../apps/server/src/operations/routes.ts#L32) |
| POST | `/api/exports` | [app.csrfProtection, authenticate, requireScopedExport] | 202 | [34](../apps/server/src/operations/routes.ts#L34) |
| GET | `/api/exports` | [authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [48](../apps/server/src/operations/routes.ts#L48) |
| GET | `/api/exports/:exportId/download` | [authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [50](../apps/server/src/operations/routes.ts#L50) |
| POST | `/api/exports/:exportId/retry` | [app.csrfProtection, authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [60](../apps/server/src/operations/routes.ts#L60) |
| DELETE | `/api/exports/:exportId` | [app.csrfProtection, authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [69](../apps/server/src/operations/routes.ts#L69) |
| GET | `/api/exports/work-sessions.csv` | [authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [78](../apps/server/src/operations/routes.ts#L78) |
| GET | `/api/exports/work-sessions.json` | [authenticate, requireScopedExport] | 默认 200；其余见统一错误处理 | [83](../apps/server/src/operations/routes.ts#L83) |
| POST | `/api/imports/work-sessions/preview` | [app.csrfProtection, authenticate, requireOrgImport] | 400 | [88](../apps/server/src/operations/routes.ts#L88) |
| POST | `/api/imports/:importId/confirm` | [app.csrfProtection, authenticate, requireOrgImport] | 409 | [97](../apps/server/src/operations/routes.ts#L97) |
| GET | `/api/audit` | [authenticate, requirePermission("audit.view", () => ({ scopeKind: "organization" }))] | 默认 200；其余见统一错误处理 | [107](../apps/server/src/operations/routes.ts#L107) |

## apps/server/src/organization/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/organization` | [authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [236](../apps/server/src/organization/routes.ts#L236) |
| GET | `/api/organization/invitation-delivery-capabilities` | [authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [241](../apps/server/src/organization/routes.ts#L241) |
| POST | `/api/organization/units` | [app.csrfProtection, authenticate, manageOrg] | 201 | [246](../apps/server/src/organization/routes.ts#L246) |
| PATCH | `/api/organization/units/:unitId` | [app.csrfProtection, authenticate, manageOrg] | 默认 200；其余见统一错误处理 | [262](../apps/server/src/organization/routes.ts#L262) |
| POST | `/api/organization/units/:unitId/archive` | [app.csrfProtection, authenticate, manageOrg] | 默认 200；其余见统一错误处理 | [282](../apps/server/src/organization/routes.ts#L282) |
| POST | `/api/organization/professional-identities` | [app.csrfProtection, authenticate, manageOrg] | 201 | [300](../apps/server/src/organization/routes.ts#L300) |
| GET | `/api/organization/ownership-transfers/pending-for-me` | authenticate | 默认 200；其余见统一错误处理 | [316](../apps/server/src/organization/routes.ts#L316) |
| GET | `/api/organization/my-identities` | authenticate | 默认 200；其余见统一错误处理 | [325](../apps/server/src/organization/routes.ts#L325) |
| POST | `/api/organization/my-identities/requests` | [app.csrfProtection, authenticate] | 201 | [336](../apps/server/src/organization/routes.ts#L336) |
| GET | `/api/organization/identity-change-requests` | [authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [352](../apps/server/src/organization/routes.ts#L352) |
| POST | `/api/organization/identity-change-requests/:requestId/review` | [app.csrfProtection, authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [359](../apps/server/src/organization/routes.ts#L359) |
| POST | `/api/organization/ownership-transfers` | [app.csrfProtection, authenticate, manageOrg] | 201 | [377](../apps/server/src/organization/routes.ts#L377) |
| POST | `/api/organization/ownership-transfers/:transferId/confirm` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [402](../apps/server/src/organization/routes.ts#L402) |
| POST | `/api/organization/ownership-transfers/:transferId/cancel` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [428](../apps/server/src/organization/routes.ts#L428) |
| POST | `/api/organization/invitations` | [app.csrfProtection, authenticate, manageMembers] | 201 | [445](../apps/server/src/organization/routes.ts#L445) |
| POST | `/api/organization/invitations/:membershipId/resend` | [app.csrfProtection, authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [467](../apps/server/src/organization/routes.ts#L467) |
| DELETE | `/api/organization/invitations/:membershipId` | [app.csrfProtection, authenticate, manageMembers] | 204 | [485](../apps/server/src/organization/routes.ts#L485) |
| POST | `/api/organization/members/:membershipId/password-reset-link` | [app.csrfProtection, authenticate, manageOrg] | 201 / 403 | [498](../apps/server/src/organization/routes.ts#L498) |
| PATCH | `/api/organization/members/:membershipId` | [app.csrfProtection, authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [532](../apps/server/src/organization/routes.ts#L532) |
| PUT | `/api/organization/members/:membershipId/roles` | [app.csrfProtection, authenticate, manageMembers] | 204 | [550](../apps/server/src/organization/routes.ts#L550) |
| PUT | `/api/organization/members/:membershipId/identities` | [app.csrfProtection, authenticate, manageMembers] | 204 | [567](../apps/server/src/organization/routes.ts#L567) |
| PATCH | `/api/organization/members/:membershipId/status` | [app.csrfProtection, authenticate, manageMembers] | 默认 200；其余见统一错误处理 | [584](../apps/server/src/organization/routes.ts#L584) |
| POST | `/api/auth/invitations/inspect` | app.csrfProtection | 默认 200；其余见统一错误处理 | [603](../apps/server/src/organization/routes.ts#L603) |
| POST | `/api/auth/invitations/accept` | app.csrfProtection | 默认 200；其余见统一错误处理 | [614](../apps/server/src/organization/routes.ts#L614) |

## apps/server/src/payroll/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/reimbursements` | authenticate | 默认 200；其余见统一错误处理 | [85](../apps/server/src/payroll/routes.ts#L85) |
| POST | `/api/reimbursements` | [app.csrfProtection, authenticate, ownPermission] | 201 | [86](../apps/server/src/payroll/routes.ts#L86) |
| POST | `/api/reimbursements/:id/actions` | [app.csrfProtection, authenticate] | 404 / 409 | [92](../apps/server/src/payroll/routes.ts#L92) |
| GET | `/api/payroll/management` | [authenticate, configurePermission] | 默认 200；其余见统一错误处理 | [107](../apps/server/src/payroll/routes.ts#L107) |
| PUT | `/api/payroll/members/:membershipId/plan` | [app.csrfProtection, authenticate, configurePermission] | 404 / 409 | [113](../apps/server/src/payroll/routes.ts#L113) |
| PATCH | `/api/payroll/settings` | [app.csrfProtection, authenticate, configurePermission] | 默认 200；其余见统一错误处理 | [138](../apps/server/src/payroll/routes.ts#L138) |
| POST | `/api/payroll/periods` | [app.csrfProtection, authenticate, configurePermission] | 409 | [156](../apps/server/src/payroll/routes.ts#L156) |
| DELETE | `/api/payroll/periods/:payPeriodId` | [app.csrfProtection, authenticate, configurePermission] | 404 / 409 | [171](../apps/server/src/payroll/routes.ts#L171) |
| GET | `/api/payroll/me` | [authenticate, ownPermission] | 默认 200；其余见统一错误处理 | [190](../apps/server/src/payroll/routes.ts#L190) |
| POST | `/api/payroll/payslips/:payslipId/acknowledge` | [app.csrfProtection, authenticate, ownPermission] | 404 / 409 | [196](../apps/server/src/payroll/routes.ts#L196) |
| POST | `/api/pay-periods/:payPeriodId/calculate` | [app.csrfProtection, authenticate, settlePermission] | 202 / 404 / 409 | [215](../apps/server/src/payroll/routes.ts#L215) |
| POST | `/api/payroll-runs/:runId/settle` | [app.csrfProtection, authenticate, settlePermission] | 404 / 409 | [235](../apps/server/src/payroll/routes.ts#L235) |
| POST | `/api/payroll-runs/:runId/cancel-calculation` | [app.csrfProtection, authenticate, settlePermission] | 404 / 409 | [254](../apps/server/src/payroll/routes.ts#L254) |
| GET | `/api/payroll-runs/:runId/finance-export.csv` | [authenticate, settlePermission] | 404 / 409 | [273](../apps/server/src/payroll/routes.ts#L273) |
| POST | `/api/payroll-runs/:runId/reopen` | [app.csrfProtection, authenticate, settlePermission] | 404 / 409 | [300](../apps/server/src/payroll/routes.ts#L300) |

## apps/server/src/projects/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/projects` | authenticate | 默认 200；其余见统一错误处理 | [233](../apps/server/src/projects/routes.ts#L233) |
| GET | `/api/projects/catalog` | authenticate | 默认 200；其余见统一错误处理 | [237](../apps/server/src/projects/routes.ts#L237) |
| GET | `/api/projects/calendar-milestones` | authenticate | 默认 200；其余见统一错误处理 | [245](../apps/server/src/projects/routes.ts#L245) |
| POST | `/api/projects` | [ app.csrfProtection, authenticate, requirePermission("project.create", () => ({ scopeKind: "organization", })), ] | 201 | [261](../apps/server/src/projects/routes.ts#L261) |
| GET | `/api/projects/:projectId/tree` | authenticate | 默认 200；其余见统一错误处理 | [288](../apps/server/src/projects/routes.ts#L288) |
| GET | `/api/projects/:projectId/nodes/:nodeId/versions` | authenticate | 默认 200；其余见统一错误处理 | [305](../apps/server/src/projects/routes.ts#L305) |
| GET | `/api/projects/:projectId/nodes/:nodeId/work-sessions` | authenticate | 默认 200；其余见统一错误处理 | [325](../apps/server/src/projects/routes.ts#L325) |
| GET | `/api/projects/:projectId/recycle-bin` | authenticate | 默认 200；其余见统一错误处理 | [345](../apps/server/src/projects/routes.ts#L345) |
| GET | `/api/projects/:projectId/members` | authenticate | 默认 200；其余见统一错误处理 | [370](../apps/server/src/projects/routes.ts#L370) |
| GET | `/api/projects/:projectId/member-candidates` | [authenticate, manageProject] | 默认 200；其余见统一错误处理 | [389](../apps/server/src/projects/routes.ts#L389) |
| PUT | `/api/projects/:projectId/members/:membershipId` | mutationHooks | 默认 200；其余见统一错误处理 | [408](../apps/server/src/projects/routes.ts#L408) |
| POST | `/api/projects/:projectId/members/self` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [430](../apps/server/src/projects/routes.ts#L430) |
| DELETE | `/api/projects/:projectId/members/:membershipId` | mutationHooks | 204 | [445](../apps/server/src/projects/routes.ts#L445) |
| POST | `/api/projects/:projectId/edges` | mutationHooks | 201 | [461](../apps/server/src/projects/routes.ts#L461) |
| POST | `/api/projects/:projectId/edges/batch` | mutationHooks | 201 | [479](../apps/server/src/projects/routes.ts#L479) |
| DELETE | `/api/projects/:projectId/edges/:edgeId` | mutationHooks | 204 | [503](../apps/server/src/projects/routes.ts#L503) |
| POST | `/api/projects/:projectId/branches` | mutationHooks | 201 | [517](../apps/server/src/projects/routes.ts#L517) |
| PATCH | `/api/projects/:projectId/branches/:branchId` | mutationHooks | 默认 200；其余见统一错误处理 | [535](../apps/server/src/projects/routes.ts#L535) |
| POST | `/api/projects/:projectId/branches/:branchId/archive` | mutationHooks | 默认 200；其余见统一错误处理 | [557](../apps/server/src/projects/routes.ts#L557) |
| POST | `/api/projects/:projectId/branches/:branchId/restore` | mutationHooks | 默认 200；其余见统一错误处理 | [578](../apps/server/src/projects/routes.ts#L578) |
| POST | `/api/projects/:projectId/branches/:branchId/merge` | mutationHooks | 默认 200；其余见统一错误处理 | [599](../apps/server/src/projects/routes.ts#L599) |
| POST | `/api/projects/:projectId/nodes` | mutationHooks | 201 | [621](../apps/server/src/projects/routes.ts#L621) |
| PATCH | `/api/projects/:projectId/nodes/:nodeId` | mutationHooks | 默认 200；其余见统一错误处理 | [641](../apps/server/src/projects/routes.ts#L641) |
| PUT | `/api/projects/:projectId/nodes/:nodeId/assignees` | mutationHooks | 默认 200；其余见统一错误处理 | [672](../apps/server/src/projects/routes.ts#L672) |
| POST | `/api/projects/:projectId/nodes/:nodeId/assignees/self` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [694](../apps/server/src/projects/routes.ts#L694) |
| POST | `/api/projects/:projectId/nodes/:nodeId/move` | mutationHooks | 默认 200；其余见统一错误处理 | [708](../apps/server/src/projects/routes.ts#L708) |
| POST | `/api/projects/:projectId/nodes/:nodeId/rollback` | mutationHooks | 默认 200；其余见统一错误处理 | [731](../apps/server/src/projects/routes.ts#L731) |
| DELETE | `/api/projects/:projectId/nodes/:nodeId` | mutationHooks | 204 | [753](../apps/server/src/projects/routes.ts#L753) |
| POST | `/api/projects/:projectId/nodes/:nodeId/restore` | mutationHooks | 默认 200；其余见统一错误处理 | [773](../apps/server/src/projects/routes.ts#L773) |

## apps/server/src/realtime/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| WS | `/api/realtime` | 连接内认证与 Origin 校验 | 默认 200；其余见统一错误处理 | [16](../apps/server/src/realtime/routes.ts#L16) |

## apps/server/src/search/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/search` | authenticate | 默认 200；其余见统一错误处理 | [16](../apps/server/src/search/routes.ts#L16) |

## apps/server/src/setup/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/setup/status` | 见处理器及全局钩子 | 默认 200；其余见统一错误处理 | [49](../apps/server/src/setup/routes.ts#L49) |
| POST | `/api/setup/initial-owner` | app.csrfProtection | 201 / 403 / 409 / 503 | [54](../apps/server/src/setup/routes.ts#L54) |

## apps/server/src/timer/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/timer` | protectedRead | 默认 200；其余见统一错误处理 | [51](../apps/server/src/timer/routes.ts#L51) |
| POST | `/api/timer/start` | protectedWrite | 201 / 409 | [55](../apps/server/src/timer/routes.ts#L55) |
| POST | `/api/timer/:timerId/events` | protectedWrite | 404 / 409 | [80](../apps/server/src/timer/routes.ts#L80) |

## apps/server/src/work/correction-routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/work-session-corrections/mine` | [authenticate, ownPermission] | 默认 200；其余见统一错误处理 | [87](../apps/server/src/work/correction-routes.ts#L87) |
| GET | `/api/work-session-corrections/pending` | authenticate | 默认 200；其余见统一错误处理 | [95](../apps/server/src/work/correction-routes.ts#L95) |
| POST | `/api/work-sessions/:sessionId/corrections` | [app.csrfProtection, authenticate, ownPermission] | 201 | [103](../apps/server/src/work/correction-routes.ts#L103) |
| POST | `/api/work-session-corrections/:correctionId/decision` | [app.csrfProtection, authenticate] | 默认 200；其余见统一错误处理 | [122](../apps/server/src/work/correction-routes.ts#L122) |

## apps/server/src/work/routes.ts

| 方法 | 入口 | 入口保护 | 局部显式状态码 | 代码位置 |
| --- | --- | --- | --- | --- |
| GET | `/api/work-sessions/project-node-recommendations` | [authenticate, ownPermission] | 默认 200；其余见统一错误处理 | [66](../apps/server/src/work/routes.ts#L66) |
| GET | `/api/work-sessions` | [authenticate, ownPermission] | 默认 200；其余见统一错误处理 | [81](../apps/server/src/work/routes.ts#L81) |
| POST | `/api/work-sessions` | [app.csrfProtection, authenticate, ownPermission] | 201 / 400 / 409 | [106](../apps/server/src/work/routes.ts#L106) |
| POST | `/api/work-entries/batch` | [app.csrfProtection, authenticate, ownPermission] | 201 / 400 / 409 | [131](../apps/server/src/work/routes.ts#L131) |
| POST | `/api/work-plans` | [app.csrfProtection, authenticate, ownPermission] | 201 / 400 / 409 | [167](../apps/server/src/work/routes.ts#L167) |
| POST | `/api/work-plans/:sessionId/realize` | [app.csrfProtection, authenticate, ownPermission] | 400 / 409 | [196](../apps/server/src/work/routes.ts#L196) |
| GET | `/api/work-sessions/:sessionId/versions` | [authenticate, ownPermission] | 默认 200；其余见统一错误处理 | [229](../apps/server/src/work/routes.ts#L229) |
| PATCH | `/api/work-sessions/:sessionId` | [app.csrfProtection, authenticate, ownPermission] | 400 / 409 | [241](../apps/server/src/work/routes.ts#L241) |
| PATCH | `/api/work-sessions/:sessionId/schedule` | [app.csrfProtection, authenticate, ownPermission] | 400 / 409 | [283](../apps/server/src/work/routes.ts#L283) |
| POST | `/api/work-sessions/:sessionId/submit` | [app.csrfProtection, authenticate, ownPermission] | 409 / 422 | [299](../apps/server/src/work/routes.ts#L299) |
| POST | `/api/work-sessions/:sessionId/withdraw` | [app.csrfProtection, authenticate, ownPermission] | 409 | [320](../apps/server/src/work/routes.ts#L320) |
