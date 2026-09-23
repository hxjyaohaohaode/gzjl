import { expect, test } from "@playwright/test";

test("global search takes over keyboard focus from Copilot without losing its draft", async ({ page }) => {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/me"
      ? { user: { id: "member-user", membershipId: "member", organizationId: "organization", displayName: "交互验收", timezone: "Asia/Shanghai", isOwner: false }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "member" }] }
      : path === "/api/timer" ? { timer: null }
        : path === "/api/organization/ownership-transfers/pending-for-me" ? { transfer: null }
          : { items: [] };
    return route.fulfill({ json });
  });
  await page.goto("/work");
  const copilotOpener = page.getByRole("button", { name: "打开 AI 上下文", exact: true });
  await copilotOpener.click();
  await page.getByRole("textbox", { name: "向页面 AI 提问", exact: true }).fill("搜索之后继续编辑的草稿");
  await page.keyboard.press("Control+k");
  const search = page.getByRole("dialog", { name: "全局导航", exact: true });
  await expect(search.getByRole("textbox", { name: "搜索工作台", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(search.getByRole("button", { name: "关闭搜索", exact: true })).toBeFocused();
  await expect(page.getByRole("dialog", { name: "AI 上下文面板", exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await copilotOpener.click();
  await expect(page.getByRole("textbox", { name: "向页面 AI 提问", exact: true })).toHaveValue("搜索之后继续编辑的草稿");
});
