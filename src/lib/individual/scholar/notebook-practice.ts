// SALE-2026-11 R3 / SALE-12: the Notebook's practice and context helpers. Pure and import-free, so the Notebook's client list can
// use them without pulling the server-side question modules into the browser. notebook.ts re-exports them.

/** A note as the Notebook places it: the material and the sections it is attached to. */
export type NoteAnchor = { id: string; materialId: string | null; chunkIds: readonly string[] };
/** The most sections one practice scope carries (the Revise page reads at most 24). */
export const PRACTICE_SECTIONS_MAX = 24;
/** The most notes one practice request may take. */
export const PRACTICE_NOTES_MAX = 20;

// ── practice from selected notes ──

export type PracticeScope = { materialId: string; chunkIds: string[]; notes: number };
export type PracticeResult = { scopes: PracticeScope[]; withoutSection: number };

/** Pure. The sections the selected notes are attached to, one scope per material (most notes first), each at most PRACTICE_SECTIONS_MAX sections. */
export function practiceScopes(selected: readonly NoteAnchor[]): PracticeResult {
  const by = new Map<string, { chunks: string[]; notes: number }>();
  let withoutSection = 0;
  for (const n of selected.slice(0, PRACTICE_NOTES_MAX)) {
    if (!n.materialId || !n.chunkIds.length) { withoutSection++; continue; }
    const g = by.get(n.materialId) ?? { chunks: [], notes: 0 };
    g.notes++;
    for (const c of n.chunkIds) if (!g.chunks.includes(c)) g.chunks.push(c);
    by.set(n.materialId, g);
  }
  const scopes = [...by.entries()].map(([materialId, g]) => ({ materialId, chunkIds: g.chunks.slice(0, PRACTICE_SECTIONS_MAX), notes: g.notes }))
    .sort((a, b) => b.notes - a.notes || a.materialId.localeCompare(b.materialId));
  return { scopes, withoutSection };
}

/** The Revise page, scoped to the sections (its own SCHOLAR-INDEPENDENT-LEARNING-01 preset), carrying the Notebook context. Path under the experience. */
export const practicePath = (s: PracticeScope, back: string) =>
  `study/revise?material=${encodeURIComponent(s.materialId)}&sections=${s.chunkIds.map(encodeURIComponent).join(",")}&nb=${encodeURIComponent(back)}`;

// ── keeping context between the Notebook, lessons and questions ──

/** The `nb` value: "1" (the Notebook) or the id of the note the learner left from. */
export function parseNotebookReturn(v: string | null | undefined): { note: string | null } | null {
  if (!v) return null;
  if (v === "1") return { note: null };
  return /^[0-9a-f-]{36}$/i.test(v) ? { note: v.toLowerCase() } : null;
}
/** Add the Notebook context to a path or href (keeps any #anchor last). */
export function withNotebook(path: string, back: string): string {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}nb=${encodeURIComponent(back)}${hash ? `#${hash}` : ""}`;
}
/** The way back: the Notebook view, at the note the learner left from. Path under the experience. */
export const notebookBackPath = (r: { note: string | null }) => `study/saved?view=notebook${r.note ? `#n-${r.note}` : ""}`;
