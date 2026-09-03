import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedWorkspace(
  page: Page,
  options: { isOwner?: boolean } = {},
): Promise<void> {
  let authenticated = false;
  await page.route("**/api/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-csrf-token" } }),
  );
  await page.route("**/api/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/logout", async (route) => {
    authenticated = false;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/me", (route) =>
    authenticated
      ? route.fulfill({
          json: {
            user: {
              id: "00000000-0000-4000-8000-000000000001",
              membershipId: "00000000-0000-4000-8000-000000000002",
              organizationId: "00000000-0000-4000-8000-000000000003",
              displayName: "林知夏",
              isOwner: options.isOwner ?? true,
            },
            permissions: [
              {
                permission: "work.view_own",
                scopeKind: "self",
                scopeId: "00000000-0000-4000-8000-000000000002",
              },
              {
                permission: "payroll.view_own",
                scopeKind: "self",
                scopeId: "00000000-0000-4000-8000-000000000002",
              },
              {
                permission: "payroll.configure",
                scopeKind: "organization",
                scopeId: null,
              },
              {
                permission: "payroll.settle",
                scopeKind: "organization",
                scopeId: null,
              },
              {
                permission: "import.scope",
                scopeKind: "organization",
                scopeId: null,
              },
              {
                permission: "project.manage",
                scopeKind: "organization",
                scopeId: null,
              },
              {
                permission: "members.manage",
                scopeKind: "organization",
                scopeId: null,
              },
              {
                permission: "org.manage",
                scopeKind: "organization",
                scopeId: null,
              },
            ],
          },
        })
      : route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/work-session-corrections/mine?**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/timer", (route) =>
    route.fulfill({ json: { timer: null } }),
  );
  await page.route("**/api/auth/mfa/totp", (route) =>
    route.fulfill({ json: { enabled: false, pending: false } }),
  );
  await page.route("**/api/auth/credentials", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        json: {
          credentials: [
            {
              id: "00000000-0000-4000-8000-000000000031",
              kind: "email",
              maskedIdentifier: "o***r@example.test",
              verifiedAt: "2026-09-01T01:00:00.000Z",
              createdAt: "2026-09-01T01:00:00.000Z",
            },
          ],
          verifiedCount: 1,
        },
      });
    }
    return route.fulfill({
      status: 405,
      json: { error: "unexpected_credential_write" },
    });
  });
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    "**/api/organization/ownership-transfers/pending-for-me",
    (route) => route.fulfill({ json: { transfer: null } }),
  );
  await page.route("**/api/organization/my-identities", (route) =>
    route.fulfill({
      json: { identities: [], availableIdentities: [], requests: [] },
    }),
  );
  await page.route("**/api/organization/identity-change-requests", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    "**/api/organization/invitation-delivery-capabilities",
    (route) =>
      route.fulfill({
        json: {
          manual: { available: true },
          email: { available: false },
          phone: { available: false },
        },
      }),
  );
  await page.route("**/api/approvals?**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/analytics/summary?**", (route) =>
    route.fulfill({
      json: {
        totals: {
          sessionCount: 2,
          totalSeconds: 19_800,
          approvedSeconds: 14_400,
          pendingSeconds: 5_400,
        },
        byDay: [
          { date: "2026-09-01", seconds: 7_200 },
          { date: "2026-09-02", seconds: 12_600 },
        ],
        byMember: [],
        byProject: [
          {
            projectId: "00000000-0000-4000-8000-000000000004",
            projectName: "工作台正式版",
            seconds: 19_800,
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects/*/nodes/*/versions", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            version: 2,
            snapshot: {
              title: "工作台正式版",
              assignees: [
                {
                  membershipId: "00000000-0000-4000-8000-000000000002",
                  isResponsible: true,
                },
              ],
            },
            changeSummary: "更新阶段进度",
            createdAt: "2026-09-02T01:00:00.000Z",
            createdBy: "00000000-0000-4000-8000-000000000002",
          },
          {
            version: 1,
            snapshot: { title: "工作台正式版" },
            changeSummary: "创建项目根节点",
            createdAt: "2026-09-01T01:00:00.000Z",
            createdBy: "00000000-0000-4000-8000-000000000002",
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects/*/nodes/*/work-sessions", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/projects/*/recycle-bin", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/projects/*/members", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/projects/*/member-candidates", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/projects/*/tree", (route) =>
    route.fulfill({
      json: {
        project: {
          id: "00000000-0000-4000-8000-000000000004",
          key: "WIP",
          name: "工作台正式版",
          version: 3,
        },
        branches: [
          {
            id: "00000000-0000-4000-8000-000000000005",
            name: "主线",
            isDefault: true,
          },
        ],
        nodes: [
          {
            id: "00000000-0000-4000-8000-000000000006",
            branchId: "00000000-0000-4000-8000-000000000005",
            parentId: null,
            type: "phase",
            title: "工作台正式版",
            status: "in_progress",
            progress: "40",
            version: 2,
            sortOrder: 0,
          },
          {
            id: "00000000-0000-4000-8000-000000000007",
            branchId: "00000000-0000-4000-8000-000000000005",
            parentId: "00000000-0000-4000-8000-000000000006",
            type: "task",
            title: "实现项目画布",
            status: "in_progress",
            progress: "65",
            version: 1,
            sortOrder: 0,
          },
        ],
        nodeAssignees: [],
        edges: [
          {
            id: "00000000-0000-4000-8000-000000000008",
            sourceNodeId: "00000000-0000-4000-8000-000000000006",
            targetNodeId: "00000000-0000-4000-8000-000000000007",
            type: "depends_on",
            label: "包含",
          },
        ],
      },
    }),
  );
}

test("logs in and renders a factual empty workspace", async ({ page }, testInfo) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移动端快速记录工作" }),
  ).toHaveCount(0);
  await expect(page.getByText("还没有工作记录")).toBeVisible();
  await expect(page.getByText("暂无计时")).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    fullPage: true,
    path: testInfo.outputPath("workspace.png"),
  });
});

test("TOTP login withholds the workspace until the second factor succeeds", async ({
  page,
}) => {
  let authenticated = false;
  await page.route("**/api/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-csrf-token" } }),
  );
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      status: 202,
      json: {
        mfaRequired: true,
        challengeToken: "a".repeat(43),
        expiresAt: "2026-09-02T01:05:00.000Z",
      },
    }),
  );
  await page.route("**/api/auth/login/mfa", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      challengeToken: "a".repeat(43),
      code: "123456",
    });
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/me", (route) =>
    authenticated
      ? route.fulfill({
          json: {
            user: {
              id: "00000000-0000-4000-8000-000000000001",
              membershipId: "00000000-0000-4000-8000-000000000002",
              organizationId: "00000000-0000-4000-8000-000000000003",
              displayName: "林知夏",
            },
            permissions: [],
          },
        })
      : route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [], nextCursor: null } }),
  );
  await page.route("**/api/timer", (route) =>
    route.fulfill({ json: { timer: null } }),
  );
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "验证身份" })).toBeVisible();
  await page.getByLabel("动态验证码").fill("123456");
  await page.getByRole("button", { name: "完成安全登录" }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
});

test("password reset requests a generic verified-channel delivery without exposing a token", async ({
  page,
}) => {
  await page.route("**/api/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-csrf-token" } }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/auth/password-reset/request", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      identifier: "member@example.test",
    });
    await route.fulfill({
      status: 202,
      json: {
        accepted: true,
        message: "若该邮箱或手机号对应有效账号，重置链接将通过已验证渠道发送。",
      },
    });
  });
  await page.goto("/login");
  await page.getByRole("link", { name: "忘记密码？" }).click();
  await expect(page.getByRole("heading", { name: "重置密码" })).toBeVisible();
  // React StrictMode intentionally mounts a newly navigated form twice in the
  // development server used by Playwright. Wait for both paint turns before
  // simulating a user's input so the assertion exercises the settled screen,
  // rather than racing the development-only remount.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  await page.getByLabel("邮箱或手机号").fill("member@example.test");
  const deliveryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/password-reset/request" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "提交重置申请" }).click();
  expect((await deliveryResponse).status()).toBe(202);
  await expect(page.getByRole("status")).toHaveText(
    "若该邮箱或手机号对应有效账号，重置链接将通过已验证渠道发送。",
  );
  await expect(page.locator("text=/[A-Za-z0-9_-]{32,}/")).toHaveCount(0);
});

test("an Owner session cannot swallow an employee invitation link", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const token = "employee-invitation-token-that-is-long-enough-123456";
  let accepted = false;
  await page.route("**/api/auth/invitations/accept", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token,
      password: "Employee-Secure-Password-123!",
    });
    accepted = true;
    await route.fulfill({ json: { accepted: true } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  await page.goto(`/invite#token=${token}`);
  await expect(page).not.toHaveURL(new RegExp(token));
  await expect(page.getByRole("heading", { name: "接受组织邀请" })).toBeVisible();
  await expect(page.getByText(/当前是唯一 Owner“林知夏”/)).toBeVisible();
  await expect(page.getByLabel("设置密码")).toHaveCount(0);

  await page
    .getByRole("button", { name: "退出当前账号并继续接受邀请" })
    .click();
  await page
    .getByLabel("设置密码")
    .fill("Employee-Secure-Password-123!");
  await page.getByRole("button", { name: "接受邀请并激活账号" }).click();
  await expect.poll(() => accepted).toBe(true);
  await expect(page).toHaveURL(/\/login$/);
});

