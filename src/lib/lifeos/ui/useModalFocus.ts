"use client";

import { useEffect, useRef } from "react";

// Focus moves into a dialog, Tab stays inside it, Escape closes it, and focus returns to where it was.
// LifeOS's own copy of the estate's rule (scripts/pui-a11y-harness.ts), because the seal keeps it from importing the estate's.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useModalFocus<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const box = ref.current;
    box?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { close.current(); return; }
      if (e.key !== "Tab" || !box) return;
      const items = [...box.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) { e.preventDefault(); return; }
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); before?.focus?.(); };
  }, []);
  return ref;
}
