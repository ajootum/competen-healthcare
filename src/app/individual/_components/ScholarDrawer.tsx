"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useBelowMd } from "@/app/practice/(shell)/calendar/use-below-md";
import { ScholarNavTree } from "./ScholarSidebar";
import type { ScholarModuleKey } from "@/lib/individual/scholar/module-access";

// SCHOLAR'S MENU DRAWER -- modular restructuring, 2 Nov 2026. Below md the sidebar is not drawn and the bottom bar holds
// five tabs (CPR-MOB-001), so the header carries a Menu button that opens the SAME tree (ScholarNavTree) in a modal drawer.
// Mounted only while open: focus moves in, Tab wraps, Escape and the backdrop close it and focus returns to the button
// (useModalFocus); it closes on any route change and when the window widens past md; the page behind does not scroll.
// `learning`: the header's "Learning" link (ADR-017) moves in here on a phone, where the header has no room for it.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

export function ScholarDrawer({ myPlan, searchHistory = false, modules, learning = false }: { myPlan: boolean; searchHistory?: boolean; modules: readonly ScholarModuleKey[]; learning?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const below = useBelowMd();
  const panel = useRef<HTMLElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useModalFocus(open, panel, close);

  // Close on navigation (state adjustment during render, the MobileSidebar pattern).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) { setPrevPath(pathname); setOpen(false); }
  // And when the window widens: the sidebar takes over.
  if (open && !below) setOpen(false);
  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-gray-900 hover:bg-gray-50 md:hidden pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)] ${focusRing}`}>
        <svg aria-hidden width="18" height="14" viewBox="0 0 16 12" fill="none"><rect width="16" height="2" rx="1" fill="currentColor" /><rect y="5" width="16" height="2" rx="1" fill="currentColor" /><rect y="10" width="16" height="2" rx="1" fill="currentColor" /></svg>
        <span className="sr-only">Menu</span>
      </button>
      {open && below && (
        <>
          <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={close} aria-hidden />
          <aside ref={panel} role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}
            className="fixed bottom-0 left-0 top-0 z-50 flex w-[min(20rem,85vw)] flex-col border-r border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] md:hidden">
            <div className="flex shrink-0 items-center justify-between px-4 py-3">
              <p className="text-[15px] font-bold text-gray-900">Menu</p>
              <button type="button" onClick={close} aria-label="Close menu"
                className={`flex h-10 w-10 items-center justify-center rounded-lg text-lg leading-none text-gray-700 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)] ${focusRing}`}>
                <span aria-hidden>✕</span>
              </button>
            </div>
            <nav aria-label="Competen Scholar menu" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
              <ScholarNavTree myPlan={myPlan} searchHistory={searchHistory} modules={modules} onNavigate={close} />
              {learning && (
                <Link prefetch={false} href="/individual/learning" onClick={close}
                  className={`mt-3 flex items-center gap-3 rounded-[9px] border-t border-gray-100 px-4 py-2.5 pt-3 text-[15px] font-medium text-gray-900 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  <span aria-hidden className="w-5 text-center text-[15px]">◫</span>
                  Competen Learning
                </Link>
              )}
            </nav>
          </aside>
        </>
      )}
    </>
  );
}
