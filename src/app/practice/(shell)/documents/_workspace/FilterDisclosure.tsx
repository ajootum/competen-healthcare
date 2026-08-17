"use client";

import { useId, useState } from "react";

// CPR-MOB-001 s5 — "Filter row → Filter button opens bottom sheet/full-screen filter drawer" — over the
// document register's filter row, which is a plain GET <form> and stays one.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ FilterSheet THE PRIMITIVE WAS REJECTED, FOR TWO REASONS THAT ARE BOTH FATAL ON THEIR OWN.
//
//   1. IT RENDERS AT EVERY WIDTH. FilterSheet is not md:hidden — at md and up the same dialog becomes a
//      centred modal, deliberately. Adopting it here would therefore REPLACE the desktop filter row
//      rather than add a mobile face to it, and this phase's contract is that desktop is pixel-identical
//      at md and up.
//   2. ITS APPLY IS A FUNCTION PROP ON A SERVER-RENDERED FORM. RegisterTable is a server component and
//      `onApply` is a function; a function passed from a server component to a client one is not
//      serialisable and Next throws at render. Worse, FilterSheet's apply is a `type="button"` with an
//      onClick, and this form is applied by a NATIVE submit — the whole reason every filter here is a
//      URL. Wiring the two together would mean giving the register client-side filter state, which is
//      the exact drift RegisterTable's header says it exists to prevent.
//
// SO THIS IS THE CONTAINER CONTRACT ONLY, AND IT HOLDS ONE COPY OF THE CONTROLS.
//
// ⚠ THE CONTROLS ARE RENDERED ONCE AND NEVER DUPLICATED. Two copies of a GET form's inputs would submit
// both, and `?status=` would arrive twice with the second silently winning. So there is a single child
// tree whose visibility is `open ? "" : "max-md:hidden"`:
//   · at md and up  — `max-md:hidden` does not apply, so the row is always visible, exactly as it was;
//   · below md open — visible;
//   · below md shut — display:none, and the inputs are STILL IN THE DOM, so a submit from anywhere in
//     the form carries the filters that are set. Hidden is not absent.
//
// ⚠ AND THERE IS NO matchMedia HERE ON PURPOSE. The breakpoint is decided by CSS, so the server render
// and the first client render agree at every width and nothing flashes open on a phone before
// collapsing. The hook exists for surfaces that must MOUNT differently; this one only has to look
// different.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function FilterDisclosure({ activeCount, children }: {
  /** How many filters are currently applied, counted from the URL by the server. Zero renders no
      badge — a zero badge is noise, and this one has to be worth looking at. */
  activeCount: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <>
      {/* The trigger exists only below md; at md and up the row itself is the control. */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="md:hidden flex min-h-[var(--cp-touch)] w-full items-center gap-2 rounded-lg border border-gray-200 bg-white px-3.5 text-[13px] font-semibold text-gray-700"
      >
        Filters
        {/* ⚠ A NUMBER AND A WORD, NEVER A COLOURED DOT (s4: status must never depend on colour alone).
            "3 applied" is the thing somebody needs before they conclude a short list is the whole list. */}
        {activeCount > 0 && (
          <span className="rounded-full bg-[var(--cp-primary)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
            {activeCount} applied
          </span>
        )}
        <span className="ml-auto text-[11px] font-semibold text-[var(--cp-primary-deep)]">
          {open ? "Hide" : "Show"}
        </span>
      </button>

      {/* ⚠ md:contents IS THE WHOLE REASON THE DESKTOP ROW IS UNCHANGED. This wrapper exists only to
          give the controls something to be hidden by below md. At md and up `display: contents` removes
          the box from the layout entirely, so the adopting form's children are once again its OWN direct
          flex items — the same wrapped row, in the same order, with the same `ml-auto` behaviour it had
          before this component existed. Without it, seven controls would become one flex item and the
          desktop filter row would silently relayout.

          ⚠ AND THE TWO STATES ARE SEPARATE CLASS STRINGS RATHER THAN `hidden` PLUS `flex`. Those are
          both `display` at the same specificity inside the same media query, so which one wins would
          come down to Tailwind's output ordering. Nothing about whether a filter row is visible should
          depend on that. */}
      <div
        id={panelId}
        className={open
          ? "max-md:mt-2 max-md:flex max-md:flex-col max-md:gap-2 md:contents"
          : "max-md:hidden md:contents"}
      >
        {children}
      </div>
    </>
  );
}
