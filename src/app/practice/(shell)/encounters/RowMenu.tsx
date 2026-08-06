"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useDismiss } from "@/components/ui/use-dismiss";

// The ⋮ on an open-encounter row -- CPR-ENC-001 s9's comp draws one and the first build left it off.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// EVERY ITEM IS A DESTINATION THAT EXISTS, AND AN ITEM THAT CANNOT GO ANYWHERE SAYS WHY.
//
// A row menu is where invented actions collect: it is out of the way, it is easy to add to, and a greyed
// line with no explanation reads as "not yet" when it often means "never". So each entry here either
// navigates somewhere real or carries the sentence explaining what would have to be true for it to work.
// There is deliberately no "Cancel encounter" or "Delete": cancelling is a governed transition on the
// encounter's own state table, where the confirmation and the audit trail live, and putting a one-click
// copy of it on a list row is how a consultation gets cancelled by a mis-click on a trackpad.
//
// The scrim closes it on an outside click; useDismiss is the keyboard half (Escape, and focus returns to
// the ⋮ rather than to the top of the document).
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const ITEM = "block px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50";

export default function RowMenu({ encounterId, patientId, activityId, sessionTitle, canSeePatient }: {
  encounterId: string;
  patientId: string;
  activityId: string | null;
  sessionTitle: string | null;
  canSeePatient: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useDismiss(open, () => setOpen(false), trigger);

  const close = () => setOpen(false);

  return (
    <div className="relative">
      <button ref={trigger} type="button" onClick={() => setOpen(v => !v)}
        aria-expanded={open} aria-haspopup="menu" aria-label="More actions for this encounter"
        className="rounded-lg border border-transparent px-1.5 py-1 text-[13px] leading-none text-gray-400 hover:border-gray-200 hover:bg-white hover:text-gray-700">
        ⋮
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div role="menu" aria-label="Encounter actions"
            className="absolute right-0 z-20 mt-1 w-60 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
            <Link role="menuitem" href={`/practice/encounters/${encounterId}`} onClick={close} className={ITEM}>
              Open encounter
            </Link>

            {canSeePatient ? (
              <Link role="menuitem" href={`/practice/patients/${patientId}`} onClick={close} className={ITEM}>
                Open patient record
              </Link>
            ) : (
              // ⚠ NOT HIDDEN. A practitioner who cannot open the record should learn that from the menu
              // rather than from a 403 after the click, and hiding it makes the menu look shorter for
              // some people than for others with nothing saying why.
              <p className="px-3 py-2 text-[12px] text-gray-300">
                Open patient record
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">
                  Your role does not carry patient.list.
                </span>
              </p>
            )}

            {activityId ? (
              <Link role="menuitem" href={`/practice/encounters?session=${activityId}`} onClick={close} className={ITEM}>
                Only this session
                <span className="mt-0.5 block text-[10.5px] text-gray-400">
                  {sessionTitle ?? "Filters the lists below to this session"}
                </span>
              </Link>
            ) : (
              <p className="px-3 py-2 text-[12px] text-gray-300">
                Only this session
                <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">
                  This encounter is not filed against a session, so there is nothing to filter to.
                </span>
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
