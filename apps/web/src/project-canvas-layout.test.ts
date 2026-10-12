import { describe, expect, it } from "vitest";
import { layoutProjectTree, PROJECT_NODE_HEIGHT, PROJECT_NODE_WIDTH, type ProjectLayoutDirection } from "./project-canvas-layout.js";

const node = (id: string, parentId: string | null, sortOrder = 0) => ({ id, parentId, sortOrder, title: id });

function expectNoOverlap(positions: Map<string, { x: number; y: number }>) {
  const values = [...positions.values()];
  for (let i = 0; i < values.length; i += 1) {
    expect(Number.isFinite(values[i]!.x) && Number.isFinite(values[i]!.y)).toBe(true);
    for (let j = i + 1; j < values.length; j += 1) {
      const a = values[i]!, b = values[j]!;
      expect(Math.abs(a.x - b.x) >= PROJECT_NODE_WIDTH || Math.abs(a.y - b.y) >= PROJECT_NODE_HEIGHT).toBe(true);
    }
  }
}

describe.each<ProjectLayoutDirection>(["horizontal", "vertical"])("%s project layout", (direction) => {
  it("keeps dense siblings, uneven descendants and parallel roots clear at the rendered card size", () => {
    const nodes = [node("root", null), ...Array.from({ length: 48 }, (_, i) => node(`task-${i}`, "root", i)), node("nested", "task-5"), node("parallel", null, 1), node("parallel-child", "parallel")];
    const positions = layoutProjectTree(nodes, direction);
    expect(positions.size).toBe(nodes.length);
    expectNoOverlap(positions);
    const root = positions.get("root")!, child = positions.get("task-0")!;
    expect(direction === "horizontal" ? child.x > root.x : child.y > root.y).toBe(true);
  });

  it("preserves sibling order without depending on API array order or mutating its input", () => {
    const nodes = [node("root", null), node("late", "root", 8), node("early", "root", 1), node("middle", "root", 4)];
    const before = JSON.stringify(nodes), positions = layoutProjectTree(nodes, direction);
    const reversed = layoutProjectTree([...nodes].reverse(), direction);
    expect(JSON.stringify(nodes)).toBe(before);
    for (const item of nodes) expect(reversed.get(item.id)).toEqual(positions.get(item.id));
    const axis = direction === "horizontal" ? "y" : "x";
    expect(positions.get("early")![axis]).toBeLessThan(positions.get("middle")![axis]);
    expect(positions.get("middle")![axis]).toBeLessThan(positions.get("late")![axis]);
  });

  it("keeps orphaned and legacy cyclic nodes reachable without a recursion failure", () => {
    const nodes = [node("orphan", "missing"), node("self", "self"), node("cycle-a", "cycle-b"), node("cycle-b", "cycle-a")];
    const positions = layoutProjectTree(nodes, direction);
    expect(positions.size).toBe(nodes.length);
    expectNoOverlap(positions);
  });
});
