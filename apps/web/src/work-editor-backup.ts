/** Tab-local recovery never writes facts or shares drafts between identities. */
export interface WorkEditorBackup {
  version: 1;
  timezone: string;
  savedAt: string;
  initialTimes?: { startAt: string; endAt: string };
  manual: { content: string; result: string; blockers: string; nextStep: string; startAt: string; endAt: string; visibility: string; parallelWork: boolean };
  breaks: Array<{ id: string; startAt: string; endAt: string }>;
  evidence: { url: string; text: string; fileNames: string[] };
  segments: Array<{ id: string; startAt: string; endAt: string; content: string; result: string; evidence: { url: string; text: string; fileNames: string[] } }>;
  linkedProjectId: string;
  primaryProjectNodeId: string;
  linkedProjectNodes: Array<{ id: string; projectId: string; projectLabel: string; title: string; type: string; status: string }>;
  projectProgressUpdates: Record<string, string>;
}
const key = (membershipId: string) => `workbench:editor-recovery:v1:${membershipId}`;
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown, names: string[]): value is Record<string, string> => record(value) && names.every((name) => typeof value[name] === "string");
const evidence = (value: unknown) => record(value) && strings(value, ["url", "text"]) && Array.isArray(value.fileNames) && value.fileNames.every((name) => typeof name === "string");
export const WORK_EDITOR_SUBMITTED_EVENT = "workbench:work-entry-submitted";
export interface WorkEditorSubmittedEvent { membershipId: string | undefined; backup: WorkEditorBackup; editor: object }
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])]));
  return value;
}
export function sameWorkEditorBackup(left: WorkEditorBackup, right: WorkEditorBackup): boolean {
  const semantic = (value: WorkEditorBackup) => canonical({ ...value, savedAt: undefined });
  return JSON.stringify(semantic(left)) === JSON.stringify(semantic(right));
}
/** A completed request can retire only the submitted draft, never a later one. */
export function clearSubmittedWorkEditorBackup(membershipId: string | undefined, submitted: WorkEditorBackup): boolean {
  const current = readWorkEditorBackup(membershipId, submitted.timezone);
  return current !== null && sameWorkEditorBackup(current, submitted) && writeWorkEditorBackup(membershipId, null);
}
export function readWorkEditorBackup(membershipId: string | undefined, timezone: string): WorkEditorBackup | null {
  if (!membershipId) return null;
  try {
    const raw = sessionStorage.getItem(key(membershipId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || value.timezone !== timezone ||
        !strings(value, ["savedAt", "linkedProjectId", "primaryProjectNodeId"]) ||
        (value.initialTimes !== undefined && !strings(value.initialTimes, ["startAt", "endAt"])) ||
        !strings(value.manual, ["content", "result", "blockers", "nextStep", "startAt", "endAt", "visibility"]) || typeof value.manual.parallelWork !== "boolean" ||
        !["private", "project_visible", "management_only"].includes(value.manual.visibility!) ||
        !Array.isArray(value.breaks) || !value.breaks.every((item) => strings(item, ["id", "startAt", "endAt"])) ||
        !evidence(value.evidence) || !Array.isArray(value.segments) || !value.segments.every((item) => strings(item, ["id", "startAt", "endAt", "content", "result"]) && evidence(item.evidence)) ||
        !Array.isArray(value.linkedProjectNodes) || !value.linkedProjectNodes.every((item) => strings(item, ["id", "projectId", "projectLabel", "title", "type", "status"])) ||
        !record(value.projectProgressUpdates) || !Object.values(value.projectProgressUpdates).every((item) => typeof item === "string")) return null;
    return value as unknown as WorkEditorBackup;
  } catch { return null; }
}

export function hasWorkEditorBackupContent(value: WorkEditorBackup): boolean {
  return [value.manual.content, value.manual.result, value.manual.blockers, value.manual.nextStep, value.evidence.url, value.evidence.text].some(Boolean) ||
    value.evidence.fileNames.length > 0 || value.segments.length > 0 || value.breaks.length > 0 ||
    Boolean(value.linkedProjectId || value.primaryProjectNodeId) || value.linkedProjectNodes.length > 0 || Object.keys(value.projectProgressUpdates).length > 0 ||
    value.manual.visibility !== "management_only" || value.manual.parallelWork ||
    Boolean(value.initialTimes && (value.manual.startAt !== value.initialTimes.startAt || value.manual.endAt !== value.initialTimes.endAt));
}

/** undefined means a historical editor does not own the new-entry backup. */
export function flushWorkEditorBackup(membershipId: string | undefined, value: WorkEditorBackup | null | undefined, owned: boolean): boolean | undefined {
  if (value === undefined || (value === null && !owned)) return undefined;
  return writeWorkEditorBackup(membershipId, value);
}
export function writeWorkEditorBackup(membershipId: string | undefined, value: WorkEditorBackup | null): boolean {
  if (!membershipId) return false;
  try {
    if (value) sessionStorage.setItem(key(membershipId), JSON.stringify(value));
    else sessionStorage.removeItem(key(membershipId));
    return true;
  } catch { return false; }
}
