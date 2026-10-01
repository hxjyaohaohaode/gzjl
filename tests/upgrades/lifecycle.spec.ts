import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

async function call(client: APIRequestContext, method: string, path: string, data?: unknown) {
  const headers: Record<string, string> = method === "GET" ? {} : { "x-csrf-token": (await (await client.get("/api/auth/csrf")).json()).csrfToken };
  const response = await client.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
async function login(page: Page, email: string) {
  await page.goto("/login"); await page.getByLabel("邮箱或手机号").fill(email); await page.getByLabel("密码", { exact: true }).fill("Acceptance-Only-Password-2026!");
  await page.getByRole("button", { name: "登录", exact: true }).click(); await expect(page).toHaveURL("http://127.0.0.1:3100/");
}
test("long content, evidence queue, restoration, contextual approval and exact handoff remain operable at all screen sizes", async ({ page: owner, browser }, testInfo) => {
  const errors: string[] = []; owner.on("pageerror", (e) => errors.push(e.message));
  await login(owner, "owner@acceptance.test");
  const context = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: { width: 390, height: 844 }, timezoneId: "Asia/Shanghai", hasTouch: true });
  const member = await context.newPage(); member.on("pageerror", (e) => errors.push(e.message));
  try {
    const invite = await call(owner.request, "POST", "/api/organization/invitations", { displayName: "同名成员与多附件长文本验收", email: "deep@acceptance.test", deliveryMode: "manual", orgUnitId: null });
    const token = new URLSearchParams(new URL(invite.manualLink).hash.slice(1)).get("token");
    await call(member.request, "POST", "/api/auth/invitations/accept", { token, password: "Acceptance-Only-Password-2026!" });
    await login(member, "deep@acceptance.test");
    const me = await call(member.request, "GET", "/api/me");
    await owner.goto("/payroll");
    await owner.getByLabel("最多补录多少天前的工作").fill("7");
    await owner.getByRole("button", { name: "保存提交与补录规则" }).click();
    await expect(owner.getByText("规则已生效。", { exact: true })).toBeVisible();
    expect((await call(owner.request, "GET", "/api/work-policy")).version).toBe(1);
    const csrf = (await (await member.request.get("/api/auth/csrf")).json()).csrfToken;
    expect((await member.request.put("/api/work-policy", { headers: { "x-csrf-token": csrf }, data: { manualEntryLookbackDays: 366, expectedVersion: 1 } })).status()).toBe(403);
    await expect(member.getByText("当前没有生效的计薪方案", { exact: false })).toBeVisible();
    await owner.goto("/payroll"); await expect(owner.getByRole("heading", { name: "已加入但缺计薪方案" })).toBeVisible();
    await call(owner.request, "PUT", `/api/payroll/members/${me.user.membershipId}/plan`, { name: "验收时薪", type: "hourly", baseAmount: "100.00", effectiveFrom: new Date(Date.now() - 7 * 86400_000).toISOString(), rules: [] });
    const createdProject = await call(owner.request, "POST", "/api/projects", { key: "DEEP", name: "手机项目名称包含长内容和多个交付节点".repeat(4), description: "项目背景与完整交付要求\n".repeat(150) });
    await call(member.request, "POST", `/api/projects/${createdProject.project.id}/members/self`, {});
    const node = (await call(owner.request, "POST", `/api/projects/${createdProject.project.id}/nodes`, { branchId: createdProject.branch.id, parentId: createdProject.root.id, title: "长任务名称与明确交付范围".repeat(7), type: "task", progressMode: "manual", sortOrder: 1 })).node;
    const text = "交付内容、阻塞与下一步需要完整可见。\n".repeat(220);
    const startAt = new Date(Date.now() - 3_600_000).toISOString(); const endAt = new Date(Date.now() - 10_000).toISOString();
    const input = { source: "manual", content: text, result: "完成的事实结果\n".repeat(50), blockers: "依赖尚未确定\n".repeat(30), nextStep: "需要项目负责人确认后续节点", startAt, endAt, timezone: "Asia/Shanghai", visibility: "project_visible", primaryProjectNodeId: node.id, projectNodeIds: [node.id], breaks: [] };
    const { session } = await call(member.request, "POST", "/api/work-sessions", input);
    await member.goto(`/work?record=${session.id}&version=${session.version}`);
    await expect(member.getByRole("button", { name: "编辑定位到的草稿" })).toBeVisible();
    await member.locator(`#work-record-${session.id}`).getByRole("button", { name: "归档误填草稿" }).click({ trial: true });
    await call(member.request, "POST", `/api/work-sessions/${session.id}/archive-action`, { action: "archive", expectedVersion: session.version });
    await member.goto("/work"); await member.getByText("误填恢复 · 已归档草稿与计划", { exact: true }).click();
    await member.getByRole("button", { name: "恢复为草稿" }).click();
    await expect(member.locator(`#work-record-${session.id}`)).toBeVisible();
    const current = (await call(member.request, "GET", "/api/work-sessions?limit=100")).items.find((r: { id: string }) => r.id === session.id);
    const panel = member.locator(`#work-record-${session.id}`);
    await panel.getByText("证据", { exact: true }).click();
    await panel.locator('input[type="file"]').setInputFiles([{ name: "长文件名-多片段完整性验证.bin", mimeType: "application/octet-stream", buffer: Buffer.alloc(2_500_001, 153) }, { name: "图片证据.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tOIAAAAASUVORK5CYII=", "base64") }]);
    await expect.poll(async () => (await call(member.request, "GET", `/api/work-sessions/${session.id}/attachments`)).items.filter((a: { status: string }) => a.status === "available").length).toBe(2);
    for (let i = 0; i < 12; i++) await call(member.request, "POST", `/api/work-sessions/${session.id}/attachments/reference`, { kind: "text", textContent: `证据 ${i}：` + "详细事实与验收依据。".repeat(90), visibility: "management_only" });
    await call(member.request, "POST", `/api/work-sessions/${session.id}/submit`, { expectedVersion: current.version });
    await owner.goto("/approvals"); await owner.getByRole("button", { name: "查看工作与附件" }).click();
    await expect(owner.getByText("审核依据与历次退回原因", { exact: true })).toBeVisible();
    await expect(owner.getByText("提交人：同名成员与多附件长文本验收", { exact: true })).toBeVisible();
    await expect(owner.getByText("图片证据.png", { exact: true }).first()).toBeVisible();
    // A boss-defined partial cycle must be usable through the actual form.
    await owner.goto("/payroll");
    const localInput = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date).replace(" ", "T");
    await owner.getByLabel("周期名称", { exact: true }).fill("老板指定非自然月交接验收");
    await owner.getByLabel("周期开始（含）", { exact: true }).fill(localInput(new Date(Date.now() - 86400_000)));
    await owner.getByLabel("周期结束（不含）", { exact: true }).fill(localInput(new Date(Date.now() - 1000)));
    const createdResponse = owner.waitForResponse((r) => r.url().endsWith("/api/payroll/periods") && r.request().method() === "POST");
    await owner.getByRole("button", { name: "保存老板指定周期", exact: true }).click();
    const period = (await (await createdResponse).json()).period;
    expect(period).toBeTruthy();
    await owner.getByRole("button", { name: "计算并查看薪资总览", exact: true }).click();
    await expect(owner.getByRole("heading", { name: "老板核对：每人薪资总览 + 本周期工作明细" })).toBeVisible();
    await expect(owner).toHaveURL(/handoff=/);
    await expect(owner.getByRole("button", { name: "确认导出并锁定", exact: true })).toBeDisabled();
    const statisticsResponse = owner.waitForResponse((r) => r.url().endsWith("/report.xlsx"));
    const statisticsDownload = owner.waitForEvent("download");
    await owner.getByRole("button", { name: "下载薪资总览及工作明细 Excel", exact: true }).click();
    const statistics = await statisticsDownload; const statisticsFile = await statistics.path();
    expect(statistics.suggestedFilename()).toContain("未确认");
    const response = await statisticsResponse; expect(response.ok()).toBeTruthy();
    expect(createHash("sha256").update(await readFile(statisticsFile!)).digest("hex")).toBe(response.headers()["x-content-sha256"]);
    const pendingRunId = new URL(owner.url()).searchParams.get("handoff");
    expect((await call(owner.request, "GET", `/api/payroll-runs/${pendingRunId}/handoff`)).batch).toBeNull();
    expect((await member.request.get(`/api/payroll-runs/${pendingRunId}/report.xlsx`)).status()).toBe(403);
    await owner.reload(); await expect(owner.getByRole("heading", { name: "老板核对：每人薪资总览 + 本周期工作明细" })).toBeVisible();
    await owner.goto("/approvals");
    await owner.getByRole("button", { name: "批准", exact: true }).click();
    await expect.poll(async () => (await call(owner.request, "GET", `/api/work-facts/${session.id}`)).session.approvalStatus).toBe("approved");

    const { run } = await call(owner.request, "POST", `/api/pay-periods/${period.id}/calculate`); expect(run.status).toBe("ready");
    expect((await owner.request.get(`/api/payroll-runs/${run.id}/finance-export.csv`)).status()).toBe(409);
    await owner.goto(`/projects/${createdProject.project.id}?node=${createdProject.root.id}`);
    await expect(owner.locator(".project-node-inspector")).toBeVisible();
    await owner.locator(".project-node-inspector-head").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(owner.locator(".project-node-inspector")).toHaveCount(0);
    await owner.evaluate((path) => { window.history.pushState({}, "", path); window.dispatchEvent(new PopStateEvent("popstate")); }, `/projects/${createdProject.project.id}?node=${node.id}`);
    await expect(owner.locator(".project-node-inspector-head h2")).toHaveText(node.title);
    const longBody = owner.locator(".project-linked-work-content");
    await expect(longBody).not.toHaveAttribute("open");
    await longBody.locator("summary").click(); await expect(longBody.locator("p")).toHaveText(text);
    await longBody.locator("summary").click();
    await owner.locator(".project-node-inspector-head").getByRole("button", { name: "关闭", exact: true }).click();
    await expect(owner.locator(".project-node-inspector")).toHaveCount(0);
    const description = owner.locator(".project-description-full");
    await expect(description).not.toHaveAttribute("open");
    await description.locator("summary").click(); await expect(description.locator("p")).toHaveText(createdProject.project.description);
    await description.locator("summary").click();
    for (const [width, height] of [[320, 740], [360, 800], [390, 844], [844, 390], [768, 1024], [1920, 1080]]) {
      await owner.setViewportSize({ width: width!, height: height! }); await member.setViewportSize({ width: width!, height: height! });
      for (const [page, path] of [[member, `/work?record=${session.id}&version=1`], [owner, "/team"], [owner, `/projects/${createdProject.project.id}?node=${node.id}`], [owner, "/analytics"], [owner, "/payroll"]] as const) {
        await page.goto(path); await expect(page.locator("#main-content")).toBeVisible(); await expect(page.locator("main .animate-spin")).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${width}x${height} ${path} overflow`).toBe(true);
        if (path.startsWith("/projects/")) {
          const heading = page.locator(".project-node-inspector-head > div:first-child");
          expect((await heading.boundingBox())!.width).toBeGreaterThan(Math.min(width! - 64, 150));
          expect((await page.locator(".project-linked-work-content summary").boundingBox())!.height).toBeLessThan(300);
          expect((await page.locator(".project-overview-identity").boundingBox())!.height).toBeLessThan(380);
        }
        await page.screenshot({ path: testInfo.outputPath(`${width}x${height}-${page === owner ? "owner" : "member"}-${path.split("?")[0]!.replaceAll("/", "_")}.png`), fullPage: true });
      }
      await owner.getByRole("button", { name: "核对导出预览", exact: true }).click();
      await expect(owner.getByRole("heading", { name: "薪资交接 · 预检与逐行预览" })).toBeVisible();
      expect(await owner.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await owner.goto("/analytics");
    await expect(owner.locator(".fact-explorer")).toHaveCount(0);
    await expect(owner.getByRole("button", { name: "生成本人可校对回顾" })).toHaveCount(0);
    await owner.getByLabel("历史月份", { exact: true }).fill("2026-03");
    const historyResponse = owner.waitForResponse((response) => response.url().includes("/api/analytics/summary?") && new URL(response.url()).searchParams.get("from") === "2026-02-28T16:00:00.000Z");
    await owner.getByRole("button", { name: "应用历史范围" }).click(); expect((await historyResponse).ok()).toBeTruthy();
    await owner.goto("/payroll"); await owner.getByRole("button", { name: "核对导出预览", exact: true }).click();
    const preview = await call(owner.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
    expect(preview.blockers).toEqual([]);
    await owner.getByText("正式交接：核对外部人员编号和方案版本", { exact: true }).click();
    const identity = owner.getByLabel("同名成员与多附件长文本验收 外部人员编号"); await identity.fill("external-platform-member-001");
    await owner.getByRole("button", { name: "保存映射", exact: true }).click();
    await expect.poll(async () => (await call(owner.request, "GET", `/api/payroll-runs/${run.id}/handoff`)).previewHash).not.toBe(preview.previewHash);
    await owner.getByRole("checkbox", { name: /我已逐行核对金额和人员编号/ }).check();
    await expect(owner.getByRole("button", { name: "确认导出并锁定", exact: true })).toBeEnabled();
    await owner.getByRole("button", { name: "确认导出并锁定", exact: true }).click();
    await expect(owner.getByText("已确认交接批次：", { exact: false })).toBeVisible();
    const saved = await call(owner.request, "GET", `/api/payroll-runs/${run.id}/handoff`);
    const exported = await owner.request.get(`/api/payroll-runs/${run.id}/finance-export.csv`); const bytes = await exported.body();
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(saved.batch.sha256); expect(exported.headers()["x-content-sha256"]).toBe(saved.batch.sha256);
    const workbook = await owner.request.get(`/api/payroll-runs/${run.id}/handoff.xlsx`);
    expect(workbook.ok()).toBeTruthy(); expect(createHash("sha256").update(await workbook.body()).digest("hex")).toBe(saved.batch.manifest.workbookSha256);
    const xlsxDownload = owner.waitForEvent("download"); await owner.getByRole("button", { name: "下载薪资及完整工作单 Excel" }).click();
    const completeFile = await xlsxDownload; expect(completeFile.suggestedFilename()).toBe(saved.batch.manifest.workbookFileName);
    await completeFile.saveAs(testInfo.outputPath("周期工作记录-薪资账单示例.xlsx"));
    expect(createHash("sha256").update(await readFile((await completeFile.path())!)).digest("hex")).toBe(saved.batch.manifest.workbookSha256);
    expect(saved.batch.manifest.worksheetOrder.slice(0, 2)).toEqual(["薪资总览", "周期工作记录"]);
    const download = owner.waitForEvent("download"); await owner.getByRole("button", { name: "重取已确认原文件" }).click(); expect((await download).suggestedFilename()).toBe(saved.batch.fileName);
    expect(errors).toEqual([]);
    const authCsrf = (await (await owner.request.get("/api/auth/csrf")).json()).csrfToken;
    const cookies = await owner.context().cookies();
    const outcomes: number[] = [];
    for (let i = 0; i < 9; i++) { const response = await owner.request.post("/api/auth/login", { headers: { "x-csrf-token": authCsrf, cookie: cookies.filter((c) => c.name !== "workbench_session").map((c) => `${c.name}=${c.value}`).concat(`workbench_session=forged-${i}`).join("; ") }, data: { identifier: "invalid", password: "invalid" } }); outcomes.push(response.status()); }
    expect(outcomes.at(-1)).toBe(429);
  } finally {
    // Playwright owns the browser fixture and also closes timed-out contexts.
    // An already-closed context must not replace the original assertion error.
    await context.close().catch(() => undefined);
  }
});
