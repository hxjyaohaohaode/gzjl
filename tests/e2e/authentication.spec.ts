import { expect, test, type Page } from "@playwright/test";

async function mockAuthenticatedWorkspace(
  page: Page,
  options: {
    isOwner?: boolean;
    canExport?: boolean;
    canViewPayroll?: boolean;
    canConfigurePayroll?: boolean;
    canAnalyzeTeam?: boolean;
  } = {},
): Promise<void> {
  let authenticated = false;
  await page.routeWebSocket("**/api/realtime", (socket) => {
    socket.send(JSON.stringify({ type: "realtime.ready" }));
  });
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
              ...((options.canViewPayroll ?? true)
                ? [
                    {
                      permission: "payroll.view_own",
                      scopeKind: "self",
                      scopeId: "00000000-0000-4000-8000-000000000002",
                    },
                  ]
                : []),
              ...((options.canConfigurePayroll ?? options.isOwner ?? true)
                ? [
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
                  ]
                : []),
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
              ...(options.canExport
                ? [
                    {
                      permission: "export.scope",
                      scopeKind: "organization",
                      scopeId: null,
                    },
                  ]
                : []),
              ...(options.canAnalyzeTeam
                ? [
                    {
                      permission: "ai.team_analysis",
                      scopeKind: "organization",
                      scopeId: null,
                    },
                  ]
                : []),
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
  await page.route("**/api/team-activity?**", (route) =>
    route.fulfill({
      json: { scope: "shared_projects", members: [], items: [] },
    }),
  );
  await page.route("**/api/ai/reports", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: { items: [] } })
      : route.fulfill({
          status: 503,
          json: { error: "unexpected_ai_write", message: "Unexpected AI write" },
        }),
  );
  await page.route("**/api/search?**", (route) => {
    const query = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({
      json: {
        items:
          query === "实现"
            ? [
                {
                  id: "00000000-0000-4000-8000-000000000007",
                  kind: "project_node",
                  title: "实现项目画布",
                  subtitle: "工作台正式版",
                  href: "/projects/00000000-0000-4000-8000-000000000004?node=00000000-0000-4000-8000-000000000007",
                  occurredAt: "2026-09-02T01:00:00.000Z",
                },
              ]
            : [],
      },
    });
  });
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
        range: {
          from: "2026-08-05T00:00:00.000Z",
          to: "2026-09-04T00:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
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
        byMember: [
          {
            membershipId: "00000000-0000-4000-8000-000000000002",
            displayName: "林知夏",
            seconds: 19_800,
          },
        ],
        byProject: [
          {
            projectId: "00000000-0000-4000-8000-000000000004",
            projectName: "工作台正式版",
            projectStatus: "active",
            dueAt: "2026-10-01T00:00:00.000Z",
            seconds: 19_800,
          },
        ],
        byWorkType: [
          { workTypeId: null, workTypeName: "未分类", seconds: 19_800 },
        ],
        byOrgUnit: [
          {
            orgUnitId: "00000000-0000-4000-8000-000000000020",
            orgUnitName: "产品研发",
            seconds: 19_800,
          },
        ],
        bySource: [{ source: "timer", seconds: 19_800, count: 2 }],
        byApproval: [
          { status: "approved", seconds: 14_400, count: 1 },
          { status: "pending_review", seconds: 5_400, count: 1 },
        ],
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          seconds: hour === 9 ? 19_800 : 0,
            count: hour === 9 ? 2 : 0,
          })),
        projectWorkTypes: [
          {
            projectId: "00000000-0000-4000-8000-000000000004",
            projectName: "工作台正式版",
            workTypeId: null,
            workTypeName: "未分类",
            seconds: 19_800,
          },
        ],
        flow: {
          nodes: [
            { id: "project:00000000-0000-4000-8000-000000000004", label: "工作台正式版", kind: "project" },
            { id: "work_type:unassigned", label: "未分类", kind: "work_type" },
            { id: "approval:approved", label: "approved", kind: "approval" },
          ],
          links: [
            { source: "project:00000000-0000-4000-8000-000000000004", target: "work_type:unassigned", seconds: 19_800 },
            { source: "work_type:unassigned", target: "approval:approved", seconds: 19_800 },
          ],
        },
        anomalies: [
          { category: "gross_duration_over_16_hours", count: 1, seconds: 19_800 },
        ],
        projectHealth: [
          {
            projectId: "00000000-0000-4000-8000-000000000004",
            projectName: "工作台正式版",
            status: "active",
            dueAt: "2026-10-01T00:00:00.000Z",
            seconds: 19_800,
            progress: 62.5,
            blockedNodes: 1,
            totalNodes: 4,
          },
        ],
        forecast: {
          observed: [
            { date: "2026-08-31", seconds: 3_600 },
            { date: "2026-09-01", seconds: 7_200 },
            { date: "2026-09-02", seconds: 12_600 },
          ],
          predicted: [
            { date: "2026-09-03", seconds: 9_000, lowerSeconds: 6_000, upperSeconds: 12_000, confidence: "medium" },
            { date: "2026-09-04", seconds: 9_300, lowerSeconds: 6_300, upperSeconds: 12_300, confidence: "medium" },
          ],
          model: {
            method: "adaptive_weekday_backtest_v3",
            sampleDays: 30,
            nonZeroSampleDays: 18,
            horizonDays: 7,
            validationPoints: 14,
            validationWape: 0.18,
            intervalCoverage: 0.86,
            seasonalityStrength: 0.62,
            trendPerDay: 180,
          },
        },
        availableFilters: {
          members: [{ id: "00000000-0000-4000-8000-000000000002", label: "林知夏" }],
          projects: [{ id: "00000000-0000-4000-8000-000000000004", label: "工作台正式版" }],
          workTypes: [],
          orgUnits: [{ id: "00000000-0000-4000-8000-000000000020", label: "产品研发" }],
          approvalStates: ["approved", "pending_review"],
          sourceTypes: ["timer"],
        },
        funnel: [
          { stage: "已记录", count: 2 },
          { stage: "已提交", count: 2 },
          { stage: "已批准", count: 1 },
          { stage: "可计薪", count: 1 },
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
  await expect(page.getByText("本周已记录工时", { exact: true })).toBeVisible();
  await expect(page.getByText("5 小时 30 分", { exact: true })).toBeVisible();
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
  await page.route("**/api/auth/invitations/inspect", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ token });
    await route.fulfill({
      json: {
        valid: true,
        serverTime: "2026-09-04T05:00:00.000Z",
        expiresAt: "2026-09-11T05:00:00.000Z",
        displayName: "受邀员工",
      },
    });
  });
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
  await expect(page.getByText(/邀请有效，将激活“受邀员工”/)).toBeVisible();
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
            isOwner: false,
            plan: null,
          },
        ],
        periods: [],
        runs: [],
        latestItems: [],
        liveItems: [
          {
            membershipId: memberId,
            displayName: "陈远航",
            preview: {
              period: {
                startsAt: "2026-09-01T00:00:00.000Z",
                endsAt: "2026-10-01T00:00:00.000Z",
                cutoffAt: "2026-10-15T10:00:00.000Z",
              },
              currency: "CNY",
              planType: "hourly",
              baseAmount: "88.500000",
              approvedSeconds: 14_400,
              pendingSeconds: 3_600,
              weeklyBonusSeconds: 18_000,
              weeklyBonusEstimatedSeconds: 0,
              estimatedAmount: "442.500000",
              includesPending: true,
              needsReview: false,
            },
          },
        ],
        settings: { timezone: "Asia/Shanghai", payrollCutoffDay: 15 },
      },
    }),
  );
  let settingsPayload: Record<string, unknown> | null = null;
  await page.route("**/api/payroll/settings", async (route) => {
    settingsPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({ json: { settings: settingsPayload } });
  });
  let planPayload: Record<string, unknown> | null = null;
  await page.route(`**/api/payroll/members/${memberId}/plan`, async (route) => {
    planPayload = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      json: {
        result: {
          version: { effectiveFrom: String(planPayload.effectiveFrom) },
        },
      },
    });
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
    page.getByRole("heading", { name: "薪资管理" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "团队成员薪资对比" })).toBeVisible();
  await page
    .getByRole("combobox", { name: "成员", exact: true })
    .selectOption(memberId);
  await page.getByLabel("计薪类型").selectOption("hourly");
  await page.getByLabel("基础时薪").fill("88.50");
  await page.getByText("周末倍率", { exact: true }).click();
  await page.getByLabel("启用周超时奖励").check();
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
    {
      type: "weekly_bonus",
      priority: 400,
      thresholdSeconds: 108_000,
      rewardSeconds: 18_000,
    },
  ]);

  await expect(page.getByLabel("预计发薪日（每月）")).toHaveValue("15");
  await expect(page.getByLabel("预计发薪时间", { exact: true })).toHaveValue("18:00");
  await page.getByLabel("预计发薪时间", { exact: true }).fill("09:30");
  await page.getByRole("button", { name: "保存预计发薪时间" }).click();
  await expect.poll(() => settingsPayload).toEqual({
    payrollCutoffDay: 15,
    payrollCutoffMinute: 570,
  });
  await page.getByRole("button", { name: "创建薪资周期" }).click();
  await expect.poll(() => periodPayload).not.toBeNull();
  expect(periodPayload).toMatchObject({ timezone: "Asia/Shanghai" });
  expect(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      day: "2-digit",
    }).format(new Date(String(periodPayload?.cutoffAt))),
  ).toBe("15");
  expect(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(String(periodPayload?.cutoffAt))),
  ).toBe("09:30");
});

