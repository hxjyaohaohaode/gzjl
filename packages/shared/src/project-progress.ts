export type ProjectProgressMode =
  | "manual"
  | "weighted_children"
  | "time_weighted_children"
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
  startAt?: Date | string | null;
  dueAt?: Date | string | null;
}

export interface ProjectProgressSummary {
  /** Weighted completion of active leaf nodes. */
  executionProgress: number;
  /** Elapsed schedule percentage for scheduled active leaf nodes. */
  scheduleProgress: number | null;
  leafCount: number;
  scheduledLeafCount: number;
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

function timestamp(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function explicitWeight(node: ProjectProgressNode): number {
  return Number.isFinite(node.weight) ? Math.max(0, node.weight) : 0;
}

/**
 * Returns the planned duration in hours. Missing or invalid schedules have no
 * duration weight; a zero-length milestone deliberately counts as one hour so
 * that it can still participate in a time-weighted rollup.
 */
export function calculatePlannedHours(
  node: Pick<ProjectProgressNode, "startAt" | "dueAt">,
): number | null {
  const start = timestamp(node.startAt);
  const due = timestamp(node.dueAt);
  if (start === null || due === null || due < start) return null;
  return Math.max(1, (due - start) / 3_600_000);
}

/** Pure schedule elapsed percentage. This never overwrites execution progress. */
export function calculateNodeScheduleProgress(
  node: Pick<ProjectProgressNode, "startAt" | "dueAt">,
  now: Date | string | number = new Date(),
): number | null {
  const start = timestamp(node.startAt);
  const due = timestamp(node.dueAt);
  const nowMs =
    now instanceof Date
      ? now.getTime()
      : typeof now === "number"
        ? now
        : Date.parse(now);
  if (
    start === null ||
    due === null ||
    due < start ||
    !Number.isFinite(nowMs)
  )
    return null;
  if (due === start) return nowMs < start ? 0 : 100;
  return roundProgress(((nowMs - start) / (due - start)) * 100);
}

function rollupWeight(
  node: ProjectProgressNode,
  includePlannedDuration: boolean,
): number {
  const base = explicitWeight(node);
  if (!includePlannedDuration) return base;
  return base * (calculatePlannedHours(node) ?? 1);
}

/**
 * Calculates presentation-safe derived progress without mutating source data.
 * Manual nodes remain authoritative.  Weighted nodes use direct active
 * children; time-weighted nodes multiply each explicit child weight by its
 * planned duration; milestone nodes average active milestone descendants. A
 * zero total weight deliberately falls back to an equal average instead of a
 * NaN.
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

    if (
      node.progressMode === "weighted_children" ||
      node.progressMode === "time_weighted_children"
    ) {
      const children = (childrenByParentId.get(node.id) ?? []).filter(
        (child) => child.status !== "cancelled",
      );
      if (children.length) {
        const includePlannedDuration =
          node.progressMode === "time_weighted_children";
        const totalWeight = children.reduce(
          (sum, child) =>
            sum + rollupWeight(child, includePlannedDuration),
          0,
        );
        computed =
          totalWeight > 0
            ? children.reduce(
                (sum, child) =>
                  sum +
                  (progressById.get(child.id) ?? child.progress) *
                    rollupWeight(child, includePlannedDuration),
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

/**
 * Produces project-level execution and schedule metrics without double
 * counting parent containers. Active leaf nodes are the work units. Execution
 * uses explicit weight multiplied by planned duration when available; schedule
 * progress uses the same basis but only includes fully scheduled leaves.
 */
export function calculateProjectProgressSummary(
  sourceNodes: ProjectProgressNode[],
  now: Date | string | number = new Date(),
): ProjectProgressSummary {
  const activeNodes = sourceNodes.filter((node) => node.status !== "cancelled");
  const activeIds = new Set(activeNodes.map((node) => node.id));
  const parentIds = new Set(
    activeNodes
      .map((node) => node.parentId)
      .filter((parentId): parentId is string => Boolean(parentId && activeIds.has(parentId))),
  );
  const leaves = activeNodes.filter((node) => !parentIds.has(node.id));
  if (!leaves.length) {
    return {
      executionProgress: 0,
      scheduleProgress: null,
      leafCount: 0,
      scheduledLeafCount: 0,
    };
  }

  const executionWeights = leaves.map((node) => rollupWeight(node, true));
  const executionWeightTotal = executionWeights.reduce((sum, weight) => sum + weight, 0);
  const executionProgress =
    executionWeightTotal > 0
      ? leaves.reduce(
          (sum, node, index) =>
            sum + roundProgress(node.progress) * executionWeights[index]!,
          0,
        ) / executionWeightTotal
      : leaves.reduce((sum, node) => sum + roundProgress(node.progress), 0) /
        leaves.length;

  const scheduled = leaves
    .map((node) => ({
      node,
      progress: calculateNodeScheduleProgress(node, now),
      weight: rollupWeight(node, true),
    }))
    .filter(
      (item): item is { node: ProjectProgressNode; progress: number; weight: number } =>
        item.progress !== null,
    );
  const scheduleWeightTotal = scheduled.reduce((sum, item) => sum + item.weight, 0);
  const scheduleProgress = scheduled.length
    ? scheduleWeightTotal > 0
      ? scheduled.reduce((sum, item) => sum + item.progress * item.weight, 0) /
        scheduleWeightTotal
      : scheduled.reduce((sum, item) => sum + item.progress, 0) / scheduled.length
    : null;

  return {
    executionProgress: roundProgress(executionProgress),
    scheduleProgress:
      scheduleProgress === null ? null : roundProgress(scheduleProgress),
    leafCount: leaves.length,
    scheduledLeafCount: scheduled.length,
  };
}
