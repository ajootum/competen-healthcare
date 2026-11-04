// ── SALE-2026-11 R2 / SALE-09: A FOCUSED PREREQUISITE REVIEW, ONLY WHERE IT IS JUSTIFIED ── pure, client-safe, NO AI ─────────────
//
// Uses only what is already approved and accepted:
//   * the PREREQUISITE links of the published framework: Holdings-scope competency_dependencies (dependency_type prerequisite),
//     read by the shared foundation (competency/foundation.ts links.prerequisites) and narrowed to the learner's offered
//     catalogue (catalogue.ts projectForProgramme). A link to a competency outside that catalogue is not used;
//   * the learner's ACCEPTED section-to-competency links (388, a proposal alone never counts);
//   * their own answers (learning-state.ts StateEvidence).
//
// THE RULES (first that holds wins; the id is kept with the suggestion):
//   P0 no difficulty     fewer than `misses` DIFFERENT questions on the topic whose latest answer was not right: nothing to explain.
//   P1 misconception     a misconception repeated on different questions explains the difficulty better: correct that first
//                        (R1's Explain my mistake), no prerequisite suggested. Most difficulty is NOT a missing foundation.
//   P2 no framework link none of the topic's accepted competencies has a prerequisite in the learner's catalogue: no suggestion here.
//                        In a lesson, R1's rule still applies (the earlier lesson of the session, learning-need.ts N3/T5).
//   P3 foundation shown  the learner's answers on their notes for the prerequisite already show it (at least `distinctQuestions`
//                        different questions answered well, the latest right): the foundation is not the gap, no suggestion.
//   P4 suggest           a short review of the learner's OWN notes linked to the prerequisite (the section with the least
//                        evidence first), or -- where none of their notes is linked to it -- learning that topic by name.
//
// ⚠ A SUGGESTION THE LEARNER CHOOSES. Nothing is added to a plan. Never a diagnosis, never competence.

import { realMisconceptions } from "./learning-need";
import { sameMisconception } from "./misconception";
import type { StateEvidence } from "./learning-state";

export type PrerequisiteThresholds = { misses: number; distinctQuestions: number };
export const DEFAULT_PREREQUISITE_THRESHOLDS: PrerequisiteThresholds = { misses: 3, distinctQuestions: 2 };

/** A competency of the learner's offered catalogue, with its prerequisite ids (only those also in the catalogue count). */
export type CatalogueNode = { id: string; title: string; framework: string; prerequisites: readonly string[] };
/** One of the learner's sections ACCEPTED-linked to a competency. */
export type LinkedSection = { chunkId: string; materialId: string; competencyId: string; label: string };

export type PrerequisiteSuggestion = {
  topicKey: string; topicLabel: string;
  rule: "P4";
  competency: { id: string; title: string };
  prerequisite: { id: string; title: string; framework: string };
  /** The learner's own notes on the prerequisite, or null where none of their notes is linked to it. */
  section: { chunkId: string; materialId: string; label: string } | null;
  reason: string;
  evidence: string[];
};
export type PrerequisiteDecision =
  | { kind: "suggest"; suggestion: PrerequisiteSuggestion }
  | { kind: "none"; rule: "P0" | "P1" | "P2" | "P3"; reason: string };

const marked = (e: StateEvidence) => e.outcome !== null && e.marking !== "unmarked";
const right = (e: StateEvidence) => e.outcome !== null && e.outcome >= 0.75;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pure. Latest marked answer per item: the distinct items not answered well, and those answered well. */
export function latestByItem(rows: readonly StateEvidence[]): { missed: string[]; right: string[]; latestRight: boolean | null } {
  const latest = new Map<string, StateEvidence>();
  let newest: StateEvidence | null = null;
  for (const r of rows) if (marked(r)) {
    const l = latest.get(r.itemId);
    if (!l || r.at > l.at) latest.set(r.itemId, r);
    if (!newest || r.at > newest.at) newest = r;
  }
  const xs = [...latest.values()];
  return { missed: xs.filter(x => !right(x)).map(x => x.itemId), right: xs.filter(right).map(x => x.itemId), latestRight: newest ? right(newest) : null };
}

/** Pure. The misconception named on two or more DIFFERENT missed questions, or null. */
export function repeatedNamed(rows: readonly StateEvidence[]): string | null {
  const groups: { tag: string; items: Set<string> }[] = [];
  for (const r of rows) if (marked(r) && !right(r)) for (const m of realMisconceptions(r.misconceptions)) {
    const g = groups.find(x => sameMisconception(x.tag, m));
    if (g) g.items.add(r.itemId); else groups.push({ tag: m, items: new Set([r.itemId]) });
  }
  return groups.find(g => g.items.size >= 2)?.tag ?? null;
}

/**
 * Pure. SALE-09 for one topic. `topicCompetencies`: the competencies the topic's sections are ACCEPTED-linked to.
 * `evidenceByChunk`: the learner's answers by section (to judge the prerequisite's own notes, P3).
 */
