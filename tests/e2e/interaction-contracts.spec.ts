import { expect, test, type Page } from "@playwright/test";

const memberId = "00000000-0000-4000-8000-000000000002";
const projectId = "00000000-0000-4000-8000-000000000004";
const branchId = "00000000-0000-4000-8000-000000000005";
const nodeId = "00000000-0000-4000-8000-000000000006";
test.use({ timezoneId: "America/Los_Angeles" });

async function workspace(page: Page) {
  let send: ((message: string) => void) | undefined;
  await page.routeWebSocket("**/api/realtime", (socket) => {
    send = (message) => socket.send(message);
    socket.send(JSON.stringify({ type: "realtime.ready" }));
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const result = path === "/api/me" ? {
      user: { id: memberId, membershipId: memberId, organizationId: "org", displayName: "审查成员", isOwner: true, timezone: "Asia/Shanghai" },
      permissions: ["project.manage", "org.manage", "members.manage", "work.view_own", "payroll.view_own"].map((permission) => ({ permission, scopeKind: "organization", scopeId: null })),
    } : path === "/api/auth/csrf" ? { csrfToken: "test-token" }
      : path === "/api/timer" ? { timer: null }
      : path === "/api/payroll/me" ? { items: [], currentPlan: null, livePreview: null }
      : path === "/api/organization/invitation-delivery-capabilities" ? { manual: { available: true }, email: { available: false }, phone: { available: false } }
      : path === "/api/reimbursements" ? { items: [], periods: [], canReview: false, membershipId: memberId }
      : { items: [], nextCursor: null, unreadCount: 0 };
    await route.fulfill({ json: result });
  });
  return async () => {
    await expect.poll(() => Boolean(send)).toBe(true);
    send!(JSON.stringify({ type: "entity.changed" }));
  };
}

test("calendar month navigation clamps month ends and loads all opaque cursor pages", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-01-31T04:00:00Z"));
  await workspace(page);
  const cursor = "2026-01-10T01:00:00.000Z|00000000-0000-4000-8000-000000000100";
  const record = (id: string, source = "manual") => ({ id, source, content: `日历完整记录 ${id}`, result: "", startAt: "2026-01-10T01:00:00Z", endAt: "2026-01-10T02:00:00Z", netSeconds: 3600, submissionStatus: "draft", approvalStatus: "not_submitted", version: 1 });
  await page.route("**/api/work-sessions?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    if (params.has("before")) {
      expect(params.get("before")).toBe(cursor);
      return route.fulfill({ json: { items: [record("最后一条", "timer")], nextCursor: null } });
    }
    return route.fulfill({ json: { items: Array.from({ length: 100 }, (_, index) => record(String(index))), nextCursor: cursor } });
  });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "月", exact: true }).click();
  await expect(page.locator(".calendar-period-bar h2")).toHaveText("2026年1月");
  await expect(page.locator(".calendar-audit-row")).toHaveCount(101);
  const timer = page.locator(".calendar-audit-row").filter({ hasText: "日历完整记录 最后一条" });
  await expect(timer.getByRole("button", { name: "后一天" })).toHaveCount(0);
  await page.getByRole("button", { name: "下一周期" }).click();
  await expect(page.locator(".calendar-period-bar h2")).toHaveText("2026年2月");
  await page.getByRole("button", { name: "上一周期" }).click();
  await expect(page.locator(".calendar-period-bar h2")).toHaveText("2026年1月");
});

