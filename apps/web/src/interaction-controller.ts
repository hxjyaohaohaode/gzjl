import type { QueryClient } from "@tanstack/react-query";

// Only DOM identity and operation state are retained, never input values,
// record contents, amounts, request bodies or server errors. Nothing is sent.
export const interactiveSelector = "button,a[href],input:not([type=hidden]),textarea,select,summary,[role=button],[role=tab],[role=switch]";
const surfaceSelector = "form,[data-ui=card],[role=dialog],article,[data-interaction-surface],.analytics-chart-frame,.project-node-inspector,.organization-inspector";
const trackedSelector = `${interactiveSelector},${surfaceSelector},details,[role=alert],[role=status],[data-ui=metric],[data-ui=badge],[role=progressbar]`;
export type OperationStatus = "idle" | "pending" | "success" | "error";
export interface InteractionSnapshot { pending: number; status: OperationStatus; revision: number }

export function createInteractionController(root: HTMLElement, client: QueryClient, publish: (snapshot: InteractionSnapshot) => void) {
  let sequence = 0, revision = 0;
  let origin: { element: HTMLElement; at: number } | undefined;
  const operations = new Map<number, { element?: HTMLElement; surface?: HTMLElement; status: OperationStatus }>();
  const timers = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const presses = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  const updates = new Map<HTMLElement, ReturnType<typeof setTimeout>>();
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let status: OperationStatus = "idle";
  const register = (element: HTMLElement) => {
    if (element.dataset.interactionId) return;
    element.dataset.interactionId = `ui-${++sequence}`;
    element.dataset.interactionKind = element.matches("[data-ui=metric],[data-ui=badge],[role=progressbar]") ? "value" : element.matches("input,textarea,select") ? "field"
      : element.matches("summary,details") ? "disclosure"
      : element.matches("[role=alert],[role=status]") ? "feedback"
      : element.matches(surfaceSelector) ? "surface" : "action";
  };
  const scan = (node: Node) => {
    if (!(node instanceof HTMLElement)) return;
    if (node.matches(trackedSelector)) register(node);
    node.querySelectorAll<HTMLElement>(trackedSelector).forEach(register);
  };
  scan(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach(scan);
      const parent = record.target instanceof HTMLElement ? record.target : record.target.parentElement;
      const metric = parent?.closest<HTMLElement>("[data-ui=metric],[data-ui=badge]");
      if (metric?.isConnected && !updates.has(metric)) {
        metric.dataset.valueUpdated = "true";
        updates.set(metric, setTimeout(() => { delete metric.dataset.valueUpdated; updates.delete(metric); }, 900));
      }
    }
    // Release detached feedback timers promptly on route/panel replacement.
    for (const [element, timer] of timers) if (!element.isConnected) { clearTimeout(timer); timers.delete(element); }
    for (const [element, timer] of updates) if (!element.isConnected) { clearTimeout(timer); updates.delete(element); }
  });
  observer.observe(root, { childList: true, characterData: true, subtree: true });
  const emit = () => publish({ pending: [...operations.values()].filter((item) => item.status === "pending").length, status, revision: ++revision });
  const pulse = (element: HTMLElement | undefined, value: OperationStatus) => {
    if (!element?.isConnected) return;
    const previous = timers.get(element); if (previous) clearTimeout(previous);
    element.dataset.operationState = value;
    if (value !== "pending") timers.set(element, setTimeout(() => { delete element.dataset.operationState; timers.delete(element); }, value === "error" ? 6000 : 2200));
  };
  const locate = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>(interactiveSelector) : null;
  const capture = (event: Event) => {
    const element = event.type === "submit" && event.target instanceof HTMLFormElement ? event.target : locate(event.target);
    if (!element || element.matches(":disabled,[aria-disabled=true]") || element.closest("fieldset:disabled")) return;
    register(element); origin = { element, at: performance.now() };
  };
  const press = (event: PointerEvent) => {
    const element = locate(event.target);
    if (!element || element.matches(":disabled,[aria-disabled=true],input,textarea,select") || element.closest("fieldset:disabled")) return;
    element.dataset.pressed = "true";
    const release = () => { delete element.dataset.pressed; presses.delete(element); };
    clearTimeout(presses.get(element));
    // No pointer capture: native drag, range and canvas behavior stay intact.
    presses.set(element, setTimeout(release, 500));
  };
  const releasePresses = () => { for (const [element, timer] of presses) { clearTimeout(timer); delete element.dataset.pressed; } presses.clear(); };
  const invalid = (event: Event) => {
    if (event.target instanceof HTMLElement) event.target.dataset.fieldState = "invalid";
  };
  const input = (event: Event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) {
      target.dataset.fieldState = target.validity.valid ? "edited" : target.dataset.fieldState === "invalid" ? "invalid" : "edited";
    }
  };
  root.addEventListener("click", capture, true);
  root.addEventListener("submit", capture, true);
  root.addEventListener("pointerdown", press, true);
  root.addEventListener("invalid", invalid, true);
  root.addEventListener("input", input, true);
  window.addEventListener("pointerup", releasePresses);
  window.addEventListener("pointercancel", releasePresses);
  const unsubscribe = client.getMutationCache().subscribe((event) => {
    if (event.type === "removed" && operations.has(event.mutation.mutationId)) {
      const operation = operations.get(event.mutation.mutationId)!;
      operations.delete(event.mutation.mutationId);
      for (const element of [operation.element, operation.surface]) {
        if (element && ![...operations.values()].some((item) => item.element === element || item.surface === element)) {
          clearTimeout(timers.get(element)); timers.delete(element); delete element.dataset.operationState;
        }
      }
      if (!operations.size) { clearTimeout(statusTimer); status = "idle"; }
      emit(); return;
    }
    if (event.type !== "updated") return;
    const mutation = event.mutation;
    const state = mutation.state.status;
    if (state === "pending" && !operations.has(mutation.mutationId)) {
      const element = origin && performance.now() - origin.at < 800 && origin.element.isConnected ? origin.element : undefined;
      origin = undefined;
      const surface = element?.closest<HTMLElement>(surfaceSelector) ?? undefined;
      operations.set(mutation.mutationId, { ...(element ? { element } : {}), ...(surface ? { surface } : {}), status: "pending" });
      pulse(element, "pending"); pulse(surface, "pending"); status = "pending";
      if (statusTimer) clearTimeout(statusTimer);
      emit();
    } else if ((state === "success" || state === "error") && operations.has(mutation.mutationId)) {
      const operation = operations.get(mutation.mutationId)!;
      operations.delete(mutation.mutationId);
      const elementStillPending = [...operations.values()].some((item) => item.element && item.element === operation.element);
      if (!elementStillPending) pulse(operation.element, state);
      const surfaceStillPending = [...operations.values()].some((item) => item.surface && item.surface === operation.surface);
      if (!surfaceStillPending) pulse(operation.surface, state);
      status = operations.size ? "pending" : state;
      emit();
      if (!operations.size) statusTimer = setTimeout(() => { status = "idle"; emit(); }, state === "error" ? 6000 : 3000);
    }
  });
  return () => {
    observer.disconnect(); unsubscribe(); clearTimeout(statusTimer);
    timers.forEach(clearTimeout); timers.clear(); operations.clear();
    updates.forEach(clearTimeout); updates.clear();
    releasePresses();
    window.removeEventListener("pointerup", releasePresses); window.removeEventListener("pointercancel", releasePresses);
    root.removeEventListener("click", capture, true); root.removeEventListener("submit", capture, true);
    root.removeEventListener("pointerdown", press, true); root.removeEventListener("invalid", invalid, true); root.removeEventListener("input", input, true);
    root.querySelectorAll<HTMLElement>("[data-interaction-id]").forEach((element) => {
      delete element.dataset.interactionId; delete element.dataset.interactionKind; delete element.dataset.operationState;
      delete element.dataset.pressed; delete element.dataset.fieldState;
      delete element.dataset.valueUpdated;
    });
  };
}
