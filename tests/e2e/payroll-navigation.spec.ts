import { expect, test, type Page } from "@playwright/test";

const memberId = "00000000-0000-4000-8000-000000000002";
const colleagueId = "00000000-0000-4000-8000-000000000003";
const period = { id: "period-one", name: "九月结算", startsAt: "2026-08-31T16:00:00Z", endsAt: "2026-09-30T16:00:00Z", cutoffAt: "2026-10-10T10:00:00Z", timezone: "Asia/Shanghai", status: "open" };
const ownerPermissions = ["payroll.view_own", "payroll.configure", "payroll.settle", "work.view_full_scope", "work.review", "members.manage"];

async function workspace(page: Page, permissions = ownerPermissions, isOwner = true) {
  const requested: URL[] = [];
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    requested.push(url);
    const path = url.pathname;
    const response = path === "/api/me" ? {
      user: { id: memberId, membershipId: memberId, organizationId: "org", displayName: "页面分工验收", isOwner, timezone: "Asia/Shanghai" },
      permissions: permissions.map((permission) => ({ permission, scopeKind: "organization", scopeId: null })),
    } : path === "/api/payroll/management" ? {
      members: [{ membershipId: colleagueId, displayName: "待配置成员", status: "active", isOwner: false, plan: null }, { membershipId: "member-two", displayName: "第二位成员", status: "active", isOwner: false, plan: null }],
      periods: [period], runs: [], latestItems: [], liveItems: [], liveItemIssues: [],
      settings: { timezone: "Asia/Shanghai", payrollCutoffDay: 10, payrollCutoffMinute: 1080 },
    } : path === "/api/payroll/me" ? { items: [], summary: [], currentPlan: null, livePreview: null }
      : path === "/api/reimbursements" ? { items: [], periods: [], canReview: !url.searchParams.has("ownOnly"), membershipId: memberId, nextCursor: null }
      : path === "/api/work-policy" ? { manualEntryLookbackDays: 7, monthlyDeadlineEnabled: false, followingMonth: true, deadlineDay: "last", deadlineTime: "23:30", version: 1, timezone: "Asia/Shanghai" }
      : path === "/api/payroll-runs/run-one/handoff" ? { run: { status: "ready", runNumber: 1, calculationVersion: "test" }, period, rows: [], pending: [], drafts: [], anomalies: [], missingPlans: [], blockers: [], previewHash: "test", batch: null }
      : path === "/api/auth/csrf" ? { csrfToken: "test-token" }
      : path === "/api/timer" ? { timer: null } : { items: [], unreadCount: 0 };
    return route.fulfill({ json: response });
  });
  return requested;
}

test("owner personal payroll never mounts management, reimbursement or work policy forms", async ({ page }) => {
  const requests = await workspace(page);
  await page.goto("/payroll");
  await expect(page.getByRole("heading", { name: "我的薪资", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂无本月薪资预估" })).toBeVisible();
  await expect(page.getByLabel("查看薪资周期")).toHaveCount(0);
  await expect(page.locator(".reimbursement-panel, .work-policy-panel")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "成员薪资方案" })).toHaveCount(0);
  expect(requests.some(({ pathname }) => ["/api/payroll/management", "/api/reimbursements", "/api/work-policy"].includes(pathname))).toBe(false);
  await page.getByRole("navigation", { name: "个人薪资导航" }).getByRole("link", { name: "历史工资单" }).click();
  await expect(page).toHaveURL(/\/payroll\/history$/);
  await expect(page.getByRole("heading", { name: "暂无薪资批次" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "暂无本月薪资预估" })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole("navigation", { name: "个人薪资导航" }).getByRole("link", { name: "本月薪资" })).toHaveAttribute("aria-current", "page");
});

test("salary settings apply to a complete selected month or the exact existing period", async ({ page }, testInfo) => {
  await workspace(page);
  let saved: Record<string, unknown> | undefined;
  await page.route(`**/api/payroll/members/${colleagueId}/plan`, (route) => {
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { result: { version: { effectiveFrom: saved!.effectiveFrom } } } });
  });
  await page.goto(`/payroll-management/plans?member=${colleagueId}&month=2026-09`);
  await expect(page.getByLabel("应用范围", { exact: true })).toHaveValue("period");
  await expect(page.getByLabel("计薪开始（含）", { exact: true })).toHaveValue("2026-09-01T00:00");
  await expect(page.getByLabel("计薪结束（不含）", { exact: true })).toHaveValue("2026-10-01T00:00");
  await page.getByLabel("计薪月份", { exact: true }).fill("2028-02");
  await expect(page.getByLabel("计薪结束（不含）", { exact: true })).toHaveValue("2028-03-01T00:00");
  await page.getByLabel("使用已有结算周期", { exact: true }).selectOption(period.id);
  await page.getByLabel("基础时薪", { exact: true }).fill("80.00");
  await page.getByRole("button", { name: "保存薪资方案新版本", exact: true }).click();
  await expect.poll(() => saved).toMatchObject({ baseAmount: "80.00", effectiveFrom: "2026-08-31T16:00:00.000Z", effectiveTo: "2026-09-30T16:00:00.000Z", rules: [] });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("complete-pay-period.png"), fullPage: true });
});

