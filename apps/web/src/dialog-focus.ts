import { useEffect, type RefObject } from "react";

const focusableSelector = 'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/** Trap keyboard focus in modal surfaces and return it to their opener. */
export function useDialogFocus(ref: RefObject<HTMLElement | null>, enabled: boolean, returnFocus?: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const dialog = ref.current;
    if (!enabled || !dialog) return;
    // An asynchronous opener may be temporarily disabled while entering the
    // dialog. Browsers can blur it before this effect runs, so callers with a
    // known opener must retain that target explicitly.
    const previous = returnFocus?.current ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const controls = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)]
      .filter((element) => element.getClientRects().length > 0 && !element.closest("[inert]"));
    if (!dialog.contains(document.activeElement)) (controls()[0] ?? dialog).focus({ preventScroll: true });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = controls();
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [enabled, ref, returnFocus]);
}
