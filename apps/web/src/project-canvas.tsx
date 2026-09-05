import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import {
  calculateNodeScheduleProgress,
  calculatePlannedHours,
} from "@workbench/shared";
import { useMemo } from "react";
import type { CSSProperties } from "react";

import "@xyflow/react/dist/style.css";

import { accessibleAccent } from "./color.js";

interface ProjectCanvasNode {
  id: string;
  branchId: string;
  parentId: string | null;
  title: string;
  description?: string | null;
  status: string;
  progress: string;
  weight?: string;
  version: number;
  sortOrder: number;
  type: string;
  progressMode?:
    | "manual"
    | "weighted_children"
    | "time_weighted_children"
    | "milestone_based";
  startAt?: string | null;
  dueAt?: string | null;
  branchName?: string;
  assignees?: Array<{
    membershipId: string;
    displayName: string;
    avatarUrl: string | null;
    isResponsible: boolean;
  }>;
}

interface ProjectCanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  label: string | null;
}

function statusLabel(status: string): string {
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "blocked") return "受阻";
  if (status === "in_review") return "待确认";
  if (status === "cancelled") return "已取消";
  if (status === "not_started") return "未开始";
  return status;
}

function nodeTypeLabel(type: string): string {
  return {
    phase: "阶段",
    milestone: "里程碑",
    task: "任务",
    deliverable: "交付物",
    decision: "决策",
  }[type] ?? type;
}

function progressModeLabel(mode: ProjectCanvasNode["progressMode"]): string {
  return mode === "weighted_children"
    ? "子节点"
    : mode === "time_weighted_children"
      ? "工期 × 权重"
    : mode === "milestone_based"
      ? "里程碑"
      : "手动";
}

function initials(displayName: string): string {
  return displayName.trim().slice(0, 2).toLocaleUpperCase() || "成员";
}

function relationshipLabel(type: string): string {
  return {
    depends_on: "依赖",
    blocks: "阻塞",
    relates_to: "关联",
    replaces: "替代",
    merges_into: "合并到",
  }[type] ?? type;
}

function layoutTree(nodes: ProjectCanvasNode[]): Map<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId || !byId.has(node.parentId) || node.parentId === node.id) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const sortIds = (ids: string[]) =>
    [...ids].sort((leftId, rightId) => {
      const left = byId.get(leftId)!;
      const right = byId.get(rightId)!;
      return left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN");
    });
  const positions = new Map<string, { x: number; y: number }>();
  const visiting = new Set<string>();
  let nextColumn = 0;

  const visit = (id: string, depth: number): { x: number; y: number } => {
    const known = positions.get(id);
    if (known) return known;
    if (visiting.has(id)) {
      const cycleFallback = { x: nextColumn * 306, y: depth * 236 };
      nextColumn += 1;
      return cycleFallback;
    }
    visiting.add(id);
    const childIds = sortIds(children.get(id) ?? []);
    const childPositions = childIds.map((childId) => visit(childId, depth + 1));
    const x = childPositions.length
      ? (childPositions[0]!.x + childPositions[childPositions.length - 1]!.x) / 2
      : nextColumn++ * 306;
    const position = { x, y: depth * 236 };
    positions.set(id, position);
    visiting.delete(id);
    return position;
  };

  const roots = sortIds(
    nodes
      .filter((node) => !node.parentId || !byId.has(node.parentId))
      .map((node) => node.id),
  );
  roots.forEach((id) => visit(id, 0));
  // The API rejects cycles, but retain a deterministic fallback so a damaged
  // legacy tree cannot make the entire canvas unusable.
  sortIds(nodes.map((node) => node.id))
    .filter((id) => !positions.has(id))
    .forEach((id) => visit(id, 0));
  return positions;
}

