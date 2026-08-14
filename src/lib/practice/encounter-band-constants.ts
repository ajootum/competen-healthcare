// CPR-HFE-TRT-004 s3 + CPR-PROC-HFE-005 s4/s16 -- THE COGNITIVE BANDS, SHARED BY BOTH CAPTURE TABS.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// ⚠ THIS FILE EXISTS BECAUSE CPR-PROC-HFE-005 s17 ASKS FOR SIBLINGS, NOT LOOKALIKES.
//
//   Recorded treatments        ->  Recorded procedures
//   Frequently used treatments ->  Frequently used procedures
//   Add a treatment            ->  Add procedures
//   Treatment-specific composer ->  Procedure-specific working item
//
// s17: "The tabs should feel like siblings in interaction language while retaining different clinical
// semantics." Two hand-maintained copies of five Tailwind strings drift within a week -- that is exactly
// how Diagnoses, Treatment, Procedures and Investigations ended up with four different row shapes, which
// is the drift CP-UI-TABLE-001 s12 was written to stop. One definition, two importers.
//
// ⚠ IMPORTS NOTHING, AND MUST CONTINUE TO. Both importers are `"use client"`. A constants module that
// reached for a server helper would drag the chain into the browser bundle -- passed by tsc, passed by
// eslint, caught only by `next build`.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** Band 1 -- the clinical record. The only pure white band, because it is what a reader should find first. */
export const BAND_RECORD = "rounded-xl border border-slate-200 bg-white";

/** Band 2 at rest -- safety with nothing outstanding. s4 gives green to a KNOWN normal state. */
export const BAND_SAFETY_OK = "rounded-xl border border-emerald-200 bg-emerald-50/40";

/**
 * Band 2 when something is outstanding.
 *
 * ⚠ WHAT TURNS THIS AMBER IS THE WHOLE POINT OF IT (s12). A real alert, or a safety question nobody has
 * answered. NEVER missing optional data: "do not use amber for neutral missing optional information",
 * and most consultations are missing something optional. Amber on every ordinary screen is how a
 * practitioner learns to stop seeing amber.
 */
export const BAND_SAFETY_ATTENTION = "rounded-xl border border-amber-300 bg-[var(--cmp-surface-warning)]";

/** Band 3 -- shortcuts. Deliberately subordinate: a typing convenience between the record and the work. */
export const BAND_SHORTCUTS = "rounded-xl border border-slate-200 bg-slate-50/70";

/**
 * Band 4 -- the active documentation task.
 *
 * ⚠ THE ONLY 2px BORDER ON THE PAGE, AND THAT IS LOAD-BEARING. s3: "the active documentation task must
 * be visually dominant", and CPR-HFE-TRT-004 s14 requires the right rail to stay visibly secondary to
 * it. The rail's own tiers are asserted never to take a 2px border for exactly this reason.
 */
export const BAND_WORK = "rounded-xl border-2 border-[var(--cp-primary)]/25 bg-[var(--cp-primary)]/[0.04]";
