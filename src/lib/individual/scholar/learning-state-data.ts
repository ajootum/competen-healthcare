import { learningExposure, masteryEvidence, type Read } from "./store";
import { MASTERY_MAX_ROWS, MASTERY_WINDOW_DAYS } from "./mastery-data";
import { buildLearningState, type StateEvidence, type StateMarking, type StateTopic, type TopicLearningState, type ExposureRow } from "./learning-state";
import { isCognitiveLevel } from "./question-intel";
import { isStatedConfidence, realMisconceptions } from "./learning-need";
import type { MasteryLevel } from "./mastery";
import type { IndividualPolicy } from "../policy";
import type { EvidenceRecord } from "./application-evidence";

// ── SALE-2026-11 R1 / SALE-04: THE READ BEHIND THE LEARNING STATE ─────────────────────────────────────────────────────────
//
// The SAME bounded evidence read as Progress by topic (store.masteryEvidence, request-cached, so Progress reads it once) and one
// bounded exposure read (store.learningExposure: learning events and the sections they used). Joined here to the SAME topic as
// Progress by topic (the item's rubric topic, else the first topic of its section, else its material), then handed to the pure
// buildLearningState. Nothing is written and nothing is stored: the state is derived each time. Only store.ts queries tables.
// No AI.

const DAY = 86_400_000;
const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
const MARKING: Record<string, StateMarking> = { deterministic: "code", ai_evaluation: "ai_evaluation", self_graded: "self", unmarked: "unmarked" };
const DIFFICULTY_LEVEL: Record<number, MasteryLevel> = { 1: "recall", 2: "understanding", 3: "application" };

/** The thresholds the policy sets (HQ keys scholar_learning_state_*, code defaults in policy.ts). */
export const stateThresholds = (p: IndividualPolicy) => ({
  minEvidence: p.scholarLearningStateMinEvidence, distinctQuestions: p.scholarLearningStateDistinctQuestions,
  delayDays: p.scholarLearningStateDelayDays, staleDays: p.scholarLearningStateStaleDays,
});