test("Owner can undo an unexported calculation and remove an accidental period", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  let cancelled = false;
  let deleted = false;
  await page.route("**/api/payroll/management", (route) =>
    route.fulfill({
      json: {
        members: [],
        periods: deleted
          ? []
          : [{
              id: "period-undo",
              name: "2026 年 9 月",
              status: cancelled ? "open" : "pending_confirmation",
              startsAt: "2026-09-01T00:00:00.000Z",
              endsAt: "2026-10-01T00:00:00.000Z",
              cutoffAt: "2026-10-10T10:00:00.000Z",
            }],
        runs: cancelled
          ? []
          : [{
              run: {
                id: "run-undo",
                runNumber: 1,
                status: "ready",
                createdAt: "2026-09-04T10:00:00.000Z",
              },
              period: { id: "period-undo", name: "2026 年 9 月" },
            }],
        latestItems: [],
        liveItems: [],
        settings: {
          timezone: "Asia/Shanghai",
          payrollCutoffDay: 10,
          payrollCutoffMinute: 1_080,
        },
      },
    }),
  );
  await page.route("**/api/payroll-runs/run-undo/cancel-calculation", async (route) => {
    cancelled = true;
    await route.fulfill({ json: { run: { id: "run-undo", status: "cancelled" } } });
  });
  await page.route("**/api/payroll/periods/period-undo", async (route) => {
    deleted = true;
    await route.fulfill({ json: { result: { id: "period-undo", deleted: true } } });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/payroll");
  await expect(page.getByText("尚未导出、尚未锁定；只有点击“确认导出并锁定”后才会生效。")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销本次计算" }).click();
  await expect(page.getByRole("button", { name: "撤销误建周期" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "撤销误建周期" }).click();
  await expect(page.getByText("2026 年 9 月", { exact: true })).toHaveCount(0);
  expect(cancelled).toBe(true);
  expect(deleted).toBe(true);
});

test("personal payroll renders reconciled totals, daily pay, period trend, and components", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { isOwner: false });
  await page.route("**/api/payroll/management", (route) =>
    route.fulfill({ json: { members: [], periods: [], runs: [] } }),
  );
  let acknowledgedPayslip = false;
  await page.route("**/api/payroll/payslips/payslip-1/acknowledge", async (route) => {
    acknowledgedPayslip = true;
    await route.fulfill({
      json: { payslip: { id: "payslip-1", acknowledgedAt: new Date().toISOString() } },
    });
  });
  await page.route("**/api/payroll/me", (route) =>
    route.fulfill({
      json: {
        currentPlan: {
          plan: { name: "标准时薪", type: "hourly", currency: "CNY" },
          version: {
            type: "hourly",
            baseAmount: "100.000000",
            effectiveFrom: "2026-01-01T00:00:00.000Z",
          },
        },
        livePreview: {
          period: {
            startsAt: "2026-09-01T00:00:00.000Z",
            endsAt: "2026-10-01T00:00:00.000Z",
            cutoffAt: "2026-10-10T10:00:00.000Z",
          },
          currency: "CNY",
          planType: "hourly",
          baseAmount: "100.000000",
          approvedSeconds: 28_800,
          pendingSeconds: 3_600,
          weeklyBonusSeconds: 0,
          weeklyBonusEstimatedSeconds: 18_000,
          projectedWeeklyBonusSeconds: 18_000,
          weeklyBonusRule: {
            thresholdSeconds: 108_000,
            rewardSeconds: 18_000,
          },
          estimatedAmount: "1400.000000",
          projectedPeriodAmount: "3600.000000",
          projection: {
            method: "adaptive_weekday_backtest_v3",
            sampleDays: 4,
            nonZeroSampleDays: 2,
            horizonDays: 26,
            includesKnownFutureRecords: false,
            validationPoints: 0,
            validationWape: null,
            intervalCoverage: null,
            seasonalityStrength: 0,
            trendPerDay: 0,
          },
          calculationBreakdown: {
            confirmedWorkAmount: "800.000000",
            pendingWorkAmount: "100.000000",
            confirmedBonusAmount: "0.000000",
            estimatedBonusAmount: "500.000000",
          },
          currentWeek: {
            weekStartDate: "2026-08-31",
            startsOn: "2026-09-01",
            endsOn: "2026-09-06",
            approvedSeconds: 28_800,
            pendingSeconds: 3_600,
            totalSeconds: 32_400,
            weeklyBonusSeconds: 0,
            weeklyBonusEstimatedSeconds: 18_000,
          },
          weeklyBreakdown: [{
            weekStartDate: "2026-08-31",
            startsOn: "2026-09-01",
            endsOn: "2026-09-06",
            approvedSeconds: 28_800,
            pendingSeconds: 3_600,
            weeklyBonusSeconds: 0,
            weeklyBonusEstimatedSeconds: 18_000,
          }],
          salaryTimeline: [
            {
              date: "2026-09-03",
              approvedAmount: "400.000000",
              pendingAmount: "0.000000",
              totalAmount: "400.000000",
              approvedSeconds: 14_400,
              pendingSeconds: 0,
              workedSeconds: 14_400,
              bonusSeconds: 0,
              weeklyBonusSeconds: 0,
              weeklyBonusEstimatedSeconds: 0,
              projectedBonusSeconds: 0,
              projectedDailyAmount: "400.000000",
              actualCumulativeAmount: "400.000000",
              projectedCumulativeAmount: "400.000000",
              projectedLowerCumulativeAmount: "400.000000",
              projectedUpperCumulativeAmount: "400.000000",
              forecastConfidence: null,
              forecastSource: "actual",
              forecast: false,
            },
            {
              date: "2026-09-04",
              approvedAmount: "400.000000",
              pendingAmount: "600.000000",
              totalAmount: "1000.000000",
              approvedSeconds: 14_400,
              pendingSeconds: 3_600,
              workedSeconds: 18_000,
              bonusSeconds: 18_000,
              weeklyBonusSeconds: 0,
              weeklyBonusEstimatedSeconds: 18_000,
              projectedBonusSeconds: 0,
              projectedDailyAmount: "1000.000000",
              actualCumulativeAmount: "1400.000000",
              projectedCumulativeAmount: "1400.000000",
              projectedLowerCumulativeAmount: "1400.000000",
              projectedUpperCumulativeAmount: "1400.000000",
              forecastConfidence: null,
              forecastSource: "actual",
              forecast: false,
            },
            {
              date: "2026-09-05",
              approvedAmount: "0.000000",
              pendingAmount: "0.000000",
              totalAmount: "0.000000",
              approvedSeconds: 0,
              pendingSeconds: 0,
              workedSeconds: 0,
              bonusSeconds: 0,
              weeklyBonusSeconds: 0,
              weeklyBonusEstimatedSeconds: 0,
              projectedBonusSeconds: 0,
              projectedDailyAmount: "150.000000",
              actualCumulativeAmount: null,
              projectedCumulativeAmount: "1550.000000",
              projectedLowerCumulativeAmount: "1480.000000",
              projectedUpperCumulativeAmount: "1650.000000",
              forecastConfidence: "low",
              forecastSource: "calendar_model",
              forecast: true,
            },
          ],
          includesPending: true,
          needsReview: false,
        },
        summary: [
          {
            currency: "CNY",
            settledAmount: "4000.000000",
            pendingAmount: "900.000000",
            totalAmount: "4900.000000",
          },
        ],
        items: [
          {
            item: {
              id: "payroll-item-1",
              currency: "CNY",
              approvedSeconds: 28_800,
              pendingSeconds: 3_600,
              grossAmount: "880.000000",
              adjustmentAmount: "20.000000",
              finalAmount: "900.000000",
              estimate: true,
              needsReview: false,
            },
            run: {
              id: "run-1",
              runNumber: 2,
              status: "settled",
              calculationVersion: "payroll-engine-v2-daily-trace",
            },
            period: {
              name: "2026 年 9 月",
              startsAt: "2026-09-01T00:00:00.000Z",
              endsAt: "2026-10-01T00:00:00.000Z",
              status: "locked",
            },
            payslip: {
              id: "payslip-1",
              issuedAt: "2026-10-10T10:00:00.000Z",
              acknowledgedAt: null,
            },
            dailyBreakdown: [
              { date: "2026-09-03", amount: "400.000000", estimatedAmount: "0.000000" },
              { date: "2026-09-04", amount: "500.000000", estimatedAmount: "100.000000" },
            ],
            components: [
              {
                id: "component-1",
                type: "base",
                label: "基础工时",
                quantity: "28800.000000",
                unit: "second",
                rate: "100.000000",
                multiplier: "1.000000",
                amount: "880.000000",
              },
              {
                id: "component-2",
                type: "allowance",
                label: "补贴",
                quantity: null,
                unit: null,
                rate: null,
                multiplier: null,
                amount: "20.000000",
              },
            ],
          },
        ],
      },
    }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/payroll");
  await expect(page.getByRole("heading", { name: "我的薪资" })).toBeVisible();
  await expect(page.getByText("¥100.00 / 小时", { exact: true })).toBeVisible();
  await expect(page.getByText("本月实时预估", { exact: true })).toBeVisible();
  await expect(page.getByText(/本周已记录工时 · 9月1日—9月6日（月界截断）/)).toBeVisible();
  await expect(page.getByText("周奖励工时（含预估）", { exact: true })).toBeVisible();
  await expect(page.getByText(/待审核预估 5 小时 0 分/)).toBeVisible();
  await expect(page.getByText("本月实时预估怎样计算", { exact: true })).toBeVisible();
  await expect(page.getByText(/¥800.00 已批准工作计薪/)).toBeVisible();
  await expect(page.getByText("每周工时", { exact: true })).toBeVisible();
  await expect(page.getByText("每日工时", { exact: true })).toBeVisible();
  await expect(page.getByRole("img", { name: "本月每日薪资与周奖励" })).toBeVisible();
  await expect(page.getByRole("img", { name: "本月薪资累计与未来预测" })).toBeVisible();
  await expect(page.getByText("当前应结")).toBeVisible();
  await expect(page.getByText("¥900.00", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("img", { name: "2026 年 9 月每日薪资" })).toBeVisible();
  await expect(page.getByRole("img", { name: "周期薪资趋势" })).toBeVisible();
  await expect(page.getByRole("img", { name: "2026 年 9 月薪资构成瀑布图" })).toBeVisible();
  await expect(page.getByText("基础工时", { exact: true })).toBeVisible();
  await expect(page.getByText("补贴", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "确认已收到薪资" }).click();
  await expect.poll(() => acknowledgedPayslip).toBe(true);
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
  let quietHoursUpdate: unknown;
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
  await page.route("**/api/push/configuration", (route) =>
    route.fulfill({
      json: { available: false, publicKey: null, activeSubscriptions: [] },
    }),
  );
  await page.route(
    "**/api/notification-preferences/quiet-hours",
    async (route) => {
      quietHoursUpdate = route.request().postDataJSON();
      await route.fulfill({
        json: {
          quietHours: {
            start: "22:00",
            end: "07:00",
            timeZone: "Asia/Shanghai",
          },
          categoryCount: 15,
        },
      });
    },
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/notification-preferences");
  await expect(page.getByRole("heading", { name: "通知设置" })).toBeVisible();
  await expect(page.getByText("服务端尚未配置 VAPID")).toBeVisible();
  await page
    .getByText("长时间计时")
    .locator("xpath=../..")
    .getByRole("button", { name: "站内 已开" })
    .click();
  await page.getByRole("button", { name: "应用到全部分类" }).click();
  await expect.poll(() => quietHoursUpdate).toEqual({
    quietHours: {
      start: "22:00",
      end: "07:00",
      timeZone: "Asia/Shanghai",
    },
  });
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

test("mobile sidebar stays usable after a desktop collapse preference", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("mobile"),
    "mobile-only assertion",
  );
  await page.addInitScript(() => {
    localStorage.setItem("workbench-sidebar-collapsed", "true");
    localStorage.setItem("workbench-sidebar-width", "420");
  });
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.getByRole("button", { name: "打开导航" }).click();
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  await expect(sidebar).toBeVisible();
  await expect(sidebar.getByText("数据分析", { exact: true })).toBeVisible();
  const box = await sidebar.boundingBox();
  expect(box?.width).toBeLessThanOrEqual(420);
  expect(box?.width).toBeLessThanOrEqual(390);
  await sidebar.getByRole("button", { name: "关闭导航" }).click();
  await expect(sidebar).toHaveClass(/-translate-x-full/);
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

test("one manual submission persists multiple completed work segments atomically", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const evidenceReferences: Array<{
    pathname: string;
    body: { kind: string; textContent: string; visibility: string };
  }> = [];
  let batchPayload: {
    entries: Array<{
      recordKind: string;
      input: { content: string; result: string; startAt: string; endAt: string };
    }>;
  } | null = null;
  await page.route("**/api/evidence/capabilities", (route) =>
    route.fulfill({
      json: {
        fileUploads: { available: false, maxBytes: 104_857_600 },
        references: { url: true, text: true },
      },
    }),
  );
  await page.route("**/api/work-entries/batch", async (route) => {
    batchPayload = route.request().postDataJSON() as typeof batchPayload;
    await route.fulfill({
      status: 201,
      json: {
        sessions: batchPayload!.entries.map((entry, index) => ({
          id: `batch-session-${index + 1}`,
          ...entry.input,
          recordKind: entry.recordKind,
          timezone: "Asia/Shanghai",
          netSeconds: 3_600,
          source: "manual",
          submissionStatus: "draft",
          approvalStatus: "not_requested",
          visibility: entry.recordKind === "plan" ? "private" : "management_only",
          version: 1,
          breaks: [],
          projectLinks: [],
        })),
      },
    });
  });
  await page.route("**/api/work-sessions/*/attachments/reference", async (route) => {
    evidenceReferences.push({
      pathname: new URL(route.request().url()).pathname,
      body: route.request().postDataJSON() as {
        kind: string;
        textContent: string;
        visibility: string;
      },
    });
    await route.fulfill({
      status: 201,
      json: { attachment: { id: `batch-evidence-${evidenceReferences.length}` } },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByRole("button", { name: "手工录入" }).click();
  await page.getByLabel("开始时间").fill("2026-09-03T08:00");
  await page.getByLabel("结束时间").fill("2026-09-03T12:00");
  await page.getByLabel("工作内容").fill("上午交付工作");
  await page.getByLabel("工作结果").fill("上午部分已完成");
  await page.getByLabel("本段文字证据").fill("上午交付清单与验收记录");
  await page.getByRole("button", { name: "添加一段" }).click();
  await page.getByLabel("开始", { exact: true }).fill("2026-09-03T13:00");
  await page.getByLabel("结束", { exact: true }).fill("2026-09-03T14:00");
  await page.getByLabel("本段工作内容").fill("下午联调工作");
  await page.getByLabel("本段结果（可选）").fill("联调通过");
  await page.getByLabel("本段文字证据").nth(1).fill("下午联调日志与通过结论");
  await page.getByRole("button", { name: "保存真实工时草稿" }).click();

  await expect.poll(() => batchPayload?.entries.length ?? 0).toBe(2);
  expect(batchPayload!.entries).toMatchObject([
    {
      recordKind: "fact",
      input: { content: "上午交付工作", result: "上午部分已完成" },
    },
    {
      recordKind: "fact",
      input: { content: "下午联调工作", result: "联调通过" },
    },
  ]);
  await expect.poll(() => evidenceReferences.length).toBe(2);
  expect(evidenceReferences).toEqual([
    {
      pathname: "/api/work-sessions/batch-session-1/attachments/reference",
      body: {
        kind: "text",
        textContent: "上午交付清单与验收记录",
        visibility: "management_only",
      },
    },
    {
      pathname: "/api/work-sessions/batch-session-2/attachments/reference",
      body: {
        kind: "text",
        textContent: "下午联调日志与通过结论",
        visibility: "management_only",
      },
    },
  ]);
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
  const evidencePicker = page.getByLabel("选择工作证据文件");
  await expect(evidencePicker).toHaveAttribute("accept", "*/*");
  await evidencePicker.setInputFiles([
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
    {
      name: "验收报告.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7 test evidence"),
    },
    {
      name: "现场说明.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("plain text evidence"),
    },
    {
      name: "完整材料.zip",
      mimeType: "application/zip",
      buffer: Buffer.from("PK test archive evidence"),
    },
  ]);
  await expect(page.getByText("现场采集.tracebundle", { exact: true })).toBeVisible();
  await expect(page.getByText("专项记录.acmeproof", { exact: true })).toBeVisible();
  await expect(page.getByText("验收报告.pdf", { exact: true })).toBeVisible();
  await expect(page.getByText("现场说明.txt", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("完整材料.zip", { exact: true })).toBeVisible();
  await expect(page.getByTitle("待上传 PDF：验收报告.pdf")).toBeVisible();
  await expect(page.getByText("plain text evidence", { exact: true })).toBeVisible();
  await expect(
    page.getByText(/浏览器不适合直接展示此格式/).first(),
  ).toBeVisible();
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
  await expect.poll(() => completedAttachmentIds.length).toBe(5);
  expect(uploadIntents).toHaveLength(5);
  expect(uploadIntents[0]).toMatchObject({
    originalName: "现场采集.tracebundle",
    mimeType: "application/octet-stream",
  });
  expect(uploadIntents[1]).toMatchObject({
    originalName: "专项记录.acmeproof",
    mimeType: "application/x-acme-work-proof",
  });
  expect(uploadIntents.slice(2).map((item) => [item.originalName, item.mimeType])).toEqual([
    ["验收报告.pdf", "application/pdf"],
    ["现场说明.txt", "text/plain"],
    ["完整材料.zip", "application/zip"],
  ]);
  await expect(
    page.getByText(/现场采集\.tracebundle.*已完成/),
  ).toBeVisible();
  await expect(
    page.getByText(/专项记录\.acmeproof.*已完成/),
  ).toBeVisible();
});

test("the uploader can inspect rich file details and use direct preview or download links", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  const sessionId = "00000000-0000-4000-8000-000000000089";
  const attachmentId = "00000000-0000-4000-8000-000000000090";
  const startedAt = new Date();
  startedAt.setHours(8, 0, 0, 0);
  await page.route("**/api/work-sessions?**", (route) => route.fulfill({ json: {
    items: [{
      id: sessionId,
      startAt: startedAt.toISOString(),
      endAt: new Date(startedAt.getTime() + 3_600_000).toISOString(),
      timezone: "Asia/Shanghai",
      netSeconds: 3_600,
      content: "附件详情验收",
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
    }],
    nextCursor: null,
  } }));
  await page.route("**/api/evidence/capabilities", (route) => route.fulfill({ json: {
    fileUploads: { available: true, maxBytes: 100 * 1024 * 1024, acceptsArbitraryFormats: true },
    references: { url: true, text: true },
  } }));
  await page.route(`**/api/work-sessions/${sessionId}/attachments`, (route) => route.fulfill({ json: {
    items: [{
      id: attachmentId,
      kind: "file",
      status: "available",
      originalName: "现场说明.txt",
      externalUrl: null,
      mimeType: "text/plain",
      sizeBytes: 1_024,
      visibility: "management_only",
      note: "由提交人核对",
      sha256: "b".repeat(64),
      version: 3,
      uploadedAt: startedAt.toISOString(),
      createdAt: startedAt.toISOString(),
      updatedAt: new Date(startedAt.getTime() + 60_000).toISOString(),
    }],
  } }));

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/work");
  await page.getByRole("button", { name: "证据" }).click();
  await expect(page.getByText("现场说明.txt", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "预览" })).toHaveAttribute("href", `/api/attachments/${attachmentId}/open?mode=preview`);
  await expect(page.getByRole("link", { name: "下载" })).toHaveAttribute("href", `/api/attachments/${attachmentId}/open?mode=download`);
  await expect(page.getByTitle("附件内容：现场说明.txt")).toBeVisible();
  await page.getByText("查看内容详情", { exact: true }).click();
  await expect(page.getByText("由提交人核对", { exact: true })).toBeVisible();
  await expect(page.getByText("b".repeat(64), { exact: true })).toBeVisible();
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
}, testInfo) => {
  await mockAuthenticatedWorkspace(page);
  const analyticsUrls: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/analytics/summary?")) analyticsUrls.push(request.url());
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/analytics");
  await expect(
    page.getByRole("img", { name: "每日净工时趋势图" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "下载每日净工时趋势图图片" }),
  ).toBeVisible();
  const chartToolSize = await page
    .getByRole("button", { name: "下载每日净工时趋势图图片" })
    .evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
  expect(chartToolSize.width).toBeLessThanOrEqual(32);
  expect(chartToolSize.height).toBeLessThanOrEqual(32);
  if (testInfo.project.name.startsWith("mobile")) {
    const chartSpacing = await page
      .getByRole("img", { name: "每日净工时趋势图" })
      .evaluate((canvas) => {
        const frame = canvas.closest(".analytics-chart-frame");
        const tools = frame?.querySelector(".analytics-chart-tools");
        if (!frame || !tools) return null;
        const canvasBox = canvas.getBoundingClientRect();
        const toolBox = tools.getBoundingClientRect();
        return {
          canvasTop: canvasBox.top,
          toolsBottom: toolBox.bottom,
          frameWidth: frame.getBoundingClientRect().width,
          canvasWidth: canvasBox.width,
        };
      });
    expect(chartSpacing).not.toBeNull();
    expect(chartSpacing!.toolsBottom).toBeLessThanOrEqual(
      chartSpacing!.canvasTop,
    );
    expect(chartSpacing!.canvasWidth).toBeLessThanOrEqual(
      chartSpacing!.frameWidth + 1,
    );
  }
  await expect(
    page.getByRole("button", { name: "全屏查看每日净工时趋势图" }),
  ).toBeVisible();
  await expect(page.getByRole("img", { name: "项目投入分布图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "事实与未来工时预测带" })).toBeVisible();
  await page.getByLabel("预测范围").selectOption("14");
  await expect(page.getByRole("heading", { name: "事实与未来 14 天预测" })).toBeVisible();
  await expect.poll(() => analyticsUrls.some((url) =>
    new URL(url).searchParams.get("forecastDays") === "14",
  )).toBe(true);
  await expect(page.getByRole("img", { name: "项目工作类型与审核流向桑基图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "项目与工作类型旭日图" })).toBeVisible();
  await expect(page.getByRole("img", { name: "项目工时与加权进度图" })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "阻塞节点" })).toBeVisible();
  if (testInfo.project.name.startsWith("mobile")) {
    await page.getByRole("button", { name: /^筛选/ }).click();
  }
  await page.getByLabel("筛选项目").selectOption("00000000-0000-4000-8000-000000000004");
  await page.getByLabel("筛选审核状态").selectOption("approved");
  await expect.poll(() => analyticsUrls.some((url) => {
    const params = new URL(url).searchParams;
    return params.get("projectIds") === "00000000-0000-4000-8000-000000000004"
      && params.get("approvalStates") === "approved";
  })).toBe(true);
  const requestCountBeforeClear = analyticsUrls.length;
  await page.getByRole("button", { name: "清除筛选 · 2" }).click();
  await expect.poll(() => analyticsUrls.slice(requestCountBeforeClear).some((url) => {
    const params = new URL(url).searchParams;
    return !params.has("projectIds") && !params.has("approvalStates");
  })).toBe(true);
  await expect(page.getByRole("button", { name: "工作台正式版", exact: true })).toBeVisible();
});

test("authorized analytics users can create, cancel, retry, and download background exports", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { canExport: true });
  const exportId = "00000000-0000-4000-8000-000000000091";
  let status: "queued" | "failed" | "cancelled" | "completed" = "queued";
  let hasJob = false;
  let createPayload: Record<string, unknown> | null = null;
  let cancelRequests = 0;
  let retryRequests = 0;
  let downloadAuthorizations = 0;
  const job = () => ({
    id: exportId,
    exportType: "work_sessions",
    format: "xlsx",
    status,
    progress: status === "completed" ? 100 : 0,
    attempt: status === "failed" ? 3 : 0,
    maxAttempts: 3,
    fileName: status === "completed" ? "work-sessions.xlsx" : null,
    contentType:
      status === "completed"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : null,
    byteSize: status === "completed" ? 4_096 : null,
    rowCount: status === "completed" ? 2 : null,
    sha256: status === "completed" ? "a".repeat(64) : null,
    errorCode: status === "failed" ? "export_upload_failed" : null,
    createdAt: "2026-09-04T06:00:00.000Z",
    startedAt: null,
    completedAt: status === "completed" ? "2026-09-04T06:01:00.000Z" : null,
    expiresAt: status === "completed" ? "2099-09-05T06:01:00.000Z" : null,
    downloadReady: status === "completed",
  });
  await page.route("**/api/exports**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const method = route.request().method();
    if (pathname === "/api/exports/capabilities") {
      await route.fulfill({
        json: {
          available: true,
          formats: ["csv", "json", "xlsx", "pdf"],
          retentionHours: 24,
        },
      });
      return;
    }
    if (pathname === `/api/exports/${exportId}/download`) {
      downloadAuthorizations += 1;
      await route.fulfill({
        json: {
          url: "/test-export-download",
          expiresInSeconds: 300,
          fileName: "work-sessions.xlsx",
          sha256: "a".repeat(64),
        },
      });
      return;
    }
    if (pathname === `/api/exports/${exportId}/retry`) {
      retryRequests += 1;
      status = "queued";
      await route.fulfill({ json: job() });
      return;
    }
    if (pathname === `/api/exports/${exportId}` && method === "DELETE") {
      cancelRequests += 1;
      status = "cancelled";
      await route.fulfill({ json: job() });
      return;
    }
    if (pathname === "/api/exports" && method === "POST") {
      createPayload = route.request().postDataJSON() as Record<string, unknown>;
      hasJob = true;
      status = "queued";
      await route.fulfill({ status: 202, json: job() });
      return;
    }
    if (pathname === "/api/exports" && method === "GET") {
      await route.fulfill({ json: { items: hasJob ? [job()] : [] } });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "unexpected_export_route" } });
  });
  await page.route("**/test-export-download", (route) =>
    route.fulfill({
      body: "xlsx-test-body",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      headers: { "content-disposition": 'attachment; filename="work-sessions.xlsx"' },
    }),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "后台导出" })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "创建导出" }).click();
  await expect.poll(() => createPayload).not.toBeNull();
  expect(createPayload).toMatchObject({ exportType: "work_sessions", format: "xlsx" });
  await expect(page.getByText("等待处理", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "取消", exact: true }).click();
  await expect.poll(() => cancelRequests).toBe(1);
  await expect(page.getByText("已取消", { exact: true })).toBeVisible();

  status = "failed";
  await page.reload();
  await expect(page.getByText("文件上传失败，可以重试。")).toBeVisible();
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await expect.poll(() => retryRequests).toBe(1);

  status = "completed";
  await page.reload();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载", exact: true }).click();
  await expect.poll(() => downloadAuthorizations).toBe(1);
  expect((await download).suggestedFilename()).toBe("work-sessions.xlsx");
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
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");
  await expect(page.getByRole("combobox")).toHaveValue("self");
  await expect(page.getByRole("option", { name: "团队范围" })).toHaveCount(
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
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");
  await expect(
    page.getByRole("button", { name: "组织 AI 配置" }),
  ).toHaveCount(0);
});

test("Owner can verify the saved AI provider and review a redacted health record", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  let checkRequest: Record<string, unknown> | null = null;
  let checkRows: Array<Record<string, unknown>> = [];
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route("**/api/ai/settings", (route) =>
    route.fulfill({
      json: {
        source: "organization",
        enabled: true,
        baseUrl: "https://provider.example/v1",
        model: "safe-model",
        hasApiKey: true,
        encryptionReady: true,
        usable: true,
        dailyRequestLimit: 20,
        monthlyRequestLimit: 300,
        maxOutputTokens: 1_200,
        usage: { daily: 1, monthly: 4, timezone: "Asia/Shanghai" },
      },
    }),
  );
  await page.route("**/api/ai/settings/checks", (route) =>
    route.fulfill({ json: { items: checkRows } }),
  );
  await page.route("**/api/ai/settings/check", async (route) => {
    checkRequest = route.request().postDataJSON() as Record<string, unknown>;
    checkRows = [
      {
        id: "00000000-0000-4000-8000-000000000088",
        source: "organization",
        endpointHost: "provider.example",
        model: "safe-model",
        status: "succeeded",
        latencyMs: 218,
        httpStatus: 200,
        errorSummary: null,
        providerRequestId: "request-redacted",
        checkedAt: "2026-09-04T02:00:00.000Z",
      },
    ];
    await route.fulfill({ json: { check: checkRows[0] } });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  await page.getByRole("button", { name: "组织 AI 配置" }).click();
  await page.getByLabel("当前 Owner 密码").fill("Current-owner-password-123!");
  await page.getByRole("button", { name: "测试已保存配置" }).click();

  await expect.poll(() => checkRequest).not.toBeNull();
  expect(checkRequest).toEqual({ password: "Current-owner-password-123!" });
  await expect(page.getByText("连接成功", { exact: true })).toBeVisible();
  await expect(page.getByText(/provider\.example · safe-model/)).toBeVisible();
  await expect(page.getByText(/218 ms/)).toBeVisible();
});

test("AI report requests keep a stable five-minute range for cost-safe deduplication", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { canAnalyzeTeam: true });
  const requests: Array<{ taskType: string; scope: string; from: string; to: string }> = [];
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    expect(route.request().method()).toBe("POST");
    requests.push(
      route.request().postDataJSON() as {
        taskType: string;
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
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");
  const generate = page.getByRole("button", {
    name: "生成所选洞察",
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
  expect(request.taskType).toBe("weekly_summary");
  expect(to.getUTCSeconds()).toBe(0);
  expect(to.getUTCMilliseconds()).toBe(0);
  expect(to.getUTCMinutes() % 5).toBe(0);
  expect(to.getTime() - from.getTime()).toBe(7 * 86_400_000);

  await expect(page.getByRole("button", { name: /运营执行简报/ })).toBeVisible();
  await page.getByRole("button", { name: /老板决策简报/ }).click();
  await generate.click();
  await expect.poll(() => requests.length).toBe(3);
  expect(requests[2]).toMatchObject({ taskType: "executive_brief", scope: "team" });
  expect(new Date(requests[2]!.to).getTime() - new Date(requests[2]!.from).getTime()).toBe(31 * 86_400_000);
});

test("AI salary explanation is explicitly self-scoped and uses a bounded payroll range", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  let request: {
    taskType: string;
    scope: string;
    from: string;
    to: string;
  } | null = null;
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    request = route.request().postDataJSON() as typeof request;
    await route.fulfill({
      status: 202,
      json: { job: { id: "salary-job", status: "queued" } },
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");
  await page.getByRole("button", { name: "解释我的薪资", exact: true }).click();
  await page.getByRole("button", { name: "生成所选洞察", exact: true }).click();

  await expect.poll(() => request).not.toBeNull();
  expect(request).toMatchObject({
    taskType: "salary_explanation",
    scope: "self",
  });
  expect(
    new Date(String(request?.to)).getTime() - new Date(String(request?.from)).getTime(),
  ).toBe(93 * 86_400_000);
});

test("AI salary explanation is hidden when the account cannot view its own payroll", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { canViewPayroll: false });
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({ json: { items: [] } }),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("member@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");

  await expect(
    page.getByRole("button", { name: "解释我的薪资", exact: true }),
  ).toHaveCount(0);
});

test("AI salary report exposes its authorized payroll provenance without exposing raw identifiers", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const jobId = "00000000-0000-4000-8000-000000000091";
  const reportId = "00000000-0000-4000-8000-000000000092";
  const reportRecord = {
    job: {
      id: jobId,
      taskType: "salary_explanation",
      status: "completed",
      errorSummary: null,
      queuedAt: "2026-09-04T01:00:00.000Z",
      scope: { scope: "self", from: "2026-06-03T00:00:00.000Z", to: "2026-09-04T00:00:00.000Z" },
    },
    report: {
      id: reportId,
      title: "2026 年 9 月本人薪资解释",
      summary: "本期最终金额为 CNY 1280.000000，当前仍为预估状态。",
      structuredOutput: {
        highlights: ["基础计薪分项为 CNY 1200.000000。"],
        risks: ["仍有 3600 秒待审核工时。"],
        suggestions: ["先核对待审工时，再确认最终工资。"],
      },
      sourceCount: 2,
      generatedAt: "2026-09-04T01:01:00.000Z",
    },
  };
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({ json: { items: [reportRecord] } }),
  );
  await page.route(`**/api/ai/reports/${reportId}`, (route) =>
    route.fulfill({
      json: {
        ...reportRecord,
        sources: [
          {
            id: "00000000-0000-4000-8000-000000000093",
            entityType: "payroll_item",
            entityId: "00000000-0000-4000-8000-000000000094",
            entityVersion: null,
            label: "工资事实 · 2026 年 9 月",
          },
          {
            id: "00000000-0000-4000-8000-000000000095",
            entityType: "pay_period",
            entityId: "00000000-0000-4000-8000-000000000096",
            entityVersion: null,
            label: "薪资周期 · 2026 年 9 月",
          },
        ],
      },
    }),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");

  await expect(page.getByRole("heading", { name: "2026 年 9 月本人薪资解释" })).toBeVisible();
  await expect(page.getByText("工资事实 · 2026 年 9 月", { exact: true })).toBeVisible();
  await expect(page.getByText("薪资周期 · 2026 年 9 月", { exact: true })).toBeVisible();
  await expect(page.getByText("工资事实", { exact: true })).toBeVisible();
  await expect(page.getByText("待确认项", { exact: true })).toBeVisible();
  await expect(page.getByText("核对建议", { exact: true })).toBeVisible();
  await expect(page.getByText("00000000-0000-4000-8000-000000000094")).toHaveCount(0);
});

test("AI workspace sends a persistent fact-scoped conversation turn", async ({ page }) => {
  await mockAuthenticatedWorkspace(page);
  let request: Record<string, unknown> | null = null;
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    request = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      json: { job: { id: "chat-job", status: "queued" } },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/ai");
  await page.getByLabel("向 AI 提问").fill("当前有哪些项目受阻？");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => request).not.toBeNull();
  expect(request).toMatchObject({
    taskType: "assistant_chat",
    scope: "self",
    question: "当前有哪些项目受阻？",
    conversationId: "primary",
  });
  expect(
    new Date(String(request?.to)).getTime() - new Date(String(request?.from)).getTime(),
  ).toBe(31 * 86_400_000);
});

test("AI background jobs can be cancelled and deliberately retried without changing core facts", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  let status: "queued" | "cancelled" = "queued";
  let cancelRequests = 0;
  let retryRequests = 0;
  const jobId = "00000000-0000-4000-8000-000000000099";
  await page.route("**/api/ai/reports", (route) =>
    route.fulfill({
      json: {
        items: [
          {
            job: {
              id: jobId,
              taskType: "weekly_summary",
              status,
              errorSummary: null,
              queuedAt: "2026-09-04T01:00:00.000Z",
              scope: { scope: "self" },
            },
            report: null,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/ai/jobs/${jobId}/cancel`, async (route) => {
    cancelRequests += 1;
    status = "cancelled";
    await route.fulfill({ json: { job: { id: jobId, status } } });
  });
  await page.route(`**/api/ai/jobs/${jobId}/retry`, async (route) => {
    retryRequests += 1;
    status = "queued";
    await route.fulfill({ status: 202, json: { job: { id: jobId, status } } });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/ai");
  await page.getByRole("button", { name: "取消任务" }).click();
  await expect.poll(() => cancelRequests).toBe(1);
  await expect(page.getByRole("heading", { name: "任务已取消" })).toBeVisible();
  await page.getByRole("button", { name: "重新生成", exact: true }).click();
  await expect.poll(() => retryRequests).toBe(1);
  await expect(page.getByRole("heading", { name: "正在整理事实" })).toBeVisible();
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

test("many long work updates never force the mobile workspace into desktop width", async ({
  page,
}, testInfo) => {
  test.skip(
    !testInfo.project.name.startsWith("mobile"),
    "mobile-only dynamic-content containment coverage",
  );
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const nodeId = "00000000-0000-4000-8000-000000000006";
  const longContent = `移动端进度-${"LONG_UNBROKEN_TOKEN_".repeat(24)}`;
  const workItems = Array.from({ length: 14 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
    startAt: `2026-09-03T${String(8 + (index % 8)).padStart(2, "0")}:00:00.000Z`,
    endAt: `2026-09-03T${String(9 + (index % 8)).padStart(2, "0")}:00:00.000Z`,
    activityAt: `2026-09-03T${String(9 + (index % 8)).padStart(2, "0")}:00:00.000Z`,
    timezone: "Asia/Shanghai",
    netSeconds: 3_600,
    content: `${longContent}-${index}`,
    result: "已完成",
    blockers: "",
    nextStep: "",
    parallelWork: false,
    primaryProjectNodeId: nodeId,
    projectLinks: [],
    source: "manual",
    recordKind: "fact",
    submissionStatus: "draft",
    approvalStatus: "not_requested",
    visibility: "management_only",
    version: 1,
    breaks: [],
    displayName: "林知夏",
    hasFullTiming: true,
    isPrimary: true,
  }));
  await page.route("**/api/work-sessions?**", (route) =>
    route.fulfill({ json: { items: workItems, nextCursor: null } }),
  );
  await page.route(
    `**/api/projects/${projectId}/nodes/${nodeId}/work-sessions`,
    (route) => route.fulfill({ json: { items: workItems } }),
  );
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();

  for (const route of ["/work", `/projects/${projectId}`]) {
    await page.goto(route);
    if (route.startsWith("/projects/")) {
      await page
        .locator(".react-flow")
        .getByText("工作台正式版", { exact: true })
        .click();
      await expect(page.getByText("关联工作记录", { exact: true })).toBeVisible();
    }
    const dimensions = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      mainWidth: document.querySelector(".app-main")?.getBoundingClientRect().width ?? 0,
    }));
    expect(dimensions.documentWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
    expect(dimensions.mainWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1);
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
  await expect(page.getByText("完成 0 · 受阻 0", { exact: true })).toBeVisible();
  await expect(
    page.locator('.react-flow__node[aria-label*="个直接子节点"]').first(),
  ).toBeVisible();
  const nodeTitleFontSize = await page
    .locator(".project-flow-node-title")
    .first()
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).fontSize));
  expect(nodeTitleFontSize).toBeGreaterThanOrEqual(13);
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
  await page.getByLabel("搜索工作台").fill("日历");
  await page.getByRole("button", { name: "日历 工作空间" }).click();
  await expect(page.getByRole("heading", { name: "工作日历" })).toBeVisible();
});

test("global search returns only server-authorized business entities", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.keyboard.press("Control+K");
  await page.getByLabel("搜索工作台").fill("实现");
  const result = page.getByRole("button", {
    name: /节点 实现项目画布 工作台正式版/,
  });
  await expect(result).toBeVisible();
  await result.click();
  await expect(
    page.getByRole("complementary", { name: "实现项目画布 节点详情" }),
  ).toBeVisible();
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

test("page Copilot sends a real page-scoped AI conversation on desktop and mobile", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  let request: Record<string, unknown> | null = null;
  await page.route("**/api/ai/reports", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    request = route.request().postDataJSON() as Record<string, unknown>;
    await route.fulfill({
      status: 202,
      json: { job: { id: "page-copilot-job", status: "queued" } },
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/analytics");

  const open = page.getByRole("button", { name: "打开 AI 上下文" });
  await expect(open).toBeVisible();
  await open.click();
  await expect(
    page.getByRole("dialog", { name: "AI 上下文面板" }),
  ).toContainText("数据分析");
  await page
    .getByRole("textbox", { name: "向页面 AI 提问" })
    .fill("解释当前时间范围的关键变化");
  await page.getByRole("button", { name: "发送", exact: true }).click();

  await expect.poll(() => request).not.toBeNull();
  expect(request).toMatchObject({
    taskType: "assistant_chat",
    scope: "self",
    conversationId: "page_analytics",
    pageContext: { area: "analytics" },
  });

  request = null;
  await page
    .getByRole("button", { name: "在 AI 工作洞察中继续" })
    .click();
  await expect(page).toHaveURL(/\/ai\?.*conversation=page_analytics/);
  await page.getByRole("textbox", { name: "向 AI 提问" }).fill("继续解释异常来源");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect.poll(() => request).not.toBeNull();
  expect(request).toMatchObject({
    taskType: "assistant_chat",
    conversationId: "page_analytics",
    pageContext: { area: "analytics" },
  });
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

test("owner can see invitation activation state and withdraw a pending member", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const ownerId = "00000000-0000-4000-8000-000000000002";
  const invitedId = "00000000-0000-4000-8000-000000000075";
  let removed = false;
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
        units: [],
        roles: [],
        professionalIdentities: [],
        members: [
          {
            membership: {
              id: ownerId,
              status: "active",
              positionTitle: "负责人",
              orgUnitId: null,
              joinedAt: "2026-09-01T01:00:00.000Z",
              leftAt: null,
            },
            user: { displayName: "林知夏" },
            positionTitle: "负责人",
            unitName: null,
            isOwner: true,
            activity: {
              onlineNow: true,
              activeSessionCount: 2,
              lastSeenAt: "2026-09-04T05:00:00.000Z",
            },
            accessRoles: [],
            professionalIdentities: [],
          },
          ...(!removed
            ? [
                {
                  membership: {
                    id: invitedId,
                    status: "invited",
                    positionTitle: null,
                    orgUnitId: null,
                    joinedAt: null,
                    leftAt: null,
                  },
                  user: { displayName: "待加入成员" },
                  positionTitle: null,
                  unitName: null,
                  isOwner: false,
                  activity: {
                    onlineNow: false,
                    activeSessionCount: 0,
                    lastSeenAt: null,
                  },
                  accessRoles: [],
                  professionalIdentities: [],
                },
              ]
            : []),
        ],
      },
    }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(
    `**/api/organization/invitations/${invitedId}`,
    async (route) => {
      expect(route.request().method()).toBe("DELETE");
      removed = true;
      await route.fulfill({ status: 204, body: "" });
    },
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/organization");
  await page.getByRole("tab", { name: /成员/ }).click();
  await expect(page.getByText("当前在线 · 2 个活跃端")).toBeVisible();
  await page
    .locator(".organization-member-row")
    .filter({ hasText: "待加入成员" })
    .click();
  await expect(
    page
      .getByLabel("待加入成员 的成员详情")
      .getByText("尚未接受邀请", { exact: true }),
  ).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", {
      name: "撤销 待加入成员 的邀请并释放白名单联系方式",
    })
    .click();
  await expect(
    page.locator(".organization-member-row").filter({ hasText: "待加入成员" }),
  ).toHaveCount(0);
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
        parentBranchId: null,
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
  await expect(page.getByText("工作线生命周期", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "编辑分支 主线" }).click();
  await page.getByLabel("分支名称").fill("稳定主线");
  await page.getByRole("button", { name: "保存分支" }).click();
  await page.getByRole("button", { name: "合并工作线 交付优化" }).click();
  await page.getByLabel("合并到活跃分支").selectOption(mainBranchId);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "确认合并" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除工作线 实验分支" }).click();
  await page.getByRole("button", { name: "恢复分支 旧验证分支" }).click();
});

test("a selected project node can derive a connected work line with an entry node", async ({
  page,
}, testInfo) => {
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  const mainBranchId = "00000000-0000-4000-8000-000000000005";
  const sourceNodeId = "00000000-0000-4000-8000-000000000006";
  let submitted = false;
  await page.route(`**/api/projects/${projectId}/branches`, async (route) => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({
      name: "移动端并行验收",
      parentBranchId: mainBranchId,
      sourceNodeId,
    });
    submitted = true;
    await route.fulfill({
      status: 201,
      json: {
        branch: {
          id: "00000000-0000-4000-8000-000000000099",
          name: "移动端并行验收",
          parentBranchId: mainBranchId,
          sourceNodeId,
        },
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto(`/projects/${projectId}`);
  await expect(
    page.getByRole("button", { name: "从当前节点派生并行工作线" }),
  ).toBeDisabled();
  await page
    .locator(".react-flow")
    .getByText("工作台正式版", { exact: true })
    .click();
  if (testInfo.project.name.startsWith("mobile")) {
    await page
      .getByRole("button", { name: "从 工作台正式版 派生工作线" })
      .click();
  } else {
    await page
      .getByRole("button", { name: "从当前节点派生并行工作线" })
      .click();
  }
  await page
    .getByPlaceholder("从“工作台正式版”派生并行工作线")
    .fill("移动端并行验收");
  await page.getByRole("button", { name: "创建并生成入口节点" }).click();
  await expect.poll(() => submitted).toBe(true);
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

test("employees see shared-project last work activity without coworkers' duration", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page, { isOwner: false });
  const activityAt = "2026-09-04T05:00:00.000Z";
  const sessionId = "00000000-0000-4000-8000-000000000091";
  let evidenceFetched = false;
  await page.route("**/api/team-activity?**", (route) =>
    route.fulfill({
      json: {
        scope: "shared_projects",
        members: [
          {
            membershipId: "00000000-0000-4000-8000-000000000090",
            displayName: "陈一",
            avatarUrl: null,
            positionTitle: "产品经理",
            projectNames: ["工作台正式版"],
            professionalIdentities: ["产品设计"],
            lastActivity: {
              id: sessionId,
              membershipId: "00000000-0000-4000-8000-000000000090",
              displayName: "陈一",
              content: "完成移动端流程核对",
              result: "已提交验收",
              projectName: "工作台正式版",
              activityAt,
              hasFullTiming: false,
              startAt: null,
              endAt: null,
              netSeconds: null,
            },
          },
        ],
        items: [
          {
            id: sessionId,
            membershipId: "00000000-0000-4000-8000-000000000090",
            displayName: "陈一",
            content: "完成移动端流程核对",
            result: "已提交验收",
            projectName: "工作台正式版",
            activityAt,
            hasFullTiming: false,
            startAt: null,
            endAt: null,
            netSeconds: null,
          },
        ],
      },
    }),
  );
  await page.route(`**/api/work-sessions/${sessionId}/attachments`, async (route) => {
    evidenceFetched = true;
    await route.fulfill({
      json: {
        items: [
          {
            id: "00000000-0000-4000-8000-000000000092",
            kind: "text",
            status: "available",
            originalName: null,
            externalUrl: null,
            textContent: "完整验收证据：移动端、平板端与桌面端均已逐项核对。",
            mimeType: null,
            sizeBytes: null,
            visibility: "project_visible",
            note: "验收记录",
            sha256: null,
            version: 1,
            uploadedAt: activityAt,
            updatedAt: activityAt,
          },
        ],
      },
    });
  });
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("employee@example.test");
  await page.getByLabel("密码").fill("Employee-Secure-Password-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto("/team");

  await expect(page.getByText("产品经理 · 产品设计")).toBeVisible();
  await expect(page.getByText("完成移动端流程核对")).toBeVisible();
  await expect(page.getByText(/最后工作.*09.*04.*13:00/).first()).toBeVisible();
  await expect(page.getByText(/2\s*小时/)).toHaveCount(0);
  await page.getByRole("button", { name: /陈一.*完成移动端流程核对/ }).click();
  await expect.poll(() => evidenceFetched).toBe(true);
  await expect(page.getByText("完整验收证据：移动端、平板端与桌面端均已逐项核对。", { exact: true })).toBeVisible();
});

test("approvers can inspect full work details and authorized evidence before deciding", async ({
  page,
}) => {
  await mockAuthenticatedWorkspace(page);
  const sessionId = "00000000-0000-4000-8000-000000000095";
  await page.route("**/api/approvals?**", (route) =>
    route.fulfill({
      json: {
        items: [{
          request: {
            id: "00000000-0000-4000-8000-000000000096",
            priority: "normal",
            requestedAt: "2026-09-04T06:00:00.000Z",
            anomalyFlags: [],
          },
          session: {
            id: sessionId,
            content: "提交客户研究报告",
            result: "已形成最终版",
            startAt: "2026-09-04T01:00:00.000Z",
            endAt: "2026-09-04T05:00:00.000Z",
            netSeconds: 14_400,
            version: 3,
          },
          requesterOrgUnitId: null,
        }],
      },
    }),
  );
  await page.route("**/api/work-session-corrections/pending?**", (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(`**/api/work-sessions/${sessionId}/attachments`, (route) =>
    route.fulfill({
      json: {
        items: [{
          id: "00000000-0000-4000-8000-000000000097",
          kind: "url",
          status: "available",
          originalName: null,
          externalUrl: "https://example.test/research/final",
          mimeType: null,
          sizeBytes: null,
          visibility: "management_only",
          note: "最终交付地址",
          sha256: null,
          version: 1,
          uploadedAt: "2026-09-04T05:01:00.000Z",
          updatedAt: "2026-09-04T05:01:00.000Z",
        }, {
          id: "00000000-0000-4000-8000-000000000098",
          kind: "file",
          status: "available",
          originalName: "客户研究报告.pdf",
          externalUrl: null,
          mimeType: "application/pdf",
          sizeBytes: 245_760,
          visibility: "management_only",
          note: "最终 PDF 交付件",
          sha256: "a".repeat(64),
          version: 2,
          uploadedAt: "2026-09-04T05:02:00.000Z",
          createdAt: "2026-09-04T05:01:00.000Z",
          updatedAt: "2026-09-04T05:02:00.000Z",
        }],
      },
    }),
  );

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await page.goto("/approvals");
  await page.getByRole("button", { name: "查看工作与附件" }).click();
  await expect(page.getByText("已形成最终版", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "https://example.test/research/final" })).toBeVisible();
  await expect(page.getByText("客户研究报告.pdf", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "预览" })).toHaveAttribute(
    "href",
    `/api/attachments/00000000-0000-4000-8000-000000000098/open?mode=preview`,
  );
  await expect(page.getByRole("link", { name: "下载" })).toHaveAttribute(
    "href",
    `/api/attachments/00000000-0000-4000-8000-000000000098/open?mode=download`,
  );
  await expect(page.getByTitle("附件内容：客户研究报告.pdf")).toBeVisible();
  await expect(page.getByRole("button", { name: "批准" })).toBeVisible();
});

test("account switching never reuses another member's analytics cache", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name.startsWith("mobile"), "desktop account-switch coverage");
  await mockAuthenticatedWorkspace(page);
  let activeAccount: "first" | "second" | null = null;
  await page.route("**/api/auth/login", async (route) => {
    const identifier = String(route.request().postDataJSON()?.identifier ?? "");
    activeAccount = identifier.startsWith("second") ? "second" : "first";
    await route.fulfill({ json: { ok: true } });
  });
  await page.route("**/api/auth/logout", async (route) => {
    activeAccount = null;
    await route.fulfill({ status: 204, body: "" });
  });
  await page.route("**/api/me", (route) => {
    if (!activeAccount) {
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    }
    const second = activeAccount === "second";
    return route.fulfill({
      json: {
        user: {
          id: second
            ? "00000000-0000-4000-8000-000000000102"
            : "00000000-0000-4000-8000-000000000101",
          membershipId: second
            ? "00000000-0000-4000-8000-000000000112"
            : "00000000-0000-4000-8000-000000000111",
          organizationId: "00000000-0000-4000-8000-000000000003",
          displayName: second ? "第二位成员" : "第一位成员",
          isOwner: false,
        },
        permissions: [
          {
            permission: "work.view_own",
            scopeKind: "self",
            scopeId: second
              ? "00000000-0000-4000-8000-000000000112"
              : "00000000-0000-4000-8000-000000000111",
          },
        ],
      },
    });
  });
  await page.route("**/api/analytics/summary?**", async (route) => {
    const second = activeAccount === "second";
    if (second) await new Promise((resolve) => setTimeout(resolve, 450));
    const count = second ? 0 : 7;
    await route.fulfill({
      json: {
        range: {
          from: "2026-08-05T00:00:00.000Z",
          to: "2026-09-04T00:00:00.000Z",
          timezone: "Asia/Shanghai",
        },
        totals: {
          sessionCount: count,
          totalSeconds: count * 3_600,
          approvedSeconds: 0,
          pendingSeconds: 0,
        },
        appliedFilters: {},
        availableFilters: {
          members: [],
          projects: [],
          workTypes: [],
          orgUnits: [],
          approvalStates: [],
          sourceTypes: [],
        },
        byDay: [],
        byMember: [],
        byProject: [],
        byWorkType: [],
        byOrgUnit: [],
        bySource: [],
        byApproval: [],
        byHour: Array.from({ length: 24 }, (_, hour) => ({
          hour,
          seconds: 0,
          count: 0,
        })),
        projectWorkTypes: [],
        flow: { nodes: [], links: [] },
        anomalies: [],
        projectHealth: [],
        forecast: {
          observed: [],
          predicted: [],
          model: {
            method: "adaptive_weekday_backtest_v3",
            sampleDays: 0,
            nonZeroSampleDays: 0,
            horizonDays: 0,
            validationPoints: 0,
            validationWape: null,
            intervalCoverage: null,
            seasonalityStrength: 0,
            trendPerDay: 0,
          },
        },
        funnel: [
          { stage: "已记录", count },
          { stage: "已提交", count: 0 },
          { stage: "已批准", count: 0 },
          { stage: "可计薪", count: 0 },
        ],
      },
    });
  });

  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("first@example.test");
  await page.getByLabel("密码").fill("First-Secure-Password-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第一位成员，今天好" })).toBeVisible();
  await page.goto("/analytics");
  await expect(page.getByText("7 条", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByLabel("邮箱或手机号").fill("second@example.test");
  await page.getByLabel("密码").fill("Second-Secure-Password-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "第二位成员，今天好" })).toBeVisible();
  await page.goto("/analytics");
  await expect(page.getByText("7 条", { exact: true })).toHaveCount(0);
  await expect(page.getByText("0 条", { exact: true })).toBeVisible();
});

test("mobile project canvas enters a true viewport-sized mode with list fallback", async ({
  page,
}, testInfo) => {
  test.skip(!testInfo.project.name.startsWith("mobile"), "mobile-only PWA workspace coverage");
  await mockAuthenticatedWorkspace(page);
  const projectId = "00000000-0000-4000-8000-000000000004";
  await page.goto("/login");
  await page.getByLabel("邮箱或手机号").fill("owner@example.test");
  await page.getByLabel("密码").fill("ChangeMe-OnlyForLocalDev-123!");
  await page.getByRole("button", { name: "登录", exact: true }).click();
  await expect(page.getByRole("heading", { name: "林知夏，今天好" })).toBeVisible();
  await page.goto(`/projects/${projectId}`);

  await page.getByRole("button", { name: "进入项目全屏" }).click();
  const workbench = page.locator(".project-workbench.is-mobile-fullscreen");
  await expect(workbench).toBeVisible();
  const box = await workbench.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.width - viewport!.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(box!.height - viewport!.height)).toBeLessThanOrEqual(1);
  await page.getByRole("button", { name: "列表", exact: true }).click();
  await expect(page.locator(".project-workbench-tree-list")).toBeVisible();
  await page.getByRole("button", { name: "退出项目全屏" }).click();
  await expect(workbench).toHaveCount(0);
});
