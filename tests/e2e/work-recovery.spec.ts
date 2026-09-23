import { expect, test, type Page } from "@playwright/test";

async function workspace(page: Page, membershipId = "member") {
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/me"
      ? { user: { id: membershipId, membershipId, organizationId: "organization", displayName: "录入验收", timezone: "Asia/Shanghai", isOwner: false }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: membershipId }] }
      : path === "/api/auth/csrf" ? { csrfToken: "work-recovery-test-token" }
      : path === "/api/timer" ? { timer: null }
        : path === "/api/evidence/capabilities" ? { fileUploads: { available: true, maxFileBytes: 1000000 } }
          : { items: [], nextCursor: null, unreadCount: 0 };
    return route.fulfill({ json });
  });
}

test("unfinished work recovers text, evidence and partial dates on refresh while isolating accounts", async ({ page }) => {
  await workspace(page);
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel(/^工作内容/).fill("刷新后仍在的录入");
  await page.getByLabel("本段文字证据", { exact: true }).fill("会议纪要未丢失");
  await page.getByLabel("结束时间", { exact: true }).fill("");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toContain("刷新后仍在的录入");
  await page.reload();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("刷新后仍在的录入");
  await expect(page.getByLabel("本段文字证据", { exact: true })).toHaveValue("会议纪要未丢失");
  await expect(page.getByLabel("结束时间", { exact: true })).toHaveValue("");
  await expect(page.getByText("已恢复此标签页尚未保存的录入", { exact: false })).toBeVisible();
  await workspace(page, "second-member");
  await page.reload();
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("");
  expect(await page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toContain("刷新后仍在的录入");
});

test("time-first and incomplete break input recovers before any work description is written", async ({ page }) => {
  await workspace(page);
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel("开始时间", { exact: true }).fill("2026-09-22T09:15");
  await page.getByLabel("结束时间", { exact: true }).fill("");
  await page.getByRole("button", { name: /添加休息区间/ }).click();
  await page.getByLabel("第 1 段休息开始", { exact: true }).fill("2026-09-22T10:00");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toContain("2026-09-22T09:15");
  for (let index = 0; index < 2; index += 1) {
    await page.reload();
    await expect(page.getByLabel(/^工作内容/)).toHaveValue("");
    await expect(page.getByLabel("开始时间", { exact: true })).toHaveValue("2026-09-22T09:15");
    await expect(page.getByLabel("结束时间", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("第 1 段休息开始", { exact: true })).toHaveValue("2026-09-22T10:00");
    await expect(page.getByLabel("第 1 段休息结束", { exact: true })).toHaveValue("");
  }
});

for (const outcome of ["cancel", "save"] as const) test(`a new unsaved entry survives ${outcome} of an unrelated historical draft`, async ({ page }) => {
  await workspace(page);
  const record = { id: "historical", content: "历史草稿 B", startAt: "2026-09-22T01:00:00Z", endAt: "2026-09-22T02:00:00Z", timezone: "Asia/Shanghai", netSeconds: 3600, result: "", blockers: "", nextStep: "", visibility: "private", parallelWork: false, source: "manual", recordKind: "fact", submissionStatus: "draft", approvalStatus: "not_requested", version: 1, primaryProjectNodeId: null, projectLinks: [], breaks: [] };
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: { items: [record], nextCursor: null } }));
  let saved = false;
  await page.route("**/api/work-sessions/historical", (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ expectedVersion: 1, content: "历史草稿 B 的修改" });
    saved = true;
    return route.fulfill({ json: { session: { ...record, version: 2 } } });
  });
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel(/^工作内容/).fill("尚未保存的新录入 A");
  await page.getByLabel("本段文字证据", { exact: true }).fill("A 的独立证据");
  await page.getByRole("button", { name: "编辑草稿", exact: true }).click();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("历史草稿 B");
  await page.getByLabel(/^工作内容/).fill("历史草稿 B 的修改");
  if (outcome === "cancel") {
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "收起录入", exact: true }).click();
  } else {
    await page.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect.poll(() => saved).toBe(true);
  }
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("尚未保存的新录入 A");
  await expect(page.getByLabel("本段文字证据", { exact: true })).toHaveValue("A 的独立证据");
  await page.reload();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("尚未保存的新录入 A");
  await expect(page.getByLabel("本段文字证据", { exact: true })).toHaveValue("A 的独立证据");
});