export async function loadLearningState(admin: unknown, userId: string, policy: IndividualPolicy, now: string, o: {
  materials: readonly { id: string; title: string }[];
  /** The topics of each section (Progress already read them). Null: none, so every row falls back to its material. */
  concepts: ReadonlyMap<string, readonly string[]> | null;
  /** SALE-2026-11 R4 (SALE-13): case records already read (only where scholar_application_evidence is on). A case made from a material counts as applying it. */
  application?: readonly EvidenceRecord[] | null;
}): Promise<Read<TopicLearningState[]>> {
  const sinceIso = new Date(Date.parse(now) - MASTERY_WINDOW_DAYS * DAY).toISOString();
  const [raw, exp] = await Promise.all([masteryEvidence(admin, userId, { sinceIso, maxRows: MASTERY_MAX_ROWS }), learningExposure(admin, userId, { sinceIso, maxRows: MASTERY_MAX_ROWS })]);
  if (!raw.ok) return raw;
  if (!exp.ok) return exp;
  const { questions, attempts, reviews, cards, osce, stations } = raw.data;
  const title = new Map(o.materials.map(m => [m.id, m.title]));
  const concepts = o.concepts ?? new Map<string, readonly string[]>();
  const topics = new Map<string, { label: string; chunks: Set<string>; materials: Map<string, number> }>();
  const place = (materialId: string, chunkId: string | null, own: string | null): string | null => {
    const t = (own ?? (chunkId ? concepts.get(chunkId)?.find(x => x.trim()) : undefined) ?? title.get(materialId) ?? "").trim();
    if (!t) return null;
    const k = norm(t);
    const g = topics.get(k) ?? { label: t, chunks: new Set<string>(), materials: new Map<string, number>() };
    if (chunkId) g.chunks.add(chunkId);
    g.materials.set(materialId, (g.materials.get(materialId) ?? 0) + 1);
    topics.set(k, g);
    return k;
  };
  const levelOf = (q: { level: string | null; difficulty: number | null }): MasteryLevel =>
    isCognitiveLevel(q.level) ? q.level : q.difficulty !== null && DIFFICULTY_LEVEL[q.difficulty] ? DIFFICULTY_LEVEL[q.difficulty] : "unknown";

  const qById = new Map(questions.map(q => [q.id, q]));
  const evidence: StateEvidence[] = [];
  for (const a of attempts) {
    const q = qById.get(a.questionId);
    if (!q) continue;
    const key = place(q.materialId, q.chunkId, q.topic);
    if (!key) continue;
    const marking = MARKING[a.marking] ?? "code";
    const outcome = marking === "unmarked" ? null : a.score !== null ? Math.max(0, Math.min(1, a.score)) : a.correct ? 1 : 0;
    const missed = outcome !== null && outcome < 0.75;
    evidence.push({
      itemId: q.id, attemptId: a.id ?? null, topicKey: key, chunkId: q.chunkId, materialId: q.materialId, source: q.check ? "check" : "practice", level: levelOf(q),
      outcome, marking, at: a.answeredAt, confidence: isStatedConfidence(a.confidence) ? a.confidence : null,
      misconceptions: missed ? realMisconceptions([...(a.misconceptions ?? []), ...(q.misconceptions ?? [])]) : [],
    });
  }
  const cardQ = new Map(cards.map(c => [c.id, c.questionId]));
  for (const r of reviews) {
    const q = qById.get(cardQ.get(r.cardId) ?? "");
    if (!q) continue;
    const key = place(q.materialId, q.chunkId, q.topic);
    if (!key) continue;
    evidence.push({ itemId: q.id, attemptId: null, topicKey: key, chunkId: q.chunkId, materialId: q.materialId, source: "review", level: levelOf(q), outcome: r.quality >= 3 ? 1 : 0, marking: "self", at: r.reviewedAt, confidence: null, misconceptions: [] });
  }
  const stationById = new Map(stations.map(s => [s.id, s]));
  for (const r of osce) {
    const s = stationById.get(r.stationId);
    if (!s?.materialId) continue;
    const key = place(s.materialId, s.chunkId, null);
    if (!key) continue;
    evidence.push({ itemId: `osce:${s.id}`, attemptId: null, topicKey: key, chunkId: s.chunkId, materialId: s.materialId, source: "osce", level: "application", outcome: Math.max(0, Math.min(1, r.score)), marking: r.marking === "ai_evaluation" ? "ai_evaluation" : "self", at: r.at, confidence: null, misconceptions: [] });
  }
  // SALE-13: a completed case made from the learner's notes is application evidence on that material's topic. A library case has no material
  // of the learner's and stays in the application section only. Its outcome is the case's own (application-evidence.ts caseRecord).
  for (const r of o.application ?? []) {
    if (r.source !== "case" || !r.materialId) continue;
    const key = place(r.materialId, null, null);
    if (!key) continue;
    evidence.push({ itemId: r.activityId, attemptId: null, topicKey: key, chunkId: null, materialId: r.materialId, source: "case", level: "application", outcome: r.outcome, marking: r.marking, at: r.at, confidence: null, misconceptions: [] });
  }
  const exposure: ExposureRow[] = [];
  for (const e of exp.data) {
    const key = place(e.materialId, e.chunkId, null);
    if (key) exposure.push({ topicKey: key, chunkId: e.chunkId, action: e.action, at: e.at });
  }
  const list: StateTopic[] = [...topics.entries()].map(([key, g]) => ({
    key, label: g.label, chunkIds: [...g.chunks],
    materialId: [...g.materials.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null,
  }));
  return { ok: true, data: buildLearningState({ topics: list, evidence, exposure, now, thresholds: stateThresholds(policy) }) };
}
