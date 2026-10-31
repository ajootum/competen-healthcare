import { masteryEvidence, type MappingRow, type Read } from "./store";
import { buildMastery, type MasteryEvidence, type MasteryLevel, type MasteryMarking, type MasteryResult } from "./mastery";
import { isCognitiveLevel } from "./question-intel";
import type { IndividualPolicy } from "../policy";

// ── MASTERY: THE READ ── SCHOLAR-COMPANION-01 P1 ──────────────────────────────────────────────────────────────
//
// One bounded read of the learner's own evidence (store.masteryEvidence: newest MAX_ROWS attempts and reviews within
// WINDOW_DAYS, finished OSCE runs, cards, questions), joined here to topic, level and competency, then handed to the pure
// buildMastery. Only store.ts queries individual_scholar_* (harness rule A1). No AI.
//
// WHAT JOINS HOW
//   topic        the item's own rubric topic (710), else the first topic found in its section, else its material stands in.
//   level        the item's rubric level (710), else its recorded difficulty (1 recall, 2 understanding, 3 application),
//                else unknown. Unknown is never promoted to a level.
//   competency   only through an ACCEPTED section-to-competency link (the same rule as Progress by competency and S5
//                coverage), so the figures agree. An OSCE run counts to its station's competency.
//   marking      deterministic -> code, ai_evaluation -> ai_evaluation, self_graded -> self. A spaced-review rating is
//                the learner's own recall grade (self); 3 or more of 5 is a pass. An OSCE run is the learner's confirmed
//                self-check (self), or AI-suggested marks (ai_evaluation).
//   NOT READ     Teach Me check verdicts (engagement only), case decisions (their questions already count as attempts).

export const MASTERY_WINDOW_DAYS = 180;
export const MASTERY_MAX_ROWS = 1000;
const DAY = 86_400_000;

const MARKING: Record<string, MasteryMarking> = { deterministic: "code", ai_evaluation: "ai_evaluation", self_graded: "self" };
const DIFFICULTY_LEVEL: Record<number, MasteryLevel> = { 1: "recall", 2: "understanding", 3: "application" };

