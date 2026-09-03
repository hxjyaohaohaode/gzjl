import { describe, expect, it } from "vitest";

import { createWorkSessionSchema } from "./schemas.js";

const primaryNodeId = "00000000-0000-4000-8000-000000000006";
const auxiliaryNodeId = "00000000-0000-4000-8000-000000000007";
const baseInput = {
  startAt: "2026-09-02T01:00:00.000Z",
  endAt: "2026-09-02T02:00:00.000Z",
  source: "manual" as const,
  content: "关联多个项目节点的工作记录",
};

describe("createWorkSessionSchema project-node associations", () => {
  it("keeps the primary node and every auxiliary node in an explicit fact payload", () => {
    const parsed = createWorkSessionSchema.parse({
      ...baseInput,
      primaryProjectNodeId: primaryNodeId,
      projectNodeIds: [primaryNodeId, auxiliaryNodeId],
    });

    expect(parsed.primaryProjectNodeId).toBe(primaryNodeId);
    expect(parsed.projectNodeIds).toEqual([primaryNodeId, auxiliaryNodeId]);
  });

  it("rejects ambiguous, repeated, or missing-primary associations", () => {
    for (const input of [
      { ...baseInput, projectNodeIds: [primaryNodeId] },
      {
        ...baseInput,
        primaryProjectNodeId: primaryNodeId,
        projectNodeIds: [primaryNodeId, primaryNodeId],
      },
      {
        ...baseInput,
        primaryProjectNodeId: primaryNodeId,
        projectNodeIds: [auxiliaryNodeId],
      },
    ]) {
      expect(createWorkSessionSchema.safeParse(input).success).toBe(false);
    }
  });

  it("keeps a generous but bounded number of independently validated breaks", () => {
    const breakAt = (index: number) => {
      const start = new Date("2026-09-02T01:00:00.000Z");
      start.setUTCMinutes(index * 2);
      const end = new Date(start.getTime() + 60_000);
      return { startAt: start.toISOString(), endAt: end.toISOString() };
    };
    expect(
      createWorkSessionSchema.safeParse({
        ...baseInput,
        endAt: "2026-09-03T08:00:00.000Z",
        breaks: Array.from({ length: 100 }, (_, index) => breakAt(index)),
      }).success,
    ).toBe(true);
    expect(
      createWorkSessionSchema.safeParse({
        ...baseInput,
        endAt: "2026-09-03T08:00:00.000Z",
        breaks: Array.from({ length: 101 }, (_, index) => breakAt(index)),
      }).success,
    ).toBe(false);
  });
});
