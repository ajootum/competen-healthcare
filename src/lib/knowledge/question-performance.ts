/* eslint-disable @typescript-eslint/no-explicit-any */

// ── LIBRARY QUESTION PERFORMANCE ── SQIE-COMPLETE-01 (owner GO 31 Oct 2026) ──────────────────────────────────────────────
//
// Item quality per library version, from the learners' own copies (individual_scholar_question.library_version_id, 710) and
// their attempts (individual_scholar_attempt). AGGREGATE COUNTS ONLY.
//
// ⚠ PLANE BOUNDARY REASON (recorded here and in plane-boundary.ts): aggregate per library version counts only (SQIE item
// quality); no learner identity or content read. EXACTLY these columns are selected:
//   individual_scholar_question : id, library_version_id      (the copy's id and which library version it copies)
//   individual_scholar_attempt  : question_id, correct, answered_at
// user_id, stem, options, rationale, chosen_index, response, score and every other column are never selected, so no learner
// identity and no learner content leaves the query. A copy is unique per learner and version (ux_individual_scholar_question_
// library, 710), so "copies held" IS "learners holding a copy" without any identity being read.
// ⚠ NOT MEASURED IS NOT ZERO: before migration 710 (or on a read error) `measured` is false and the page says so.
// ⚠ A SMALL COUNT IS NOT A SIGNAL. The difficulty flag needs MIN_ATTEMPTS attempts.

export const MIN_ATTEMPTS = 20;
export const LOW_CORRECT = 25;
export const HIGH_CORRECT = 95;

export type VersionPerformance = { versionId: string; copies: number; attempts: number; correct: number; percentCorrect: number | null; lastUsed: string | null; flag: "review_difficulty_or_key" | null };
export type PerformanceResult = { measured: boolean; byVersion: Map<string, VersionPerformance> };

/** Pure. The flag: under 25% or over 95% correct with at least 20 attempts. Anything else, or too few attempts, is no flag. */
export function difficultyFlag(attempts: number, correct: number): "review_difficulty_or_key" | null {
  if (attempts < MIN_ATTEMPTS) return null;
  const pct = (correct / attempts) * 100;
  return pct < LOW_CORRECT || pct > HIGH_CORRECT ? "review_difficulty_or_key" : null;
}

/** Pure. Counts per version from the copies and attempts. */
export function summarisePerformance(
  copies: readonly { id: string; library_version_id: string }[],
  attempts: readonly { question_id: string; correct: boolean; answered_at: string }[],
): Map<string, VersionPerformance> {
  const versionOf = new Map(copies.map(c => [c.id, c.library_version_id]));
  const out = new Map<string, VersionPerformance>();
  for (const c of copies) {
    const p = out.get(c.library_version_id) ?? { versionId: c.library_version_id, copies: 0, attempts: 0, correct: 0, percentCorrect: null, lastUsed: null, flag: null };
    p.copies++; out.set(c.library_version_id, p);
  }
  for (const a of attempts) {
    const v = versionOf.get(a.question_id);
    const p = v ? out.get(v) : undefined;
    if (!p) continue;
    p.attempts++; if (a.correct) p.correct++;
    if (!p.lastUsed || a.answered_at > p.lastUsed) p.lastUsed = a.answered_at;
  }
  for (const p of out.values()) { p.percentCorrect = p.attempts ? Math.round((p.correct / p.attempts) * 100) : null; p.flag = difficultyFlag(p.attempts, p.correct); }
  return out;
}

const CHUNK = 200;

/** Reads the aggregate for these library versions. Never throws. `measured` false when the copies cannot be read. */
export async function loadLibraryPerformance(admin: any, versionIds: readonly string[]): Promise<PerformanceResult> {
  const ids = [...new Set(versionIds)].slice(0, 1000);
  if (!ids.length) return { measured: true, byVersion: new Map() };
  try {
    const copies: { id: string; library_version_id: string }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const r = await admin.from("individual_scholar_question").select("id, library_version_id").in("library_version_id", ids.slice(i, i + CHUNK)).limit(20000);
      if (r.error) return { measured: false, byVersion: new Map() };
      copies.push(...(r.data ?? []));
    }
    const attempts: { question_id: string; correct: boolean; answered_at: string }[] = [];
    for (let i = 0; i < copies.length; i += CHUNK) {
      const r = await admin.from("individual_scholar_attempt").select("question_id, correct, answered_at").in("question_id", copies.slice(i, i + CHUNK).map(c => c.id)).limit(50000);
      if (r.error) return { measured: false, byVersion: new Map() };
      attempts.push(...(r.data ?? []));
    }
    return { measured: true, byVersion: summarisePerformance(copies, attempts) };
  } catch {
    return { measured: false, byVersion: new Map() };
  }
}
