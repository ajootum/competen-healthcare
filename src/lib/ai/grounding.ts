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

/**
 * Named clinical terms whose digit is part of the NAME, not a quantity: SpO2 is oxygen saturation, not "2".
 * Read as numbers, "check the SpO2" or "give O2" were refused as an invented 2 whenever the source spelled them
 * out (IND-004, staging, 25 October 2026). The list is closed and exact on purpose. A general rule ("a digit
 * after a letter is not a number") would also stop seeing an invented frequency: q6h when the source says q4h.
 * The quantity next to a named term is still checked: "O2 2 L/min" still needs its 2 in the source.
 */
const NAMED_TERMS = /\b(?:spo2|sao2|sto2|pao2|po2|paco2|pco2|fio2|etco2|o2|co2)\b/g;

const numbersIn = (s: string): string[] =>
  (normalise(s).replace(NAMED_TERMS, " ").match(/\d+(?:\.\d+)?/g) ?? []).map(n => n.replace(/^0+(?=\d)/, ""));

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
//
// A second adjustment, of the same kind (SCHOLAR-AI-OPT-01, owner D3 follow-up, 28 Oct 2026): "one" in ordinary
// phrasing -- "one of the signs", "no one", "each one", "one way to remember" -- is not a count. Read as the number
// 1, it withheld 2 of the first 3 live clinical Learn answers in production (Opus Teach and Sonnet Explain on a
// section with no "one" and no "1" in it), each a safe non-answer that cost money and taught nothing. The phrases are
// a closed, exact list. "one" anywhere else -- "one dose", "after one hour", "one sign" -- is still the number 1 and
// still needs it in the notes, and every other number word is untouched. The Practice verifier above is unchanged.
const ORDINARY_ONE = /\b(?:one of|one another|no one|each one|every one|any one|the one|this one|that one|which one|one way|one thing|one or more|one by one|one at a time)\b/g;

const onlyOrdinaryOne = (output: string) => !/\bone\b/.test(normalise(output).replace(ORDINARY_ONE, " "));

// A third and fourth adjustment (SCHOLAR-GUIDED-LEARNING-01, owner, 31 Oct 2026). Production withheld a whole Just
// Culture lesson for "the number two": an ordinary STRUCTURING count ("two types of error") that the notes did not
// spell out. So, for study text only:
//   (a) A spelled-out small cardinal that only structures an explanation -- "two types", "three key steps", "four main
//       stages" -- is not read as a quantity. It must be followed (one optional qualifier between) by a noun on the
//       closed STRUCTURE_NOUN list, AND its sentence must carry nothing on SAFETY_CONTEXT: no digit, unit, dose, rate,
//       frequency, duration, threshold, percentage, lab value, age, score or medication word. Every occurrence of the
//       word must qualify, or it is checked exactly as before. Digits are never excused. Ordinals (first, second) were
//       never number words here and are unchanged.
//   (b) STRICTER, not looser: "twice" and "thrice" are frequencies, and were not checked at all. They now need the
//       notes to say so ("twice", or "two times").
//   (c) A finding word ("reduced", "improved", "significant") is supported when the notes hold the SAME ROOT in another
//       form ("reduction", "improvement", "significance") -- one strip of a closed suffix list, a root of at least five
//       letters, so "abnormal" never supports "normal". Only for the closed ROOT_MARKERS list, whose other forms mean the
//       same finding: "positive" (position), "raised" (raise a concern), "normal" and the rest stay literal, as do the
//       multi-word markers.
// Numbers, months and identifiers otherwise stay literal. The Practice verifier above is unchanged.
const SMALL_CARDINAL = "(?:one|two|three|four|five|six|seven|eight|nine|ten)";
const STRUCTURE_QUALIFIER = "(?:main|key|core|basic|broad|distinct|different|important|common|related|separate|major|essential|general|linked|connected|complementary)";
const STRUCTURE_NOUN = "(?:types?|kinds?|sorts?|steps?|stages?|phases?|parts?|ways?|categories|category|components?|elements?|principles?|aspects?|factors?|approach(?:es)?|groups?|areas?|questions?|ideas?|features?|models?|roles?|domains?|pillars?|sections?|examples?|reasons?|goals?|aims?|objectives?|strateg(?:y|ies)|methods?|dimensions?|themes?|concepts?|layers?|tiers?|perspectives?|views?|purposes?|barriers?|benefits?|challenges?|options?|choices?|skills?)";
const STRUCTURE_COUNT = new RegExp(`\\b${SMALL_CARDINAL}\\s+(?:${STRUCTURE_QUALIFIER}\\s+)?${STRUCTURE_NOUN}\\b`, "g");
/** Anything that makes a number in a sentence safety-critical. Present: the sentence's number words stay strict. */
export const SAFETY_CONTEXT = /\d|%|\b(?:mg|mcg|micrograms?|milligrams?|grams?|g|kg|ml|millilitres?|milliliters?|litres?|liters?|l\/min|mmol|iu|units?|dose[sd]?|dosage|dosing|tablets?|capsules?|pills?|drops?|puffs?|sachets?|injections?|infusions?|medications?|medicines?|drugs?|prescri\w*|administ\w*|titrat\w*|bolus|regimens?|daily|hourly|weekly|nightly|times|per|every|twice|thrice|hours?|hrs?|minutes?|mins?|seconds?|secs?|days?|weeks?|months?|years?|yrs?|rate|rates|bpm|breaths?|beats?|percent|percentage|threshold|thresholds|above|below|exceeds?|greater|less|fewer|more than|at least|at most|up to|range|levels?|results?|readings?|scores?|scale|grade|aged?|old|spo2|sao2|o2|oxygen|temperature|pressure|mmhg|saturation|glucose|potassium|sodium|ha?emoglobin|creatinine|lab|labs|blood|fluids?|volume|weight|stools?|feeds?|meals?|nappies|voids?)\b/i;

