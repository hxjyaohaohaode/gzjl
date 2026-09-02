import { Background, Controls, MiniMap, ReactFlow, type Edge, type Node } from "@xyflow/react";
import { useMemo } from "react";

import "@xyflow/react/dist/style.css";

interface ProjectCanvasNode {
  id: string;
  parentId: string | null;
  title: string;
  status: string;
  progress: string;
  version: number;
  sortOrder: number;
}

interface ProjectCanvasEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  type: string;
  label: string | null;
}

export default function ProjectCanvas({
  nodes,
  edges,
}: {
  nodes: ProjectCanvasNode[];
  edges: ProjectCanvasEdge[];
}) {
  const flowNodes = useMemo<Node[]>(() => {
    const positions = new Map<string, { depth: number; index: number }>();
    let sequence = 0;
    const visit = (parentId: string | null, depth: number) =>
      nodes
        .filter((node) => node.parentId === parentId)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .forEach((node) => {
          positions.set(node.id, { depth, index: sequence });
          sequence += 1;
          visit(node.id, depth + 1);
        });
    visit(null, 0);
    return nodes.map((node, fallbackIndex) => {
      const position = positions.get(node.id) ?? { depth: 0, index: fallbackIndex };
      return {
        id: node.id,
        position: { x: position.depth * 250, y: position.index * 92 },
        data: {
          label: <div className="min-w-44"><div className="flex items-center justify-between gap-3"><p className="max-w-44 truncate text-sm font-bold tracking-[-0.015em]">{node.title}</p><span className="text-[10px] font-bold text-[var(--accent-strong)]">{Number(node.progress)}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-subtle)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(0, Math.min(100, Number(node.progress)))}%` }} /></div><p className="mt-2 text-[11px] font-semibold text-[var(--text-muted)]">{node.status} · v{node.version}</p></div>,
        },
        style: {
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          padding: 12,
          boxShadow: "var(--shadow-card)",
        },
      };
    });
  }, [nodes]);
  const flowEdges = useMemo<Edge[]>(
    () =>
      edges.map((edge) => ({
        id: edge.id,
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        label: edge.label ?? edge.type,
        animated: edge.type === "blocks",
        style: { stroke: "var(--accent)", strokeWidth: 1.7, opacity: 0.75 },
        labelStyle: { fill: "var(--text-muted)", fontSize: 11, fontWeight: 650 },
        labelBgStyle: { fill: "var(--surface)", fillOpacity: 0.9 },
      })),
    [edges],
  );

  return <div className="project-canvas h-[min(64vh,620px)] min-h-[420px] overflow-hidden rounded-[18px] border border-[var(--border)] bg-[var(--surface-tint)]"><ReactFlow edges={flowEdges} fitView fitViewOptions={{ padding: 0.24 }} nodes={flowNodes} nodesConnectable={false} nodesDraggable={false} proOptions={{ hideAttribution: true }}><Background color="var(--border)" gap={22} size={1} /><Controls showInteractive={false} /><MiniMap maskColor="rgb(31 118 92 / 0.09)" pannable zoomable /></ReactFlow></div>;
}
