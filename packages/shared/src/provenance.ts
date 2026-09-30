export interface FactSource { entityType: string; entityId: string; entityVersion?: string | null; projectId?: string | null; label: string }
export const sourceMarkerPattern = /\[source:([a-f0-9-]{36})\]/gi;
export function citedSourceIds(text: string): string[] {
  return [...new Set([...text.matchAll(sourceMarkerPattern)].map((match) => match[1]!.toLowerCase()))];
}
export function sourceHref(source: FactSource): string | null {
  if (source.entityType === "work_session") return `/work?record=${encodeURIComponent(source.entityId)}${source.entityVersion ? `&version=${encodeURIComponent(source.entityVersion)}` : ""}`;
  if (source.entityType === "project") return `/projects/${encodeURIComponent(source.entityId)}`;
  if (source.entityType === "project_node") return source.projectId ? `/projects/${encodeURIComponent(source.projectId)}?node=${encodeURIComponent(source.entityId)}` : null;
  if (["payroll_item", "payroll_component", "pay_period"].includes(source.entityType)) return `/payroll?source=${encodeURIComponent(source.entityId)}`;
  return null;
}
