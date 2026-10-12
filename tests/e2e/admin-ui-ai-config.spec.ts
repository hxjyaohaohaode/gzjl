import { wizardStep } from "./workspace-flows.js";
import { expect, test, type Page } from "@playwright/test";

const membershipId = "00000000-0000-4000-8000-000000000002";
const settings = {
  source: "organization", enabled: true, baseUrl: "https://provider.example/v1", model: "vendor/current-model", hasApiKey: true,
  encryptionReady: true, usable: true, dailyRequestLimit: 80, monthlyRequestLimit: 1600, maxOutputTokens: 4096,
  generationOptions: { requestTimeoutMs: 60000, maxAttempts: 2, temperature: null, topP: null, tokenLimitParameter: "max_tokens", responseFormat: "text", extraBody: {} },
  usage: { daily: 2, monthly: 9, timezone: "Asia/Shanghai" },
};
async function workspace(page: Page, owner = true) {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path === "/api/me" ? {
      user: { id: membershipId, membershipId, organizationId: "org", displayName: "界面验收", timezone: "Asia/Shanghai", isOwner: owner },
      permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: membershipId }],
    } : path === "/api/auth/csrf" ? { csrfToken: "test-token" }
      : path === "/api/timer" ? { timer: null }
      : path === "/api/analytics/summary" ? { totals: { totalSeconds: 14400 } }
      : path === "/api/work-lifecycle/me" ? { period: { name: "本月", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-11-01T00:00:00Z", cutoffAt: null, timezone: "Asia/Shanghai" }, counts: {}, plans: [], activePlan: null, attention: [] }
      : path === "/api/ai/settings" ? settings
      : { items: [], nextCursor: null, unreadCount: 0 } });
  });
}

