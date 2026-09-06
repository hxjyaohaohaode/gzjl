import { describe, expect, it } from "vitest";

import { summarizeProjectNodeWork } from "./service.js";

describe("project node work summaries", () => {
  const ownMembershipId = "00000000-0000-4000-8000-000000000001";
  const otherMembershipId = "00000000-0000-4000-8000-000000000002";
  const firstNodeId = "00000000-0000-4000-8000-000000000010";
  const emptyNodeId = "00000000-0000-4000-8000-000000000011";
  const rows = [
    {
      nodeId: firstNodeId,
      membershipId: ownMembershipId,
      netSeconds: 7_200,
      allocationBasisPoints: 5_000,
    },
    {
      nodeId: firstNodeId,
      membershipId: otherMembershipId,
      netSeconds: 3_600,
      allocationBasisPoints: 2_500,
    },
  ];

  it("applies each work-link allocation instead of counting full time on every node", () => {
    expect(
      summarizeProjectNodeWork(
        [firstNodeId, emptyNodeId],
        rows,
        ownMembershipId,
        true,
      ),
    ).toEqual([
      {
        nodeId: firstNodeId,
        visibleSessionCount: 2,
        timedSessionCount: 2,
        visibleContributorCount: 2,
        allocatedSeconds: 4_500,
      },
      {
        nodeId: emptyNodeId,
        visibleSessionCount: 0,
        timedSessionCount: 0,
        visibleContributorCount: 0,
        allocatedSeconds: 0,
      },
    ]);
  });

  it("counts visible coworker activity without leaking its duration", () => {
    expect(
      summarizeProjectNodeWork(
        [firstNodeId],
        rows,
        ownMembershipId,
        false,
      ),
    ).toEqual([
      {
        nodeId: firstNodeId,
        visibleSessionCount: 2,
        timedSessionCount: 1,
        visibleContributorCount: 2,
        allocatedSeconds: 3_600,
      },
    ]);
  });
});
