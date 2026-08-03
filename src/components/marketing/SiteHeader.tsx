"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { ACCENT, BRAND } from "@/lib/marketing/home-content";
import { PRIMARY_SOLUTIONS } from "@/lib/marketing/solutions";

// Shared public header (WEB-STRAT-001). One component across the homepage and every landing page, so the
// Solutions menu cannot say different things on different pages.
//
// The menu is built from PRIMARY_SOLUTIONS, which is the same list the routes are built from. That is the
// point: a solution page cannot exist without appearing here, and a menu entry cannot exist without a page
// behind it. /quality is deliberately absent -- the spec makes it a secondary page, reachable and indexed
// but not in the primary navigation.

export default function SiteHeader({ dark = false }: { dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);

  // The drawer declares role="dialog" aria-modal="true", which promises assistive technology that the rest
  // of the page is inert. useModalFocus is what keeps that promise: focus moves in, Tab wraps inside, and
  // focus returns to the trigger on close. It owns Escape too, so there is one dismissal path rather than
  // two that can disagree.
  const drawer = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  useModalFocus(open, drawer, closeDrawer);

  // Escape still collapses the desktop Solutions menu, which is not a dialog and not covered by the hook.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSolutionsOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The page behind a full-screen drawer must not scroll.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const link = dark ? "text-white/80 hover:text-white" : "text-gray-700 hover:text-gray-900";

  return (
    <header className={`sticky top-0 z-40 border-b ${dark ? "bg-[var(--cp-slate-900)]/95 border-white/10" : "bg-white/90 border-gray-100"} backdrop-blur`}>
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 flex items-center gap-8 h-[70px]">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Competen home">
          <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg font-bold"
            style={{ background: `linear-gradient(135deg, ${ACCENT}, #7C3AED)` }}>C</span>
          <span className="leading-tight">
            <span className={`block text-lg font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>{BRAND.name}</span>
            <span className={`block text-[10px] ${dark ? "text-white/50" : "text-gray-500"}`}>{BRAND.tagline}</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-7 mx-auto" aria-label="Primary">
          <div className="relative" onMouseLeave={() => setSolutionsOpen(false)}>
            <button type="button" aria-expanded={solutionsOpen} aria-haspopup="true"
              onClick={() => setSolutionsOpen(o => !o)} onMouseEnter={() => setSolutionsOpen(true)}
              className={`text-[14px] font-medium ${link} transition-colors`}>
              Solutions <span aria-hidden className="text-[10px] text-gray-400">▾</span>
            </button>
            {solutionsOpen && (
              <div className="absolute left-0 top-full pt-2">
                <ul className="w-60 rounded-xl bg-white shadow-xl ring-1 ring-black/5 p-1.5">
                  {PRIMARY_SOLUTIONS.map(s => (
                    <li key={s.slug}>
                      <Link href={`/${s.slug}`} onClick={() => setSolutionsOpen(false)}
                        className="block rounded-lg px-3 py-2 hover:bg-gray-50">
                        <span className="block text-[13.5px] font-semibold text-gray-900">{s.nav}</span>
                        <span className="block text-[11.5px] text-gray-500">{s.body.slice(0, 42)}…</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
          <Link href="/#cta" className={`text-[14px] font-medium ${link} transition-colors`}>Resources</Link>
          <Link href="/#cta" className={`text-[14px] font-medium ${link} transition-colors`}>About Us</Link>
        </nav>

        <div className="hidden lg:flex items-center gap-4 ml-auto">
          <Link href="/login" className={`text-[14px] font-medium ${link} transition-colors`}>Login</Link>
          <Link href="/signup" className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: ACCENT }}>Book a Demo</Link>
        </div>

        {/* Mobile trigger */}
        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
          className={`lg:hidden ml-auto w-10 h-10 rounded-lg flex items-center justify-center ${dark ? "text-white" : "text-gray-800"}`}>
          <span aria-hidden className="text-xl">☰</span>
        </button>
      </div>

      {/* Mobile drawer */}
      {open && (
        <div ref={drawer} tabIndex={-1} className="lg:hidden fixed inset-0 z-50 bg-[var(--cp-slate-900)] text-white flex flex-col outline-none" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center justify-between px-5 h-[70px] border-b border-white/10">
            <span className="text-lg font-bold">{BRAND.name}</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white/70 hover:text-white">
              <span aria-hidden className="text-xl">✕</span>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-5 py-4" aria-label="Mobile">
            <button type="button" onClick={() => setSolutionsOpen(o => !o)} aria-expanded={solutionsOpen}
              className="w-full flex items-center justify-between py-3 text-[15px] font-semibold">
              Solutions <span aria-hidden className="text-xs text-white/50">{solutionsOpen ? "▲" : "▼"}</span>
            </button>
            {solutionsOpen && (
              <ul className="pb-2">
                {PRIMARY_SOLUTIONS.map(s => (
                  <li key={s.slug}>
                    <Link href={`/${s.slug}`} onClick={() => setOpen(false)}
                      className="block py-2.5 pl-3 text-[14px] text-white/70 hover:text-white">{s.nav}</Link>
                  </li>
                ))}
              </ul>
            )}
            <Link href="/#cta" onClick={() => setOpen(false)} className="block py-3 text-[15px] font-semibold border-t border-white/10">Resources</Link>
            <Link href="/#cta" onClick={() => setOpen(false)} className="block py-3 text-[15px] font-semibold border-t border-white/10">About Us</Link>
            <Link href="/login" onClick={() => setOpen(false)} className="block py-3 text-[15px] font-semibold border-t border-white/10">Login</Link>
            <Link href="/signup" onClick={() => setOpen(false)}
              className="mt-5 block rounded-xl py-3.5 text-center text-[15px] font-semibold text-white"
              style={{ background: ACCENT }}>Book a Demo</Link>
          </nav>
        </div>
      )}
    </header>
  );
}
