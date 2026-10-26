import { expect, test, type Page } from "@playwright/test";

const members = [
  { membershipId: "00000000-0000-4000-8000-000000000001", displayName: "员工甲", orgUnitName: "研发部" },
  { membershipId: "00000000-0000-4000-8000-000000000002", displayName: "员工乙", orgUnitName: "研发部" },
];
async function workspace(page: Page, review = true) {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/me" ? {
      user: { id: "admin", membershipId: "admin", organizationId: "org", displayName: "补录验收", isOwner: false, timezone: "Asia/Shanghai" },
      permissions: [{ permission: review ? "work.review" : "work.view_own", scopeKind: "organization", scopeId: null }],
    } : path === "/api/work-sessions/admin-backfill/members" ? { items: members }
      : path === "/api/auth/csrf" ? { csrfToken: "test-token" } : path === "/api/timer" ? { timer: null } : { items: [], unreadCount: 0 } });
  });
}

test("administrator selects multiple employees and records old work without any evidence field", async ({ page }, testInfo) => {
  await workspace(page);
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  const saved: unknown[] = [];
  await page.route("**/api/work-sessions/admin-backfill", async (route) => {
    saved.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: { sessions: members.map((member) => ({ id: member.membershipId, netSeconds: 7200 })) } });
  });
  await page.goto("/approvals");
  await page.getByRole("link", { name: "管理员补录", exact: true }).click();
  await page.getByRole("checkbox", { name: /员工甲/ }).check();
  await page.getByRole("checkbox", { name: /员工乙/ }).check();
  await page.getByLabel("开始时间", { exact: true }).fill("2026-01-06T09:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-01-06T11:00");
  await page.getByLabel("工作内容", { exact: true }).fill("完成历史项目开发与交付");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  const editorWidth = (await page.getByLabel("工作内容", { exact: true }).boundingBox())!.width;
  const formWidth = (await page.locator(".admin-backfill-form").boundingBox())!.width;
  expect(editorWidth).toBeGreaterThan(formWidth * 0.95);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("admin-backfill.png"), fullPage: true, animations: "disabled" });
  const originalSize = page.viewportSize()!;
  await page.setViewportSize({ width: Math.min(390, originalSize.width), height: 360 });
  await page.getByLabel("工作内容", { exact: true }).focus();
  const submit = page.getByRole("button", { name: "补录并确认（2 人）", exact: true });
  await submit.scrollIntoViewIfNeeded();
  await expect(submit).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.setViewportSize(originalSize);
  await submit.click();
  await expect(page.getByRole("status").filter({ hasText: "已为 员工甲、员工乙" })).toBeVisible();
  expect(saved).toEqual([{ membershipIds: members.map((member) => member.membershipId), startAt: "2026-01-06T01:00:00.000Z", endAt: "2026-01-06T03:00:00.000Z", timezone: "Asia/Shanghai", content: "完成历史项目开发与交付" }]);
  await expect(page.getByLabel("工作内容", { exact: true })).toHaveValue("");
  expect(errors).toEqual([]);
});

test("a failed batch retains selections and input for correction", async ({ page }) => {
  await workspace(page);
  await page.route("**/api/work-sessions/admin-backfill", (route) => route.fulfill({ status: 409, json: { error: "admin_backfill_conflict", message: "员工乙在该时段已有工时，本次补录未保存任何记录。" } }));
  await page.goto("/approvals/backfill");
  await page.getByRole("button", { name: "全选当前结果" }).click();
  await page.getByLabel("开始时间", { exact: true }).fill("2026-01-06T09:00");
  await page.getByLabel("结束时间", { exact: true }).fill("2026-01-06T11:00");
  await page.getByLabel("工作内容", { exact: true }).fill("需要保留的工作内容");
  await page.getByRole("button", { name: "补录并确认（2 人）", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("员工乙在该时段已有工时");
  await expect(page.getByRole("checkbox", { name: /员工甲/ })).toBeChecked();
  await expect(page.getByLabel("工作内容", { exact: true })).toHaveValue("需要保留的工作内容");
  await page.getByRole("link", { name: "工时审批", exact: true }).click();
  await page.getByRole("link", { name: "管理员补录", exact: true }).click();
  await expect(page.getByLabel("工作内容", { exact: true })).toHaveValue("需要保留的工作内容");
});

test("ordinary members have no backfill form or entry", async ({ page }) => {
  await workspace(page, false);
  await page.goto("/approvals/backfill");
  await expect(page.getByRole("heading", { name: "暂无此页面的访问权限" })).toBeVisible();
  await expect(page.getByRole("link", { name: "管理员补录", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("工作内容", { exact: true })).toHaveCount(0);
});
