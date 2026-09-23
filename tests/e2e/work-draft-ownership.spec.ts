import { expect, test, type Page } from "@playwright/test";

const recoveryKey = "workbench:editor-recovery:v1:member";
const prefillKey = "workbench:manual-work-prefill:v2:member";

async function delayedWorkspace(page: Page, failEvidence = false) {
  let release!: () => void;
  let posted = false;
  let completed = false;
  let savedSession: Record<string, unknown> | null = null;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  await page.routeWebSocket("**/api/realtime", (socket) => socket.send(JSON.stringify({ type: "realtime.ready" })));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/api/work-sessions" && request.method() === "POST") {
      expect(request.headers()["x-csrf-token"]).toBe("draft-ownership-token");
      const input = request.postDataJSON();
      posted = true;
      await pending;
      savedSession = { ...input, id: "saved-a", version: 1, netSeconds: 3600, source: "manual", recordKind: "fact", submissionStatus: "draft", approvalStatus: "not_requested", projectLinks: [], breaks: [], primaryProjectNodeId: null };
      await route.fulfill({ json: { session: savedSession } });
      return;
    }
    if (path === "/api/work-sessions/saved-a/attachments/reference") {
      completed = true;
      await route.fulfill(failEvidence ? { status: 400, json: { message: "A 的附件保存失败" } } : { json: { attachment: { id: "evidence-a" } } });
      return;
    }
    const json = path === "/api/me"
      ? { user: { id: "member", membershipId: "member", organizationId: "organization", displayName: "草稿归属验收", timezone: "Asia/Shanghai", isOwner: false }, permissions: [{ permission: "work.view_own", scopeKind: "self", scopeId: "member" }] }
      : path === "/api/auth/csrf" ? { csrfToken: "draft-ownership-token" }
        : path === "/api/timer" ? { timer: null }
          : path === "/api/evidence/capabilities" ? { fileUploads: { available: true, maxFileBytes: 1000000 } }
            : path === "/api/work-sessions" ? { items: savedSession ? [savedSession] : [], nextCursor: null }
              : { items: [], nextCursor: null, unreadCount: 0 };
    await route.fulfill({ json });
  });
  // Link navigation creates a real SPA history entry. Back/Forward must unmount
  // WorkPage without destroying the pending request as page.goto/reload would.
  await page.goto("/calendar");
  if ((page.viewportSize()?.width ?? 1280) < 1024) {
    await page.getByRole("navigation", { name: "移动端主导航", exact: true }).getByRole("link", { name: "记录", exact: true }).click();
  } else {
    await page.getByRole("link", { name: "工作记录", exact: true }).click();
  }
  await page.getByRole("button", { name: "手工录入", exact: true }).click();
  await page.getByLabel(/^工作内容/).fill("缓慢提交的 A");
  await page.getByLabel("本段文字证据", { exact: true }).fill("A 的文字证据");
  await page.getByRole("button", { name: "本机保存预填写", exact: true }).click();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toContain("缓慢提交的 A");
  await page.getByRole("button", { name: "保存真实工时草稿", exact: true }).click();
  await expect.poll(() => posted).toBe(true);
  return { release, completed: () => completed };
}

test("a late save cannot clear a newer editor's automatic recovery or explicit local prefill", async ({ page }) => {
  const submission = await delayedWorkspace(page, true);
  await page.goBack();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goForward();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("缓慢提交的 A");
  await page.getByLabel(/^工作内容/).fill("后来编辑的 C 必须保留");
  await page.getByLabel("本段文字证据", { exact: true }).fill("C 的独立证据");
  await page.getByRole("button", { name: "本机保存预填写", exact: true }).click();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toContain("后来编辑的 C 必须保留");
  submission.release();
  await expect.poll(submission.completed).toBe(true);
  await expect(page.locator(".work-list-card").getByText("缓慢提交的 A", { exact: true })).toBeVisible();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("后来编辑的 C 必须保留");
  expect(await page.evaluate((key) => localStorage.getItem(key), prefillKey)).toContain("后来编辑的 C 必须保留");
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toContain("后来编辑的 C 必须保留");
  await expect(page.getByText("A 的附件保存失败", { exact: false })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("后来编辑的 C 必须保留");
  await expect(page.getByLabel("本段文字证据", { exact: true })).toHaveValue("C 的独立证据");
});

test("a save completed while away retires only its submitted backup before returning", async ({ page }) => {
  const submission = await delayedWorkspace(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/calendar$/);
  submission.release();
  await expect.poll(submission.completed).toBe(true);
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  await page.goForward();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  await expect(page.locator(".work-list-card").getByText("缓慢提交的 A", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
});

test("a reopened unchanged draft is retired on late success and cannot be restored again", async ({ page }) => {
  const submission = await delayedWorkspace(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/calendar$/);
  await page.goForward();
  await expect(page.getByLabel(/^工作内容/)).toHaveValue("缓慢提交的 A");
  submission.release();
  await expect.poll(submission.completed).toBe(true);
  await expect(page.getByText("此前提交的录入已保存，请在工作记录中核对。", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
});

test("an ordinary successful save clears automatic recovery while retaining explicit local prefill", async ({ page }) => {
  const submission = await delayedWorkspace(page);
  submission.release();
  await expect(page.getByText("已保存 1 段工作。", { exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  await page.reload();
  await expect(page.getByRole("button", { name: "手工录入", exact: true })).toBeVisible();
  expect(await page.evaluate((key) => sessionStorage.getItem(key), recoveryKey)).toBeNull();
  expect(await page.evaluate((key) => localStorage.getItem(key), prefillKey)).toContain("缓慢提交的 A");
});
