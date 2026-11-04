import { realMisconceptions } from "./learning-need";
import type { NoteAnchor } from "./notebook-practice";
export * from "./notebook-practice";

// ── SALE-2026-11 R3 / SALE-12: THE ACTIVE NOTEBOOK (pure) ──────────────────────────────────────────────────────────────────
//
// The Notebook is a view of the Personal Learning Library (820), not a second store. These pure helpers turn records the learner
// already has into the Notebook's parts:
//   - pastMisconceptions   the misconceptions named on their own kept lesson checks (950 + R1 response.adaptive / the judgement's
//                          misconceptions part), grouped by wording, newest first, each with the way back to its lesson and question
//   - relatedFor           for one note: the learner's own saved lessons on the same sections, other sections of their materials that
//                          share a topic, and their other notes on the same material. Deterministic, never AI, never other learners
//   - practiceScopes       selected notes -> the sections they are attached to, one scope per material, for the existing Revise
//                          builder (study/revise?material=&sections=). Practice is generated there, by the existing SQIE routes
//   - notebook context     the `nb` parameter that lets a lesson, a revision or a question page offer "Back to your Notebook"
// Nothing here is an assessment, and nothing leaves the learner.

export const NOTEBOOK_KINDS = ["note", "highlight", "summary"] as const;
export const RELATED_MAX = 5;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ── past misconceptions ──

export type KeptCheckInput = {
  attemptId: string; questionId: string; question: string; at: string; sessionId: string | null; step: number | null; materialId: string; chunkId: string;
  outcome: "right" | "partly" | "wrong" | null;
  /** R1's decision on the answer (its misconception), and the judgement's own misconceptions part. */
  adaptiveMisconception: string | null; feedbackMisconceptions: readonly string[];
};
export type PastMisconception = {
  text: string;
  /** How many different questions it came up on, and when last. */
  questions: number; lastAt: string;
  /** A later answer in the same lesson was right: shown as "since answered well", never hidden (the learner may still revisit it). */
  answeredWellSince: boolean;
  /** The newest answer it came from. */
  latest: { attemptId: string; questionId: string; question: string; sessionId: string | null; step: number | null; materialId: string; chunkId: string };
};

/** Pure. The misconceptions in the learner's own kept checks (wrong or partly right only), grouped by wording, newest first. */
export function pastMisconceptions(checks: readonly KeptCheckInput[], max = 20): PastMisconception[] {
  const groups = new Map<string, { text: string; items: KeptCheckInput[] }>();
  for (const c of checks) {
    if (c.outcome !== "wrong" && c.outcome !== "partly") continue;
    const named = realMisconceptions([...(c.adaptiveMisconception ? [c.adaptiveMisconception] : []), ...c.feedbackMisconceptions]);
    const seen = new Set<string>();
    for (const m of named) {
      const k = norm(m);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const g = groups.get(k) ?? { text: clip(m, 240), items: [] };
      g.items.push(c);
      groups.set(k, g);
    }
  }
  const out: PastMisconception[] = [];
  for (const g of groups.values()) {
    const items = [...g.items].sort((a, b) => b.at.localeCompare(a.at) || a.attemptId.localeCompare(b.attemptId));
    const l = items[0];
    const since = checks.some(c => c.outcome === "right" && c.at > l.at && c.sessionId !== null && c.sessionId === l.sessionId && c.step === l.step);
    out.push({
      text: g.text, questions: new Set(items.map(i => i.questionId)).size, lastAt: l.at, answeredWellSince: since,
      latest: { attemptId: l.attemptId, questionId: l.questionId, question: l.question, sessionId: l.sessionId, step: l.step, materialId: l.materialId, chunkId: l.chunkId },
    });
  }
  return out.sort((a, b) => Number(a.answeredWellSince) - Number(b.answeredWellSince) || b.lastAt.localeCompare(a.lastAt) || a.text.localeCompare(b.text)).slice(0, max);
}

// ── related materials ──

export type LibraryIndex = {
  /** Every analysed section of the learner's materials and its topics (their correction where they made one). */
  sections: readonly { chunkId: string; materialId: string; topics: readonly string[] }[];
  /** Their current saved lessons and the sections each was taught from. */
  artefacts: readonly { id: string; materialId: string; sources: readonly string[]; title: string }[];
  /** Their notebook entries. */
  notes: readonly NoteAnchor[];
  materialTitle: ReadonlyMap<string, string>;
};
export type RelatedItem =
  | { kind: "saved_lesson"; id: string; title: string; why: string }
  | { kind: "section"; materialId: string; chunkId: string; title: string; why: string }
  | { kind: "note"; id: string; title: string; why: string };

/** Pure. Up to RELATED_MAX related items for one note, strongest link first, never the note itself. */
export function relatedFor(note: NoteAnchor, idx: LibraryIndex, max = RELATED_MAX): RelatedItem[] {
  const out: RelatedItem[] = [];
  const own = new Set(note.chunkIds);
  const topicsOf = new Map(idx.sections.map(s => [s.chunkId, s.topics]));
  const myTopics = new Map<string, string>();
  for (const c of note.chunkIds) for (const t of topicsOf.get(c) ?? []) if (norm(t)) myTopics.set(norm(t), t);
  // 1. saved lessons taught from the same sections
  for (const a of [...idx.artefacts].sort((x, y) => x.id.localeCompare(y.id))) {
    if (a.sources.some(s => own.has(s))) out.push({ kind: "saved_lesson", id: a.id, title: a.title, why: "Taught from the same section" });
  }
  // 2. other sections that share a topic (other materials first: that is what "related material" adds)
  const shared = idx.sections.filter(s => !own.has(s.chunkId)).map(s => ({ s, t: s.topics.find(t => myTopics.has(norm(t))) })).filter(x => !!x.t)
    .sort((a, b) => Number(a.s.materialId === note.materialId) - Number(b.s.materialId === note.materialId) || a.s.chunkId.localeCompare(b.s.chunkId));
  const perMaterial = new Map<string, number>();
  for (const { s, t } of shared) {
    const n = perMaterial.get(s.materialId) ?? 0;
    if (n >= 2) continue;
    perMaterial.set(s.materialId, n + 1);
    out.push({ kind: "section", materialId: s.materialId, chunkId: s.chunkId, title: idx.materialTitle.get(s.materialId) ?? "Your material", why: `Also about ${t}` });
  }
  // 3. their other notes on the same sections, then the same material
  for (const n of [...idx.notes].sort((x, y) => x.id.localeCompare(y.id))) {
    if (n.id === note.id) continue;
    if (n.chunkIds.some(c => own.has(c))) out.push({ kind: "note", id: n.id, title: "Your note", why: "On the same section" });
  }
  for (const n of [...idx.notes].sort((x, y) => x.id.localeCompare(y.id))) {
    if (n.id === note.id || n.chunkIds.some(c => own.has(c))) continue;
    if (note.materialId && n.materialId === note.materialId) out.push({ kind: "note", id: n.id, title: "Your note", why: `Also on ${idx.materialTitle.get(n.materialId) ?? "this material"}` });
  }
  const seen = new Set<string>();
  return out.filter(r => { const k = `${r.kind}:${"id" in r ? r.id : r.chunkId}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, max);
}
