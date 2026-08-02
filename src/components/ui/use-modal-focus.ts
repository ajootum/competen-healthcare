"use client";

import { useEffect, type RefObject } from "react";

/**
 * Focus management for anything rendered as `role="dialog" aria-modal="true"`.
 *
 * WHY THIS EXISTS. `aria-modal="true"` is a PROMISE to assistive technology that everything outside the
 * dialog is inert. Three of this codebase's four modal surfaces were making that promise without keeping
 * it: the public site's two mobile navigation drawers and the design system's Drawer left focus on the
 * trigger behind the overlay, with everything on the page still reachable by Tab. Measured on
 * /practice at 375px, thirty-one elements behind the drawer were still tabbable.
 *
 * The result is worse than a plain non-modal panel. A screen-reader user is told the page behind is
 * unavailable; a keyboard user Tabs straight into it and starts operating controls hidden underneath an
 * opaque overlay, with no visible focus ring to explain where they have gone. Nothing about the page looks
 * wrong to anyone testing with a mouse, which is why it survived.
 *
 * ConfirmDialog in interactive.tsx already did this correctly. Rather than leave one good implementation
 * and three bad ones, the behaviour lives here and every modal surface consumes it.
 *
 * Three things, and all three are required for the promise to hold:
 *   1. Focus MOVES IN when the dialog opens -- otherwise it never really opened for a keyboard user.
 *   2. Tab and Shift+Tab WRAP inside it, so focus cannot escape behind the overlay.
 *   3. Focus RETURNS to whatever opened it on close, so the user resumes where they were rather than at
 *      the top of the document.
 */
export function useModalFocus(
  open: boolean,
  panel: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  opts: { /** Skip the leading element -- e.g. focus Cancel rather than a close X. */ initialIndex?: number } = {},
) {
  const { initialIndex = 0 } = opts;

  useEffect(() => {
    if (!open) return;

    const restore = document.activeElement as HTMLElement | null;

    // Re-queried on every Tab rather than cached: a drawer whose contents expand (the Solutions
    // sub-menu, for instance) would otherwise trap against a stale last element.
    const focusables = () => [
      ...(panel.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []),
    ].filter(el => el.offsetParent !== null || el.getClientRects().length > 0);

    const initial = focusables()[initialIndex] ?? focusables()[0];
    // Falls back to the panel itself, which carries tabIndex={-1} for exactly this case: a dialog with no
    // focusable content still needs to take focus, or the announcement never happens.
    (initial ?? panel.current)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onDismiss(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0], last = f[f.length - 1];
      // Also catches focus having escaped already (activeElement outside the panel), which happens when
      // the browser restores focus after a re-render.
      if (!panel.current?.contains(document.activeElement)) { e.preventDefault(); first.focus(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Guard against restoring to something React has since unmounted.
      if (restore?.isConnected) restore.focus();
    };
  }, [open, panel, onDismiss, initialIndex]);
}