test("an existing session must be ended before a password-reset capability is used", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const token = "member-password-reset-token-that-is-long-enough-123456";
  await page.route("**/api/auth/password-reset/complete", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      token,
      password: "Member-New-Secure-Password-123!",
    });
    await route.fulfill({ json: { reset: true } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/reset-password#token=${token}`);
  await expect(page.getByText(/当前是唯一 Owner“林知夏”/)).toBeVisible();
  await page
    .getByRole("button", { name: "退出当前账号并继续重置密码" })
    .click();
  await page
    .getByLabel("新密码", { exact: true })
    .fill("Member-New-Secure-Password-123!");
  await page
    .getByLabel("确认新密码")
    .fill("Member-New-Secure-Password-123!");
  await page
    .getByRole("button", { name: "重置密码并撤销旧会话" })
    .click();
  await expect(page).toHaveURL(/\/login$/);
});

test("password controls expose values only on explicit user action", async ({
  page,
}) => {
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.goto("/login");
  const password = page.getByLabel("密码");
  await password.fill("Visible-Only-When-Requested-123!");
  await expect(password).toHaveAttribute("type", "password");
  await page.getByRole("button", { name: "显示输入内容" }).click();
  await expect(password).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "隐藏输入内容" }).click();
  await expect(password).toHaveAttribute("type", "password");
});

test("Owner can configure a versioned hourly plan and create a pay period", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const memberId = "00000000-0000-4000-8000-000000000099";
  await page.route("**/api/payroll/me", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/payroll/management", (route) =>
    route.fulfill({
      json: {
        members: [
          {
            membershipId: memberId,
            displayName: "陈远航",
            status: "active",
            plan: null,
          },
        ],
        periods: [],
        runs: [],
      },
    }),
  );
  let planPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/payroll/members/${memberId}/plan`, async (route) => {
    planPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { result: { ok: true } } });
  });
  let periodPayload: Record<string, unknown> | null = null;
  await page.route("**/api/payroll/periods", async (route) => {
    periodPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ status: 201, json: { period: { id: "period-1" } } });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/payroll");
  await expect(
    page.getByRole("heading", { name: "薪资管理与我的薪资" }),
  ).toBeVisible();
  await page.getByLabel("成员").selectOption(memberId);
  await page.getByLabel("计薪类型").selectOption("hourly");
  await page.getByLabel("基础时薪").fill("88.50");
  await page.getByText("周末倍率", { exact: true }).click();
  await page.getByRole("button", { name: "保存薪资方案新版本" }).click();
  await expect.poll(() => planPayload).not.toBeNull();
  expect(planPayload).toMatchObject({
    type: "hourly",
    currency: "CNY",
    baseAmount: "88.50",
    pendingReviewCountsInEstimate: true,
  });
  expect(planPayload?.rules).toEqual([
    { type: "weekend", priority: 100, multiplier: "2" },
  ]);

  await page.getByRole("button", { name: "创建薪资周期" }).click();
  await expect.poll(() => periodPayload).not.toBeNull();
  expect(periodPayload).toMatchObject({ timezone: "Asia/Shanghai" });
});

test("contact verification consumes a fragment capability without leaving it in the address bar", async ({
  page,
}) => {
  const token = "v".repeat(43);
  await page.route("**/api/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-csrf-token" } }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/auth/credentials/verify", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      json: {
        verified: true,
        credential: {
          id: "00000000-0000-4000-8000-000000000032",
          kind: "phone",
          maskedIdentifier: "+********0000",
          verifiedAt: "2026-09-03T01:00:00.000Z",
          createdAt: "2026-09-03T00:00:00.000Z",
        },
      },
    });
  });

  await page.goto(`/verify-contact#token=${token}`);
  await expect(page).not.toHaveURL(new RegExp(token));
  await page.getByRole("button", { name: "确认验证联系方式" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "手机号已验证。现在可使用这项方式登录或找回密码。",
  );
});

test("initial Owner setup submits an optional E.164 phone as pending alongside the email bootstrap", async ({
  page,
}) => {
  const setupToken = "s".repeat(43);
  await page.route("**/api/auth/csrf", (route) =>
    route.fulfill({ json: { csrfToken: "test-csrf-token" } }),
  );
  await page.route("**/api/me", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/setup/status", (route) =>
    route.fulfill({ json: { completed: false, setupAvailable: true } }),
  );
  // The setup page deliberately adopts the browser's IANA time zone. Resolve
  // it from the same page context instead of making this request-contract test
  // depend on the machine where Playwright happens to run.
  let browserTimezone = "Asia/Shanghai";
  await page.route("**/api/setup/initial-owner", async (route) => {
    expect(route.request().headers()["x-setup-token"]).toBe(setupToken);
    expect(route.request().postDataJSON()).toEqual({
      organizationName: "示例工作室",
      displayName: "林知夏",
      email: "owner@example.test",
      phone: "+8613812345678",
      password: "ChangeMe-OnlyForLocalDev-123!",
      timezone: browserTimezone,
    });
    await route.fulfill({
      status: 201,
      json: {
        organizationId: "00000000-0000-4000-8000-000000000003",
        userId: "00000000-0000-4000-8000-000000000001",
        membershipId: "00000000-0000-4000-8000-000000000002",
        phoneVerificationPending: true,
      },
    });
  });

  await page.goto("/setup");
  browserTimezone = await page.evaluate(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  );
  await page.getByLabel("组织名称").fill("示例工作室");
  await page.getByLabel("Owner 姓名").fill("林知夏");
  await page.getByLabel("Owner 邮箱").fill("owner@example.test");
  await page.getByLabel("Owner 手机号（可选）").fill("+8613812345678");
  await page
    .getByLabel("Owner 密码")
    .fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByLabel("初始化令牌").fill(setupToken);
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/setup/initial-owner" &&
      candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: "创建组织与唯一 Owner" }).click();
  expect((await response).status()).toBe(201);
  await expect(page).toHaveURL(/\/login$/);
});

test("account security creates a pending phone binding through the authenticated channel", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/auth/credentials", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        json: {
          credentials: [
            {
              id: "00000000-0000-4000-8000-000000000031",
              kind: "email",
              maskedIdentifier: "o***r@example.test",
              verifiedAt: "2026-09-01T01:00:00.000Z",
              createdAt: "2026-09-01T01:00:00.000Z",
            },
          ],
          verifiedCount: 1,
        },
      });
      return;
    }
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      kind: "phone",
      identifier: "+8613812345678",
      password: "ChangeMe-OnlyForLocalDev-123!",
    });
    await route.fulfill({
      status: 202,
      json: {
        credential: {
          id: "00000000-0000-4000-8000-000000000032",
          kind: "phone",
          maskedIdentifier: "+********5678",
          verifiedAt: null,
          createdAt: "2026-09-03T01:00:00.000Z",
        },
        delivery: {
          kind: "phone",
          expiresAt: "2026-09-04T01:00:00.000Z",
          status: "sent",
        },
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/security");
  await expect(page.getByRole("heading", { name: "账户安全" })).toBeVisible();
  await page.getByLabel("新联系方式类型").selectOption("phone");
  await page.getByLabel("新手机号").fill("+8613812345678");
  await page
    .getByLabel("当前账户密码（用于联系方式操作）")
    .fill("ChangeMe-OnlyForLocalDev-123!");
  const deliveryResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/auth/credentials" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "发送验证链接" }).click();
  expect((await deliveryResponse).status()).toBe(202);
  await expect(page.getByRole("status")).toContainText("手机号验证消息已发送");
});

test("notification panel shows real unread items and marks them read", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const notification = {
    id: "00000000-0000-4000-8000-000000000041",
    title: "待审核提醒",
    body: "有一条工时等待处理",
    severity: "warning",
    actionUrl: "/approvals",
    readAt: null,
    createdAt: "2026-09-02T01:00:00.000Z",
  };
  await page.route("**/api/notifications", (route) =>
    route.fulfill({ json: { items: [notification] } }),
  );
  await page.route(
    "**/api/notifications/00000000-0000-4000-8000-000000000041/read",
    (route) =>
      route.fulfill({
        json: {
          notification: { ...notification, readAt: "2026-09-02T02:00:00.000Z" },
        },
      }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: /通知，1 条未读/ }).click();
  await expect(page.getByText("待审核提醒")).toBeVisible();
  await page.getByText("待审核提醒").click();
});

