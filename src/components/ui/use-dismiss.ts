"use client";

import { useEffect, type RefObject } from "react";

/**
 * Escape-to-close for a dropdown or popover.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT useModalFocus. The modal audit found two different things written the
 * same way -- `fixed inset-0` -- and lumping them together would have produced the wrong fix for one of
 * them. A dialog is a blocking panel with content and wants full dialog semantics. A SCRIM is an empty div
 * whose only job is catching the click outside an absolutely-positioned menu; giving that role="dialog"
 * would announce an empty dialog to a screen reader, which is worse than announcing nothing.
 *
 * But the scrims have their own real defect. They close on an outside CLICK and nothing else. A keyboard
 * user opens the menu with Enter and then has no way out: Escape does nothing, and the scrim is not
 * focusable so there is nothing to activate. Seven of them were like this -- the role switcher, the
 * workspace switcher, the dashboard customiser, the bulk-actions and row menus.
 *
 * Two things, both required for the menu to be operable without a mouse:
 *   1. Escape CLOSES it.
 *   2. Focus RETURNS to the trigger, so the next Tab continues from where the user was rather than from the
 *      top of the document. Without this, Escape technically works and still loses the user's place.
 *
 * Deliberately NOT a focus trap. A menu is not modal -- Tab moving on through the page is correct
 * behaviour for it, and trapping focus in a four-item dropdown would be its own bug.
 */
export function useDismiss(open: boolean, onDismiss: () => void, trigger?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const restore = trigger?.current ?? (document.activeElement as HTMLElement | null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onDismiss();
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Guard against restoring to something React has since unmounted.
      if (restore?.isConnected) restore.focus();
    };
  }, [open, onDismiss, trigger]);
}
