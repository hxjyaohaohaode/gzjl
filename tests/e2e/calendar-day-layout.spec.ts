import { expect, test, type Page } from "@playwright/test";

const longTitle = "相邻的一小时真实工作内容需要完整显示并且不能与下一条极短记录互相遮盖";
const record = (id: string, startAt: string, endAt: string, content: string, extra = {}) => ({
  id, startAt, endAt, content, result: `核对结果 ${id}`, netSeconds: Math.floor((Date.parse(endAt) - Date.parse(startAt)) / 1000),
  source: "manual", recordKind: "fact", submissionStatus: "draft", approvalStatus: "not_submitted", version: 1, ...extra,
});
const records = [
  record("adjacent", "2026-09-22T06:00:00Z", "2026-09-22T07:00:00Z", longTitle),
  record("short", "2026-09-22T07:00:00Z", "2026-09-22T07:00:01Z", "只有一秒的计时事实", { source: "timer" }),
  record("plan", "2026-09-22T08:00:00Z", "2026-09-22T09:00:00Z", "稍后的云端计划", { recordKind: "plan" }),
  record("overnight", "2026-09-21T15:30:00Z", "2026-09-21T16:30:00Z", "跨入当天的记录", { periodNetSeconds: 1800 }),
  record("midnight", "2026-09-22T15:59:59Z", "2026-09-22T16:00:00Z", "午夜前最后一秒"),
  ...Array.from({ length: 24 }, (_, index) => record(`overlap-${index}`, "2026-09-22T07:00:00Z", "2026-09-22T07:40:00Z", `并行核对记录 ${index + 1}`)),
];

async function workspace(page: Page, options: { timezone?: string; now?: string; items?: typeof records } = {}) {
  const timezone = options.timezone ?? "Asia/Shanghai";
  const items = options.items ?? records;
  await page.clock.setFixedTime(new Date(options.now ?? "2026-09-22T04:00:00Z"));
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === "/api/me" ? { user: { id: "member", membershipId: "member", organizationId: "org", displayName: "日历几何验收", timezone, isOwner: false }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "member" }] }
      : path === "/api/auth/csrf" ? { csrfToken: "calendar-layout-token" }
        : path === "/api/timer" ? { timer: null }
          : path === "/api/work-sessions" ? { items, nextCursor: null }
            : { items: [], nextCursor: null, unreadCount: 0 };
    return route.fulfill({ json });
  });
  await page.goto("/calendar");
  await page.getByRole("button", { name: "日", exact: true }).click();
  await expect(page.locator(".calendar-day-entry")).toHaveCount(items.length);
}

test("day records have independent readable rows even with short, adjacent and many overlapping entries", async ({ page }) => {
  await workspace(page);
  const entries = page.locator(".calendar-day-entry");
  await expect(entries.first()).toHaveAttribute("data-session-id", "overnight");
  await expect(entries.last()).toHaveAttribute("data-session-id", "midnight");
  await expect(page.locator('.calendar-day-entry[data-session-id="adjacent"] strong')).toHaveText(longTitle);
  const geometry = await entries.evaluateAll((items) => items.map((item) => {
    const box = item.getBoundingClientRect();
    const summary = item.querySelector("summary")!.getBoundingClientRect();
    const title = item.querySelector("strong")!;
    return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, hitHeight: summary.height, titleWidth: title.clientWidth, titleScrollWidth: title.scrollWidth };
  }));
  const viewportWidth = page.viewportSize()!.width;
  for (const [index, box] of geometry.entries()) {
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(viewportWidth);
    expect(box.hitHeight).toBeGreaterThanOrEqual(44);
    expect(box.titleScrollWidth).toBeLessThanOrEqual(box.titleWidth + 1);
    if (index) expect(box.top).toBeGreaterThanOrEqual(geometry[index - 1]!.bottom + 1);
  }
  await expect(page.locator(".calendar-day-explanation")).toContainText("卡片大小不代表工时");
});

test("short records remain keyboard and touch accessible while their range represents exactly one second", async ({ page, isMobile }) => {
  await workspace(page);
  const short = page.locator('.calendar-day-entry[data-session-id="short"]');
  const summary = short.locator("summary");
  await expect(short.locator(".calendar-day-entry-time")).toContainText("15:00:00 – 15:00:01");
  const range = await short.locator(".calendar-day-range").evaluate((element: HTMLElement) => ({ left: parseFloat(element.style.left), width: parseFloat(element.style.width) }));
  expect(range.left).toBeCloseTo(62.5, 6);
  // CSSOM serializes percentages with fewer significant digits than the model.
  expect(range.width).toBeCloseTo(1 / 864, 6);
  const pixels = await short.locator(".calendar-day-range").evaluate((element) => ({ width: element.getBoundingClientRect().width, trackWidth: element.parentElement!.getBoundingClientRect().width }));
  expect(pixels.width).toBeLessThanOrEqual(pixels.trackWidth / 86400 + 0.05);
  const hour = await page.locator('.calendar-day-entry[data-session-id="adjacent"] .calendar-day-range').evaluate((element) => ({ width: element.getBoundingClientRect().width, trackWidth: element.parentElement!.getBoundingClientRect().width }));
  expect(Math.abs(hour.width - hour.trackWidth / 24)).toBeLessThan(0.1);
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(short).toHaveAttribute("open", "");
  await expect(short.locator(".calendar-day-entry-details")).toContainText("整条净工时 1 秒");
  await expect(short.locator(".calendar-day-entry-details")).toContainText("核对结果 short");
  await summary.press("Space");
  await expect(short).not.toHaveAttribute("open", "");
  if (isMobile) await summary.tap();
  else await summary.click();
  await expect(short).toHaveAttribute("open", "");
  await expect(summary).toBeFocused();
});