test("clearing the final new-entry field flushes deletion even before the debounce expires", async ({ page }) => {
  await workspace(page);
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel(/^工作内容/).fill("本来要记录但已清空");
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toContain("本来要记录但已清空");
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByLabel(/^工作内容/).fill("");
  await page.reload();
  await page.clock.resume();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toBeNull();
});

test("missing attachment reminders survive repeated refreshes until explicitly removed", async ({ page }) => {
  await workspace(page);
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel(/^工作内容/).fill("附件仍需重新选择的录入");
  await page.locator(".work-direct-file input[type=file]").first().setInputFiles({ name: "未上传的验收记录.txt", mimeType: "text/plain", buffer: Buffer.from("尚未提交") });
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).toContain("未上传的验收记录.txt");
  for (let index = 0; index < 2; index += 1) {
    await page.reload();
    await expect(page.getByText("以下文件需要重新选择：未上传的验收记录.txt。", { exact: false })).toBeVisible();
  }
  await page.getByRole("button", { name: "移除待补附件提醒", exact: true }).click();
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("workbench:editor-recovery:v1:member"))).not.toContain("未上传的验收记录.txt");
  await page.reload();
  await expect(page.getByRole("button", { name: "移除待补附件提醒", exact: true })).toHaveCount(0);
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("附件仍需重新选择的录入");
});

test("work history can continue beyond the first page and retains loaded rows when a later page fails", async ({ page }) => {
  await workspace(page);
  const cursor = "2026-09-21T01:00:00.000Z|00000000-0000-4000-8000-000000000001";
  const record = (id: string, content: string) => ({ id, content, startAt: "2026-09-21T01:00:00Z", endAt: "2026-09-21T02:00:00Z", timezone: "Asia/Shanghai", netSeconds: 3600, result: "", blockers: "", nextStep: "", visibility: "private", parallelWork: false, source: "manual", recordKind: "fact", submissionStatus: "draft", approvalStatus: "not_requested", version: 1, primaryProjectNodeId: null, projectLinks: [], breaks: [] });
  let fail = true;
  await page.route("**/api/work-sessions?**", (route) => {
    const before = new URL(route.request().url()).searchParams.get("before");
    if (!before) return route.fulfill({ json: { items: [record("first", "第一页记录")], nextCursor: cursor } });
    expect(before).toBe(cursor);
    return fail ? route.fulfill({ status: 403, json: { message: "历史页读取失败，请重新加载" } })
      : route.fulfill({ json: { items: [record("older", "更早的工作记录")], nextCursor: null } });
  });
  await page.goto("/work");
  await page.getByRole("button", { name: "加载更早的记录", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "历史页读取失败" })).toBeVisible();
  await expect(page.getByText("第一页记录", { exact: true }).first()).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByText("更早的工作记录", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "加载更早的记录", exact: true })).toHaveCount(0);
});

test("approving overlapping work requires an explicit review note", async ({ page }) => {
  await workspace(page);
  await page.route("**/api/approvals?**", (route) => route.fulfill({ json: { items: [{
    request: { id: "review", priority: "high", anomalyFlags: ["overlapping_work_requires_review"] },
    session: { id: "work", content: "计时与手工记录重叠", result: "", startAt: "2026-09-21T01:00:00Z", endAt: "2026-09-21T02:00:00Z", netSeconds: 3600, version: 2 },
  }] } }));
  let posted: unknown;
  await page.route("**/api/approvals/review/decision", (route) => {
    posted = route.request().postDataJSON();
    return route.fulfill({ json: { success: true } });
  });
  await page.goto("/approvals");
  await expect(page.getByText("时段重叠，需核对", { exact: true })).toBeVisible();
  const approve = page.getByRole("button", { name: "批准", exact: true });
  await approve.click();
  await expect(approve).toBeDisabled();
  expect(posted).toBeUndefined();
  await page.getByLabel("重叠核对说明 / 退回原因", { exact: true }).fill("已核对为同一会议，重叠时间只计一次");
  await approve.click();
  await expect.poll(() => posted).toEqual({ decision: "approved", reason: "已核对为同一会议，重叠时间只计一次" });
});
