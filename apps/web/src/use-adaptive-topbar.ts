import { useCallback, useEffect, useState } from "react";

export function useAdaptiveTopbar(path: string, pinned: boolean) {
  const [hidden, setHidden] = useState(false);
  const reveal = useCallback(() => setHidden(false), []);
  useEffect(() => {
    let lastY = window.scrollY;
    let idle = 0, hold = 0;
    let pointer: { x: number; y: number } | null = null;
    const resetIdle = () => { window.clearTimeout(idle); idle = window.setTimeout(reveal, 1800); };
    const scroll = () => {
      const y = window.scrollY;
      const focusedHeader = document.activeElement?.closest(".app-topbar");
      if (pinned || focusedHeader || document.querySelector("[data-workspace-dialog='true']")) reveal();
      else if (y < 100 || y < lastY - 4) reveal();
      else if (y > lastY + 6) setHidden(true);
      lastY = y; resetIdle();
    };
    const down = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; window.clearTimeout(hold); hold = window.setTimeout(reveal, 420); };
    const move = (event: PointerEvent) => { if (pointer && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 8) { window.clearTimeout(hold); pointer = null; } };
    const up = () => { window.clearTimeout(hold); pointer = null; };
    const focus = () => { if (document.activeElement?.closest(".app-topbar")) reveal(); };
    const frame = window.requestAnimationFrame(reveal);
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pointerdown", down, { passive: true });
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerup", up, { passive: true });
    window.addEventListener("pointercancel", up, { passive: true });
    document.addEventListener("focusin", focus);
    document.addEventListener("keydown", reveal);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(idle); window.clearTimeout(hold); window.removeEventListener("scroll", scroll); window.removeEventListener("pointerdown", down); window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up); document.removeEventListener("focusin", focus); document.removeEventListener("keydown", reveal); };
  }, [path, pinned, reveal]);
  return { hidden, reveal };
}
