import { useSyncExternalStore } from "react";
import { readPreference, writePreference } from "./browser-preferences.js";

export const MOTION_CHANGE = "workbench:motion-change";
const key = "workbench-motion";
export type MotionPreference = "full" | "reduced";
let current: MotionPreference = readPreference(key) === "reduced" ? "reduced" : "full";
export function motionPreference(): MotionPreference {
  return current;
}
export function reducedMotion() {
  return motionPreference() === "reduced" || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
export function setMotionPreference(value: MotionPreference) {
  current = value;
  writePreference(key, value);
  document.documentElement.dataset.motion = reducedMotion() ? "reduced" : "full";
  window.dispatchEvent(new Event(MOTION_CHANGE));
}
function subscribe(callback: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  const update = () => { document.documentElement.dataset.motion = reducedMotion() ? "reduced" : "full"; callback(); };
  const storage = (event: StorageEvent) => { if (event.key !== key) return; current = event.newValue === "reduced" ? "reduced" : "full"; update(); };
  media.addEventListener("change", update);
  window.addEventListener(MOTION_CHANGE, update);
  window.addEventListener("storage", storage);
  update();
  return () => { media.removeEventListener("change", update); window.removeEventListener(MOTION_CHANGE, update); window.removeEventListener("storage", storage); };
}
export function useMotionPreference() {
  const preference = useSyncExternalStore(subscribe, motionPreference);
  const reduced = useSyncExternalStore(subscribe, reducedMotion);
  return { preference, reduced, setPreference: setMotionPreference };
}
