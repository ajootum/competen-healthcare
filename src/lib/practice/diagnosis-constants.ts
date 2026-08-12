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
