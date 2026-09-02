import "dotenv/config";

import { argon2id, hash } from "argon2";
import { permissions as permissionCodes } from "@workbench/shared";

import { createDatabase } from "./client.js";
import {
  accessRoles,
  aiJobs,
  aiReportSources,
  aiReports,
  approvalActions,
  approvalRequests,
  compensationPlans,
  compensationPlanVersions,
  memberIdentities,
  memberRoles,
  notifications,
  organizationOwners,
  organizations,
  orgMemberships,
  orgUnits,
  payPeriods,
  permissionDefinitions,
  professionalIdentities,
  projectBranches,
  projectEdges,
  projectMembers,
  projectNodeAssignees,
  projectNodes,
  projects,
  rateRules,
  reminderRules,
  rolePermissions,
  userCredentials,
  users,
  workBreaks,
  workSessionProjectLinks,
  workSessions,
  workTypes,
} from "./schema/index.js";

if (process.env.NODE_ENV === "production") {
  throw new Error("Development seed is disabled in production");
}

function seedId(group: number, index: number): string {
  return `00000000-0000-4000-${group.toString(16).padStart(4, "0")}-${index
    .toString(16)
    .padStart(12, "0")}`;
}

const organizationId = seedId(0x8001, 1);
const ownerRoleId = seedId(0x8002, 1);
const managerRoleId = seedId(0x8002, 2);
const memberRoleId = seedId(0x8002, 3);

const memberDefinitions = [
  ["林知夏", "owner", "owner@example.test", "产品与组织负责人"],
  ["周明远", "manager", "manager.project@example.test", "项目负责人"],
  ["顾清禾", "manager", "manager.ops@example.test", "运营负责人"],
  ["陈序", "member", "chen.xu@example.test", "后端开发"],
  ["沈言", "member", "shen.yan@example.test", "前端开发"],
  ["苏禾", "member", "su.he@example.test", "产品设计"],
  ["江屿", "member", "jiang.yu@example.test", "测试工程师"],
  ["许澄", "member", "xu.cheng@example.test", "数据工程师"],
  ["陆遥", "member", "lu.yao@example.test", "Agent 开发"],
  ["唐宁", "member", "tang.ning@example.test", "知识库开发"],
  ["宋时", "member", "song.shi@example.test", "运营"],
  ["温岚", "member", "wen.lan@example.test", "客户成功"],
  ["叶川", "member", "ye.chuan@example.test", "移动端开发"],
  ["白榆", "member", "bai.yu@example.test", "安全工程师"],
  ["贺景", "member", "he.jing@example.test", "财务运营"],
  ["孟舟", "member", "meng.zhou@example.test", "自动化测试"],
  ["乔安", "member", "qiao.an@example.test", "内容运营"],
  ["韩川", "member", "han.chuan@example.test", "全栈开发"],
] as const;

const unitDefinitions = [
  ["产品与研发", null],
  ["产品设计", 0],
  ["研发工程", 0],
  ["质量保障", 0],
  ["数据与智能", 0],
  ["运营与交付", null],
  ["客户成功", 5],
  ["财务运营", 5],
] as const;

const identityNames = [
  "产品管理",
  "项目管理",
  "前端开发",
  "后端开发",
  "全栈开发",
  "移动端开发",
  "测试工程",
  "数据工程",
  "Agent 开发",
  "知识库开发",
  "产品设计",
  "运营",
  "客户成功",
  "安全工程",
  "财务运营",
] as const;

const projectDefinitions = [
  ["TIME", "工作时间事实核心", "#3468f5"],
  ["GRAPH", "项目演进图", "#7c5ce7"],
  ["PAY", "薪资与结算", "#159a72"],
  ["INTEL", "AI 工作洞察", "#d17a18"],
] as const;

const database = createDatabase();

