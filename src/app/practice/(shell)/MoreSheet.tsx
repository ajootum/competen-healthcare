"use client";

import { useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useBodyScrollLock } from "./_responsive/use-body-scroll-lock";

// CPR-MOB-001 s3 — the More sheet: everything the bottom bar's four destinations do not carry.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE FULL-HEIGHT LIST, NEVER NESTED MENUS. s3 is explicit: "More opens a full-height menu or bottom
// sheet; do not hide critical destinations behind multiple nested menus." So this is the remaining
// sidebar destinations — the same entries, labels and hrefs the frozen CPR-HFE-001 v1.1 sidebar
// declares, under the same five section headings — rendered flat. No submenu opens from here; a tap
// either navigates or closes the sheet.
//
// ⚠ THE SECTIONS ARRIVE FROM THE LAYOUT, ALREADY FILTERED — by capability (the same primaryNav() call
// the sidebar uses) and minus whatever the bottom bar already shows. This component invents no
// destination and re-derives no permission; a second reading of either is how the sheet and the
// sidebar would learn to disagree.
//
// THE SHEET STOPS 48px SHORT OF THE TOP, deliberately. "Full-height" is the s3 requirement, but a
// panel covering the whole viewport leaves no backdrop to tap, and backdrop-tap-to-close is part of
// this component's contract (with Escape and with navigation itself). The strip is the whole visible
// scrim, and the scrim is a real button rather than a div with a click handler, so it closes for
// keyboard and screen-reader users too.
//
// aria-modal IS KEPT HONEST BY useModalFocus — focus moves in, Tab wraps, Escape closes, focus returns
// to the More button that opened it (spec s17: logical focus order). Body scroll locks while open so
// the page underneath is still where the person left it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MoreSection = {
  label: string;
  items: { href: string; label: string; icon: string }[];
};

export default function MoreSheet({ open, onClose, sections }: {
  open: boolean;
  onClose: () => void;
  sections: MoreSection[];
}) {
  const pathname = usePathname() ?? "";
  const panel = useRef<HTMLDivElement | null>(null);
  // initialIndex 1 skips the scrim: first focus lands on the sheet's own Close button, which is the
  // first thing VISIBLE — focus order following visual order (s17), not DOM accident.
  useModalFocus(open, panel, onClose, { initialIndex: 1 });
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close menu"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="More destinations"
        className="absolute inset-x-0 bottom-0 top-12 flex flex-col rounded-t-2xl bg-white outline-none"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
          <h2 className="text-[15px] font-bold text-gray-900">More</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[var(--cp-touch)] items-center rounded-lg px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <nav
          aria-label="More destinations"
          className="flex-1 overflow-y-auto px-3 py-2 pb-[calc(var(--cp-safe-bottom)_+_12px)]"
        >
          {sections.map(section => (
            <div key={section.label} className="mb-2">
              <p className="px-2 pb-1 pt-2 text-[10px] font-bold uppercase tracking-[0.14em] text-gray-400">
                {section.label}
              </p>
              {section.items.map(item => {
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onClose}
                    aria-current={active ? "page" : undefined}
                    className={`flex min-h-[var(--cp-touch)] items-center gap-3 rounded-lg px-2 text-[14px] ${
                      active ? "bg-[var(--cp-primary-soft)] font-semibold text-gray-900" : "text-gray-800 hover:bg-gray-50"}`}
                  >
                    <span aria-hidden className={`w-5 text-center text-[15px] ${active ? "text-[var(--cp-primary-deep)]" : "text-gray-500"}`}>
                      {item.icon}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </div>
    </div>
  );
}