test("management navigation separates overview, plans, periods and settings on reload and back", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const requests = await workspace(page);
  await page.goto("/payroll-management");
  const nav = page.getByRole("navigation", { name: "薪资管理导航" });
  await expect(page.getByRole("heading", { name: "已加入但缺计薪方案" })).toBeVisible();
  await expect(page.getByLabel("基础时薪")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存老板指定周期" })).toHaveCount(0);
  await nav.getByRole("link", { name: "成员方案", exact: true }).click();
  await expect(page.getByRole("heading", { name: "成员薪资方案" })).toBeVisible();
  await page.getByRole("combobox", { name: "成员", exact: true }).selectOption(colleagueId);
  await expect(page.getByLabel("基础时薪")).toBeVisible();
  await expect(page.getByLabel("结算截止日（每月）")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("member-plans.png"), fullPage: true });
  await nav.getByRole("link", { name: "周期结算", exact: true }).click();
  await expect(page.getByRole("button", { name: "计算并查看薪资总览" })).toBeVisible();
  await expect(page.getByRole("button", { name: "保存老板指定周期" })).toBeHidden();
  await page.getByText("新建结算周期", { exact: true }).click();
  await expect(page.getByLabel("结算月份", { exact: true })).toBeVisible();
  await page.getByLabel("查看 / 导出指定月份", { exact: true }).fill("2026-09");
  await page.reload();
  await expect(nav.getByRole("link", { name: "周期结算", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByLabel("查看 / 导出指定月份", { exact: true })).toHaveValue("2026-09");
  await expect(page.getByLabel("基础时薪")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("periods.png"), fullPage: true });
  await nav.getByRole("link", { name: "结算设置", exact: true }).click();
  await expect(page.getByLabel("结算截止日（每月）")).toBeVisible();
  await expect(page.getByRole("heading", { name: "薪资周期与批次" })).toHaveCount(0);
  await expect(page.locator(".work-policy-panel, .reimbursement-panel")).toHaveCount(0);
  await page.goBack();
  await expect(page.getByLabel("查看 / 导出指定月份", { exact: true })).toHaveValue("2026-09");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  expect(requests.some(({ pathname }) => ["/api/payroll/me", "/api/reimbursements", "/api/work-policy"].includes(pathname))).toBe(false);
  expect(errors).toEqual([]);
});

