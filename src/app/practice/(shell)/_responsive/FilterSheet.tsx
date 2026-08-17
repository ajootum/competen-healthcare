"use client";

import { useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useBodyScrollLock } from "./use-body-scroll-lock";

// CPR-MOB-001 s5 — "Filter row → Filter button opens bottom sheet/full-screen filter drawer."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ONE BUTTON WHERE THE ROW WAS. A desktop filter row is six controls wide; on a phone that is either a
// horizontal scroll (s4 forbids it for core workflows) or a stack that pushes the actual work below
// the fold. So the row becomes a button that SAYS HOW MANY FILTERS ARE ON — a number in words-and-
// digits, not a coloured dot (s4) — and the controls live in a sheet that rises from the bottom, where
// a thumb already is.
//
// THE CONTROLS ARE children, OWNED BY THE ADOPTING PAGE. Filters are page state — which chips, which
// dates, what they mean — and s19's filter-persistence rule (selections survive responsive
// transitions) can only be honoured by the component that owns that state. This primitive supplies
// the container contract: trap, Escape, backdrop, scroll-lock, a labelled apply action at
// touch-primary size, and closure after applying.
//
// AT md AND UP THE SAME DIALOG RENDERS AS A CENTRED MODAL — the s5 row read right to left. The
// primitive keeps working across a rotation or a window resize rather than stranding an open sheet in
// a layout that no longer draws it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function FilterSheet({
  label = "Filters", activeCount = 0, title, applyLabel = "Apply filters", onApply, children,
}: {
  /** The visible word on the trigger. Never icon-only (s17). */
  label?: string;
  /** How many filters are currently applied. Zero renders no count — a zero badge is noise. */
  activeCount?: number;
  /** The sheet's heading; defaults to the trigger's label. */
  title?: string;
  applyLabel?: string;
  /** Runs when the apply action is pressed; the sheet closes after it. Omit it and the action is a
      plain "Done" for pages whose controls apply themselves on change. */
  onApply?: () => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement | null>(null);
  const close = () => setOpen(false);
  useModalFocus(open, panel, close, { initialIndex: 1 });
  useBodyScrollLock(open);

  const heading = title ?? label;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="inline-flex min-h-[var(--cp-touch)] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
      >
        <span aria-hidden className="text-gray-400">≔</span>
        {label}
        {activeCount > 0 && (
          <span className="rounded-full bg-[var(--cp-primary)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {activeCount}
            <span className="sr-only"> filters applied</span>
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50">
          <button type="button" aria-label="Close filters" onClick={close}
            className="absolute inset-0 cursor-default bg-black/40" />
          <div
            ref={panel}
            tabIndex={-1}
            role="dialog"
            aria-modal="true"
            aria-label={heading}
            className="absolute inset-x-0 bottom-0 flex max-h-[85%] flex-col rounded-t-2xl bg-white outline-none md:bottom-auto md:left-1/2 md:top-1/2 md:max-h-[80vh] md:w-full md:max-w-md md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-2xl"
          >
            <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-2.5">
              <h2 className="text-[15px] font-bold text-gray-900">{heading}</h2>
              <button
                type="button"
                onClick={close}
                className="flex min-h-[var(--cp-touch)] items-center rounded-lg px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">{children}</div>

            {/* touch-primary, full width, above the safe area: the one dominant action in this
                viewport (s4), reachable where the thumb is. */}
            <div className="border-t border-gray-200 p-3 pb-[calc(var(--cp-safe-bottom)_+_12px)] md:pb-3">
              <button
                type="button"
                onClick={() => { onApply?.(); close(); }}
                className="flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl bg-[var(--cp-primary)] px-4 text-[14px] font-semibold text-white"
              >
                {onApply ? applyLabel : "Done"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
