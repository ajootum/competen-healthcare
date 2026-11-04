// ── SAFETY MARKERS AND THEIR SCORING SCOPE, as a clinical reviewer approves them ── owner decision 1, 4 Nov 2026, migration 998 ──
//
// Pure. What a revision question's safety markers are and where each one would cap the score (rules v3, scoring-rules.ts): the item
// for a single-answer question, the part for a structured part or a part's criterion. hasSafetyMarkers is the same rule as the
// database's ckri_question_has_safety_markers (998) -- the HQ review page shows the confirmation exactly when the database accepts one.

import { CRITICAL_MISS_SCORE_CAP, UNSAFE_SCORE_CAP } from "@/lib/individual/scholar/scoring-rules";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const filled = (v: unknown): v is unknown[] => Array.isArray(v) && v.length > 0;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const UNSAFE_EFFECT = `an answer that says one earns at most ${pct(UNSAFE_SCORE_CAP)} of`;
const CRITICAL_EFFECT = `missing or getting it wrong earns ${pct(CRITICAL_MISS_SCORE_CAP)} of`;

/** One marker and the scope it would cap, in words a reviewer approves. */
export type MarkerScope = { scope: string; marker: string; effect: string };

/** Pure. Whether the question carries any safety marker (the 998 database rule, exactly). */
export function hasSafetyMarkers(content: unknown): boolean {
  const k = obj(obj(content)?.answerKey);
  if (!k) return false;
  if (k.safetyCritical === true || filled(k.unsafe) || filled(k.safetyCriticalPoints)) return true;
  return Array.isArray(k.parts) && k.parts.some(p => {
    const x = obj(p);
    return !!x && (x.safetyCritical === true || filled(x.unsafe) || (Array.isArray(x.criteria) && x.criteria.some(c => obj(c)?.safetyCritical === true)));
  });
}

/** Pure. Each marker with the scope it caps and the effect there, in the order a reviewer reads the question. */
export function safetyMarkerScopes(content: unknown): MarkerScope[] {
  const c = obj(content), k = obj(c?.answerKey);
  if (!k) return [];
  const out: MarkerScope[] = [];
  const item = "The whole question";
  if (k.safetyCritical === true) {
    const calc = k.format === "calculation" || c?.format === "calculation";
    out.push({ scope: item, marker: calc ? "Safety-critical calculation (a tenfold or greater error is unsafe)" : "Safety-critical answer", effect: `${CRITICAL_EFFECT} the question` });
  }
  for (const u of strings(k.unsafe)) out.push({ scope: item, marker: `Unsafe answer: ${u}`, effect: `${UNSAFE_EFFECT} the question` });
  if (filled(k.safetyCriticalPoints)) {
    const kp = strings(obj(c?.rubric)?.keyPoints);
    for (const i of k.safetyCriticalPoints as unknown[]) {
      if (typeof i === "number") out.push({ scope: item, marker: `Safety-critical key point: ${kp[i] ?? `key point ${i + 1}`}`, effect: `${CRITICAL_EFFECT} the question` });
    }
  }
  if (Array.isArray(k.parts)) k.parts.forEach((p, i) => {
    const x = obj(p);
    if (!x) return;
    const scope = `Part ${String.fromCharCode(97 + i)} only`;
    if (x.safetyCritical === true) out.push({ scope, marker: "Safety-critical part", effect: `${CRITICAL_EFFECT} this part` });
    for (const u of strings(x.unsafe)) out.push({ scope, marker: `Unsafe answer: ${u}`, effect: `${UNSAFE_EFFECT} this part` });
    if (Array.isArray(x.criteria)) for (const cr of x.criteria) {
      const o = obj(cr);
      if (o?.safetyCritical === true) out.push({ scope, marker: `Safety-critical criterion: ${typeof o.text === "string" ? o.text : "unnamed"}`, effect: `not meeting it earns ${pct(CRITICAL_MISS_SCORE_CAP)} of this part` });
    }
  });
  return out;
}

/** The confirmation a reviewer gives, worded once for the page, the route and the record. */
export const MARKERS_CONFIRMATION = "Safety markers and scoring scope approved";
export const MARKERS_CONFIRMATION_OPTIONS = ["approved", "not approved"] as const;
