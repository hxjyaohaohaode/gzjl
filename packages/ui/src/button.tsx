import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./lib/cn.js";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_7px_15px_rgb(25_94_76_/_0.16)] hover:brightness-95 hover:shadow-[0_9px_20px_rgb(25_94_76_/_0.22)] active:translate-y-px",
        secondary:
          "border border-[var(--border)] bg-[var(--surface)] text-[var(--text)] shadow-[0_1px_1px_rgb(16_24_40_/_0.02)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-raised)]",
        ghost:
          "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]",
        danger: "bg-[var(--danger)] text-[var(--danger-foreground)] hover:brightness-95",
      },
      size: {
        default: "h-10",
        compact: "h-[2.125rem] min-h-[2.125rem] rounded-lg px-3 text-xs",
        icon: "size-10 px-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
