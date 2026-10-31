/* eslint-disable @typescript-eslint/no-explicit-any */
import { RULE_ID, ruleMatches, termIn, type RiskRule } from "./clinical-risk";

// ── CLINICAL EDUCATIONAL CONTENT REVIEW RULES ── SCHOLAR-FLASHCARDS-QA-01 (c), owner GO 31 Oct 2026 ─────────────────
//
// HQ-configurable rules that FLAG potentially sensitive educational content (a flashcard stating a dose, a target, a
// paediatric rate, an emergency step) so the learner is told to check it against current local guidelines. Pure here:
// the rule shape, its strict validation (at save) and lenient resolution (at read), the matching, and the read of the
// published document. Saving, publishing and rolling back go through the CONFIG-002 engine (content-review-admin.ts),
// on the AI Fair Use page, under hq.platform.ai.manage -- no rules engine or governance system of its own.
//
// ⚠ IT ONLY FLAGS. A rule never blocks, rewrites, withholds or decides whether content is clinically correct, and it
// touches nothing else: not grounding, model eligibility, the clinical risk tier of a request, or privacy.
// ⚠ ONE MATCHER. Term groups use the clinical risk rules' own matcher (clinical-risk.ts ruleMatches / termIn): every
// group must have a term present; a term ending in * matches any word starting with it.
// ⚠ NOTHING PUBLISHED: the built-in defaults, which are exactly the SCHOLAR-FLASHCARDS-QA-01 constant they replace.
// A published document is used as published (an empty rule list flags nothing).
//
// Scope: platform / ai_content_review, path ai.content_review.scholar. Its OWN scope (the AI operating modes'
// precedent, platform / ai_modes): publishing or rolling back these rules never sweeps the fair-use policies, budgets,
// routing or provider registry into the same version, and they never sweep these.

export const CONTENT_REVIEW_SCOPE = { scopeType: "platform", scopeRef: "ai_content_review" } as const;
export type ContentReviewProduct = "scholar";
export const CONTENT_REVIEW_PRODUCTS: readonly ContentReviewProduct[] = ["scholar"];
export const contentReviewPath = (p: ContentReviewProduct) => `ai.content_review.${p}`;

export type ReviewAction = "flag" | "flag_strong" | "note_only";
export const REVIEW_ACTIONS: readonly ReviewAction[] = ["flag", "flag_strong", "note_only"];
export const REVIEW_ACTION_LABEL: Record<ReviewAction, string> = {
  flag: "Flag on the card", flag_strong: "Flag strongly on the card", note_only: "List in Points to Verify only (no card marker)",
};
export type NumericKind = "unit" | "percent" | "range" | "comparison";
export const NUMERIC_KINDS: readonly NumericKind[] = ["unit", "percent", "range", "comparison"];
export const NUMERIC_KIND_LABEL: Record<NumericKind, string> = {
  unit: "a number with a clinical unit", percent: "a percentage", range: "a range (12-20, 18 to 26)", comparison: "a comparison (>= 88, above 5)",
};

/**
 * One rule. It matches a piece of content when ALL of what it names holds: every term group (`all`) has a term in the
 * text; and, where `numeric` names kinds, the text states a value of one of them; and, where `topics` names
 * patterns, the content's topic matches one. A rule names at least one of the three. `professions`: the programme
 * professions it applies to ([] = all). `marker`: the learner-facing text for this rule (null = the action's default).
 */
export type ContentReviewRule = {
  id: string; label: string; all: string[][]; numeric: NumericKind[]; topics: string[]; professions: string[];
  action: ReviewAction; marker: string | null;
};
export type ContentReviewMarkers = Record<ReviewAction, string> & {
  /** For clinically approved library content: "{published}" becomes " (published <date>)" where the date is known. */
  reviewed: string;
};
export type ContentReviewPolicy = {
  version: string; rules: ContentReviewRule[];
  /** Clinical units a number is a value in (case-insensitive). "%", "percent", "per cent" are the percentage kind. */
  units: string[];
  /** Words that make a number NOT a clinical value when they follow it: ages and durations ("68-year-old", "60 seconds"). */
  exclusions: string[];
  markers: ContentReviewMarkers;
};

