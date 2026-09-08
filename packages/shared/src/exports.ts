import { z } from "zod";
import { permissions, scopeKinds, type PermissionGrant } from "./permissions.js";

export const backgroundExportTypes = ["work_sessions", "project_effort", "projects", "approvals", "payroll", "evidence", "analytics", "ai_reports"] as const;
export type BackgroundExportType = typeof backgroundExportTypes[number];
export const exportTypeSchema = z.enum(backgroundExportTypes);
export const exportGrantSchema = z.object({
  permission: z.enum(permissions), scopeKind: z.enum(scopeKinds), scopeId: z.uuid().nullable(),
});
export const exportRangeSchema = z.object({
  version: z.literal(1), from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }),
  snapshotAt: z.iso.datetime({ offset: true }),
}).refine((range) => {
  const duration = Date.parse(range.to) - Date.parse(range.from);
  return duration > 0 && duration <= 366 * 86_400_000;
});
export type ExportRange = z.infer<typeof exportRangeSchema>;

export const exportCatalog: Record<BackgroundExportType, { title: string; description: string }> = {
  work_sessions: { title: "工作记录", description: "按工作开始时间筛选，包含授权范围内工时与内容。" },
  project_effort: { title: "项目投入", description: "按工作开始时间筛选，以主关联项目汇总工时，并保留逐条投入明细，避免重复累计。" },
  projects: { title: "项目结构", description: "导出截至任务创建时已建立的可见项目及其当前工作线、节点和关系；不按工作日期筛选。" },
  approvals: { title: "审批清单", description: "按申请时间筛选本人或当前有权审核的工时审批，附操作历史与退回原因。" },
  payroll: { title: "工资单与明细", description: "导出与所选日期相交的工资周期、可见成员最近有效计算批次和金额分项；预估与结算状态分别标明。" },
  evidence: { title: "证据清单", description: "按附件创建时间筛选可见证据，附文件详情、文字及关联记录；原文件在平台鉴权后下载。" },
  analytics: { title: "图表数据", description: "按工作开始时间筛选，导出每日趋势及项目、类型、审批状态聚合；不包含预测值。" },
  ai_reports: { title: "AI 报告", description: "按生成时间筛选本人发起的报告，保留完整分析和来源标识；AI 结论仅供参考。" },
};

export function exportRelevantGrants(type: BackgroundExportType, grants: readonly PermissionGrant[]): PermissionGrant[] {
  const names = {
    work_sessions: ["work.view_full_scope", "analytics.view_team"],
    project_effort: ["work.view_full_scope", "analytics.view_team"],
    analytics: ["work.view_full_scope", "analytics.view_team"],
    projects: ["project.view_all"],
    approvals: ["work.review"],
    payroll: ["payroll.view_own", "payroll.view_scope"],
    evidence: ["evidence.view_management", "work.review", "work.view_project_public"],
    ai_reports: ["ai.team_analysis", "work.view_full_scope", "payroll.view_own"],
  }[type];
  return grants.filter((grant) => grant.permission === "export.scope" || names.includes(grant.permission));
}

/** A retained export is never released after its original authorization shrinks. */
export function exportGrantsCover(current: readonly PermissionGrant[], snapshot: readonly PermissionGrant[]): boolean {
  return snapshot.every((old) => current.some((grant) => grant.permission === old.permission &&
    (grant.scopeKind === "organization" || (grant.scopeKind === old.scopeKind && grant.scopeId === old.scopeId))));
}

export type ExportCell = string | number | boolean | null;
export interface ExportColumn { key: string; label: string; width?: number }
export interface ExportTable { key: string; title: string; columns: ExportColumn[]; rows: Record<string, ExportCell>[] }
export interface BusinessExportDocument {
  schemaVersion: 2;
  exportType: BackgroundExportType;
  title: string;
  generatedAt: string;
  range: { from: string; to: string };
  description: string;
  tables: ExportTable[];
}
