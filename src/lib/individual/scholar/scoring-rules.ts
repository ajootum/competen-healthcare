// ── SQIE-CLOSE-2026-11 WS-A / WS-B / WS-C: THE SCORING RULES AND FORMAT CONTRACTS ── one shared, versioned module ────────────
//
// What this file is: the CONTRACT of the answer-key fields the three scoring workstreams added, and the pure rules that mark them.
// The learner side (revision.ts, the answer and scenario routes, the clinical routes) marks with these functions; the HQ library
// form (WS-E, a client component) may import this file to author the same fields, so there is ONE description of each field and
// ONE rule that reads it. Pure and dependency-free: no I/O, no clock, no model, no other module of the app (a client bundle may
// import it). Nothing here needs a migration: every field lives inside the existing `answer` jsonb (416/710 CHECKs allow extra
// keys) and the attempt's `response` jsonb (416: an object of at most 8000 bytes).
//
// ⚠ FORMATIVE. A score computed here is practice marks. It never sets a competence stage, never verifies competence, and an AI
// formative score is never independent verification.
//
// ── VERSIONING (directive §5 "versioned scoring rules"; previously completed attempts stay interpretable) ──
//   SCORING_RULES_VERSION is written on every attempt marked under these rules (response.rules, and the rubric snapshot's
//   `rules`). An attempt without it was marked under LEGACY_RULES_VERSION: no unsafe outcome, no safety cap, no calculation
//   key. rulesOf() reads it, and the feedback for a legacy attempt is built exactly as before (no safety block is invented
//   for it). A change to any cap or rule below is a NEW version string, never an edit of what an old one meant.
//
// ── THE CONTRACTS (field by field; all optional; absent = the behaviour before this file) ──
//
// WS-B  SAFETY MARKERS (explicit handling of clinically unsafe responses)
//   short (plain), cloze-free     answer.safetyCritical: boolean            the item tests a point that must not be missed
//                                 answer.unsafe: string[] (0..6, <=200)     answers that would be unsafe to act on (code-matched)
//   structured part               parts[i].safetyCritical: boolean, parts[i].unsafe: string[]
//   extended                      answer.safetyCriticalPoints: number[]     indexes into rubric.keyPoints that must be made
//                                 answer.unsafe: string[]
//   scenario stage                stages[i].safetyCritical: boolean, stages[i].unsafe: string[]
//   case free-text criterion      blueprint RubricCriterion { weight, safetyCritical } (already stored; now SCORED)
//   Outcomes (SafetyOutcome):
//     unsafe           the answer states something an authored `unsafe` answer names (code), or the evaluator's required UNSAFE line
//                      (evaluate v3 / case reasoning v3, branch WS-B) flags it (AI, formative). Score capped at UNSAFE_SCORE_CAP, never correct,
//                      never "partly": the feedback names the unsafe statement.
//     critical_missed  a safety-critical part / key point / stage / criterion was not earned in full. Never correct, score
//                      capped at CRITICAL_MISS_SCORE_CAP, and the feedback names what was missed.
//     safe             neither.
//   Recorded on the attempt as response.safety = { outcome, statement?, missed?: string[], by: "code" | "ai" } (bounded).
//
// WS-C  JUSTIFICATION AND INTERPRETATION (rubric-based partial credit, five-part feedback, the existing evaluator)
//   structured answer.variant: "answer_justify" | "interpretation"           what the item is (display and feedback wording)
//   structured answer.findings: [{ label, value, unit? }] (1..12)             interpretation: the findings table shown first
//   structured part  parts[i].role: "answer" | "justify" | "interpret"       what the part asks for
//                    parts[i].options: string[] (2..6), parts[i].correct: n  a CHOICE part (answer + justify): marked by code;
//                                                                            accepted[0] must be options[correct] (710 still sees
//                                                                            a part with accepted answers)
//                    parts[i].criteria: [{ text, weight 1..5, safetyCritical }] (1..8)
//                                                                            a justify/interpret part marked against weighted
//                                                                            criteria: the evaluator lists the criteria met
//                                                                            (MATCHED), code computes the marks.
//   case decision    askReason + rubric criteria                             the learner's reason scored against the criteria
//                                                                            (library cases; formative, labelled).
//
// WS-A  CALCULATION (a `short` item, answer.format = 'calculation'; owner decision 4 Nov 2026)
//   answer { format: 'calculation', accepted: ["<value> <unit>"],         the 416 CHECK's accepted answers (the answer in words)
//            value: number,                                               the exact answer, already rounded as `rounding` says
//            unit: string,                                                a recognised unit, or "" for a unitless answer
//            equivalentUnits?: string[] (0..6),                           other units accepted, each recognised and of the SAME kind
//            rounding?: { mode: 'decimal_places' | 'significant_figures', places: 0..6 },
//            tolerance?: { kind: 'absolute', amount > 0 } | { kind: 'percent', amount in (0, 10] },   INACTIVE until policy turns it on
//            safetyCritical?: boolean (default true: a tenfold error is unsafe), working?: string, rubric }
//   calculationProblems(answer) lists what is wrong with a key, field by field (for the authoring form).
//   Marked by CODE only (markCalculation). Exact by default; the sign and the decimal point are kept. Wrong or missing units are wrong,
//   with feedback. A tenfold (or greater) error is UNSAFE whatever any tolerance would accept.
//   ⚠ OWNER / CLINICAL DECISION: approval of the clinical calculation policy, which alone may turn scholar_calculation_tolerances on.

