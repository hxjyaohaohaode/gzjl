import { motion } from "motion/react";
import { useId, type ReactNode } from "react";
import { useMotionPreference } from "./motion-preference.js";

export function StateTabs<T extends string>({ label, items, value, onChange }: { label: string; items: Array<{ value: T; label: ReactNode }>; value: T; onChange: (value: T) => void }) {
  const id = useId(); const { reduced } = useMotionPreference();
  return <div role="tablist" aria-label={label} className="fx-state-tabs" onKeyDown={(event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault(); const current = items.findIndex((item) => item.value === value);
    const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + items.length) % items.length;
    onChange(items[next]!.value); event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=tab]")[next]?.focus({ preventScroll: true });
  }}>{items.map((item) => <button type="button" role="tab" aria-selected={value === item.value} tabIndex={value === item.value ? 0 : -1} className={`fx-state-tab${value === item.value ? " is-active" : ""}`} key={item.value} onClick={() => onChange(item.value)}>
    {value === item.value && <motion.span layoutId={`state-tab-${id}`} className="workspace-selection-indicator" aria-hidden="true" transition={reduced ? { duration: 0 } : { duration: .52, ease: [.16,1,.3,1] }} />}
    <span className="workspace-selection-label">{item.label}</span>
  </button>)}</div>;
}