test("commands support keyboard actions and persist appearance and density", async ({ page }, testInfo) => {
  await workspace(page);
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "工作记录", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "搜索工作台" });
  await expect(input).toBeFocused();
  await input.press("Tab");
  await expect(page.getByRole("button", { name: "关闭搜索" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(input).toBeFocused();
  await input.fill("外观");
  await expect(page.getByRole("option", { name: /外观与密度设置/ })).toBeVisible();
  await input.press("Enter");
  await expect(page.getByRole("dialog", { name: "全局导航" })).toHaveCount(0);
  await page.getByRole("button", { name: "紧凑", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await page.getByRole("button", { name: "深色", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("work-dark-compact.png"), fullPage: true });
});

test("recent commands are permission-filtered and arrows select destinations", async ({ page }, testInfo) => {
  await workspace(page);
  await page.goto("/work");
  await expect(page.getByRole("heading", { name: "工作记录", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  const input = page.getByRole("combobox", { name: "搜索工作台" });
  await input.fill("calendar");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/calendar$/);
  await expect(page.getByRole("heading", { name: "工作日历", exact: true })).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("group", { name: "最近访问" }).getByRole("option", { name: /工作记录/ })).toBeVisible();
  await input.fill("AI");
  await expect(page.getByRole("option", { name: /AI 工作洞察/ })).toBeVisible();
  await input.press("ArrowDown");
  await expect(page.getByRole("option", { name: /AI 模型配置/ })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: testInfo.outputPath("command-palette.png") });
  await input.press("Enter");
  await expect(page).toHaveURL(/\/ai\/settings$/);
  await expect(page.getByLabel("模型标识", { exact: true })).toHaveValue("vendor/current-model");
});

test("AI settings save arbitrary models and extensions, freeze requests and clear secrets", async ({ page }, testInfo) => {
  await workspace(page);
  let payload: Record<string, unknown> | undefined;
  let release!: () => void;
  let current = structuredClone(settings);
  await page.route("**/api/ai/settings", async (route) => {
    if (route.request().method() !== "PUT") return route.fulfill({ json: current });
    payload = route.request().postDataJSON();
    await new Promise<void>((resolve) => { release = resolve; });
    current = { ...current, ...payload, source: "organization", hasApiKey: true } as typeof settings;
    delete (current as unknown as Record<string, unknown>).apiKey;
    delete (current as unknown as Record<string, unknown>).password;
    await route.fulfill({ json: current });
  });
  await page.goto("/ai/settings");
  await wizardStep(page, 0, "ai");
  await page.getByLabel("AI Base URL", { exact: true }).fill("https://custom.example/api/v1");
  await wizardStep(page, 0, "ai");
  await page.getByLabel("模型标识", { exact: true }).fill("my-provider/my-new-model:latest");
  await wizardStep(page, 0, "ai");
  await page.getByLabel("API Key", { exact: true }).fill("test-only-new-key");
  await wizardStep(page, 1, "ai");
  await page.getByLabel("最大输出 Token", { exact: true }).fill("8192");
  await wizardStep(page, 1, "ai");
  await page.getByLabel("请求超时（秒）", { exact: true }).fill("120");
  await wizardStep(page, 1, "ai");
  await page.getByLabel("输出 Token 参数", { exact: true }).selectOption("max_completion_tokens");
  await wizardStep(page, 1, "ai");
  await page.getByLabel("供应商扩展参数（JSON，可选）", { exact: true }).fill('{"reasoning_effort":"high","thinking":{"type":"disabled"}}');
  await wizardStep(page, 3, "ai");
  await page.getByLabel("当前 Owner 密码", { exact: true }).fill("test-owner-password");
  await expect(page.getByRole("button", { name: "测试已保存配置" })).toBeDisabled();
  await wizardStep(page, 3, "ai");
  await page.getByRole("button", { name: "验证并保存组织配置" }).click();
  await expect.poll(() => payload).toMatchObject({ model: "my-provider/my-new-model:latest", baseUrl: "https://custom.example/api/v1", maxOutputTokens: 8192, generationOptions: { requestTimeoutMs: 120000, tokenLimitParameter: "max_completion_tokens", extraBody: { reasoning_effort: "high", thinking: { type: "disabled" } } } });
  await expect(page.getByLabel("模型标识", { exact: true })).toBeDisabled();
  release();
  await expect(page.getByRole("status").filter({ hasText: "组织 AI 配置已保存" })).toBeVisible();
  await expect(page.getByLabel("模型标识", { exact: true })).toHaveValue("my-provider/my-new-model:latest");
  await expect(page.getByLabel("API Key", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("当前 Owner 密码", { exact: true })).toHaveValue("");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); window.scrollTo(0, 0); });
  await page.screenshot({ path: testInfo.outputPath("ai-settings-light.png"), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath("ai-settings-viewport.png") });
});

test("invalid or private extensions cannot be saved and non-owners cannot access config", async ({ page }) => {
  await workspace(page);
  await page.goto("/ai/settings");
  await wizardStep(page, 1, "ai");
  const extensions = page.getByLabel("供应商扩展参数（JSON，可选）", { exact: true });
  await extensions.fill('{"model":"overwrite"}');
  await expect(page.getByRole("alert").filter({ hasText: "由上方表单或系统管理" })).toBeVisible();
  await page.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(page.locator(".ai-settings-card .fx-step-content")).toHaveAttribute("data-active-stage", "1");
  await extensions.fill('{"nested":{"api_key":"unsafe"}}');
  await expect(page.getByRole("alert").filter({ hasText: "密钥、凭据" })).toBeVisible();
  await extensions.fill('{broken');
  await expect(page.getByRole("alert").filter({ hasText: "JSON 格式有误" })).toBeVisible();
  await page.unroute("**/api/**");
  await workspace(page, false);
  await page.reload();
  await expect(page.getByRole("heading", { name: "暂无此页面的访问权限" })).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "搜索工作台" }).fill("模型配置");
  await expect(page.getByRole("option", { name: /AI 模型配置/ })).toHaveCount(0);
});

test("dashboard surfaces render without overflow in light and system dark themes", async ({ page }, testInfo) => {
  await workspace(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "界面验收，今天好" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dashboard-light.png"), fullPage: true });
  await page.screenshot({ path: testInfo.outputPath("dashboard-viewport.png") });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.getByRole("button", { name: "外观设置", exact: true }).click();
  await page.getByRole("button", { name: "跟随系统", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "system");
  await page.screenshot({ path: testInfo.outputPath("dashboard-system-dark.png"), fullPage: true });
  expect(errors).toEqual([]);
});
