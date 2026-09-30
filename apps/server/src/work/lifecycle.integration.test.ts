import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@workbench/db";
import { organizationOwners, organizations, orgMemberships, payrollAdjustments, payrollExportBatches, payrollExportProfiles, payrollRuns, users, workSessions, workSessionVersions } from "@workbench/db/schema";
import { AnalyticsService, type AnalyticsActor } from "../analytics/service.js";
import { PayrollService } from "../payroll/service.js";
import { PayrollHandoffService } from "../payroll/handoff.js";
import { WorkLifecycleService } from "./lifecycle.js";
import { WorkSessionService } from "./service.js";
import { WorkCorrectionService } from "./correction-service.js";

const clients: PGlite[] = [];
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-02T12:00:00Z")); });
afterEach(async () => { vi.useRealTimers(); await Promise.all(clients.splice(0).map((c) => c.close())); });
async function fixture() {
  const client = new PGlite(); clients.push(client);
  const dir = resolve(import.meta.dirname, "../../../../packages/db/drizzle");
  for (const file of (await readdir(dir)).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()) {
    for (const statement of (await readFile(resolve(dir, file), "utf8")).split("--> statement-breakpoint").filter((s) => s.trim())) await client.exec(statement);
  }
  const db = drizzle(client) as unknown as Database;
  const [org] = await db.insert(organizations).values({ name: "交接与生命周期验收", timezone: "Asia/Shanghai" }).returning();
  const people = await db.insert(users).values([{ displayName: "负责人" }, { displayName: "同名成员" }, { displayName: "同名成员" }]).returning();
  const members = await db.insert(orgMemberships).values(people.map((u) => ({ organizationId: org!.id, userId: u.id, status: "active" as const, joinedAt: new Date("2026-01-01") }))).returning();
  await db.insert(organizationOwners).values({ organizationId: org!.id, membershipId: members[0]!.id });
  const actors: AnalyticsActor[] = members.map((m) => ({ organizationId: org!.id, membershipId: m.id, grants: [] }));
  actors[0]!.grants = [{ permission: "work.review", scopeKind: "organization", scopeId: null }, { permission: "work.view_full_scope", scopeKind: "organization", scopeId: null }];
  return { db, actors, people, lifecycle: new WorkLifecycleService(db, new AnalyticsService(db)), work: new WorkSessionService(db), payroll: new PayrollService(db), handoff: new PayrollHandoffService(db) };
}
function proposal(index = 0) {
  const start = new Date(Date.parse("2026-09-28T01:00:00Z") + index * 7_200_000);
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + 3_600_000).toISOString(), timezone: "Asia/Shanghai", source: "manual" as const, content: "事实" + index, result: "已完成", blockers: "", nextStep: "", primaryProjectNodeId: null, projectNodeIds: [] as string[], visibility: "management_only" as const, parallelWork: false, breaks: [] as Array<{ startAt: string; endAt: string }> };
}
async function preparedHandoff() {
  const f = await fixture();
  const owner = f.actors[0]!;
  for (const actor of f.actors.slice(1)) {
    await f.payroll.configurePlan(owner, { membershipId: actor.membershipId, name: "时薪", type: "hourly", currency: "CNY", baseAmount: "10.000000", effectiveFrom: new Date("2026-01-01"), pendingReviewCountsInEstimate: false, rules: [] });
    const session = await f.work.createManual(actor, proposal());
    await f.db.update(workSessions).set({ submissionStatus: "submitted", approvalStatus: "approved" }).where(eq(workSessions.id, session.id));
  }
  const period = await f.payroll.createPeriod(owner, { name: "正式九月", timezone: "Asia/Shanghai", startsAt: new Date("2026-09-01T00:00:00Z"), endsAt: new Date("2026-10-01T00:00:00Z"), cutoffAt: new Date("2026-10-02T10:00:00Z") });
  await f.db.insert(payrollAdjustments).values({ organizationId: owner.organizationId, membershipId: f.actors[1]!.membershipId, payPeriodId: period.id, amount: "-1.000000", currency: "CNY", reason: "验收负数调整", createdBy: owner.membershipId, approvedBy: owner.membershipId, approvedAt: new Date() });
  const run = await f.payroll.calculate(owner, period.id);
  return { ...f, owner, run, period };
}

