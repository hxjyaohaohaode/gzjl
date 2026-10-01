import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";

async function call(client: APIRequestContext, method: string, path: string, data?: unknown) {
  const headers = method === "GET" ? {} : { "x-csrf-token": (await (await client.get("/api/auth/csrf")).json()).csrfToken };
  const response = await client.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.json();
}

test("uniform 168.19 subsidies survive different version dates and reconcile two-decimal payroll downloads", async ({ page, browser }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login"); await page.getByLabel("邮箱或手机号").fill("owner@acceptance.test");
  await page.getByLabel("密码", { exact: true }).fill("Acceptance-Only-Password-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click(); await expect(page).toHaveURL("http://127.0.0.1:3100/");
  const memberIds: string[] = [];
  for (const [index, seconds] of [143_992, 143_886].entries()) {
    const invitation = await call(page.request, "POST", "/api/organization/invitations", {
      displayName: `统一补贴核对成员 ${index + 1}`, email: `money-${index}@acceptance.test`, deliveryMode: "manual", orgUnitId: null,
    });
    const token = new URLSearchParams(new URL(invitation.manualLink).hash.slice(1)).get("token");
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
    try {
      await call(context.request, "POST", "/api/auth/invitations/accept", { token, password: "Acceptance-Only-Password-2026!" });
      await call(context.request, "POST", "/api/auth/login", { identifier: `money-${index}@acceptance.test`, password: "Acceptance-Only-Password-2026!" });
      const me = await call(context.request, "GET", "/api/me"); const membershipId = me.user.membershipId;
      memberIds.push(membershipId);
      const common = { name: "统一月薪及补贴", type: "monthly", baseAmount: "2866.920833", currency: "CNY", rules: [] };
      await call(page.request, "PUT", `/api/payroll/members/${membershipId}/plan`, { ...common,
        effectiveFrom: "2026-06-01T00:00:00Z", subsidies: [{ name: "统一补贴", amount: "168.19", distribution: "daily" }],
      });
      // Omitting distribution now explicitly means a full-cycle fixed benefit.
      await call(page.request, "PUT", `/api/payroll/members/${membershipId}/plan`, { ...common,
        effectiveFrom: new Date(Date.parse("2026-06-01T00:00:00Z") + seconds * 1000).toISOString(),
        subsidies: [{ name: "统一补贴", amount: "168.19" }],
      });
    } finally { await context.close(); }
  }
  const period = (await call(page.request, "POST", "/api/payroll/periods", { name: "六月统一补贴及分币核对", timezone: "UTC",
    startsAt: "2026-06-01T00:00:00Z", endsAt: "2026-07-01T00:00:00Z", cutoffAt: "2026-07-05T10:00:00Z",
  })).period;
  const run = (await call(page.request, "POST", `/api/pay-periods/${period.id}/calculate`, {})).run;
  const preview = await call(page.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
  const rows = preview.rows.filter((row: { membershipId: string }) => memberIds.includes(row.membershipId));
  expect(rows).toHaveLength(2); expect(preview.blockers).toEqual([]);
  for (const row of rows) expect(row).toMatchObject({ amounts: { subsidies: "168.190000", wages: "2866.920000" }, finalAmount: "3035.110000" });
  await page.goto(`/payroll?handoff=${run.id}`);
  await expect(page.getByRole("heading", { name: "老板核对：每人薪资总览 + 本周期工作明细" })).toBeVisible();
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "本周期合计" }) });
    for (const name of ["统一补贴核对成员 1", "统一补贴核对成员 2"]) {
      const row = table.getByRole("row").filter({ hasText: name });
      await expect(row.locator("td").nth(2)).toHaveText("2866.92");
      await expect(row.locator("td").nth(4)).toHaveText("168.19");
      await expect(row.locator("td").nth(7)).toHaveText("CNY 3,035.11");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`money-${width}.png`), fullPage: true });
  }
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载薪资总览及工作明细 Excel", exact: true }).click();
  expect((await download).suggestedFilename()).toContain("未确认");
  await call(page.request, "POST", `/api/payroll-runs/${run.id}/handoff`, { previewHash: preview.previewHash, identityMatchingConfirmed: true, exceptionsAcknowledged: true });
  const batch = await call(page.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
  const csv = await page.request.get(`/api/payroll-runs/${run.id}/finance-export.csv`);
  const bytes = await csv.body(); expect(createHash("sha256").update(bytes).digest("hex")).toBe(batch.batch.sha256);
  const csvRows = (await csv.text()).trim().split("\r\n").slice(1).map((line) => line.match(/"(?:[^"]|"")*"/g)!);
  expect(csvRows).toHaveLength(2);
  expect(csvRows.map((row) => row[0]!.slice(1, -1)).sort()).toEqual([...memberIds].sort());
  for (const row of csvRows) {
    expect(row[10]).toBe('"3035.11"'); expect(row[11]).toBe('"0.00"'); expect(row[12]).toBe('"3035.11"');
  }
  expect(await (await page.request.get(`/api/payroll-runs/${run.id}/finance-export.csv`)).body()).toEqual(bytes);
  expect(errors).toEqual([]);
});
