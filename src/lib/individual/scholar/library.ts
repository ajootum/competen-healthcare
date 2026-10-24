// ── THE STUDENT'S LIBRARY ── COMPETEN-SCHOLAR-UPLOAD-01 U4 and U5 ───────────────────────────────────────
//
// Pure helpers for the cumulative knowledge base a student builds by uploading: what each material is about
// (its topics, from the topic finding already stored per section -- or the student's own correction), which
// other materials share those topics, and the checks a rename, a collection name or a topic list must pass.
// Nothing here reads the database or calls a model: the store reads, these decide, the pages show.
//
// ⚠ TOPICS ARE THE STUDENT'S NOTES' OWN WORDS. Each came from the topic finding (a concept must appear in the
// section, by the Holdings engine's rule) or from the student. Related materials are found by the SAME topic
// in two materials -- never by a guess at similarity -- so "related" always has a reason the page can show.

export const MAX_TOPICS = 12;
export const TOPIC_MAX_CHARS = 80;
export const TITLE_MAX_CHARS = 120;
export const COLLECTION_MAX_CHARS = 80;

type Ok<T> = { ok: true; value: T } | { ok: false; error: string };

/** Pure. A student's own topic list: trimmed, 2 to 80 characters each, at most 12, no repeats (by case). */
export function cleanTopics(raw: unknown): Ok<string[]> {
  if (!Array.isArray(raw)) return { ok: false, error: "Give the topics as a list." };
  const out: string[] = [];
  for (const t of raw) {
    const s = typeof t === "string" ? t.replace(/\s+/g, " ").trim() : "";
    if (!s) continue;
    if (s.length < 2 || s.length > TOPIC_MAX_CHARS) return { ok: false, error: `Each topic must be 2 to ${TOPIC_MAX_CHARS} characters.` };
    if (out.some(x => x.toLowerCase() === s.toLowerCase())) continue;
    out.push(s);
  }
  if (out.length > MAX_TOPICS) return { ok: false, error: `At most ${MAX_TOPICS} topics for one section.` };
  return { ok: true, value: out };
}

/** Pure. A material's new name: 1 to 120 characters once trimmed (migration 407's CHECK, said first here). */
export function cleanTitle(raw: unknown): Ok<string> {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!s) return { ok: false, error: "Give the material a name." };
  if (s.length > TITLE_MAX_CHARS) return { ok: false, error: `A name can be at most ${TITLE_MAX_CHARS} characters.` };
  return { ok: true, value: s };
}

/** Pure. A collection's name: 1 to 80 characters once trimmed (migration 407's CHECK). */
export function cleanCollectionName(raw: unknown): Ok<string> {
  const s = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (!s) return { ok: false, error: "Give the collection a name." };
  if (s.length > COLLECTION_MAX_CHARS) return { ok: false, error: `A collection name can be at most ${COLLECTION_MAX_CHARS} characters.` };
  return { ok: true, value: s };
}

const key = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

export type MaterialTopic = { topic: string; sections: number };

/**
 * Pure. A material's topics, most-covered first: each distinct topic (by case and punctuation) with how many of
 * its sections name it. `sectionTopics` is per section, already the student's correction where they made one.
 */
export function materialTopics(sectionTopics: readonly (readonly string[])[], limit = 12): MaterialTopic[] {
  const counts = new Map<string, { topic: string; sections: number }>();
  for (const list of sectionTopics) {
    for (const k of new Set(list.map(key).filter(Boolean))) {
      const shown = list.find(t => key(t) === k)!;
      const c = counts.get(k);
      if (c) c.sections++;
      else counts.set(k, { topic: shown, sections: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.sections - a.sections || a.topic.localeCompare(b.topic)).slice(0, limit);
}

export type RelatedMaterial = { materialId: string; title: string; shared: string[] };

/**
 * Pure. Other materials that share a topic with this one, most shared first, each with the topics it shares --
 * the reason it is related. A material with no topic in common is not related.
 */
export function relatedMaterials(
  self: { materialId: string; topics: readonly string[] },
  others: readonly { materialId: string; title: string; topics: readonly string[] }[],
  limit = 5,
): RelatedMaterial[] {
  const mine = [...new Map(self.topics.map(t => [key(t), t])).entries()];
  return others
    .filter(o => o.materialId !== self.materialId)
    // In this material's own topic order (most-covered first), so the strongest shared topic reads first.
    .map(o => { const theirs = new Set(o.topics.map(key)); return { materialId: o.materialId, title: o.title, shared: mine.filter(([k]) => theirs.has(k)).map(([, t]) => t) }; })
    .filter(o => o.shared.length > 0)
    .sort((a, b) => b.shared.length - a.shared.length || a.title.localeCompare(b.title))
    .slice(0, limit);
}
