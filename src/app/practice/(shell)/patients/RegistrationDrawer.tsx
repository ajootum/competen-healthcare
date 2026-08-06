"use client";

import { useRef } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";

// CPR-V5-006 s5 -- Quick Registration as a DRAWER, opened by "+ New Patient".
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THE FORM STOPPED BEING THE PAGE.
//
// The registration form is the longest thing in this workspace and it is the least often needed. Most of
// what happens at a desk is finding somebody who already exists -- which is also the only reliable
// defence against duplicate records. A form that occupies the screen invites the opposite order: type
// the name into the form, not into the search, and register a second record for a patient who is already
// on the register. So search leads, the worklists and the cohort fill the page, and registration is one
// deliberate click away.
//
// NOTHING ABOUT THE FORM ITSELF CHANGED. It still registers, attaches guardians, saves drafts, queues
// walk-ins and books appointments; it is the same component in a different container.
//
// aria-modal="true" IS A PROMISE THAT EVERYTHING BEHIND IS INERT, and useModalFocus is what keeps it:
// focus moves in, Tab wraps inside, Escape closes, focus returns to the button that opened it. A dialog
// that makes the promise without keeping it is worse than a plain panel -- a screen-reader user is told
// the page behind is unavailable while a keyboard user Tabs straight into it.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export default function RegistrationDrawer({ open, onClose, children }: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const panel = useRef<HTMLDivElement | null>(null);
  useModalFocus(open, panel, onClose);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40">
      {/* The scrim is a plain click target, not a dialog: giving it a role would announce an empty one. */}
      <button
        type="button"
        aria-label="Close registration"
        onClick={onClose}
        className="flex-1 cursor-default"
      />
      <div
        ref={panel}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Register a patient"
        className="h-full w-full max-w-[980px] overflow-y-auto bg-[var(--cp-canvas)] shadow-2xl outline-none"
      >
        <div className="sticky top-0 z-10 flex items-baseline justify-between gap-3 border-b border-gray-200 bg-white px-5 py-3">
          <div>
            <h2 className="text-[16px] font-bold text-gray-900">New patient</h2>
            <p className="text-[12px] text-gray-500">
              Search first &mdash; register only when nobody on the register matches.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-semibold text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
