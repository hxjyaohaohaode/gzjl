import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  Panel,
  ReactFlow,
  type Edge,
  type Node,
} from "@xyflow/react";
import { useMemo } from "react";
import type { CSSProperties } from "react";

import "@xyflow/react/dist/style.css";

import { accessibleAccent } from "./color.js";

interface ProjectCanvasNode {
  id: string;
  parentId: string | null;
  title: string;
  status: string;
  progress: string;
  version: number;
  sortOrder: number;
  type: string;
  progressMode?: "manual" | "weighted_children" | "milestone_based";
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
  if (status === "not_started") return "未开始";
  return status;
}

function progressModeLabel(mode: ProjectCanvasNode["progressMode"]): string {
  return mode === "weighted_children"
    ? "子节点"
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
  let nextRow = 0;

  const visit = (id: string, depth: number): { x: number; y: number } => {
    const known = positions.get(id);
    if (known) return known;
    if (visiting.has(id)) {
      const cycleFallback = { x: depth * 278, y: nextRow * 142 };
      nextRow += 1;
      return cycleFallback;
    }
    visiting.add(id);
    const childIds = sortIds(children.get(id) ?? []);
    const childPositions = childIds.map((childId) => visit(childId, depth + 1));
    const y = childPositions.length
      ? (childPositions[0]!.y + childPositions[childPositions.length - 1]!.y) / 2
      : nextRow++ * 142;
    const position = { x: depth * 278, y };
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
  selectedNodeId,
  onNodeSelect,
}: {
  nodes: ProjectCanvasNode[];
  edges: ProjectCanvasEdge[];
  accent?: string;
  selectedNodeId?: string | null;
  onNodeSelect?: (nodeId: string) => void;
}) {
  const projectAccent = accessibleAccent(accent);
  const flowNodes = useMemo<Node[]>(() => {
    const positions = layoutTree(nodes);

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
      return {
        id: node.id,
        position,
        data: {
          label: (
            <div
              className={`project-flow-node project-flow-node--${node.status} ${selectedNodeId === node.id ? "is-selected" : ""}`}
              style={{ "--node-accent": nodeAccent } as CSSProperties}
            >
              <div className="project-flow-node-top">
                <span className="project-flow-node-kind">{node.type}</span>
                <strong className="text-[0.68rem] tabular-nums text-[var(--node-accent)]">
                  {progress}%
                </strong>
              </div>
              <p className="project-flow-node-title">{node.title}</p>
              <div className="project-flow-node-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              <div className="project-flow-node-assignees">
                <span>{progressModeLabel(node.progressMode)}</span>
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
                <span>{statusLabel(node.status)}</span>
                <span>v{node.version}</span>
              </div>
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "none",
          padding: 0,
          width: 226,
        },
      };
    });
  }, [nodes, projectAccent, selectedNodeId]);

  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => {
        const blocks = edge.type === "blocks";
        const structural =
          edge.type === "replaces" || edge.type === "merges_into";
        const color = blocks
          ? "var(--danger)"
          : structural
            ? "var(--text-muted)"
            : projectAccent;
        return {
          id: edge.id,
          source: edge.sourceNodeId,
          target: edge.targetNodeId,
          label: edge.label ?? relationshipLabel(edge.type),
          animated: blocks,
          markerEnd: { type: MarkerType.ArrowClosed, color },
          style: {
            stroke: color,
            strokeWidth: blocks ? 2.2 : structural ? 1.25 : 1.65,
            strokeDasharray: structural ? "5 5" : undefined,
            opacity: blocks ? 0.92 : structural ? 0.58 : 0.76,
          },
          labelStyle: {
            fill: "var(--text-muted)",
            fontSize: 10,
            fontWeight: 700,
          },
          labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.94 },
        };
      }),
    [edges, projectAccent],
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
        onlyRenderVisibleElements
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
          <span>{edges.length} 条关系</span>
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
