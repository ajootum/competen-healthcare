// CPR-HFE-REF-001 -- the one vocabulary every practitioner-facing refusal speaks.
//
// ──────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THIS FIXES, AND WHAT IT DELIBERATELY DOES NOT.
//
// The refusal pattern itself was right and is untouched: an absence is rendered as an absence, with its
// reason, and never as a blank, a zero or an ordinary empty state. What was wrong was the AUDIENCE. A
// practitioner opening the Patients screen was shown "Elements of the CPR-PAT-002 design and
// specification that this record cannot honestly support" -- a document id they have never heard of,
// attached to prose written for whoever reviews the comp.
//
// ⚠ THE SPEC REFERENCE IS NOT DELETED. It moves. CPR-HFE-REF-001 s11 requires that Product Director and
// Engineering keep the reason code, the source subsystem and the specification provenance, because that
// is how anybody answers "why is this refused" six months from now. So every refusal carries BOTH
// halves, and the type makes the boundary structural rather than a matter of remembering:
// `internal` is a separate object, and no practitioner-facing component reads it.
//
// A test enforces the boundary rather than a convention -- see scripts/practice-refusal-harness.ts.
// A convention held in people's heads is how the first version of this got shipped.
//
// This module is client-safe on purpose: no imports, no engine, no next/headers. The registries that
// consume it are rendered inside client components.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * CPR-HFE-REF-001 s3. Six states, and the distinctions between them are the whole point -- s4 spends a
 * paragraph on each because collapsing any two of them is how a refusal starts lying.
 */
export type RefusalState =
  /** The capability, storage or data model does not exist. NOT an empty state. */
  | "NOT_AVAILABLE_YET"
  /** The product does not calculate or collect this. ⚠ Never substitute a zero. */
  | "NOT_MEASURED"
  /** The capability exists; this practice has not set it up. There may be a real CTA. */
  | "NOT_CONFIGURED"
  /** Fully supported, genuinely nothing recorded yet. The only one that is an ordinary empty state. */
  | "NO_DATA_YET"
  /** It exists and this user may not see it. ⚠ Must not reveal what, whose, or why in detail. */
  | "RESTRICTED"
  /** A transient failure of something normally available. Not a product refusal. */
  | "UNAVAILABLE_TEMPORARILY";

/**
 * s3's practitioner-facing meanings, verbatim. Held here so a screen cannot invent its own phrasing for
 * a state and quietly drift from the others -- s13 "Cross-screen consistency" is an acceptance
 * criterion, not a preference.
 */
export const REFUSAL_STATE_COPY: Record<RefusalState, { title: string; meaning: string }> = {
  NOT_AVAILABLE_YET: {
    title: "Not available yet",
    meaning: "Competen Practice does not currently support or store this information.",
  },
  NOT_MEASURED: {
    title: "Not measured",
    meaning: "Competen Practice is not currently measuring this information.",
  },
  NOT_CONFIGURED: {
    title: "Not configured",
    meaning: "Set this up to make the information available.",
  },
  NO_DATA_YET: {
    title: "No data yet",
    meaning: "There is nothing to show here yet.",
  },
  RESTRICTED: {
    title: "Restricted",
    meaning: "You do not have access to this information.",
  },
  UNAVAILABLE_TEMPORARILY: {
    title: "Temporarily unavailable",
    meaning: "We could not load this information. Try again.",
  },
};

/**
 * ⚠ THE STATES A CAPABILITY ABSENCE MAY NEVER BE DRESSED AS.
 *
 * s12 asks for a test that NO_DATA_YET cannot be used for a reason code describing something the
 * product cannot do. "No data yet" tells a practitioner to expect data once somebody records some --
 * which, when the truth is that no storage exists, is the exact lie the honesty doctrine forbids, in
 * the friendliest possible wording.
 */
export const EMPTY_STATE_LOOKALIKES: readonly RefusalState[] = ["NO_DATA_YET"];

/** Internal provenance. s6 marks every field here "Practitioner exposed? No". */
export type RefusalProvenance = {
  /** Stable machine-readable class, e.g. NO_TAG_STORAGE. The thing diagnostics group by. */
  reasonCode: string;
  /** e.g. "CPR-PAT-002 s4". Retained for Product Director and Engineering. */
  specReference?: string;
  /** Subsystem, table or capability producing the refusal, e.g. "practice_treatment". */
  source?: string;
  /** Developer explanation. This is where the old `detail` prose belongs. */
  technicalDetail?: string;
};

/** An action is offered ONLY where the practitioner can genuinely change the state (s10, s12). */
export type RefusalAction = { label: string; href: string };

export type Refusal = {
  key: string;
  state: RefusalState;
  /** Practitioner-facing. Short, plain, no jargon. Defaults to the state's own title. */
  title?: string;
  /** Practitioner-facing. Truthful and implementation-free. */
  reason: string;
  /** Practitioner-facing, and only when a real route exists. */
  nextAction?: RefusalAction | null;
  /** ⚠ NEVER RENDERED TO A PRACTITIONER. Read only by Product Director / Engineering surfaces. */
  internal: RefusalProvenance;
};

/** The title a practitioner sees: an override where one reads better, the canonical state title otherwise. */
export const refusalTitle = (r: Refusal): string => r.title ?? REFUSAL_STATE_COPY[r.state].title;

/**
 * ⚠ THE ONLY SHAPE A PRACTITIONER-FACING COMPONENT MAY RENDER.
 *
 * Deliberately returns a NEW object rather than the refusal itself. A component handed the whole
 * `Refusal` can reach `internal` by accident -- a spread, a debug dump, a "render everything we have"
 * loop -- and nothing would catch it. This makes the internal half unreachable by construction rather
 * than by discipline, which is the difference between a rule and a hope.
 */
export function practitionerView(r: Refusal): {
  key: string; state: RefusalState; title: string; reason: string; nextAction: RefusalAction | null;
} {
  return {
    key: r.key,
    state: r.state,
    title: refusalTitle(r),
    reason: r.reason,
    nextAction: r.nextAction ?? null,
  };
}

/**
 * The identifier shapes that must never reach a practitioner (s12). Exported so the ratchet and any
 * future authoring tool test the SAME pattern -- two copies of this regex is how one of them stops
 * matching and the guard goes quietly green.
 */
export const INTERNAL_IDENTIFIER_RE = /\b(CPR|COMP|PLAT|IAM|WEB|GOV|CST|CAP|HFE)-[A-Z0-9]{2,}(-[0-9]+)?\b/;

/** Implementation vocabulary that reads as jargon on a clinical screen even without an identifier. */
export const IMPLEMENTATION_JARGON_RE =
  /\b(comp|spec|specification|schema|migration|payload|endpoint|column|table|nullable|foreign key)\b/i;
