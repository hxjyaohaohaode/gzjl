import { NavLink } from "react-router-dom";
import { cn } from "@workbench/ui";
import { hasGrant, hasOrganizationGrant, type Me } from "./api.js";
import { useId } from "react";
import { motion } from "motion/react";
import { useMotionPreference } from "./motion-preference.js";

export function WorkspaceNavigation({ label, items }: {
  label: string;
  items: Array<{ to: string; label: string; end?: boolean }>;
}) {
  const id = useId();
  const { reduced } = useMotionPreference();
  return <nav aria-label={label} className="workspace-section-nav">
    {items.map((item) => <NavLink key={item.to} end={item.end ?? true} to={item.to}
      className={({ isActive }) => cn("workspace-section-link", isActive && "workspace-section-link--active")}>
      {({ isActive }) => <>{isActive && <motion.span className="workspace-selection-indicator" layoutId={`workspace-nav-${id}`} transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 480, damping: 38 }} aria-hidden="true" />}<span className="workspace-selection-label">{item.label}</span></>}
    </NavLink>)}
  </nav>;
}

export function ApprovalNavigation({ me }: { me: Me }) {
  return <WorkspaceNavigation label="审批分类" items={[
    ...(hasGrant(me, "work.review") ? [{ to: "/approvals", label: "工时审批" }] : []),
    ...(hasOrganizationGrant(me, "payroll.settle") ? [{ to: "/approvals/reimbursements", label: "报销审批", end: false }] : []),
  ]} />;
}
