export type ProjectProgressMode =
  | "manual"
  | "weighted_children"
  | "milestone_based";

export type ProjectProgressNodeType =
  | "phase"
  | "milestone"
  | "task"
  | "deliverable"
  | "decision";

export interface ProjectProgressNode {
  id: string;
  parentId: string | null;
  type: ProjectProgressNodeType;
  status: string;
  progress: number;
  progressMode: ProjectProgressMode;
  weight: number;
}

export class ProjectProgressCycleError extends Error {
  constructor() {
    super("项目层级存在循环，无法计算进度。");
    this.name = "ProjectProgressCycleError";
  }
}

function roundProgress(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 100) / 100));
}

/**
 * Calculates presentation-safe derived progress without mutating source data.
 * Manual nodes remain authoritative.  Weighted nodes use direct active
 * children; milestone nodes average active milestone descendants.  A zero
 * total weight deliberately falls back to an equal average instead of a NaN.
 */
export function calculateDerivedProjectProgress(
  sourceNodes: ProjectProgressNode[],
): Map<string, number> {
  const nodesById = new Map(sourceNodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, ProjectProgressNode[]>();
  sourceNodes.forEach((node) => {
    if (!node.parentId || !nodesById.has(node.parentId)) return;
    childrenByParentId.set(node.parentId, [
      ...(childrenByParentId.get(node.parentId) ?? []),
      node,
    ]);
  });

  const depthById = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (nodeId: string): number => {
    const cached = depthById.get(nodeId);
    if (cached !== undefined) return cached;
    if (visiting.has(nodeId)) throw new ProjectProgressCycleError();
    visiting.add(nodeId);
    const node = nodesById.get(nodeId);
    const depth =
      node?.parentId && nodesById.has(node.parentId)
        ? depthOf(node.parentId) + 1
        : 0;
    visiting.delete(nodeId);
    depthById.set(nodeId, depth);
    return depth;
  };

  const descendantsOf = (nodeId: string): ProjectProgressNode[] => {
    const descendants: ProjectProgressNode[] = [];
    const stack = [...(childrenByParentId.get(nodeId) ?? [])];
    while (stack.length) {
      const current = stack.pop();
      if (!current) continue;
      descendants.push(current);
      stack.push(...(childrenByParentId.get(current.id) ?? []));
    }
    return descendants;
  };

  const progressById = new Map(
    sourceNodes.map((node) => [node.id, roundProgress(node.progress)]),
  );
  const bottomUpNodes = [...sourceNodes].sort(
    (left, right) => depthOf(right.id) - depthOf(left.id),
  );

  for (const node of bottomUpNodes) {
    if (node.progressMode === "manual") continue;
    let computed: number | null = null;

    if (node.progressMode === "weighted_children") {
      const children = (childrenByParentId.get(node.id) ?? []).filter(
        (child) => child.status !== "cancelled",
      );
      if (children.length) {
        const totalWeight = children.reduce(
          (sum, child) => sum + Math.max(0, child.weight),
          0,
        );
        computed =
          totalWeight > 0
            ? children.reduce(
                (sum, child) =>
                  sum +
                  (progressById.get(child.id) ?? child.progress) *
                    Math.max(0, child.weight),
                0,
              ) / totalWeight
            : children.reduce(
                (sum, child) => sum + (progressById.get(child.id) ?? child.progress),
                0,
              ) / children.length;
      }
    } else {
      const milestones = descendantsOf(node.id).filter(
        (child) => child.type === "milestone" && child.status !== "cancelled",
      );
      if (milestones.length) {
        computed =
          milestones.reduce(
            (sum, milestone) =>
              sum +
              (milestone.status === "completed"
                ? 100
                : (progressById.get(milestone.id) ?? milestone.progress)),
            0,
          ) / milestones.length;
      }
    }

    if (computed !== null) {
      progressById.set(node.id, roundProgress(computed));
    }
  }

  return progressById;
}
