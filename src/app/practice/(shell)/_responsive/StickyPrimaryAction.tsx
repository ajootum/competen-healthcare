"use client";

import Link from "next/link";

// CPR-MOB-001 s5 — "Inline actions → Condensed → Sticky or full-width primary action where
// appropriate."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// THE ONE ACTION THAT MUST NOT SCROLL AWAY. s4 wants primary actions "reachable near the lower half
// of the screen", and on a phone the honest reading is: pinned, full width, at touch-primary size,
// sitting exactly on top of the bottom navigation. The offset is the SAME two tokens the bar itself
// occupies (--cp-bottomnav-h + --cp-safe-bottom), so the two cannot drift apart and neither can cover
// the other — the s17 rule, kept by arithmetic rather than by eyeballing.
//
// ONE ACTION, BY TYPE. The props admit a single label and a single destination because s4 caps a
// viewport at one dominant primary action. A page needing two buttons here does not need this
// primitive; it needs to decide which one is primary.
//
// THE SPACER IS HALF THE COMPONENT. position:fixed removes the bar from flow, so without an in-flow
// twin the page's last content sits underneath it — obscured, which is the exact defect s17 names.
// The spacer occupies the bar's height in the document so scrolling to the bottom really reaches the
// bottom.
//
// From md up the bar is ordinary flow content: desktop keeps its inline actions and this renders as a
// plain button at the same place in the page — the s5 row read left to right.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function StickyPrimaryAction({ label, href, onSelect, disabled = false, hint }: {
  /** The visible words on the action. */
  label: string;
  /** Renders a Link when given; otherwise a button driving `onSelect`. */
  href?: string;
  onSelect?: () => void;
  disabled?: boolean;
  /** Rendered under the action. REQUIRED IN SPIRIT whenever `disabled` is true: a greyed button with
      no visible reason reads as a broken product, not a guarded one. */
  hint?: string;
}) {
  const actionClass =
    "flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-xl " +
    "bg-[var(--cp-primary)] px-4 text-[15px] font-semibold text-white disabled:opacity-50 md:w-auto md:px-6";

  return (
    <>
      {/* The in-flow twin: reserves the fixed bar's height (action + container padding + hint line)
          below md so no content ends its scroll underneath the bar. */}
      <div aria-hidden className={`md:hidden ${hint ? "h-24" : "h-20"}`} />

      <div className="fixed inset-x-0 bottom-[calc(var(--cp-bottomnav-h)_+_var(--cp-safe-bottom))] z-30 border-t border-gray-200 bg-white p-3 md:static md:z-auto md:border-0 md:bg-transparent md:p-0">
        {href && !disabled
          ? <Link href={href} className={actionClass}>{label}</Link>
          : (
            <button type="button" onClick={onSelect} disabled={disabled} className={actionClass}>
              {label}
            </button>
          )}
        {hint && <p className="mt-1.5 text-center text-[11.5px] text-gray-500 md:text-left">{hint}</p>}
      </div>
    </>
  );
}
