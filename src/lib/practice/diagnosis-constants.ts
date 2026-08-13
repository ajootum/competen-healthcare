// CP-ENC-DIAG-001 -- the values a BROWSER needs, in one imports-nothing file.
//
// ⚠ THIS FILE MUST IMPORT NOTHING, and the reason is a build failure rather than a preference.
// DiagnosisWorkspace.tsx is "use client" and needs the certainty vocabulary and the working-set cap.
// Taking them from diagnosis-capture.ts pulled that module in, which imports access.ts, which imports
// `next/headers` -- and a client module that imports so much as one value from a server-reaching module
// takes the WHOLE module with it. `next build` fails with an import trace on pages nobody touched.
//
// ⚠ tsc PASSES IT. eslint PASSES IT. Only the build says a word, which is why this pattern already
// exists twice in this codebase -- import-columns.ts for the patient importer, and
// patient-access-constants.ts for the booking page -- and why it needed a third instance here.
//
// The engine re-exports these so there is still one definition and callers may import either.

export const DIAGNOSIS_CERTAINTIES = ["suspected", "provisional", "confirmed", "ruled_out"] as const;
export type DiagnosisCertainty = (typeof DIAGNOSIS_CERTAINTIES)[number];
export const DEFAULT_CERTAINTY: DiagnosisCertainty = "provisional";

/** s3's cap on one working set. Named, so a caller is refused rather than silently truncated. */
export const MAX_PENDING_DIAGNOSES = 20;

/**
 * The left-edge band on a RECORDED diagnosis row: how settled the finding is, at a glance.
 *
 * ⚠ ONE HUE AT THREE WEIGHTS, NOT THE ALERT PALETTE, AND THAT IS THE WHOLE DESIGN. Certainty is a
 * CONFIDENCE axis and the alert tokens are a GOOD/BAD one. Green for `confirmed` would read as
 * reassurance on a confirmed cancer, and amber for `provisional` would make ordinary clinical practice
 * look like something is wrong. Keeping certainty on its own hue also leaves the warning and critical
 * tokens free to mean an actual warning when one lands on the same row.
 *
 * ⚠ `ruled_out` IS NOT THE BOTTOM OF THE RAMP. It is a negation rather than a weak diagnosis, so it
 * steps out of the hue entirely -- grey, dashed, struck through. A reader who takes it for "probably
 * has this" has read the record backwards, which is the one misreading this list must not allow.
 *
 * ⚠ AN UNRECOGNISED CERTAINTY FALLS TO THE WEAKEST BAND, NEVER THE STRONGEST. A value this file does
 * not know -- a typo, a newer vocabulary, a stale client -- must not be drawn as `confirmed`. The same
 * shape as the procedure engine coercing an unknown status to PERFORMED: the failure has to land on the
 * side that claims LESS about a patient.
 *
 * ⚠ IT ALSO SURVIVES GREYSCALE. Three weights of one hue plus a dash pattern means the ruled-out row is
 * still distinguishable with no colour vision at all, which a hue-coded scheme would not be.
 */
export function diagnosisBand(certainty: string): {
  edge: string; dashed: boolean; struck: boolean;
} {
  switch (certainty) {
    case "confirmed":
      return { edge: "var(--cp-primary)", dashed: false, struck: false };
    case "provisional":
      return { edge: "color-mix(in srgb, var(--cp-primary) 55%, transparent)", dashed: false, struck: false };
    case "ruled_out":
      return { edge: "var(--cmp-text-neutral)", dashed: true, struck: true };
    case "suspected":
    default:
      return { edge: "color-mix(in srgb, var(--cp-primary) 26%, transparent)", dashed: false, struck: false };
  }
}
