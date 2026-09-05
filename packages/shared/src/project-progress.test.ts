import { describe, expect, it } from "vitest";

import {
  calculateDerivedProjectProgress,
  calculateNodeScheduleProgress,
  calculateProjectProgressSummary,
  ProjectProgressCycleError,
  type ProjectProgressNode,
} from "./project-progress.js";

const node = (
  input: Partial<ProjectProgressNode> & Pick<ProjectProgressNode, "id">,
): ProjectProgressNode => ({
  parentId: null,
  type: "task",
  status: "in_progress",
  progress: 0,
  progressMode: "manual",
  weight: 1,
  ...input,
});

describe("calculateDerivedProjectProgress", () => {
  it("rolls weighted children upward in bottom-up order", () => {
    const result = calculateDerivedProjectProgress([
      node({ id: "root", progressMode: "weighted_children" }),
      node({
        id: "phase",
        parentId: "root",
        progressMode: "weighted_children",
        weight: 3,
      }),
      node({ id: "a", parentId: "phase", progress: 20, weight: 1 }),
      node({ id: "b", parentId: "phase", progress: 80, weight: 3 }),
      node({ id: "c", parentId: "root", progress: 50, weight: 1 }),
    ]);

    expect(result.get("phase")).toBe(65);
    expect(result.get("root")).toBe(61.25);
  });

  it("falls back to an equal average when all child weights are zero", () => {
    const result = calculateDerivedProjectProgress([
      node({ id: "root", progressMode: "weighted_children" }),
      node({ id: "a", parentId: "root", progress: 20, weight: 0 }),
      node({ id: "b", parentId: "root", progress: 80, weight: 0 }),
    ]);

    expect(result.get("root")).toBe(50);
  });

  it("uses active milestone descendants and gives completed milestones full credit", () => {
    const result = calculateDerivedProjectProgress([
      node({ id: "root", progressMode: "milestone_based", progress: 4 }),
      node({ id: "phase", parentId: "root", type: "phase" }),
      node({
        id: "m1",
        parentId: "phase",
        type: "milestone",
        status: "completed",
        progress: 55,
      }),
      node({
        id: "m2",
        parentId: "root",
        type: "milestone",
        progress: 40,
      }),
      node({
        id: "cancelled",
        parentId: "root",
        type: "milestone",
        status: "cancelled",
        progress: 0,
      }),
    ]);

    expect(result.get("root")).toBe(70);
  });

  it("does not alter a manual node and rejects an invalid cycle", () => {
    const manual = calculateDerivedProjectProgress([
      node({ id: "root", progress: 37 }),
      node({ id: "child", parentId: "root", progress: 88 }),
    ]);
    expect(manual.get("root")).toBe(37);

    expect(() =>
      calculateDerivedProjectProgress([
        node({ id: "a", parentId: "b", progressMode: "weighted_children" }),
        node({ id: "b", parentId: "a", progress: 20 }),
      ]),
    ).toThrow(ProjectProgressCycleError);
  });

  it("weights children by both explicit priority and planned duration", () => {
    const result = calculateDerivedProjectProgress([
      node({ id: "root", progressMode: "time_weighted_children" }),
      node({
        id: "short",
        parentId: "root",
        progress: 100,
        weight: 1,
        startAt: "2026-09-01T00:00:00.000Z",
        dueAt: "2026-09-02T00:00:00.000Z",
      }),
      node({
        id: "long",
        parentId: "root",
        progress: 0,
        weight: 2,
        startAt: "2026-09-01T00:00:00.000Z",
        dueAt: "2026-09-03T00:00:00.000Z",
      }),
    ]);

    expect(result.get("root")).toBe(20);
  });
});

describe("project schedule progress", () => {
  it("keeps elapsed schedule progress separate from execution progress", () => {
    const scheduledNode = node({
      id: "scheduled",
      progress: 25,
      startAt: "2026-09-01T00:00:00.000Z",
      dueAt: "2026-09-11T00:00:00.000Z",
    });
    expect(
      calculateNodeScheduleProgress(
        scheduledNode,
        "2026-09-06T00:00:00.000Z",
      ),
    ).toBe(50);

    const summary = calculateProjectProgressSummary(
      [
        scheduledNode,
        node({
          id: "longer",
          progress: 75,
          weight: 1,
          startAt: "2026-09-01T00:00:00.000Z",
          dueAt: "2026-09-21T00:00:00.000Z",
        }),
      ],
      "2026-09-06T00:00:00.000Z",
    );
    expect(summary).toEqual({
      executionProgress: 58.33,
      scheduleProgress: 33.33,
      leafCount: 2,
      scheduledLeafCount: 2,
    });
  });
});
