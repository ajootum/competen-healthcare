// ── LIBRARY ITEM METADATA: PROGRAMME, QUALIFICATION LEVEL, DIFFICULTY ── SQIE-CLOSE-2026-11 WS-E (owner directive s4) ─────
//
// A governed library question (CKRI revision_question, 442/800) may say WHO it is written for: the programmes it suits
// (individual_scholar_programme codes, 387), the qualification level (certificate, diploma, degree, postgraduate) and its
// difficulty (1 easy, 2 standard, 3 harder -- the same 1-3 scale 416 records on a learner's question). It rides inside the
// version's content under `meta`, so it is part of the exact content an educator reviews, a clinician approves (the content
// hash) and a publisher publishes, and it is frozen with it. Migration 995 checks its shape in the database.
//
// ⚠ ALL OPTIONAL. A question without `meta` (every question written before WS-E) is offered exactly as before: to every
// learner whose accepted competency links match, at standard difficulty. An item never becomes LESS available because a
// learner's programme or level is unknown: only a KNOWN mismatch excludes it.
// ⚠ NOT COPIED INTO THE LEARNER'S ANSWER. The 800 guard rebuilds a copy from answerKey, rubric and marking only, so meta
// changes no copy. The copy's `difficulty` column (not guarded) takes meta.difficulty, so an adaptive exam can target it.
//
// Pure and dependency-free (the HQ form, a client component, imports it).

export const QUALIFICATION_LEVELS = ["certificate", "diploma", "degree", "postgraduate"] as const;
export type QualificationLevel = (typeof QUALIFICATION_LEVELS)[number];
export const QUALIFICATION_LABEL: Record<QualificationLevel, string> = {
  certificate: "Certificate / enrolled", diploma: "Diploma", degree: "Degree (bachelor's)", postgraduate: "Postgraduate (master's, doctoral)",
};
export const LIBRARY_DIFFICULTIES = [1, 2, 3] as const;
export type LibraryDifficulty = (typeof LIBRARY_DIFFICULTIES)[number];
export const DIFFICULTY_LABEL: Record<LibraryDifficulty, string> = { 1: "Easier", 2: "Standard", 3: "Harder" };
export const PROGRAMMES_MAX = 10;
/** The 387 programme code shape (individual_scholar_programme_code_check). */
export const PROGRAMME_CODE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export type LibraryMeta = { programmes?: string[]; level?: QualificationLevel; difficulty?: LibraryDifficulty };

/**
 * Pure. The metadata of a content's `meta`, normalised, or the plain reason it is not one. Absent or empty: ok with no
 * metadata (`meta: null`). The database (995 ckri_question_meta_ok) checks the same shape.
 */
export function checkLibraryMeta(raw: unknown): { ok: true; meta: LibraryMeta | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, meta: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "The programme, level and difficulty are not readable." };
  const m = raw as Record<string, unknown>;
  const out: LibraryMeta = {};
  if (m.programmes !== undefined && m.programmes !== null) {
    if (!Array.isArray(m.programmes) || m.programmes.length > PROGRAMMES_MAX || !m.programmes.every(p => typeof p === "string" && PROGRAMME_CODE.test(p)))
      return { ok: false, error: `Choose up to ${PROGRAMMES_MAX} programmes from the list.` };
    const ps = [...new Set(m.programmes as string[])].sort();
    if (ps.length) out.programmes = ps;
  }
  if (m.level !== undefined && m.level !== null && m.level !== "") {
    if (!(QUALIFICATION_LEVELS as readonly unknown[]).includes(m.level)) return { ok: false, error: "Choose a qualification level from the list." };
    out.level = m.level as QualificationLevel;
  }
  if (m.difficulty !== undefined && m.difficulty !== null && m.difficulty !== "") {
    const d = Number(m.difficulty);
    if (!(LIBRARY_DIFFICULTIES as readonly number[]).includes(d) || typeof m.difficulty === "boolean") return { ok: false, error: "Choose the difficulty: easier, standard or harder." };
    out.difficulty = d as LibraryDifficulty;
  }
  return { ok: true, meta: Object.keys(out).length ? out : null };
}

/** Pure. The metadata a stored content carries (unreadable or absent: none). */
export function metaOf(content: unknown): LibraryMeta | null {
  const c = (content ?? {}) as Record<string, unknown>;
  const r = checkLibraryMeta(c.meta);
  return r.ok ? r.meta : null;
}

/** Pure. The metadata from the educator form's plain fields (programmes as a list or lines, level, difficulty). */
export function metaFromFields(f: Record<string, unknown>): Record<string, unknown> | undefined {
  const progs = (Array.isArray(f.programmes) ? f.programmes : typeof f.programmes === "string" ? f.programmes.split(/[\s,]+/) : [])
    .map(x => (typeof x === "string" ? x.trim().toLowerCase() : "")).filter(Boolean);
  const level = typeof f.level === "string" ? f.level.trim() : "";
  const difficulty = f.difficulty === undefined || f.difficulty === null || f.difficulty === "" ? undefined : Number(f.difficulty);
  const meta = { ...(progs.length ? { programmes: progs } : {}), ...(level ? { level } : {}), ...(difficulty !== undefined ? { difficulty } : {}) };
  return Object.keys(meta).length ? meta : undefined;
}

/**
 * Pure. The qualification level a learner's programme and level words name, by the SAME words levelDefaultDifficulty
 * (question-intel.ts) reads. null when they name none -- then no item is excluded by level.
 */
export function qualificationOf(...words: readonly (string | null | undefined)[]): QualificationLevel | null {
  const t = words.filter(Boolean).join(" ").toLowerCase();
  if (!t) return null;
  if (/\b(doctor(al|ate)?|phd|dphil|dnp)\b/.test(t) || /\b(master'?s?|msc|mph|mn|ma|postgraduate)\b/.test(t)) return "postgraduate";
  if (/\b(bachelor'?s?|bsc|bn|bns|degree|undergraduate)\b/.test(t)) return "degree";
  if (/\bdiploma\b/.test(t)) return "diploma";
  if (/\b(enrolled|certificate)\b/.test(t)) return "certificate";
  return null;
}

/** What is known of a learner for matching: their programme code and qualification level (either may be unknown). */
export type LearnerFit = { programmeCode: string | null; level: QualificationLevel | null };

/**
 * Pure. Whether an item may be offered to this learner: excluded ONLY by a known mismatch -- the item names programmes and
 * the learner's known programme is not one of them, or the item names a level and the learner's known level differs.
 */
export function fitsLearner(meta: LibraryMeta | null | undefined, learner: LearnerFit | null | undefined): boolean {
  if (!meta || !learner) return true;
  if (meta.programmes?.length && learner.programmeCode && !meta.programmes.includes(learner.programmeCode)) return false;
  if (meta.level && learner.level && meta.level !== learner.level) return false;
  return true;
}

/** Pure. A short line for HQ lists: "Degree · Standard · 2 programmes", or null when the item records none. */
export function metaSummary(meta: LibraryMeta | null | undefined): string | null {
  if (!meta) return null;
  const parts = [meta.level ? QUALIFICATION_LABEL[meta.level] : null, meta.difficulty ? DIFFICULTY_LABEL[meta.difficulty] : null,
    meta.programmes?.length ? (meta.programmes.length === 1 ? meta.programmes[0] : `${meta.programmes.length} programmes`) : null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
