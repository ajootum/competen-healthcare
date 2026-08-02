"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { PRACTICE_NAV, JOURNEYS } from "@/lib/marketing/practice-site";

// LP-PRA-001 header. Competen Practice gets its OWN header across /practice/*, because the specification
// makes it a product with four journeys of its own rather than one entry in a Solutions menu -- and the
// corporate header has a single "Book a Demo" button, which cannot carry "I am a patient wanting an
// appointment" and "I am a doctor wanting to sign in" at the same time.
//
// The section is still part of the Competen site, so the wordmark links back to it rather than stranding
// the visitor in a product site with no way home.
//
// Navigation and journeys both come from practice-site.ts, which is also what the landing page's journey
// cards are built from. A journey therefore cannot appear in one place and not the other.

export default function PracticeHeader() {
  const [open, setOpen] = useState(false);

  // The drawer declares role="dialog" aria-modal="true", which promises assistive technology that the rest
  // of the page is inert. useModalFocus keeps that promise: focus moves in, Tab wraps inside, and focus
  // returns to the trigger on close. It owns Escape while the drawer is open.
  const drawer = useRef<HTMLDivElement>(null);
  const closeDrawer = useCallback(() => setOpen(false), []);
  useModalFocus(open, drawer, closeDrawer);

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const primary = JOURNEYS.filter(j => j.kind === "primary");
  const secondary = JOURNEYS.filter(j => j.kind === "secondary");

  return (
    <header className="sticky top-0 z-40 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className="mx-auto w-full max-w-7xl px-5 sm:px-8 flex items-center gap-6 h-[70px]">
        <Link href="/practice" className="flex items-center gap-2.5 shrink-0" aria-label="Competen Practice home">
          <span aria-hidden className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg font-bold"
            style={{ background: `linear-gradient(135deg, ${PRACTICE_ACCENT}, #4F46E5)` }}>C</span>
          <span className="leading-tight">
            <span className="block text-lg font-bold tracking-tight text-gray-900">competen</span>
            <span className="block text-[10px] font-semibold tracking-[0.18em] uppercase" style={{ color: PRACTICE_ACCENT }}>Practice</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-6 mx-auto" aria-label="Competen Practice">
          {PRACTICE_NAV.map(n => (
            <Link key={n.label} href={n.href} className="text-[14px] font-medium text-gray-700 hover:text-gray-900 transition-colors">
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="hidden lg:flex items-center gap-3 ml-auto">
          {secondary.map(j => (
            <Link key={j.key} href={j.href}
              className="rounded-lg border border-gray-200 px-3.5 py-2 text-[13px] font-semibold text-gray-700 hover:border-gray-300 hover:text-gray-900 transition-colors">
              {j.label}
            </Link>
          ))}
          <Link href={primary[0].href} className="rounded-lg px-4 py-2.5 text-[13.5px] font-semibold text-white transition-opacity hover:opacity-90"
            style={{ background: PRACTICE_ACCENT }}>{primary[0].label} →</Link>
        </div>

        <button type="button" onClick={() => setOpen(true)} aria-label="Open menu" aria-expanded={open}
          className="lg:hidden ml-auto w-10 h-10 rounded-lg flex items-center justify-center text-gray-800">
          <span aria-hidden className="text-xl">☰</span>
        </button>
      </div>

      {open && (
        <div ref={drawer} tabIndex={-1} className="lg:hidden fixed inset-0 z-50 bg-[#0B1020] text-white flex flex-col outline-none" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center justify-between px-5 h-[70px] border-b border-white/10">
            <span className="text-lg font-bold">competen <span className="text-[11px] tracking-widest uppercase text-white/60">Practice</span></span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close menu"
              className="w-10 h-10 rounded-lg flex items-center justify-center text-white/70 hover:text-white">
              <span aria-hidden className="text-xl">✕</span>
            </button>
          </div>
          <nav className="flex-1 overflow-y-auto px-5 py-4" aria-label="Mobile">
            {PRACTICE_NAV.map(n => (
              <Link key={n.label} href={n.href} onClick={() => setOpen(false)}
                className="block py-3 text-[15px] font-semibold border-b border-white/10">{n.label}</Link>
            ))}
            <p className="mt-5 text-[11px] font-bold uppercase tracking-[0.12em] text-white/40">Where are you going?</p>
            {JOURNEYS.map(j => (
              <Link key={j.key} href={j.href} onClick={() => setOpen(false)}
                className="mt-2 block rounded-xl bg-white/5 px-4 py-3">
                <span className="block text-[14px] font-semibold">{j.label}</span>
                <span className="block text-[11.5px] text-white/50">{j.who}</span>
              </Link>
            ))}
            <Link href="/" onClick={() => setOpen(false)} className="mt-6 block py-3 text-[13px] text-white/50">
              ← Back to Competen
            </Link>
          </nav>
        </div>
      )}
    </header>
  );
}
