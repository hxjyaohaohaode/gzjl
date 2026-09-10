import { expect, test, type Page, type APIRequestContext } from "@playwright/test";
import { writeFile } from "node:fs/promises";

const password = "Acceptance-Only-Password-2026!";
async function call(client: APIRequestContext, method: string, path: string, data?: unknown) {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-csrf-token"] = (await (await client.get("/api/auth/csrf")).json()).csrfToken;
  const response = await client.fetch(path, { method, headers, ...(data === undefined ? {} : { data }) });
  expect(response.ok(), `${method} ${path}: ${await response.text()}`).toBeTruthy();
  return response.status() === 204 ? undefined : response.json();
}
async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill(email);
  await page.getByLabel("密码", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/");
}

test("real API, database and file bytes connect the employee and management workspaces", async ({ page: owner, browser }, testInfo) => {
  const errors: string[] = [];
  const inspectErrors = (page: Page) => {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => { if (response.status() >= 500 && response.url().includes("/api/")) errors.push(`${response.status()} ${response.url()}`); });
  };
  inspectErrors(owner);
  await login(owner, "owner@acceptance.test");
  const suffix = testInfo.project.name.replaceAll("-", "");
  const employeeEmail = `${suffix}@acceptance.test`;
  const invitation = await call(owner.request, "POST", "/api/organization/invitations", { displayName: `验收员工${suffix}`, email: employeeEmail, deliveryMode: "manual", orgUnitId: null });
  const employeeContext = await browser.newContext({ baseURL: "http://127.0.0.1:3100", viewport: owner.viewportSize(), timezoneId: "Asia/Shanghai", isMobile: testInfo.project.use.isMobile ?? false, hasTouch: testInfo.project.use.hasTouch ?? false });
  const employee = await employeeContext.newPage();
  inspectErrors(employee);
  try {
    const token = new URLSearchParams(new URL(invitation.manualLink).hash.slice(1)).get("token");
    expect(token).toBeTruthy();
    await call(employee.request, "POST", "/api/auth/invitations/accept", { token, password });
    await login(employee, employeeEmail);
    const me = await call(employee.request, "GET", "/api/me");
    expect(me.permissions.some((grant: { permission: string }) => grant.permission === "project.manage")).toBe(false);
    expect((await employee.request.get("/api/approvals")).status()).toBe(403);
    await call(owner.request, "PUT", `/api/payroll/members/${me.user.membershipId}/plan`, { name: "验收时薪", type: "hourly", baseAmount: "100.00", effectiveFrom: new Date(Date.now() - 7 * 86400_000).toISOString(), rules: [] });
    const created = await call(owner.request, "POST", "/api/projects", { key: `P${suffix}`, name: `全链路验收${suffix}` });
    const projectId = created.project.id;
    const { node } = await call(owner.request, "POST", `/api/projects/${projectId}/nodes`, { branchId: created.branch.id, parentId: created.root.id, title: "手机和桌面真实交付任务", type: "task", progressMode: "manual", sortOrder: 1 });
    await owner.goto(`/projects/${projectId}`);
    await employee.goto("/projects");
    await employee.getByRole("button", { name: `加入项目 全链路验收${suffix}` }).click();
    await employee.getByRole("link").filter({ hasText: `全链路验收${suffix}` }).click();
    await employee.getByText("手机和桌面真实交付任务", { exact: true }).first().click();
    await employee.getByRole("button", { name: "认领此节点" }).click();
    await expect(employee.getByText("你已认领此节点，可在添加工作记录时同步完成度。")).toBeVisible();
    await expect.poll(async () => (await call(owner.request, "GET", `/api/projects/${projectId}/tree`)).nodeAssignees.some((item: { membershipId: string }) => item.membershipId === me.user.membershipId)).toBe(true);
    const secondProject = await call(owner.request, "POST", "/api/projects", { key: "Q" + suffix, name: "第二项目" + suffix });
    const secondNode = (await call(owner.request, "POST", "/api/projects/" + secondProject.project.id + "/nodes", { branchId: secondProject.branch.id, parentId: secondProject.root.id, title: "跨项目同步验收", type: "task", progressMode: "manual", sortOrder: 1 })).node;
    await call(employee.request, "POST", "/api/projects/" + secondProject.project.id + "/members/self", {});
    await employee.goto("/work");
    await employee.getByRole("button", { name: "手工录入" }).click();
    await employee.getByLabel("工作内容").fill(`真实验收交付${suffix}`);
    await employee.getByLabel("关联项目（可选）", { exact: true }).selectOption(projectId);
    await employee.getByLabel("关联 手机和桌面真实交付任务", { exact: true }).check();
    await employee.getByLabel("更新 手机和桌面真实交付任务 的进度").check();
    await employee.getByRole("button", { name: "75%", exact: true }).click();
    await employee.getByLabel("关联项目（可选）", { exact: true }).selectOption(secondProject.project.id);
    await employee.getByLabel("关联 跨项目同步验收", { exact: true }).check();
    await employee.getByLabel("更新 跨项目同步验收 的进度").check();
    await employee.getByLabel("跨项目同步验收完成度", { exact: true }).fill("50");
    await employee.locator('.work-direct-file input[type="file"]').setInputFiles({ name: "真实字节.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tOIAAAAASUVORK5CYII=", "base64") });
    await expect(employee.getByRole("img", { name: "待上传图片：真实字节.png" })).toBeVisible();
    expect(await employee.locator("form").filter({ has: employee.getByRole("button", { name: "保存真实工时草稿" }) }).locator("input, textarea, select").evaluateAll((fields) => fields.filter((field) => !(field as HTMLInputElement).checkValidity()).map((field) => ({ html: field.outerHTML, error: (field as HTMLInputElement).validationMessage })))).toEqual([]);
    await employee.getByRole("button", { name: "保存真实工时草稿" }).click();
    await expect(employee.getByText("已保存 1 段工作。", { exact: true })).toBeVisible();
    const { items: records } = await call(employee.request, "GET", "/api/work-sessions?limit=10");
    const record = records.find((item: { content: string }) => item.content === `真实验收交付${suffix}`);
    const proof = await call(employee.request, "GET", `/api/work-sessions/${record.id}/attachments`);
    expect(proof.items[0]).toMatchObject({ status: "available", kind: "file", originalName: "真实字节.png" });
    const tree = await call(owner.request, "GET", `/api/projects/${projectId}/tree`);
    expect(Number(tree.nodes.find((item: { id: string }) => item.id === node.id).progress)).toBe(75);
    const secondTree = await call(owner.request, "GET", "/api/projects/" + secondProject.project.id + "/tree");
    expect(Number(secondTree.nodes.find((item: { id: string }) => item.id === secondNode.id).progress)).toBe(50);
    expect(record.projectLinks).toHaveLength(2);
    await employee.getByRole("button", { name: "提交审核", exact: true }).click();
    await expect.poll(async () => (await call(owner.request, "GET", "/api/approvals")).items.some((item: { session: { id: string } }) => item.session.id === record.id)).toBe(true);
    await owner.goto("/approvals");
    await owner.getByRole("button", { name: "查看工作与附件" }).click();
    await expect(owner.getByText("真实字节.png", { exact: true }).first()).toBeVisible();
    const downloaded = await owner.request.get(`/api/attachments/${proof.items[0].id}/open?mode=download`);
    expect(downloaded.ok()).toBe(true);
    expect((await downloaded.body()).toString("base64")).toBe("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6tOIAAAAASUVORK5CYII=");
    await owner.getByRole("button", { name: "批准", exact: true }).click();
    await expect.poll(async () => (await call(owner.request, "GET", "/api/approvals")).items.length).toBe(0);
    await employee.reload();
    await expect(employee.getByText("已批准", { exact: true }).first()).toBeVisible();
    const payroll = await call(employee.request, "GET", "/api/payroll/me");
    expect(payroll.livePreview).toBeTruthy();
    expect(Number(payroll.livePreview.approvedSeconds)).toBeGreaterThan(0);
    const search = await call(employee.request, "GET", `/api/search?q=${encodeURIComponent(`真实验收交付${suffix}`)}`);
    expect(JSON.stringify(search)).toContain(record.id);

    // Reimbursements must travel through evidence and approval without adding work.
    const management = await call(owner.request, "GET", "/api/payroll/management");
    const period = management.periods[0] ?? (await call(owner.request, "POST", "/api/payroll/periods", {
      name: "隔离验收薪资周期", timezone: "Asia/Shanghai",
      startsAt: new Date(Date.now() - 6 * 86400_000).toISOString(),
      endsAt: new Date(Date.now() + 86400_000).toISOString(), cutoffAt: new Date(Date.now() + 86400_000).toISOString(),
    })).period;
    await employee.goto("/payroll");
    await employee.getByRole("button", { name: "申请报销", exact: true }).click();
    await employee.getByLabel("报销事项", { exact: true }).fill(`交通报销${suffix}`);
    await employee.getByLabel("发生日期").fill(new Date().toISOString().slice(0, 10));
    await employee.getByLabel("报销金额").fill("128.35");
    await employee.getByLabel("用途说明").fill("隔离环境的客户现场交通凭证验收");
    await employee.getByRole("button", { name: "保存草稿并添加凭证" }).click();
    await employee.getByRole("button", { name: "提交报销审批" }).click();
    await expect(employee.getByRole("alert")).toContainText("请先添加至少一项");
    await employee.getByPlaceholder("粘贴简短文字证据、会议纪要、命令输出或说明…").fill(`交通发票${suffix}：128.35元`);
    await employee.getByRole("button", { name: "保存文字", exact: true }).click();
    await expect(employee.getByText(`交通发票${suffix}：128.35元`, { exact: true }).first()).toBeVisible();
    await employee.getByRole("button", { name: "提交报销审批" }).click();
    await expect(employee.locator(".reimbursement-summary")).toContainText("待审批");
    await owner.goto("/approvals");
    await owner.locator(".reimbursement-summary").filter({ hasText: `交通报销${suffix}` }).click();
    await owner.getByLabel("计入薪资周期").selectOption(period.id);
    await owner.getByRole("button", { name: "批准并计入薪资", exact: true }).click();
    await expect(owner.getByText("暂无待审批报销。")).toBeVisible();
    await employee.reload();
    await expect(employee.locator(".reimbursement-summary")).toContainText("已批准");
    expect((await call(employee.request, "GET", "/api/work-sessions?limit=100")).items).toHaveLength(records.length);
    const { run } = await call(owner.request, "POST", `/api/pay-periods/${period.id}/calculate`);
    expect(["ready", "review_required"]).toContain(run.status);
    const calculated = await call(employee.request, "GET", "/api/payroll/me");
    expect(JSON.stringify(calculated)).toContain("128.35");
    await call(owner.request, "POST", `/api/payroll-runs/${run.id}/cancel-calculation`);

    // Exercise every timer transition through the UI against persisted state.
    await employee.goto("/work");
    await employee.getByLabel("准备做什么").fill(`计时状态验收${suffix}`);
    await employee.getByRole("button", { name: "开始计时", exact: true }).click();
    await employee.getByRole("button", { name: "暂停", exact: true }).click();
    await employee.getByRole("button", { name: "继续", exact: true }).click();
    await employee.getByRole("button", { name: "休息", exact: true }).click();
    await employee.getByRole("button", { name: "结束休息", exact: true }).click();
    const running = (await call(employee.request, "GET", "/api/timer")).timer;
    await expect.poll(() => Date.now() - new Date(running.stateChangedAt).getTime()).toBeGreaterThan(1200);
    await employee.getByRole("button", { name: "结束并生成工时", exact: true }).click();
    await expect(employee.getByRole("button", { name: "开始计时", exact: true })).toBeVisible();
    const timed = (await call(employee.request, "GET", "/api/work-sessions?limit=100")).items.find((item: { content: string }) => item.content === `计时状态验收${suffix}`);
    expect(timed.source).toBe("timer");
    expect(timed.netSeconds).toBeGreaterThan(0);
    const range = new URLSearchParams({ from: new Date(Date.now() - 2 * 86400_000).toISOString(), to: new Date(Date.now() + 2 * 86400_000).toISOString() });
    const totalsBefore = (await call(employee.request, "GET", `/api/analytics/summary?${range}`)).totals;
    await call(employee.request, "POST", "/api/work-plans", { source: "manual", content: `未来计划${suffix}`, startAt: new Date(Date.now() + 3600_000).toISOString(), endAt: new Date(Date.now() + 7200_000).toISOString(), timezone: "Asia/Shanghai", breaks: [] });
    expect((await call(employee.request, "GET", `/api/analytics/summary?${range}`)).totals).toEqual(totalsBefore);
    const exported = await owner.request.get(`/api/exports/work-sessions.csv?${range}`);
    expect(exported.ok()).toBe(true);
    expect(await exported.text()).toContain(`真实验收交付${suffix}`);
    expect(await exported.text()).not.toContain(`未来计划${suffix}`);

    const inventory: unknown[] = [];
    for (const [role, page, paths] of [
      ["owner", owner, ["/", "/work", "/calendar", "/projects", `/projects/${projectId}`, "/team", "/analytics", "/payroll", "/ai", "/approvals", "/organization", "/security", "/notification-preferences", "/imports"]],
      ["employee", employee, ["/", "/work", "/calendar", "/projects", `/projects/${projectId}`, "/team", "/analytics", "/payroll", "/ai", "/security", "/notification-preferences"]],
    ] as const) {
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator("#main-content")).toBeVisible();
        await expect(page.locator("main .animate-spin")).toHaveCount(0);
        if (testInfo.project.use.isMobile && path === "/calendar") {
          expect(await page.locator(".calendar-mini-days button").first().evaluate((button) => button.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
        }
        if (path === "/projects") {
          for (const button of await page.locator(".project-join-button").all()) {
            expect(await button.evaluate((element) => element.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${role} ${path} horizontal overflow`).toBe(true);
        const controls = await page.locator("#main-content").evaluate((main) => Array.from(main.querySelectorAll("button, input, select, textarea, a, summary")).filter((element) => element.getClientRects().length).map((element) => ({
          tag: element.tagName,
          text: element.getAttribute("aria-label") || element.getAttribute("aria-labelledby")?.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ") || element.getAttribute("title") || Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent?.trim()).join(" ") || element.textContent?.trim().slice(0, 100),
          type: element.getAttribute("type"), href: element.getAttribute("href"),
          disabled: element.hasAttribute("disabled"), width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height,
        })));
        inventory.push({ role, path, controls });
        await page.screenshot({ path: testInfo.outputPath(`${role}-${path.replaceAll("/", "_") || "home"}.png`), fullPage: true });
      }
    }
    await writeFile(testInfo.outputPath("rendered-controls.json"), JSON.stringify(inventory, null, 2));
    await testInfo.attach("rendered-controls", { path: testInfo.outputPath("rendered-controls.json"), contentType: "application/json" });
    expect(errors).toEqual([]);
  } finally { await employeeContext.close(); }
});
