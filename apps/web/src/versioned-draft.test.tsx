/** @vitest-environment jsdom */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useVersionedDraft } from "./versioned-draft.js";

let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useVersionedDraft<{ title: string }>>;
function Harness({ version, title }: { version: number; title: string }) {
  const draft = useVersionedDraft(version, { title });
  useLayoutEffect(() => { current = draft; });
  return <output>{draft.value.title}</output>;
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
const render = (version: number, title: string) => act(() => root.render(<Harness version={version} title={title} />));

describe("live versioned drafts", () => {
  it("refreshes pristine fields when the server version advances", () => {
    render(1, "旧内容"); render(2, "新内容");
    expect(current.value.title).toBe("新内容");
    expect(current.version).toBe(2);
    expect(current.dirty).toBe(false);
  });
  it("preserves edited input and its original expected version during live refresh", () => {
    render(1, "旧内容");
    act(() => current.setValue({ title: "我的草稿" }));
    render(2, "他人的修改");
    expect(current.value.title).toBe("我的草稿");
    expect(current.version).toBe(1);
    expect(current.conflict).toBe(true);
    act(() => current.acceptLatest());
    expect(current.value.title).toBe("他人的修改");
    expect(current.version).toBe(2);
    expect(current.conflict).toBe(false);
  });
  it("does not replace a just-saved draft with a stale query response", () => {
    render(1, "旧内容");
    act(() => current.saved(2, { title: "已保存" }));
    render(1, "迟到的旧查询");
    expect(current.value.title).toBe("已保存");
    expect(current.version).toBe(2);
    render(3, "之后的新内容");
    expect(current.value.title).toBe("之后的新内容");
  });
  it("accepts newer fields after the user explicitly restores the original value", () => {
    render(1, "旧内容");
    act(() => current.setValue({ title: "草稿" }));
    render(2, "新内容");
    act(() => current.setValue({ title: "旧内容" }));
    expect(current.value.title).toBe("新内容");
    expect(current.conflict).toBe(false);
  });
});
