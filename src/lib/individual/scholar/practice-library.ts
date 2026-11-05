// ── SCHOLAR-APPLY-CONNECTED-01: MY PRACTICE LIBRARY, THE RULES ── owner GO 5 Nov 2026 ──────────────────────────────────────
//
// Pure and client-safe: no I/O, no AI. One list of what the learner has practised, drawn from the existing case, OSCE and paper
// records, which stay where they are. Reading it never calls AI. It writes nothing, and it publishes nothing. All of it is
// simulated practice: never an assessment, and never evidence of verified clinical competence.

export const PRACTICE_FORMATS = ["case", "osce", "paper", "scenario", "library_case"] as const;
export type PracticeFormat = (typeof PRACTICE_FORMATS)[number];
export const PRACTICE_FORMAT_LABEL: Record<PracticeFormat, string> = { case: "Clinical reasoning case", osce: "OSCE station", paper: "Practice paper", scenario: "Saved scenario", library_case: "Library case" };
export const PRACTICE_STATUSES = ["not_started", "in_progress", "completed", "needs_review"] as const;
export type PracticeStatus = (typeof PRACTICE_STATUSES)[number];
export const PRACTICE_STATUS_LABEL: Record<PracticeStatus, string> = { not_started: "Not started", in_progress: "In progress", completed: "Completed", needs_review: "Needs review" };
export const PRACTICE_PAGE = 20;

export type PracticeAttempt = { id: string; href: string; status: "active" | "completed"; startedAt: string; finishedAt: string | null; note: string | null };
export type PracticeRow = {
  key: string; format: PracticeFormat; title: string; href: string;
  /** A stored private case that can be played again: no AI. */
  replayCaseId: string | null;
  createdAt: string; lastAt: string; status: PracticeStatus;
  attempts: PracticeAttempt[];
  /** Searchable: topics and clinical concepts, competency titles, source material titles. */
  concepts: string[]; competencies: string[]; sources: string[];
  gaps: string[];
  /** Where a gap can be revised. */
  revise: { materialId: string | null; chunkId: string | null } | null;
  reviewLabel: string;
};

export type PracticeFilters = { q: string; format: PracticeFormat | null; status: PracticeStatus | null; from: string | null; gap: boolean; page: number };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Pure. Filters from the address. Anything unusable is no filter. */
export function parsePracticeFilters(p: Record<string, string | undefined>): PracticeFilters {
  const page = Number(p.page);
  return {
    q: (p.q ?? "").trim().slice(0, 120),
    format: (PRACTICE_FORMATS as readonly unknown[]).includes(p.format) ? p.format as PracticeFormat : null,
    status: (PRACTICE_STATUSES as readonly unknown[]).includes(p.status) ? p.status as PracticeStatus : null,
    from: p.from && DATE.test(p.from) ? p.from : null, gap: p.gap === "1", page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Pure. Every word must appear in the title, a topic or concept, a competency, a source or a gap. */
export function matchesPractice(r: PracticeRow, q: string): boolean {
  const words = norm(q).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = norm([r.title, ...r.concepts, ...r.competencies, ...r.sources, ...r.gaps].join(" "));
  return words.every(w => hay.includes(w));
}

/** Pure. The rows that match, newest activity first, and one page of them. */
export function filterPractice(rows: readonly PracticeRow[], f: PracticeFilters): { rows: PracticeRow[]; total: number; pages: number; page: number } {
  const kept = rows.filter(r => (!f.format || r.format === f.format) && (!f.status || r.status === f.status) && (!f.from || r.lastAt.slice(0, 10) >= f.from) && (!f.gap || r.gaps.length > 0) && matchesPractice(r, f.q))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.key.localeCompare(b.key));
  const pages = Math.max(1, Math.ceil(kept.length / PRACTICE_PAGE));
  const page = Math.min(f.page, pages);
  return { rows: kept.slice((page - 1) * PRACTICE_PAGE, page * PRACTICE_PAGE), total: kept.length, pages, page };
}

/** Pure. What a finished case's debrief says needs another look: findings never asked for, safety criteria broken, and choices marked wrong. */
export function gapsOfDebrief(d: unknown): string[] {
  const x = (d ?? {}) as { missedFindings?: { label?: unknown }[]; safetyEvents?: unknown[]; dimensions?: { dimension?: unknown; answered?: unknown; correct?: unknown; written?: unknown }[] };
  const out: string[] = [];
  for (const m of x.missedFindings ?? []) if (typeof m?.label === "string") out.push(m.label);
  for (const s of x.safetyEvents ?? []) if (typeof s === "string") out.push(s);
  // A written answer is not marked by code, so it is never counted as wrong here.
  for (const w of x.dimensions ?? []) if (typeof w?.dimension === "string" && Number(w.answered) - Number(w.written ?? 0) > Number(w.correct)) out.push(w.dimension === "reasoning" ? "Reasoning" : `Reasoning: ${w.dimension}`);
  return [...new Set(out)].slice(0, 8);
}

/** Pure. Where a stored activity stands, from its attempts. A finished attempt with gaps needs review; a newer attempt in progress wins. */
export function practiceStatus(attempts: readonly Pick<PracticeAttempt, "status">[], gaps: readonly string[]): PracticeStatus {
  if (!attempts.length) return "not_started";
  if (attempts.some(a => a.status === "active")) return "in_progress";
  return gaps.length ? "needs_review" : "completed";
}

/** Pure. The figures at a glance, counted from the rows. Never a score. */
export function practiceGlance(rows: readonly PracticeRow[]): { saved: number; attempts: number; revisit: number } {
  return { saved: rows.length, attempts: rows.reduce((n, r) => n + r.attempts.length, 0), revisit: new Set(rows.flatMap(r => r.gaps)).size };
}