describe("full cycle facts, repair and immutable handoff", () => {
  it("enforces owner lookback and exact monthly cutoff for creation, mutation, restoration and submission", async () => {
    const f = await fixture(); const employee = f.actors[1]!;
    const original = await f.work.createManual(employee, proposal());
    const archived = await f.work.archiveDraftOwn(employee, original.id, original.version);
    await f.db.update(organizations).set({ settings: { workSubmissionPolicy: { manualEntryLookbackDays: 1, version: 1 } } }).where(eq(organizations.id, employee.organizationId));
    await expect(f.work.createManual(employee, proposal(1))).rejects.toThrow("追溯 1 天");
    await expect(f.work.archiveDraftOwn(employee, original.id, archived.version, true)).rejects.toThrow("追溯 1 天");
    await f.db.update(organizations).set({ settings: { workSubmissionPolicy: { manualEntryLookbackDays: 7, monthlyDeadlineEnabled: true, deadlineDay: "last", deadlineTime: "23:30", followingMonth: true, version: 2 } } }).where(eq(organizations.id, employee.organizationId));
    const restored = await f.work.archiveDraftOwn(employee, original.id, archived.version, true);
    expect(restored.deletedAt).toBeNull();
    await f.db.update(organizations).set({ settings: { workSubmissionPolicy: { manualEntryLookbackDays: 7, monthlyDeadlineEnabled: true, deadlineDay: "last", deadlineTime: "23:30", version: 3 } } }).where(eq(organizations.id, employee.organizationId));
    await expect(f.work.createManual(employee, proposal(1))).rejects.toThrow("截止时间已过");
    await expect(f.work.submit(employee, original.id, restored.version)).rejects.toThrow("截止时间已过");
    vi.setSystemTime(new Date("2026-09-30T15:29:59.999Z"));
    const before = await f.work.createManual(employee, proposal(1)); expect(before.id).toBeTruthy();
    vi.setSystemTime(new Date("2026-09-30T15:30:00.000Z"));
    await expect(f.work.createManual(employee, proposal(2))).rejects.toThrow("截止时间已过");
    await expect(f.work.submit(employee, before.id, before.version)).rejects.toThrow("截止时间已过");
  });
  it("counts the whole timezone month, pages identical timestamps and redacts narratives without content rights", async () => {
    const f = await fixture(); const employee = f.actors[1]!;
    const input = proposal();
    await f.db.insert(workSessions).values(Array.from({ length: 125 }, (_, i) => ({ organizationId: employee.organizationId, membershipId: employee.membershipId, startAt: new Date("2026-10-02T01:00:00Z"), endAt: new Date("2026-10-02T02:00:00Z"), timezone: input.timezone, grossSeconds: 3600, netSeconds: 3600, source: "manual" as const, content: "保密正文" + i, approvalStatus: "pending_review" as const })));
    const overview = await f.lifecycle.overview(employee);
    expect(overview.period.startsAt.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(overview.counts.pending_review).toBe(125);
    expect(overview.attentionTruncated).toBe(true);
    const countOnly: AnalyticsActor = { ...f.actors[2]!, grants: [{ permission: "analytics.view_team", scopeKind: "organization", scopeId: null }] };
    const first = await f.lifecycle.records(countOnly, { from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z", limit: 100 });
    const second = await f.lifecycle.records(countOnly, { from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z", limit: 100, before: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map((r) => r.id)).size).toBe(125);
    expect(first.items[0]?.content).toBe("[按字段权限隐藏]");
    expect(await f.lifecycle.context(countOnly, first.items[0]!.id)).toBeNull();
    expect(await f.lifecycle.context(employee, first.items[0]!.id)).not.toBeNull();
    expect(await f.lifecycle.context(f.actors[2]!, first.items[0]!.id)).toBeNull();
  });
  it("archives mistaken drafts reversibly and rejects stale, foreign and conflicting restoration", async () => {
    const f = await fixture(); const employee = f.actors[1]!;
    const first = await f.work.createManual(employee, proposal());
    const archived = await f.work.archiveDraftOwn(employee, first.id, first.version);
    expect(await f.work.listOwn(employee, 100)).toHaveLength(0);
    await expect(f.work.archiveDraftOwn(employee, first.id, first.version, true)).rejects.toThrow();
    await expect(f.work.archiveDraftOwn(f.actors[2]!, first.id, archived.version, true)).rejects.toThrow();
    const replacement = await f.work.createManual(employee, proposal());
    await expect(f.work.archiveDraftOwn(employee, first.id, archived.version, true)).rejects.toThrow("原时段现在");
    await f.work.archiveDraftOwn(employee, replacement.id, replacement.version);
    const restored = await f.work.archiveDraftOwn(employee, first.id, archived.version, true);
    expect(restored.deletedAt).toBeNull(); expect(restored.version).toBe(first.version + 2);
    expect(await f.db.select().from(workSessionVersions).where(eq(workSessionVersions.workSessionId, first.id))).toHaveLength(3);
  });
  it("repairs approved facts through a reviewed proposal and requires a fresh submission", async () => {
    const f = await fixture(); const employee = f.actors[1]!;
    const original = await f.work.createManual(employee, proposal());
    await f.db.update(workSessions).set({ submissionStatus: "submitted", approvalStatus: "approved" }).where(eq(workSessions.id, original.id));
    const corrections = new WorkCorrectionService(f.db);
    await expect(corrections.requestOwn(employee, original.id, { ...proposal(), endAt: "2026-10-03T00:00:00Z" }, "误填修复")).rejects.toThrow("已发生");
    const request = await corrections.requestOwn(employee, original.id, { ...proposal(1), content: "核对后真实时段" }, "原时段误填");
    await expect(corrections.decide(employee, request.id, { decision: "approved" })).rejects.toThrow();
    await corrections.decide(f.actors[0]!, request.id, { decision: "approved", reviewNote: "已核对时间与事实" });
    const [updated] = await f.db.select().from(workSessions).where(eq(workSessions.id, original.id));
    expect(updated).toMatchObject({ content: "核对后真实时段", approvalStatus: "not_requested", submissionStatus: "draft", version: original.version + 1 });
  });
  it("invalidates changed identity previews and freezes exact checksum bytes, same-name identifiers and negative numbers", async () => {
    const f = await preparedHandoff();
    const oldPreview = await f.handoff.preview(f.owner, f.run.id);
    expect(oldPreview.blockers).toEqual([]);
    await f.handoff.profile(f.owner, f.actors[1]!.membershipId, "external-one");
    await expect(f.handoff.profile(f.owner, f.actors[2]!.membershipId, "external-one")).rejects.toThrow("已被其他成员");
    await expect(f.handoff.confirm(f.owner, f.run.id, oldPreview.previewHash)).rejects.toThrow("已变化");
    const preview = await f.handoff.preview(f.owner, f.run.id);
    const batch = await f.handoff.confirm(f.owner, f.run.id, preview.previewHash);
    const workbook = await f.handoff.workbook(f.owner, f.run.id);
    expect(createHash("sha256").update(workbook.body).digest("hex")).toBe(workbook.sha256);
    const book = new ExcelJS.Workbook(); await book.xlsx.load(workbook.body as unknown as Parameters<typeof book.xlsx.load>[0]);
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(["薪资汇总", "工资组成", "报销明细", "工作提交单", "工作证据目录", "规则与来源"]);
    expect(book.getWorksheet("工作提交单")!.rowCount).toBe(3);
    expect(book.getWorksheet("工资组成")!.rowCount).toBeGreaterThan(2);
    expect(JSON.stringify(book.getWorksheet("工资组成")!.getSheetValues())).toContain("-1.000000");
    expect(JSON.stringify(book.getWorksheet("工作提交单")!.getSheetValues())).toContain("事实0");
    expect(JSON.stringify((await f.handoff.preview(f.owner, f.run.id)).batch)).not.toContain("workbookBase64");
    const file = await f.payroll.financeExport(f.owner, f.run.id);
    expect(file.sha256).toBe(createHash("sha256").update(file.csv).digest("hex"));
    expect(file.csv).toContain('"-1.000000"'); expect(file.csv).not.toContain("'-1.000000");
    for (const actor of f.actors.slice(1)) expect(file.csv).toContain(actor.membershipId);
    await f.db.update(users).set({ displayName: "重命名后不改变旧文件" }).where(eq(users.id, f.people[1]!.id));
    await f.handoff.profile(f.owner, f.actors[1]!.membershipId, "new-external-id");
    expect((await f.payroll.financeExport(f.owner, f.run.id)).csv).toBe(file.csv);
    expect((await f.handoff.workbook(f.owner, f.run.id)).body.equals(workbook.body)).toBe(true);
    expect((await f.handoff.confirm(f.owner, f.run.id, preview.previewHash)).id).toBe(batch.id);
    expect(await f.db.select().from(payrollExportBatches)).toHaveLength(1);
    await expect(f.handoff.preview({ ...f.owner, organizationId: crypto.randomUUID() }, f.run.id)).rejects.toThrow();
  });
  it("blocks handoff for pending corrections and newly joined members missing pay configuration", async () => {
    const f = await preparedHandoff();
    const [memberFact] = await f.db.select().from(workSessions).where(eq(workSessions.membershipId, f.actors[1]!.membershipId));
    await new WorkCorrectionService(f.db).requestOwn(f.actors[1]!, memberFact!.id, proposal(1), "核对待更正时段");
    const preview = await f.handoff.preview(f.owner, f.run.id);
    expect(preview.blockers.join()).toContain("更正申请");
    await expect(f.handoff.confirm(f.owner, f.run.id, preview.previewHash)).rejects.toThrow("更正申请");
    const [person] = await f.db.insert(users).values({ displayName: "新加入缺方案" }).returning();
    await f.db.insert(orgMemberships).values({ organizationId: f.owner.organizationId, userId: person!.id, status: "active", joinedAt: new Date("2026-09-29") });
    expect((await f.handoff.preview(f.owner, f.run.id)).missingPlans.map((m) => m.displayName)).toContain("新加入缺方案");
    const [later] = await f.db.insert(users).values({ displayName: "历史周期结束后才加入" }).returning();
    await f.db.insert(orgMemberships).values({ organizationId: f.owner.organizationId, userId: later!.id, status: "active", joinedAt: new Date("2026-10-02") });
    expect((await f.handoff.preview(f.owner, f.run.id)).missingPlans.map((m) => m.displayName)).not.toContain("历史周期结束后才加入");
  });
  it("rejects identities colliding with another member's default UUID and blocks legacy duplicate export rows", async () => {
    const f = await preparedHandoff(); const first = f.actors[1]!; const second = f.actors[2]!;
    await expect(f.handoff.profile(f.owner, first.membershipId, second.membershipId)).rejects.toThrow("默认 UUID 重复");
    expect(await f.db.select().from(payrollExportProfiles)).toHaveLength(0);
    await f.db.insert(payrollExportProfiles).values({ organizationId: f.owner.organizationId, membershipId: first.membershipId, externalId: second.membershipId, updatedBy: f.owner.membershipId });
    const preview = await f.handoff.preview(f.owner, f.run.id);
    expect(preview.blockers.join()).toContain("重复的外部人员编号");
    await expect(f.handoff.confirm(f.owner, f.run.id, preview.previewHash)).rejects.toThrow("重复的外部人员编号");
    expect(await f.db.select().from(payrollExportBatches)).toHaveLength(0);
    expect((await f.db.select().from(payrollRuns).where(eq(payrollRuns.id, f.run.id)))[0]?.status).toBe("ready");
    await f.handoff.profile(f.owner, second.membershipId, "external-two");
    expect((await f.handoff.preview(f.owner, f.run.id)).blockers).toEqual([]);
  });
});
