/* eslint-disable @typescript-eslint/no-explicit-any */
// ── PROGRESS, READ ONCE ── COMPETEN-SCHOLAR-PROGRESS-01 (Progress, Stage 8 of 8) P1-P4 ─────────────────────────
//
// The I/O around the pure engines. One read of the evidence (store.ts evaluationEvidence, Stage 7's), the kept
// evaluations (426), the educational-context history (402), the materials and their classification (topics and
// competency links). Then: the current picture (Stage 7's evaluation of all the evidence), engagement, the history
// over periods (progress-history.ts) and the next steps (progress-next.ts). No AI, no new store, no new engine.

import { evaluationEvidence, libraryTopics, listEvaluations, listMaterials, sectionLinks, sectionsOf } from "./store";
import { contextHistory } from "./context";
import { evaluateScope } from "./evaluation-data";
import { learningHistory, type History, type PeriodKind } from "./progress-history";
import { nextSteps, type NextRule, type NextStep } from "./progress-next";
import type { Evaluation } from "./evaluation";
import type { IndividualPolicy } from "../policy";

export type Engagement = { windowDays: number; studyDays: number; answers: number; reviews: number; decisions: number; checks: number; lastStudied: string | null };
export type ProgressView = {
  ok: true; evaluation: Evaluation; engagement: Engagement; history: History; next: NextStep[];
  materials: { id: string; title: string; classified: boolean }[];
  context: { programme: string | null; level: string | null };
  kept: { id: string; createdAt: string; confidence: string; label: string; method: string; kind: string }[];
} | { ok: false; error: string };

const DAY = 86_400_000;

/** Everything the Progress workspace shows, from records that already exist. */
export async function loadProgress(admin: any, userId: string, policy: IndividualPolicy, now: string, opts: { period?: PeriodKind } = {}): Promise<ProgressView> {
  const [live, ev, kept, ctx, mats, topics] = await Promise.all([
    evaluateScope(admin, userId, policy, { kind: "all" }, { method: "existing", now }),
    evaluationEvidence(admin, userId), listEvaluations(admin, userId, 200), contextHistory(admin, userId), listMaterials(admin, userId), libraryTopics(admin, userId),
  ]);
  if (!live.ok) return { ok: false, error: live.error };
  if (!ev.ok || !mats.ok) return { ok: false, error: "Your learning could not be read just now." };
  const e = live.evaluation, d = ev.data;

  // Engagement: activity, never understanding.
  const since = Date.parse(now) - policy.scholarInsightWindowDays * DAY;
  const times = [...d.attempts.map(a => a.answeredAt), ...d.reviews.map(v => v.reviewedAt), ...d.decisions.map(x => x.createdAt), ...d.checks.map(c => c.createdAt)];
  const recent = times.filter(t => Date.parse(t) >= since);
  const engagement: Engagement = {
    windowDays: policy.scholarInsightWindowDays, studyDays: new Set(recent.map(t => t.slice(0, 10))).size,
    answers: d.attempts.filter(a => Date.parse(a.answeredAt) >= since).length, reviews: d.reviews.filter(v => Date.parse(v.reviewedAt) >= since).length,
    decisions: d.decisions.filter(x => Date.parse(x.createdAt) >= since).length, checks: d.checks.filter(c => Date.parse(c.createdAt) >= since).length,
    lastStudied: times.length ? times.reduce((a, b) => (a > b ? a : b)) : null,
  };

  // Classification: a material with neither topics nor competency links has not been classified yet.
  const withChunks = mats.data.filter(m => m.chunkCount > 0);
  const sections = await sectionsOf(admin, userId, withChunks.map(m => m.id));
  const links = sections.ok ? await sectionLinks(admin, userId, sections.data.map(s => s.chunkId)) : [];
  const linkedMaterials = new Set((sections.ok ? sections.data : []).filter(s => links.some(l => l.chunkId === s.chunkId)).map(s => s.materialId));
  const materials = withChunks.map(m => ({ id: m.id, title: m.title, classified: linkedMaterials.has(m.id) || (topics?.get(m.id)?.length ?? 0) > 0 }));

  // Strong, repeated performance: a material whose independent questions are nearly all right, practised more than once.
  const qMat = new Map(d.questions.map(q => [q.id, q.materialId]));
  const det = d.attempts.filter(a => a.marking === "deterministic");
  const latest = new Map<string, { correct: boolean; at: string }>(), seen = new Map<string, number>();
  for (const a of det) { seen.set(a.questionId, (seen.get(a.questionId) ?? 0) + 1); const l = latest.get(a.questionId); if (!l || a.answeredAt > l.at) latest.set(a.questionId, { correct: a.correct, at: a.answeredAt }); }
  const strongMaterials = withChunks.map(m => {
    const qs = [...latest.entries()].filter(([q]) => qMat.get(q) === m.id);
    const right = qs.filter(([, v]) => v.correct).length, repeated = qs.some(([q]) => (seen.get(q) ?? 0) > 1);
    return { id: m.id, title: m.title, n: qs.length, ok: qs.length >= 2 * policy.scholarEvaluationMinEvidence && repeated && right * 100 >= qs.length * policy.scholarEvaluationBandStrong };
  }).filter(m => m.ok);

  const contexts = ctx.ok ? ctx.periods.map(p => ({ programme: p.programmeCode, level: p.levelLabel, from: p.effectiveFrom, to: p.effectiveTo })) : [];
  const keptRows = kept.ok ? kept.data : [];
  const history = learningHistory({
    questions: d.questions, attempts: d.attempts, reviews: d.reviews, decisions: d.decisions, checks: d.checks, contexts,
    evaluations: keptRows.map(k => ({ id: k.id, createdAt: k.createdAt, confidence: k.confidence, label: k.scope?.label ?? "An evaluation", method: k.method })),
  }, { kind: opts.period ?? policy.scholarProgressPeriod, now, count: policy.scholarProgressPeriods, minPerPeriod: Math.max(2, Math.floor(policy.scholarEvaluationMinEvidence / 2)) });

  return {
    ok: true, evaluation: e, engagement, history, materials, context: live.context,
    next: nextSteps(e, { unclassified: materials.filter(m => !m.classified), strongMaterials, rules: policy.scholarProgressNextRules as NextRule[], max: policy.scholarProgressNextMax }),
    kept: keptRows.map(k => ({ id: k.id, createdAt: k.createdAt, confidence: k.confidence, label: k.scope?.label ?? "An evaluation", method: k.method, kind: k.kind })),
  };
}
