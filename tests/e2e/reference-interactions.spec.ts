import { expect, test, type Page } from "@playwright/test";
import { wizardStep } from "./workspace-flows.js";

const memberId = "00000000-0000-4000-8000-000000000002";
const roleId = "00000000-0000-4000-8000-000000000004";
const record = (index: number) => ({ id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, content: `界面对比工作 ${index}`, result: `已完成第 ${index} 项核对`, startAt: "2026-10-12T09:00:00+08:00", endAt: "2026-10-12T10:00:00+08:00", netSeconds: 3600, timezone: "Asia/Shanghai", source: "manual", recordKind: "fact", submissionStatus: "draft", approvalStatus: "not_requested", version: 1, visibility: "management_only", blockers: "", nextStep: "", breaks: [], projectLinks: [], primaryProjectNodeId: null, parallelWork: false });
const records = Array.from({ length: 13 }, (_, index) => record(index));
const reportId = "00000000-0000-4000-8000-000000000111";
const report = { id: reportId, title: "可追溯的界面对比报告", summary: "这份报告用于界面验收，不调用模型。", sourceCount: 0, generatedAt: "2026-10-12T10:00:00+08:00", structuredOutput: { highlights: ["核对卡片与弹窗"], risks: ["需要检查长文本"], suggestions: ["逐项追溯事实"] } };

async function workspace(page: Page) {
  await page.clock.install({ time: new Date("2026-10-12T12:00:00+08:00") });
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()), path = url.pathname;
    const json = path === "/api/me" ? { user: { id: "user", membershipId: memberId, organizationId: "org", displayName: "交互验收", timezone: "Asia/Shanghai", isOwner: true }, permissions: ["work.view_own", "members.manage", "work.review", "payroll.view_own", "analytics.view_team"].map((permission) => ({ permission, scopeKind: "organization", scopeId: null })) }
      : path === "/api/auth/csrf" ? { csrfToken: "interaction-test-token" }
      : path === "/api/timer" ? { timer: null }
      : path === "/api/work-sessions" ? { items: [...records, { ...record(30), recordKind: "plan", content: "未来计划不计热力" }], nextCursor: null }
      : path === "/api/analytics/summary" ? { totals: { totalSeconds: 46800 }, byDay: [{ date: "2026-10-12", seconds: 46800 }] }
      : path === "/api/work-lifecycle/me" ? { period: { id: null, name: "本月", startsAt: "2026-10-01T00:00:00+08:00", endsAt: "2026-11-01T00:00:00+08:00", cutoffAt: null, timezone: "Asia/Shanghai" }, counts: {}, plans: [], activePlan: null, attention: [] }
      : path === "/api/evidence/capabilities" ? { fileUploads: { available: false }, references: { text: true, url: true } }
      : path === "/api/organization/invitation-delivery-capabilities" ? { manual: { available: true }, email: { available: false }, phone: { available: false } }
      : path === "/api/ai/reports" ? { items: [{ job: { id: reportId, taskType: "weekly_summary", status: "succeeded", scope: {}, queuedAt: report.generatedAt }, report }] }
      : path === `/api/ai/reports/${reportId}` ? { report, sources: [], stale: false, inputTruncated: false }
      : { items: [], nextCursor: null, unreadCount: 0 };
    await route.fulfill({ json });
  });
}