test("project live refresh preserves drafts and saves dates in organization timezone", async ({ page }) => {
  const refresh = await workspace(page);
  let node = { id: nodeId, projectId, branchId, parentId: null, type: "task", title: "节点原文", description: "", status: "in_progress", progress: "20", progressMode: "manual", weight: "1", version: 1, sortOrder: 0, startAt: "2026-09-22T01:00:00Z", dueAt: null as string | null };
  await page.route(`**/api/projects/${projectId}/tree`, (route) => route.fulfill({ json: { project: { id: projectId, key: "AUDIT", name: "交互审查项目" }, branches: [{ id: branchId, name: "主线", isDefault: true }], nodes: [node], nodeAssignees: [], edges: [] } }));
  let payload: Record<string, unknown> | undefined;
  let release!: () => void;
  await page.route(`**/api/projects/${projectId}/nodes/${nodeId}`, async (route) => {
    payload = route.request().postDataJSON();
    await new Promise<void>((resolve) => { release = resolve; });
    node = { ...node, ...payload, version: 3 };
    await route.fulfill({ json: { node } });
  });
  await page.goto(`/projects/${projectId}?node=${nodeId}`);
  await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue("2026-09-22T09:00");
  await page.getByLabel("标题", { exact: true }).fill("本地未保存草稿");
  node = { ...node, title: "其他端的新版本", version: 2 };
  await refresh();
  await expect(page.getByText("该节点已有较新版本。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("本地未保存草稿");
  await expect(page.getByRole("button", { name: "保存节点版本" })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "重新加载内容" }).click();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("其他端的新版本");
  await page.getByLabel("标题", { exact: true }).fill("核对后保存");
  await page.getByLabel("截止时间", { exact: true }).fill("2026-09-22T18:00");
  await page.getByRole("button", { name: "保存节点版本" }).click();
  await expect.poll(() => payload).toMatchObject({ expectedVersion: 2, title: "核对后保存", startAt: "2026-09-22T01:00:00.000Z", dueAt: "2026-09-22T10:00:00.000Z" });
  await expect(page.getByLabel("标题", { exact: true })).toBeDisabled();
  release();
  await expect(page.getByLabel("标题", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("标题", { exact: true })).toHaveValue("核对后保存");
});

test("calendar period totals use clipped work after midnight and exclude plans", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-09-22T04:00:00Z"));
  await workspace(page);
  await page.route("**/api/work-sessions?**", (route) => {
    const from = new URL(route.request().url()).searchParams.get("from");
    return route.fulfill({ json: { items: [{ id: "overnight", source: "manual", content: "跨午夜含休息事实", result: "", startAt: "2026-09-21T14:00:00Z", endAt: "2026-09-21T18:00:00Z", netSeconds: 10800, periodNetSeconds: from === "2026-09-21T16:00:00.000Z" ? 3600 : 7200, submissionStatus: "draft", approvalStatus: "not_submitted", version: 1 },
      { id: "plan", source: "manual", recordKind: "plan", content: "计划不计入事实总时长", result: "", startAt: "2026-09-22T01:00:00Z", endAt: "2026-09-22T02:00:00Z", netSeconds: 3600, periodNetSeconds: 3600, submissionStatus: "draft", approvalStatus: "not_submitted", version: 1 }], nextCursor: null } });
  });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "日", exact: true }).click();
  await expect(page.locator(".calendar-period-bar")).toContainText("1 小时 0 分");
  await expect(page.locator(".calendar-period-bar")).toContainText("1 个计划");
  await page.getByRole("button", { name: "上一周期" }).click();
  await expect(page.locator(".calendar-period-bar")).toContainText("2 小时 0 分");
  await expect(page.locator(".calendar-period-bar")).toContainText("0 个计划");
});

test("organization unit live updates keep unsaved changes until explicit reload", async ({ page }) => {
  const refresh = await workspace(page);
  let unit = { id: "unit", name: "交付部门", description: "", parentId: null, leaderMembershipId: null, version: 1, sortOrder: 0 };
  await page.route("**/api/organization", (route) => route.fulfill({ json: { organization: { id: "org", name: "审查组织", timezone: "Asia/Shanghai" }, units: [unit], members: [], roles: [], professionalIdentities: [], ownerMembershipId: memberId, ownershipTransfer: null } }));
  await page.goto("/organization");
  await page.locator(".organization-tree-node").filter({ hasText: "交付部门" }).click();
  await page.getByLabel("单元名称", { exact: true }).fill("正在编辑的部门");
  unit = { ...unit, name: "其他端部门版本", version: 2 };
  await refresh();
  await expect(page.getByText("该单元已在其他操作中更新。", { exact: false })).toBeVisible();
  await expect(page.getByLabel("单元名称", { exact: true })).toHaveValue("正在编辑的部门");
  await expect(page.getByRole("button", { name: "保存组织单元" })).toBeDisabled();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "放弃草稿并加载最新" }).click();
  await expect(page.getByLabel("单元名称", { exact: true })).toHaveValue("正在编辑的部门");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "放弃草稿并加载最新" }).click();
  await expect(page.getByLabel("单元名称", { exact: true })).toHaveValue("其他端部门版本");
});