try {
  const passwordHash = await hash(
    process.env.SEED_OWNER_PASSWORD ?? "ChangeMe-OnlyForLocalDev-123!",
    {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    },
  );

  await database.db.transaction(async (tx) => {
    await tx
      .insert(organizations)
      .values({
        id: organizationId,
        name: "顺势而为工作室",
        timezone: process.env.SEED_TIMEZONE ?? "Asia/Shanghai",
        payrollCutoffDay: 10,
        settings: {
          manualEntryLookbackDays: 7,
          concurrentPrimaryTimers: 1,
          defaultEvidenceVisibility: "management_only",
        },
      })
      .onConflictDoNothing();

    await tx
      .insert(users)
      .values(
        memberDefinitions.map((definition, index) => ({
          id: seedId(0x8010, index + 1),
          displayName: definition[0],
          timezone: "Asia/Shanghai",
          locale: "zh-CN",
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(userCredentials)
      .values(
        memberDefinitions.map((definition, index) => ({
          id: seedId(0x8011, index + 1),
          userId: seedId(0x8010, index + 1),
          kind: "email" as const,
          normalizedIdentifier: definition[2],
          passwordHash,
          verifiedAt: new Date("2026-08-01T00:00:00.000Z"),
        })),
      )
      .onConflictDoNothing();

    const unitIds = unitDefinitions.map((_, index) => seedId(0x8012, index + 1));
    await tx
      .insert(orgUnits)
      .values(
        unitDefinitions.map((definition, index) => ({
          id: unitIds[index]!,
          organizationId,
          parentId: definition[1] === null ? null : unitIds[definition[1]]!,
          name: definition[0],
          sortOrder: index,
        })),
      )
      .onConflictDoNothing();

    const membershipUnitIndexes = [0, 0, 5, 2, 2, 1, 3, 4, 4, 4, 5, 6, 2, 3, 7, 3, 5, 2];
    await tx
      .insert(orgMemberships)
      .values(
        memberDefinitions.map((definition, index) => ({
          id: seedId(0x8013, index + 1),
          organizationId,
          userId: seedId(0x8010, index + 1),
          orgUnitId: unitIds[membershipUnitIndexes[index]!]!,
          status: "active" as const,
          positionTitle: definition[3],
          joinedAt: new Date("2026-01-05T01:00:00.000Z"),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(accessRoles)
      .values([
        { id: ownerRoleId, organizationId, name: "Owner", kind: "owner", description: "唯一组织所有者", isSystem: true },
        { id: managerRoleId, organizationId, name: "Manager", kind: "manager", description: "按授权范围管理项目、审核和分析", isSystem: true },
        { id: memberRoleId, organizationId, name: "Member", kind: "member", description: "查看和维护自己的业务事实", isSystem: true },
      ])
      .onConflictDoNothing();

    await tx
      .insert(permissionDefinitions)
      .values(
        permissionCodes.map((code) => ({
          code,
          description: code,
          sensitivity: code.startsWith("payroll") || code.startsWith("roles") ? "high" : "normal",
        })),
      )
      .onConflictDoNothing();

    const managerPermissions = new Set([
      "project.create",
      "project.manage",
      "work.view_own",
      "work.view_project_public",
      "work.view_full_scope",
      "work.review",
      "analytics.view_team",
      "ai.team_analysis",
      "export.scope",
    ]);
    const memberPermissions = new Set([
      "work.view_own",
      "work.view_project_public",
      "payroll.view_own",
    ]);
    await tx
      .insert(rolePermissions)
      .values([
        ...permissionCodes.map((permissionCode, index) => ({ id: seedId(0x8014, index + 1), roleId: ownerRoleId, permissionCode })),
        ...permissionCodes
          .filter((code) => managerPermissions.has(code))
          .map((permissionCode, index) => ({ id: seedId(0x8015, index + 1), roleId: managerRoleId, permissionCode })),
        ...permissionCodes
          .filter((code) => memberPermissions.has(code))
          .map((permissionCode, index) => ({ id: seedId(0x8016, index + 1), roleId: memberRoleId, permissionCode })),
      ])
      .onConflictDoNothing();

    await tx
      .insert(memberRoles)
      .values(
        memberDefinitions.map((definition, index) => ({
          id: seedId(0x8017, index + 1),
          membershipId: seedId(0x8013, index + 1),
          roleId: definition[1] === "owner" ? ownerRoleId : definition[1] === "manager" ? managerRoleId : memberRoleId,
          scopeKind: "organization" as const,
          scopeId: organizationId,
          grantedBy: seedId(0x8013, 1),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(organizationOwners)
      .values({ organizationId, membershipId: seedId(0x8013, 1) })
      .onConflictDoNothing();

    await tx
      .insert(professionalIdentities)
      .values(
        identityNames.map((name, index) => ({
          id: seedId(0x8018, index + 1),
          organizationId,
          name,
          normalizedName: name.toLocaleLowerCase("zh-CN"),
          isCustom: index >= 8,
        })),
      )
      .onConflictDoNothing();

    const identityByMember = [0, 1, 11, 3, 2, 10, 6, 7, 8, 9, 11, 12, 5, 13, 14, 6, 11, 4];
    await tx
      .insert(memberIdentities)
      .values(
        identityByMember.flatMap((identityIndex, memberIndex) => {
          const primary = {
            id: seedId(0x8019, memberIndex * 2 + 1),
            membershipId: seedId(0x8013, memberIndex + 1),
            identityId: seedId(0x8018, identityIndex + 1),
            source: "organization" as const,
            verifiedAt: new Date("2026-01-05T01:00:00.000Z"),
          };
          if (![8, 9, 17].includes(memberIndex)) return [primary];
          return [
            primary,
            {
              id: seedId(0x8019, memberIndex * 2 + 2),
              membershipId: seedId(0x8013, memberIndex + 1),
              identityId: seedId(0x8018, memberIndex === 9 ? 9 : 10),
              source: "self_declared" as const,
              verifiedAt: new Date("2026-03-01T01:00:00.000Z"),
            },
          ];
        }),
      )
      .onConflictDoNothing();

    await tx
      .insert(workTypes)
      .values([
        { id: seedId(0x8020, 1), organizationId, name: "开发", color: "#3468f5" },
        { id: seedId(0x8020, 2), organizationId, name: "设计", color: "#7c5ce7" },
        { id: seedId(0x8020, 3), organizationId, name: "测试", color: "#159a72" },
        { id: seedId(0x8020, 4), organizationId, name: "研究与分析", color: "#d17a18" },
        { id: seedId(0x8020, 5), organizationId, name: "协作与沟通", color: "#64748b", billableByDefault: false },
      ])
      .onConflictDoNothing();

    await tx
      .insert(projects)
      .values(
        projectDefinitions.map((definition, index) => ({
          id: seedId(0x8021, index + 1),
          organizationId,
          key: definition[0],
          name: definition[1],
          color: definition[2],
          status: "active" as const,
          createdBy: seedId(0x8013, index === 3 ? 3 : 2),
          startAt: new Date("2026-07-01T00:00:00.000Z"),
          dueAt: new Date("2026-12-20T00:00:00.000Z"),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(projectBranches)
      .values(
        projectDefinitions.flatMap((_, projectIndex) => [
          {
            id: seedId(0x8022, projectIndex * 2 + 1),
            projectId: seedId(0x8021, projectIndex + 1),
            name: "主分支",
            isDefault: true,
            createdBy: seedId(0x8013, 2),
          },
          {
            id: seedId(0x8022, projectIndex * 2 + 2),
            projectId: seedId(0x8021, projectIndex + 1),
            parentBranchId: seedId(0x8022, projectIndex * 2 + 1),
            name: projectIndex === 0 ? "离线计时恢复" : "方案探索",
            createdBy: seedId(0x8013, projectIndex === 3 ? 3 : 2),
          },
        ]),
      )
      .onConflictDoNothing();

    const nodeRows = projectDefinitions.flatMap((definition, projectIndex) => {
      const projectId = seedId(0x8021, projectIndex + 1);
      const branchId = seedId(0x8022, projectIndex * 2 + 1);
      const base = projectIndex * 4;
      return [
        { id: seedId(0x8023, base + 1), projectId, branchId, type: "phase" as const, title: `${definition[1]}正式版`, status: "in_progress" as const, progress: "48.00", progressMode: "weighted_children" as const, createdBy: seedId(0x8013, 2) },
        { id: seedId(0x8023, base + 2), projectId, branchId, parentId: seedId(0x8023, base + 1), title: "领域模型与约束", status: "completed" as const, progress: "100.00", createdBy: seedId(0x8013, 2) },
        { id: seedId(0x8023, base + 3), projectId, branchId, parentId: seedId(0x8023, base + 1), title: "端到端业务流程", status: projectIndex === 3 ? ("blocked" as const) : ("in_progress" as const), progress: projectIndex === 3 ? "25.00" : "55.00", createdBy: seedId(0x8013, projectIndex === 3 ? 3 : 2) },
        { id: seedId(0x8023, base + 4), projectId, branchId, parentId: seedId(0x8023, base + 1), type: "milestone" as const, title: "生产验收", status: "not_started" as const, progress: "0.00", dueAt: new Date("2026-12-20T00:00:00.000Z"), createdBy: seedId(0x8013, 2) },
      ];
    });
    await tx.insert(projectNodes).values(nodeRows).onConflictDoNothing();

    await tx
      .insert(projectMembers)
      .values(
        projectDefinitions.flatMap((_, projectIndex) =>
          Array.from({ length: 8 }, (_unused, localIndex) => ({
            id: seedId(0x8024 + projectIndex, localIndex + 1),
            projectId: seedId(0x8021, projectIndex + 1),
            membershipId: seedId(0x8013, localIndex === 0 ? 1 : ((localIndex * 3 + projectIndex) % 17) + 2),
            role: localIndex === 1 ? ("lead" as const) : ("member" as const),
          })),
        ),
      )
      .onConflictDoNothing();

    await tx
      .insert(projectNodeAssignees)
      .values(
        nodeRows.map((node, index) => ({
          id: seedId(0x8029, index + 1),
          nodeId: node.id,
          membershipId: seedId(0x8013, (index % 15) + 4),
          isResponsible: index % 4 === 0,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(projectEdges)
      .values(
        projectDefinitions.map((_project, projectIndex) => ({
          id: seedId(0x8030, projectIndex + 1),
          projectId: seedId(0x8021, projectIndex + 1),
          sourceNodeId: seedId(0x8023, projectIndex * 4 + 2),
          targetNodeId: seedId(0x8023, projectIndex * 4 + 3),
          type: "depends_on" as const,
          createdBy: seedId(0x8013, 2),
        })),
      )
      .onConflictDoNothing();

    const sessionRows = Array.from({ length: 18 * 18 }, (_, rowIndex) => {
      const memberIndex = rowIndex % 18;
      const dayOffset = Math.floor(rowIndex / 18);
      const startsAt = new Date(Date.UTC(2026, 7, 14 + dayOffset, memberIndex === 8 && dayOffset % 7 === 0 ? 14 : 1 + (memberIndex % 3), 0));
      const durationHours = 5 + ((memberIndex + dayOffset) % 4);
      const endsAt = new Date(startsAt.getTime() + durationHours * 3_600_000);
      const hasBreak = durationHours >= 7;
      const grossSeconds = durationHours * 3_600;
      const breakSeconds = hasBreak ? 1_800 : 0;
      const projectIndex = (memberIndex + dayOffset) % projectDefinitions.length;
      return {
        id: seedId(0x8100, rowIndex + 1),
        organizationId,
        membershipId: seedId(0x8013, memberIndex + 1),
        startAt: startsAt,
        endAt: endsAt,
        timezone: "Asia/Shanghai",
        grossSeconds,
        breakSeconds,
        netSeconds: grossSeconds - breakSeconds,
        billableSeconds: grossSeconds - breakSeconds,
        source: dayOffset % 6 === 0 ? ("manual" as const) : ("timer" as const),
        content: `推进${projectDefinitions[projectIndex]![1]}：${dayOffset % 3 === 0 ? "完善边界规则" : "实现并验证核心流程"}`,
        result: dayOffset % 4 === 0 ? "完成阶段性验证并记录结果" : "完成计划内工作",
        blockers: projectIndex === 3 && dayOffset % 7 === 0 ? "等待 GLM 生产凭据验证" : "",
        nextStep: "继续完成当前节点并补充测试",
        primaryProjectNodeId: seedId(0x8023, projectIndex * 4 + 3),
        workTypeId: seedId(0x8020, (memberIndex % 5) + 1),
        visibility: dayOffset % 5 === 0 ? ("project_visible" as const) : ("management_only" as const),
        submissionStatus: "submitted" as const,
        approvalStatus: dayOffset % 9 === 0 ? ("returned" as const) : dayOffset % 4 === 0 ? ("pending_review" as const) : ("approved" as const),
        submittedAt: new Date(endsAt.getTime() + 15 * 60_000),
      };
    });
    await tx.insert(workSessions).values(sessionRows).onConflictDoNothing();

    const breakRows = sessionRows
      .filter((session) => session.breakSeconds > 0)
      .map((session, index) => ({
        id: seedId(0x8200, index + 1),
        workSessionId: session.id,
        startAt: new Date(session.startAt.getTime() + 3 * 3_600_000),
        endAt: new Date(session.startAt.getTime() + 3 * 3_600_000 + 1_800_000),
        reason: "休息",
      }));
    await tx.insert(workBreaks).values(breakRows).onConflictDoNothing();

    await tx
      .insert(workSessionProjectLinks)
      .values(
        sessionRows.map((session, index) => {
          const projectIndex = ((index % 18) + Math.floor(index / 18)) % projectDefinitions.length;
          return {
            id: seedId(0x8300, index + 1),
            workSessionId: session.id,
            projectId: seedId(0x8021, projectIndex + 1),
            projectNodeId: session.primaryProjectNodeId,
            projectBranchId: seedId(0x8022, projectIndex * 2 + 1),
            isPrimary: true,
          };
        }),
      )
      .onConflictDoNothing();

    const pendingSessions = sessionRows.filter((session) => session.approvalStatus === "pending_review");
    await tx
      .insert(approvalRequests)
      .values(
        pendingSessions.map((session, index) => ({
          id: seedId(0x8400, index + 1),
          organizationId,
          entityType: "work_session",
          entityId: session.id,
          entityVersion: "1",
          requestedBy: session.membershipId,
          assignedReviewerId: seedId(0x8013, index % 2 === 0 ? 2 : 3),
          status: "pending" as const,
          priority: index % 5 === 0 ? "high" : "normal",
          anomalyFlags: index % 5 === 0 ? ["manual_entry", "long_duration"] : [],
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(approvalActions)
      .values(
        pendingSessions.map((session, index) => ({
          id: seedId(0x8401, index + 1),
          approvalRequestId: seedId(0x8400, index + 1),
          actorMembershipId: session.membershipId,
          action: "submitted" as const,
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(compensationPlans)
      .values(
        memberDefinitions.map((_definition, index) => ({
          id: seedId(0x8500, index + 1),
          organizationId,
          membershipId: seedId(0x8013, index + 1),
          name: "默认薪资计划",
          type: index < 3 ? ("monthly" as const) : index === 9 ? ("hybrid" as const) : ("hourly" as const),
          createdBy: seedId(0x8013, 1),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(compensationPlanVersions)
      .values(
        memberDefinitions.map((_definition, index) => ({
          id: seedId(0x8501, index + 1),
          compensationPlanId: seedId(0x8500, index + 1),
          version: 1,
          type: index < 3 ? ("monthly" as const) : index === 9 ? ("hybrid" as const) : ("hourly" as const),
          baseAmount: index < 3 ? String(28_000 - index * 3_000) : String(120 + (index % 5) * 15),
          baseUnit: index < 3 ? "month" : "hour",
          pendingReviewCountsInEstimate: true,
          effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
          createdBy: seedId(0x8013, 1),
        })),
      )
      .onConflictDoNothing();

    await tx
      .insert(rateRules)
      .values(
        memberDefinitions.slice(3).flatMap((_definition, localIndex) => [
          { id: seedId(0x8502, localIndex * 2 + 1), compensationPlanVersionId: seedId(0x8501, localIndex + 4), type: "weekend" as const, priority: 20, conditions: { daysOfWeek: [0, 6] }, calculation: { multiplier: "1.5" } },
          { id: seedId(0x8502, localIndex * 2 + 2), compensationPlanVersionId: seedId(0x8501, localIndex + 4), type: "night_window" as const, priority: 30, conditions: { start: "22:00", end: "06:00" }, calculation: { multiplier: "1.25" } },
        ]),
      )
      .onConflictDoNothing();

    await tx
      .insert(payPeriods)
      .values([
        { id: seedId(0x8600, 1), organizationId, name: "2026 年 8 月", timezone: "Asia/Shanghai", startsAt: new Date("2026-07-31T16:00:00.000Z"), endsAt: new Date("2026-08-31T16:00:00.000Z"), cutoffAt: new Date("2026-09-10T04:00:00.000Z"), status: "pending_confirmation" },
        { id: seedId(0x8600, 2), organizationId, name: "2026 年 9 月", timezone: "Asia/Shanghai", startsAt: new Date("2026-08-31T16:00:00.000Z"), endsAt: new Date("2026-09-30T16:00:00.000Z"), cutoffAt: new Date("2026-10-10T04:00:00.000Z"), status: "open" },
      ])
      .onConflictDoNothing();

    await tx
      .insert(reminderRules)
      .values([
        { id: seedId(0x8700, 1), organizationId, category: "timer_long_running", name: "计时器长时间未结束", severity: "warning", conditions: { thresholdSeconds: 36_000 }, cooldownSeconds: 14_400, createdBy: seedId(0x8013, 1) },
        { id: seedId(0x8700, 2), organizationId, category: "payroll_cutoff_pending", name: "结算截止前待审记录", severity: "high", conditions: { daysBeforeCutoff: 3 }, cooldownSeconds: 86_400, createdBy: seedId(0x8013, 1) },
      ])
      .onConflictDoNothing();

    await tx
      .insert(notifications)
      .values({
        id: seedId(0x8701, 1),
        organizationId,
        recipientMembershipId: seedId(0x8013, 2),
        reminderRuleId: seedId(0x8700, 2),
        category: "payroll_cutoff_pending",
        severity: "high",
        title: "8 月工资周期仍有待审核记录",
        body: "结算前请集中处理待审核和退回记录。",
        actionUrl: "/approvals?payPeriod=2026-08",
        dedupeKey: "seed:payroll-cutoff:2026-08:manager-1",
      })
      .onConflictDoNothing();

    await tx
      .insert(aiJobs)
      .values({
        id: seedId(0x8800, 1),
        organizationId,
        requestedBy: seedId(0x8013, 2),
        scope: { type: "project", projectId: seedId(0x8021, 1) },
        taskType: "project_weekly_summary",
        provider: "zhipu",
        model: "glm-5.3-flash",
        promptTemplateVersion: "project-summary-v1",
        inputHash: "seed-project-summary-2026-w35",
        sourceSummary: { workSessionCount: 28, nodeCount: 4 },
        status: "completed",
        attempt: 1,
        completedAt: new Date("2026-08-31T12:00:00.000Z"),
      })
      .onConflictDoNothing();

    await tx
      .insert(aiReports)
      .values({
        id: seedId(0x8801, 1),
        aiJobId: seedId(0x8800, 1),
        title: "工作时间事实核心周报",
        summary: "本周完成时长边界和跨午夜验证，离线恢复仍需补充多端冲突测试。",
        structuredOutput: { progress: ["时长边界已验证", "跨午夜测试已通过"], risks: ["多端冲突测试尚未覆盖全部恢复路径"] },
        sourceCount: 32,
        generatedAt: new Date("2026-08-31T12:00:00.000Z"),
      })
      .onConflictDoNothing();

    await tx
      .insert(aiReportSources)
      .values({
        id: seedId(0x8802, 1),
        aiReportId: seedId(0x8801, 1),
        entityType: "project",
        entityId: seedId(0x8021, 1),
        entityVersion: "1",
        label: "工作时间事实核心",
      })
      .onConflictDoNothing();
  });

  process.stdout.write(
    "Development seed completed: 1 Owner, 2 managers, 15 employees, 4 projects, 324 work sessions.\n",
  );
} finally {
  await database.close();
}