export async function loadMastery(admin: unknown, userId: string, policy: IndividualPolicy, now: string, o: {
  materials: readonly { id: string; title: string }[];
  /** Rows the caller already read for Progress by competency (accepted links and the topics of each section). Null: none. */
  linked: { mappings: readonly Pick<MappingRow, "chunkId" | "materialId" | "competencyId" | "state">[]; concepts: ReadonlyMap<string, readonly string[]> } | null;
  /** The programme's competencies, or null with none. */
  competencies: readonly { id: string; title: string }[] | null;
  studyId?: string | null;
}): Promise<Read<MasteryResult>> {
  const since = new Date(Date.parse(now) - MASTERY_WINDOW_DAYS * DAY).toISOString();
  const raw = await masteryEvidence(admin, userId, { sinceIso: since, maxRows: MASTERY_MAX_ROWS });
  if (!raw.ok) return raw;
  const { questions, attempts, reviews, cards, osce, stations, truncated } = raw.data;

  const title = new Map(o.materials.map(m => [m.id, m.title]));
  const concepts = o.linked?.concepts ?? new Map<string, readonly string[]>();
  const accepted = new Set((o.linked?.mappings ?? []).filter(m => m.state === "accepted").map(m => `${m.chunkId}|${m.competencyId}`));
  const qById = new Map(questions.map(q => [q.id, q]));
  const cardQ = new Map(cards.map(c => [c.id, c.questionId]));

  const placeOf = (materialId: string, chunkId: string | null, ownTopic: string | null) => {
    const t = ownTopic ?? (chunkId ? concepts.get(chunkId)?.find(x => x.trim()) : undefined);
    return t ? { topic: t.trim(), topicSource: "topic" as const } : { topic: title.get(materialId) ?? null, topicSource: "material" as const };
  };
  const levelOf = (q: { level: string | null; difficulty: number | null }): MasteryLevel =>
    isCognitiveLevel(q.level) ? q.level : q.difficulty !== null && DIFFICULTY_LEVEL[q.difficulty] ? DIFFICULTY_LEVEL[q.difficulty] : "unknown";
  const competencyOf = (q: { chunkId: string; competencyId: string | null }) => (q.competencyId && accepted.has(`${q.chunkId}|${q.competencyId}`) ? q.competencyId : null);

  const evidence: MasteryEvidence[] = [];
  for (const a of attempts) {
    const q = qById.get(a.questionId);
    if (!q) continue;
    evidence.push({
      itemId: q.id, ...placeOf(q.materialId, q.chunkId, q.topic), competencyId: competencyOf(q), materialId: q.materialId, chunkId: q.chunkId,
      kind: "question", level: levelOf(q), at: a.answeredAt, marking: MARKING[a.marking] ?? "code",
      ...(a.score !== null ? { score: a.score } : { correct: !!a.correct }),
    });
  }
  for (const r of reviews) {
    const q = qById.get(cardQ.get(r.cardId) ?? "");
    if (!q) continue;
    evidence.push({
      itemId: q.id, ...placeOf(q.materialId, q.chunkId, q.topic), competencyId: competencyOf(q), materialId: q.materialId, chunkId: q.chunkId,
      kind: "review", level: levelOf(q), correct: r.quality >= 3, at: r.reviewedAt, marking: "self",
    });
  }
  const stationById = new Map(stations.map(s => [s.id, s]));
  for (const r of osce) {
    const s = stationById.get(r.stationId);
    if (!s?.materialId) continue;
    evidence.push({
      itemId: `osce:${s.id}`, ...placeOf(s.materialId, s.chunkId, null), competencyId: s.competencyId, materialId: s.materialId, chunkId: s.chunkId,
      kind: "osce", level: "unknown", score: Math.max(0, Math.min(1, r.score)), at: r.at, marking: r.marking === "ai_evaluation" ? "ai_evaluation" : "self",
    });
  }

  const today = now.slice(0, 10);
  const dueByMaterial = new Map<string, number>();
  for (const c of cards) if (c.status === "active" && c.nextReviewAt <= today) dueByMaterial.set(c.materialId, (dueByMaterial.get(c.materialId) ?? 0) + 1);

  const programme = new Map((o.competencies ?? []).map(c => [c.id, c.title]));
  const firstTopic = (chunkId: string) => concepts.get(chunkId)?.find(x => x.trim())?.trim() ?? null;
  const mappedSections = (o.linked?.mappings ?? []).filter(m => m.state === "accepted" && programme.has(m.competencyId)).map(m => ({
    chunkId: m.chunkId, materialId: m.materialId, label: firstTopic(m.chunkId) ?? `a section of ${title.get(m.materialId) ?? "your notes"}`,
    competencyId: m.competencyId, competencyTitle: programme.get(m.competencyId)!,
  }));
  const matOfChunk = new Map((o.linked?.mappings ?? []).map(m => [m.chunkId, m.materialId]));

  const knownTopics: { topic: string; materialId: string; chunkId: string | null }[] = [];
  for (const [chunkId, ts] of concepts) {
    const mat = matOfChunk.get(chunkId) ?? questions.find(q => q.chunkId === chunkId)?.materialId;
    const t = ts.find(x => x.trim());
    if (mat && t) knownTopics.push({ topic: t.trim(), materialId: mat, chunkId });
  }

  return {
    ok: true,
    data: buildMastery({
      evidence, now, competencies: o.competencies ?? [], knownTopics, mappedSections,
      dueCards: [...dueByMaterial.entries()].map(([materialId, due]) => ({ materialId, materialTitle: title.get(materialId) ?? "your notes", due })),
      studyId: o.studyId ?? null, truncated,
      thresholds: {
        securePercent: policy.scholarEvaluationBandStrong, developingPercent: Math.min(policy.scholarEvaluationBandDeveloping, policy.scholarEvaluationBandStrong - 1),
        windowDays: MASTERY_WINDOW_DAYS, maxRecommendations: 5,
      },
    }),
  };
}
