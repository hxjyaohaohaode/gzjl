/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearSubmittedWorkEditorBackup, flushWorkEditorBackup, hasWorkEditorBackupContent, readWorkEditorBackup, sameWorkEditorBackup, writeWorkEditorBackup, type WorkEditorBackup } from "./work-editor-backup.js";

const backup: WorkEditorBackup = {
  version: 1, timezone: "Asia/Shanghai", savedAt: "2026-09-22T01:00:00Z",
  manual: { content: "待核对的记录", result: "", blockers: "", nextStep: "", startAt: "", endAt: "2026-09-22T09:00", visibility: "project_visible", parallelWork: false },
  breaks: [{ id: "break", startAt: "", endAt: "" }], evidence: { url: "", text: "会议纪要", fileNames: ["证据.pdf"] },
  segments: [{ id: "second", content: "第二段", result: "", startAt: "", endAt: "", evidence: { url: "https://example.com", text: "", fileNames: [] } }],
  linkedProjectId: "project", primaryProjectNodeId: "node", linkedProjectNodes: [{ id: "node", projectId: "project", projectLabel: "项目", title: "节点", type: "task", status: "open" }], projectProgressUpdates: { node: "40" },
};
afterEach(() => { vi.restoreAllMocks(); sessionStorage.clear(); });
describe("tab-local work recovery", () => {
  it("preserves incomplete input, evidence reminders and additional segments without creating facts", () => {
    expect(writeWorkEditorBackup("one", backup)).toBe(true);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(backup);
    expect(writeWorkEditorBackup("one", null)).toBe(true);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toBeNull();
  });
  it("does not load another account or reinterpret wall time after a timezone change", () => {
    writeWorkEditorBackup("one", backup);
    expect(readWorkEditorBackup("two", "Asia/Shanghai")).toBeNull();
    expect(readWorkEditorBackup("one", "America/New_York")).toBeNull();
    expect(readWorkEditorBackup(undefined, "Asia/Shanghai")).toBeNull();
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(backup);
  });
  it("rejects corrupted nested drafts instead of crashing the editor", () => {
    for (const corrupt of [{ ...backup, manual: null }, { ...backup, segments: [{ ...backup.segments[0], evidence: null }] }, { ...backup, linkedProjectNodes: [null] }, { ...backup, projectProgressUpdates: [] }]) {
      sessionStorage.setItem("workbench:editor-recovery:v1:one", JSON.stringify(corrupt));
      expect(readWorkEditorBackup("one", "Asia/Shanghai")).toBeNull();
    }
  });
  it("keeps browser storage failure recoverable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Blocked"); });
    expect(writeWorkEditorBackup("one", backup)).toBe(false);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toBeNull();
  });
  it("preserves time-first, association-first and incomplete break input", () => {
    const empty: WorkEditorBackup = { ...backup, initialTimes: { startAt: "2026-09-22T09:00", endAt: "2026-09-22T10:00" }, manual: { ...backup.manual, content: "", startAt: "2026-09-22T09:00", endAt: "2026-09-22T10:00", visibility: "management_only" }, breaks: [], evidence: { url: "", text: "", fileNames: [] }, segments: [], linkedProjectId: "", primaryProjectNodeId: "", linkedProjectNodes: [], projectProgressUpdates: {} };
    expect(hasWorkEditorBackupContent(empty)).toBe(false);
    expect(hasWorkEditorBackupContent({ ...empty, manual: { ...empty.manual, startAt: "" } })).toBe(true);
    expect(hasWorkEditorBackupContent({ ...empty, linkedProjectId: "project" })).toBe(true);
    expect(hasWorkEditorBackupContent({ ...empty, breaks: [{ id: "partial", startAt: "", endAt: "" }] })).toBe(true);
    expect(hasWorkEditorBackupContent({ ...empty, evidence: { ...empty.evidence, fileNames: ["待补.pdf"] } })).toBe(true);
  });
  it("distinguishes ownership suspension from an explicit pending deletion during pagehide", () => {
    writeWorkEditorBackup("one", backup);
    expect(flushWorkEditorBackup("one", undefined, true)).toBeUndefined();
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(backup);
    expect(flushWorkEditorBackup("one", null, false)).toBeUndefined();
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(backup);
    expect(flushWorkEditorBackup("one", null, true)).toBe(true);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toBeNull();
  });
  it("retires the submitted snapshot after remount timestamps change without resurrecting it", () => {
    const recovered = { ...backup, savedAt: "2026-09-22T01:01:00Z", projectProgressUpdates: { second: "20", node: "40" } };
    const submitted = { ...backup, projectProgressUpdates: { node: "40", second: "20" } };
    expect(sameWorkEditorBackup(submitted, recovered)).toBe(true);
    writeWorkEditorBackup("one", recovered);
    expect(clearSubmittedWorkEditorBackup("one", submitted)).toBe(true);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toBeNull();
  });
  it("a late completion cannot delete a newer draft or a different account's backup", () => {
    const newer = { ...backup, manual: { ...backup.manual, content: "后来编辑的 C" } };
    writeWorkEditorBackup("one", newer);
    writeWorkEditorBackup("two", backup);
    expect(clearSubmittedWorkEditorBackup("one", backup)).toBe(false);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(newer);
    expect(readWorkEditorBackup("two", "Asia/Shanghai")).toEqual(backup);
    expect(clearSubmittedWorkEditorBackup("one", { ...newer, timezone: "America/New_York" })).toBe(false);
    expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(newer);
    expect(clearSubmittedWorkEditorBackup(undefined, backup)).toBe(false);
  });
  it("treats evidence, partially edited times and associations as newer input", () => {
    for (const newer of [
      { ...backup, manual: { ...backup.manual, endAt: "" } },
      { ...backup, evidence: { ...backup.evidence, fileNames: ["另一份证据.pdf"] } },
      { ...backup, linkedProjectId: "different" },
      { ...backup, projectProgressUpdates: { node: "50" } },
    ]) {
      writeWorkEditorBackup("one", newer);
      expect(clearSubmittedWorkEditorBackup("one", backup)).toBe(false);
      expect(readWorkEditorBackup("one", "Asia/Shanghai")).toEqual(newer);
    }
  });
});
