import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { expect, test, type APIRequestContext } from "@playwright/test";
import type ExcelJSModule from "../../apps/server/node_modules/exceljs";

// Inspect the actual downloaded file with the application's XLSX reader.
const requireServer = createRequire(new URL("../../apps/server/package.json", import.meta.url));
const ExcelJS = requireServer("exceljs") as typeof ExcelJSModule;

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

test("independent identical subsidies stay 168.19 in a boss-defined cycle and one downloaded workbook starts with overview and work", async ({ page, browser }, testInfo) => {
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login"); await page.getByLabel("邮箱或手机号").fill("owner@acceptance.test");
  await page.getByLabel("密码", { exact: true }).fill("Acceptance-Only-Password-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click(); await expect(page).toHaveURL("http://127.0.0.1:3100/");
  const ids: string[] = [];
  for (const [index, type] of (["hourly", "daily", "monthly", "hybrid"] as const).entries()) {
    const invitation = await call(page.request, "POST", "/api/organization/invitations", {
      displayName: `独立补贴 ${type}`, email: `independent-${index}@acceptance.test`, deliveryMode: "manual", orgUnitId: null,
    });
    const token = new URLSearchParams(new URL(invitation.manualLink).hash.slice(1)).get("token");
    const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100" });
    try {
      await call(context.request, "POST", "/api/auth/invitations/accept", { token, password: "Acceptance-Only-Password-2026!" });
      await call(context.request, "POST", "/api/auth/login", { identifier: `independent-${index}@acceptance.test`, password: "Acceptance-Only-Password-2026!" });
      const me = await call(context.request, "GET", "/api/me"); const membershipId: string = me.user.membershipId; ids.push(membershipId);
      const configured = await call(page.request, "PUT", `/api/payroll/members/${membershipId}/plan`, {
        name: `各自独立设置 ${type}`, type, baseAmount: "0", fixedAmount: "0", currency: "CNY", rules: [],
        effectiveFrom: `2026-08-${String([6, 12, 19, 24][index]).padStart(2, "0")}T00:00:00Z`,
        subsidies: [{ name: "个人补贴", amount: "168.19", ...(index % 2 === 0 ? { distribution: "daily" } : {}) }],
      });
      expect(configured.result.version.config.subsidies).toEqual([{ name: "个人补贴", amount: "168.19", distribution: "period_end" }]);
    } finally { await context.close(); }
  }
  const period = (await call(page.request, "POST", "/api/payroll/periods", { name: "老板指定八月独立补贴周期", timezone: "UTC",
    startsAt: "2026-08-05T00:00:00Z", endsAt: "2026-08-25T00:00:00Z", cutoffAt: "2026-08-27T10:00:00Z",
  })).period;
  const run = (await call(page.request, "POST", `/api/pay-periods/${period.id}/calculate`, {})).run;
  const preview = await call(page.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
  const rows = preview.rows.filter((row: { membershipId: string }) => ids.includes(row.membershipId));
  expect(rows).toHaveLength(4); expect(preview.blockers).toEqual([]);
  for (const row of rows) expect(row).toMatchObject({ amounts: { wages: "0.000000", subsidies: "168.190000" }, finalAmount: "168.190000" });
  await page.goto(`/payroll?handoff=${run.id}`);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const table = page.getByRole("table").filter({ has: page.getByRole("columnheader", { name: "本周期合计" }) });
    for (const type of ["hourly", "daily", "monthly", "hybrid"]) {
      const row = table.getByRole("row").filter({ hasText: `独立补贴 ${type}` });
      await expect(row.locator("td").nth(4)).toHaveText("168.19");
      await expect(row.locator("td").nth(7)).toHaveText("CNY 168.19");
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`independent-${width}.png`), fullPage: true });
  }
  const download = page.waitForEvent("download"); await page.getByRole("button", { name: "下载薪资总览及工作明细 Excel", exact: true }).click();
  const file = await download; expect(file.suggestedFilename()).toMatch(/未确认.*\.xlsx$/);
  await file.saveAs(testInfo.outputPath("独立补贴-薪资工作簿示例.xlsx"));
  const book = new ExcelJS.Workbook(); await book.xlsx.readFile((await file.path())!);
  expect(book.worksheets.slice(0, 2).map((sheet) => sheet.name)).toEqual(["薪资总览", "周期工作记录"]);
  const summary = book.worksheets[0]!; let verified = 0;
  summary.eachRow((row, index) => { if (index > 1 && ids.includes(String(row.getCell(1).value))) {
    verified++; expect(row.getCell(13).value).toBe("168.19"); expect(row.getCell(18).value).toBe("168.19");
  } }); expect(verified).toBe(4);
  await call(page.request, "POST", `/api/payroll-runs/${run.id}/handoff`, { previewHash: preview.previewHash, identityMatchingConfirmed: true, exceptionsAcknowledged: true });
  const confirmed = await call(page.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
  expect(confirmed.batch.manifest.worksheetOrder.slice(0, 2)).toEqual(["薪资总览", "周期工作记录"]);
  const xlsx = await page.request.get(`/api/payroll-runs/${run.id}/handoff.xlsx`);
  const bytes = await xlsx.body(); expect(createHash("sha256").update(bytes).digest("hex")).toBe(confirmed.batch.manifest.workbookSha256);
  const original = new ExcelJS.Workbook(); await original.xlsx.load(bytes as unknown as Parameters<typeof original.xlsx.load>[0]);
  expect(original.worksheets.slice(0, 2).map((sheet) => sheet.name)).toEqual(["薪资总览", "周期工作记录"]);
  expect(await (await page.request.get(`/api/payroll-runs/${run.id}/handoff.xlsx`)).body()).toEqual(bytes);
  expect(errors).toEqual([]);
});
