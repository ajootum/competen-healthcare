// ── THE GROUNDING VERIFIER ── Holdings, shared by every product that shows AI text built from a source ──────
//
// COMPETEN-HOLDINGS-SHARED-ENGINES-01: "Develop shared infrastructure in Holdings, not inside Scholar or
// Professional." This is CPR-DOC-AUTO-001 section 10/17's verifier, MOVED here VERBATIM from
// src/lib/practice/document-phrasing.ts, which re-exports it so Practice is unchanged (its harness,
// practice-document-automation-harness, still runs every case against the Practice path). Competen Individual
// (Scholar explanations, questions, cases and competency rationales) imports it from here.
//
// What it checks, and what it does not, is documented on ASSERTION_MARKERS and verifyGrounded below and is
// unchanged by the move. It names no AI provider: the safety control must not vary with the vendor.

/** A source fact as the verifier reads it: a label, and an optional detail. Practice's SelectableFact is one. */
export type GroundingFact = { label: string; detail?: string | null };

export type PhrasingViolation =
  | { kind: "ungrounded_number"; token: string }
  | { kind: "ungrounded_month"; token: string }
  | { kind: "asserted_finding"; token: string }
  | { kind: "fact_missing"; label: string }
  | { kind: "empty" };

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
export function verifyGrounded(prose: string, facts: readonly GroundingFact[], typed: string[] = []): PhrasingViolation[] {
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

// ── FOR STUDY AND DEVELOPMENT TEXT ── added for Competen Individual, not part of the Practice verifier ──────
//
// A person's own notes or records are grounding TEXT, not structured facts, so they are passed as `typed`
// and no fact can be missing. One adjustment, stated here: the month check reads the word "may" as the
// month May. In study prose "may" is almost always the modal verb, so that one token is excused. Every other
// number, month and finding rule applies as written.
export function textGroundingViolations(output: string, grounding: string[]): PhrasingViolation[] {
  return verifyGrounded(output, [], grounding).filter(v => !(v.kind === "ungrounded_month" && v.token === "may"));
}

/** Pure. The first JSON array in a model reply, or null. Code fences and leading prose are tolerated. */
export function parseJsonArray(raw: string): unknown[] | null {
  const s = raw.replace(/```(?:json)?/gi, "").trim();
  const start = s.indexOf("["), end = s.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    return Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