export const MAX_REVIEW_RULES = 40;
const MAX_TERMS = 120;
const MAX_MARKER = 300;

// ── THE BUILT-IN DEFAULTS: the SCHOLAR-FLASHCARDS-QA-01 constant, as a document ──

const CHILD = ["child", "children", "childhood", "paediatric*", "pediatric*", "infant", "infants", "neonat*", "newborn", "newborns", "baby", "babies", "toddler", "toddlers",
  "school-age", "school age", "adolescent", "adolescents", "under-five", "under-fives", "under five", "under fives", "under-5", "under 5"];
const RESP_RATE = ["respiratory rate", "respiratory rates", "breathing rate", "breathing rates", "breaths/min", "breaths per minute", "breaths per min", "breath per minute", "rr"];
const OXYGEN = ["spo2", "sao2", "sats", "saturation", "saturations", "oxygen target", "oxygen targets", "target saturation", "target saturations", "fio2", "controlled oxygen", "oxygen therapy"];
const EMERGENCY = ["emergenc*", "life-threatening", "life threatening", "silent chest", "respiratory arrest", "respiratory failure", "respiratory distress", "deteriorat*", "escalat*",
  "early warning score", "news", "news2", "call for help", "rapid response", "resuscitat*", "cyanos*", "stridor", "peri-arrest", "peri arrest", "abcde"];
const RESPIRATORY = ["respirat*", "breath*", "airway", "airways", "oxygen", "spo2", "saturation*", "asthma*", "wheez*", "chest", "copd", "lung", "lungs", "ventilat*", "hypox*", "hypercap*", "tachypn*"];
const COPD = ["copd", "chronic obstructive*", "emphysema", "chronic bronchitis"];
const DETERIORATION = ["exacerbat*", "deteriorat*", "drows*", "confus*", "hypercap*", "co2 retention", "retains co2", "retained co2", "retaining co2", "retention", "acidos*", "niv",
  "non-invasive ventilation", "non invasive ventilation", "reduced consciousness"];

export const DEFAULT_MARKERS: ContentReviewMarkers = {
  flag: "Check against current local guidelines: clinically sensitive value, not clinically reviewed.",
  flag_strong: "Verify before relying on this: a clinically sensitive value, not clinically reviewed. Check current local guidelines.",
  note_only: "Listed in Points to Verify.",
  reviewed: "Clinically reviewed{published}. Clinically sensitive value: local guidelines may differ, check them.",
};
export const DEFAULT_UNITS = ["%", "percent", "per cent", "mg", "mcg", "micrograms", "microgram", "µg", "g", "kg", "ml", "mls", "millilitres", "millilitre", "l/min", "litres", "litre",
  "liters", "liter", "units", "unit", "iu", "mmhg", "kpa", "mmol/l", "mmol", "bpm", "beats/min", "beats per minute", "beats per min", "breaths/min", "breaths per minute", "breaths per min",
  "°c", "degrees", "cm h2o", "cmh2o", "mg/kg", "ml/kg", "mcg/kg"];
export const DEFAULT_EXCLUSIONS = ["year", "yr", "month", "week", "day", "hour", "hr", "minute", "second"];

const rule = (id: string, label: string, over: Partial<ContentReviewRule>): ContentReviewRule => ({ id, label, all: [], numeric: [], topics: [], professions: [], action: "flag", marker: null, ...over });
export const DEFAULT_CONTENT_REVIEW: ContentReviewPolicy = {
  version: "default",
  rules: [
    rule("paediatric_rr", "Paediatric respiratory rates", { all: [CHILD, RESP_RATE] }),
    rule("oxygen_target", "Oxygen saturation targets", { all: [OXYGEN], numeric: ["percent", "range"] }),
    rule("emergency_resp", "Emergency respiratory assessment", { all: [EMERGENCY, RESPIRATORY] }),
    rule("copd_deterioration", "COPD deterioration", { all: [COPD, DETERIORATION] }),
    rule("numeric_value", "Numeric clinical value", { numeric: ["unit", "percent", "range", "comparison"] }),
  ],
  units: DEFAULT_UNITS, exclusions: DEFAULT_EXCLUSIONS, markers: DEFAULT_MARKERS,
};

