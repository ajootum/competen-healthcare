// ── SCHOLAR FLASHCARDS: CLINICALLY SENSITIVE CONTENT, FLAGGED ── SCHOLAR-FLASHCARDS-QA-01 (owner, 31 Oct 2026) ─────────
//
// Pure, deterministic, no AI and no I/O. A card's own words (front, back, explanation, key points) are read against
// fixed term lists; a card that matches is FLAGGED -- never rewritten, never withheld. The flag is a visible marker on
// the card in every download and in the study view, and a "Points to verify" list in the revision guide.
//
//   paediatric_rr     a child term AND a respiratory-rate term
//   oxygen_target     an oxygen-saturation term AND a number
//   emergency_resp    an emergency or escalation term AND a respiratory term
//   copd_deterioration a COPD term AND a deterioration term
//   numeric_value     any numeric clinical threshold, dose or target: a number with a clinical unit, a percentage, a
//                     range ("12-20", "18 to 26"), or a comparison ("above 92", ">= 88"). Ages and durations alone are not.
//
// How strongly: a card AI-wrote from notes, or one the learner wrote, is "not clinically reviewed". A Competen library
// card keeps its clinically approved standing ("clinically reviewed, published <date>") and is still flagged, less
// strongly: local guidelines may differ.
//
// TODO(SCHOLAR-FLASHCARDS-QA-01): no existing Individual policy key fits a governed term list, so the lists are this
// named constant. Moving them to policy (an options-kind key, e.g. scholar_flashcard_sensitive_terms) is an owner
// decision; until then a change here is a code change, reviewed as one.

export type SensitiveCode = "paediatric_rr" | "oxygen_target" | "emergency_resp" | "copd_deterioration" | "numeric_value";

type Rule = { code: SensitiveCode; label: string; all: readonly RegExp[] };

const CHILD = /\b(child|children|childhood|paediatric|pediatric|infants?|neonat\w*|newborns?|babies|baby|toddlers?|school[- ]age|adolescents?|under[- ]?(fives?|5s?))\b/i;
const RESP_RATE = /\b(respiratory rates?|breathing rates?|breaths?\s*(\/|per)\s*min(ute)?s?|breaths\/min|rr)\b/i;
const OXYGEN = /\b(spo2|sao2|sats|saturations?|oxygen targets?|target saturations?|fio2|controlled oxygen|oxygen therapy)\b/i;
/** A saturation figure: a percentage, or a two-digit range ("94-98"). Never the 2 of SpO2. */
const OXY_NUMBER = /(?<![A-Za-z\d.])\d+(\.\d+)?\s*(%|percent|per ?cent)|(?<![A-Za-z\d.])\d{2}\s*(-|–|to)\s*\d{2,3}\b/i;
const EMERGENCY = /\b(emergenc\w*|life[- ]threatening|silent chest|respiratory (arrest|failure|distress)|deteriorat\w*|escalat\w*|early warning score|news2?|call for help|rapid response|resuscitat\w*|cyanos\w*|stridor|peri[- ]arrest|abcde)\b/i;
const RESPIRATORY = /\b(respirat\w*|breath\w*|airways?|oxygen|spo2|saturations?|asthma\w*|wheez\w*|chest|copd|lungs?|ventilat\w*|hypox\w*|hypercap\w*|tachypn\w*)\b/i;
const COPD = /\b(copd|chronic obstructive( pulmonary disease)?|emphysema|chronic bronchitis)\b/i;
const DETERIORATION = /\b(exacerbat\w*|deteriorat\w*|drows\w*|confus\w*|hypercap\w*|co2 retention|retain\w* co2|retention|acidos\w*|niv|non[- ]invasive ventilation|reduced consciousness)\b/i;

/** The clinical units a number is a threshold, dose or target in. Ages ("68-year-old") and durations alone are not. */
const UNIT = String.raw`(%|percent|per ?cent|mg|mcg|micrograms?|µg|g\b|kg|ml|mls|millilit\w*|l\/min|litres?|liters?|units?|iu|mmhg|kpa|mmol\/?l?|mmol|bpm|beats?\s*(\/|per)\s*min\w*|breaths?\s*(\/|per)\s*min\w*|°c|degrees|cm\s*h2o|mg\/kg|ml\/kg|mcg\/kg)`;
const NUMERIC = [
  new RegExp(String.raw`\b\d+(\.\d+)?\s*${UNIT}`, "i"),
  /\b\d+(\.\d+)?\s*(-|–|to)\s*\d+(\.\d+)?\b(?!\s*-?\s*(year|yr|month|week|day|hour|hr|minute|min\b|second))/i,
  /(>=|<=|>|<|≥|≤|\b(above|below|over|under|at least|at most|more than|less than|greater than|fewer than|target of|exceeds?)\s+)\s*\d/i,
];

