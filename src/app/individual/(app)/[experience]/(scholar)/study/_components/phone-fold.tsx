"use client";

import { useEffect, useState, type ReactNode } from "react";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

/**
 * A lower section that folds on a phone, to keep a long read-only page short. Nothing is hidden behind it for good: one tap opens it.
 * It starts open, so wider screens and a page without scripts show everything, and closes after loading only below the md edge.
 */
export function PhoneFold({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the width is known only in the browser, and the server's first paint must match.
  useEffect(() => { if (window.matchMedia("(max-width: 767.98px)").matches) setOpen(false); }, []);
  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} data-phone-fold>
      <summary className={`cursor-pointer rounded pointer-coarse:py-3 ${focusRing}`}>{summary}</summary>
      {children}
    </details>
  );
}
