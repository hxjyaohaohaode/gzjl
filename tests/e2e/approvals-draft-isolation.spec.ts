import { expect, test } from "@playwright/test";

test("completing one approval preserves another request's open review note", async ({ page }) => {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/me"
      ? { user: { id: "reviewer", membershipId: "reviewer", organizationId: "org", displayName: "审批验收", timezone: "Asia/Shanghai", isOwner: false }, permissions: [{ permission: "work.review", scopeKind: "organization", scopeId: null }] }
      : path === "/api/auth/csrf" ? { csrfToken: "review-token" }
      : path === "/api/timer" ? { timer: null } : { items: [], unreadCount: 0 } });
  });
  const item = (id: string) => ({
    request: { id, priority: "normal", anomalyFlags: [] },
    session: { id: `work-${id}`, content: `待审核工作 ${id}`, result: "", startAt: "2026-09-21T01:00:00Z", endAt: "2026-09-21T02:00:00Z", netSeconds: 3600, version: 2 },
  });
  let finished = false;
  let release: (() => void) | undefined;
  await page.route("**/api/approvals?**", (route) => route.fulfill({ json: { items: finished ? [item("B")] : [item("A"), item("B")] } }));
  await page.route("**/api/approvals/A/decision", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ decision: "approved" });
    await new Promise<void>((resolve) => { release = resolve; });
    finished = true;
    await route.fulfill({ json: { success: true } });
  });
  await page.goto("/approvals");
  await page.getByRole("button", { name: "查看工作与附件", exact: true }).nth(1).click();
  const note = page.getByRole("textbox", { name: "退回原因", exact: true });
  await note.fill("B 仍需要补充原始凭证，正在核对详细原因");
  await page.getByRole("button", { name: "批准", exact: true }).first().click();
  await expect.poll(() => Boolean(release)).toBe(true);
  await expect(note).toBeDisabled();
  release!();
  await expect(page.getByRole("heading", { name: "待审核工作 A", exact: true })).toHaveCount(0);
  await expect(note).toBeVisible();
  await expect(note).toBeEnabled();
  await expect(note).toHaveValue("B 仍需要补充原始凭证，正在核对详细原因");
  await expect(page.getByRole("button", { name: "收起附件", exact: true })).toHaveAttribute("aria-expanded", "true");
});