// ═══════════════════════════════════════════ VERSIONS ═══════════════════════════════════════════

export const SCORING_RULES_VERSION = "sqie-scoring-v2" as const;
export const LEGACY_RULES_VERSION = "sqie-scoring-v1" as const;
export type ScoringRulesVersion = typeof SCORING_RULES_VERSION | typeof LEGACY_RULES_VERSION;

/** Pure. The rules an attempt was marked under: the version it recorded, else the legacy rules (attempts kept before v2). */
export function rulesOf(response: unknown): ScoringRulesVersion {
  const r = response && typeof response === "object" ? (response as Record<string, unknown>).rules : null;
  return r === SCORING_RULES_VERSION ? SCORING_RULES_VERSION : LEGACY_RULES_VERSION;
}

// ═══════════════════════════════════════════ WS-B: SAFETY ═══════════════════════════════════════════

export type SafetyOutcome = "safe" | "critical_missed" | "unsafe";
/** v2: an unsafe answer earns nothing. ⚠ Owner/clinical decision recorded in the PR; a change is a new rules version. */
export const UNSAFE_SCORE_CAP = 0;
/** v2: missing a safety-critical element is never correct and earns at most half. ⚠ Owner/clinical decision; a change is a new rules version. */
export const CRITICAL_MISS_SCORE_CAP = 0.5;

export const SAFETY_LABEL: Record<Exclude<SafetyOutcome, "safe">, string> = {
  unsafe: "Clinically unsafe answer",
  critical_missed: "Safety-critical point missed",
};
export const SAFETY_EXPLAINER: Record<Exclude<SafetyOutcome, "safe">, string> = {
  unsafe: "Part of this answer would be unsafe to act on, so it earns no practice marks, however much else is right.",
  critical_missed: "This answer misses a point that must not be missed, so it is not counted as correct and its practice marks are capped.",
};

const UNSAFE_MAX = 6, UNSAFE_LEN = 200;
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const strList = (v: unknown, n: number, max: number): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string").map(x => x.trim()).filter(x => x && x.length <= max))].slice(0, n) : [];

export type SafetyMarkers = { safetyCritical: boolean; unsafe: string[] };
/** Pure. The safety markers of one key, part or stage (absent fields: not critical, no unsafe answers). */
export function safetyMarkersOf(raw: unknown): SafetyMarkers {
  const x = (raw ?? {}) as Record<string, unknown>;
  return { safetyCritical: x.safetyCritical === true, unsafe: strList(x.unsafe, UNSAFE_MAX, UNSAFE_LEN) };
}

/**
 * Pure. The authored unsafe answer an answer gives, by code: a normalised match with one of them, or null. Equality only (never
 * "contains"): "do not give X" contains "give X", and code must never call a safe answer unsafe. Longer answers are left to the
 * evaluator's UNSAFE line.
 */
export function matchUnsafe(answer: string, unsafe: readonly string[]): string | null {
  const a = normalise(answer);
  if (!a) return null;
  return unsafe.find(u => normalise(u) === a) ?? null;
}

/** Pure. The evaluator's unsafe statements (WS-B evaluate v3: the learner's own words, or a flag) as the one statement a record keeps, or null. */
export const unsafeStatement = (unsafe: readonly string[] | null | undefined): string | null => (unsafe?.length ? unsafe.join("; ").slice(0, 300) : null);

export type SafetyRecord = { outcome: Exclude<SafetyOutcome, "safe">; statement?: string; missed?: string[]; by: "code" | "ai" };

/** Pure. A score and correctness with the v2 safety cap applied. A safe outcome leaves them as they were. */
export function capForSafety<T extends { correct: boolean; score: number }>(m: T, outcome: SafetyOutcome): T {
  if (outcome === "unsafe") return { ...m, correct: false, score: Math.min(m.score, UNSAFE_SCORE_CAP) };
  if (outcome === "critical_missed") return { ...m, correct: false, score: Math.min(m.score, CRITICAL_MISS_SCORE_CAP) };
  return m;
}

/** Pure. The worse of two outcomes (unsafe > critical_missed > safe). */
export const worstOutcome = (a: SafetyOutcome, b: SafetyOutcome): SafetyOutcome =>
  a === "unsafe" || b === "unsafe" ? "unsafe" : a === "critical_missed" || b === "critical_missed" ? "critical_missed" : "safe";

/** Pure. The bounded record kept on the attempt's response (response.safety), or null for a safe answer. */
export function safetyRecord(outcome: SafetyOutcome, detail: { statement?: string | null; missed?: readonly string[]; by: "code" | "ai" }): SafetyRecord | null {
  if (outcome === "safe") return null;
  return {
    outcome, by: detail.by,
    ...(detail.statement ? { statement: detail.statement.slice(0, 300) } : {}),
    ...(detail.missed?.length ? { missed: detail.missed.slice(0, 4).map(s => s.slice(0, 200)) } : {}),
  };
}

/** Pure. The safety record kept on an attempt, read back and bounded, or null (a safe or a legacy attempt). */
export function storedSafety(response: unknown): SafetyRecord | null {
  if (!response || typeof response !== "object") return null;
  const s = (response as Record<string, unknown>).safety as Record<string, unknown> | undefined;
  if (!s || typeof s !== "object" || (s.outcome !== "unsafe" && s.outcome !== "critical_missed") || (s.by !== "code" && s.by !== "ai")) return null;
  return {
    outcome: s.outcome, by: s.by,
    ...(typeof s.statement === "string" && s.statement.trim() ? { statement: s.statement.slice(0, 300) } : {}),
    ...(strList(s.missed, 4, 200).length ? { missed: strList(s.missed, 4, 200) } : {}),
  };
}

