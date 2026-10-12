import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState, type FormEvent, type FormHTMLAttributes, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Button } from "@workbench/ui";
import { useDialogFocus } from "./dialog-focus.js";
import { useMotionPreference } from "./motion-preference.js";
import { referenceMotion } from "./reference-motion.js";

let dialogLocks = 0;
let previousOverflow = "";
let previousInert = false;

function DialogLayer({ open, reduced, busy, onClose, children }: { open: boolean; reduced: boolean; busy: boolean; onClose: () => void; children: ReactNode }) {
  const present = useIsPresent();
  const interactive = open && present;
  return <motion.div className="fx-dialog-backdrop" aria-hidden={!interactive} inert={!interactive} style={{ pointerEvents: interactive ? "auto" : "none" }} initial={{ opacity: 0 }} animate={{ opacity: open ? 1 : 0 }} exit={{ opacity: 0, transition: { duration: reduced ? 0 : referenceMotion.overlayOut } }} transition={{ duration: reduced ? 0 : open ? referenceMotion.overlayIn : referenceMotion.overlayOut }}
    onPointerDown={(event) => { if (interactive && event.target === event.currentTarget && !busy) onClose(); }}>{children}</motion.div>;
}

export function WorkspaceDialog({ open, title, description, onClose, children, wide = false, busy = false, back, keepMounted = false, returnFocus }: {
  open: boolean; title: string; description?: string; onClose: () => void; children: ReactNode; wide?: boolean; busy?: boolean; back?: (() => void) | undefined; keepMounted?: boolean; returnFocus?: RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement>(null);
  const titleId = useId();
  const { reduced } = useMotionPreference();
  useEffect(() => {
    if (!open) return;
    const root = document.getElementById("root");
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialogLocks === 0) { previousOverflow = document.body.style.overflow; previousInert = root?.inert ?? false; }
    dialogLocks += 1;
    document.body.style.overflow = "hidden";
    if (root) root.inert = true;
    return () => { dialogLocks -= 1; if (dialogLocks === 0) { document.body.style.overflow = previousOverflow; if (root) root.inert = previousInert; } };
  }, [open]);
  useDialogFocus(ref, open, returnFocus ?? opener);
  useEffect(() => {
    if (!open || busy) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, busy, onClose]);
  return createPortal(<AnimatePresence>{(open || keepMounted) && <DialogLayer open={open} reduced={reduced} busy={busy} onClose={onClose}>
    <motion.section ref={ref} className={`fx-dialog${wide ? " is-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1} data-workspace-dialog={open ? "true" : "false"}
      initial={{ opacity: 0, y: reduced ? 0 : 24, scale: reduced ? 1 : .97 }} animate={{ opacity: open ? 1 : 0, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : .98, transition: { duration: reduced ? 0 : referenceMotion.overlayOut } }}
      transition={{ duration: reduced ? 0 : open ? referenceMotion.overlayIn : referenceMotion.overlayOut, ease: [.16, 1, .3, 1] }}>
      <header className="fx-dialog-head"><div className="min-w-0">{back && <button className="fx-back-link" onClick={back} type="button"><ArrowLeft size={14} />返回上一层</button>}<h2 id={titleId}>{title}</h2>{description && <p>{description}</p>}</div>
        <Button aria-label={`关闭${title}`} variant="ghost" size="icon" disabled={busy} onClick={onClose}><X size={18} /></Button></header>
      <div className="fx-dialog-body">{children}</div>
    </motion.section>
  </DialogLayer>}</AnimatePresence>, document.body);
}

export function RollingValue({ value }: { value: string | number }) {
  const { reduced } = useMotionPreference();
  const formatted = String(value);
  return <span className="fx-rolling-value" aria-label={formatted}><span className="sr-only">{formatted}</span><span aria-hidden="true" className="fx-rolling-digits">{[...formatted].map((character, index) => /\d/.test(character) ? <span className="fx-digit-window" key={`digit-${formatted.length - index}`}><motion.span className="fx-digit-strip" initial={{ y: reduced ? `${-Number(character) * 10}%` : "0%" }} animate={{ y: `${-Number(character) * 10}%` }} transition={{ duration: reduced ? 0 : .82, ease: [.16, 1, .3, 1] }}>{Array.from({ length: 10 }, (_, digit) => <span key={digit}>{digit}</span>)}</motion.span></span> : <span key={`literal-${formatted.length - index}`}>{character}</span>)}</span></span>;
}

export function CollectionPager({ total, page, onChange, size = 8, label = "列表分页" }: { total: number; page: number; onChange: (value: number) => void; size?: number; label?: string }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const current = Math.min(Math.max(1, page), pages);
  return <nav className="fx-pagination" aria-label={label}>
    <span aria-live="polite">{total ? `${(current - 1) * size + 1}–${Math.min(total, current * size)} / ${total} 项` : "0 项"}</span>
    <div><Button size="compact" variant="secondary" disabled={current === 1} aria-label="上一页" onClick={() => onChange(current - 1)}><ChevronLeft size={15} /></Button>
      <span>第 {current} / {pages} 页</span><Button size="compact" variant="secondary" disabled={current === pages} aria-label="下一页" onClick={() => onChange(current + 1)}><ChevronRight size={15} /></Button></div>
  </nav>;
}

function DisclosureBody({ id, interactive, children, onEntered }: { id: string; interactive: boolean; children: ReactNode; onEntered: () => void }) {
  const present = useIsPresent(); const { reduced } = useMotionPreference();
  return <motion.div id={id} className="fx-disclosure-detail" inert={!present || (!reduced && !interactive)} aria-hidden={!present || (!reduced && !interactive)} onAnimationComplete={() => { if (present) onEntered(); }} initial={{ opacity: 0, height: reduced ? "auto" : 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: reduced ? "auto" : 0 }} transition={{ duration: reduced ? 0 : referenceMotion.pageIn, ease: [.16, 1, .3, 1] }}><div>{children}</div></motion.div>;
}

function RevealBody({ children, className, label }: { children: ReactNode; className?: string | undefined; label?: string | undefined }) {
  const present = useIsPresent(); const { reduced } = useMotionPreference();
  return <motion.div className={className} aria-label={label} inert={!present} aria-hidden={!present} initial={{ height: reduced ? "auto" : 0, opacity: 0, marginBottom: 0 }} animate={{ height: "auto", opacity: 1, marginBottom: 0 }} exit={{ height: reduced ? "auto" : 0, opacity: 0, marginBottom: 0 }} transition={{ duration: reduced ? 0 : .34, ease: [.16,1,.3,1] }} style={{ overflowY: "hidden" }}>{children}</motion.div>;
}

export function SmoothReveal({ show, children, className, label }: { show: boolean; children: ReactNode; className?: string | undefined; label?: string | undefined }) {
  return <div className="fx-inline-reveal"><AnimatePresence initial={false}>{show && <RevealBody className={className} label={label}>{children}</RevealBody>}</AnimatePresence></div>;
}

export function CompactDisclosure({ title, summary, badge, children, open: controlledOpen, onToggle, className = "", id }: {
  title: ReactNode; summary?: ReactNode; badge?: ReactNode; children: ReactNode; open?: boolean | undefined; onToggle?: (() => void) | undefined; className?: string; id?: string;
}) {
  const [localOpen, setLocalOpen] = useState(false);
  const [interactive, setInteractive] = useState(false);
  const expanded = controlledOpen ?? localOpen;
  const detailsId = useId();
  const { reduced } = useMotionPreference();
  const articleRef = useRef<HTMLElement>(null);
  return <motion.article ref={articleRef} layout={reduced ? false : "position"} className={`fx-disclosure ${expanded ? "is-open" : ""} ${className}`} id={id} transition={{ duration: referenceMotion.pageIn, ease: [.16, 1, .3, 1] }}>
    <button className="fx-disclosure-head" type="button" aria-expanded={expanded} aria-controls={detailsId} onClick={() => { setInteractive(false); if (onToggle) onToggle(); else setLocalOpen((value) => !value); }}>
      <span className="min-w-0 flex-1"><strong>{title}</strong>{summary && <span className="fx-disclosure-summary">{summary}</span>}</span>{badge}<ChevronRight className={expanded ? "is-turned" : ""} size={17} />
    </button>
    <AnimatePresence initial={false}>{expanded && <DisclosureBody id={detailsId} interactive={interactive} onEntered={() => {
      setInteractive(expanded);
      const head = articleRef.current?.querySelector<HTMLElement>(".fx-disclosure-head"), box = head?.getBoundingClientRect();
      if (expanded && box && !head?.closest("[inert]") && (box.top < 66 || box.bottom > window.innerHeight - 16)) head?.scrollIntoView({ behavior: reduced ? "instant" : "smooth", block: "nearest" });
    }}>{children}</DisclosureBody>}</AnimatePresence>
  </motion.article>;
}

export function StepForm({ steps, children, onSubmit, defaultStage = 0, validateStage, ...props }: Omit<FormHTMLAttributes<HTMLFormElement>, "children" | "onSubmit"> & {
  steps: readonly string[]; children: ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; defaultStage?: number;
  validateStage?: ((stage: number) => string | null) | undefined;
}) {
  const [stage, setStage] = useState(defaultStage);
  const [reached, setReached] = useState(defaultStage);
  const [message, setMessage] = useState<string | null>(null);
  const ref = useRef<HTMLFormElement>(null);
  const { reduced } = useMotionPreference();
  const flatten = (nodes: ReactNode): ReactNode[] => Children.toArray(nodes).flatMap((child) => isValidElement<{ children?: ReactNode }>(child) && (child.type === Fragment || child.type === "fieldset") ? flatten(child.props.children) : [child]);
  const fieldset = Children.toArray(children).find((child) => isValidElement(child) && child.type === "fieldset");
  const locked = isValidElement<{ disabled?: boolean }>(fieldset) && fieldset.props.disabled === true;
  const focusStage = (index: number) => window.requestAnimationFrame(() => { if (!ref.current?.closest("[inert]")) ref.current?.querySelector<HTMLElement>(`[data-stage="${index}"] :is(input,select,textarea,button)`)?.focus({ preventScroll: true }); });
  const validate = (index: number) => {
    const error = validateStage?.(index);
    const invalid = [...(ref.current?.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-stage="${index}"] :is(input,select,textarea)`) ?? [])].find((input) => !input.checkValidity());
    if (error || invalid) { setStage(index); setMessage(error ?? invalid!.validationMessage); window.requestAnimationFrame(() => { if (!ref.current?.closest("[inert]")) { invalid?.focus(); invalid?.reportValidity(); } }); return false; }
    setMessage(null); return true;
  };
  const go = (index: number) => {
    if (locked) return;
    if (index > stage) for (let current = 0; current < index; current++) if (!validate(current)) return;
    setStage(index); setReached((current) => Math.max(current, index)); focusStage(index);
  };
  return <form {...props} className={`fx-step-form ${props.className ?? ""}`} ref={ref} noValidate onSubmit={(event) => {
    if (stage < steps.length - 1) { event.preventDefault(); go(stage + 1); return; }
    for (let current = 0; current < steps.length; current++) if (!validate(current)) { event.preventDefault(); return; }
    onSubmit(event);
  }}>
    <nav className="fx-step-progress" aria-label="填写进度"><ol>{steps.map((label, index) => <li key={label}><button type="button" aria-current={stage === index ? "step" : undefined} disabled={locked || index > reached + 1} data-complete={index < stage} onClick={() => go(index)}><span>{index < stage ? <Check size={13} /> : index + 1}</span><strong>{label}</strong></button></li>)}</ol><div className="fx-step-track"><i style={{ width: `${(stage + 1) / steps.length * 100}%` }} /></div></nav>
    {message && <p className="fx-step-error" role="alert">{message}</p>}
    <fieldset disabled={locked} className="fx-step-content" data-active-stage={stage}>
      {flatten(children).map((child, index) => {
        const childProps = isValidElement<Record<string, unknown>>(child) ? child.props : {};
        const value = childProps["data-wizard-step"] ?? childProps.wizardStep;
        const childStage = typeof value === "number" ? value : steps.length - 1;
        const always = value === "all";
        return <div key={isValidElement(child) ? child.key ?? index : index} data-stage={always ? "all" : childStage} className="fx-step-item" hidden={!always && childStage !== stage} style={reduced ? undefined : { animationDuration: "620ms" }}>{child}</div>;
      })}
    </fieldset>
    <footer className="fx-step-footer"><Button type="button" size="compact" variant="secondary" disabled={locked || stage === 0} onClick={() => go(stage - 1)}><ChevronLeft size={15} />上一步</Button><span>第 {stage + 1} / {steps.length} 步 · {steps[stage]}</span>
      {stage < steps.length - 1 && <Button type="button" size="compact" disabled={locked} onClick={() => go(stage + 1)}>下一步<ChevronRight size={15} /></Button>}</footer>
  </form>;
}
