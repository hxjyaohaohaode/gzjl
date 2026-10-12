import { reducedMotion, useMotionPreference } from "./motion-preference.js";
import { motion } from "motion/react";
import {
  Background,
  EdgeLabelRenderer,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  useNodesState,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  calculateNodeScheduleProgress,
  calculatePlannedHours,
} from "@workbench/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { GitBranch, Layers, Link2, Maximize2, Minus, Plus, Scan } from "lucide-react";

import "@xyflow/react/dist/style.css";

import { accessibleAccent } from "./color.js";
import { layoutProjectTree, PROJECT_COLUMN_STEP, PROJECT_NODE_HEIGHT, PROJECT_NODE_WIDTH, type ProjectLayoutDirection } from "./project-canvas-layout.js";

function HierarchyEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, data, markerEnd }: EdgeProps) {
  const { reduced } = useMotionPreference();
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 14 });
  const active = data?.pathActive === true;
  const depth = Number(data?.depth ?? 1);
  return <>
    <motion.path id={id} d={path} fill="none" markerEnd={markerEnd} className="react-flow__edge-path project-hierarchy-link" style={{ stroke: style?.stroke ?? "var(--project-accent)", strokeWidth: style?.strokeWidth ?? 1.5, opacity: style?.opacity ?? 1 }}
      initial={{ pathLength: reduced ? 1 : 0 }} animate={{ pathLength: 1 }} transition={{ duration: reduced ? 0 : .42, delay: reduced ? 0 : Math.max(0, depth * .2 - .12) }} />
    {active && !reduced && [0, 1].map((index) => <circle className="project-path-pulse" r="3" fill="var(--project-accent)" key={index}>
      <animateMotion path={path} dur="3.333s" begin={`${index * -1.6665}s`} repeatCount="indefinite" />
      <animate attributeName="opacity" values="0;.9;0" dur="3.333s" begin={`${index * -1.6665}s`} repeatCount="indefinite" />
    </circle>)}
    {data?.relationshipLabel ? <EdgeLabelRenderer><span className="project-edge-label" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>{String(data.relationshipLabel)}</span></EdgeLabelRenderer> : null}
  </>;
}
const canvasEdgeTypes = { hierarchy: HierarchyEdge };

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
  workSummary?: {
    visibleSessionCount: number;
    timedSessionCount: number;
    visibleContributorCount: number;
    allocatedSeconds: number;
  };
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

function formatWorkDuration(seconds: number): string {
  if (seconds <= 0) return "0 小时";
  const hours = seconds / 3_600;
  return hours < 1 ? `${Math.max(1, Math.round(seconds / 60))} 分钟` : `${hours.toFixed(hours >= 10 ? 1 : 2)} 小时`;
}

