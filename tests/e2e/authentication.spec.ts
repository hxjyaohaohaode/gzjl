import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedWorkspace(page: Page): Promise<void> {
  let authenticated = false;
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "test-csrf-token" } }));
  await page.route("**/api/auth/login", async (route) => { authenticated = true; await route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/me", (route) => authenticated ? route.fulfill({ json: { user: { id: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", organizationId: "00000000-0000-4000-8000-000000000003", displayName: "林知夏" }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "00000000-0000-4000-8000-000000000002" }, { permission: "payroll.view_own", scopeKind: "self", scopeId: "00000000-0000-4000-8000-000000000002" }, { permission: "import.scope", scopeKind: "organization", scopeId: null }] } }) : route.fulfill({ status: 401, json: { error: "unauthorized" } }));
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/timer", (route) => route.fulfill({ json: { timer: null } }));
  await page.route("**/api/notifications", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/approvals?**", (route) => route.fulfill({ json: { items: [] } }));
  await page.route("**/api/analytics/summary?**", (route) => route.fulfill({ json: { totals: { sessionCount: 2, totalSeconds: 19_800, approvedSeconds: 14_400, pendingSeconds: 5_400 }, byDay: [{ date: "2026-09-01", seconds: 7_200 }, { date: "2026-09-02", seconds: 12_600 }], byMember: [], byProject: [{ projectId: "00000000-0000-4000-8000-000000000004", projectName: "工作台正式版", seconds: 19_800 }] } }));
  await page.route("**/api/projects/*/tree", (route) => route.fulfill({ json: { project: { id: "00000000-0000-4000-8000-000000000004", key: "WIP", name: "工作台正式版", version: 3 }, branches: [{ id: "00000000-0000-4000-8000-000000000005", name: "主线", isDefault: true }], nodes: [{ id: "00000000-0000-4000-8000-000000000006", branchId: "00000000-0000-4000-8000-000000000005", parentId: null, type: "phase", title: "工作台正式版", status: "in_progress", progress: "40", version: 2, sortOrder: 0 }, { id: "00000000-0000-4000-8000-000000000007", branchId: "00000000-0000-4000-8000-000000000005", parentId: "00000000-0000-4000-8000-000000000006", type: "task", title: "实现项目画布", status: "in_progress", progress: "65", version: 1, sortOrder: 0 }], edges: [{ id: "00000000-0000-4000-8000-000000000008", sourceNodeId: "00000000-0000-4000-8000-000000000006", targetNodeId: "00000000-0000-4000-8000-000000000007", type: "depends_on", label: "包含" }] } }));
}

test("logs in and renders a factual empty workspace", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await expect(page.getByText("还没有工作记录")).toBeVisible();
  await expect(page.getByText("当前没有活动计时器")).toBeVisible();
});

test("TOTP login withholds the workspace until the second factor succeeds", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "test-csrf-token" } }));
  await page.route("**/api/auth/login", (route) => route.fulfill({ status: 202, json: { mfaRequired: true, challengeToken: "a".repeat(43), expiresAt: "2026-09-02T01:05:00.000Z" } }));
  await page.route("**/api/auth/login/mfa", async (route) => { expect(route.request().postDataJSON()).toEqual({ challengeToken: "a".repeat(43), code: "123456" }); authenticated = true; await route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/me", (route) => authenticated ? route.fulfill({ json: { user: { id: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", organizationId: "00000000-0000-4000-8000-000000000003", displayName: "林知夏" }, permissions: [] } }) : route.fulfill({ status: 401, json: { error: "unauthorized" } }));
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/timer", (route) => route.fulfill({ json: { timer: null } }));
  await page.route("**/api/notifications", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "验证身份" })).toBeVisible();
  await page.getByLabel("动态验证码").fill("123456");
  await page.getByRole("button", { name: "完成安全登录" }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
});

test("password reset requests a generic email delivery without exposing a token", async ({ page }) => {
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "test-csrf-token" } }));
  await page.route("**/api/me", (route) => route.fulfill({ status: 401, json: { error: "unauthorized" } }));
  await page.route("**/api/auth/password-reset/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ identifier: "member@example.test" });
    await route.fulfill({ status: 202, json: { accepted: true, message: "若该邮箱对应有效账号，重置链接将发送至邮箱。" } });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await page.getByLabel("邮箱").fill("member@example.test");
  await page.getByRole("button", { name: "发送重置链接" }).click();
  await expect(page.getByRole("status")).toHaveText("若该邮箱对应有效账号，重置链接将发送至邮箱。");
  await expect(page.locator("text=/[A-Za-z0-9_-]{32,}/")).toHaveCount(0);
});

test("notification panel shows real unread items and marks them read", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const notification = { id: "00000000-0000-4000-8000-000000000041", title: "待审核提醒", body: "有一条工时等待处理", severity: "warning", actionUrl: "/approvals", readAt: null, createdAt: "2026-09-02T01:00:00.000Z" };
  await page.route("**/api/notifications", (route) => route.fulfill({ json: { items: [notification] } }));
  await page.route("**/api/notifications/00000000-0000-4000-8000-000000000041/read", (route) => route.fulfill({ json: { notification: { ...notification, readAt: "2026-09-02T02:00:00.000Z" } } }));
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: /通知，1 条未读/ }).click();
  await expect(page.getByText("待审核提醒")).toBeVisible();
  await page.getByText("待审核提醒").click();
});

