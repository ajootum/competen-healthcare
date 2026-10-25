/* eslint-disable @typescript-eslint/no-explicit-any */
// ── REVISION-01 R2: WHAT A QUESTION PRACTISES ── its CFCA competency and learning outcome, as the student sees them ──
//
// A revision question keeps the competency of its section's leading link (388 competency_id). The learning outcome is
// the one that link names (the mapping's outcome, Stage 2). Neither is stored twice: both are read here, at feedback
// time, from the caller's own rows. A link the student has REJECTED since is not shown. Practised, never achieved:
// the page says so beside it (NOT_COMPETENCE_LABEL). Without a catalogue or a link there is nothing to show, and
// nothing is shown -- the question still works.

import { sectionLinks, type QuestionRow } from "./store";
import { competencyLabels, loadLearnerCatalogue } from "./competency-view";

export type QuestionLink = { competency: string; outcome: string | null };

/** For each question that practises a competency still linked to its section: the competency's name and its outcome. */
export async function questionLinks(admin: any, userId: string, questions: readonly Pick<QuestionRow, "id" | "chunkId" | "competencyId">[]): Promise<Map<string, QuestionLink>> {
  const linked = questions.filter(q => q.competencyId);
  const out = new Map<string, QuestionLink>();
  if (!linked.length) return out;
  const links = await sectionLinks(admin, userId, [...new Set(linked.map(q => q.chunkId))]);
  const live = linked.map(q => ({ q, l: links.find(l => l.chunkId === q.chunkId && l.competencyId === q.competencyId) })).filter(x => !!x.l);
  if (!live.length) return out;
  const labels = await competencyLabels(admin, (await loadLearnerCatalogue(admin, userId)).competencies, live.map(x => x.q.competencyId!), new Map());
  for (const { q, l } of live) {
    const c = labels.get(q.competencyId!);
    if (c) out.set(q.id, { competency: `${c.code ? `${c.code} ` : ""}${c.title}`, outcome: l!.outcome });
  }
  return out;
}
