/* eslint-disable @typescript-eslint/no-explicit-any */

// ── LIBRARY QUESTION PERFORMANCE AND QUESTION ANALYTICS ── SQIE-COMPLETE-01, SQIE-CLOSE-2026-11 WS-G ────────────────────
//
// Item quality per library version, and correctness per question format, for HQ. AGGREGATES ONLY, CONSENTED, SUPPRESSED.
//
// ⚠ PRIVACY (WS-G, fixed first). Until WS-G this module read every learner's library copy and attempt directly, with
// neither the collective_analytics consent (440) nor the 441 minimum cohort. It now reads ONLY two database functions
// (migration 996): ckri_library_item_stats and ckri_question_format_correctness. They count only people whose
// collective_analytics permission is granted, suppress every cell describing fewer than the published CKRI minimum
// cohort (never below 5), round counts to the CKRI policy's base, and return declared columns with no learner id, no
// question text and no answer. Nothing here can see a learner, so nothing here can leak one.
// ⚠ NOT MEASURED IS NOT ZERO. Before 996 (or on a read error) `measured` is false with the reason; a suppressed cell says
// "fewer than N learners", never a number.
// ⚠ A SMALL COUNT IS NOT A SIGNAL. The difficulty flag needs MIN_ATTEMPTS attempts. The discrimination index is computed
// by the database only over at least the floor of learners who answered another library item too.
// ⚠ FORMATIVE PRACTICE. Question-quality indicators, never a learner's grade or competence.

export const MIN_ATTEMPTS = 20;
export const LOW_CORRECT = 25;
export const HIGH_CORRECT = 95;
/** Point-biserial (corrected item-rest) below this is weak; below zero the key or the item needs review. */
export const WEAK_DISCRIMINATION = 0.2;

export type DiscriminationFlag = "negative" | "weak" | null;
export type VersionPerformance = {
  versionId: string; suppressed: boolean;
  learners: number | null; attempts: number | null; firstAttempts: number | null;
  percentCorrect: number | null; firstPercentCorrect: number | null; lastUsed: string | null; missedLearners: number | null;
  /** Single best answer only: first-attempt picks per option (index 0-3); null = below the floor (suppressed sub-cell). */
  options: (number | null)[] | null;
  discrimination: number | null; discriminationN: number | null;
  flag: "review_difficulty_or_key" | null; discriminationFlag: DiscriminationFlag;
};
export type PerformanceResult = { measured: boolean; reason: string | null; floor: number; byVersion: Map<string, VersionPerformance> };
export type CohortRules = { minCohort: number; roundTo: number };

/** Pure. The flag: under 25% or over 95% correct with at least 20 attempts. Anything else, or too few attempts, is no flag. */
export function difficultyFlag(attempts: number, correct: number): "review_difficulty_or_key" | null {
  if (attempts < MIN_ATTEMPTS) return null;
  const pct = (correct / attempts) * 100;
  return pct < LOW_CORRECT || pct > HIGH_CORRECT ? "review_difficulty_or_key" : null;
}

/** Pure. A discrimination index read as a flag: negative (check the key), weak (under 0.2), or fine. null index: no flag. */
export function discriminationFlag(r: number | null): DiscriminationFlag {
  if (r === null || !Number.isFinite(r)) return null;
  return r < 0 ? "negative" : r < WEAK_DISCRIMINATION ? "weak" : null;
}

/** The floor actually applied: the published minimum cohort, never below 5 (the 441 and 996 rule). */
export const floorOf = (rules: CohortRules) => Math.max(5, Math.floor(rules.minCohort || 10));

/**
 * Pure. The option cells of a single best answer item with COMPLEMENTARY suppression: where exactly one option is
 * suppressed (null from the database), the smallest reported one is suppressed too, so the hidden cell cannot be
 * recovered by subtraction from the first-attempt total. Missing options are a real zero (nobody chose them).
 */
export function optionCells(raw: unknown, n = 4): (number | null)[] | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const cells: (number | null)[] = Array.from({ length: n }, (_, i) => (String(i) in r ? (typeof r[String(i)] === "number" ? (r[String(i)] as number) : null) : 0));
  if (cells.filter(c => c === null).length === 1) {
    let k = -1;
    cells.forEach((c, i) => { if (c !== null && c > 0 && (k < 0 || c < (cells[k] as number))) k = i; });
    if (k >= 0) cells[k] = null;
  }
  return cells;
}