test("overnight and midnight boundaries stay inside the same civil-day axis without creating an extra day", async ({ page }) => {
  await workspace(page);
  const overnight = page.locator('.calendar-day-entry[data-session-id="overnight"]');
  const midnight = page.locator('.calendar-day-entry[data-session-id="midnight"]');
  await expect(overnight.locator(".calendar-day-entry-time")).toContainText("00:00:00 – 00:30:00");
  await expect(midnight.locator(".calendar-day-entry-time")).toContainText("23:59:59 – 24:00:00");
  const bars = await page.locator(".calendar-day-range").evaluateAll((items) => items.map((item) => ({ left: parseFloat((item as HTMLElement).style.left), width: parseFloat((item as HTMLElement).style.width) })));
  expect(bars.every(({ left, width }) => left >= 0 && width > 0 && left + width <= 100.000001)).toBe(true);
  await midnight.locator("summary").click();
  await expect(midnight.locator(".calendar-day-entry-details")).toContainText("2026-09-23 00:00:00");
  await page.getByRole("button", { name: "下一周期", exact: true }).click();
  await expect(page.locator(".calendar-day-entry")).toHaveCount(0);
  await expect(page.getByText("当天没有记录", { exact: true })).toBeVisible();
});

for (const scenario of [
  { name: "fall-back", now: "2026-11-01T12:00:00Z", start: "2026-11-01T05:50:00Z", end: "2026-11-01T06:10:00Z", expected: "01:50:00 GMT-04:00 – 01:10:00 GMT-05:00" },
  { name: "spring-forward", now: "2026-03-08T16:00:00Z", start: "2026-03-08T06:50:00Z", end: "2026-03-08T07:10:00Z", expected: "01:50:00 GMT-05:00 – 03:10:00 GMT-04:00" },
]) test(`New York ${scenario.name} survives every calendar view in a Shanghai browser`, async ({ page }) => {
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe("Asia/Shanghai");
  await workspace(page, { timezone: "America/New_York", now: scenario.now, items: [record("shift", scenario.start, scenario.end, "时钟调整期间仍然存在的事实")] });
  const entry = page.locator('.calendar-day-entry[data-session-id="shift"]');
  await expect(entry.locator(".calendar-day-entry-time")).toContainText(scenario.expected);
  await expect(entry.locator(".calendar-day-clock-shift")).toContainText("实际经过 20 分钟");
  await expect(entry.locator(".calendar-day-range")).toHaveCount(0);
  await expect(entry.locator(".calendar-day-start-marker")).toHaveCount(1);
  await expect(entry.locator(".calendar-day-end-marker")).toHaveCount(1);
  await entry.locator("summary").click();
  await expect(entry.locator(".calendar-day-entry-details")).toContainText("整条净工时 20 分钟");
  for (const view of ["周", "月"] as const) {
    await page.getByRole("button", { name: view, exact: true }).click();
    await expect(page.locator(".calendar-event").filter({ hasText: "时钟调整期间仍然存在的事实" })).toHaveCount(1);
    await expect(page.locator(".calendar-event").filter({ hasText: "时钟调整期间仍然存在的事实" })).toContainText("时钟调整");
  }
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".calendar-list-view")).toContainText("时钟调整期间仍然存在的事实");
});

test("Santiago's skipped midnight loads its real day boundary and subsecond records remain visible", async ({ page }) => {
  const queries: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname === "/api/work-sessions") queries.push(request.url()); });
  await workspace(page, { timezone: "America/Santiago", now: "2026-09-06T12:00:00Z", items: [
    record("midnight-gap", "2026-09-06T03:50:00Z", "2026-09-06T04:10:00Z", "跳过午夜后仍可查看", { periodNetSeconds: 600 }),
    record("subsecond", "2026-09-06T04:15:00.100Z", "2026-09-06T04:15:00.300Z", "不足一秒仍保留"),
  ] });
  expect(queries.some((value) => { const params = new URL(value).searchParams; return params.get("from") === "2026-09-06T04:00:00.000Z" && params.get("to") === "2026-09-07T03:00:00.000Z"; })).toBe(true);
  await expect(page.locator('.calendar-day-entry[data-session-id="midnight-gap"] .calendar-day-entry-time')).toContainText("01:00:00 – 01:10:00");
  const short = page.locator('.calendar-day-entry[data-session-id="subsecond"]');
  await expect(short.locator(".calendar-day-entry-time")).toContainText("01:15:00.100 – 01:15:00.300");
  await short.locator("summary").click();
  await expect(short.locator(".calendar-day-entry-details")).toContainText("实际经过 不足 1 秒");
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.locator(".calendar-event").filter({ hasText: "不足一秒仍保留" })).toHaveCount(1);
});

test.describe("device-clock independence", () => {
  test.use({ timezoneId: "America/New_York" });
  test("Shanghai's real 02:30 is not normalized into the browser's spring-forward gap", async ({ page }) => {
    await workspace(page, { now: "2026-03-08T04:00:00Z", items: [record("device-gap", "2026-03-07T18:30:00Z", "2026-03-07T18:45:00Z", "组织时区的凌晨记录")] });
    const entry = page.locator('.calendar-day-entry[data-session-id="device-gap"]');
    await expect(entry.locator(".calendar-day-entry-time")).toContainText("02:30:00 – 02:45:00");
    await expect(entry.locator(".calendar-day-clock-shift")).toHaveCount(0);
    const width = await entry.locator(".calendar-day-range").evaluate((element: HTMLElement) => parseFloat(element.style.width));
    expect(width).toBeCloseTo(15 / 1440 * 100, 5);
  });
});