// ═══════════════════════════════════════════ WEIGHTED CRITERIA (WS-B cases, WS-C justify/interpret) ═══════════════════════════════════════════

export type Criterion = { text: string; weight: number; safetyCritical: boolean };
export const CRITERIA_MAX = 8, CRITERION_WEIGHT_MAX = 5;

/** Pure. Weighted criteria read from authored data (a structured part's `criteria`, a case rubric), or null where none is sound. */
export function criteriaOf(v: unknown): Criterion[] | null {
  if (!Array.isArray(v) || !v.length || v.length > CRITERIA_MAX) return null;
  const out: Criterion[] = [];
  for (const raw of v) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const text = typeof x.text === "string" ? x.text.trim() : typeof x.criterion === "string" ? x.criterion.trim() : "";
    const w = x.weight === undefined ? 1 : x.weight;
    if (!text || text.length > 300 || !Number.isInteger(w) || (w as number) < 1 || (w as number) > CRITERION_WEIGHT_MAX) return null;
    out.push({ text, weight: w as number, safetyCritical: x.safetyCritical === true });
  }
  return out;
}

export type CriteriaMarks = { matched: number[]; awarded: number; total: number; score: number; correct: boolean; outcome: SafetyOutcome; missedCritical: string[] };

/**
 * Pure. Rubric-based partial credit: the share of the criteria's WEIGHT the answer meets (indexes, repeats and strays ignored),
 * then the v2 safety rules -- an unsafe statement caps it at UNSAFE_SCORE_CAP, a safety-critical criterion not met caps it at
 * CRITICAL_MISS_SCORE_CAP. Correct only when every criterion is met and nothing unsafe was said.
 */
export function criteriaMarks(criteria: readonly Criterion[], matched: readonly number[], unsafe = false): CriteriaMarks {
  const n = criteria.length;
  const hit = [...new Set(matched.filter(i => Number.isInteger(i) && i >= 0 && i < n))].sort((a, b) => a - b);
  const total = criteria.reduce((s, c) => s + c.weight, 0);
  const awarded = hit.reduce((s, i) => s + criteria[i].weight, 0);
  const missedCritical = criteria.filter((c, i) => c.safetyCritical && !hit.includes(i)).map(c => c.text);
  const outcome: SafetyOutcome = unsafe ? "unsafe" : missedCritical.length ? "critical_missed" : "safe";
  const capped = capForSafety({ correct: n > 0 && hit.length === n, score: total ? awarded / total : 0 }, outcome);
  return { matched: hit, awarded: Math.round(total * capped.score * 100) / 100, total, score: capped.score, correct: capped.correct, outcome, missedCritical };
}

/** Pure. A part's whole marks from a criteria share: rounded down, never above the part's marks. */
export const marksFromShare = (marks: number, score: number): number => Math.max(0, Math.min(marks, Math.floor(marks * Math.max(0, Math.min(1, score)) + 1e-9)));

/** The evaluator's extra instruction for numbered criteria (the same MATCHED line the extended evaluator writes). */
export const EVALUATE_CRITERIA_RULE = [
  "The CRITERIA are numbered. After the VERDICT line add exactly one line 'MATCHED: ' followed by the numbers of the criteria the answer meets (for example 'MATCHED: 1, 3'), or 'MATCHED: none'.",
  "A criterion counts only if the answer meets it, in any wording that means the same. This is a list of numbers, not a mark: still never give a mark, a score or a percentage.",
].join("\n");

// ═══════════════════════════════════════════ WS-C: STRUCTURED VARIANTS ═══════════════════════════════════════════

export const STRUCTURED_VARIANTS = ["answer_justify", "interpretation"] as const;
export type StructuredVariant = (typeof STRUCTURED_VARIANTS)[number];
export const PART_ROLES = ["answer", "justify", "interpret"] as const;
export type PartRole = (typeof PART_ROLES)[number];
export const VARIANT_LABEL: Record<StructuredVariant, string> = { answer_justify: "Answer and justify", interpretation: "Interpret the findings" };
export const ROLE_LABEL: Record<PartRole, string> = { answer: "Your answer", justify: "Your justification", interpret: "Your interpretation" };

export type Finding = { label: string; value: string; unit: string | null };
export const FINDINGS_MAX = 12;

/** Pure. A structured item's variant, or null (a plain structured question). */
export const structuredVariantOf = (answer: unknown): StructuredVariant | null => {
  const v = answer && typeof answer === "object" ? (answer as Record<string, unknown>).variant : null;
  return (STRUCTURED_VARIANTS as readonly unknown[]).includes(v) ? (v as StructuredVariant) : null;
};

/** Pure. The findings table of an interpretation item (1..12 rows, bounded), or [] where it has none or it is not sound. */
export function findingsOf(answer: unknown): Finding[] {
  const f = answer && typeof answer === "object" ? (answer as Record<string, unknown>).findings : null;
  if (!Array.isArray(f) || !f.length || f.length > FINDINGS_MAX) return [];
  const out: Finding[] = [];
  for (const raw of f) {
    const x = (raw ?? {}) as Record<string, unknown>;
    const label = typeof x.label === "string" ? x.label.trim() : "", value = typeof x.value === "string" ? x.value.trim() : typeof x.value === "number" && Number.isFinite(x.value) ? String(x.value) : "";
    if (!label || !value || label.length > 120 || value.length > 120) return [];
    out.push({ label, value, unit: typeof x.unit === "string" && x.unit.trim() ? x.unit.trim().slice(0, 30) : null });
  }
  return out;
}