// ── VALIDATION (strict, at save) AND RESOLUTION (lenient, at read) ──

const cleanTerm = (t: unknown) => (typeof t === "string" ? t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 60) : "");
const cleanTerms = (v: unknown) => (Array.isArray(v) ? [...new Set(v.map(cleanTerm).filter(t => t.replace(/\*$/, "").length >= 2))].slice(0, MAX_TERMS) : []);
const cleanText = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, max) : null);

function ruleOf(r: any): ContentReviewRule | string {
  if (!r || typeof r !== "object") return "A rule could not be read.";
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!RULE_ID.test(id)) return `Rule "${id || "(no id)"}": an id is 2 to 61 lower-case letters, digits, dots, dashes or underscores, starting with a letter.`;
  const label = cleanText(r.label, 120);
  if (!label) return `Rule ${id}: give it a label.`;
  const all = Array.isArray(r.all) ? r.all.map(cleanTerms).filter((g: string[]) => g.length) : [];
  if (Array.isArray(r.all) && r.all.some((g: unknown) => !Array.isArray(g) || !cleanTerms(g).length)) return `Rule ${id}: every term group needs at least one term of two letters or more.`;
  const numeric = Array.isArray(r.numeric) ? r.numeric : [];
  if (numeric.some((k: unknown) => !(NUMERIC_KINDS as readonly unknown[]).includes(k))) return `Rule ${id}: a numeric kind is one of ${NUMERIC_KINDS.join(", ")}.`;
  const topics = cleanTerms(r.topics);
  const professions = Array.isArray(r.professions) ? [...new Set(r.professions.map((p: unknown) => cleanText(p, 60)).filter(Boolean) as string[])].slice(0, 20) : [];
  if (Array.isArray(r.professions) && r.professions.some((p: unknown) => !cleanText(p, 60))) return `Rule ${id}: a profession is a name of up to 60 characters.`;
  const action = r.action ?? "flag";
  if (!(REVIEW_ACTIONS as readonly unknown[]).includes(action)) return `Rule ${id}: the review action is ${REVIEW_ACTIONS.join(", ")}.`;
  if (r.marker !== undefined && r.marker !== null && r.marker !== "" && (typeof r.marker !== "string" || r.marker.trim().length > MAX_MARKER)) return `Rule ${id}: its marker text is up to ${MAX_MARKER} characters.`;
  if (!all.length && !numeric.length && !topics.length) return `Rule ${id}: it matches nothing. Give it term groups, numeric kinds or topic patterns.`;
  return { id, label, all, numeric: [...new Set(numeric as NumericKind[])], topics, professions, action, marker: cleanText(r.marker, MAX_MARKER) };
}

