import { expect, test, type Page } from "@playwright/test";

async function workspace(page: Page) {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/me" ? { user: { id: "member", membershipId: "member", organizationId: "org", displayName: "计时核验", timezone: "Asia/Shanghai", isOwner: false }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "member" }] }
      : path === "/api/timer" ? { timer: null } : path === "/api/auth/csrf" ? { csrfToken: "test-token" } : { items: [], nextCursor: null, unreadCount: 0 } });
  });
}

test("home weekly totals advance after organization midnight instead of keeping the opening range", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-09-20T15:59:30Z") });
  await workspace(page);
  const ranges: Array<{ from: string | null; to: string | null }> = [];
  await page.route("**/api/analytics/summary?**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    ranges.push({ from: params.get("from"), to: params.get("to") });
    return route.fulfill({ json: { totals: { totalSeconds: 3600 } } });
  });
  await page.goto("/");
  await expect.poll(() => ranges.at(-1)?.from).toBe("2026-09-13T16:00:00.000Z");
  await page.clock.fastForward(60_000);
  await expect.poll(() => ranges.at(-1)?.from).toBe("2026-09-20T16:00:00.000Z");
  expect(new Date(ranges.at(-1)!.to!).getTime()).toBeGreaterThanOrEqual(Date.parse("2026-09-20T16:00:30Z"));
});

test("starting a timer protects the submitted draft and allows correction after a failed start", async ({ page }) => {
  await workspace(page);
  let release!: () => void;
  let submitted: unknown;
  await page.route("**/api/timer/start", async (route) => {
    submitted = route.request().postDataJSON();
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 403, json: { message: "项目范围已变更，请核对" } });
  });
  await page.goto("/work");
  const content = page.getByLabel(/^准备做什么/);
  await content.fill("开始计时的原始内容");
  await page.getByRole("button", { name: "开始计时", exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ content: "开始计时的原始内容" });
  await expect(content).toBeDisabled();
  release();
  await expect(page.getByRole("alert").filter({ hasText: "项目范围已变更" })).toBeVisible();
  await expect(content).toBeEnabled();
  await expect(content).toHaveValue("开始计时的原始内容");
});