test("notification preferences can disable a worker-backed category", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const preference = {
    category: "timer_long_running",
    inAppEnabled: true,
    pushEnabled: false,
    emailEnabled: false,
    quietHours: {},
    mutedUntil: null,
  };
  await page.route("**/api/notification-preferences", async (route) => {
    if (route.request().method() === "GET")
      await route.fulfill({ json: { items: [preference] } });
    else {
      expect(route.request().postDataJSON()).toEqual({
        ...preference,
        inAppEnabled: false,
      });
      await route.fulfill({
        json: { preference: { ...preference, inAppEnabled: false } },
      });
    }
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/notification-preferences");
  await expect(page.getByRole("heading", { name: "通知设置" })).toBeVisible();
  await page
    .getByText("长时间计时")
    .locator("xpath=../..")
    .getByRole("button", { name: "关闭" })
    .click();
});

test("CSV import blocks invalid previews and confirms only the previewed content", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const csv =
    "startAt,endAt,content\n2026-09-02T01:00:00.000Z,2026-09-02T02:00:00.000Z,导入验收";
  await page.route("**/api/imports/work-sessions/preview", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ csv });
    await route.fulfill({
      json: {
        importId: "00000000-0000-4000-8000-000000000051",
        hash: "a".repeat(64),
        rowCount: 1,
        validCount: 1,
        errors: [],
      },
    });
  });
  await page.route(
    "**/api/imports/00000000-0000-4000-8000-000000000051/confirm",
    async (route) => {
      expect(route.request().postDataJSON()).toEqual({ csv });
      await route.fulfill({ json: { importedCount: 1 } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
  await page.goto("/imports");
  await page.getByLabel("工时 CSV 文件").setInputFiles({
    name: "work.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText("校验通过，可以确认导入。")).toBeVisible();
  await page.getByRole("button", { name: "确认原子导入" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "已原子导入 1 条工时记录。",
  );
});

test("CSV import keeps confirmation disabled when server validation reports a row error", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const csv = "startAt,endAt,content\ninvalid,2026-09-02T02:00:00.000Z,错误行";
  await page.route("**/api/imports/work-sessions/preview", (route) =>
    route.fulfill({
      json: {
        importId: "00000000-0000-4000-8000-000000000052",
        hash: "b".repeat(64),
        rowCount: 1,
        validCount: 0,
        errors: [{ row: 2, field: "startAt", message: "Invalid ISO datetime" }],
      },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
  await page.goto("/imports");
  await page.getByLabel("工时 CSV 文件").setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await page.getByRole("button", { name: "预览并校验" }).click();
  await expect(page.getByText("Invalid ISO datetime")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "确认原子导入" }),
  ).toBeDisabled();
});

test("mobile navigation exposes the five primary destinations", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("mobile"),
    "mobile-only assertion",
  );
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  const navigation = page.getByRole("navigation", { name: "移动端主导航" });
  for (const label of ["今日", "记录", "项目", "分析", "薪资"]) {
    await expect(navigation.getByText(label, { exact: true })).toBeVisible();
  }
});

test("manual work recording persists primary and auxiliary project-node associations", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const project = {
    id: "00000000-0000-4000-8000-000000000004",
    key: "WIP",
    name: "工作台正式版",
    description: null,
    color: "#5b5ce2",
    status: "active",
    version: 3,
    updatedAt: "2026-09-02T01:00:00.000Z",
  };
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [project] } }),
  );
  await page.route("**/api/work-sessions", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      content: "关联项目节点的补录",
      primaryProjectNodeId: "00000000-0000-4000-8000-000000000007",
      projectNodeIds: [
        "00000000-0000-4000-8000-000000000007",
        "00000000-0000-4000-8000-000000000006",
      ],
      source: "manual",
    });
    await route.fulfill({ json: { ok: true } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await expect(
    page.getByRole("button", { name: "移动端快速记录工作" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "手工录入" }).click();
  await page.getByLabel("工作内容").fill("关联项目节点的补录");
  await page
    .getByLabel("关联项目（可选）", { exact: true })
    .selectOption(project.id);
  await page
    .getByLabel("主项目节点", { exact: true })
    .selectOption("00000000-0000-4000-8000-000000000007");
  await page.getByLabel("关联 工作台正式版", { exact: true }).check();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "保存真实工时草稿" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "保存真实工时草稿" }).click();
});

test("evidence uploads arbitrary file formats one by one and completes every selected file", async (
  { page },
  testInfo,
) => {
  await mockAuthenticatedWorkspace(page);
  const sessionId = "00000000-0000-4000-8000-000000000091";
  const startedAt = new Date();
  startedAt.setHours(9, 0, 0, 0);
  const completedAttachmentIds: string[] = [];
  const uploadIntents: Array<Record<string, unknown>> = [];
  const session = {
    id: sessionId,
    startAt: startedAt.toISOString(),
    endAt: new Date(startedAt.getTime() + 60 * 60_000).toISOString(),
    timezone: "Asia/Shanghai",
    netSeconds: 3600,
    content: "多格式证据验收",
    result: "",
    blockers: "",
    nextStep: "",
    parallelWork: false,
    primaryProjectNodeId: null,
    projectLinks: [],
    source: "manual",
    recordKind: "fact",
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    version: 1,
    visibility: "management_only",
    breaks: [],
  };
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [session], nextCursor: null } }),
  );
  await page.route("**/api/evidence/capabilities", (route) =>
    route.fulfill({
      json: {
        fileUploads: {
          available: true,
          maxBytes: 100 * 1024 * 1024,
          acceptsArbitraryFormats: true,
        },
        references: { url: true, text: true },
      },
    }),
  );
  await page.route(`**/api/work-sessions/${sessionId}/attachments`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    `**/api/work-sessions/${sessionId}/attachments/upload-intent`,
    async (route) => {
      const input = route.request().postDataJSON() as Record<string, unknown>;
      uploadIntents.push(input);
      const id = `00000000-0000-4000-8000-${String(uploadIntents.length).padStart(12, "0")}`;
      await route.fulfill({
        status: 201,
        json: {
          attachment: { id },
          uploadUrl: `https://object-storage.example.test/evidence/${id}`,
          requiredHeaders: {
            "content-type": "application/octet-stream",
            "x-amz-checksum-sha256": "dGVzdC1jaGVja3N1bQ==",
            "x-amz-meta-sha256": "a".repeat(64),
            "x-amz-meta-declared-mime":
              uploadIntents.at(-1)?.mimeType as string,
          },
        },
      });
    },
  );
  await page.route("https://object-storage.example.test/**", async (route) => {
    expect(route.request().method()).toBe("PUT");
    expect(route.request().headers()["content-type"]).toBe(
      "application/octet-stream",
    );
    expect(route.request().headers()["x-amz-checksum-sha256"]).toBeTruthy();
    expect(route.request().headers()["x-amz-meta-sha256"]).toMatch(
      /^[a-f0-9]{64}$/,
    );
    expect(route.request().headers()["x-amz-meta-declared-mime"]).toBeTruthy();
    await route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.route("**/api/attachments/*/complete", async (route) => {
    completedAttachmentIds.push(route.request().url().split("/").at(-2)!);
    await route.fulfill({ json: { attachment: { id: completedAttachmentIds.at(-1) } } });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByRole("button", { name: "证据" }).click();
  await page.getByLabel("选择工作证据文件").setInputFiles([
    {
      name: "现场采集.tracebundle",
      mimeType: "",
      buffer: Buffer.from("opaque trace evidence"),
    },
    {
      name: "专项记录.acmeproof",
      mimeType: "application/x-acme-work-proof",
      buffer: Buffer.from("custom work evidence"),
    },
  ]);
  await expect(page.getByText("现场采集.tracebundle", { exact: true })).toBeVisible();
  await expect(page.getByText("专项记录.acmeproof", { exact: true })).toBeVisible();
  const uploadQueueButton = page.getByRole("button", { name: "上传队列" });
  if (testInfo.project.name.startsWith("mobile")) {
    // The bottom navigation is fixed.  A control scrolled into view must keep
    // a real tap clearance above it instead of merely being present in the
    // DOM underneath the navigation's pointer target.
    await uploadQueueButton.scrollIntoViewIfNeeded();
    const navigationClearance = await uploadQueueButton.evaluate((element) => {
      const navigation = document.querySelector('[aria-label="移动端主导航"]');
      if (!navigation) return null;
      return (
        navigation.getBoundingClientRect().top -
        element.getBoundingClientRect().bottom
      );
    });
    expect(navigationClearance).not.toBeNull();
    expect(navigationClearance!).toBeGreaterThanOrEqual(8);
  }
  await uploadQueueButton.click();
  await expect.poll(() => completedAttachmentIds.length).toBe(2);
  expect(uploadIntents).toHaveLength(2);
  expect(uploadIntents[0]).toMatchObject({
    originalName: "现场采集.tracebundle",
    mimeType: "application/octet-stream",
  });
  expect(uploadIntents[1]).toMatchObject({
    originalName: "专项记录.acmeproof",
    mimeType: "application/x-acme-work-proof",
  });
  await expect(
    page.getByText(/现场采集\.tracebundle.*已完成/),
  ).toBeVisible();
  await expect(
    page.getByText(/专项记录\.acmeproof.*已完成/),
  ).toBeVisible();
});

test("evidence keeps text references usable when private object storage is not configured", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const sessionId = "00000000-0000-4000-8000-000000000092";
  const startedAt = new Date();
  startedAt.setHours(10, 0, 0, 0);
  const session = {
    id: sessionId,
    startAt: startedAt.toISOString(),
    endAt: new Date(startedAt.getTime() + 30 * 60_000).toISOString(),
    timezone: "Asia/Shanghai",
    netSeconds: 1800,
    content: "无对象存储时的文字证据",
    result: "",
    blockers: "",
    nextStep: "",
    parallelWork: false,
    primaryProjectNodeId: null,
    projectLinks: [],
    source: "manual",
    recordKind: "fact",
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    version: 1,
    visibility: "management_only",
    breaks: [],
  };
  let textReferenceSaved = false;
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [session], nextCursor: null } }),
  );
  await page.route("**/api/evidence/capabilities", (route) =>
    route.fulfill({
      json: {
        fileUploads: {
          available: false,
          maxBytes: 100 * 1024 * 1024,
          acceptsArbitraryFormats: true,
        },
        references: { url: true, text: true },
      },
    }),
  );
  await page.route(`**/api/work-sessions/${sessionId}/attachments`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    `**/api/work-sessions/${sessionId}/attachments/reference`,
    async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        kind: "text",
        textContent: "会议纪要：已向客户演示并记录反馈。",
      });
      textReferenceSaved = true;
      await route.fulfill({ status: 201, json: { attachment: { id: "text-proof" } } });
    },
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByRole("button", { name: "证据" }).click();
  await expect(
    page.getByText(/文件对象存储尚未配置.*暂时可添加链接或文字证据/),
  ).toBeVisible();
  await expect(page.getByLabel("选择工作证据文件")).toHaveCount(0);
  await page
    .getByPlaceholder("粘贴简短文字证据、会议纪要、命令输出或说明…")
    .fill("会议纪要：已向客户演示并记录反馈。");
  await page.getByRole("button", { name: "保存文字" }).click();
  await expect.poll(() => textReferenceSaved).toBe(true);
});