/** Pure, strict (the save path): the document to store, or the first reason it cannot be. Nothing is silently dropped. */
export function validateContentReview(input: any): { ok: true; doc: Omit<ContentReviewPolicy, "version"> } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "The rules could not be read." };
  if (!Array.isArray(input.rules)) return { ok: false, error: "Give a list of rules (it may be empty)." };
  if (input.rules.length > MAX_REVIEW_RULES) return { ok: false, error: `At most ${MAX_REVIEW_RULES} rules.` };
  const rules: ContentReviewRule[] = [];
  for (const raw of input.rules) {
    const r = ruleOf(raw);
    if (typeof r === "string") return { ok: false, error: r };
    if (rules.some(x => x.id === r.id)) return { ok: false, error: `Two rules have the id ${r.id}.` };
    rules.push(r);
  }
  const units = input.units === undefined ? DEFAULT_UNITS : cleanTerms(input.units).filter(u => u.length <= 20);
  if (input.units !== undefined && (!Array.isArray(input.units) || !units.length)) return { ok: false, error: "Give at least one clinical unit." };
  const exclusions = input.exclusions === undefined ? DEFAULT_EXCLUSIONS : cleanTerms(input.exclusions);
  if (input.exclusions !== undefined && !Array.isArray(input.exclusions)) return { ok: false, error: "Exclusions are a list of words." };
  const markers = { ...DEFAULT_MARKERS };
  for (const k of [...REVIEW_ACTIONS, "reviewed"] as const) {
    const v = input.markers?.[k];
    if (v === undefined || v === null) continue;
    const t = cleanText(v, MAX_MARKER + 1);
    if (!t || t.length > MAX_MARKER) return { ok: false, error: `The ${k.replace("_", " ")} marker text is 1 to ${MAX_MARKER} characters.` };
    markers[k] = t;
  }
  return { ok: true, doc: { rules, units, exclusions, markers } };
}

/** Pure, lenient (the read path): a published document as a policy; a rule that does not validate is left out. Null: the defaults. */
export function resolveContentReview(doc: any, version = "published"): ContentReviewPolicy {
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.rules)) return DEFAULT_CONTENT_REVIEW;
  const rules: ContentReviewRule[] = [];
  for (const raw of doc.rules.slice(0, MAX_REVIEW_RULES)) { const r = ruleOf(raw); if (typeof r !== "string" && !rules.some(x => x.id === r.id)) rules.push(r); }
  const units = cleanTerms(doc.units).filter(u => u.length <= 20);
  const markers = { ...DEFAULT_MARKERS };
  for (const k of [...REVIEW_ACTIONS, "reviewed"] as const) { const t = cleanText(doc.markers?.[k], MAX_MARKER); if (t) markers[k] = t; }
  return { version, rules, units: units.length ? units : DEFAULT_UNITS, exclusions: Array.isArray(doc.exclusions) ? cleanTerms(doc.exclusions) : DEFAULT_EXCLUSIONS, markers };
}

// ── MATCHING ──

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const COMPARE_WORDS = "above|below|over|under|at least|at most|more than|less than|greater than|fewer than|target of|exceeds?";
/** Subscript digits read as digits (SpO₂ is SpO2), then the text as the matcher reads it. */
const plain = (s: string) => [...s].map(ch => (ch >= "₀" && ch <= "₉" ? String(ch.charCodeAt(0) - 0x2080) : ch)).join("");

/**
 * Pure. The clinical values a text states, each with its kinds, in its own words: a number with a unit, a
 * percentage, a range, or a comparison. A number attached to letters (the 2 of SpO2) is not one, nor one followed by
 * an exclusion word (an age or a duration). At most `limit`.
 */
export function numericValues(text: string, policy: Pick<ContentReviewPolicy, "units" | "exclusions">, limit = 4): { value: string; kinds: NumericKind[] }[] {
  const s = plain(text);
  const units = [...policy.units].sort((a, b) => b.length - a.length).map(u => `${esc(u)}${/[a-z]$/i.test(u) ? "(?![a-z])" : ""}`).join("|");
  const re = new RegExp(String.raw`(>=|<=|≥|≤|>|<|\b(?:${COMPARE_WORDS})\s+)?\s*(?<![A-Za-z\d.])(\d+(?:\.\d+)?)(\s*(?:-|–|to)\s*\d+(?:\.\d+)?)?(\s*(?:${units}))?`, "gi");
  const excl = policy.exclusions.length ? new RegExp(String.raw`^\s*-?\s*(?:${policy.exclusions.map(esc).join("|")})`, "i") : null;
  const out: { value: string; kinds: NumericKind[] }[] = [];
  for (const m of s.matchAll(re)) {
    const after = s.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 16);
    if (excl?.test(after)) continue;
    const unit = (m[4] ?? "").trim().toLowerCase();
    const kinds: NumericKind[] = [];
    if (unit) kinds.push(/^(%|percent|per cent)$/.test(unit) ? "percent" : "unit");
    if (m[3]) kinds.push("range");
    if (m[1]) kinds.push("comparison");
    if (!kinds.length) continue;
    const value = m[0].trim();
    if (!out.some(v => v.value === value)) out.push({ value, kinds });
    if (out.length >= limit) break;
  }
  return out;
}