export default function ProjectCanvas({
  nodes: allNodes,
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
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [infoVisible, setInfoVisible] = useState(false);
  const [minimapVisible, setMinimapVisible] = useState(false);
  const [showRelationships, setShowRelationships] = useState(false);
  const [direction, setDirection] = useState<ProjectLayoutDirection>(() => window.matchMedia("(max-width: 640px)").matches ? "vertical" : "horizontal");
  const [zoomPercent, setZoomPercent] = useState(100);
  const viewportMode = useRef<"readable" | "overview">("readable");
  const nodes = useMemo(() => {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    return allNodes.filter((node) => { let parent = node.parentId; const visited = new Set<string>(); while (parent && !visited.has(parent)) { if (collapsedIds.has(parent)) return false; visited.add(parent); parent = byId.get(parent)?.parentId ?? null; } return true; });
  }, [allNodes, collapsedIds]);
  const projectAccent = accessibleAccent(accent);
  const dense = nodes.length > 18;
  const veryDense = nodes.length > 40;
  const [focusRelationships, setFocusRelationships] = useState(false);
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const canvasRootRef = useRef<HTMLDivElement>(null);
  const ancestorEdges = useMemo(() => {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    const active = new Set<string>();
    let current = selectedNodeId ? byId.get(selectedNodeId) : undefined;
    while (current?.parentId && !active.has(current.id)) { active.add(current.id); current = byId.get(current.parentId); }
    return active;
  }, [allNodes, selectedNodeId]);
  const nodeDepths = useMemo(() => {
    const byId = new Map(allNodes.map((node) => [node.id, node]));
    return new Map(allNodes.map((node) => { const seen = new Set<string>(); let current: ProjectCanvasNode | undefined = node; while (current?.parentId && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.parentId); } return [node.id, seen.size]; }));
  }, [allNodes]);
  const relatedNodeIds = useMemo(() => {
    if (!selectedNodeId) return new Set<string>();
    const ids = new Set<string>([selectedNodeId]);
    const byId = new Map(nodes.map((node) => [node.id, node]));
    let parentId = byId.get(selectedNodeId)?.parentId ?? null;
    while (parentId && !ids.has(parentId)) {
      ids.add(parentId);
      parentId = byId.get(parentId)?.parentId ?? null;
    }
    nodes.forEach((node) => {
      if (node.parentId === selectedNodeId) ids.add(node.id);
    });
    edges.forEach((edge) => {
      if (edge.sourceNodeId === selectedNodeId) ids.add(edge.targetNodeId);
      if (edge.targetNodeId === selectedNodeId) ids.add(edge.sourceNodeId);
    });
    return ids;
  }, [edges, nodes, selectedNodeId]);
  const focusActive = focusRelationships && Boolean(selectedNodeId);
  const flowNodes = useMemo<Node[]>(() => {
    const positions = layoutProjectTree(nodes, direction);
    const directChildCount = new Map<string, number>();
    allNodes.forEach((node) => {
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
      const relationCount = edges.filter(
        (edge) => edge.sourceNodeId === node.id || edge.targetNodeId === node.id,
      ).length;
      const scheduleProgress = calculateNodeScheduleProgress(node);
      const plannedHours = calculatePlannedHours(node);
      const responsible = node.assignees?.find((assignee) => assignee.isResponsible) ?? node.assignees?.[0];
      return {
        id: node.id,
        ariaLabel: `${node.title}，${statusLabel(node.status)}，进度 ${progress}%${childCount ? `，${childCount} 个直接子节点` : "，末级节点"}`,
        position,
        data: {
          label: (
            <div
              title={node.title}
              className={`project-flow-node ${!node.parentId ? "is-root" : ""} project-flow-node--${node.status} ${selectedNodeId === node.id ? "is-selected" : ""}`}
              style={{ "--node-accent": nodeAccent, "--node-entrance-delay": `${(nodeDepths.get(node.id) ?? 0) * .2 + .18}s` } as CSSProperties}
            >
              <div className="project-flow-node-top">
                {childCount > 0 && <button className="nodrag nopan project-node-collapse" type="button" aria-label={`${collapsedIds.has(node.id) ? "展开" : "收起"} ${node.title} 的子节点`} aria-expanded={!collapsedIds.has(node.id)} onClick={(event) => { event.stopPropagation(); setCollapsedIds((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; }); }}>{collapsedIds.has(node.id) ? "+" : "−"}</button>}
                <span className="project-flow-node-kind" title={node.branchName}>
                  {nodeTypeLabel(node.type)}{!node.parentId ? " · 起点" : ""}
                </span>
                <strong className="text-[0.74rem] tabular-nums text-[var(--node-accent)]">
                  {progress}%
                </strong>
              </div>
              <p className="project-flow-node-title">{node.title}</p>
              {!dense && node.description ? (
                <p className="project-flow-node-description">{node.description}</p>
              ) : null}
              <div className="project-flow-node-progress">
                <span style={{ width: `${progress}%` }} />
              </div>
              {!veryDense ? <div className="project-flow-node-schedule">
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
              </div> : null}
              <div className="project-flow-node-assignees">
                <span title={`${progressModeLabel(node.progressMode)} · 权重 ${Number(node.weight ?? 1)}`}>{responsible?.displayName ?? "待分配负责人"}</span>
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
                  <span />
                )}
              </div>
              <div className="project-flow-node-footer">
                <span>
                  {statusLabel(node.status)} · {childCount ? `${childCount} 个子节点` : "末级节点"}{relationCount ? ` · ${relationCount} 条关联` : ""}
                </span>
                <span>
                  v{node.version}
                </span>
              </div>
              {!dense ? <div className="project-flow-node-work">
                <span>实际投入</span>
                <strong>{formatWorkDuration(node.workSummary?.allocatedSeconds ?? 0)}</strong>
                <small>
                  {node.workSummary?.visibleSessionCount ?? 0} 条关联记录
                  {(node.workSummary?.timedSessionCount ?? 0) <
                  (node.workSummary?.visibleSessionCount ?? 0)
                    ? " · 部分工时受权限保护"
                    : " · 已按关联比例分摊"}
                </small>
              </div> : null}
              {canManage ? (
                <div className="nodrag nopan project-flow-node-actions" aria-label={`${node.title} 快捷操作`}>
                  <button
                    aria-label={`在 ${node.title} 下新建子节点`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddChild?.(node);
                    }}
                    title="新增下级节点"
                    type="button"
                  ><Plus size={15} /></button>
                  <button
                    aria-label={`从 ${node.title} 建立节点关联`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onAddRelation?.(node);
                    }}
                    title="建立节点关联"
                    type="button"
                  ><Link2 size={15} /></button>
                  <button
                    aria-label={`从 ${node.title} 卡片快捷派生工作线`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onDeriveBranch?.(node);
                    }}
                    title="派生并行工作线"
                    type="button"
                  ><GitBranch size={15} /></button>
                </div>
              ) : null}
            </div>
          ),
        },
        style: {
          background: "transparent",
          border: "none",
          opacity: focusActive && !relatedNodeIds.has(node.id) ? 0.16 : 1,
          padding: 0,
          width: PROJECT_NODE_WIDTH,
          height: PROJECT_NODE_HEIGHT,
        },
        sourcePosition: direction === "horizontal" ? Position.Right : Position.Bottom,
        targetPosition: direction === "horizontal" ? Position.Left : Position.Top,
      };
    });
  }, [
    canManage,
    allNodes,
    collapsedIds,
    dense,
    direction,
    edges,
    focusActive,
    nodes,
    nodeDepths,
    onAddChild,
    onAddRelation,
    onDeriveBranch,
    projectAccent,
    relatedNodeIds,
    selectedNodeId,
    veryDense,
  ]);

  const [canvasNodes, setCanvasNodes, onNodesChange] = useNodesState(flowNodes);
  const readableView = useCallback((duration: number, usePlannedPositions = false) => {
    const instance = flowInstanceRef.current, stage = canvasRootRef.current;
    if (!instance || !stage || !flowNodes.length) return;
    viewportMode.current = "readable";
    const visible = new Set(nodes.map((node) => node.id));
    const roots = nodes.filter((node) => !node.parentId || !visible.has(node.parentId));
    const childCount = (id: string) => nodes.filter((node) => node.parentId === id).length;
    roots.sort((a, b) => childCount(b.id) - childCount(a.id) || a.sortOrder - b.sortOrder);
    const preferred = flowNodes.find((node) => node.id === selectedNodeId) ?? flowNodes.find((node) => node.id === roots[0]?.id) ?? flowNodes[0]!;
    const primary = usePlannedPositions ? preferred : instance.getNode(preferred.id) ?? preferred;
    const zoom = Math.max(.75, Math.min(1, (stage.clientWidth - 40) / PROJECT_NODE_WIDTH));
    const childSpace = direction === "horizontal" && stage.clientWidth >= 720 && childCount(primary.id) ? PROJECT_COLUMN_STEP / 2 : 0;
    void instance.setViewport({
      x: stage.clientWidth / 2 - (primary.position.x + PROJECT_NODE_WIDTH / 2 + childSpace) * zoom,
      y: direction === "horizontal" ? stage.clientHeight / 2 - (primary.position.y + PROJECT_NODE_HEIGHT / 2) * zoom : Math.max(24, stage.clientHeight * .08) - primary.position.y * zoom,
      zoom,
    }, { duration: reducedMotion() ? 0 : duration });
  }, [direction, flowNodes, nodes, selectedNodeId]);
  const previousNodeSet = useRef(`${direction}:${flowNodes.map((node) => node.id).join("|")}`);

  useEffect(() => {
    const nextNodeSet = `${direction}:${flowNodes.map((node) => node.id).join("|")}`;
    const structureChanged = previousNodeSet.current !== nextNodeSet;
    previousNodeSet.current = nextNodeSet;
    setCanvasNodes((currentNodes) => {
      const currentById = new Map(currentNodes.map((node) => [node.id, node]));
      return flowNodes.map((node) => {
        const current = currentById.get(node.id);
        return current && !structureChanged
          ? { ...current, ...node, position: current.position }
          : node;
      });
    });
    if (!structureChanged) return;
    const frame = window.requestAnimationFrame(() => {
      if (viewportMode.current === "overview") void flowInstanceRef.current?.fitView({ padding: .12, minZoom: .04, maxZoom: 1, duration: reducedMotion() ? 0 : 620 });
      else readableView(620, true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [direction, flowNodes, readableView, setCanvasNodes]);

  const flowEdges = useMemo<Edge[]>(
    () => {
      const visibleNodeIds = new Set(nodes.map((node) => node.id));
      const pairKey = (source: string, target: string) => [source, target].sort().join("::");
      const byId = new Map(nodes.map((node) => [node.id, node]));
      // Only a child depending on its actual parent shares the hierarchy direction.
      // Other relation types and reverse dependencies keep their own arrows and states.
      const coalescedRelationshipIds = new Set(edges.filter((edge) => edge.type === "depends_on" && byId.get(edge.sourceNodeId)?.parentId === edge.targetNodeId).map((edge) => edge.id));
      const hierarchy = nodes
        .filter(
          (node) =>
            node.parentId &&
            visibleNodeIds.has(node.parentId),
        )
        .map((node) => ({
          id: `hierarchy-${node.id}`,
          source: node.parentId!,
          target: node.id,
          type: "hierarchy",
          className: ancestorEdges.has(node.id) ? "project-hierarchy-active" : "",
          data: {
            pathActive: ancestorEdges.has(node.id), depth: nodeDepths.get(node.id) ?? 1,
            relationshipLabel: showRelationships || node.id === selectedNodeId || node.parentId === selectedNodeId
              ? [...new Set(edges.filter((edge) => coalescedRelationshipIds.has(edge.id) && pairKey(edge.sourceNodeId, edge.targetNodeId) === pairKey(node.id, node.parentId!)).map((edge) => `${relationshipLabel(edge.type)}${edge.label ? ` · ${edge.label}` : ""}`))].join(" / ") : "",
          },
          ...(edges.some((edge) => coalescedRelationshipIds.has(edge.id) && edge.sourceNodeId === node.id) && (showRelationships || node.id === selectedNodeId || node.parentId === selectedNodeId)
            ? { markerEnd: { type: MarkerType.ArrowClosed, color: projectAccent } } : {}),
          style: {
            stroke: ancestorEdges.has(node.id) ? projectAccent : "color-mix(in srgb, var(--project-accent) 28%, var(--border))",
            strokeWidth: ancestorEdges.has(node.id) ? 2.2 : 1.5,
            opacity:
              focusActive &&
              (!relatedNodeIds.has(node.parentId!) || !relatedNodeIds.has(node.id))
                ? 0.1
                : 1,
          },
        }));
      const seenRelationships = new Set<string>();
      const relationships = edges.flatMap((edge) => {
        if (!visibleNodeIds.has(edge.sourceNodeId) || !visibleNodeIds.has(edge.targetNodeId)) return [];
        if (coalescedRelationshipIds.has(edge.id)) return [];
        if (!showRelationships && edge.sourceNodeId !== selectedNodeId && edge.targetNodeId !== selectedNodeId) return [];
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
          label: `${relationshipLabel(edge.type)}${edge.label ? ` · ${edge.label}` : ""}`,
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
            opacity:
              focusActive &&
              (!relatedNodeIds.has(edge.sourceNodeId) || !relatedNodeIds.has(edge.targetNodeId))
                ? 0.08
                : blocks
                  ? 0.92
                  : structural
                    ? 0.58
                    : 0.76,
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
    [ancestorEdges, edges, focusActive, nodes, nodeDepths, projectAccent, relatedNodeIds, selectedNodeId, showRelationships],
  );

  const focusCanvasNode = (id: string) => {
    const instance = flowInstanceRef.current, node = instance?.getNode(id);
    if (!instance || !node) return;
    void instance.setCenter(node.position.x + PROJECT_NODE_WIDTH / 2, node.position.y + PROJECT_NODE_HEIGHT / 2, { zoom: Math.max(1, instance.getZoom()), duration: reducedMotion() ? 0 : 550 })
      .then(() => canvasRootRef.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
  };

  const overview = () => {
    viewportMode.current = "overview";
    void flowInstanceRef.current?.fitView({ padding: .12, minZoom: .04, maxZoom: 1, duration: reducedMotion() ? 0 : 620 });
  };
  const resetLayout = () => {
    setCanvasNodes(flowNodes);
    window.requestAnimationFrame(() =>
      viewportMode.current === "overview" ? overview() : readableView(620, true),
    );
  };

  return (
    <div
      className="project-canvas"
      data-direction={direction}
      style={{ "--project-accent": projectAccent, "--project-node-height": `${PROJECT_NODE_HEIGHT}px` } as CSSProperties}
    >
      <div className="project-canvas-heading">
        <div><Layers size={16} /><strong>项目结构</strong><span>{nodes.length}{nodes.length !== allNodes.length ? ` / ${allNodes.length}` : ""} 个节点</span></div>
        <div className="project-canvas-orientation" role="group" aria-label="画布排布方向"><button type="button" aria-pressed={direction === "horizontal"} onClick={() => setDirection("horizontal")}>横向</button><button type="button" aria-pressed={direction === "vertical"} onClick={() => setDirection("vertical")}>纵向</button></div>
      </div>
      <div className="project-canvas-stage" ref={canvasRootRef} onKeyDownCapture={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,input,select,textarea")) return;
        const wrapper = target.closest<HTMLElement>(".react-flow__node"), current = nodes.find((node) => node.id === wrapper?.dataset.id);
        if (!current || !["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Enter"].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation();
        if (event.key === "Enter") { focusCanvasNode(current.id); return; }
        const siblings = canvasNodes.filter((node) => nodeDepths.get(node.id) === nodeDepths.get(current.id)).sort((left, right) => direction === "horizontal" ? left.position.y - right.position.y : left.position.x - right.position.x);
        const index = siblings.findIndex((node) => node.id === current.id);
        const next = event.key === "ArrowUp" ? current.parentId : event.key === "ArrowDown" ? nodes.find((node) => node.parentId === current.id)?.id : siblings[index + (event.key === "ArrowRight" ? 1 : -1)]?.id;
        if (next) { onNodeSelect?.(next); focusCanvasNode(next); }
      }}><ReactFlow
        edges={flowEdges}
        edgeTypes={canvasEdgeTypes}
        elementsSelectable
        nodes={canvasNodes}
        nodesConnectable={false}
        nodesDraggable
        onlyRenderVisibleElements
        minZoom={0.04}
        maxZoom={2.5}
        onNodeClick={(_, node) => onNodeSelect?.(node.id)}
        onNodeDoubleClick={(_, node) => focusCanvasNode(node.id)}
        onNodesChange={onNodesChange}
        onInit={(instance) => {
          flowInstanceRef.current = instance;
          readableView(0);
        }}
        onMoveEnd={(_, viewport) => setZoomPercent(Math.round(viewport.zoom * 100))}
        panOnDrag
        panOnScroll
        preventScrolling
        selectionOnDrag={false}
        zoomOnPinch
        zoomActivationKeyCode={["Control", "Meta"]}
        zoomOnScroll={false}
        zoomOnDoubleClick={false}
      >
        <Background color="var(--border)" gap={22} size={1} />
        {infoVisible && <Panel className="project-flow-legend" position="bottom-left">
          <button type="button" aria-label="隐藏画布信息" onClick={() => setInfoVisible(false)}>关闭信息 ×</button>
          <strong>{nodes.length} / {allNodes.length} 个可见节点</strong>
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
          <small>拖动节点排布 · 空白处拖拽 / 滚轮平移 · Ctrl / ⌘ + 滚轮缩放 · 双击聚焦 · 方向键切换层级</small>
        </Panel>}
        {minimapVisible && <MiniMap
          maskColor="color-mix(in srgb, var(--canvas) 70%, transparent)"
          nodeColor={() => projectAccent}
          pannable
          zoomable
        />}
      </ReactFlow>{!infoVisible && <div className="project-canvas-hint" aria-hidden="true">拖动画布 · 双击节点聚焦<span>Ctrl / ⌘ + 滚轮缩放</span></div>}</div>
      <div className="project-flow-tools project-flow-dock" role="toolbar" aria-label="结构画布工具">
        <div className="project-canvas-zoom"><button type="button" aria-label="缩小画布" onClick={() => void flowInstanceRef.current?.zoomOut({ duration: reducedMotion() ? 0 : 340 })}><Minus size={15} /></button><output aria-label="当前缩放比例">{zoomPercent}%</output><button type="button" aria-label="放大画布" onClick={() => void flowInstanceRef.current?.zoomIn({ duration: reducedMotion() ? 0 : 340 })}><Plus size={15} /></button></div>
        <button type="button" onClick={() => readableView(550)}><Scan size={14} />可读视图</button>
        <button type="button" onClick={overview}><Maximize2 size={14} />查看全貌</button>
        <button type="button" aria-pressed={showRelationships} disabled={!edges.length} onClick={() => setShowRelationships((value) => !value)}>节点关联{edges.length ? ` · ${edges.length}` : ""}</button>
        <button type="button" aria-pressed={infoVisible} onClick={() => setInfoVisible((value) => !value)}>画布信息</button>
        <button type="button" aria-pressed={minimapVisible} onClick={() => setMinimapVisible((value) => !value)}>缩略图</button>
        <button onClick={resetLayout} type="button">自动重排</button>
        <button type="button" disabled={!selectedNodeId} onClick={() => { if (selectedNodeId) focusCanvasNode(selectedNodeId); }}>聚焦节点</button>
        <button aria-pressed={focusActive} disabled={!selectedNodeId} onClick={() => setFocusRelationships((value) => !value)} type="button">{focusActive ? "显示全部" : "聚焦关联"}</button>
        {dense ? <span>{veryDense ? "超紧凑视图" : "紧凑视图"}</span> : null}
      </div>
    </div>
  );
}
