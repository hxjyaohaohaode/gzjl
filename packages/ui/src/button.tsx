import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "./lib/cn.js";

const buttonVariants = cva(
  "inline-flex min-h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold tracking-[-0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)] disabled:pointer-events-none disabled:opacity-45 motion-reduce:transition-none",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[var(--shadow-primary-action)] hover:brightness-95 hover:shadow-[var(--shadow-primary-action-hover)] active:translate-y-px",
        secondary:
          "bg-[var(--surface-subtle)] text-[var(--text)] shadow-none hover:bg-[var(--surface-raised)] hover:shadow-[0_6px_16px_rgb(30_41_59_/_0.06)]",
        ghost:
          "text-[var(--text-muted)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text)]",
        danger:
          "bg-[var(--danger)] text-[var(--danger-foreground)] hover:brightness-95",
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
  extends
    ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