/** Pure. One row of ckri_library_item_stats as the page reads it. */
export function versionPerformanceOf(row: any): VersionPerformance {
  const num = (v: unknown) => (typeof v === "number" ? v : v === null || v === undefined ? null : Number.isFinite(Number(v)) ? Number(v) : null);
  const suppressed = row?.suppressed === true;
  const attempts = suppressed ? null : num(row?.attempts);
  const pct = suppressed ? null : num(row?.percent_correct);
  const discrimination = suppressed ? null : num(row?.discrimination);
  return {
    versionId: String(row?.version_id ?? ""), suppressed,
    learners: suppressed ? null : num(row?.learners), attempts, firstAttempts: suppressed ? null : num(row?.first_attempts),
    percentCorrect: pct, firstPercentCorrect: suppressed ? null : num(row?.first_percent_correct),
    lastUsed: suppressed ? null : (typeof row?.last_used === "string" ? row.last_used : null), missedLearners: suppressed ? null : num(row?.missed_learners),
    options: suppressed ? null : optionCells(row?.option_counts),
    discrimination, discriminationN: suppressed ? null : num(row?.discrimination_n),
    flag: attempts !== null && pct !== null ? difficultyFlag(attempts, Math.round((pct / 100) * attempts)) : null,
    discriminationFlag: discriminationFlag(discrimination),
  };
}

const missing = (e: any) => /could not find|does not exist|schema cache|PGRST202/i.test(`${e?.message ?? ""} ${e?.code ?? ""}`);
const NOT_996 = "Not measured: the consented, cohort-suppressed analytics (migration 996) are not installed here.";

/** Reads the aggregate for these library versions through 996. Never throws. `measured` false with the reason otherwise. */
export async function loadLibraryPerformance(admin: any, versionIds: readonly string[], rules: CohortRules): Promise<PerformanceResult> {
  const floor = floorOf(rules);
  const ids = [...new Set(versionIds)].slice(0, 1000);
  if (!ids.length) return { measured: true, reason: null, floor, byVersion: new Map() };
  try {
    const out = new Map<string, VersionPerformance>();
    for (let i = 0; i < ids.length; i += 200) {
      const r = await admin.rpc("ckri_library_item_stats", { p_versions: ids.slice(i, i + 200), p_min: floor, p_round: rules.roundTo });
      if (r.error) return { measured: false, reason: missing(r.error) ? NOT_996 : "Not measured: the analytics could not be read just now.", floor, byVersion: new Map() };
      for (const row of r.data ?? []) { const p = versionPerformanceOf(row); out.set(p.versionId, p); }
    }
    return { measured: true, reason: null, floor, byVersion: out };
  } catch {
    return { measured: false, reason: "Not measured: the analytics could not be read just now.", floor, byVersion: new Map() };
  }
}

// ── PER FORMAT ──

export type FormatCorrectness = { format: string; source: "personal" | "library"; suppressed: boolean; learners: number | null; attempts: number | null; percentCorrect: number | null };
export type FormatResult = { measured: boolean; reason: string | null; floor: number; days: number; rows: FormatCorrectness[] };
export const FORMAT_DAYS = 90;

/** Correctness per question format and source over the last `days` days, through 996. */
export async function loadFormatCorrectness(admin: any, rules: CohortRules, days = FORMAT_DAYS): Promise<FormatResult> {
  const floor = floorOf(rules);
  try {
    const r = await admin.rpc("ckri_question_format_correctness", { p_since: new Date(Date.now() - days * 864e5).toISOString(), p_min: floor, p_round: rules.roundTo });
    if (r.error) return { measured: false, reason: missing(r.error) ? NOT_996 : "Not measured: the analytics could not be read just now.", floor, days, rows: [] };
    const rows: FormatCorrectness[] = (r.data ?? []).map((x: any) => ({
      format: String(x.format), source: x.source === "library" ? "library" : "personal", suppressed: x.suppressed === true,
      learners: x.suppressed ? null : x.learners ?? null, attempts: x.suppressed ? null : x.attempts ?? null, percentCorrect: x.suppressed ? null : x.percent_correct ?? null,
    }));
    return { measured: true, reason: null, floor, days, rows };
  } catch {
    return { measured: false, reason: "Not measured: the analytics could not be read just now.", floor, days, rows: [] };
  }
}

// ── MISCONCEPTION PATTERNS ──

export type MisconceptionPattern = { misconception: string; versions: number; missedLearners: number };

/**
 * Pure. The misconceptions HQ's own rubrics name, weighted by how many consenting learners missed the items naming them
 * (first attempt wrong), over versions above the floor only. The text is the library's (HQ content), never a learner's:
 * nothing a learner wrote is read. Same wording (case and punctuation aside) is one pattern.
 */
export function misconceptionPatterns(items: readonly { versionId: string; misconceptions: readonly string[] }[], perf: ReadonlyMap<string, VersionPerformance>, limit = 10): MisconceptionPattern[] {
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  const acc = new Map<string, MisconceptionPattern>();
  for (const it of items) {
    const p = perf.get(it.versionId);
    if (!p || p.suppressed || !p.missedLearners) continue;
    for (const m of new Set(it.misconceptions.map(x => x.trim()).filter(Boolean))) {
      const k = key(m);
      if (!k) continue;
      const a = acc.get(k) ?? { misconception: m, versions: 0, missedLearners: 0 };
      a.versions++; a.missedLearners += p.missedLearners;
      acc.set(k, a);
    }
  }
  return [...acc.values()].sort((a, b) => b.missedLearners - a.missedLearners || b.versions - a.versions || a.misconception.localeCompare(b.misconception)).slice(0, limit);
}