export default function ProjectCanvas({
  nodes,
  edges,
  accent,
  canManage = false,
  selectedNodeId,
  onAddChild,
  onAddRelation,
  onDeriveBranch,
  onNodeSelect,
}: {
  nodes: ProjectCanvasNode[];
  edges: ProjectCanvasEdge[];
  accent?: string;
  canManage?: boolean;
  selectedNodeId?: string | null;
  onAddChild?: (node: ProjectCanvasNode) => void;
  onAddRelation?: (node: ProjectCanvasNode) => void;
  onDeriveBranch?: (node: ProjectCanvasNode) => void;
  onNodeSelect?: (nodeId: string) => void;
}) {
  const projectAccent = accessibleAccent(accent);
  const flowNodes = useMemo<Node[]>(() => {
    const positions = layoutTree(nodes);
    const directChildCount = new Map<string, number>();
    nodes.forEach((node) => {
      if (!node.parentId) return;
      directChildCount.set(
        node.parentId,
        (directChildCount.get(node.parentId) ?? 0) + 1,
      );
    });

    return nodes.map((node, fallbackIndex) => {
      const position = positions.get(node.id) ?? { x: 0, y: fallbackIndex * 142 };
      const parsedProgress = Number(node.progress);
      const progress = Number.isFinite(parsedProgress)
        ? Math.max(0, Math.min(100, parsedProgress))
        : 0;
      const nodeAccent =
        node.status === "blocked"
          ? "var(--danger)"
          : node.status === "completed"
            ? "var(--success)"
            : projectAccent;
      const childCount = directChildCount.get(node.id) ?? 0;
      const scheduleProgress = calculateNodeScheduleProgress(node);
      const plannedHours = calculatePlannedHours(node);
      return {
        id: node.id,
        ariaLabel: `${node.title}，${statusLabel(node.status)}，进度 ${progress}%${childCount ? `，${childCount} 个直接子节点` : "，末级节点"}`,
        position,
        data: {
          label: (
            <div
              className={`project-flow-node project-flow-node--${node.status} ${selectedNodeId === node.id ? "is-selected" : ""}`}
              style={{ "--node-accent": nodeAccent } as CSSProperties}
            >
              <div className="project-flow-node-top">
                <span className="project-flow-node-kind">
                  {nodeTypeLabel(node.type)} · {node.branchName ?? "项目节点"}
                </span>
                <strong className="text-[0.74rem] tabular-nums text-[var(--node-accent)]">
                  {progress}%
                </strong>
              </div>
              <p className="project-flow-node-title">{node.title}</p>
              {node.description ? (
                <p className="project-flow-node-description">{node.description}</p>
              ) : null}
              <div className="project-flow-node-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="project-flow-node-schedule">
                <span>
                  <small>时间进度</small>
                  <strong>{scheduleProgress === null ? "未排期" : `${Math.round(scheduleProgress)}%`}</strong>
                </span>
                <i><span style={{ width: `${scheduleProgress ?? 0}%` }} /></i>
                <small>
                  {node.startAt || node.dueAt
                    ? `${node.startAt ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(node.startAt)) : "未定"} – ${node.dueAt ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(new Date(node.dueAt)) : "未定"}`
                    : "尚未设置开始与截止时间"}
                  {plannedHours === null ? "" : ` · ${Math.max(1, Math.round(plannedHours / 24))} 天`}
                </small>
              </div>
              <div className="project-flow-node-assignees">
                <span>{progressModeLabel(node.progressMode)} · 权重 {Number(node.weight ?? 1)}</span>
                {node.assignees?.length ? (
                  <span
                    aria-label={`协作者：${node.assignees.map((assignee) => assignee.displayName).join("、")}`}
                  >
                    {node.assignees.slice(0, 3).map((assignee) =>
                      assignee.avatarUrl ? (
                        <img
                          alt=""
                          className={assignee.isResponsible ? "is-responsible" : undefined}
                          key={assignee.membershipId}
                          src={assignee.avatarUrl}
                        />
                      ) : (
                        <i
                          className={assignee.isResponsible ? "is-responsible" : undefined}
                          key={assignee.membershipId}
                        >
                          {initials(assignee.displayName)}
                        </i>
                      ),
                    )}
                    {node.assignees.length > 3 ? (
                      <i>+{node.assignees.length - 3}</i>
                    ) : null}
                  </span>
                ) : (
                  <span>未分配</span>
                )}
              </div>
              <div className="project-flow-node-footer">
                <span>
                  {statusLabel(node.status)} · {childCount ? `${childCount} 个子节点` : "末级节点"}
                </span>
                <span>
                  v{node.version}
                </span>
              </div>
              {canManage ? (
                <div className="project-flow-node-actions" aria-label={`${node.title} 快捷操作`}>
                  <button
                    aria-label={`在 ${node.title} 下新建子节点`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChild?.(node);
                    }}
                    title="新增下级节点"
                    type="button"
                  >＋</button>
                  <button
                    aria-label={`从 ${node.title} 建立节点关联`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddRelation?.(node);
                    }}
                    title="建立节点关联"
                    type="button"
                  >↗</button>
                  <button
                    aria-label={`从 ${node.title} 派生工作线`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeriveBranch?.(node);
                    }}
                    title="派生并行工作线"
                    type="button"
                  >⑂</button>
                </div>
              ) : null}
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0,
          width: 246,
        },
        sourcePosition: Position.Bottom,
        targetPosition: Position.Top,
      };
    });
  }, [
    canManage,
    nodes,
    onAddChild,
    onAddRelation,
    onDeriveBranch,
    projectAccent,
    selectedNodeId,
  ]);

  const flowEdges = useMemo<Edge[]>(
    () => {
      const visibleNodeIds = new Set(nodes.map((node) => node.id));
      const relationPairKeys = new Set(
        edges.map((edge) =>
          [edge.sourceNodeId, edge.targetNodeId].sort().join("::"),
        ),
      );
      const hierarchy = nodes
        .filter(
          (node) =>
            node.parentId &&
            visibleNodeIds.has(node.parentId) &&
            !relationPairKeys.has([node.id, node.parentId].sort().join("::")),
        )
        .map((node) => ({
          id: `hierarchy-${node.id}`,
          source: node.parentId!,
          target: node.id,
          type: "smoothstep",
          style: {
            stroke: "color-mix(in srgb, var(--project-accent) 28%, var(--border))",
            strokeWidth: 1.8,
          },
        }));
      const seenRelationships = new Set<string>();
      const relationships = edges.flatMap((edge) => {
        const symmetricKey =
          edge.type === "relates_to"
            ? `${edge.type}:${[edge.sourceNodeId, edge.targetNodeId].sort().join("::")}`
            : `${edge.type}:${edge.sourceNodeId}:${edge.targetNodeId}`;
        if (seenRelationships.has(symmetricKey)) return [];
        seenRelationships.add(symmetricKey);
        const blocks = edge.type === "blocks";
        const structural =
          edge.type === "replaces" || edge.type === "merges_into";
        const color = blocks
          ? "var(--danger)"
          : structural
            ? "var(--text-muted)"
            : projectAccent;
        const source =
          edge.type === "depends_on" ? edge.targetNodeId : edge.sourceNodeId;
        const target =
          edge.type === "depends_on" ? edge.sourceNodeId : edge.targetNodeId;
        return [{
          id: `relation-${edge.id}`,
          source,
          target,
          label: edge.label ?? relationshipLabel(edge.type),
          animated: blocks,
          ...(edge.type === "relates_to"
            ? {}
            : { markerEnd: { type: MarkerType.ArrowClosed, color } }),
          style: {
            stroke: color,
            strokeWidth: blocks ? 2.2 : structural ? 1.25 : 1.65,
            ...(edge.type === "relates_to"
              ? { strokeDasharray: "3 5" }
              : structural
                ? { strokeDasharray: "5 5" }
                : {}),
            opacity: blocks ? 0.92 : structural ? 0.58 : 0.76,
          },
          labelStyle: {
            fill: "var(--text-muted)",
            fontSize: 10,
            fontWeight: 700,
          },
          labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.94 },
        }];
      });
      return [...hierarchy, ...relationships];
    },
    [edges, nodes, projectAccent],
  );

  return (
    <div
      className="project-canvas h-[min(66vh,660px)] min-h-[430px] touch-none overflow-hidden rounded-[18px] bg-[var(--surface)]"
      style={{ "--project-accent": projectAccent } as CSSProperties}
    >
      <ReactFlow
        edges={flowEdges}
        elementsSelectable
        fitView
        fitViewOptions={{ padding: 0.27 }}
        nodes={flowNodes}
        nodesConnectable={false}
        nodesDraggable={false}
        minZoom={0.15}
        maxZoom={2.5}
        onNodeClick={(_, node) => onNodeSelect?.(node.id)}
        panOnDrag
        panOnScroll
        preventScrolling
        selectionOnDrag={false}
        zoomOnPinch
        zoomOnDoubleClick={false}
      >
        <Background color="var(--border)" gap={22} size={1} />
        <Panel className="project-flow-legend" position="top-left">
          <strong>{nodes.length} 个节点</strong>
          <span>{nodes.filter((node) => node.parentId).length} 条层级</span>
          <span>{edges.length} 条关联</span>
          <span>
            完成 {nodes.filter((node) => node.status === "completed").length} · 受阻{" "}
            {nodes.filter((node) => node.status === "blocked").length}
          </span>
          <span className="project-flow-key">
            <i data-kind="dependency" />
            依赖
          </span>
          <span className="project-flow-key">
            <i data-kind="block" />
            阻塞
          </span>
          <small>拖拽空白处平移 · 滚轮缩放 · 点击节点查看详情</small>
        </Panel>
        <Controls showInteractive={false} />
        <MiniMap
          className="hidden md:block"
          maskColor="rgb(91 92 226 / 0.1)"
          nodeColor={() => projectAccent}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
