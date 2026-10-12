import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useContext, useLayoutEffect, type ReactNode } from "react";
import { UNSAFE_LocationContext, useLocation, useNavigationType, useOutlet } from "react-router-dom";
import { useMotionPreference } from "./motion-preference.js";
import { referenceMotion } from "./reference-motion.js";
import { workspaceRouteFamily } from "./workspace-route-family.js";

function PageScene({ children, resetScroll, family }: { children: ReactNode; resetScroll: boolean; family: string }) {
  const present = useIsPresent();
  const { reduced } = useMotionPreference();
  // Reset after the previous scene exits; citations can then scroll to their target.
  useLayoutEffect(() => { if (resetScroll) window.scrollTo({ top: 0, behavior: "instant" }); }, [resetScroll]);
  return <motion.div className="fx-page-content" data-workspace={family} inert={!present} aria-hidden={!present}
    initial={{ opacity: 0, y: reduced ? 0 : 9 }}
    animate={{ opacity: 1, y: 0, transition: { duration: reduced ? 0 : referenceMotion.pageIn, ease: [.16,1,.3,1] } }}
    exit={{ opacity: 0, y: reduced ? 0 : -4, transition: { duration: reduced ? 0 : referenceMotion.pageOut } }}>
    {children}
  </motion.div>;
}

/** Retain the rendered outlet during exit, then enter the next route. */
export function WorkspaceTransition({ render }: { render: (outlet: ReactNode) => ReactNode }) {
  const { pathname } = useLocation();
  const outlet = useOutlet();
  const navigationType = useNavigationType();
  const locationContext = useContext(UNSAFE_LocationContext);
  const family = workspaceRouteFamily(pathname);
  return <AnimatePresence mode="wait" initial={false}><PageScene key={family} family={family} resetScroll={navigationType !== "POP"}><UNSAFE_LocationContext.Provider value={locationContext}>{render(outlet)}</UNSAFE_LocationContext.Provider></PageScene></AnimatePresence>;
}

function RegionScene({ children, className }: { children: ReactNode; className?: string | undefined }) {
  const present = useIsPresent();
  const { reduced } = useMotionPreference();
  return <motion.div className={className} inert={!present} aria-hidden={!present} initial={{ opacity: reduced ? 1 : 0, y: reduced ? 0 : 7 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduced ? 0 : -3 }} transition={{ duration: reduced ? 0 : .34, ease: [.16,1,.3,1] }}>{children}</motion.div>;
}

/** Only the changing panel leaves; the frame and active tab remain mounted. */
export function RegionTransition({ changeKey, children, className }: { changeKey: string; children: ReactNode; className?: string | undefined }) {
  const locationContext = useContext(UNSAFE_LocationContext);
  const { reduced } = useMotionPreference();
  return <motion.div layout={reduced ? false : "size"} layoutDependency={changeKey} transition={{ duration: .52, ease: [.16,1,.3,1] }} className="fx-region-host"><AnimatePresence initial={false} mode="wait"><RegionScene key={changeKey} className={className}><UNSAFE_LocationContext.Provider value={locationContext}>{children}</UNSAFE_LocationContext.Provider></RegionScene></AnimatePresence></motion.div>;
}
