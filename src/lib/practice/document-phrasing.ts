import { generate } from "@/lib/ai/client";
import type { SelectableFact } from "@/lib/practice/document-facts";

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

export type PhrasingViolation =
  | { kind: "ungrounded_number"; token: string }
  | { kind: "ungrounded_month"; token: string }
  | { kind: "asserted_finding"; token: string }
  | { kind: "fact_missing"; label: string }
  | { kind: "empty" };

export type PhrasingResult =
  | { phrasing: "assisted"; narrative: string }
  | { phrasing: "deterministic"; reason: PhrasingRefusal; violations?: PhrasingViolation[] };

export type PhrasingRefusal =
  | "not_requested" | "not_enabled" | "not_configured" | "no_facts"
  | "generation_failed" | "failed_verification";

/**
 * Words that ASSERT something section 10 forbids inventing.
 *
 * Severity, examination findings, test results, response to treatment, recurrence. Each of these is a
 * clinical claim that cannot be derived from a label and a dose -- "stable", "unremarkable" and
 * "tolerated well" are the shapes a fluent model reaches for when a sentence feels unfinished.
 *
 * ⚠ THE LIST IS A NET, NOT A PROOF, AND TWO OF SECTION 10'S SEVEN CATEGORIES ARE NOT IN IT.
 * "Chronology" and "recipient instruction" are not word-detectable: "then", "after" and "please
 * arrange" are ordinary connectives that appear in correct letters, and banning them would reject
 * good output constantly while a determined invention would phrase around them anyway. Those two rest
 * on the number check below, on the practitioner reading the draft, and on the document being an
 * unsigned DRAFT until they approve it. Do not describe this function as verifying all of section 10.
 *
 * A marker is a violation only when it is ABSENT from the payload. A diagnosis recorded as "resolved
 * pneumothorax" contains "resolved" legitimately, and rejecting it would be the verifier inventing a
 * problem of its own.
 */
export const ASSERTION_MARKERS = [
  // severity
  "mild", "moderate", "severe", "significant", "marked", "slight", "extensive",
  // examination
  "examination", "examined", "palpation", "auscultation", "tender", "tenderness",
  "no abnormality", "nad", "unremarkable",
  // test result
  "normal", "abnormal", "negative", "positive", "elevated", "raised", "reduced",
  "within normal limits", "inconclusive",
  // response to treatment
  "improved", "improving", "worsened", "worsening", "deteriorated", "responded", "responding",
  "tolerated", "stable", "resolved", "settled", "unchanged", "no better", "well controlled",
  // recurrence
  "recurrent", "recurrence", "relapse", "relapsed", "flare", "again",
];

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/**
 * Spelled-out numbers, mapped to digits.
 *
 * Without this the number check has an obvious hole: a model that writes "five days" when no duration
 * was recorded has invented a duration, and "five" is not a digit. Checking the word against the
 * digits in the payload closes it.
 */
const NUMBER_WORDS: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6",
  seven: "7", eight: "8", nine: "9", ten: "10", eleven: "11", twelve: "12",
};

const normalise = (s: string) => s.toLowerCase().replace(/[‐-―]/g, "-");

const numbersIn = (s: string): string[] =>
  (normalise(s).match(/\d+(?:\.\d+)?/g) ?? []).map(n => n.replace(/^0+(?=\d)/, ""));

/** The longest word of a label, which is the token a rephrasing is least likely to drop. */
const anchorOf = (label: string): string | null => {
  const words = normalise(label).split(/[^a-z0-9]+/).filter(w => w.length >= 4);
  if (!words.length) return null;
  return words.reduce((a, b) => (b.length > a.length ? b : a));
};

/**
 * ⚠ THE CONTROL SECTION 17 TURNS ON. Everything else in this module is plumbing.
 *
 * Given the prose a model returned and the facts it was given, report every clinical assertion the
 * payload does not support. Pure, so it can be tested exhaustively without a model, a database or a
 * network -- and so a future change that needs it to be lenient has to say so in this file.
 *
 * `typed` is the practitioner's own text. It counts as grounding: section 17's PASS condition is
 * "supported by selected source data OR explicit practitioner input".
 */
export function verifyGrounded(prose: string, facts: SelectableFact[], typed: string[] = []): PhrasingViolation[] {
  const violations: PhrasingViolation[] = [];
  const body = normalise(prose);
  if (!body.trim()) return [{ kind: "empty" }];

  const payload = normalise(
    [...facts.map(f => `${f.label} ${f.detail ?? ""}`), ...typed].join(" \n "));

  // 1. NUMBERS. A dose, a duration, a frequency, a count. The most dangerous invention and the most
  //    reliably detectable, because a number is either in the payload or it is not.
  const payloadNumbers = new Set(numbersIn(payload));
  for (const n of new Set(numbersIn(prose))) {
    if (!payloadNumbers.has(n)) violations.push({ kind: "ungrounded_number", token: n });
  }
  for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(body) && !payloadNumbers.has(digit) && !payload.includes(word)) {
      violations.push({ kind: "ungrounded_number", token: word });
    }
  }

  // 2. MONTH NAMES. A model rewriting 2026-09-10 as "10 September 2026" is doing its job, and the
  //    number check passes it because 10 and 2026 are both in the payload. Swapping September for
  //    October would ALSO pass it, which is why the month is checked by name.
  const payloadMonths = new Set(
    (payload.match(/\d{4}-(\d{2})-\d{2}/g) ?? []).map(d => MONTHS[Number(d.slice(5, 7)) - 1]));
  for (const m of MONTHS) {
    if (new RegExp(`\\b${m}\\b`).test(body) && !payloadMonths.has(m) && !payload.includes(m)) {
      violations.push({ kind: "ungrounded_month", token: m });
    }
  }

  // 3. ASSERTED FINDINGS. See ASSERTION_MARKERS for what this does and does not cover.
  for (const marker of ASSERTION_MARKERS) {
    const pattern = new RegExp(`\\b${marker.replace(/ /g, "\\s+")}\\b`);
    if (pattern.test(body) && !pattern.test(payload)) {
      violations.push({ kind: "asserted_finding", token: marker });
    }
  }

  // 4. NOTHING DROPPED. A fact that vanishes from the prose is not a safety problem in the same way,
  //    but practice_document_fact would then record a disclosure the document does not contain -- the
  //    provenance table would be lying in the other direction.
  for (const f of facts) {
    const anchor = anchorOf(f.label);
    if (anchor && !body.includes(anchor)) violations.push({ kind: "fact_missing", label: f.label });
  }

  return violations;
}

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
    context: { userId: args.userId, tenantId: args.workspaceId, operation: "practice.document_phrasing" },
  });
  if (!result.ok) return { phrasing: "deterministic", reason: "generation_failed" };

  const violations = verifyGrounded(result.text, facts, args.typed);
  if (violations.length) return { phrasing: "deterministic", reason: "failed_verification", violations };

  return { phrasing: "assisted", narrative: result.text.trim() };
}
