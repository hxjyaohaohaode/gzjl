import { capturePayrollWorkbook } from "./bundle.js";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { Database } from "@workbench/db";
import { auditLogs, compensationPlans, compensationPlanVersions, organizationOwners, orgMemberships, payrollExportBatches, payrollExportProfiles, payrollItems, payrollRuns, payPeriods, users, workSessions, workSessionCorrections } from "@workbench/db/schema";
import { addDecimalAmounts } from "@workbench/shared";
import { lockPayrollInputs } from "./input-lock.js";
import { PayrollConflictError, PayrollNotFoundError, PayrollService, type PayrollActor } from "./service.js";

const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
function escapeCsvCell(value: string, column: number) {
  // Only engine-produced decimal columns may start with a numeric minus sign.
  const numeric = [8, 9, 10, 11, 12, 15].includes(column) && /^-?\d+(?:\.\d+)?$/.test(value);
  const safe = !numeric && /^[\s\uFEFF]*[=+@\-\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export class PayrollHandoffService {
  constructor(private readonly db: Database) {}


  async workbook(actor: PayrollActor, runId: string) {
    const [batch] = await this.db.select({ manifest: payrollExportBatches.manifest }).from(payrollExportBatches).where(and(eq(payrollExportBatches.payrollRunId, runId), eq(payrollExportBatches.organizationId, actor.organizationId))).limit(1);
    if (!batch) throw new PayrollConflictError("请先逐行核对并确认薪资交接批次，再下载完整工作单。");
    const manifest = batch.manifest as Record<string, unknown>;
    if (typeof manifest.workbookBase64 !== "string" || typeof manifest.workbookSha256 !== "string" || typeof manifest.workbookFileName !== "string") throw new PayrollConflictError("历史批次尚未保存完整 Excel 工作单；原 CSV 仍可重取，不能用当前事实冒充历史文件。");
    const body = Buffer.from(manifest.workbookBase64, "base64");
    if (createHash("sha256").update(body).digest("hex") !== manifest.workbookSha256) throw new PayrollConflictError("原工作簿校验失败，请联系管理员核查数据完整性。");
    return { body, sha256: manifest.workbookSha256, fileName: manifest.workbookFileName };
  }

  async profile(actor: PayrollActor, membershipId: string, externalId: string) {
    return this.db.transaction(async (tx) => {
      await lockPayrollInputs(tx, actor.organizationId);
      const [member] = await tx.select().from(orgMemberships).where(and(eq(orgMemberships.id, membershipId), eq(orgMemberships.organizationId, actor.organizationId)));
      if (!member) throw new PayrollNotFoundError();
      const [duplicate] = await tx.select().from(payrollExportProfiles).where(and(eq(payrollExportProfiles.organizationId, actor.organizationId), eq(payrollExportProfiles.externalId, externalId), ne(payrollExportProfiles.membershipId, membershipId)));
      if (duplicate) throw new PayrollConflictError("外部人员编号已被其他成员使用，请核对同名成员和外部平台账号。");
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(externalId)) {
        const [defaultIdentity] = await tx.select({ id: orgMemberships.id }).from(orgMemberships).leftJoin(payrollExportProfiles, eq(payrollExportProfiles.membershipId, orgMemberships.id)).where(and(eq(orgMemberships.organizationId, actor.organizationId), eq(orgMemberships.id, externalId), ne(orgMemberships.id, membershipId), isNull(payrollExportProfiles.membershipId))).limit(1);
        if (defaultIdentity) throw new PayrollConflictError("外部人员编号与另一成员正在使用的默认 UUID 重复，请先核对并分别保存唯一编号。");
      }
      await tx.insert(payrollExportProfiles).values({ membershipId, organizationId: actor.organizationId, externalId, updatedBy: actor.membershipId }).onConflictDoUpdate({ target: payrollExportProfiles.membershipId, set: { externalId, updatedBy: actor.membershipId, updatedAt: new Date() } });
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "payroll.external_identity.updated", entityType: "organization_membership", entityId: membershipId, after: { externalId } });
      return { membershipId, externalId };
    });
  }

  async preview(actor: PayrollActor, runId: string) {
    const [record] = await this.db.select({ run: payrollRuns, period: payPeriods }).from(payrollRuns).innerJoin(payPeriods, eq(payPeriods.id, payrollRuns.payPeriodId)).where(and(eq(payrollRuns.id, runId), eq(payPeriods.organizationId, actor.organizationId))).limit(1);
    if (!record) throw new PayrollNotFoundError();
    // Ordinary previews transfer only metadata and frozen personnel rows.
    const [batch] = await this.db.select({ id: payrollExportBatches.id, fileName: payrollExportBatches.fileName, sha256: payrollExportBatches.sha256, ruleVersion: payrollExportBatches.ruleVersion, createdAt: payrollExportBatches.createdAt, manifest: sql<Record<string, unknown>>`${payrollExportBatches.manifest} - 'workbookBase64'` }).from(payrollExportBatches).where(eq(payrollExportBatches.payrollRunId, runId));
    const [rows, facts, members, plans, owners, earlier, corrections] = await Promise.all([
      this.db.select({ item: payrollItems, displayName: users.displayName, externalId: payrollExportProfiles.externalId }).from(payrollItems).innerJoin(orgMemberships, eq(orgMemberships.id, payrollItems.membershipId)).innerJoin(users, eq(users.id, orgMemberships.userId)).leftJoin(payrollExportProfiles, eq(payrollExportProfiles.membershipId, payrollItems.membershipId)).where(eq(payrollItems.payrollRunId, runId)).orderBy(asc(payrollItems.membershipId)),
      this.db.select({ id: workSessions.id, membershipId: workSessions.membershipId, version: workSessions.version, approvalStatus: workSessions.approvalStatus, anomalyFlags: workSessions.anomalyFlags }).from(workSessions).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessions.recordKind, "fact"), isNull(workSessions.deletedAt), lt(workSessions.startAt, record.period.endsAt), gt(workSessions.endAt, record.period.startsAt))).orderBy(asc(workSessions.id)),
      this.db.select({ id: orgMemberships.id, displayName: users.displayName, joinedAt: orgMemberships.joinedAt, createdAt: orgMemberships.createdAt }).from(orgMemberships).innerJoin(users, eq(users.id, orgMemberships.userId)).where(and(eq(orgMemberships.organizationId, actor.organizationId), eq(orgMemberships.status, "active"))).orderBy(asc(orgMemberships.id)),
      this.db.select({ membershipId: compensationPlans.membershipId, startsAt: compensationPlanVersions.effectiveFrom, endsAt: compensationPlanVersions.effectiveTo }).from(compensationPlans).innerJoin(compensationPlanVersions, eq(compensationPlanVersions.compensationPlanId, compensationPlans.id)).where(and(eq(compensationPlans.organizationId, actor.organizationId), isNull(compensationPlans.archivedAt), lt(compensationPlanVersions.effectiveFrom, record.period.endsAt), or(isNull(compensationPlanVersions.effectiveTo), gt(compensationPlanVersions.effectiveTo, record.period.startsAt)))),
      this.db.select().from(organizationOwners).where(eq(organizationOwners.organizationId, actor.organizationId)),
      this.db.select({ item: payrollItems, run: payrollRuns }).from(payrollItems).innerJoin(payrollRuns, eq(payrollRuns.id, payrollItems.payrollRunId)).where(and(eq(payrollRuns.payPeriodId, record.period.id), lt(payrollRuns.runNumber, record.run.runNumber))).orderBy(desc(payrollRuns.runNumber)),
      this.db.select({ id: workSessions.id, correctionId: workSessionCorrections.id }).from(workSessionCorrections).innerJoin(workSessions, eq(workSessions.id, workSessionCorrections.workSessionId)).where(and(eq(workSessions.organizationId, actor.organizationId), eq(workSessionCorrections.status, "pending"), isNull(workSessions.deletedAt), lt(workSessions.startAt, record.period.endsAt), gt(workSessions.endAt, record.period.startsAt))),
    ]);
    const previous = new Map<string, typeof payrollItems.$inferSelect>();
    for (const entry of earlier) if (!previous.has(entry.item.membershipId)) previous.set(entry.item.membershipId, entry.item);
    const periodMembers = members.filter((m) => (m.joinedAt ?? m.createdAt) < record.period.endsAt || facts.some((f) => f.membershipId === m.id) || rows.some((r) => r.item.membershipId === m.id));
    const missingPlans = periodMembers.filter((m) => !owners.some((o) => o.membershipId === m.id) && !plans.some((p) => p.membershipId === m.id));
    const pending = facts.filter((f) => f.approvalStatus === "pending_review");
    const drafts = facts.filter((f) => ["not_requested", "returned"].includes(f.approvalStatus));
    const anomalies = facts.filter((f) => Array.isArray(f.anomalyFlags) && f.anomalyFlags.length);
    const previewRows = rows.map((r) => ({ membershipId: r.item.membershipId, displayName: r.displayName, externalId: r.externalId ?? r.item.membershipId, identityMode: r.externalId ? "external" : "membership", currency: r.item.currency, approvedSeconds: r.item.approvedSeconds, pendingSeconds: r.item.pendingSeconds, grossAmount: r.item.grossAmount, adjustmentAmount: r.item.adjustmentAmount, finalAmount: r.item.finalAmount, estimate: r.item.estimate, needsReview: r.item.needsReview, planVersionId: r.item.compensationPlanVersionId, amountChange: previous.has(r.item.membershipId) ? addDecimalAmounts(r.item.finalAmount, previous.get(r.item.membershipId)!.finalAmount.startsWith("-") ? previous.get(r.item.membershipId)!.finalAmount.slice(1) : `-${previous.get(r.item.membershipId)!.finalAmount}`) : null }));
    const blockers = [...(record.run.status === "ready" || record.run.status === "settled" ? [] : ["批次未就绪，请先复核并重新计算。"]), ...(missingPlans.length ? [`${missingPlans.length} 位已加入成员在本周期缺少计薪方案。`] : []), ...(pending.length ? [`${pending.length} 条记录仍待审。`] : []), ...(previewRows.some((r) => r.needsReview || r.estimate) ? ["存在预估或待复核金额。"] : []), ...(rows.length ? [] : ["当前批次没有可导出人员行。"])];
    const externalIds = new Set<string>(); const repeatedExternalIds = new Set<string>();
    for (const row of previewRows) { if (externalIds.has(row.externalId)) repeatedExternalIds.add(row.externalId); externalIds.add(row.externalId); }
    if (repeatedExternalIds.size) blockers.push("导出行存在重复的外部人员编号，请分别保存唯一映射后重新核对。");
    if (corrections.length) blockers.push(`${corrections.length} 条更正申请尚待处理，请先核对更正，避免锁定旧事实。`);
    if (!batch && record.period.endsAt > new Date()) blockers.push("结算周期尚未结束，可先查看计算预览；请在完整周期结束后重新核对并确认导出，避免把半个月的依据当作完整月账单。");
    const previewHash = hash(JSON.stringify({ run: record.run, period: record.period, rows: previewRows, facts, missingPlans, corrections }));
    return { ...record, rows: batch ? (batch.manifest as { rows: typeof previewRows }).rows : previewRows, missingPlans, pending, drafts, anomalies, corrections, blockers, previewHash, batch: batch ? { id: batch.id, fileName: batch.fileName, sha256: batch.sha256, ruleVersion: batch.ruleVersion, createdAt: batch.createdAt, manifest: publicManifest(batch.manifest) } : null };
  }

  async confirm(actor: PayrollActor, runId: string, previewHash: string) {
    return this.db.transaction(async (tx) => {
      await lockPayrollInputs(tx, actor.organizationId);
      const service = new PayrollHandoffService(tx as unknown as Database);
      const preview = await service.preview(actor, runId);
      if (preview.batch) return preview.batch;
      if (preview.previewHash !== previewHash) throw new PayrollConflictError("预览后记录、金额或成员匹配信息已变化，请刷新预览并重新核对。");
      if (preview.blockers.length) throw new PayrollConflictError(preview.blockers.join(" "));
      const header = ["成员唯一编号", "外部人员编号", "员工", "薪资周期", "周期开始（含）", "周期结束（不含）", "周期时区", "币种", "已批准工时（小时）", "待审核工时（小时）", "应计金额", "调整金额", "最终金额", "计薪方案版本", "批次唯一编号", "批次号", "计算规则版本", "发薪状态"];
      const csv = `${[header, ...preview.rows.map((r) => [r.membershipId, r.externalId, r.displayName, preview.period.name, preview.period.startsAt.toISOString(), preview.period.endsAt.toISOString(), preview.period.timezone, r.currency, (r.approvedSeconds / 3600).toFixed(6), (r.pendingSeconds / 3600).toFixed(6), r.grossAmount, r.adjustmentAmount, r.finalAmount, r.planVersionId, runId, String(preview.run.runNumber), preview.run.calculationVersion, "本平台仅导出依据，发薪由外部平台办理"])].map((r) => r.map(escapeCsvCell).join(",")).join("\r\n")}\r\n`;
      const fileName = `${preview.period.name.replace(/[\\/:*?"<>|]+/g, "-").split("").map((c) => c.charCodeAt(0) < 32 ? "-" : c).join("").slice(0, 100)}-薪资交接-批次${preview.run.runNumber}-${runId.slice(0, 8)}.csv`;
      const workbook = await capturePayrollWorkbook(tx as unknown as Database, actor, preview, fileName);
      await new PayrollService(tx as unknown as Database).settle(actor, runId);
      const [batch] = await tx.insert(payrollExportBatches).values({ organizationId: actor.organizationId, payrollRunId: runId, fileName, csv, sha256: hash(`\uFEFF${csv}`), ruleVersion: preview.run.calculationVersion, inputHash: preview.run.inputHash, previewHash, manifest: { ...workbook, rows: preview.rows, rowCount: preview.rows.length, byteLength: Buffer.byteLength(`\uFEFF${csv}`, "utf8"), draftsAcknowledged: preview.drafts.map((f) => f.id), anomaliesAcknowledged: preview.anomalies.map((f) => f.id), encoding: "utf-8-bom", dateSemantics: "[startsAt, endsAt)", externalPayment: true }, createdBy: actor.membershipId }).returning();
      await tx.insert(auditLogs).values({ organizationId: actor.organizationId, actorMembershipId: actor.membershipId, action: "payroll.handoff.confirmed", entityType: "payroll_run", entityId: runId, after: { batchId: batch!.id, sha256: batch!.sha256, previewHash, identityMatchingConfirmed: true } });
      return { id: batch!.id, fileName, sha256: batch!.sha256, ruleVersion: batch!.ruleVersion, createdAt: batch!.createdAt, manifest: publicManifest(batch!.manifest) };
    });
  }
}

function publicManifest(manifest: unknown) {
  const { workbookBase64: _bytes, ...metadata } = manifest as Record<string, unknown>;
  void _bytes; return metadata;
}