/** Pure. Whether every use of `word` in the output is a structuring count in a sentence with no safety context. */
function onlyStructuringCount(output: string, word: string): boolean {
  const re = new RegExp(`\\b${word}\\b`, "g");
  for (const sentence of normalise(output).split(/(?<=[.!?;:])\s+|\n+/)) {
    const uses = (sentence.match(re) ?? []).length;
    if (!uses) continue;
    if (SAFETY_CONTEXT.test(sentence)) return false;
    const structural = [...sentence.matchAll(STRUCTURE_COUNT)].filter(m => new RegExp(`^${word}\\b`).test(m[0])).length;
    if (structural < uses) return false;
  }
  return true;
}

const FREQUENCY_WORDS: Record<string, RegExp> = { twice: /\b(?:twice|two times|2 times)\b/, thrice: /\b(?:thrice|three times|3 times)\b/ };

const ROOT_MARKERS = new Set(["significant", "improved", "improving", "worsened", "worsening", "deteriorated", "responded", "responding",
  "tolerated", "recurrent", "recurrence", "relapse", "relapsed", "reduced", "elevated", "examination", "examined", "inconclusive", "tender", "tenderness"]);
const FINDING_SUFFIXES = ["ations", "ation", "itions", "ition", "tions", "tion", "ions", "ion", "ments", "ment", "ness", "ities", "ity", "ances", "ance", "ants", "ant", "ences", "ence", "ingly", "ings", "ing", "edly", "ed", "ly", "es", "al", "ous", "ive", "s", "e", "d"];
/** Pure. A word's root: up to two strips of the longest closed suffix that leave at least five letters. */
export function findingRoot(word: string): string {
  let w = word.toLowerCase();
  for (let i = 0; i < 2; i++) {
    const s = FINDING_SUFFIXES.find(x => w.endsWith(x) && w.length - x.length >= 5);
    if (!s) break;
    w = w.slice(0, -s.length);
  }
  return w;
}

export function textGroundingViolations(output: string, grounding: string[]): PhrasingViolation[] {
  const payload = normalise(grounding.join(" \n "));
  let roots: Set<string> | null = null;
  const sameRoot = (marker: string) => {
    roots ??= new Set(payload.split(/[^a-z]+/).filter(w => w.length >= 5).map(findingRoot));
    // One root may run one letter further than the other (elevat-ed, eleva-tion). "severe" and "extensive" are not
    // listed: "several" and "extension" share their roots.
    const m = findingRoot(marker);
    return [...roots].some(r => r === m || (Math.abs(r.length - m.length) === 1 && (r.startsWith(m) || m.startsWith(r))));
  };
  const out = verifyGrounded(output, [], grounding).filter(v =>
    !(v.kind === "ungrounded_month" && v.token === "may")
    && !(v.kind === "ungrounded_number" && v.token === "one" && onlyOrdinaryOne(output))
    && !(v.kind === "ungrounded_number" && /^[a-z]+$/.test(v.token) && onlyStructuringCount(output, v.token))
    && !(v.kind === "asserted_finding" && ROOT_MARKERS.has(v.token) && sameRoot(v.token)));
  const body = normalise(output);
  for (const [word, supported] of Object.entries(FREQUENCY_WORDS))
    if (new RegExp(`\\b${word}\\b`).test(body) && !supported.test(payload)) out.push({ kind: "ungrounded_number", token: word });
  return out;
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
