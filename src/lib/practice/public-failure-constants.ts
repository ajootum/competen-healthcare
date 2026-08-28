// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CPR-BOOK-HFE-002 s16/s17 -- THE PUBLIC PAGE'S FAILURE STATES, AS ONE VOCABULARY.
//
// s16's rule: "If readiness fails, return a structured internal reason code and translate it to one
// actionable practitioner message. Do not collapse every failure into 'This practice does not take
// online bookings.'" The reason codes live on publicBookingEntry (the resolver that actually decides
// what a patient is shown). THIS file is the translation layer: for each code, the action a
// practitioner takes and where it lives -- so the setup workspace can quote the exact sentence a
// patient is seeing and put the correction one press away.
//
// ⚠ THE PATIENT SENTENCE IS NOT DUPLICATED HERE. The entry composes `whyNot`/`patientNote` itself and
// the practitioner surface quotes the entry VERBATIM -- one source, so the quote can never drift from
// what the page actually says. This file carries only what the entry does not: the practitioner's
// next act. Touches no database, importable by a client component.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type PublicFailureAction = {
  /** The practitioner's next act, in their words. */
  label: string;
  /** Where that act lives. Null when nothing a practitioner can press would change it. */
  href: string | null;
  /** Said when href is null -- why this is not theirs to fix from here. */
  why: string | null;
};

export const PUBLIC_FAILURE_ACTIONS: Record<string, PublicFailureAction> = {
  PAGE_NOT_PUBLISHED: {
    label: "Review & publish your booking page",
    href: "/practice/setup/patient-booking?tab=publish", why: null,
  },
  PAGE_PAUSED: {
    label: "Resume your booking page",
    href: "/practice/setup/patient-booking?tab=publish", why: null,
  },
  NO_PUBLIC_CLINIC: {
    label: "Turn on online booking for a clinic",
    href: "/practice/setup/patient-booking?tab=clinics", why: null,
  },
  NOTHING_OFFERED: {
    label: "Choose the locations and appointment types your page shows",
    href: "/practice/setup/patient-booking?tab=page", why: null,
  },
  NO_WAY_TO_SEND_A_CODE: {
    label: "Accept requests without a code, or wait for a sending channel",
    href: "/practice/setup/patient-booking?tab=page",
    why: null,
  },
  NO_PATIENT_SCREEN: {
    label: "",
    href: null,
    why: "The patient-facing screens are not part of this deployment. Nothing on your side changes this.",
  },
  COULD_NOT_CHECK: {
    label: "",
    href: null,
    why: "A read failed just now. This usually passes on its own — nothing needs correcting.",
  },
};

/** The action for a code this file has never heard of: name it honestly rather than inventing one. */
export const publicFailureAction = (code: string): PublicFailureAction =>
  PUBLIC_FAILURE_ACTIONS[code] ?? {
    label: "", href: null,
    why: "This state has no recorded correction. That is a gap in this product's vocabulary, not a step you missed.",
  };
