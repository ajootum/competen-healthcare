// ── LEARNING-CLOSE-2026-11 D03 / LE-03: RE-CUTTING THE LESSONS OF A LEARN SESSION ────────────────────────────────────
//
// Pure, client-safe, no AI. A Learn session is a list of lessons, each a run of the learner's own sections. The learner
// may merge a lesson with the next, split one before a section, and name one. The sections are never changed: a re-cut
// is the SAME sections regrouped, nothing added or dropped (parseRecutRequest refuses anything else). What is saved
// hangs off the sections (questions, flashcards, attempts, citations, saved explanations, section notes), so a re-cut
// moves none of it. The three things that name a lesson number -- learning events, the learning position, lesson notes
// and lesson-linked artefacts -- are re-pointed by migration 955's function, in one transaction, by old-lesson
// containment: a new lesson wholly inside an old one keeps the old lesson's record, and a lesson made larger than any
// old lesson starts with none (the learner has not been taught it as one lesson). Never assessment evidence.

export const RECUT_TITLE_MAX = 120;
export const RECUT_MAX_LESSONS = 200;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RecutSection = { chunkId: string; citation: string };
/** One lesson as the re-cut panel holds it: the learner's own name (null: the name Scholar reads from the notes), the name read, its sections. */
export type RecutLesson = { title: string | null; outline: string; sections: RecutSection[] };
export type RecutBody = { steps: string[][]; titles: (string | null)[] };

/** Pure. A clean lesson title: whitespace collapsed, at most RECUT_TITLE_MAX characters, empty becomes null. */
export function cleanTitle(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim().slice(0, RECUT_TITLE_MAX).trim();
  return t || null;
}

/** Pure. The stored lesson titles (955 lesson_titles) as an array of one text or null per lesson, or null where there are none or the shape is wrong. */
export function parseLessonTitles(v: unknown, lessons: number): (string | null)[] | null {
  if (!Array.isArray(v) || v.length !== lessons) return null;
  const out = v.map(cleanTitle);
  return out.some(t => t !== null) ? out : null;
}

/** Pure. The lessons of a session view as the panel edits them. */
export function lessonsFromView(steps: readonly { title: string; sections: readonly { chunkId: string; citation: string }[] }[], titles: readonly (string | null)[] | null | undefined): RecutLesson[] {
  return steps.map((s, i) => ({ title: titles?.[i] ?? null, outline: s.title, sections: s.sections.map(x => ({ chunkId: x.chunkId, citation: x.citation })) }));
}

/** Pure. Lesson `index` and the one after it become one lesson. A name on either is kept (the first wins). */
export function mergeLessons(ls: readonly RecutLesson[], index: number): RecutLesson[] {
  if (index < 0 || index >= ls.length - 1) return [...ls];
  const a = ls[index], b = ls[index + 1];
  const merged: RecutLesson = { title: a.title ?? b.title, outline: a.outline, sections: [...a.sections, ...b.sections] };
  return [...ls.slice(0, index), merged, ...ls.slice(index + 2)];
}

/** Pure. Lesson `index` becomes two: the sections before `before` (an index into its sections) and the rest. The first keeps the name. */
export function splitLesson(ls: readonly RecutLesson[], index: number, before: number): RecutLesson[] {
  const u = ls[index];
  if (!u || before < 1 || before >= u.sections.length) return [...ls];
  const head: RecutLesson = { ...u, sections: u.sections.slice(0, before) };
  const tail: RecutLesson = { title: null, outline: u.outline, sections: u.sections.slice(before) };
  return [...ls.slice(0, index), head, tail, ...ls.slice(index + 1)];
}

/** Pure. Lesson `index` takes the learner's name (empty: back to the name read from the notes). */
export function renameLesson(ls: readonly RecutLesson[], index: number, title: string): RecutLesson[] {
  return ls.map((l, i) => (i === index ? { ...l, title: cleanTitle(title) } : l));
}

/** Pure. What the panel sends: each lesson's section ids, and one name or null per lesson. */
export function recutBody(ls: readonly RecutLesson[]): RecutBody {
  return { steps: ls.map(l => l.sections.map(s => s.chunkId)), titles: ls.map(l => l.title) };
}