export type PartContract = { role: PartRole; options: string[] | null; correct: number | null; criteria: Criterion[] | null } & SafetyMarkers;

/**
 * Pure. The WS-B/WS-C fields of one stored structured part. A choice part is sound only with 2 to 6 options, a correct index, and
 * that option as its first accepted answer (so code marks it like any part); otherwise it is read as a written part.
 */
export function partContractOf(raw: unknown, accepted: readonly string[]): PartContract {
  const x = (raw ?? {}) as Record<string, unknown>;
  const role: PartRole = (PART_ROLES as readonly unknown[]).includes(x.role) ? (x.role as PartRole) : "answer";
  const opts = strList(x.options, 6, 200);
  const c = x.correct;
  const choice = Array.isArray(x.options) && opts.length === (x.options as unknown[]).length && opts.length >= 2 && Number.isInteger(c) && (c as number) >= 0 && (c as number) < opts.length
    && normalise(accepted[0] ?? "") === normalise(opts[c as number]);
  return { role, options: choice ? opts : null, correct: choice ? (c as number) : null, criteria: criteriaOf(x.criteria), ...safetyMarkersOf(x) };
}

// ═══════════════════════════════════════════ WS-A: CALCULATION ═══════════════════════════════════════════
//
// OWNER DECISION 4 Nov 2026 (SQIE-CLOSE-2026-11-owner-decisions-4nov.md item 1), built exactly:
//   - exact numerical matching by default (the sign and the decimal point are kept: "+250" is not "-250");
//   - validated unit equivalence: an answer may be in the key's unit or in one of the item's own `equivalentUnits`, each of which must
//     be a recognised unit of the SAME dimension (an item whose list fails that is not sound and is not offered);
//   - question-defined rounding (`rounding`): the answer must be given rounded as the question says;
//   - configurable absolute and percentage tolerances, built in full, but INACTIVE until the clinical calculation policy is approved:
//     HQ policy scholar_calculation_tolerances defaults to "off", and while it is off an authored tolerance is ignored (exact match);
//   - safety-critical errors handled INDEPENDENTLY of tolerance: a tenfold (or greater) error in the amount is unsafe whatever any
//     tolerance would accept (rules v2 unsafe outcome: no marks, never correct, said plainly).

export const CALCULATION_FORMAT = "calculation" as const;
export type Tolerance = { kind: "none" } | { kind: "absolute"; amount: number } | { kind: "percent"; amount: number };
export const TOLERANCE_PERCENT_MAX = 10;
/** A tenfold error (either way) in the amount is unsafe, independently of tolerance (owner decision). */
export const MAGNITUDE_ERROR_FACTOR = 10;
/** What marking needs from policy. The strict code default: tolerances inactive. */
export type CalculationPolicy = { tolerancesActive: boolean };
export const CALCULATION_DEFAULTS: CalculationPolicy = { tolerancesActive: false };

/** Pure. A tolerance read from authored data, or null where it is not sound. */
export function toleranceOf(v: unknown): Tolerance | null {
  const x = (v ?? null) as Record<string, unknown> | null;
  if (!x || typeof x !== "object") return null;
  if (x.kind === "none") return { kind: "none" };
  const a = x.amount;
  if (typeof a !== "number" || !Number.isFinite(a) || a <= 0) return null;
  if (x.kind === "absolute") return { kind: "absolute", amount: a };
  if (x.kind === "percent" && a <= TOLERANCE_PERCENT_MAX) return { kind: "percent", amount: a };
  return null;
}

export const toleranceText = (t: Tolerance, unit: string): string =>
  t.kind === "none" ? "exact answer" : t.kind === "absolute" ? `within ±${fmt(t.amount)}${unit ? ` ${unit}` : ""}` : `within ±${fmt(t.amount)}%`;

// ── ROUNDING (question-defined) ──

export type Rounding = { mode: "decimal_places" | "significant_figures"; places: number };
export const ROUNDING_PLACES_MAX = 6;
/** Pure. A rounding rule read from authored data, or null where it is not sound. */
export function roundingOf(v: unknown): Rounding | null {
  const x = (v ?? null) as Record<string, unknown> | null;
  if (!x || typeof x !== "object" || (x.mode !== "decimal_places" && x.mode !== "significant_figures")) return null;
  const n = x.places;
  if (!Number.isInteger(n) || (n as number) < (x.mode === "significant_figures" ? 1 : 0) || (n as number) > ROUNDING_PLACES_MAX) return null;
  return { mode: x.mode, places: n as number };
}
/** Pure. A value rounded by a rule (half away from zero, as taught for clinical calculations). */
export function applyRounding(v: number, r: Rounding): number {
  if (v === 0) return 0;
  const dp = r.mode === "decimal_places" ? r.places : r.places - 1 - Math.floor(Math.log10(Math.abs(v)));
  const f = 10 ** dp;
  return Math.sign(v) * Math.round(Math.abs(v) * f + 1e-9) / f;
}
export const roundingText = (r: Rounding): string =>
  r.mode === "decimal_places" ? (r.places === 0 ? "to a whole number" : `to ${r.places} decimal place${r.places === 1 ? "" : "s"}`) : `to ${r.places} significant figure${r.places === 1 ? "" : "s"}`;

