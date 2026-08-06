"use client";

import Link from "next/link";
import { ACTION_DISABLED, ACTION_SWATCH } from "@/lib/practice/palette";
import { CARD } from "./Honesty";
import type { ScreenCapabilities } from "./types";

// CPR-PAT-002 s7 -- the eight quick actions.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ALL EIGHT ARE DRAWN. THE ONES THAT CANNOT RUN SAY WHY, ON THEMSELVES.
//
// Three of the eight need a patient before they mean anything -- you cannot open an encounter, print a
// summary or merge a duplicate for nobody -- and one of the eight does not exist in this product at all.
// The tempting thing is to hide those four until they apply. It is the wrong thing: a specification's
// action list is a promise about what this screen does, and an action that silently is not there is
// indistinguishable from one somebody forgot. So each is rendered, disabled, carrying the sentence that
// says what it is waiting for.
//
// NOTHING HERE IMPLEMENTS A WRITE. Every action either opens the registration drawer (which owns the
// only write on this screen) or navigates to the surface that already performs it -- merge lives on the
// patient's own record because it is irreversible and takes the surviving record's Practice ID, and
// booking lives in follow-ups. A second implementation of any of them would give the product two answers
// to the same question.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

type Action = {
  key: string;
  label: string;
  /** Set when the action can run: either somewhere to go, or something to do. */
  href?: string;
  onClick?: () => void;
  /** Set when it cannot. Rendered on the row, never used to hide it. */
  blocked?: string;
};

export default function QuickActions({
  capabilities, selectedPatientId, onNewPatient, onWalkIn,
}: {
  capabilities: ScreenCapabilities;
  selectedPatientId: string | null;
  onNewPatient: () => void;
  onWalkIn: () => void;
}) {
  const needsPatient = "Select a patient in the register first — this acts on one record.";

  const actions: Action[] = [
    {
      key: "new_patient", label: "New patient",
      onClick: capabilities.mayCreate ? onNewPatient : undefined,
      blocked: capabilities.mayCreate ? undefined : "Your role does not carry patient.create.",
    },
    {
      key: "walk_in", label: "Walk-in registration",
      onClick: capabilities.mayCreate ? onWalkIn : undefined,
      blocked: capabilities.mayCreate ? undefined : "Your role does not carry patient.create.",
    },
    {
      key: "open_encounter", label: "Open encounter",
      href: selectedPatientId && capabilities.mayStartEncounter ? `/practice/patients/${selectedPatientId}` : undefined,
      blocked: !capabilities.mayStartEncounter
        ? "Your role does not carry encounter.create."
        : selectedPatientId ? undefined : needsPatient,
    },
    { key: "upload_document", label: "Upload document", href: "/practice/documents" },
    { key: "schedule_follow_up", label: "Schedule follow-up", href: "/practice/follow-ups" },
    {
      key: "print_summary", label: "Print summary",
      // HONEST ABOUT WHAT IT PRINTS. There is no generated summary document behind this; it prints the
      // page as it stands, with the selected patient's panel on it.
      onClick: selectedPatientId ? () => window.print() : undefined,
      blocked: selectedPatientId
        ? undefined
        : "Select a patient — this prints the page with their summary panel open. There is no separate summary document to generate.",
    },
    {
      key: "merge_duplicate", label: "Merge duplicate",
      href: selectedPatientId ? `/practice/patients/${selectedPatientId}` : undefined,
      blocked: selectedPatientId
        ? undefined
        : "Select the record that will SURVIVE the merge. Merging is irreversible and is performed on that record, which is why it lives there and not here.",
    },
    {
      key: "import_patients", label: "Import patients",
      blocked: "Not built. There is no bulk-import endpoint under /api/v1/practice — registration is one record at a time, through the path that runs duplicate detection.",
    },
  ];

  return (
    <section className={`${CARD} p-4`}>
      <h2 className="text-[13.5px] font-bold text-gray-900">Quick actions</h2>
      <ul className="mt-2.5 flex flex-col gap-0.5">
        {actions.map(a => {
          const s = ACTION_SWATCH[a.key];
          const live = !a.blocked;
          const inner = (
            <>
              <span
                aria-hidden
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[13px] ${live ? s.badge : ACTION_DISABLED}`}
              >
                {s.icon}
              </span>
              <span className="min-w-0">
                <span className={`block text-[12.5px] font-semibold ${live ? "text-gray-800" : "text-gray-400"}`}>
                  {a.label}
                </span>
                {a.blocked && (
                  <span className="mt-0.5 block text-[10.5px] leading-relaxed text-gray-400">{a.blocked}</span>
                )}
              </span>
            </>
          );
          return (
            <li key={a.key}>
              {a.href && live ? (
                <Link href={a.href} className="flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-gray-50">
                  {inner}
                </Link>
              ) : a.onClick && live ? (
                <button
                  type="button"
                  onClick={a.onClick}
                  className="flex w-full items-start gap-2.5 rounded-lg px-1.5 py-1.5 text-left hover:bg-gray-50"
                >
                  {inner}
                </button>
              ) : (
                <span className="flex cursor-not-allowed items-start gap-2.5 rounded-lg px-1.5 py-1.5" aria-disabled>
                  {inner}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
