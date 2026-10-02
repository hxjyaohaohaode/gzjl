/** @vitest-environment jsdom */
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInteractionController, type InteractionSnapshot } from "./interaction-controller.js";

let client: QueryClient;
let stop: () => void;
let states: InteractionSnapshot[];
beforeEach(() => {
  client = new QueryClient(); states = [];
  document.body.innerHTML = '<section data-ui="card"><form id="a"><input required value="private-pay-value"><button type="button">Save</button></form><form id="b"><button type="button">Other</button></form><strong data-ui="metric">20.00</strong></section>';
  stop = createInteractionController(document.body, client, (snapshot) => states.push(snapshot));
});
afterEach(() => { stop(); client.clear(); document.body.innerHTML = ""; vi.useRealTimers(); });
const button = (id = "a") => document.querySelector<HTMLButtonElement>(`#${id} button`)!;
const form = (id = "a") => document.getElementById(id)!;

it("registers dynamically mounted controls and never records their values", async () => {
  const input = document.querySelector("input")!;
  expect(input.dataset.interactionKind).toBe("field");
  const next = document.createElement("button"); form().append(next);
  await Promise.resolve(); expect(next.dataset.interactionId).toBeTruthy();
  expect(new Set([...document.querySelectorAll<HTMLElement>("[data-interaction-id]")].map((element) => element.dataset.interactionId)).size).toBe(document.querySelectorAll("[data-interaction-id]").length);
  button().click();
  await client.getMutationCache().build(client, { mutationFn: async () => ({ secret: "server-private-data" }) }).execute(undefined);
  expect(JSON.stringify(states)).not.toMatch(/private-pay-value|server-private-data|Save/);
});
it("follows the actual promise and awaited reconciliation before showing completion", async () => {
  let finish!: () => void;
  let reconcile!: () => void;
  const mutation = client.getMutationCache().build(client, { mutationFn: () => new Promise<void>((resolve) => { finish = resolve; }), onSuccess: () => new Promise<void>((resolve) => { reconcile = resolve; }) });
  button().click(); const result = mutation.execute(undefined);
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(form().dataset.operationState).toBe("pending");
  finish(); await vi.waitFor(() => expect(reconcile).toBeDefined());
  expect(states.at(-1)?.status).toBe("pending");
  reconcile(); await result;
  expect(form().dataset.operationState).toBe("success"); expect(states.at(-1)?.pending).toBe(0);
});
it("keeps concurrent regions independent and does not turn a rejection into success", async () => {
  let finish!: () => void;
  button().click(); const first = client.getMutationCache().build(client, { mutationFn: () => new Promise<void>((resolve) => { finish = resolve; }) }).execute(undefined);
  await vi.waitFor(() => expect(finish).toBeDefined());
  button("b").click();
  await expect(client.getMutationCache().build(client, { mutationFn: async () => { throw new Error("private server failure"); } }).execute(undefined)).rejects.toThrow();
  expect(form("b").dataset.operationState).toBe("error");
  expect(form().dataset.operationState).toBe("pending"); expect(states.at(-1)?.pending).toBe(1);
  finish(); await first; expect(states.at(-1)?.pending).toBe(0);
});
it("ignores ordinary clicks and disabled controls as completed writes", async () => {
  button().click(); expect(states).toEqual([]);
  button().disabled = true;
  button().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(button().disabled).toBe(true);
});
it("clears pending feedback on account cache reset and ignores late completion", async () => {
  let finish!: () => void;
  button().click(); const result = client.getMutationCache().build(client, { mutationFn: () => new Promise<void>((resolve) => { finish = resolve; }) }).execute(undefined);
  await vi.waitFor(() => expect(finish).toBeDefined());
  client.clear();
  expect(states.at(-1)?.pending).toBe(0); expect(states.at(-1)?.status).toBe("idle");
  expect(form().dataset.operationState).toBeUndefined();
  finish(); await result;
  expect(form().dataset.operationState).toBeUndefined(); expect(states.at(-1)?.status).toBe("idle");
});
it("does not apply a late mutation result to a replacement editor", async () => {
  let finish!: () => void;
  button().click(); const result = client.getMutationCache().build(client, { mutationFn: () => new Promise<void>((resolve) => { finish = resolve; }) }).execute(undefined);
  await vi.waitFor(() => expect(finish).toBeDefined());
  form().remove(); const replacement = document.createElement("form"); replacement.id = "a"; document.body.append(replacement);
  finish(); await result; expect(replacement.dataset.operationState).toBeUndefined();
});
it("marks real metric updates without altering the rendered amount", async () => {
  const metric = document.querySelector<HTMLElement>('[data-ui="metric"]')!;
  metric.textContent = "168.19"; await Promise.resolve();
  expect(metric.dataset.valueUpdated).toBe("true"); expect(metric.textContent).toBe("168.19");
});
it("preserves native validity, and removes observers and metadata on cleanup", async () => {
  const input = document.querySelector("input")!; input.value = "";
  expect(input.checkValidity()).toBe(false); expect(input.dataset.fieldState).toBe("invalid");
  input.value = "valid"; input.dispatchEvent(new Event("input", { bubbles: true }));
  expect(input.dataset.fieldState).toBe("edited");
  stop(); expect(document.querySelectorAll("[data-interaction-id]")).toHaveLength(0);
  const next = document.createElement("button"); document.body.append(next); await Promise.resolve();
  expect(next.dataset.interactionId).toBeUndefined();
});