// ── NUMBERS ──

export type ParsedNumber = { ok: true; value: number; warnings: string[] } | { ok: false; reason: "empty" | "not_a_number" | "ambiguous_comma" };
export const NUMBER_WARNING = {
  leading_zero: "Write a leading zero before a decimal point (0.5, not .5): a missed decimal point is a known cause of tenfold dosing errors.",
  trailing_zero: "Avoid a trailing zero after a decimal point (5, not 5.0): it can be misread as ten times the dose.",
} as const;

/**
 * Pure. A number as a learner typed it: digits with an optional sign and ONE decimal point, thousands separated by commas only
 * in groups of three ("1,000"). "2,5" is refused as ambiguous (decimal comma or a typo), never guessed. No fractions, no units
 * (the unit is chosen separately). Safety writing habits are warned about, never marked down.
 */
export function parseNumber(raw: unknown): ParsedNumber {
  const s = typeof raw === "number" ? (Number.isFinite(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim().replace(/\s+/g, "") : "";
  if (!s) return { ok: false, reason: "empty" };
  if (/^[+-]?\d+,\d{1,2}$/.test(s) || /^[+-]?\d+,\d{4,}$/.test(s)) return { ok: false, reason: "ambiguous_comma" };
  const plain = /^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, "") : s;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(plain)) return { ok: false, reason: "not_a_number" };
  const value = Number(plain);
  if (!Number.isFinite(value)) return { ok: false, reason: "not_a_number" };
  const warnings: string[] = [];
  if (/^[+-]?\./.test(plain)) warnings.push(NUMBER_WARNING.leading_zero);
  if (/\.\d*0$/.test(plain) || /\.$/.test(plain)) warnings.push(NUMBER_WARNING.trailing_zero);
  return { ok: true, value, warnings };
}

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : String(Number(n.toPrecision(10))));

// ── UNITS: common clinical units, normalised and converted ──
//
// A unit is read as numerator / denominator tokens ("mg/kg/h" = mg per kg per hour). Each token has a DIMENSION and a factor to
// its base. Two units are compatible only when their numerator and denominator dimensions are the same multisets: mg/kg and g/kg
// are, mg and mg/kg are not (dimensions are NOT cancelled -- a dose per kilogram is not a mass). Units outside this list are
// compared by their normalised spelling only and never converted.

type Dim = "mass" | "volume" | "amount" | "time" | "length" | "iu" | "drop" | "energy" | "pressure" | "percent" | "tablet" | "capsule" | "dose";
type UnitDef = { dim: Dim; factor: number; label: string };
const U: Record<string, UnitDef> = {
  kg: { dim: "mass", factor: 1e3, label: "kg" }, g: { dim: "mass", factor: 1, label: "g" }, mg: { dim: "mass", factor: 1e-3, label: "mg" },
  mcg: { dim: "mass", factor: 1e-6, label: "micrograms" }, ng: { dim: "mass", factor: 1e-9, label: "nanograms" },
  l: { dim: "volume", factor: 1, label: "L" }, dl: { dim: "volume", factor: 0.1, label: "dL" }, ml: { dim: "volume", factor: 1e-3, label: "mL" }, microl: { dim: "volume", factor: 1e-6, label: "microlitres" },
  mol: { dim: "amount", factor: 1, label: "mol" }, mmol: { dim: "amount", factor: 1e-3, label: "mmol" }, micromol: { dim: "amount", factor: 1e-6, label: "micromol" },
  h: { dim: "time", factor: 3600, label: "hour" }, min: { dim: "time", factor: 60, label: "minute" }, s: { dim: "time", factor: 1, label: "second" }, day: { dim: "time", factor: 86400, label: "day" }, week: { dim: "time", factor: 604800, label: "week" },
  m: { dim: "length", factor: 1, label: "m" }, cm: { dim: "length", factor: 0.01, label: "cm" }, mm: { dim: "length", factor: 1e-3, label: "mm" },
  units: { dim: "iu", factor: 1, label: "units" }, drops: { dim: "drop", factor: 1, label: "drops" },
  kcal: { dim: "energy", factor: 4.184, label: "kcal" }, kj: { dim: "energy", factor: 1, label: "kJ" },
  mmhg: { dim: "pressure", factor: 1, label: "mmHg" }, kpa: { dim: "pressure", factor: 7.50062, label: "kPa" },
  percent: { dim: "percent", factor: 1, label: "%" },
  // Each countable form is its own dimension: two capsules are never two tablets.
  tablets: { dim: "tablet", factor: 1, label: "tablets" }, capsules: { dim: "capsule", factor: 1, label: "capsules" }, doses: { dim: "dose", factor: 1, label: "doses" },
};
const ALIAS: Record<string, string> = {
  kilogram: "kg", kilograms: "kg", kgs: "kg", gram: "g", grams: "g", gm: "g", gms: "g", milligram: "mg", milligrams: "mg", mgs: "mg",
  microgram: "mcg", micrograms: "mcg", "µg": "mcg", "μg": "mcg", ug: "mcg", nanogram: "ng", nanograms: "ng",
  litre: "l", litres: "l", liter: "l", liters: "l", decilitre: "dl", decilitres: "dl", millilitre: "ml", millilitres: "ml", milliliter: "ml", milliliters: "ml", cc: "ml",
  "µl": "microl", "μl": "microl", ul: "microl", microlitre: "microl", microlitres: "microl",
  mole: "mol", moles: "mol", millimole: "mmol", millimoles: "mmol", "µmol": "micromol", "μmol": "micromol", umol: "micromol", micromole: "micromol", micromoles: "micromol",
  hr: "h", hrs: "h", hour: "h", hours: "h", minute: "min", minutes: "min", mins: "min", sec: "s", secs: "s", second: "s", seconds: "s", d: "day", days: "day", wk: "week", weeks: "week",
  metre: "m", metres: "m", meter: "m", meters: "m", centimetre: "cm", centimetres: "cm", millimetre: "mm", millimetres: "mm",
  unit: "units", iu: "units", "international units": "units", u: "units",
  drop: "drops", gtt: "drops", gtts: "drops", kcals: "kcal", kilocalorie: "kcal", kilocalories: "kcal", kilojoule: "kj", kilojoules: "kj",
  "%": "percent", pct: "percent",
  tablet: "tablets", tab: "tablets", tabs: "tablets", capsule: "capsules", cap: "capsules", caps: "capsules", dose: "doses",
};