/** Pure. Whether a body changes nothing against the session as it is. */
export function sameCut(body: RecutBody, current: readonly { sections: readonly { chunkId: string }[] }[], titles: readonly (string | null)[] | null | undefined): boolean {
  if (body.steps.length !== current.length) return false;
  for (let i = 0; i < current.length; i++) {
    const a = body.steps[i], b = current[i].sections.map(s => s.chunkId);
    if (a.length !== b.length || a.some((c, k) => c !== b[k])) return false;
    if ((body.titles[i] ?? null) !== (titles?.[i] ?? null)) return false;
  }
  return true;
}

/**
 * Pure. A lesson's sections in a few words: each material once, its slides / pages / sections as ranges
 * ("Essential Nursing Care, slides 14-23, 25 · Notes, pages 3-4"). A citation that does not end in "<unit> <n>" is listed as is.
 */
export function citationSummary(sections: readonly { citation: string }[]): string {
  const groups = new Map<string, { unit: string | null; nums: number[]; raw: string[] }>();
  for (const s of sections) {
    const m = /^(.*),\s*(slide|page|section)s?\s+(\d+)(?:\s*[-–]\s*\d+)?$/i.exec(s.citation.trim());
    const key = m ? m[1] : s.citation;
    const g = groups.get(key) ?? { unit: null, nums: [], raw: [] };
    if (m) { g.unit = m[2].toLowerCase(); g.nums.push(Number(m[3])); } else g.raw.push(s.citation);
    groups.set(key, g);
  }
  const ranges = (nums: number[]) => {
    const out: string[] = [];
    for (const n of [...new Set(nums)].sort((a, b) => a - b)) {
      const last = out[out.length - 1];
      const m = last ? /^(\d+)(?:-(\d+))?$/.exec(last) : null;
      const end = m ? Number(m[2] ?? m[1]) : null;
      if (m && end === n - 1) out[out.length - 1] = `${m[1]}-${n}`; else out.push(String(n));
    }
    return out.join(", ");
  };
  return [...groups.entries()].map(([key, g]) => {
    if (!g.unit) return g.raw.join(" · ");
    const word = g.nums.length === 1 ? g.unit : `${g.unit}s`;
    return `${key}, ${word} ${ranges(g.nums)}${g.raw.length ? ` · ${g.raw.join(" · ")}` : ""}`;
  }).join(" · ");
}

export type RecutParse = { ok: true; value: RecutBody } | { ok: false; error: string };

/**
 * Pure. The route's check of a re-cut request against the session's own steps: every section of the session in exactly one
 * lesson, no section from elsewhere, no empty lesson, at most RECUT_MAX_LESSONS, one name (text or null) per lesson.
 */
export function parseRecutRequest(body: unknown, current: readonly { sections: readonly { chunkId: string }[] }[]): RecutParse {
  const steps = (body as { steps?: unknown } | null)?.steps;
  if (!Array.isArray(steps) || !steps.length) return { ok: false, error: "Say which sections each lesson holds." };
  if (steps.length > RECUT_MAX_LESSONS) return { ok: false, error: `At most ${RECUT_MAX_LESSONS} lessons.` };
  const own = new Set(current.flatMap(s => s.sections.map(x => x.chunkId)));
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const s of steps) {
    if (!Array.isArray(s) || !s.length) return { ok: false, error: "A lesson needs at least one section." };
    const ids: string[] = [];
    for (const c of s) {
      if (typeof c !== "string" || !UUID.test(c)) return { ok: false, error: "A section is named by its id." };
      const id = c.toLowerCase();
      if (!own.has(id)) return { ok: false, error: "A section is not in this session. Reload the page and try again." };
      if (seen.has(id)) return { ok: false, error: "A section can be in one lesson only." };
      seen.add(id); ids.push(id);
    }
    out.push(ids);
  }
  if (seen.size !== own.size) return { ok: false, error: "Every section of the session must stay in a lesson." };
  const rawTitles = (body as { titles?: unknown }).titles;
  let titles: (string | null)[];
  if (rawTitles === undefined || rawTitles === null) titles = out.map(() => null);
  else {
    if (!Array.isArray(rawTitles) || rawTitles.length !== out.length) return { ok: false, error: "One name (or none) for each lesson." };
    if (rawTitles.some(t => t !== null && typeof t !== "string")) return { ok: false, error: "A lesson name is text." };
    titles = rawTitles.map(cleanTitle);
  }
  return { ok: true, value: { steps: out, titles } };
}