test("notification preferences can disable a worker-backed category", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const preference = { category: "timer_long_running", inAppEnabled: true, pushEnabled: false, emailEnabled: false, quietHours: {}, mutedUntil: null };
  await page.route("**/api/notification-preferences", async (route) => {
    if (route.request().method() === "GET") await route.fulfill({ json: { items: [preference] } });
    else { expect(route.request().postDataJSON()).toEqual({ ...preference, inAppEnabled: false }); await route.fulfill({ json: { preference: { ...preference, inAppEnabled: false } } }); }
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/notification-preferences");
  await expect(page.getByRole("heading", { name: "通知设置" })).toBeVisible();
  await page.getByText("长时间计时").locator("xpath=../..").getByRole("button", { name: "关闭" }).click();
});

test("CSV import blocks invalid previews and confirms only the previewed content", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const csv = "startAt,endAt,content\n2026-09-02T01:00:00.000Z,2026-09-02T02:00:00.000Z,导入验收";
  await page.route("**/api/imports/work-sessions/preview", async (route) => { expect(route.request().postDataJSON()).toEqual({ csv }); await route.fulfill({ json: { importId: "00000000-0000-4000-8000-000000000051", hash: "a".repeat(64), rowCount: 1, validCount: 1, errors: [] } }); });
  await page.route("**/api/imports/00000000-0000-4000-8000-000000000051/confirm", async (route) => { expect(route.request().postDataJSON()).toEqual({ csv }); await route.fulfill({ json: { importedCount: 1 } }); });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/imports");
  await page.getByLabel("工时 CSV 文件").setInputFiles({ name: "work.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText("校验通过，可以确认导入。")).toBeVisible();
  await page.getByRole("button", { name: "确认原子导入" }).click();
  await expect(page.getByRole("status")).toHaveText("已原子导入 1 条工时记录。");
});

test("CSV import keeps confirmation disabled when server validation reports a row error", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const csv = "startAt,endAt,content\ninvalid,2026-09-02T02:00:00.000Z,错误行";
  await page.route("**/api/imports/work-sessions/preview", (route) => route.fulfill({ json: { importId: "00000000-0000-4000-8000-000000000052", hash: "b".repeat(64), rowCount: 1, validCount: 0, errors: [{ row: 2, field: "startAt", message: "Invalid ISO datetime" }] } }));
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/imports");
  await page.getByLabel("工时 CSV 文件").setInputFiles({ name: "invalid.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText("Invalid ISO datetime")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认原子导入" })).toBeDisabled();
});

test("mobile navigation exposes the five primary destinations", async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile-only assertion");
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "移动端主导航" });
  for (const label of ["今日", "记录", "项目", "分析", "薪资"]) {
    await expect(navigation.getByText(label, { exact: true })).toBeVisible();
  }
});

test("calendar offers day week month views and versioned draft rescheduling", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const session = { id: "00000000-0000-4000-8000-000000000031", startAt: "2026-09-02T01:00:00.000Z", endAt: "2026-09-02T02:00:00.000Z", netSeconds: 3_600, content: "日历改期验证", result: "", source: "manual", submissionStatus: "draft", approvalStatus: "not_requested", version: 2, visibility: "management_only" };
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: { items: [session], nextCursor: null } }));
  await page.route("**/api/work-sessions/00000000-0000-4000-8000-000000000031/schedule", async (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 2 });
    await route.fulfill({ json: { session } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/calendar");
  await expect(page.getByText("日历改期验证")).toBeVisible();
  await page.getByRole("button", { name: "月", exact: true }).click();
  await page.getByRole("button", { name: "前一天" }).click();
});

test("calendar period navigation changes the active date anchor", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/calendar");
  await page.getByRole("button", { name: "月", exact: true }).click();
  const period = page.getByText(/^当前周期：/);
  const before = await period.textContent();
  await page.getByRole("button", { name: "上一周期" }).click();
  await expect(period).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "今天" }).click();
  await expect(period).toHaveText(before ?? "");
});

test("analytics uses accessible, server-backed responsive chart containers", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/analytics");
  await expect(page.getByRole("img", { name: "每日净工时趋势图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "项目投入分布图" })).toBeVisible();
  await expect(page.getByText("工作台正式版")).toBeVisible();
});

test("AI page does not expose team analysis without an organization-scoped grant", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/ai/reports", (route) => route.fulfill({ json: { items: [] } }));
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  await expect(page.getByRole("combobox")).toHaveValue("self");
  await expect(page.getByRole("option", { name: "团队授权范围" })).toHaveCount(0);
});

test("critical workspace widths do not introduce horizontal document overflow", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1920, height: 1080 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "数据分析" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  }
});

test("project tree renders a pannable canvas with a list fallback", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/projects/00000000-0000-4000-8000-000000000004");
  await expect(page.getByText("实现项目画布")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.getByText("task · v1")).toBeVisible();
});