test("future plan uses the isolated cloud-plan endpoint", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const plannedStart = new Date(Date.now() + 24 * 60 * 60_000);
  const plannedEnd = new Date(plannedStart.getTime() + 90 * 60_000);
  await page.route("**/api/work-plans", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      content: "明天的跨端计划",
      source: "manual",
      visibility: "private",
    });
    await route.fulfill({ json: { session: { id: "plan-created" } } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入" }).click();
  await page.getByLabel("工作内容").fill("明天的跨端计划");
  await page
    .getByLabel("开始时间")
    .fill(plannedStart.toISOString().slice(0, 16));
  await page
    .getByLabel("结束时间")
    .fill(plannedEnd.toISOString().slice(0, 16));
  await page.getByRole("button", { name: "保存云端计划" }).click();
});

test("a completed cloud plan becomes fact only through the explicit realization action", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const endedAt = new Date(Date.now() - 30 * 60_000);
  const startedAt = new Date(endedAt.getTime() - 60 * 60_000);
  const plan = {
    id: "00000000-0000-4000-8000-000000000089",
    startAt: startedAt.toISOString(),
    endAt: endedAt.toISOString(),
    timezone: "Asia/Shanghai",
    netSeconds: 3600,
    content: "已经结束的云端计划",
    result: "",
    blockers: "",
    nextStep: "",
    source: "manual",
    recordKind: "plan",
    parallelWork: false,
    primaryProjectNodeId: null,
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    visibility: "private",
    version: 2,
    breaks: [],
    projectLinks: [],
  };
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [plan], nextCursor: null } }),
  );
  await page.route(`**/api/work-plans/${plan.id}/realize`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ expectedVersion: 2 });
    await route.fulfill({ json: { session: { ...plan, recordKind: "fact" } } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await expect(page.getByText("1 个计划")).toBeVisible();
  await page.getByRole("button", { name: "转为真实草稿" }).click();
});

test("timer start persists primary and auxiliary project-node associations", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const project = {
    id: "00000000-0000-4000-8000-000000000004",
    key: "WIP",
    name: "工作台正式版",
    description: null,
    color: "#5b5ce2",
    status: "active",
    version: 3,
    updatedAt: "2026-09-02T01:00:00.000Z",
  };
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [project] } }),
  );
  await page.route("**/api/timer/start", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      content: "关联项目节点的计时",
      primaryProjectNodeId: "00000000-0000-4000-8000-000000000007",
      projectNodeIds: [
        "00000000-0000-4000-8000-000000000007",
        "00000000-0000-4000-8000-000000000006",
      ],
      visibility: "management_only",
    });
    await route.fulfill({
      status: 201,
      json: {
        timer: {
          id: "00000000-0000-4000-8000-000000000077",
          status: "running",
          metadata: { content: "关联项目节点的计时" },
        },
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByLabel("准备做什么").fill("关联项目节点的计时");
  await page.getByText("关联项目节点（可选）", { exact: true }).click();
  await page.getByLabel("计时关联项目（可选）").selectOption(project.id);
  await page
    .getByLabel("计时主项目节点")
    .selectOption("00000000-0000-4000-8000-000000000007");
  await page.getByLabel("计时关联 工作台正式版").check();
  await expect(page.getByText("已关联 2 / 32", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "开始计时" }).click();
});

test("calendar offers day week month views and versioned draft rescheduling", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const sessionStart = new Date();
  sessionStart.setHours(9, 0, 0, 0);
  const sessionEnd = new Date(sessionStart.getTime() + 60 * 60_000);
  const session = {
    id: "00000000-0000-4000-8000-000000000031",
    startAt: sessionStart.toISOString(),
    endAt: sessionEnd.toISOString(),
    netSeconds: 3_600,
    content: "日历改期验证",
    result: "",
    source: "manual",
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    version: 2,
    visibility: "management_only",
  };
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: [session], nextCursor: null } }),
  );
  await page.route(
    "**/api/work-sessions/00000000-0000-4000-8000-000000000031/schedule",
    async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        expectedVersion: 2,
      });
      await route.fulfill({ json: { session } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/calendar");
  await expect(
    page.getByLabel("工作日历视图").getByText("日历改期验证", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "月", exact: true }).click();
  await page.getByRole("button", { name: "前一天" }).click();
});

test("calendar period navigation changes the active date anchor", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/calendar");
  await page.getByRole("button", { name: "月", exact: true }).click();
  const period = page.locator(".calendar-period-bar h2");
  const before = await period.textContent();
  await page.getByRole("button", { name: "上一周期" }).click();
  await expect(period).not.toHaveText(before ?? "");
  await page.getByRole("button", { name: "今天" }).click();
  await expect(period).toHaveText(before ?? "");
});

test("calendar keeps project milestones opt-in and loads their permitted date range", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const dueAt = new Date();
  dueAt.setHours(16, 0, 0, 0);
  let requestedMilestones = false;
  await page.route("**/api/projects/calendar-milestones?**", (route) => {
    const requestUrl = new URL(route.request().url());
    const startAt = requestUrl.searchParams.get("startAt");
    const endAt = requestUrl.searchParams.get("endAt");
    expect(startAt).not.toBeNull();
    expect(endAt).not.toBeNull();
    expect(new Date(endAt ?? 0).getTime()).toBeGreaterThan(
      new Date(startAt ?? 0).getTime(),
    );
    requestedMilestones = true;
    return route.fulfill({
      json: {
        items: [
          {
            nodeId: "00000000-0000-4000-8000-000000000082",
            projectId: "00000000-0000-4000-8000-000000000004",
            projectKey: "WIP",
            projectName: "工作台正式版",
            projectColor: "#5b5ce2",
            title: "发布验收",
            dueAt: dueAt.toISOString(),
            status: "in_progress",
            progress: "75.00",
          },
        ],
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/calendar");
  await expect(page.getByText("发布验收", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "显示项目里程碑" }).click();
  await expect.poll(() => requestedMilestones).toBe(true);
  await expect(page.getByText("发布验收", { exact: true })).toBeVisible();
});

test("analytics uses accessible, server-backed responsive chart containers", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/analytics");
  await expect(
    page.getByRole("img", { name: "每日净工时趋势图" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "项目投入分布图" })).toBeVisible();
  await expect(page.getByText("工作台正式版")).toBeVisible();
});

test("AI page does not expose team analysis without an organization-scoped grant", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  await expect(page.getByRole("combobox")).toHaveValue("self");
  await expect(page.getByRole("option", { name: "团队授权范围" })).toHaveCount(
    0,
  );
});

test("AI provider configuration is visible only to the unique Owner", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { isOwner: false });
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("member@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  await expect(
    page.getByRole("button", { name: "组织 AI 配置" }),
  ).toHaveCount(0);
});

test("AI report requests keep a stable five-minute range for cost-safe deduplication", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const requests: Array<{ scope: string; from: string; to: string }> = [];
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    expect(route.request().method()).toBe("POST");
    requests.push(
      route.request().postDataJSON() as {
        scope: string;
        from: string;
        to: string;
      },
    );
    await route.fulfill({
      status: 202,
      json: { job: { id: `job-${requests.length}`, status: "queued" } },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  const generate = page.getByRole("button", {
    name: "生成近 7 天报告",
    exact: true,
  });
  await generate.click();
  await expect.poll(() => requests.length).toBe(1);
  await generate.click();
  await expect.poll(() => requests.length).toBe(2);

  expect(requests[1]).toEqual(requests[0]);
  const request = requests[0]!;
  const from = new Date(request.from);
  const to = new Date(request.to);
  expect(request.scope).toBe("self");
  expect(to.getUTCSeconds()).toBe(0);
  expect(to.getUTCMilliseconds()).toBe(0);
  expect(to.getUTCMinutes() % 5).toBe(0);
  expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);
});

test("critical workspace widths do not introduce horizontal document overflow", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/analytics");
    await expect(page.getByRole("heading", { name: "数据分析" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
    ).toBe(true);
  }
});

test("project tree renders a pannable canvas with a list fallback", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/projects/00000000-0000-4000-8000-000000000004");
  await expect(page.getByText("实现项目画布")).toBeVisible();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.getByText(/任务 · .*v1/)).toBeVisible();
});

test("command palette only navigates through authorized workspace destinations", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
  await page.keyboard.press("Control+K");
  await expect(page.getByRole("dialog", { name: "全局导航" })).toBeVisible();
  await page.getByLabel("搜索工作台页面").fill("日历");
  await page.getByRole("button", { name: "日历 工作空间" }).click();
  await expect(page.getByRole("heading", { name: "工作日历" })).toBeVisible();
});

test("project color chips keep readable text for light server colors", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000061",
            key: "LT",
            name: "浅色项目",
            description: "对比度验证",
            color: "#ffffff",
            status: "active",
            version: 1,
            updatedAt: "2026-09-02T01:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/projects");
  const colorChip = page.getByText("LT", { exact: true });
  await expect(colorChip).toBeVisible();
  await expect
    .poll(() =>
      colorChip.evaluate((element) => getComputedStyle(element).color),
    )
    .toBe("rgb(23, 32, 54)");
});