export type ReviewSubject = { text: string; topic?: string | null };
export type ReviewHit = { rule: ContentReviewRule; values: string[] };

/**
 * Pure. The rules a piece of content matches. `professions`: the programme professions of the learner; null (not
 * known) applies every rule -- the safer side for a flag. Only flags: nothing here changes the content.
 */
export function reviewMatches(policy: ContentReviewPolicy, subject: ReviewSubject, professions: readonly string[] | null = null): ReviewHit[] {
  const text = plain(subject.text);
  const values = numericValues(text, policy, 8);
  const prof = professions ? professions.map(p => p.toLowerCase()) : null;
  const topic = ` ${plain(subject.topic ?? "").toLowerCase().replace(/\s+/g, " ")} `;
  const hits: ReviewHit[] = [];
  for (const r of policy.rules) {
    if (r.professions.length && prof && !r.professions.some(p => prof.includes(p.toLowerCase()))) continue;
    // The clinical risk rules' own matcher for the term groups.
    if (r.all.length) {
      const asRisk: RiskRule = { id: r.id, label: r.label, tier: "clinical_educational", scope: "subject", all: r.all };
      if (!ruleMatches(asRisk, { text, competencyRisks: [], frameworkCodes: [] })) continue;
    }
    if (r.topics.length && !r.topics.some(t => termIn(topic, t))) continue;
    const mine = r.numeric.length ? values.filter(v => v.kinds.some(k => r.numeric.includes(k))).map(v => v.value) : [];
    if (r.numeric.length && !mine.length) continue;
    hits.push({ rule: r, values: mine });
  }
  return hits;
}

const RANK: Record<ReviewAction, number> = { note_only: 0, flag: 1, flag_strong: 2 };
/** Pure. The strongest action among the hits, and its learner-facing marker (null for note_only: no card marker). */
export function reviewOutcome(policy: ContentReviewPolicy, hits: readonly ReviewHit[], reviewedOn: string | null | false): { action: ReviewAction; marker: string | null } | null {
  if (!hits.length) return null;
  const top = hits.reduce((a, b) => (RANK[b.rule.action] > RANK[a.rule.action] ? b : a));
  const action = top.rule.action;
  if (action === "note_only") return { action, marker: null };
  // Clinically approved content keeps its standing: the reviewed marker, with its publication date where known.
  if (reviewedOn !== false) return { action, marker: policy.markers.reviewed.replace("{published}", reviewedOn ? ` (published ${reviewedOn})` : "") };
  return { action, marker: top.rule.marker ?? policy.markers[action] };
}

// ── THE PUBLISHED DOCUMENT ──

/**
 * The published rules for a product, or the built-in defaults when nothing is published (or the engine cannot be
 * read: a flag errs on the side of being shown). Never the draft.
 */
export async function loadContentReviewPolicy(admin: any, product: ContentReviewProduct = "scholar"): Promise<ContentReviewPolicy> {
  try {
    const { data, error } = await admin.from("workspace_config_overrides").select("published, updated_at")
      .eq("scope_type", CONTENT_REVIEW_SCOPE.scopeType).eq("scope_ref", CONTENT_REVIEW_SCOPE.scopeRef).eq("config_path", contentReviewPath(product)).maybeSingle();
    if (error || !data?.published) return DEFAULT_CONTENT_REVIEW;
    return resolveContentReview(data.published, `${contentReviewPath(product)}@${data.updated_at ?? ""}`);
  } catch {
    return DEFAULT_CONTENT_REVIEW;
  }
}
