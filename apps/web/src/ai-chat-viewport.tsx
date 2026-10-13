import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Keep the composer within the available screen, including wrapped mobile
 * headers, while messages scroll inside the conversation instead of the page. */
export function AiChatViewport({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      // offsetTop ignores the route's entrance transform, avoiding a height
      // jump when that animation finishes.
      let top = 0;
      for (let parent: HTMLElement | null = element; parent; parent = parent.offsetParent as HTMLElement | null) {
        top += parent.offsetTop + (parent.offsetParent?.clientTop ?? 0);
      }
      const mobileNav = document.querySelector<HTMLElement>(".app-mobile-nav");
      const bottomInset = mobileNav?.getBoundingClientRect().height ?? 0;
      const height = Math.max(320, (window.visualViewport?.height ?? window.innerHeight) - top - bottomInset - 16);
      const value = `${Math.round(height)}px`;
      if (element.style.getPropertyValue("--ai-chat-height") !== value) element.style.setProperty("--ai-chat-height", value);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    measure();
    const observer = new ResizeObserver(schedule);
    // Observe the elements above/below the conversation, not a parent whose
    // height this effect itself changes (which would create an observer loop).
    document.querySelectorAll(".app-page-header, .workspace-section-nav, .workspace-orientation, .app-topbar, .app-mobile-nav").forEach((header) => observer.observe(header));
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
    };
  }, []);
  return <div className="ai-chat-viewport" ref={ref}>{children}</div>;
}