const token = (t: string): string => { const k = t.trim().toLowerCase(); return ALIAS[k] ?? k; };

export type UnitInfo = { canonical: string; known: boolean; signature: string; factor: number };

/**
 * Pure. A unit as typed ("mg/kg/hr", "micrograms per minute", "mL per hour", "%"), normalised: its canonical spelling, whether
 * every token is a known clinical unit, its dimension signature (what it may be compared with) and its factor to the base. "" is
 * the unitless unit. null for text that is not a unit at all (digits, or more than four tokens).
 */
export function unitInfo(raw: unknown): UnitInfo | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/\s+per\s+/gi, "/").replace(/\s*\/\s*/g, "/");
  if (!s) return { canonical: "", known: true, signature: "", factor: 1 };
  if (/\d/.test(s) || s.length > 40) return null;
  const parts = s.split("/").map(p => p.trim()).filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const toks = parts.map(token);
  const known = toks.every(t => t in U);
  if (!known) { const canonical = toks.join("/"); return { canonical, known: false, signature: `?${canonical}`, factor: 1 }; }
  const [num, ...den] = toks;
  const sig = `${U[num].dim}|${den.map(t => U[t].dim).sort().join(",")}`;
  const factor = den.reduce((f, t) => f / U[t].factor, U[num].factor);
  return { canonical: toks.join("/"), known: true, signature: sig, factor };
}

/** Pure. How a unit is shown (the canonical tokens with their display labels: "mg/kg/hour"). */
export function unitLabel(raw: string): string {
  const u = unitInfo(raw);
  if (!u) return raw.trim();
  if (!u.known) return raw.trim();
  return u.canonical.split("/").map(t => U[t]?.label ?? t).join("/");
}

/** Pure. A value converted between two compatible units, or null where they are not compatible (or either is unknown). */
export function convertUnit(value: number, from: string, to: string): number | null {
  const a = unitInfo(from), b = unitInfo(to);
  if (!a || !b) return null;
  if (a.canonical === b.canonical) return value;
  if (!a.known || !b.known || a.signature !== b.signature) return null;
  return (value * a.factor) / b.factor;
}

/**
 * Pure. The units a calculation's unit select offers: the key's own unit and the other known units of the SAME dimension (so a
 * wrong choice is a realistic one, a thousandfold mg/micrograms slip), alphabetical, so the order gives nothing away.
 */
export function unitChoices(unit: string): string[] {
  const u = unitInfo(unit);
  if (!u || u.canonical === "") return [];
  if (!u.known) return [unitLabel(unit)];
  const toks = u.canonical.split("/");
  const [num, ...den] = toks;
  const sameDim = (t: string) => Object.keys(U).filter(k => U[k].dim === U[t].dim);
  // The numerator varies (the usual slip); the denominator stays the key's own.
  const out = sameDim(num).map(n => [n, ...den].join("/"));
  return [...new Set(out.map(unitLabel))].sort((a, b) => a.localeCompare(b));
}

// ── THE KEY AND THE MARK ──

export type CalculationSpec = {
  value: number; unit: string; equivalentUnits: string[]; rounding: Rounding | null; tolerance: Tolerance | null;
  /** Default true: a calculation's amount is treated as safety-critical (a tenfold error is unsafe). An item may set false. */
  safetyCritical: boolean; working: string | null; display: string;
};

/** Pure. Whether a stored `short` item is a calculation. */
export const isCalculationAnswer = (answer: unknown): boolean =>
  !!answer && typeof answer === "object" && (answer as Record<string, unknown>).format === CALCULATION_FORMAT;

/**
 * Pure. What is wrong with a calculation key, field by field (empty: sound). The HQ library form (WS-E) can show these to an author;
 * the learner side refuses to offer an item with any (calculationSpecOf returns null).
 */
