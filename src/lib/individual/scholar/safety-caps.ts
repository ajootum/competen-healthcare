/* eslint-disable @typescript-eslint/no-explicit-any */
// ── WHEN THE RULES-V3 SCORING CAPS APPLY ── owner decision 1, 4 Nov 2026 (CLINICAL-GOVERNANCE-ACTIVATION), migration 998 ──────────
//
// The caps (scoring-rules.ts: unsafe at most UNSAFE_SCORE_CAP, safety-critical failure CRITICAL_MISS_SCORE_CAP, each at the rubric's
// own scope) change a learner's marks ONLY when all three hold:
//   1. the HQ policy scholar_clinical_scoring_caps is on -- the master switch. Off, nothing is capped and nothing is read;
//   2. the attempt is on a governed LIBRARY COPY (QuestionRow.library, from individual_scholar_question.library_version_id), never a personal
//      or AI question;
//   3. the database says that version's markers are clinically approved (ckri_library_caps_approved, 998): it is published,
//      clinically approved on its current content, and the required independent reviewers EXPLICITLY approved its safety-critical
//      and unsafe-response markers and their scoring scope on that exact content.
// Every other case records the flag and shows the feedback, uncapped (formative). A read that fails, or 998 absent, caps nothing.

import type { CapPolicy } from "./scoring-rules";

/** What decides the cap for one attempt. */
export type CapGate = { switchOn: boolean; libraryVersionId: string | null; markersApproved: boolean };

/** Pure. The cap policy for one attempt: all three conditions, or no caps. */
export function capPolicyOf(g: CapGate): CapPolicy {
  return { capsActive: g.switchOn && !!g.libraryVersionId && g.markersApproved };
}

/**
 * The cap policy for an attempt on question `q`. Reads the database only when the switch is on and `q` is a library copy. A failed
 * read is "not approved": nothing is capped, the flag is still recorded.
 */
export async function questionCapPolicy(admin: any, q: { library?: { versionId: string } | null }, switchOn: boolean): Promise<CapPolicy> {
  // QuestionRow.library (710): set only on a governed copy whose version is still published and approved; null for the learner's own.
  const libraryVersionId = q.library?.versionId ?? null;
  if (!switchOn || !libraryVersionId) return capPolicyOf({ switchOn, libraryVersionId, markersApproved: false });
  const r = await admin.rpc("ckri_library_caps_approved", { p_version: libraryVersionId }).then((x: any) => x, () => ({ data: null, error: true }));
  return capPolicyOf({ switchOn, libraryVersionId, markersApproved: !r?.error && r?.data === true });
}
