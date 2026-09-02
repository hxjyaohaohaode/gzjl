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
          label: <div className="min-w-40"><p className="max-w-48 truncate text-sm font-semibold">{node.title}</p><p className="mt-1 text-xs text-slate-500">{node.status} · {Number(node.progress)}%</p></div>,
        },
        style: {
          borderRadius: 12,
          border: "1px solid var(--border)",
          background: "var(--surface)",
          color: "var(--text)",
          padding: 10,
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
        style: { stroke: "var(--accent)" },
      })),
    [edges],
  );

  return <div className="h-[560px] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-subtle)]"><ReactFlow edges={flowEdges} fitView nodes={flowNodes} nodesConnectable={false} nodesDraggable={false} proOptions={{ hideAttribution: true }}><Background gap={20} /><Controls /><MiniMap pannable zoomable /></ReactFlow></div>;
}
