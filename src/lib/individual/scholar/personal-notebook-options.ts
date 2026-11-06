import { loadLearnerCatalogue } from "./competency-view";
import { displaySessionTitle } from "./learn-search";
import { listLearningSessions, listMaterials, type Admin } from "./store";

// COMPETEN-NOTEBOOK-001 P1: what a note may be linked to, offered only after writing starts. The learner's own materials and sessions, and the
// competencies of their own framework. Reads only. Sections are read when a material is chosen.

export async function noteLinkOptions(admin: Admin, userId: string) {
  const [materials, sessions, catalogue] = await Promise.all([listMaterials(admin, userId), listLearningSessions(admin, userId, 50), loadLearnerCatalogue(admin, userId)]);
  return {
    materials: (materials.ok ? materials.data : []).map(m => ({ id: m.id, title: m.title })),
    lessons: (sessions.ok ? sessions.data : []).map(s => ({ id: s.id, title: displaySessionTitle(s.title), connected: true })),
    competencies: catalogue.competencies ? catalogue.competencies.map(c => ({ id: c.id, title: c.title })) : null,
  };
}