test("reimbursement saving locks the submitted snapshot and failures preserve input", async ({ page }) => {
  await workspace(page);
  let release!: () => void;
  let submitted = false;
  await page.route(/\/api\/reimbursements(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: { items: [], periods: [], canReview: false, membershipId: memberId } });
    submitted = true;
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 422, json: { error: "invalid_expense", message: "请核对费用发生日期后重新保存。" } });
  });
  await page.goto("/payroll");
  await page.getByRole("button", { name: "申请报销", exact: true }).click();
  await page.getByLabel("报销事项", { exact: true }).fill("现场交通费用");
  await page.getByLabel("发生日期").fill("2026-09-22");
  await page.getByLabel("报销金额").fill("128.35");
  await page.getByLabel("用途说明").fill("项目现场验收产生的交通费用");
  await page.getByRole("button", { name: "保存草稿并添加凭证" }).click();
  await expect.poll(() => submitted).toBe(true);
  await expect(page.getByLabel("报销事项", { exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "收起申请" })).toBeDisabled();
  release();
  await expect(page.getByText("请核对费用发生日期后重新保存。")).toBeVisible();
  await expect(page.getByLabel("报销事项", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("报销事项", { exact: true })).toHaveValue("现场交通费用");
  await expect(page.getByLabel("报销金额")).toHaveValue("128.35");
});

test("closing a deep-linked member stays closed after background updates", async ({ page }) => {
  const refresh = await workspace(page);
  let displayName = "最初的成员";
  await page.route("**/api/organization", (route) => route.fulfill({ json: {
    organization: { id: "org", name: "审查组织", timezone: "Asia/Shanghai" }, units: [], roles: [], professionalIdentities: [], ownerMembershipId: memberId, ownershipTransfer: null,
    members: [{ membership: { id: memberId, status: "active", positionTitle: null, orgUnitId: null }, user: { displayName }, positionTitle: null, unitName: null, isOwner: true, accessRoles: [], professionalIdentities: [] }],
  } }));
  await page.goto(`/organization?member=${memberId}`);
  await expect(page.getByRole("button", { name: "关闭成员详情", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "关闭成员详情", exact: true }).click();
  displayName = "刷新后的成员";
  await refresh();
  await expect(page.getByText("刷新后的成员", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "关闭成员详情", exact: true })).toHaveCount(0);
});

