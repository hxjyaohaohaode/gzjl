import type { HTMLAttributes } from "react";

import { cn } from "./lib/cn.js";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      data-ui="card"
      className={cn(
        "rounded-[18px] bg-[var(--surface)] shadow-[var(--shadow-card)]",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="card-header"
      className={cn(
        "flex items-start justify-between gap-4 px-5 pt-5 pb-0 sm:px-6 sm:pt-6",
        className,
      )}
      {...props}
    />
  );
}

export function CardContent({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-ui="card-content"
      className={cn("p-5 sm:p-6", className)}
      {...props}
    />
  );
}
