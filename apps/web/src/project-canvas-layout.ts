export const PROJECT_NODE_WIDTH = 272;
export const PROJECT_NODE_HEIGHT = 200;
export const PROJECT_COLUMN_STEP = PROJECT_NODE_WIDTH + 80;

export type ProjectLayoutDirection = "horizontal" | "vertical";

interface LayoutNode {
  id: string;
  parentId: string | null;
  title: string;
  sortOrder: number;
}

// A single size contract keeps the rendered card, hit area and tree spacing aligned.
export function layoutProjectTree(nodes: LayoutNode[], direction: ProjectLayoutDirection) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId || node.parentId === node.id || !byId.has(node.parentId)) continue;
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node.id);
    children.set(node.parentId, siblings);
  }
  const sorted = (ids: string[]) => [...ids].sort((a, b) => {
    const left = byId.get(a)!, right = byId.get(b)!;
    return left.sortOrder - right.sortOrder || left.title.localeCompare(right.title, "zh-CN") || a.localeCompare(b);
  });
  const positions = new Map<string, { x: number; y: number }>();
  const visiting = new Set<string>();
  let nextRow = 0;
  const visit = (id: string, depth: number): { x: number; y: number } | null => {
    if (visiting.has(id)) return null;
    const known = positions.get(id);
    if (known) return known;
    visiting.add(id);
    const descendants = sorted(children.get(id) ?? [])
      .map((child) => visit(child, depth + 1))
      .filter((position): position is { x: number; y: number } => position !== null);
    const row = descendants.length
      ? ((direction === "horizontal" ? descendants[0]!.y + descendants.at(-1)!.y : descendants[0]!.x + descendants.at(-1)!.x) / 2)
      : nextRow++ * (direction === "horizontal" ? PROJECT_NODE_HEIGHT + 28 : PROJECT_NODE_WIDTH + 40);
    const position = direction === "horizontal"
      ? { x: depth * PROJECT_COLUMN_STEP, y: row }
      : { x: row, y: depth * (PROJECT_NODE_HEIGHT + 76) };
    positions.set(id, position);
    visiting.delete(id);
    return position;
  };
  const roots = sorted(nodes.filter((node) => !node.parentId || node.parentId === node.id || !byId.has(node.parentId)).map((node) => node.id));
  for (const id of roots) { visit(id, 0); nextRow += .5; }
  // Recover every node in a malformed legacy cycle without recursing forever.
  for (const id of sorted(nodes.map((node) => node.id))) {
    if (!positions.has(id)) { visit(id, 0); nextRow += .5; }
  }
  return positions;
}