test("personal reimbursement, work review and expense review fetch only their own queues", async ({ page }) => {
  const requests = await workspace(page);
  await page.goto("/reimbursements");
  await expect(page.getByRole("button", { name: "申请报销", exact: true })).toBeVisible();
  expect(requests.find(({ pathname }) => pathname === "/api/reimbursements")?.searchParams.get("ownOnly")).toBe("true");
  expect(requests.some(({ pathname }) => pathname.startsWith("/api/payroll/"))).toBe(false);
  requests.length = 0;
  await page.goto("/approvals");
  await expect(page.getByText("没有待处理审批", { exact: true })).toBeVisible();
  await expect(page.locator(".reimbursement-panel")).toHaveCount(0);
  expect(requests.some(({ pathname }) => pathname === "/api/reimbursements")).toBe(false);
  requests.length = 0;
  await page.getByRole("navigation", { name: "审批分类" }).getByRole("link", { name: "报销审批" }).click();
  await expect(page.getByRole("heading", { name: "报销审批", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请报销", exact: true })).toHaveCount(0);
  expect(requests.find(({ pathname }) => pathname === "/api/reimbursements")?.searchParams.get("pendingOnly")).toBe("true");
  expect(requests.some(({ pathname }) => ["/api/approvals", "/api/work-session-corrections/pending"].includes(pathname))).toBe(false);
  requests.length = 0;
  await page.getByRole("navigation", { name: "报销审批范围" }).getByRole("link", { name: "审批记录" }).click();
  await expect(page.getByRole("heading", { name: "报销审批记录", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "审批分类" }).getByRole("link", { name: "报销审批" })).toHaveAttribute("aria-current", "page");
  expect(requests.find(({ pathname }) => pathname === "/api/reimbursements")?.searchParams.get("reviewedOnly")).toBe("true");
  await page.locator(".reimbursement-history > summary").click();
  await expect(page.getByLabel("历史月份", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "申请报销", exact: true })).toHaveCount(0);
});

test("legacy handoff links open a dedicated preview and return to the period list", async ({ page }) => {
  const requests = await workspace(page);
  await page.goto("/payroll?handoff=run-one");
  await expect(page).toHaveURL(/\/payroll-management\/runs\/run-one$/);
  await expect(page.getByRole("heading", { name: "薪资交接 · 预检与逐行预览" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "薪资周期与批次" })).toHaveCount(0);
  expect(requests.some(({ pathname }) => ["/api/payroll/me", "/api/payroll/management", "/api/reimbursements"].includes(pathname))).toBe(false);
  await page.getByRole("link", { name: "← 返回周期结算" }).click();
  await expect(page.getByRole("heading", { name: "薪资周期与批次" })).toBeVisible();
});

test("expense-only reviewers can access their queue without requesting work approvals", async ({ page }) => {
  const requests = await workspace(page, ["payroll.settle"], false);
  await page.goto("/approvals");
  await expect(page).toHaveURL(/\/approvals\/reimbursements$/);
  await expect(page.getByText("暂无待审批报销。", { exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "审批分类" }).getByRole("link", { name: "工时审批" })).toHaveCount(0);
  expect(requests.some(({ pathname }) => pathname === "/api/approvals")).toBe(false);
});

test("members and scoped payroll grants cannot mount organization management or approval data", async ({ page }) => {
  const requests = await workspace(page, ["payroll.view_own"], false);
  for (const path of ["/payroll-management", "/payroll-management/plans", "/payroll-management/runs/run-one", "/organization/work-policy", "/approvals/reimbursements", "/approvals/reimbursements/history"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "暂无此页面的访问权限" })).toBeVisible();
  }
  await page.route("**/api/me", (route) => route.fulfill({ json: {
    user: { id: memberId, membershipId: memberId, isOwner: false, displayName: "项目级授权", timezone: "Asia/Shanghai" },
    permissions: [{ permission: "payroll.configure", scopeKind: "project", scopeId: "project" }],
  } }));
  await page.goto("/payroll-management");
  await expect(page.getByRole("heading", { name: "暂无此页面的访问权限" })).toBeVisible();
  expect(requests.some(({ pathname }) => pathname.startsWith("/api/payroll") || pathname === "/api/reimbursements" || pathname === "/api/work-policy")).toBe(false);
});

test("plan administrators without settlement permission cannot start a calculation", async ({ page }) => {
  await workspace(page, ["payroll.configure"], false);
  await page.goto("/payroll-management/periods");
  await expect(page.getByRole("button", { name: "计算并查看薪资总览" })).toBeDisabled();
  await page.getByText("新建结算周期", { exact: true }).click();
  await expect(page.getByRole("button", { name: "保存老板指定周期" })).toBeEnabled();
});

test("plan drafts survive member and page switches with deep links and explicit discard", async ({ page }, testInfo) => {
  await workspace(page);
  await page.goto(`/payroll-management/plans?member=${colleagueId}`);
  await expect(page.getByLabel("基础时薪", { exact: true })).toBeVisible();
  await page.getByLabel("基础时薪", { exact: true }).fill("168.19");
  await page.getByRole("combobox", { name: "成员", exact: true }).selectOption("member-two");
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("");
  await page.getByLabel("基础时薪", { exact: true }).fill("95");
  await page.getByRole("navigation", { name: "薪资管理导航" }).getByRole("link", { name: "结算设置" }).click();
  await page.goBack();
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("95");
  await page.getByRole("combobox", { name: "成员", exact: true }).selectOption(colleagueId);
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("168.19");
  await page.getByLabel("搜索成员或方案", { exact: true }).fill("第二位");
  await expect(page.getByRole("button", { name: /第二位成员/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /待配置成员/ })).toHaveCount(0);
  expect(await page.evaluate(() => [localStorage, sessionStorage].some((storage) => Object.values(storage).some((value) => String(value).includes("168.19"))))).toBe(false);
  await page.screenshot({ path: testInfo.outputPath("linked-member-editor.png"), fullPage: true });
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "放弃修改", exact: true }).click();
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("");
});

