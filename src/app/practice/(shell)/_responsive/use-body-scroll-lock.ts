"use client";

import { useEffect } from "react";

/**
 * Freezes page scroll while a sheet is open (CPR-MOB-001 s5's sheet transformations all require it).
 *
 * WHY IT IS NOT OPTIONAL. A full-screen sheet that does not lock the page behind it lets a touch that
 * misses a control scroll the CONTENT underneath — so the sheet closes onto a page that is no longer
 * where the person left it, mid-clinic. The marketing headers and the estate's MobileSidebar already do
 * this with the same one-liner; it lives here once so the Practice sheets cannot each rediscover it.
 *
 * The previous value is restored rather than assumed to be "" — two sheets that overlap in time (one
 * closing while another opens) must not unlock a page the survivor still covers.
 */
export function useBodyScrollLock(open: boolean) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [open]);
}
