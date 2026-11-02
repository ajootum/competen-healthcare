// ── THE PERSONAL AI PAGE'S CONTINUITY ── SCHOLAR-CE-2026 CE-01 ───────────────────────────────────────────────────────
//
// /assistant?study=<id>&material=<id>&section=<id>: where a learner arrives from their study (a link that carries their place).
// Resolved ONCE on the server, by database reads keyed on the caller (no AI):
//   study    the caller's own connected study session (study-context.ts loadStudy: policy on, 740 present, the caller's own, else null)
//            -> its focus title and the sections of its steps (at most six)
//   section  one of the caller's own sections (store.getPassage) -> that section alone, and its material
//   material only narrows `section` (a section of another material is ignored). Alone it names no section and so grounds nothing: it is
//            ignored, so the chip never claims notes the answer does not use.
// Anything that is not the caller's own is ignored without a word (no disclosure that the id exists): the page then behaves as today.
// Nothing is stored; the result is what the panel's chip shows and what its questions are grounded on.

import { loadStudy } from "./study-context";
import { getPassage, isUuid } from "./store";
import { ASK_CHUNK_MAX } from "./ask-context";

export type AskLink = { studyId: string | null; materialId: string | null; chunkIds: string[]; focus: string };

const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);

export async function resolveAskLink(admin: unknown, userId: string, q: { study?: unknown; material?: unknown; section?: unknown }): Promise<AskLink | null> {
  try {
    const study = await loadStudy(admin, userId, first(q.study), null);
    const sectionId = first(q.section), materialId = first(q.material);
    const passage = isUuid(sectionId) ? await getPassage(admin, userId, sectionId) : null;
    // A section of another material than the one named is not the place the link meant.
    const section = passage && (!isUuid(materialId) || passage.materialId === materialId) ? passage : null;
    if (study) {
      return {
        studyId: study.session.id, materialId: section?.materialId ?? study.scope.materialIds[0] ?? null,
        chunkIds: section ? [section.chunkId] : study.scope.chunkIds.slice(0, ASK_CHUNK_MAX), focus: study.bar.title,
      };
    }
    return section ? { studyId: null, materialId: section.materialId, chunkIds: [section.chunkId], focus: section.materialTitle } : null;
  } catch { return null; }
}