test("a cycle and its batch share one card and return preserves every filter", async ({ page }, testInfo) => {
  await workspace(page);
  await page.route("**/api/payroll/management", (route) => route.fulfill({ json: {
    members: [], periods: [{ ...period, status: "pending_confirmation" }], runs: [{ period, run: { id: "run-one", runNumber: 2, status: "ready", createdAt: period.endsAt } }], latestItems: [], liveItems: [], liveItemIssues: [], settings: { timezone: "Asia/Shanghai", payrollCutoffDay: 10, payrollCutoffMinute: 1080 },
  } }));
  await page.goto("/payroll-management/periods?month=2026-09&status=ready&q=九月");
  await expect(page.locator(".payroll-period-card")).toHaveCount(1);
  await expect(page.locator(".payroll-period-card")).toContainText("批次 #2");
  await expect(page.getByLabel("结算进度")).toContainText("核对交接");
  await page.getByRole("button", { name: "核对导出预览", exact: true }).click();
  await page.reload();
  await page.getByRole("link", { name: "← 返回周期结算" }).click();
  await expect(page.getByLabel("查看 / 导出指定月份", { exact: true })).toHaveValue("2026-09");
  await expect(page.getByLabel("结算状态", { exact: true })).toHaveValue("ready");
  await expect(page.getByLabel("搜索结算周期", { exact: true })).toHaveValue("九月");
  await page.screenshot({ path: testInfo.outputPath("settlement-workflow.png"), fullPage: true });
});

test("a late plan save only clears its submitted member even when drafts have equal values", async ({ page }) => {
  await workspace(page);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/payroll/members/${colleagueId}/plan`, async (route) => { await responseGate; await route.fulfill({ json: { result: { version: { effectiveFrom: new Date().toISOString() } } } }); });
  await page.goto("/payroll-management/plans?member=member-two");
  await page.getByLabel("基础时薪", { exact: true }).fill("168.19");
  await page.getByRole("combobox", { name: "成员", exact: true }).selectOption(colleagueId);
  await page.getByLabel("基础时薪", { exact: true }).fill("168.19");
  await page.getByRole("button", { name: "保存薪资方案新版本", exact: true }).click();
  await expect(page.locator(".workspace-operation")).toContainText("正在处理 1 项操作");
  await page.goBack();
  release();
  await expect(page.getByRole("button", { name: "保存薪资方案新版本", exact: true })).toBeEnabled();
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("168.19");
  await expect(page.getByText("薪资方案新版本已保存。", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "放弃修改", exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "成员", exact: true }).selectOption(colleagueId);
  await expect(page.getByLabel("基础时薪", { exact: true })).toHaveValue("");
});

test("shared operation feedback follows failure and keeps editable values", async ({ page }) => {
  await workspace(page);
  let release!: () => void;
  const responseGate = new Promise<void>((resolve) => { release = resolve; });
  await page.route("**/api/payroll/settings", async (route) => { await responseGate; await route.fulfill({ status: 409, json: { error: "conflict", message: "结算设置已变化，请重新核对。" } }); });
  await page.goto("/payroll-management/settings");
  await page.getByLabel("结算截止日（每月）", { exact: true }).fill("12");
  const save = page.getByRole("button", { name: "保存结算截止 / 计划导出时间", exact: true });
  await save.click();
  await expect(page.locator(".workspace-operation")).toContainText("正在处理 1 项操作");
  await expect(page.getByLabel("结算截止日（每月）", { exact: true })).toBeDisabled();
  await expect(page.locator("form[data-operation-state=pending]")).toHaveCount(1);
  release();
  await expect(page.getByRole("alert")).toContainText("结算设置已变化");
  await expect(page.getByLabel("结算截止日（每月）", { exact: true })).toHaveValue("12");
  await expect(page.getByLabel("结算截止日（每月）", { exact: true })).toBeEnabled();
  await expect(page.locator(".workspace-operation")).toContainText("操作未完成");
});

test("dynamic controls are traced and motion preferences follow the system", async ({ page }, testInfo) => {
  await workspace(page);
  await page.goto("/payroll-management/periods");
  await page.getByText("新建结算周期", { exact: true }).click();
  const missing = () => page.evaluate(() => [...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,summary')].filter((element) => !element.hasAttribute("data-interaction-id")).length);
  await expect.poll(missing).toBe(0);
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByRole("button", { name: "减少动态", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath("dark-reduced-motion.png"), fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByRole("button", { name: "完整响应", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
  expect(await page.getByRole("button", { name: "完整响应", exact: true }).evaluate((element) => parseFloat(getComputedStyle(element).transitionDuration))).toBeLessThan(.001);
  await expect.poll(missing).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