test("a custom accent is rendered exactly while its foreground remains readable", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "外观设置" }).click();
  await page.getByLabel("强调色 HEX 值").fill("#ffffff");
  const contrast = await page.evaluate(() => {
    const hexToLuminance = (hex: string) => {
      const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
        (value) => Number.parseInt(value, 16) / 255,
      );
      const [red, green, blue] = channels.map((channel) =>
        channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const ratio = (first: string, second: string) => {
      const [lighter, darker] = [
        hexToLuminance(first),
        hexToLuminance(second),
      ].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const accent = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim();
    const foreground = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-foreground")
      .trim();
    return {
      accent,
      foreground,
      foregroundContrast: ratio(accent, foreground),
    };
  });
  expect(contrast.accent).toBe("#ffffff");
  expect(contrast.foregroundContrast).toBeGreaterThanOrEqual(4.5);
});

test("light semantic status palettes keep text readable on their own surfaces", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const contrasts = await page.evaluate(() => {
    const luminance = (hex: string) => {
      const channels = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(
        (value) => Number.parseInt(value, 16) / 255,
      );
      const [red, green, blue] = channels.map((channel) =>
        channel <= 0.03928
          ? channel / 12.92
          : ((channel + 0.055) / 1.055) ** 2.4,
      );
      return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    };
    const contrast = (foreground: string, background: string) => {
      const [lighter, darker] = [
        luminance(foreground),
        luminance(background),
      ].sort((first, second) => second - first);
      return (lighter + 0.05) / (darker + 0.05);
    };
    const styles = getComputedStyle(document.documentElement);
    const token = (name: string) => styles.getPropertyValue(name).trim();
    return [
      contrast(token("--text-subtle"), token("--surface")),
      contrast(token("--positive"), token("--positive-soft")),
      contrast(token("--success"), token("--success-soft")),
      contrast(token("--warning"), token("--warning-soft")),
      contrast(token("--danger"), token("--danger-soft")),
      contrast(token("--info"), token("--info-soft")),
    ];
  });

  for (const contrast of contrasts) {
    expect(contrast).toBeGreaterThanOrEqual(4.5);
  }
});

test("mobile dark theme keeps its primary navigation on a semantic dark surface", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("mobile"),
    "mobile-only assertion",
  );
  await mockAuthenticatedWorkspace(page);
  await page.addInitScript(() =>
    localStorage.setItem("workbench-theme", "dark"),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const mobileNavigation = page.getByRole("navigation", {
    name: "移动端主导航",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("dark");
  const themeAndNavigation = await page.evaluate(() => {
    const navigation = document.querySelector('[aria-label="移动端主导航"]');
    return {
      theme: document.documentElement.dataset.theme,
      background: navigation ? getComputedStyle(navigation).backgroundColor : "",
    };
  });
  expect(themeAndNavigation.theme).toBe("dark");
  expect(themeAndNavigation.background).not.toContain("255");
});

test("mobile system theme applies the same dark navigation surface when the device is dark", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("mobile"),
    "mobile-only assertion",
  );
  await page.emulateMedia({ colorScheme: "dark" });
  await mockAuthenticatedWorkspace(page);
  await page.addInitScript(() =>
    localStorage.setItem("workbench-theme", "system"),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  const mobileNavigation = page.getByRole("navigation", {
    name: "移动端主导航",
  });
  await expect(mobileNavigation).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe("system");
  const background = await mobileNavigation.evaluate(
    (navigation) => getComputedStyle(navigation).backgroundColor,
  );
  expect(background).not.toContain("255");
});

test("header notification and appearance popovers do not overlap", async ({
  page,
}, testInfo) => {
  const clickOutsideUtilityPopover = async () => {
    if (testInfo.project.name.startsWith("mobile")) {
      const viewport = page.viewportSize();
      if (!viewport) throw new Error("测试视口不可用。");
      // On a narrow screen the picker can cover the heading itself. Tap the
      // visible lower canvas instead of forcing a click through the popover.
      await page.mouse.click(8, viewport.height - 120);
      return;
    }
    await page.getByRole("heading", { name: "林知夏，今天好" }).click();
  };
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "外观设置" }).click();
  await expect(page.getByLabel("自定义强调色")).toBeVisible();
  await clickOutsideUtilityPopover();
  await expect(page.getByLabel("自定义强调色")).toHaveCount(0);
  await page.getByRole("button", { name: "外观设置" }).click();
  await page.getByLabel("强调色 HEX 值").fill("#c34359");
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue("--accent")
          .trim(),
      ),
    )
    .toBe("#c34359");
  await page.getByRole("button", { name: "通知" }).click();
  await expect(page.getByLabel("自定义强调色")).toHaveCount(0);
  await expect(page.getByText("通知中心")).toBeVisible();
  await clickOutsideUtilityPopover();
  await expect(page.getByText("通知中心")).toHaveCount(0);
});

test("desktop sidebar resizes with pointer controls and keeps its collapse state", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith("mobile"),
    "desktop-only interaction",
  );
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "林知夏，今天好" }),
  ).toBeVisible();

  const resizeHandle = page.getByRole("separator", {
    name: "调整侧边栏宽度",
  });
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "272");
  const bounds = await resizeHandle.boundingBox();
  expect(bounds).not.toBeNull();
  if (!bounds) throw new Error("侧边栏宽度拖拽手柄未渲染。");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 64, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "336");

  await page.getByRole("button", { name: "收起侧栏" }).click();
  await expect(resizeHandle).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("workbench-sidebar-collapsed")),
    )
    .toBe("true");
  await page.getByRole("button", { name: "展开侧栏" }).click();
  await expect(resizeHandle).toHaveAttribute("aria-valuenow", "336");
});

test("AI context panel closes from its backdrop and Escape", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name.startsWith("mobile"),
    "desktop-only interaction",
  );
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "打开 AI 上下文" }).click();
  await expect(page.getByRole("dialog", { name: "AI 上下文面板" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "AI 上下文面板" })).toHaveCount(0);
  await page.getByRole("button", { name: "打开 AI 上下文" }).click();
  await page.getByRole("button", { name: "关闭 AI 上下文" }).first().click();
  await expect(page.getByRole("dialog", { name: "AI 上下文面板" })).toHaveCount(0);
});

test("organization keeps access role, org position, and professional identity as separate real layers", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const memberId = "00000000-0000-4000-8000-000000000002";
  const unitId = "00000000-0000-4000-8000-000000000071";
  const roleId = "00000000-0000-4000-8000-000000000072";
  const identityId = "00000000-0000-4000-8000-000000000073";
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId: memberId,
        units: [
          {
            id: unitId,
            parentId: null,
            name: "产品研发",
            description: "负责产品交付",
            leaderMembershipId: memberId,
            sortOrder: 0,
            version: 1,
          },
        ],
        roles: [
          {
            id: roleId,
            name: "Owner",
            kind: "owner",
            description: "唯一组织所有者",
            isSystem: true,
          },
        ],
        professionalIdentities: [
          {
            id: identityId,
            name: "产品设计",
            description: "面向体验与交付的专业身份",
            isCustom: false,
          },
        ],
        members: [
          {
            membership: {
              id: memberId,
              status: "active",
              positionTitle: "产品负责人",
              orgUnitId: unitId,
            },
            user: { displayName: "林知夏" },
            positionTitle: "产品负责人",
            unitName: "产品研发",
            isOwner: true,
            accessRoles: [
              {
                membershipId: memberId,
                roleId,
                roleName: "Owner",
                roleKind: "owner",
                scopeKind: "organization",
                scopeId: null,
                expiresAt: null,
              },
            ],
            professionalIdentities: [
              {
                membershipId: memberId,
                identityId,
                identityName: "产品设计",
                source: "organization",
                verifiedAt: "2026-09-02T01:00:00.000Z",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/organization");
  await expect(page.getByRole("heading", { name: "组织与人员" })).toBeVisible();
  await expect(
    page.getByText("访问角色", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("组织岗位", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("专业身份", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: /成员/ }).click();
  await expect(page.getByText("产品负责人", { exact: true })).toBeVisible();
  await expect(
    page
      .locator(".organization-members-table")
      .getByText("产品设计", { exact: true }),
  ).toBeVisible();
});

test("an owner can white-list both contacts and copy a manual one-time invitation", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const ownerMembershipId = "00000000-0000-4000-8000-000000000002";
  const roleId = "00000000-0000-4000-8000-000000000074";
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId,
        units: [],
        roles: [
          {
            id: roleId,
            name: "成员",
            kind: "member",
            description: "仅本人范围",
            isSystem: true,
          },
        ],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: ownerMembershipId,
              status: "active",
              positionTitle: "负责人",
              orgUnitId: null,
            },
            user: { displayName: "林知夏" },
            positionTitle: "负责人",
            unitName: null,
            isOwner: true,
            accessRoles: [],
            professionalIdentities: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/organization/invitations", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      displayName: "新成员",
      email: "member@example.test",
      phone: "+8613812345678",
      deliveryMode: "manual",
      orgUnitId: null,
      roleId,
    });
    await route.fulfill({
      status: 201,
      json: {
        membership: { id: "00000000-0000-4000-8000-000000000075" },
        delivery: {
          mode: "manual",
          credentialKinds: ["email", "phone"],
          expiresAt: "2026-09-10T01:00:00.000Z",
        },
        manualLink:
          "https://app.example.test/invite#token=manual-invitation-test-token",
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/organization");
  await page.getByText("添加成员并生成加入链接").click();
  await expect(
    page.getByRole("option", { name: "通过邮件自动投递（尚未配置）" }),
  ).toBeDisabled();
  await expect(
    page.getByText("邮件和短信均未配置；默认手工链接可立即使用，不会尝试伪造投递。"),
  ).toBeVisible();
  await page.getByPlaceholder("姓名").fill("新成员");
  await page.getByRole("button", { name: "加入白名单并生成链接" }).click();
  await expect(
    page.getByText("请至少填写一个邮箱或手机号。两个都填也可以。"),
  ).toBeVisible();
  await page.getByLabel("白名单邮箱（可选）").fill("member@example.test");
  await page.getByLabel("白名单手机号（可选）").fill("+8613812345678");
  await page.getByPlaceholder("岗位（可选）").fill("");
  await expect(page.getByLabel("初始访问角色")).toHaveValue(roleId);
  await expect(page.getByText("默认已选“成员”")).toBeVisible();
  await page.getByRole("button", { name: "加入白名单并生成链接" }).click();
  await expect(page.getByText("一次性邀请链接已生成")).toBeVisible();
  await expect(page.getByLabel("邀请一次性链接")).toHaveValue(
    "https://app.example.test/invite#token=manual-invitation-test-token",
  );
  await expect(page.getByText(/私密渠道单独发送给当事人/)).toBeVisible();
});

test("white-list invitation never submits a required role select with no assignable role", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const ownerMembershipId = "00000000-0000-4000-8000-000000000002";
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId,
        ownershipTransfer: null,
        units: [],
        roles: [
          {
            id: "00000000-0000-4000-8000-000000000072",
            name: "Owner",
            kind: "owner",
            description: "唯一组织所有者",
            isSystem: true,
          },
        ],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: ownerMembershipId,
              status: "active",
              positionTitle: "组织负责人",
              orgUnitId: null,
            },
            user: { displayName: "林知夏" },
            positionTitle: "组织负责人",
            unitName: null,
            isOwner: true,
            accessRoles: [],
            professionalIdentities: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/organization");
  await page.getByText("添加成员并生成加入链接").click();

  await expect(page.getByLabel("初始访问角色")).toBeDisabled();
  await expect(
    page.getByText("正在恢复可邀请角色目录；在目录可用前不会提交缺少访问角色的邀请。"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "加入白名单并生成链接" }),
  ).toBeDisabled();
});

test("an employee submits a professional identity request from personal security without gaining management access", async ({
  page,
}) => {
  let authenticated = false;
  const membershipId = "00000000-0000-4000-8000-000000000073";
  const requestedIdentityId = "00000000-0000-4000-8000-000000000074";
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/me", (route) =>
    authenticated
      ? route.fulfill({
          json: {
            user: {
              id: "00000000-0000-4000-8000-000000000075",
              membershipId,
              organizationId: "00000000-0000-4000-8000-000000000003",
              displayName: "周清言",
            },
            permissions: [
              {
                permission: "work.view_own",
                scopeKind: "self",
                scopeId: membershipId,
              },
            ],
          },
        })
      : route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/organization/my-identities", (route) =>
    route.fulfill({
      json: {
        identities: [
          {
            identityId: "00000000-0000-4000-8000-000000000076",
            identityName: "前端开发",
            description: "负责界面实现",
            source: "self_declared",
            verifiedAt: "2026-09-02T01:00:00.000Z",
          },
        ],
        availableIdentities: [
          {
            id: requestedIdentityId,
            name: "Agent 开发",
            description: "负责智能体能力",
          },
        ],
        requests: [],
      },
    }),
  );
  await page.route(
    "**/api/organization/my-identities/requests",
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        action: "add",
        identityId: requestedIdentityId,
        reason: "负责当前智能体能力的开发与维护",
      });
      await route.fulfill({
        status: 201,
        json: { request: { id: "00000000-0000-4000-8000-000000000077" } },
      });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("employee@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/security");
  await expect(page.getByText("我的专业身份", { exact: true })).toBeVisible();
  await page.getByText("申请新增专业身份", { exact: true }).click();
  await page
    .getByLabel("组织已有身份（可选）")
    .selectOption(requestedIdentityId);
  await page.getByLabel("申请说明").fill("负责当前智能体能力的开发与维护");
  await expect(page.getByRole("link", { name: /组织与人员/ })).toHaveCount(0);
  await page.getByRole("button", { name: "提交身份申请" }).click();
});

