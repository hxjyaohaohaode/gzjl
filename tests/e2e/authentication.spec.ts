import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedWorkspace(page: Page): Promise<void> {
  let authenticated = false;
  await page.route("**/api/auth/csrf", (route) => route.fulfill({ json: { csrfToken: "test-csrf-token" } }));
  await page.route("**/api/auth/login", async (route) => { authenticated = true; await route.fulfill({ json: { ok: true } }); });
  await page.route("**/api/me", (route) => authenticated ? route.fulfill({ json: { user: { id: "00000000-0000-4000-8000-000000000001", membershipId: "00000000-0000-4000-8000-000000000002", organizationId: "00000000-0000-4000-8000-000000000003", displayName: "林知夏" }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "00000000-0000-4000-8000-000000000002" }, { permission: "payroll.view_own", scopeKind: "self", scopeId: "00000000-0000-4000-8000-000000000002" }] } }) : route.fulfill({ status: 401, json: { error: "unauthorized" } }));
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: { items: [], nextCursor: null } }));
  await page.route("**/api/timer", (route) => route.fulfill({ json: { timer: null } }));
  await page.route("**/api/analytics/summary?**", (route) => route.fulfill({ json: { totals: { sessionCount: 2, totalSeconds: 19_800, approvedSeconds: 14_400, pendingSeconds: 5_400 }, byDay: [{ date: "2026-09-01", seconds: 7_200 }, { date: "2026-09-02", seconds: 12_600 }], byMember: [], byProject: [{ projectId: "00000000-0000-4000-8000-000000000004", projectName: "工作台正式版", seconds: 19_800 }] } }));
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
