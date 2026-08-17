"use client";

import { useId, useRef } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { useBodyScrollLock } from "./use-body-scroll-lock";

// CPR-MOB-001 s5 — "Desktop modal → Modal → Full-screen sheet/page for multi-field tasks."
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// A MULTI-FIELD TASK GETS THE WHOLE SCREEN. A desktop modal floats because the page behind it is
// worth keeping in view; at phone width that floating chrome is padding stolen from form fields, and
// a half-height dialog puts its own footer under the keyboard (s16 forbids critical actions beneath
// it with no way to reach them). So below md this is the full viewport — header, scrolling body,
// optional footer — and from md up the SAME dialog renders as the centred modal the desktop design
// already speaks. One component, one open/close contract, no page ever asks "which modal am I in".
//
// THE FOOTER IS WHERE THE ADOPTER'S PRIMARY ACTION BELONGS. It is pinned below the scrolling body, so
// Save is visible however long the form is — and it is a slot rather than a built-in button because
// the action's label, disabled state and the REASON it is disabled are the form's own facts. (A
// disabled button with no visible reason reads as a broken product; the walkthrough proved it.)
//
// aria-modal IS KEPT HONEST BY useModalFocus — focus in, Tab wrapped, Escape closes, focus returned.
// Body scroll locks while open. The backdrop is a real button, visible from md up; below md the sheet
// covers it, and Escape plus the labelled Close carry the same exit (s17: no gesture-only ways out).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function FullScreenSheet({ open, onClose, title, children, footer }: {
  open: boolean;
  onClose: () => void;
  /** The task's name, rendered as the sheet's heading and announced as the dialog's label. */
  title: string;
  children: React.ReactNode;
  /** The pinned action row — the adopting form's Save/Continue, at its own size and wording. */
  footer?: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  const titleId = useId();
  useModalFocus(open, panel, onClose, { initialIndex: 1 });
  useBodyScrollLock(open);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        aria-label={`Close ${title}`}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/40"
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="absolute inset-0 flex flex-col bg-[var(--cp-canvas)] outline-none md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[85vh] md:w-full md:max-w-2xl md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:shadow-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2.5 md:rounded-t-2xl">
          <h2 id={titleId} className="min-w-0 truncate text-[16px] font-bold text-gray-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-[var(--cp-touch)] shrink-0 items-center rounded-lg border border-gray-200 bg-white px-3 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">{children}</div>

        {footer && (
          <div className="border-t border-gray-200 bg-white p-3 pb-[calc(var(--cp-safe-bottom)_+_12px)] md:rounded-b-2xl md:pb-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
