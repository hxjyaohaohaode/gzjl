import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { animate } from "motion/mini";
import { Link, useLocation } from "react-router-dom";
import { Check, ChevronRight, CircleAlert, LoaderCircle } from "lucide-react";
import { createInteractionController, type InteractionSnapshot } from "./interaction-controller.js";
import { useMotionPreference } from "./motion-preference.js";
import { workspacePage } from "./workspace-pages.js";
import { hasOrganizationGrant, type Me } from "./api.js";

const initial: InteractionSnapshot = { pending: 0, status: "idle", revision: 0 };
const InteractionContext = createContext(initial);
export function InteractionProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const [snapshot, setSnapshot] = useState(initial);
  useMotionPreference();
  useEffect(() => createInteractionController(document.body, client, setSnapshot), [client]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (client.getQueryCache().findAll({ queryKey: ["workspace-draft"] }).some((query) => query.state.data != null)) {
        event.preventDefault(); event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [client]);
  return <InteractionContext.Provider value={snapshot}>{children}</InteractionContext.Provider>;
}

export function WorkspaceOrientation({ me }: { me: Me }) {
  const { pathname, search } = useLocation();
  const page = workspacePage(pathname);
  const parent = pathname.startsWith("/payroll-management/runs/")
    ? hasOrganizationGrant(me, "payroll.configure") ? { to: `/payroll-management/periods${search}`, label: "周期结算" } : undefined
    : page.parent;
  const operation = useContext(InteractionContext);
  const fetching = useIsFetching({ predicate: (query) => query.queryKey[0] !== "me" && query.getObserversCount() > 0 });
  const { reduced } = useMotionPreference();
  useEffect(() => {
    document.title = `${workspacePage(pathname).title} · 时序工作台`;
    const header = document.querySelector<HTMLElement>(".app-page-header");
    if (!header || reduced) return;
    const animation = animate(header, { opacity: [0.6, 1] }, { duration: 0.22 });
    return () => animation.stop();
  }, [pathname, reduced]);
  const label = operation.pending ? `正在处理 ${operation.pending} 项操作`
    : operation.status === "error" ? "操作未完成，请查看页面提示"
    : operation.status === "success" ? "操作已完成"
    : fetching ? "正在更新页面数据" : "";
  return <div className="workspace-orientation" data-ui="orientation">
    <nav aria-label="当前位置" className="workspace-breadcrumbs">
      <span>{page.area}</span><ChevronRight size={13} aria-hidden />
      {parent ? <><Link to={parent.to}>{parent.label}</Link><ChevronRight size={13} aria-hidden /></> : null}
      <span aria-current="page">{page.title}</span>
    </nav>
    <div className="workspace-operation" data-state={operation.pending ? "pending" : operation.status} role="status" aria-live="polite" aria-atomic="true">
      {label ? <>{operation.pending || fetching && operation.status === "idle" ? <LoaderCircle size={14} className="animate-spin" /> : operation.status === "error" ? <CircleAlert size={14} /> : <Check size={14} />}<span>{label}</span></> : null}
    </div>
    {(operation.pending > 0 || fetching > 0) && <span className="workspace-progress" aria-hidden="true" />}
  </div>;
}

export function MotionSettings() {
  const { preference, reduced, setPreference } = useMotionPreference();
  return <fieldset className="motion-settings"><legend>交互动态</legend><div>
    <button type="button" aria-pressed={preference === "full"} onClick={() => setPreference("full")}>完整响应</button>
    <button type="button" aria-pressed={preference === "reduced"} onClick={() => setPreference("reduced")}>减少动态</button>
  </div><p>{reduced ? "保留状态反馈，减少移动和过渡；同时遵循系统设置。" : "导航、操作与数据变化使用连续反馈，长时间工作也能随时调低。"}</p></fieldset>;
}