export function calculationProblems(answer: unknown): string[] {
  const a = (answer ?? {}) as Record<string, unknown>;
  const p: string[] = [];
  if (a.format !== CALCULATION_FORMAT) p.push("format: must be 'calculation'");
  if (typeof a.value !== "number" || !Number.isFinite(a.value)) p.push("value: a finite number");
  const unit = typeof a.unit === "string" ? a.unit.trim() : null;
  const u = unit === null ? null : unitInfo(unit);
  if (unit === null || !u) p.push("unit: a unit (\"\" for none)");
  if (a.equivalentUnits !== undefined) {
    if (!Array.isArray(a.equivalentUnits) || a.equivalentUnits.length > 6) p.push("equivalentUnits: up to six units");
    else for (const e of a.equivalentUnits) {
      const ei = typeof e === "string" ? unitInfo(e) : null;
      if (!ei || !ei.known || !u || !u.known || ei.signature !== u.signature || ei.canonical === u.canonical) p.push(`equivalentUnits: "${String(e)}" is not a recognised unit of the same kind as "${unit ?? ""}"`);
    }
  }
  if (a.rounding !== undefined && !roundingOf(a.rounding)) p.push("rounding: { mode: decimal_places | significant_figures, places }");
  const r = roundingOf(a.rounding);
  if (r && typeof a.value === "number" && applyRounding(a.value, r) !== a.value) p.push(`value: not rounded ${roundingText(r)}`);
  if (a.tolerance !== undefined && !toleranceOf(a.tolerance)) p.push(`tolerance: { kind: absolute, amount > 0 } or { kind: percent, amount in (0, ${TOLERANCE_PERCENT_MAX}] }`);
  if (a.safetyCritical !== undefined && typeof a.safetyCritical !== "boolean") p.push("safetyCritical: true or false");
  if (!Array.isArray(a.accepted) || !a.accepted.length || !a.accepted.every(x => typeof x === "string")) p.push("accepted: [the answer in words] (the 416 check)");
  return p;
}

/** Pure. A calculation's key from a stored `answer`, or null where it is not sound (the item is then not offered). */
export function calculationSpecOf(answer: unknown): CalculationSpec | null {
  if (!isCalculationAnswer(answer) || calculationProblems(answer).length) return null;
  const a = answer as Record<string, unknown>;
  const v = a.value as number, unit = (a.unit as string).trim();
  const working = typeof a.working === "string" && a.working.trim() ? a.working.trim().slice(0, 1200) : null;
  return {
    value: v, unit, equivalentUnits: ((a.equivalentUnits as string[] | undefined) ?? []).map(x => x.trim()), rounding: roundingOf(a.rounding),
    tolerance: a.tolerance === undefined ? null : toleranceOf(a.tolerance), safetyCritical: a.safetyCritical !== false, working,
    display: `${fmt(v)}${unit ? ` ${unitLabel(unit)}` : ""}`,
  };
}

/** Pure. The answer stored as the item's accepted answer (the 416 CHECK: answer.accepted of 1 to 8 strings). */
export const calculationAccepted = (value: number, unit: string): string[] => [`${fmt(value)}${unit.trim() ? ` ${unitLabel(unit)}` : ""}`];

export type CalculationResponse = { value: string; unit: string };
export type CalculationReason = "correct" | "wrong_value" | "not_rounded" | "wrong_unit" | "incompatible_unit" | "unit_missing" | "unparsed";
export type CalculationMark = {
  correct: boolean; score: 0 | 1; reason: CalculationReason; rules: typeof SCORING_RULES_VERSION;
  given: { value: number | null; unit: string }; expected: { value: number; unit: string };
  /** The learner's value in the key's unit, where the units are of the same kind. */
  inKeyUnit: number | null;
  /** The tolerance that was applied (null: exact match), and whether an authored tolerance was set aside because tolerances are not active. */
  tolerance: Tolerance | null; toleranceInactive: boolean; rounding: Rounding | null;
  /** WS-B, independent of tolerance: a tenfold (or greater) error in the amount. */
  safety: SafetyRecord | null;
  warnings: string[]; feedback: string;
};

/** Pure. A value within tolerance of the key (a hair of floating point allowed on an exact match). The sign always counts. */
export function withinTolerance(given: number, expected: number, t: Tolerance | null): boolean {
  const eps = 1e-9 * Math.max(1, Math.abs(expected));
  const d = Math.abs(given - expected);
  if (!t || t.kind === "none") return d <= eps;
  if (t.kind === "absolute") return d <= t.amount + eps;
  return d <= (Math.abs(expected) * t.amount) / 100 + eps;
}

/** Pure. A tenfold (or greater) error in the amount, either way: independent of any tolerance. (A wrong sign is simply wrong.) */
export function magnitudeError(given: number, expected: number): boolean {
  if (expected === 0) return false;
  const ratio = given / expected;
  return ratio <= 0 ? false : ratio >= MAGNITUDE_ERROR_FACTOR - 1e-9 || ratio <= 1 / MAGNITUDE_ERROR_FACTOR + 1e-12;
}

/**
 * Pure. A calculation marked by code (owner decision 4 Nov 2026). In order: the number (sign and decimal point kept); the unit (the key's,
 * or one of the item's validated equivalent units -- any other unit, or none, is wrong, with the amount shown in the key's unit where it
 * is of the same kind); the SAFETY check, independent of tolerance (a tenfold or greater error is unsafe); the question's rounding; then
 * the value, exactly -- or within the item's tolerance only where `policy.tolerancesActive` (off until the clinical policy is approved).
 */