test("reimbursement history selects the requested month and notification links locate the original claim", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z")); await workspace(page);
  const oldId = "00000000-0000-4000-8000-000000000921", currentId = "00000000-0000-4000-8000-000000000922";
  const claim = (id: string, title: string) => ({ id, title, description: "凭证完整，归属周期已确认", expenseDate: "2026-09-03", amount: "128.350000", currency: "CNY", status: "approved", version: 3, membershipId: memberId, memberName: "审查成员", reviewNote: null, payPeriodId: "period", periodName: title, periodStatus: "locked" });
  const requests: URL[] = [];
  await page.route(/\/api\/reimbursements(?:\?.*)?$/, (route) => {
    const url = new URL(route.request().url()); requests.push(url);
    const old = url.searchParams.get("from") === "2026-09-01" || url.searchParams.get("id") === oldId;
    return route.fulfill({ json: { items: [old ? claim(oldId, "九月已批准报销") : claim(currentId, "十月归属报销")], canReview: false, membershipId: memberId, periods: [], nextCursor: null, range: { from: old ? "2026-09-01" : "2026-10-01", to: old ? "2026-10-01" : "2026-11-01", timezone: "Asia/Shanghai" } } });
  });
  await page.goto("/payroll"); const panel = page.locator(".reimbursement-panel");
  await expect(panel.getByText("十月归属报销", { exact: true })).toBeVisible(); await expect(panel.getByText("九月已批准报销", { exact: true })).toHaveCount(0);
  await panel.locator(".reimbursement-history > summary").click(); await panel.getByLabel("历史月份", { exact: true }).fill("2026-09");
  await panel.getByRole("button", { name: "应用历史范围" }).click();
  await expect(panel.getByText("九月已批准报销", { exact: true })).toBeVisible(); await expect(panel.getByText("十月归属报销", { exact: true })).toHaveCount(0);
  expect(requests.at(-1)?.searchParams.get("to")).toBe("2026-10-01");
  await panel.getByRole("button", { name: "恢复默认范围" }).click(); await expect(panel.getByText("十月归属报销", { exact: true })).toBeVisible();
  await page.goto(`/payroll#reimbursement-${oldId}`); await expect(panel.getByText("九月已批准报销", { exact: true })).toBeVisible();
  await expect(panel.getByText("凭证完整，归属周期已确认", { exact: true })).toBeVisible();
  expect(requests.at(-1)?.searchParams.get("id")).toBe(oldId);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("salary export month filters both periods and their ready or settled batches", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-02T12:00:00Z")); await workspace(page);
  await page.route("**/api/me", (route) => route.fulfill({ json: { user: { id: memberId, membershipId: memberId, organizationId: "org", displayName: "负责人", isOwner: true, timezone: "Asia/Shanghai" }, permissions: ["payroll.configure", "payroll.settle", "payroll.view_own"].map((permission) => ({ permission, scopeKind: "organization", scopeId: null })) } }));
  const periods = [
    { id: "july", name: "七月账单", startsAt: "2026-06-30T16:00:00Z", endsAt: "2026-07-31T16:00:00Z", timezone: "Asia/Shanghai", cutoffAt: "2026-08-10T10:00:00Z", status: "locked" },
    { id: "august", name: "八月账单", startsAt: "2026-07-31T16:00:00Z", endsAt: "2026-08-31T16:00:00Z", timezone: "Asia/Shanghai", cutoffAt: "2026-09-10T10:00:00Z", status: "pending_confirmation" },
  ];
  await page.route("**/api/payroll/management", (route) => route.fulfill({ json: { members: [], periods, runs: periods.map((period, i) => ({ period, run: { id: period.id, runNumber: 1, status: i ? "ready" : "settled", createdAt: period.endsAt } })), latestItems: [], liveItems: [], liveItemIssues: [], settings: { timezone: "Asia/Shanghai", payrollCutoffDay: 10, payrollCutoffMinute: 1080 } } }));
  await page.goto("/payroll"); await expect(page.getByLabel("结算月份", { exact: true })).toHaveValue("2026-09");
  await page.getByLabel("查看 / 导出指定月份", { exact: true }).fill("2026-07");
  await expect(page.getByText("七月账单 · 批次 #1 · 已导出并锁定", { exact: true })).toBeVisible(); await expect(page.getByText("八月账单 · 批次 #1 · 可导出锁定", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新导出账单", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "核对导出预览", exact: true })).toHaveCount(0);
  await page.getByLabel("查看 / 导出指定月份", { exact: true }).fill("2026-08");
  await expect(page.getByRole("button", { name: "核对导出预览", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "重新导出账单", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("a failed reimbursement query keeps the date selector available and does not claim the month is empty", async ({ page }) => {
  await workspace(page);
  await page.route(/\/api\/reimbursements(?:\?.*)?$/, (route) => route.fulfill({ status: 503, json: { error: "unavailable", message: "报销暂时无法读取" } }));
  await page.goto("/payroll"); const panel = page.locator(".reimbursement-panel");
  await expect(panel.getByText("报销暂时无法读取", { exact: true })).toBeVisible();
  await expect(panel.getByText("暂无报销申请，可先填写事项，再上传发票或添加凭证链接。", { exact: true })).toHaveCount(0);
  await panel.locator(".reimbursement-history > summary").click(); await expect(panel.getByLabel("历史月份", { exact: true })).toBeVisible();
});
