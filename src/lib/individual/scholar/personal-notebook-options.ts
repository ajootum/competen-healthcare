import { loadLearnerCatalogue } from "./competency-view";
import { displaySessionTitle } from "./learn-search";
import { listLearningSessions, listMaterials, sectionTopicRows, type Admin } from "./store";

// COMPETEN-NOTEBOOK-001 P1: what a note may be linked to, offered only after writing starts. The learner's own materials and sessions, and the
// competencies of their own framework. Reads only. Sections are read when a material is chosen.

export async function noteLinkOptions(admin: Admin, userId: string) {
  const [materials, sessions, catalogue, topicRows] = await Promise.all([listMaterials(admin, userId), listLearningSessions(admin, userId, 50), loadLearnerCatalogue(admin, userId), sectionTopicRows(admin, userId).catch(() => null)]);
  // The topics of their own sections and sessions, most common first, offered to choose from. They may also type their own.
  const count = new Map<string, number>();
  for (const r of topicRows?.ok ? topicRows.data : []) for (const t of r.topics) count.set(t, (count.get(t) ?? 0) + 1);
  for (const s of sessions.ok ? sessions.data : []) if (s.topic) count.set(s.topic, (count.get(s.topic) ?? 0) + 1);
  return {
    materials: (materials.ok ? materials.data : []).map(m => ({ id: m.id, title: m.title })),
    lessons: (sessions.ok ? sessions.data : []).map(s => ({ id: s.id, title: displaySessionTitle(s.title), connected: true })),
    topics: [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t).filter(t => t.length >= 2 && t.length <= 120).slice(0, 200),
    competencies: catalogue.competencies ? catalogue.competencies.map(c => ({ id: c.id, title: c.title })) : null,
  };
}
