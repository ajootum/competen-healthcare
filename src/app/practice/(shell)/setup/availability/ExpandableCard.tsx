"use client";

import { useState } from "react";

// CPR-SCH-002 — "Expandable cards for Schedule Changes, Patient Booking and Preview".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// COLLAPSED BY DEFAULT IS THE POINT, not a detail. "One clear task per section" only works if the other
// sections are out of the way -- the previous build stacked all five open and the weekly board, which is
// the primary interaction, ended up competing with three forms nobody had asked for yet.
//
// THE SUMMARY LINE SAYS WHAT IS INSIDE. A collapsed card reading only "Patient Booking" makes somebody
// open it to find out whether they have set anything; one reading "2 rules · 24h notice" answers the
// question without the click, which is the whole reason to collapse it.
//
// It is a controlled panel rather than <details> -- the same lesson the session menu taught: native
// disclosure does not close when anything else opens, and three of these left open at once is the
// stacked layout again.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function ExpandableCard({
  icon, iconClass, title, blurb, summary, actionLabel, defaultOpen = false, children,
}: {
  icon: string;
  iconClass: string;
  title: string;
  blurb: string;
  /** What is already configured. Null renders nothing rather than an empty chip. */
  summary: string | null;
  actionLabel: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <button type="button" onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span aria-hidden className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[16px] ${iconClass}`}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold text-gray-900">{title}</span>
          <span className="block text-[11px] leading-tight text-gray-500">{blurb}</span>
        </span>
        {summary && (
          <span className="hidden shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-600 sm:inline">
            {summary}
          </span>
        )}
        <span className="shrink-0 rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-700">
          {open ? "Close" : actionLabel}
        </span>
        <span aria-hidden className={`shrink-0 text-[12px] text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}>
          ⌄
        </span>
      </button>
      {open && <div className="border-t border-gray-100 px-4 py-4">{children}</div>}
    </section>
  );
}
