/** @vitest-environment jsdom */
import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it } from "vitest";
import { useWorkspaceDraft } from "./workspace-draft.js";

let client: QueryClient, root: Root, container: HTMLDivElement;
let draft: ReturnType<typeof useWorkspaceDraft<{ rate: string }>>;
function Editor({ identity = "account-a", entity, version = 1, rate = "80" }: { identity?: string; entity: string; version?: number; rate?: string }) {
  const current = useWorkspaceDraft({ identity, entity, version, initial: { rate } });
  useLayoutEffect(() => { draft = current; });
  return <output>{current.value.rate}</output>;
}
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); client = new QueryClient(); container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); client.clear(); container.remove(); });
const render = async (entity: string, version = 1, identity = "account-a", rate = "80") => { await act(async () => { root.render(<QueryClientProvider client={client}><Editor entity={entity} version={version} identity={identity} rate={rate} /></QueryClientProvider>); }); };
const edit = async (rate: string) => { await act(async () => { draft.setValue({ rate }); await new Promise((resolve) => setTimeout(resolve, 0)); }); };
it("keeps independent member drafts across editor switches", async () => {
  await render("a"); await edit("168.19"); await render("b"); expect(draft.value.rate).toBe("80");
  await edit("95"); await render("a"); expect(draft.value.rate).toBe("168.19"); expect(draft.dirty).toBe(true);
});
it("requires explicit resolution when a remote version changes", async () => {
  await render("a"); await edit("95"); await render("a", 2, "account-a", "100");
  expect(draft.conflict).toBe(true); expect(draft.value.rate).toBe("95");
  await act(async () => { draft.discard(); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(draft.value.rate).toBe("100"); expect(draft.dirty).toBe(false);
});
it("a late save cannot remove a newer draft or a different member's input", async () => {
  await render("a"); await edit("95"); const saved = draft.saved;
  await edit("110"); await render("b"); await edit("120");
  await act(async () => { saved({ rate: "95" }); });
  expect(draft.value.rate).toBe("120"); await render("a"); expect(draft.value.rate).toBe("110");
});
it("isolates accounts and removes the saved snapshot without persisting salaries", async () => {
  await render("a"); await edit("168.19"); await render("a", 1, "account-b"); expect(draft.value.rate).toBe("80");
  await render("a"); await act(async () => { draft.saved({ rate: "168.19" }); await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(draft.dirty).toBe(false); expect(JSON.stringify(localStorage)).not.toContain("168.19"); expect(JSON.stringify(sessionStorage)).not.toContain("168.19");
});