test("a manager reviews a pending professional identity request through the organization workflow", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const memberId = "00000000-0000-4000-8000-000000000073";
  const requestId = "00000000-0000-4000-8000-000000000078";
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId: "00000000-0000-4000-8000-000000000002",
        ownershipTransfer: null,
        units: [],
        roles: [
          {
            id: "00000000-0000-4000-8000-000000000072",
            name: "Owner",
            kind: "owner",
            description: "唯一组织所有者",
            isSystem: true,
          },
        ],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: memberId,
              status: "active",
              positionTitle: "前端工程师",
              orgUnitId: null,
            },
            user: { displayName: "周清言" },
            positionTitle: "前端工程师",
            unitName: null,
            isOwner: false,
            accessRoles: [],
            professionalIdentities: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/organization/identity-change-requests", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: requestId,
            membershipId: memberId,
            memberName: "周清言",
            action: "add",
            requestedName: "Agent 开发",
            requestedIdentityId: null,
            reason: "负责当前智能体能力的开发与维护",
            status: "pending",
            reviewNote: null,
            createdAt: "2026-09-02T01:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/organization/identity-change-requests/${requestId}/review`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ decision: "approved" });
      await route.fulfill({
        json: { request: { id: requestId, status: "approved" } },
      });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/organization");
  await expect(page.getByText("待审身份申请", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "批准身份申请 Agent 开发" }).click();
});

test("organization Owner can issue a manual reset link and start a dual-confirmation transfer", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const managerId = "00000000-0000-4000-8000-000000000074";
  const unitId = "00000000-0000-4000-8000-000000000071";
  const ownerRoleId = "00000000-0000-4000-8000-000000000072";
  const managerRoleId = "00000000-0000-4000-8000-000000000075";
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId: ownerId,
        ownershipTransfer: null,
        units: [
          {
            id: unitId,
            parentId: null,
            name: "产品研发",
            description: "负责产品交付",
            leaderMembershipId: ownerId,
            sortOrder: 0,
            version: 1,
          },
        ],
        roles: [
          {
            id: ownerRoleId,
            name: "Owner",
            kind: "owner",
            description: "唯一组织所有者",
            isSystem: true,
          },
          {
            id: managerRoleId,
            name: "Manager",
            kind: "manager",
            description: "组织级管理",
            isSystem: true,
          },
        ],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: ownerId,
              status: "active",
              positionTitle: "组织负责人",
              orgUnitId: unitId,
            },
            user: { displayName: "林知夏" },
            positionTitle: "组织负责人",
            unitName: "产品研发",
            isOwner: true,
            accessRoles: [
              {
                membershipId: ownerId,
                roleId: ownerRoleId,
                roleName: "Owner",
                roleKind: "owner",
                scopeKind: "organization",
                scopeId: null,
                expiresAt: null,
              },
            ],
            professionalIdentities: [],
          },
          {
            membership: {
              id: managerId,
              status: "active",
              positionTitle: "交付经理",
              orgUnitId: unitId,
            },
            user: { displayName: "陈远航" },
            positionTitle: "交付经理",
            unitName: "产品研发",
            isOwner: false,
            accessRoles: [
              {
                membershipId: managerId,
                roleId: managerRoleId,
                roleName: "Manager",
                roleKind: "manager",
                scopeKind: "organization",
                scopeId: null,
                expiresAt: null,
              },
            ],
            professionalIdentities: [],
          },
        ],
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/organization/ownership-transfers", async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      toMembershipId: managerId,
      password: "ChangeMe-OnlyForLocalDev-123!",
    });
    await route.fulfill({
      status: 201,
      json: {
        transfer: {
          id: "00000000-0000-4000-8000-000000000076",
          fromMembershipId: ownerId,
          toMembershipId: managerId,
          status: "pending",
        },
      },
    });
  });
  await page.route(
    `**/api/organization/members/${managerId}/password-reset-link`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        password: "ChangeMe-OnlyForLocalDev-123!",
      });
      await route.fulfill({
        status: 201,
        json: {
          manualLink:
            "https://app.example.test/reset-password#token=manual-reset-test-token",
          expiresAt: "2026-09-03T02:00:00.000Z",
        },
      });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/organization");
  await page.getByRole("tab", { name: /成员/ }).click();
  await page
    .locator(".organization-member-row")
    .filter({ hasText: "陈远航" })
    .click();
  await expect(page.getByText("手工密码重置链接", { exact: true })).toBeVisible();
  await page
    .getByLabel("当前 Owner 密码（二次验证）")
    .fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "生成一次性重置链接" }).click();
  await expect(page.getByText("一次性密码重置链接已生成")).toBeVisible();
  await expect(page.getByLabel("密码重置一次性链接")).toHaveValue(
    "https://app.example.test/reset-password#token=manual-reset-test-token",
  );
  await page.getByRole("button", { name: "关闭成员详情" }).click();
  await page
    .locator(".organization-member-row")
    .filter({ hasText: "林知夏" })
    .click();
  await page.getByLabel("新 Owner（组织级 Manager）").selectOption(managerId);
  await page
    .getByLabel("当前密码（发起转移二次验证）")
    .fill("ChangeMe-OnlyForLocalDev-123!");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "发起双向确认转移" }).click();
});