export function decidePrerequisite(input: {
  topic: { key: string; label: string; chunkIds: readonly string[] };
  rows: readonly StateEvidence[];
  topicCompetencies: readonly string[];
  catalogue: ReadonlyMap<string, CatalogueNode>;
  sections: readonly LinkedSection[];
  evidenceByChunk: ReadonlyMap<string, readonly StateEvidence[]>;
  thresholds?: Partial<PrerequisiteThresholds>;
}): PrerequisiteDecision {
  const T = { ...DEFAULT_PREREQUISITE_THRESHOLDS, ...input.thresholds };
  const own = latestByItem(input.rows);
  if (own.missed.length < Math.max(2, T.misses))
    return { kind: "none", rule: "P0", reason: `${plural(own.missed.length, "different question")} on this topic not answered well yet: not enough difficulty to point to a missing foundation.` };
  const mis = repeatedNamed(input.rows);
  if (mis) return { kind: "none", rule: "P1", reason: `A misconception ("${mis.length > 80 ? `${mis.slice(0, 79)}…` : mis}") came up on different questions: correcting it is the better next step than going back to a foundation.` };

  return frameworkPrerequisite({ topic: input.topic, missed: own.missed.length, topicCompetencies: input.topicCompetencies, catalogue: input.catalogue, sections: input.sections, evidenceByChunk: input.evidenceByChunk, thresholds: T });
}

/**
 * Pure. P2-P4 alone: the framework prerequisite to review for a topic (or a lesson's sections) the learner is already known to struggle
 * with (`missed` different questions). Also used by the lesson's next step (learning-need-service.ts) once R1's rule N3 found a
 * possible missing foundation, so a framework prerequisite can stand in for, or add to, "the earlier lesson".
 */
export function frameworkPrerequisite(input: {
  topic: { key: string; label: string; chunkIds: readonly string[] };
  missed: number;
  topicCompetencies: readonly string[];
  catalogue: ReadonlyMap<string, CatalogueNode>;
  sections: readonly LinkedSection[];
  evidenceByChunk: ReadonlyMap<string, readonly StateEvidence[]>;
  thresholds?: Partial<PrerequisiteThresholds>;
}): PrerequisiteDecision {
  const T = { ...DEFAULT_PREREQUISITE_THRESHOLDS, ...input.thresholds };
  const here = new Set(input.topic.chunkIds);
  const pairs: { c: CatalogueNode; p: CatalogueNode }[] = [];
  for (const id of input.topicCompetencies) {
    const c = input.catalogue.get(id);
    if (!c) continue;
    for (const pid of c.prerequisites) { const p = input.catalogue.get(pid); if (p && p.id !== c.id && !pairs.some(x => x.p.id === p.id)) pairs.push({ c, p }); }
  }
  if (!pairs.length) return { kind: "none", rule: "P2", reason: "No prerequisite is recorded in your framework for the competencies this topic is linked to." };

  let shown: string | null = null;
  for (const { c, p } of pairs) {
    const notes = input.sections.filter(s => s.competencyId === p.id && !here.has(s.chunkId));
    const evidence = notes.flatMap(s => input.evidenceByChunk.get(s.chunkId) ?? []);
    const prior = latestByItem(evidence);
    if (prior.right.length >= T.distinctQuestions && prior.latestRight) { shown = p.title; continue; }
    // The section with the least evidence of being understood first, then the order given.
    const ranked = notes.map((s, i) => ({ s, i, ok: latestByItem(input.evidenceByChunk.get(s.chunkId) ?? []).right.length })).sort((a, b) => a.ok - b.ok || a.i - b.i);
    const section = ranked[0]?.s ?? null;
    const ev = [
      `${plural(input.missed, "different question")} on ${input.topic.label} not answered well yet.`,
      `In ${p.framework}, "${p.title}" is a prerequisite of "${c.title}", which your notes on this topic are linked to.`,
      section ? (prior.right.length ? `Your answers on your notes for it show ${plural(prior.right.length, "question")} answered well, not yet enough to rule it out.` : "You have no answers on your notes for it yet.")
        : "None of your notes is linked to it yet.",
    ];
    return {
      kind: "suggest",
      suggestion: {
        topicKey: input.topic.key, topicLabel: input.topic.label, rule: "P4",
        competency: { id: c.id, title: c.title }, prerequisite: { id: p.id, title: p.title, framework: p.framework },
        section: section ? { chunkId: section.chunkId, materialId: section.materialId, label: section.label } : null,
        reason: section
          ? `Several different questions on ${input.topic.label} were not answered well, and your framework lists "${p.title}" as coming first. A short review of your notes on it may help before going on.`
          : `Several different questions on ${input.topic.label} were not answered well, and your framework lists "${p.title}" as coming first. None of your notes covers it yet: a short lesson on it may help.`,
        evidence: ev,
      },
    };
  }
  return { kind: "none", rule: "P3", reason: `Your answers already show "${shown}", the prerequisite your framework lists, so the difficulty is likely elsewhere.` };
}
