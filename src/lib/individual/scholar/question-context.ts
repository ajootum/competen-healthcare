/* eslint-disable @typescript-eslint/no-explicit-any */
// ── WHAT A GENERATOR IS TOLD, READ FROM THE STUDENT'S OWN ROWS ── SCHOLAR-QUESTION-INTELLIGENCE-01 ────────────────
//
// The I/O half of question-intel.ts generationContextBlock, on reads Scholar already has: the section's topics
// (store.ts topicsOfSections -- the student's correction first), its competency links as governed references
// (learn.ts governedReferences, accepted first, labelled by the reference source exactly as Learn labels them), and
// the learner's programme and level (catalogue + 402 history, as the tutor's context reads them). No new table, no
// memory store, nothing written. Anything unreadable is simply absent: questions are written from the passage
// either way.
//
// ⚠ REFERENCES ONLY IN MODE notes_and_references, AND ONLY CLINICALLY APPROVED ONES. In mode "notes" the competency
// steers what is tested and is never grounding. In mode "notes_and_references" a reference is offered to the
// generator only when its current content is approved (learn.ts referenceStatus) -- so "approved references" on the
// label is true -- and an item records the ids of the references it cited. None approved: the mode is notes.

import type { IndividualPolicy } from "../policy";
import { loadLearnerCatalogue } from "./competency-view";
import { contextHistory } from "./context";
import { governedReferences, referenceSource } from "./learn";
import { levelWords as spellLevel } from "./learner-context";
import { topicsOfSections } from "./store";
import { levelDefaultDifficulty, type GenerationContext, type GenerationDifficulty, type PromptReference, type SourceMode } from "./question-intel";

export type GenerationContextLoader = {
  /** The context for one section, with the difficulty and mode asked for. */
  forSection: (chunkId: string, ask: { difficulty: GenerationDifficulty | null; mode: SourceMode }) => Promise<GenerationContext>;
  /** The difficulty the programme level suggests (a default only), or null. */
  levelDefault: GenerationDifficulty | null;
};

/** One loader per request: the programme, catalogue and level are read once, the section's rows per section. */
export async function generationContextLoader(admin: any, userId: string, policy: Pick<IndividualPolicy, "scholarReferenceCollections" | "scholarCatalogueMinStatus">): Promise<GenerationContextLoader> {
  let learner: Awaited<ReturnType<typeof loadLearnerCatalogue>> | null = null;
  let level: string | null = null;
  try {
    learner = await loadLearnerCatalogue(admin, userId);
    const history = learner.provisioned ? await contextHistory(admin, userId) : null;
    level = history?.ok ? history.periods.find(p => p.effectiveTo === null)?.levelLabel ?? null : null;
  } catch { learner = null; }
  const programme = learner?.programme?.label ?? null;
  // "Year 2" survives the words-only rule as "Year two" (learner-context.ts levelWords).
  const levelWords = [programme, level ? spellLevel(level) : null].filter(Boolean).join(", ") || null;
  let source: Awaited<ReturnType<typeof referenceSource>> | null = null;
  return {
    levelDefault: levelDefaultDifficulty(programme, level),
    async forSection(chunkId, ask) {
      try {
        source = source ?? await referenceSource(admin, policy, learner?.competencies ?? null);
        const [topics, refs] = await Promise.all([topicsOfSections(admin, userId, [chunkId]), governedReferences(admin, userId, [chunkId], source, 3)]);
        const lead = refs[0] ?? null;
        const approved: PromptReference[] = ask.mode === "notes_and_references"
          ? refs.filter(r => r.approved && r.competencyId).map((r, i) => ({ tag: `L${i + 1}`, id: r.competencyId!, title: r.title, outcome: r.outcome }))
          : [];
        return {
          concepts: topics.get(chunkId) ?? [], competency: lead ? { title: lead.title, outcome: lead.outcome } : null, level: levelWords,
          difficulty: ask.difficulty, mode: approved.length ? "notes_and_references" : "notes", references: approved,
        };
      } catch {
        return { concepts: [], competency: null, level: levelWords, difficulty: ask.difficulty, mode: "notes", references: [] };
      }
    },
  };
}