export function markCalculation(spec: CalculationSpec, r: CalculationResponse, policy: CalculationPolicy = CALCULATION_DEFAULTS): CalculationMark {
  const n = parseNumber(r.value);
  const keyUnit = unitInfo(spec.unit)!;
  const givenUnit = unitInfo(r.unit);
  const expected = { value: spec.value, unit: unitLabel(spec.unit) };
  const active = policy.tolerancesActive && !!spec.tolerance && spec.tolerance.kind !== "none";
  const tolerance = active ? spec.tolerance : null;
  const base = { rules: SCORING_RULES_VERSION, expected, tolerance, toleranceInactive: !!spec.tolerance && spec.tolerance.kind !== "none" && !active, rounding: spec.rounding, warnings: n.ok ? n.warnings : [] } as const;
  const givenShown = { value: n.ok ? n.value : null, unit: givenUnit ? unitLabel(r.unit) : r.unit.trim().slice(0, 40) };
  const wrong = (reason: CalculationReason, feedback: string, inKeyUnit: number | null = null, safety: SafetyRecord | null = null): CalculationMark =>
    ({ ...base, correct: false, score: 0, reason, given: givenShown, inKeyUnit, safety, feedback });
  if (!n.ok) return wrong("unparsed", n.reason === "ambiguous_comma" ? "Use a decimal point, not a comma, in your answer (for example 2.5)." : "Your answer is not a number.");
  if (keyUnit.canonical && (!givenUnit || givenUnit.canonical === "")) return wrong("unit_missing", `Your answer has no unit. The answer is ${spec.display}.`);
  if (!givenUnit) return wrong("incompatible_unit", `That unit was not recognised. The answer is ${spec.display}.`);
  const same = givenUnit.canonical === keyUnit.canonical;
  const equivalent = !same && spec.equivalentUnits.some(e => unitInfo(e)?.canonical === givenUnit.canonical);
  const inKey = same ? n.value : convertUnit(n.value, r.unit, spec.unit);
  if (inKey === null) return wrong("incompatible_unit", `${unitLabel(r.unit) || "No unit"} measures something different from ${expected.unit || "the answer"}. The answer is ${spec.display}.`);
  // Independent of tolerance and of rounding: a tenfold or greater error in the amount (a decimal-point or unit slip) is unsafe.
  const tenfold = spec.safetyCritical && magnitudeError(inKey, spec.value);
  const safety = tenfold ? safetyRecord("unsafe", { statement: `${fmt(n.value)} ${unitLabel(r.unit)}`.trim(), by: "code" }) : null;
  const tenfoldNote = tenfold ? ` That is ${inKey / spec.value >= 1 ? fmt(Math.round(inKey / spec.value)) + " times" : "1/" + fmt(Math.round(spec.value / inKey)) + " of"} the right amount: an error of this size would be unsafe in practice.` : "";
  if (!same && !equivalent)
    return wrong("wrong_unit", `This question asks for the answer in ${expected.unit}. Your ${fmt(n.value)} ${unitLabel(r.unit)} is ${fmt(inKey)} ${expected.unit}.${tenfoldNote} The answer is ${spec.display}.`, inKey, safety);
  if (tenfold) return wrong("wrong_value", `Your ${fmt(n.value)} ${unitLabel(r.unit)} is not ${spec.display}.${tenfoldNote}`, inKey, safety);
  if (spec.rounding && same && applyRounding(n.value, spec.rounding) !== n.value && withinTolerance(applyRounding(n.value, spec.rounding), spec.value, null))
    return wrong("not_rounded", `Round your answer ${roundingText(spec.rounding)}: the answer is ${spec.display}.`, inKey);
  if (!withinTolerance(inKey, spec.value, tolerance))
    return wrong("wrong_value", `${same ? "" : `Your ${fmt(n.value)} ${unitLabel(r.unit)} is ${fmt(inKey)} ${expected.unit}. `}The answer is ${spec.display} (${toleranceText(tolerance ?? { kind: "none" }, expected.unit)}${spec.rounding ? `, ${roundingText(spec.rounding)}` : ""}).`, inKey);
  return { ...base, correct: true, score: 1, reason: "correct", given: givenShown, inKeyUnit: inKey, safety: null,
    feedback: same ? `Correct: ${spec.display}.` : `Correct: ${fmt(n.value)} ${unitLabel(r.unit)} is ${fmt(inKey)} ${expected.unit}, an accepted equivalent.` };
}

/** Pure. A calculation response from a browser body, bounded, or null. */
export function parseCalculationResponse(raw: unknown): CalculationResponse | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const value = typeof r.value === "string" ? r.value.trim() : typeof r.value === "number" && Number.isFinite(r.value) ? String(r.value) : "";
  const unit = typeof r.unit === "string" ? r.unit.trim() : "";
  return value && value.length <= 40 && unit.length <= 40 ? { value, unit } : null;
}

/** Pure. The calculation record kept on the attempt's response (bounded): what was given, in the key unit, and the policy it was marked under. */
export const storedCalculation = (m: CalculationMark): Record<string, unknown> => ({
  reason: m.reason, given: m.given, inKeyUnit: m.inKeyUnit, tolerancesActive: !!m.tolerance,
});

/** The units the learner may pick: the key's own, its validated equivalents, and the others of its dimension (realistic slips). */
export function calculationUnitChoices(spec: CalculationSpec): string[] {
  const all = new Set([...unitChoices(spec.unit), ...spec.equivalentUnits.map(unitLabel)]);
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** Pure. Every number written in a text (digits, with a decimal point; thousands commas removed), for the grounding of a stem. */
export function numbersIn(text: string): number[] {
  return (text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? []).map(t => Number(t.replace(/,/g, ""))).filter(Number.isFinite);
}