test("heatmap supports keyboard focus, fixed readouts and full day drilldown without including plans", async ({ page }) => {
  await workspace(page); await page.goto("/");
  const pulseReadout = page.locator(".fx-pulse-chart figcaption button");
  await expect(pulseReadout).toBeVisible();
  expect((await pulseReadout.boundingBox())!.height).toBeLessThanOrEqual(44);
  expect((await pulseReadout.locator("svg").boundingBox())!.height).toBeLessThanOrEqual(20);
  const grid = page.getByRole("grid", { name: "日期与小时工作热力" });
  const heatSurface = page.locator(".fx-heat-surface"), originalSize = await heatSurface.boundingBox();
  const cell = grid.getByRole("gridcell", { name: /2026-10-12 09:00，13 条/ });
  await cell.click(); await expect(cell).toHaveAttribute("aria-selected", "true");
  await cell.press("ArrowRight");
  await expect(grid.getByRole("gridcell", { name: /2026-10-12 10:00，0 条/ })).toBeFocused();
  // Leaving the grid with the pointer must not erase its keyboard selection.
  await page.mouse.move(0, 0);
  await grid.getByRole("gridcell", { name: /2026-10-12 10:00，0 条/ }).press("Escape");
  await expect(heatSurface.locator(".fx-heat-detail .fx-chart-empty")).toBeVisible();
  const emptySize = await heatSurface.boundingBox();
  expect(Math.abs(originalSize!.height - emptySize!.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(originalSize!.width - emptySize!.width)).toBeLessThanOrEqual(1);
  // Real pointer movement resumes hover preview after keyboard navigation.
  await cell.hover();
  await expect(heatSurface.locator(".fx-heat-records li")).toHaveCount(3);
  await page.getByRole("button", { name: "查看全天", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "2026-10-12 · 全天工作记录" });
  await expect(dialog.locator(".fx-day-record")).toHaveCount(13);
  await expect(dialog).not.toContainText("未来计划不计热力");
  await dialog.getByRole("button", { name: /界面对比工作 0/ }).click();
  await expect(page).toHaveURL(new RegExp(`record=${records[0]!.id}`));
});

test("work cards page and filter the collection while details expand only on demand", async ({ page }) => {
  await workspace(page); await page.goto("/work");
  await expect(page.locator(".work-record-entry")).toHaveCount(8);
  await expect(page.locator(".work-record-entry .fx-disclosure-detail")).toHaveCount(0);
  await page.getByRole("navigation", { name: "工作记录分页" }).getByRole("button", { name: "下一页" }).click();
  await expect(page.locator(".work-record-entry")).toHaveCount(6);
  await page.getByRole("searchbox", { name: "搜索工作记录" }).fill("界面对比工作 12");
  await expect(page.locator(".work-record-entry")).toHaveCount(1);
  await page.locator(".work-record-entry > .fx-disclosure-head").click();
  await expect(page.locator(".work-record-entry .fx-disclosure-detail")).toHaveAttribute("aria-hidden", "false");
  await expect(page.getByText("已完成第 12 项核对", { exact: true })).toBeVisible();
  await page.locator(".work-record-entry > .fx-disclosure-head").click();
  await expect(page.locator(".work-record-entry .fx-disclosure-detail")).toHaveAttribute("inert", "");
  await expect(page.locator(".work-record-entry .fx-disclosure-detail")).toHaveCount(0);
});

test("work wizard validates time first, retains long input and traps focus inside the viewport", async ({ page }) => {
  await workspace(page); await page.goto("/work");
  const opener = page.getByRole("button", { name: "手工录入", exact: true }); await opener.click();
  const dialog = page.getByRole("dialog", { name: "补录一段真实工作" });
  await dialog.getByLabel("结束时间", { exact: true }).fill("");
  await dialog.getByRole("button", { name: "下一步", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("结束须晚于开始");
  await dialog.getByLabel("开始时间", { exact: true }).fill("2026-10-12T07:00");
  await dialog.getByLabel("结束时间", { exact: true }).fill("2026-10-12T08:00");
  await wizardStep(page, 1);
  const text = "完整描述工作内容与结果，检查长文字换行和保留。".repeat(100);
  await dialog.getByLabel("工作内容", { exact: true }).fill(text);
  await dialog.getByLabel("工作结果", { exact: true }).fill(text);
  await wizardStep(page, 2); await dialog.getByLabel("本段文字证据", { exact: true }).fill("可核对的文字证据");
  await wizardStep(page, 4); await expect(dialog.locator(".fx-work-review")).toContainText(text);
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await dialog.getByRole("button", { name: "关闭补录一段真实工作" }).press("Shift+Tab");
  expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await expect(page.getByLabel("工作内容", { exact: true })).toHaveValue(text);
  await expect(page.locator(".work-editor-preview")).toHaveCount(0);
});

test("permission panorama queries current assignments and excludes expired or inactive candidates", async ({ page }) => {
  await workspace(page);
  const members = ["有效审核人", "过期审核人", "已停用审核人"].map((name,index) => ({ membership: { id: `member-${index}`, status: index === 2 ? "inactive" : "active", version: 1 }, user: { displayName: name }, positionTitle: "研发工程师", unitName: "研发组", isOwner: false, professionalIdentities: [], accessRoles: [{ roleId, roleName: "工时审核", scopeKind: "organization", scopeId: null, expiresAt: index === 1 ? "2020-01-01T00:00:00Z" : null }] }));
  await page.route("**/api/organization", (route) => route.fulfill({ json: { organization: { id: "org", name: "测试组织" }, units: [], roles: [{ id: roleId, name: "工时审核", kind: "manager", description: "审核工时" }], members, professionalIdentities: [] } }));
  await page.route("**/api/organization/permission-overview", (route) => route.fulfill({ json: { organizationId: "org", bindings: [{ roleId, permission: "work.review", description: "work.review" }] } }));
  await page.goto("/organization"); await expect(page.locator(".fx-member-card")).toHaveCount(3);
  await page.getByRole("tab", { name: "权限全景", exact: true }).click();
  await page.getByRole("button", { name: "谁能审核工时？", exact: true }).click();
  const answer = page.getByRole("region", { name: "真实权限查询" });
  await expect(answer).toContainText("有效审核人"); await expect(answer).not.toContainText("过期审核人"); await expect(answer).not.toContainText("已停用审核人");
  await page.getByRole("searchbox", { name: "权限全景查询" }).fill("审核工时");
  await expect(page.locator(".fx-orbit-node")).toHaveCount(1);
  await page.locator(".fx-orbit-node").press("Escape");
  await expect(page.getByRole("searchbox", { name: "权限全景查询" })).toHaveValue("");
});

test("AI shortcuts send directly, stay available while typing and report routes preserve the cited identity", async ({ page }) => {
  await workspace(page); let submitted: Record<string,unknown> | null = null;
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    submitted = route.request().postDataJSON(); await route.fulfill({ status: 202, json: { job: { id: "job" } } });
  });
  await page.goto("/ai"); const input = page.getByRole("textbox", { name: "向 AI 提问" });
  const shortcut = page.getByRole("button", { name: "总结今日", exact: true });
  await expect(shortcut).toBeVisible();
  const composerHeight = await input.evaluate((element) => element.closest("form")!.clientHeight);
  await input.fill("先整理一段新问题"); await expect(shortcut).toBeVisible();
  expect(await input.evaluate((element) => element.closest("form")!.clientHeight)).toBe(composerHeight);
  await input.fill(""); await page.getByRole("button", { name: "总结今日", exact: true }).click();
  await expect.poll(() => submitted).toMatchObject({ taskType: "assistant_chat", scope: "self", question: expect.stringContaining("总结今日") });
  await page.getByRole("navigation", { name: "AI 工作区导航" }).getByRole("link", { name: "报告历史" }).click();
  await expect(page.getByRole("heading", { name: report.title })).toBeVisible();
  await page.goto("/ai/reports/00000000-0000-4000-8000-000000000999");
  await expect(page.getByRole("heading", { name: "当前报告不可用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: report.title })).toHaveCount(0);
});

test("adaptive topbar hides downwards and returns on upward scrolling or idle", async ({ page }) => {
  await workspace(page); await page.goto("/work");
  await page.locator(".work-record-entry > .fx-disclosure-head").first().click();
  await expect(page.locator(".work-record-entry .fx-disclosure-detail").first()).toHaveAttribute("aria-hidden", "false");
  const bar = page.locator(".app-topbar");
  await page.mouse.wheel(0,600); await expect(bar).toHaveClass(/is-auto-hidden/);
  await page.mouse.wheel(0,-150); await expect(bar).not.toHaveClass(/is-auto-hidden/);
  await page.mouse.wheel(0,300); await expect(bar).toHaveClass(/is-auto-hidden/);
  await expect(bar).not.toHaveClass(/is-auto-hidden/, { timeout: 3500 });
});

test("AI navigation retains its frame and draft while only the panel changes and errors stay beside the action", async ({ page }) => {
  await workspace(page);
  await page.route("**/api/ai/reports", (route) => route.request().method() === "POST" ? route.fulfill({ status: 400, json: { message: "请先配置并启用组织 AI 模型" } }) : route.fallback());
  await page.goto("/ai?conversation=retained_topic");
  const title = await page.getByRole("heading", { name: "AI 工作洞察", exact: true }).elementHandle();
  const nav = page.getByRole("navigation", { name: "AI 工作区导航" }), navigation = await nav.elementHandle();
  const frame = await page.locator(".fx-page-content").elementHandle();
  await page.getByLabel("向 AI 提问", { exact: true }).fill("切换页面仍需保留的完整提问");
  await nav.getByRole("link", { name: "报告历史" }).click();
  await expect(page).toHaveURL(/conversation=retained_topic/);
  await expect(page.getByRole("heading", { name: report.title })).toBeVisible();
  expect(await title!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await navigation!.evaluate((element) => element.isConnected)).toBe(true);
  expect(await frame!.evaluate((element) => element.isConnected && !element.hasAttribute("inert"))).toBe(true);
  await nav.getByRole("link", { name: "新建分析" }).click();
  await page.getByRole("button", { name: "月度回顾", exact: true }).click();
  await expect(page.locator(".fx-ai-selection")).toContainText("月度回顾");
  await page.getByRole("button", { name: "生成所选洞察" }).click();
  await expect(page.locator(".ai-compose-card").getByRole("alert")).toContainText("请先配置并启用");
  await nav.getByRole("link", { name: "对话", exact: true }).click();
  await expect(page.getByLabel("向 AI 提问", { exact: true })).toHaveValue("切换页面仍需保留的完整提问");
  await nav.getByRole("link", { name: "新建分析" }).click();
  await expect(page.getByRole("button", { name: "月度回顾", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("notification filters use organization-day boundaries and long messages never widen the panel", async ({ page }) => {
  await workspace(page);
  const notifications = [{ id: "new", title: "新的工作提醒", body: "今天需要核对工作", createdAt: "2026-10-12T01:00:00Z" }, { id: "older", title: "审批需要补充材料", body: `审批正文 ${"https://example.test/long".repeat(40)}`, createdAt: "2026-10-03T01:00:00Z" }].map((item) => ({ ...item, severity: "warning", actionUrl: null, readAt: null }));
  let search: URLSearchParams | undefined;
  await page.route("**/api/notifications**", (route) => {
    const params = new URL(route.request().url()).searchParams; search = params;
    return route.fulfill({ json: { items: notifications.filter((item) => (!params.get("q") || `${item.title} ${item.body}`.includes(params.get("q")!)) && (!params.get("from") || item.createdAt >= params.get("from")!) && (!params.get("to") || item.createdAt < params.get("to")!)) } });
  });
  await page.goto("/ai"); await page.getByRole("button", { name: /通知，2 条未读/ }).click();
  const panel = page.locator(".fx-notification-center");
  await panel.getByLabel("搜索通知内容").fill("审批");
  await panel.getByLabel("通知开始日期").fill("2026-10-01");
  await panel.getByLabel("通知结束日期").fill("2026-10-05");
  await expect.poll(() => search?.get("from")).toBe("2026-09-30T16:00:00.000Z");
  await expect.poll(() => search?.get("to")).toBe("2026-10-05T16:00:00.000Z");
  await expect(panel.locator(".fx-notification-item")).toHaveCount(1);
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await panel.locator(".fx-notification-detail summary").click();
  await expect(panel.locator(".fx-notification-detail p")).toHaveText(notifications[1]!.body);
  expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("team filters update the collection without replacing its frame and swimlane readouts show actual work", async ({ page }, testInfo) => {
  await workspace(page);
  const teamRecords = records.map((item,index) => ({ ...item, membershipId: memberId, displayName: "可见协作者", activityAt: item.endAt, hasFullTiming: true, projectName: index % 2 ? "接口项目" : "视觉项目" }));
  const members = [{ membershipId: memberId, displayName: "可见协作者", avatarUrl: null, positionTitle: "开发", professionalIdentities: [], projectNames: ["接口项目", "视觉项目"], lastActivity: teamRecords[0] }];
  let params: URLSearchParams | undefined;
  await page.route("**/api/team-activity**", (route) => { params = new URL(route.request().url()).searchParams; return route.fulfill({ json: { scope: "organization", members, items: teamRecords.filter((item) => (!params?.get("project") || item.projectName === params.get("project")) && (!params?.get("q") || item.content.includes(params.get("q")!))) } }); });
  await page.goto("/team"); await expect(page.locator(".team-activity-item")).toHaveCount(8);
  for (const label of ["团队动态开始日期", "团队动态结束日期"]) {
    const fieldHeight = await page.getByLabel(label).evaluate((element) => element.getBoundingClientRect().height);
    expect(fieldHeight).toBeGreaterThanOrEqual(38);
    expect(fieldHeight).toBeLessThanOrEqual(56);
  }
  await page.screenshot({ path: testInfo.outputPath("team-filter-layout.png") });
  const feedDimensions = await page.locator(".team-activity-feed").evaluate((element) => ({ feed: element.getBoundingClientRect().width, container: element.parentElement!.getBoundingClientRect().width, list: element.querySelector(".fx-team-feed-list")!.getBoundingClientRect().width }));
  expect(Math.abs(feedDimensions.feed - feedDimensions.container)).toBeLessThanOrEqual(1);
  expect(Math.abs(feedDimensions.feed - feedDimensions.list)).toBeLessThanOrEqual(1);
  const frame = await page.locator(".fx-page-content").elementHandle();
  await page.getByLabel("筛选动态项目").selectOption("接口项目");
  await page.getByLabel("团队动态开始日期").fill("2026-10-12");
  await expect.poll(() => params?.get("from")).toBe("2026-10-11T16:00:00.000Z");
  await expect(page.locator(".team-activity-item")).toHaveCount(6);
  expect(await frame!.evaluate((element) => element.isConnected)).toBe(true);
  const block = page.locator(".fx-swim-block").first(); await block.focus();
  await expect(page.getByRole("tooltip")).toContainText("已完成第");
  const ticks = await page.locator(".fx-swim-ruler > div > span").allTextContents();
  expect(ticks.every((tick) => /^\d{2}:00$/.test(tick))).toBe(true);
  await block.click(); await expect(page.getByRole("dialog", { name: "可见协作者 · 工作动态" })).toContainText("已完成第");
});

test("member inspector uses compact retained sections rather than one long form", async ({ page }) => {
  await workspace(page);
  await page.route("**/api/organization", (route) => route.fulfill({ json: { organization: { id: "org", name: "测试组织" }, units: [], roles: [], professionalIdentities: [{ id: "identity", name: "产品设计", description: "设计协作标签" }], members: [{ membership: { id: memberId, status: "active", version: 1, orgUnitId: null, joinedAt: null }, user: { displayName: "分区验证成员", avatarUrl: null }, positionTitle: "设计", unitName: null, isOwner: false, professionalIdentities: [], accessRoles: [] }] } }));
  await page.goto("/organization"); await page.locator(".fx-member-card").click();
  const dialog = page.getByRole("dialog", { name: "分区验证成员 · 人员详情与编辑" });
  await dialog.getByLabel("岗位名称").fill("保留未保存的岗位内容");
  const tabs = dialog.getByRole("tablist", { name: "人员详情分区" });
  await tabs.getByRole("tab", { name: "专业身份", exact: true }).click();
  await expect(dialog.getByLabel("岗位名称")).not.toBeVisible();
  await dialog.getByLabel("产品设计").check();
  await tabs.getByRole("tab", { name: "访问权限", exact: true }).click();
  await tabs.getByRole("tab", { name: "岗位归属", exact: true }).click();
  await expect(dialog.getByLabel("岗位名称")).toHaveValue("保留未保存的岗位内容");
  await tabs.getByRole("tab", { name: "专业身份", exact: true }).click();
  await expect(dialog.getByLabel("产品设计")).toBeChecked();
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});

test("pulse floating readout follows keyboard selection and closes without obscuring the page", async ({ page }) => {
  await workspace(page); await page.goto("/");
  const figure = page.locator(".fx-pulse-chart");
  await figure.press("End"); await expect(page.getByRole("tooltip")).toContainText("2026-10-12");
  const tip = page.getByRole("tooltip"), box = await tip.boundingBox();
  expect(box!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16); expect(box!.x).toBeGreaterThanOrEqual(0);
  await figure.press("Escape"); await expect(tip).toHaveCount(0);
  await expect(page.locator(".fx-pulse-cursor")).toHaveCount(0);
});

test("structure canvas selects the hierarchy with keys and pulses the actual ancestor path", async ({ page }) => {
  await workspace(page);
  const projectId = "00000000-0000-4000-8000-000000000201", branchId = "00000000-0000-4000-8000-000000000202", rootId = "00000000-0000-4000-8000-000000000203", childId = "00000000-0000-4000-8000-000000000204";
  const nodes = [{ id: rootId, parentId: null, title: "画布上级" }, { id: childId, parentId: rootId, title: "画布子节点" }].map((node,index) => ({ ...node, projectId, branchId, type: "task", status: "in_progress", progress: "20", progressMode: "manual", weight: "1", version: 1, sortOrder: index, description: "", startAt: null, dueAt: null }));
  await page.route(`**/api/projects/${projectId}/tree`, (route) => route.fulfill({ json: { project: { id: projectId, key: "CANVAS", name: "画布验收项目" }, branches: [{ id: branchId, name: "主线", isDefault: true }], nodes, nodeAssignees: [], edges: [{ id: "delivery", sourceNodeId: childId, targetNodeId: rootId, type: "depends_on", label: "交付依据" }] } }));
  await page.goto(`/projects/${projectId}`);
  const root = page.locator(`.react-flow__node[data-id="${rootId}"]`);
  await expect(root).toBeVisible(); const position = await root.getAttribute("style");
  await root.focus(); await root.press("ArrowDown");
  await expect(page.locator(`.react-flow__node[data-id="${childId}"] .project-flow-node`)).toHaveClass(/is-selected/);
  await expect(page.locator(".project-hierarchy-active")).toHaveCount(1);
  await expect(page.locator(".project-path-pulse")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "聚焦节点", exact: true })).toBeEnabled();
  await page.getByRole("complementary", { name: "画布子节点 节点详情" }).getByRole("button", { name: "关闭", exact: true }).click();
  // The phone viewport virtualizes the parent after centering its child. Reveal
  // the complete tree before comparing node positions, independently of panning.
  await page.getByRole("button", { name: "查看全貌", exact: true }).click();
  await expect(root).toBeVisible();
  expect(await root.getAttribute("style")).toBe(position);
});

test("project canvas opens at a readable scale and retains every node in its overview and orientation controls", async ({ page }) => {
  await workspace(page);
  const projectId = "00000000-0000-4000-8000-000000000401", branchId = "00000000-0000-4000-8000-000000000402", rootId = "00000000-0000-4000-8000-000000000403";
  const nodes = [{ id: rootId, parentId: null, title: "项目交付主线" }, ...Array.from({ length: 7 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 410).padStart(12, "0")}`, parentId: rootId, title: `第 ${index + 1} 个需要完整阅读的项目节点` }))]
    .map((item, index) => ({ ...item, projectId, branchId, type: "task", status: "in_progress", progress: "45", progressMode: "manual", weight: "1", version: 1, sortOrder: index, description: "", startAt: null, dueAt: null }));
  await page.route(`**/api/projects/${projectId}/tree`, (route) => route.fulfill({ json: { project: { id: projectId, key: "READ", name: "可读画布验收项目" }, branches: [{ id: branchId, name: "主线", isDefault: true }], nodes, nodeAssignees: [], edges: nodes.slice(1).map((item, index) => ({ id: `delivery-${index}`, sourceNodeId: item.id, targetNodeId: rootId, type: "depends_on", label: "前置交付" })) } }));
  await page.goto(`/projects/${projectId}`);
  const canvas = page.locator(".project-canvas"), root = page.locator(`.react-flow__node[data-id="${rootId}"]`);
  await expect(root).toBeVisible();
  await expect(page.getByLabel("当前缩放比例")).toHaveText("100%");
  const dimensions = await root.evaluate((element) => ({ width: element.clientWidth, height: element.clientHeight, cardWidth: element.querySelector(".project-flow-node")!.clientWidth, font: Number.parseFloat(getComputedStyle(element.querySelector(".project-flow-node-title")!).fontSize) }));
  expect(dimensions.width).toBe(272); expect(dimensions.height).toBe(200);
  expect(Math.abs(dimensions.width - dimensions.cardWidth)).toBeLessThanOrEqual(2); expect(dimensions.font).toBeGreaterThanOrEqual(14);
  await page.getByRole("button", { name: "查看全貌", exact: true }).click();
  await expect.poll(async () => Number.parseInt(await page.getByLabel("当前缩放比例").innerText(), 10)).toBeLessThan(100);
  await expect(page.locator(".project-flow-node")).toHaveCount(nodes.length);
  await expect(page.locator(".project-edge-label")).toHaveCount(0);
  await page.getByRole("button", { name: /节点关联/ }).click();
  await expect(page.locator(".project-edge-label")).toHaveCount(7);
  await expect(page.locator(".project-edge-label").first()).toContainText("依赖 · 前置交付");
  await page.getByRole("button", { name: "可读视图", exact: true }).click();
  await expect(page.getByLabel("当前缩放比例")).toHaveText("100%");
  const alternate = page.viewportSize()!.width <= 640 ? "横向" : "纵向";
  await page.getByRole("group", { name: "画布排布方向" }).getByRole("button", { name: alternate, exact: true }).click();
  await expect(canvas).toHaveAttribute("data-direction", alternate === "横向" ? "horizontal" : "vertical");
  await expect(root).toBeVisible();
  expect(await canvas.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await root.locator(".project-node-collapse").click();
  await expect(page.locator(".project-flow-node")).toHaveCount(1);
  await expect(root.locator(".project-node-collapse")).toHaveAttribute("aria-expanded", "false");
  await root.locator(".project-node-collapse").click();
  await expect(root.locator(".project-node-collapse")).toHaveAttribute("aria-expanded", "true");
});

test("creating an analysis refreshes its accepted job before opening the report panel", async ({ page }) => {
  await workspace(page); let created = false;
  const id = "00000000-0000-4000-8000-000000000301";
  await page.route("**/api/ai/reports", (route) => {
    if (route.request().method() === "POST") { created = true; return route.fulfill({ status: 202, json: { job: { id } } }); }
    return route.fulfill({ json: { items: created ? [{ job: { id, taskType: "weekly_summary", status: "queued", scope: {}, queuedAt: "2026-10-12T12:00:00+08:00" }, report: null }] : [] } });
  });
  await page.goto("/ai/compose"); await page.getByRole("button", { name: "生成所选洞察" }).click();
  await expect(page).toHaveURL(new RegExp(`/ai/reports/${id}`));
  await expect(page.getByRole("heading", { name: "报告任务", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "当前报告不可用" })).toHaveCount(0);
});
