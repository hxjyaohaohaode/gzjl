import type { HTMLAttributes } from "react";

import { cn } from "./lib/cn.js";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "positive" | "warning" | "danger" | "info";
}

const toneClasses: Record<NonNullable<BadgeProps["tone"]>, string> = {
  neutral: "bg-[var(--surface-subtle)] text-[var(--text-muted)]",
  positive: "bg-[var(--positive-soft)] text-[var(--positive)]",
  warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
  danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  info: "bg-[var(--info-soft)] text-[var(--info)]",
};

export function Badge({ className, tone = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center rounded-full border border-current/8 px-2.5 text-[11px] font-semibold tracking-[0.01em]",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
