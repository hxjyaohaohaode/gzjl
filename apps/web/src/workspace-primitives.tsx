import { AlertCircle, LoaderCircle } from "lucide-react";
import { cloneElement, isValidElement, useId, type HTMLAttributes, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { Button } from "@workbench/ui";
import { workspacePage } from "./workspace-pages.js";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  const { pathname } = useLocation();
  const purpose = workspacePage(pathname).purpose || description;
  return (
    <header className="app-page-header flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      <div className="app-page-title">
        <h1 className="text-[28px] leading-none md:text-[34px]">{title}</h1>
        {purpose ? <p className="app-page-description">{purpose}</p> : null}
      </div>
      {actions ? (
        <div className="app-page-actions flex flex-wrap items-center gap-2">
          {actions}
        </div>
      ) : null}
    </header>
  );
}

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  const hintId = useId();
  const control = isValidElement<HTMLAttributes<HTMLElement>>(children) && typeof children.type === "string" && ["input", "select", "textarea"].includes(children.type)
    ? cloneElement(children, {
      "aria-label": children.props["aria-label"] ?? label,
      "aria-describedby": [children.props["aria-describedby"], hint ? hintId : undefined].filter(Boolean).join(" ") || undefined,
    }) : children;
  return (
    <label data-ui="field" className="app-field block">
      <span className="mb-1.5 block text-sm font-semibold">{label}</span>
      {control}
      {hint ? (
        <span id={hintId} className="mt-1.5 block text-xs text-[var(--text-muted)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div data-ui="empty" className="app-empty-state flex min-h-64 flex-col items-center justify-center px-6 py-12 text-center">
      <div className="grid size-12 place-items-center rounded-2xl bg-[var(--surface-subtle)] text-[var(--text-muted)]">
        {icon}
      </div>
      <h2 className="mt-4 font-bold">{title}</h2>
      <p className="mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">
        {description}
      </p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorMessage({ error, onRetry, retrying = false }: { error: unknown; onRetry?: (() => void) | undefined; retrying?: boolean }) {
  if (!error) return null;
  return (
    <div
      data-ui="error"
      className="flex gap-2 rounded-xl border border-[color-mix(in_srgb,var(--danger)_16%,transparent)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]"
      role="alert"
    >
      <AlertCircle className="mt-0.5 shrink-0" size={17} />
      <span className="min-w-0 flex-1 break-words">
        {error instanceof Error ? error.message : "操作失败，请重试。"}
      </span>
      {onRetry ? <Button variant="secondary" size="compact" disabled={retrying} onClick={onRetry}>{retrying ? "正在重试…" : "重新加载"}</Button> : null}
    </div>
  );
}

export function LoadingBlock() {
  return (
    <div data-ui="loading" role="status" aria-live="polite" className="flex min-h-48 flex-col items-center justify-center gap-3 text-sm text-[var(--text-muted)]">
      <div className="workspace-skeleton" aria-hidden="true"><i /><i /><i /></div>
      <span className="grid size-9 place-items-center rounded-xl bg-[var(--surface-subtle)] text-[var(--accent-strong)]">
        <LoaderCircle className="animate-spin" size={17} />
      </span>
      正在加载真实数据…
    </div>
  );
}