test("ownership recipient confirms the pending transfer from personal security without member-management access", async ({
  page,
}) => {
  let authenticated = false;
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const managerId = "00000000-0000-4000-8000-000000000074";
  const unitId = "00000000-0000-4000-8000-000000000071";
  const ownerRoleId = "00000000-0000-4000-8000-000000000072";
  const managerRoleId = "00000000-0000-4000-8000-000000000075";
  const transferId = "00000000-0000-4000-8000-000000000076";
  await mockAuthenticatedWorkspace(page);
  await page.route("**/api/auth/login", async (route) => {
    authenticated = true;
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/me", (route) =>
    authenticated
      ? route.fulfill({
          json: {
            user: {
              id: "00000000-0000-4000-8000-000000000073",
              membershipId: managerId,
              organizationId: "00000000-0000-4000-8000-000000000003",
              displayName: "陈远航",
            },
            permissions: [
              {
                permission: "work.view_own",
                scopeKind: "self",
                scopeId: managerId,
              },
            ],
          },
        })
      : route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.route("**/api/auth/mfa/totp", (route) =>
    route.fulfill({ json: { enabled: true, pending: false } }),
  );
  await page.route(
    "**/api/organization/ownership-transfers/pending-for-me",
    (route) =>
      route.fulfill({
        json: {
          transfer: {
            id: transferId,
            fromDisplayName: "林知夏",
            requestedAt: "2026-09-02T01:00:00.000Z",
          },
        },
      }),
  );
  await page.route("**/api/organization", (route) =>
    route.fulfill({
      json: {
        organization: {
          id: "00000000-0000-4000-8000-000000000003",
          name: "顺势而为",
          timezone: "Asia/Shanghai",
        },
        ownerMembershipId: ownerId,
        ownershipTransfer: {
          id: transferId,
          fromMembershipId: ownerId,
          toMembershipId: managerId,
          status: "pending",
          createdAt: "2026-09-02T01:00:00.000Z",
        },
        units: [
          {
            id: unitId,
            parentId: null,
            name: "产品研发",
            description: "负责产品交付",
            leaderMembershipId: ownerId,
            sortOrder: 0,
            version: 1,
          },
        ],
        roles: [
          {
            id: ownerRoleId,
            name: "Owner",
            kind: "owner",
            description: "唯一组织所有者",
            isSystem: true,
          },
          {
            id: managerRoleId,
            name: "Manager",
            kind: "manager",
            description: "组织级管理",
            isSystem: true,
          },
        ],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: ownerId,
              status: "active",
              positionTitle: "组织负责人",
              orgUnitId: unitId,
            },
            user: { displayName: "林知夏" },
            positionTitle: "组织负责人",
            unitName: "产品研发",
            isOwner: true,
            accessRoles: [
              {
                membershipId: ownerId,
                roleId: ownerRoleId,
                roleName: "Owner",
                roleKind: "owner",
                scopeKind: "organization",
                scopeId: null,
                expiresAt: null,
              },
            ],
            professionalIdentities: [],
          },
          {
            membership: {
              id: managerId,
              status: "active",
              positionTitle: "交付经理",
              orgUnitId: unitId,
            },
            user: { displayName: "陈远航" },
            positionTitle: "交付经理",
            unitName: "产品研发",
            isOwner: false,
            accessRoles: [
              {
                membershipId: managerId,
                roleId: managerRoleId,
                roleName: "Manager",
                roleKind: "manager",
                scopeKind: "organization",
                scopeId: null,
                expiresAt: null,
              },
            ],
            professionalIdentities: [],
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/organization/ownership-transfers/${transferId}/confirm`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        password: "ChangeMe-OnlyForLocalDev-123!",
        totpCode: "123456",
      });
      await route.fulfill({
        json: { transfer: { id: transferId, status: "confirmed" } },
      });
    },
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("manager@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "待确认组织所有权转移" }),
  ).toBeVisible();
  await page.goto("/security");
  await expect(
    page.getByRole("heading", { name: "待确认组织所有权转移" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "移动端快速记录工作" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "确认接任 Owner" }),
  ).toBeDisabled();
  await page
    .getByLabel("当前密码（用于二次验证）")
    .fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByLabel("动态验证码（6 位）").fill("123456");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "确认接任 Owner" }).click();
});

test("calendar exposes mini navigation and reserves drag scheduling for drafts", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const sessionStart = new Date();
  sessionStart.setHours(9, 0, 0, 0);
  const sessionEnd = new Date(sessionStart.getTime() + 60 * 60_000);
  const session = {
    id: "00000000-0000-4000-8000-000000000081",
    startAt: sessionStart.toISOString(),
    endAt: sessionEnd.toISOString(),
    netSeconds: 3600,
    content: "可拖拽草稿",
    result: "",
    source: "manual",
    recordKind: "fact",
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    version: 1,
  };
  const plan = {
    ...session,
    id: "00000000-0000-4000-8000-000000000082",
    startAt: new Date(sessionEnd.getTime() + 60 * 60_000).toISOString(),
    endAt: new Date(sessionEnd.getTime() + 2 * 60 * 60_000).toISOString(),
    content: "可拖拽云端计划",
    recordKind: "plan",
  };
  const overnightStart = new Date(sessionStart);
  overnightStart.setDate(overnightStart.getDate() - 1);
  overnightStart.setHours(23, 30, 0, 0);
  const overnight = {
    ...session,
    id: "00000000-0000-4000-8000-000000000083",
    startAt: overnightStart.toISOString(),
    endAt: new Date(overnightStart.getTime() + 90 * 60_000).toISOString(),
    content: "跨午夜工作",
  };
  let sawFactOnlyRead = false;
  let sawCalendarRangeRead = false;
  await page.route("**/api/work-sessions?**", (route) => {
    const query = new URL(route.request().url()).searchParams;
    sawFactOnlyRead ||= query.get("recordKind") === "fact";
    sawCalendarRangeRead ||= Boolean(query.get("from") && query.get("to"));
    return route.fulfill({
      json: { items: [session, plan, overnight], nextCursor: null },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  // The post-login home route issues the fact-only summary read. Wait for it
  // before navigating away so this assertion exercises the real query rather
  // than racing an immediate calendar navigation.
  await expect.poll(() => sawFactOnlyRead).toBe(true);
  await page.goto("/calendar");
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect.poll(() => sawCalendarRangeRead).toBe(true);
  await expect(page.locator(".calendar-mini")).toBeVisible();
  await expect(page.getByText("草稿可改期")).toBeVisible();
  await expect(page.getByText("云端计划", { exact: true })).toBeVisible();
  await expect(
    page
      .getByLabel("工作日历视图")
      .locator(".calendar-event")
      .filter({ hasText: "可拖拽草稿" }),
  ).toHaveAttribute("draggable", "true");
  await expect(
    page
      .getByLabel("工作日历视图")
      .locator(".calendar-event")
      .filter({ hasText: "跨午夜工作" }),
  ).toHaveCount(2);
  await expect(
    page
      .getByLabel("工作日历视图")
      .locator(".calendar-event.is-plan")
      .filter({ hasText: "可拖拽云端计划" }),
  ).toHaveAttribute("draggable", "true");
  await page.getByRole("button", { name: /^云端计划/ }).click();
  await expect(page.getByText("0 条事实", { exact: true })).toBeVisible();
  await expect(page.getByText("1 个计划", { exact: true })).toBeVisible();
});

test("project workbench exposes versioned node editing instead of a visual-only canvas", async ({
  page,
}, testInfo) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/projects/00000000-0000-4000-8000-000000000004");
  await page.getByText("实现项目画布", { exact: true }).first().click();
  await expect(page.getByText("节点详情", { exact: true })).toBeVisible();
  await expect(page.getByLabel("变更说明")).toHaveValue("更新项目节点");
  await expect(
    page.getByRole("button", { name: "保存节点版本" }),
  ).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    // The bottom-sheet inspector covers the backdrop's centre on a handset.
    // Click a real uncovered point in the backdrop rather than forcing the
    // event, so this verifies the same outside-dismiss path a person uses.
    await page
      .getByRole("button", { name: "关闭节点详情" })
      .click({ position: { x: 8, y: 8 } });
  } else {
    await page.keyboard.press("Escape");
  }
  await expect(page.getByText("节点详情", { exact: true })).toHaveCount(0);
});

test("project relation, version history, and recycle recovery use real mutation contracts", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const rootNodeId = "00000000-0000-4000-8000-000000000006";
  const childNodeId = "00000000-0000-4000-8000-000000000007";
  await page.route(`**/api/projects/${projectId}/edges`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toMatchObject({
      sourceNodeId: rootNodeId,
      targetNodeId: childNodeId,
      type: "relates_to",
    });
    await route.fulfill({
      status: 201,
      json: { edge: { id: "00000000-0000-4000-8000-000000000010" } },
    });
  });
  await page.route(
    `**/api/projects/${projectId}/nodes/${rootNodeId}/work-sessions`,
    (route) =>
      route.fulfill({
        json: {
          items: [
            {
              id: "00000000-0000-4000-8000-000000000012",
              membershipId: "00000000-0000-4000-8000-000000000002",
              displayName: "林知夏",
              startAt: "2026-09-02T01:00:00.000Z",
              endAt: "2026-09-02T02:00:00.000Z",
              netSeconds: 3600,
              content: "节点投入追踪",
              source: "manual",
              submissionStatus: "draft",
              approvalStatus: "not_requested",
              isPrimary: true,
            },
          ],
        },
      }),
  );
  await page.route(`**/api/projects/${projectId}/recycle-bin`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000011",
            entityId: childNodeId,
            snapshot: { title: "已删除节点" },
            deletedAt: "2026-09-02T01:00:00.000Z",
            restoreUntil: "2026-10-02T01:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/projects/${projectId}/nodes/${childNodeId}/restore`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      await route.fulfill({ json: { node: { id: childNodeId } } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  const canvas = page.locator(".react-flow");
  await expect(canvas).toBeVisible();
  await canvas.getByText("工作台正式版", { exact: true }).click();
  await expect(page.getByText("关联工作记录", { exact: true })).toBeVisible();
  await expect(page.getByText("节点投入追踪", { exact: true })).toBeVisible();
  await expect(page.getByText("版本历史与回滚", { exact: true })).toBeVisible();
  await expect(page.getByText(/v2 · 工作台正式版/)).toBeVisible();
  await expect(page.getByText(/更新阶段进度.*1 位协作者/)).toBeVisible();
  await page.getByLabel("关系类型").selectOption("relates_to");
  await page.getByLabel("关联到节点").selectOption(childNodeId);
  await page.getByRole("button", { name: "创建节点关联" }).click();
  await page.getByRole("button", { name: "打开项目回收站" }).click();
  await expect(page.getByText("已删除节点", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "恢复" }).click();
});

test("project branch management keeps rename, merge, archive, and recovery actions explicit", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const mainBranchId = "00000000-0000-4000-8000-000000000005";
  const featureBranchId = "00000000-0000-4000-8000-000000000013";
  const experimentBranchId = "00000000-0000-4000-8000-000000000014";
  const archivedBranchId = "00000000-0000-4000-8000-000000000015";
  await page.route(`**/api/projects/${projectId}/tree`, (route) =>
    route.fulfill({
      json: {
        project: {
          id: projectId,
          key: "WIP",
          name: "工作台正式版",
          version: 3,
          color: "#5b5ce2",
        },
        branches: [
          {
            id: mainBranchId,
            name: "主线",
            description: "稳定交付路径",
            isDefault: true,
            version: 2,
            archivedAt: null,
            mergedAt: null,
          },
          {
            id: featureBranchId,
            name: "交付优化",
            description: "验证交付流程",
            isDefault: false,
            version: 1,
            archivedAt: null,
            mergedAt: null,
          },
          {
            id: experimentBranchId,
            name: "实验分支",
            description: null,
            isDefault: false,
            version: 4,
            archivedAt: null,
            mergedAt: null,
          },
          {
            id: archivedBranchId,
            name: "旧验证分支",
            description: "可恢复的独立验证",
            isDefault: false,
            version: 3,
            archivedAt: "2026-09-01T01:00:00.000Z",
            mergedAt: null,
          },
        ],
        nodes: [
          {
            id: "00000000-0000-4000-8000-000000000006",
            branchId: mainBranchId,
            parentId: null,
            type: "phase",
            title: "工作台正式版",
            status: "in_progress",
            progress: "40",
            version: 2,
            sortOrder: 0,
            startAt: null,
            dueAt: null,
          },
        ],
        edges: [],
      },
    }),
  );
  await page.route(
    `**/api/projects/${projectId}/branches/${mainBranchId}`,
    async (route) => {
      expect(route.request().method()).toBe("PATCH");
      expect(route.request().postDataJSON()).toEqual({
        expectedVersion: 2,
        name: "稳定主线",
        description: "稳定交付路径",
        changeSummary: "更新分支信息",
      });
      await route.fulfill({ json: { branch: { id: mainBranchId } } });
    },
  );
  await page.route(
    `**/api/projects/${projectId}/branches/${featureBranchId}/merge`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({
        expectedVersion: 1,
        targetBranchId: mainBranchId,
      });
      await route.fulfill({
        json: {
          result: {
            branch: { id: featureBranchId },
            copiedNodeCount: 2,
            copiedEdgeCount: 1,
          },
        },
      });
    },
  );
  await page.route(
    `**/api/projects/${projectId}/branches/${experimentBranchId}/archive`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ expectedVersion: 4 });
      await route.fulfill({ json: { branch: { id: experimentBranchId } } });
    },
  );
  await page.route(
    `**/api/projects/${projectId}/branches/${archivedBranchId}/restore`,
    async (route) => {
      expect(route.request().method()).toBe("POST");
      expect(route.request().postDataJSON()).toEqual({ expectedVersion: 3 });
      await route.fulfill({ json: { branch: { id: archivedBranchId } } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "管理项目分支" }).click();
  await expect(page.getByText("分支生命周期", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "编辑分支 主线" }).click();
  await page.getByLabel("分支名称").fill("稳定主线");
  await page.getByRole("button", { name: "保存分支" }).click();
  await page.getByRole("button", { name: "合并分支 交付优化" }).click();
  await page.getByLabel("合并到活跃分支").selectOption(mainBranchId);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "确认合并" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "归档分支 实验分支" }).click();
  await page.getByRole("button", { name: "恢复分支 旧验证分支" }).click();
});

test("project progress modes and node assignees use versioned server-side contracts", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const branchId = "00000000-0000-4000-8000-000000000005";
  const rootNodeId = "00000000-0000-4000-8000-000000000006";
  const memberId = "00000000-0000-4000-8000-000000000020";
  await page.route(`**/api/projects/${projectId}/tree`, (route) =>
    route.fulfill({
      json: {
        project: {
          id: projectId,
          key: "WIP",
          name: "工作台正式版",
          color: "#5b5ce2",
        },
        branches: [{ id: branchId, name: "主线", isDefault: true }],
        nodes: [
          {
            id: rootNodeId,
            branchId,
            parentId: null,
            type: "phase",
            title: "工作台正式版",
            status: "in_progress",
            progress: "65.00",
            progressMode: "weighted_children",
            weight: "1.00",
            version: 2,
            sortOrder: 0,
            startAt: null,
            dueAt: null,
          },
          {
            id: "00000000-0000-4000-8000-000000000007",
            branchId,
            parentId: rootNodeId,
            type: "task",
            title: "实现项目画布",
            status: "in_progress",
            progress: "65.00",
            progressMode: "manual",
            weight: "2.00",
            version: 1,
            sortOrder: 0,
            startAt: null,
            dueAt: null,
          },
        ],
        nodeAssignees: [
          {
            nodeId: rootNodeId,
            membershipId: "00000000-0000-4000-8000-000000000002",
            isResponsible: true,
            assignedAt: "2026-09-02T01:00:00.000Z",
            displayName: "林知夏",
            avatarUrl: null,
          },
        ],
        edges: [],
      },
    }),
  );
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            membershipId: "00000000-0000-4000-8000-000000000002",
            role: "lead",
            publicActivityVisible: true,
            joinedAt: "2026-09-01T01:00:00.000Z",
            displayName: "林知夏",
            avatarUrl: null,
          },
          {
            membershipId: memberId,
            role: "member",
            publicActivityVisible: true,
            joinedAt: "2026-09-01T01:00:00.000Z",
            displayName: "陈一",
            avatarUrl: null,
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/projects/${projectId}/nodes/${rootNodeId}/assignees`,
    async (route) => {
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataJSON()).toEqual({
        expectedVersion: 2,
        assignments: [
          {
            membershipId: "00000000-0000-4000-8000-000000000002",
            isResponsible: false,
          },
          { membershipId: memberId, isResponsible: true },
        ],
      });
      await route.fulfill({ json: { node: { id: rootNodeId, version: 3 } } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  const canvas = page.locator(".react-flow");
  await expect(canvas).toBeVisible();
  await canvas.getByText("工作台正式版", { exact: true }).click();
  await expect(page.getByText("协作者与负责人", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("spinbutton", { name: /进度 自动模式只读/ }),
  ).toBeDisabled();
  await expect(
    page.getByRole("combobox", { name: /进度计算/ }),
  ).toHaveValue("weighted_children");
  await page.getByRole("checkbox", { name: /陈一/ }).check();
  await page.getByRole("radio", { name: "指定 陈一 为节点负责人" }).check();
  await page.getByRole("button", { name: "保存负责人分配" }).click();
});

test("project team membership keeps collaboration roles separate from organization identities", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const candidateId = "00000000-0000-4000-8000-000000000021";
  await page.route(`**/api/projects/${projectId}/members`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            membershipId: "00000000-0000-4000-8000-000000000002",
            role: "lead",
            publicActivityVisible: true,
            joinedAt: "2026-09-01T01:00:00.000Z",
            displayName: "林知夏",
            avatarUrl: null,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/projects/${projectId}/member-candidates`, (route) =>
    route.fulfill({
      json: {
        items: [
          {
            membershipId: "00000000-0000-4000-8000-000000000002",
            displayName: "林知夏",
            avatarUrl: null,
          },
          {
            membershipId: candidateId,
            displayName: "顾衡",
            avatarUrl: null,
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/projects/${projectId}/members/${candidateId}`,
    async (route) => {
      expect(route.request().method()).toBe("PUT");
      expect(route.request().postDataJSON()).toEqual({
        role: "member",
        publicActivityVisible: true,
      });
      await route.fulfill({ json: { member: { membershipId: candidateId } } });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  await page.getByRole("button", { name: "团队成员" }).click();
  await expect(page.locator(".project-team-panel")).toBeVisible();
  await expect(
    page.getByText("不等同于组织访问权限、组织岗位或专业身份"),
  ).toBeVisible();
  await page.getByLabel("加入组织成员").selectOption(candidateId);
  await page.getByRole("button", { name: "加入项目" }).click();
});

test("project node schedule edits persist through the same versioned mutation", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const nodeId = "00000000-0000-4000-8000-000000000006";
  await page.route(`**/api/projects/${projectId}/nodes/${nodeId}`, async (route) => {
    expect(route.request().method()).toBe("PATCH");
    expect(route.request().postDataJSON()).toMatchObject({
      expectedVersion: 2,
      startAt: "2026-09-03T01:00:00.000Z",
      dueAt: "2026-09-06T09:00:00.000Z",
      changeSummary: "更新项目节点",
    });
    await route.fulfill({ json: { node: { id: nodeId, version: 3 } } });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  await page
    .locator(".react-flow")
    .getByText("工作台正式版", { exact: true })
    .click();
  await page.getByLabel("开始时间").fill("2026-09-03T09:00");
  await page.getByLabel("截止时间").fill("2026-09-06T17:00");
  await page.getByRole("button", { name: "保存节点版本" }).click();
});