/** THE TERM LISTS (see the TODO above). Exported so the tests and the report can name exactly what is flagged. */
export const CLINICAL_SENSITIVITY_RULES: readonly Rule[] = [
  { code: "paediatric_rr", label: "Paediatric respiratory rates", all: [CHILD, RESP_RATE] },
  { code: "oxygen_target", label: "Oxygen saturation targets", all: [OXYGEN, OXY_NUMBER] },
  { code: "emergency_resp", label: "Emergency respiratory assessment", all: [EMERGENCY, RESPIRATORY] },
  { code: "copd_deterioration", label: "COPD deterioration", all: [COPD, DETERIORATION] },
];
export const NUMERIC_RULE = { code: "numeric_value" as const, label: "Numeric clinical value" };

export const SENSITIVE_MARKER = "Check against current local guidelines: clinically sensitive value, not clinically reviewed.";
export const SENSITIVE_MARKER_REVIEWED = (date: string | null) =>
  `Clinically reviewed${date ? ` (published ${date})` : ""}. Clinically sensitive value: local guidelines may differ, check them.`;

export type SensitiveFlag = {
  codes: SensitiveCode[];
  labels: string[];
  /** The card's own words that carry a value or a sensitive term, at most four, as written. */
  values: string[];
  /** A Competen library card: clinically approved content, flagged less strongly. */
  reviewed: boolean;
  marker: string;
};

const text = (c: SensitiveInput) => [c.front, c.back, c.explanation ?? "", ...(c.keyPoints ?? [])].join("\n");
export type SensitiveInput = { front: string; back: string; explanation?: string | null; keyPoints?: readonly string[]; origin: "notes" | "library" | "learner"; reviewedAt?: string | null };

/** Pure. The values a card states, in its own words: each numeric match, widened to the word around it. */
function valuesOf(s: string): string[] {
  const out: string[] = [];
  const re = new RegExp(String.raw`(>=|<=|≥|≤|>|<|\b(?:above|below|over|under|at least|at most|more than|less than|greater than|fewer than|target of|exceeds?)\s+)?\s*(?<![A-Za-z\d.])\d+(\.\d+)?\s*((-|–|to)\s*\d+(\.\d+)?)?\s*${UNIT}?`, "gi");
  for (const m of s.matchAll(re)) {
    const v = m[0].trim();
    if (!v || !/\d/.test(v)) continue;
    // Not an age or a duration on its own ("68-year-old", "two hours" is words), not a list marker.
    const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 12);
    if (/^\s*-?\s*(year|yr|month|week|day|hour|hr|minute|second)/i.test(after)) continue;
    if (!NUMERIC.some(r => r.test(v)) && !/\d\s*(-|–|to)\s*\d/.test(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, 4);
}

/**
 * Pure. Whether a card states something clinically sensitive, and what to mark it with -- or null. Flags only: the
 * card's words are unchanged. Library cards keep their clinically reviewed standing in the marker.
 */
export function sensitiveFlag(c: SensitiveInput, formatDate: (iso: string) => string = iso => iso.slice(0, 10)): SensitiveFlag | null {
  const s = text(c);
  const hits = CLINICAL_SENSITIVITY_RULES.filter(r => r.all.every(re => re.test(s)));
  const values = valuesOf(s);
  const numeric = values.length > 0;
  if (!hits.length && !numeric) return null;
  const codes = [...hits.map(h => h.code), ...(numeric ? [NUMERIC_RULE.code] : [])];
  const labels = [...hits.map(h => h.label), ...(numeric ? [NUMERIC_RULE.label] : [])];
  const reviewed = c.origin === "library";
  return { codes, labels, values, reviewed, marker: reviewed ? SENSITIVE_MARKER_REVIEWED(c.reviewedAt ? formatDate(c.reviewedAt) : null) : SENSITIVE_MARKER };
}

/** Pure. sensitiveFlag of a card as the surfaces hold it (flashcards.ts FlashcardView): its library source's date, if any. */
export const cardSensitiveFlag = (c: SensitiveInput & { sources?: readonly { reference?: { reviewedAt?: string | null } | null }[] }, formatDate?: (iso: string) => string) =>
  sensitiveFlag({ ...c, reviewedAt: c.reviewedAt ?? c.sources?.find(s => s.reference?.reviewedAt)?.reference?.reviewedAt ?? null }, formatDate);
