import { expect, test } from "@playwright/test";

test("chart data opens on the first pointer activation and remains keyboard accessible", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@acceptance.test");
  await page.getByLabel("密码", { exact: true }).fill("Acceptance-Only-Password-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
  const records = await (await page.request.get("/api/work-sessions?limit=1")).json();
  if (!records.items.length) {
    const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
    const response = await page.request.post("/api/work-sessions", { headers: { "x-csrf-token": csrfToken }, data: {
      content: "图表交互验收", startAt: new Date(Date.now() - 10800_000).toISOString(), endAt: new Date(Date.now() - 7200_000).toISOString(),
      timezone: "Asia/Shanghai", source: "manual", visibility: "management_only", breaks: [],
    } });
    expect(response.ok(), await response.text()).toBe(true);
  }
  await page.goto("/analytics");
  const summary = page.getByText("查看每日净工时趋势图数据", { exact: true });
  const table = page.getByRole("region", { name: "每日净工时趋势图数据表", exact: true });
  await expect(summary).toBeVisible();
  await summary.click();
  await expect(table).toBeVisible();
  await summary.press("Enter");
  await expect(table).toBeHidden();
  for (let i = 0; i < 3; i++) {
    if (testInfo.project.use.hasTouch) await summary.tap();
    else await summary.click();
    await expect(table).toBeVisible();
    await summary.press("Enter");
    await expect(table).toBeHidden();
    await summary.press("Space");
    await expect(table).toBeVisible();
    await summary.press("Enter");
    await expect(table).toBeHidden();
  }
});
