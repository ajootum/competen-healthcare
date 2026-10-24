import { generate } from "@/lib/ai/client";
import type { SelectableFact } from "@/lib/practice/document-facts";
import { verifyGrounded, type PhrasingViolation } from "@/lib/ai/grounding";

// CPR-DOC-AUTO-001 section 10 -- AI SAFETY AND CLINICAL INTEGRITY.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHAT THE MODEL IS ALLOWED TO DO, WHICH IS LESS THAN IT SOUNDS.
//
// Section 10: "AI may improve organization, grammar and professional phrasing." That is the whole
// permission. It turns
//
//     Diagnoses
//     - Type 2 diabetes mellitus (confirmed)
//     Treatment given
//     - Metformin (oral - 500mg - twice daily - 5 days)
//
// into a paragraph a colleague can read. It does not decide anything, add anything, or soften anything.
//
// THREE THINGS THE MODEL NEVER RECEIVES, and each is a line from section 10:
//
//   1. THE PATIENT'S RECORD. Only the SELECTED facts are sent -- section 2's bounded payload. The
//      model cannot disclose what it was never given, so "disclosure control" is not a behaviour the
//      model has to get right.
//   2. THE PRACTITIONER'S OWN WORDS. Section 10: "Clearly separate practitioner-entered referral
//      reason/question from generated narrative." The typed reason, indication, purpose and requested
//      action are never sent for rewriting and never replaced. They appear verbatim, composed by the
//      same deterministic function as before.
//   3. ANY IDENTITY. No name, no patient number, no date of birth. Those live in the scaffold, which
//      the model does not touch, so a rephrased letter cannot be a letter about somebody else.
//
// AND THE OUTPUT IS VERIFIED BEFORE IT IS USED. See verifyGrounded. A prompt instructing a model not
// to invent is a hope, not a control -- section 17 makes grounding a PASS condition, and a PASS
// condition needs something that can fail.
//
// FAILURE IS NOT AN ERROR. Anything unverifiable falls back to the deterministic composition, which is
// section 10's own remedy: "Where source data is insufficient, omit the section or use an honest
// neutral structure  --  never fill gaps creatively." A practitioner who asked for prose and got the
// list has lost nothing except the prose, and is told which they got.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

// The grounding verifier moved to Holdings (src/lib/ai/grounding.ts, COMPETEN-HOLDINGS-SHARED-ENGINES-01),
// verbatim. Re-exported here so every Practice import is unchanged.
export { verifyGrounded, ASSERTION_MARKERS, type PhrasingViolation } from "@/lib/ai/grounding";

export type PhrasingResult =
  | { phrasing: "assisted"; narrative: string }
  | { phrasing: "deterministic"; reason: PhrasingRefusal; violations?: PhrasingViolation[] };

export type PhrasingRefusal =
  | "not_requested" | "not_enabled" | "not_configured" | "no_facts"
  | "generation_failed" | "failed_verification";


const SYSTEM = [
  "You rewrite lists of already-recorded clinical facts as short professional prose for a clinical document.",
  "",
  "RULES, in order of importance:",
  "1. Use ONLY the facts given. Never add a diagnosis, finding, examination, test result, severity,",
  "   response to treatment, recurrence, chronology or instruction that is not explicitly present.",
  "2. If a fact is thin, say only what is there. Never complete a sentence with a plausible detail.",
  "3. Keep every section heading exactly as given, on its own line. Rewrite only the lines beneath it.",
  "4. Keep every number, dose, frequency, duration and date exactly as given. Do not convert units.",
  "5. Keep every clinical term as written. Do not substitute a synonym, expand an abbreviation or",
  "   translate a term into plainer words.",
  "6. Do not address the reader, do not open or close the letter, and do not add a greeting or",
  "   signature. You are writing the middle of a document only.",
  "7. Write two or three sentences per section at most. Shorter is better.",
  "",
  "Output the headings and prose only. No preamble, no explanation, no markdown.",
].join("\n");

/** The bounded payload, and nothing else, as the model sees it. */
export function phrasingPayload(sections: { heading: string; facts: SelectableFact[] }[]): string {
  return sections.map(s => [
    s.heading,
    ...s.facts.map(f => (f.detail ? `- ${f.label} (${f.detail})` : `- ${f.label}`)),
  ].join("\n")).join("\n\n");
}

/**
 * Ask the model to phrase the fact sections, and refuse its answer unless it verifies.
 *
 * Returns the narrative to use INSTEAD of the deterministic fact blocks, or a refusal naming why the
 * caller should keep the deterministic ones. Never throws and never returns unverified prose.
 */
export async function phraseFactSections(args: {
  sections: { heading: string; facts: SelectableFact[] }[];
  typed: string[];
  enabled: boolean;
  canGenerate: boolean;
  workspaceId: string;
  userId: string;
}): Promise<PhrasingResult> {
  // THE CONSENT GATE IS CHECKED HERE, not only at the API edge. A practice that has not turned the
  // assistant on, or has not accepted the current disclosure, has not agreed to this.
  if (!args.enabled) return { phrasing: "deterministic", reason: "not_enabled" };
  if (!args.canGenerate) return { phrasing: "deterministic", reason: "not_configured" };

  const facts = args.sections.flatMap(s => s.facts);
  if (!facts.length) return { phrasing: "deterministic", reason: "no_facts" };

  const result = await generate({
    system: SYSTEM,
    user: phrasingPayload(args.sections),
    tier: "reasoning",
    maxTokens: 900,
    context: { userId: args.userId, attribution: { scope: "workspace", workspaceId: args.workspaceId }, operation: "practice.document_phrasing" },
  });
  if (!result.ok) return { phrasing: "deterministic", reason: "generation_failed" };

  const violations = verifyGrounded(result.text, facts, args.typed);
  if (violations.length) return { phrasing: "deterministic", reason: "failed_verification", violations };

  return { phrasing: "assisted", narrative: result.text.trim() };
}
