// ── SCHOLAR-COMPANION-01 P1: WRITING CLOZE ITEMS ── a rule over the learner's own notes, stored as existing `short` rows ──
//
// No model, no allowance, no consent gate: nothing here leaves the server or reads anything but the learner's own
// sections. Every query goes through store.ts (the scholar-learning harness's rule A1); the picking is cloze.ts (pure).
// The rows are private formative `short` questions with answer.format 'cloze', model and provider 'rule', prompt_version
// 'cloze:v1' and the original sentence as the source quote (migrations 416, 710, 730: all CHECKs accept this exactly).

import { findPatientIdentifiers } from "./extract";
import { clozeDraft, clozeNorm, CLOZE_MODEL, CLOZE_PROMPT_VERSION, CLOZE_PROVIDER, isClozeQuestion, pickClozeItems, termsFromQuestions } from "./cloze";
import { getPassage, insertRevisionQuestions, topicsOfSections, type Admin, type QuestionRow } from "./store";

/** Sections read for one request, and the most items taken from one section: the pass is bounded in both. */
const SECTIONS_MAX = 30;
const PER_SECTION = 3;

/**
 * Writes up to `need` cloze items across the given sections (round-robin, a few from each), skipping any sentence whose
 * blanked stem is already stored. Returns how many were written. A section that yields nothing costs nothing.
 */
export async function writeClozeItems(admin: Admin, userId: string, input: { chunkIds: readonly string[]; questions: readonly QuestionRow[]; need: number }): Promise<{ written: number; ids: string[] }> {
  const chunkIds = input.chunkIds.slice(0, SECTIONS_MAX);
  if (!chunkIds.length || input.need <= 0) return { written: 0, ids: [] };
  const topics = await topicsOfSections(admin, userId, chunkIds);
  const existing = new Set(input.questions.filter(isClozeQuestion).map(q => clozeNorm(q.stem)));
  const ids: string[] = [];
  for (let round = 0; round < PER_SECTION && ids.length < input.need; round++) {
    for (const chunkId of chunkIds) {
      if (ids.length >= input.need) break;
      const passage = await getPassage(admin, userId, chunkId);
      if (!passage) continue;
      const terms = [...(topics.get(chunkId) ?? []), ...termsFromQuestions(input.questions.filter(q => q.chunkId === chunkId))];
      // One item per section per round: the next round picks the next term, the stems already written being skipped.
      const items = pickClozeItems({ text: passage.content, terms, max: 1, existing, reject: s => findPatientIdentifiers(s).length > 0 });
      if (!items.length) continue;
      const saved = await insertRevisionQuestions(admin, userId, {
        passage, kind: "short", drafts: items.map(clozeDraft), model: CLOZE_MODEL, provider: CLOZE_PROVIDER, promptVersion: CLOZE_PROMPT_VERSION,
      });
      if (!saved.ok) return { written: ids.length, ids };
      for (const i of items) existing.add(clozeNorm(i.stem));
      ids.push(...saved.ids);
    }
  }
  return { written: ids.length, ids };
}
