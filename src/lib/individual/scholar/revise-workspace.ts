// ── SCHOLAR-REVISE-WORKSPACE-01: THE REVISE WORKSPACE, THE RULES ── owner GO 5 Nov 2026 ──────────────────────────────────
//
// Pure and client-safe: no I/O, no clock of its own, no AI. Revise opens on what needs attention, why, and how to begin. These
// rules only arrange what the learner's records already say. They write nothing, change no schedule and change no plan: a
// suggestion from here is a link the learner may follow.
//
//   DATES   Every comparison is a learner-local YYYY-MM-DD. "Due today" means exactly that; a date before it is "due since",
//           and one after it is never called due today.
//   STUDIED A day counts as studied only when a record of learning has that date (an answer, a card review or a lesson). The
//           day a material was uploaded is shown as that, and is never a studied day.
//   EVIDENCE All of this is practice. Nothing here is an assessment or evidence of competence.

import { localDay } from "./learning-definitions";

export const REVISE_VIEWS = ["today", "priorities", "month", "topics", "insights"] as const;
export type ReviseView = (typeof REVISE_VIEWS)[number];
export const REVISE_VIEW_LABEL: Record<ReviseView, string> = {
  today: "Today", priorities: "My Priorities", month: "Studied This Month", topics: "All Topics", insights: "Revision Insights",
};
/** Pure. The view asked for. Anything else opens on Today. */
export const parseReviseView = (raw: unknown): ReviseView => ((REVISE_VIEWS as readonly unknown[]).includes(raw) ? raw as ReviseView : "today");

// ── dates ──

const DAY_MS = 86_400_000;
const num = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** Pure. Whole days from one local date to another. */
export const daysBetween = (from: string, to: string): number => Math.round((num(to) - num(from)) / DAY_MS);
/** Pure. "12 Nov", read as the date it is in every time zone. */
export const shortDate = (day: string): string => new Date(`${day.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Pure. A card's review date in words: one meaning per date, relative to the learner's own today. */
export function dueLabel(nextReviewAt: string | null, today: string): string {
  if (!nextReviewAt) return "Not scheduled";
  const day = nextReviewAt.slice(0, 10);
  if (day === today) return "Due today";
  return day < today ? `Due since ${shortDate(day)}` : `Next review ${shortDate(day)}`;
}

/** Pure. Exam countdown in words, or nothing once the date has passed. */
export function daysLeftLabel(date: string, today: string): string | null {
  const n = daysBetween(today, date);
  if (n < 0) return null;
  return n === 0 ? "today" : n === 1 ? "tomorrow" : `in ${n} days`;
}

// ── Today: one queue, in the order a learner should act on it ──

export type QueueAction = { kind: "link"; href: string; label: string } | { kind: "start"; mode: "today" | "weak" | "spaced"; label: string };
export type QueueKind = "resume" | "cards" | "retrieval" | "weak" | "mistakes" | "plan" | "recommended";
export type QueueItem = {
  key: string; kind: QueueKind; title: string;
  /** Why it matters now, in one line. */
  why: string;
  /** A short status in words, never by colour alone. */
  status: string;
  action: QueueAction;
  /** The scheduling explanation, opened on request. */
  more: readonly string[];
  /** It matches one of the learner's own priorities in My Plan. */
  priority: boolean;
};

export type TodayInput = {
  resume: readonly { key: string; title: string; position: number; total: number | null; lastActiveDay: string; href: string }[];
  dueCards: number; dueCardsHref: string;
  retrieval: readonly { key: string; label: string; status: string; why: string; more: readonly string[]; href: string; actionLabel: string; priorityFlag: boolean }[];
  /** Questions missed more than once, with the materials they came from. */
  repeated: readonly { materialTitle: string | null }[];
  weakOffered: boolean;
  mistakes: number | null; mistakesHref: string;
  plan: readonly { key: string; title: string; why: string; href: string }[];
  recommended: readonly { key: string; title: string; why: string; action: QueueAction }[];
  priorities: readonly string[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** Pure. Whether a title is about one of the learner's priorities, by whole words either way round. */
export function matchesPriority(title: string, priorities: readonly string[]): boolean {
  const t = ` ${norm(title)} `;
  return priorities.map(norm).filter(p => p.length >= 3).some(p => t.includes(` ${p} `));
}

/** Pure. What needs attention, most urgent first. Unfinished work first, then what is due, then gaps, then the plan. Within a kind, the learner's priorities come first. */
export function buildTodayQueue(i: TodayInput): QueueItem[] {
  const pri = (t: string) => matchesPriority(t, i.priorities);
  const items: QueueItem[] = [
    ...i.resume.map((r): QueueItem => ({
      key: `resume-${r.key}`, kind: "resume", title: `Carry on: ${r.title}`, status: "In progress", priority: pri(r.title), more: [],
      why: `${r.total === null ? `${r.position} answered` : `${r.position} of ${r.total} answered`}, last worked on ${shortDate(r.lastActiveDay)}. Your answers so far are saved.`,
      action: { kind: "link", href: r.href, label: "Resume" },
    })),
    ...(i.dueCards > 0 ? [{
      key: "cards", kind: "cards" as const, title: `Review ${i.dueCards} due ${i.dueCards === 1 ? "card" : "cards"}`, status: "Due", priority: false,
      why: "Recalling these now, as they come due, is what makes them last.",
      more: ["A card comes back sooner when you did not remember it and later when you did. The dates come from your own ratings."],
      action: { kind: "link" as const, href: i.dueCardsHref, label: "Review cards" },
    }] : []),
    ...i.retrieval.map((r): QueueItem => ({
      key: `retrieval-${r.key}`, kind: "retrieval", title: r.label, status: r.status, why: r.why, more: r.more, priority: r.priorityFlag || pri(r.label),
      action: { kind: "link", href: r.href, label: r.actionLabel },
    })),
    ...(i.repeated.length > 0 && i.weakOffered ? [(() => {
      const named = [...new Set(i.repeated.map(r => r.materialTitle).filter((x): x is string => !!x))];
      const n = i.repeated.length;
      return {
        key: "weak", kind: "weak" as const, title: "Practise what you keep missing", status: "Needs practice", priority: named.some(pri), more: [],
        why: `${n} ${n === 1 ? "question" : "questions"} missed more than once${named.length ? `, from ${named.slice(0, 2).join(" and ")}${named.length > 2 ? ` and ${named.length - 2} more` : ""}` : ""}.`,
        action: { kind: "start" as const, mode: "weak" as const, label: "Start weak-area practice" },
      };
    })()] : []),
    ...(i.mistakes && i.mistakes > 0 ? [{
      key: "mistakes", kind: "mistakes" as const, title: `Fix ${i.mistakes} ${i.mistakes === 1 ? "mistake" : "mistakes"}`, status: "To fix", priority: false, more: [],
      why: "Your wrong answers, each with the answer and why.",
      action: { kind: "link" as const, href: i.mistakesHref, label: "Open Mistake Notebook" },
    }] : []),
    ...i.plan.map((p): QueueItem => ({ key: `plan-${p.key}`, kind: "plan", title: p.title, status: "In My Plan", why: p.why, more: [], priority: pri(p.title), action: { kind: "link", href: p.href, label: "Open" } })),
    ...i.recommended.map((r): QueueItem => ({ key: `rec-${r.key}`, kind: "recommended", title: r.title, status: "Suggested", why: r.why, more: [], priority: pri(r.title), action: r.action })),
  ];
  const order: Record<QueueKind, number> = { resume: 0, cards: 1, retrieval: 2, weak: 3, mistakes: 4, plan: 5, recommended: 6 };
  return items.map((it, n) => ({ it, n })).sort((a, b) => order[a.it.kind] - order[b.it.kind] || Number(b.it.priority) - Number(a.it.priority) || a.n - b.n).map(x => x.it);
}

// ── Studied this month: from records of learning, never from uploads ──

export type StudiedGroup = {
  materialId: string; title: string;
  /** Local days with a record of learning, oldest first. */
  days: string[]; lastDay: string; uploadedOn: string;
  answered: number; missed: number; reviews: number; lessons: { id: string; title: string; completed: boolean }[];
  dueCards: number;
  consolidation: "due" | "missed" | "not_revised" | "up_to_date";
};
export const CONSOLIDATION_LABEL: Record<StudiedGroup["consolidation"], string> = {
  due: "Cards due", missed: "Needs practice", not_revised: "Learnt, not revised yet", up_to_date: "Up to date",
};
export type StudiedMonth = { month: string; groups: StudiedGroup[]; uploadedNotStudied: { id: string; title: string; uploadedOn: string }[]; unplaced: { id: string; title: string; day: string; completed: boolean }[] };

/** Pure. The current local month's learning, grouped by material. A lesson whose material cannot be told is listed on its own. */
export function buildStudiedThisMonth(i: {
  today: string; tz: string;
  materials: readonly { id: string; title: string; createdAt: string }[];
  questions: readonly { id: string; materialId: string }[];
  attempts: readonly { questionId: string; correct: boolean; answeredAt: string }[];
  reviews: readonly { reviewedAt: string; materialId: string }[] | null;
  /** Sessions with the materials their steps use. */
  sessions: readonly { id: string; title: string; status: string; lastActiveAt: string; materialIds: readonly string[] }[];
  cards: readonly { nextReviewAt: string; status: string; materialId?: string | null }[];
}): StudiedMonth {
  const month = i.today.slice(0, 7);
  const inMonth = (at: string) => { const d = localDay(at, i.tz); return d.startsWith(month) ? d : null; };
  const materialOf = new Map(i.questions.map(q => [q.id, q.materialId]));
  const byId = new Map(i.materials.map(m => [m.id, m]));
  const g = new Map<string, { days: Set<string>; answered: number; missed: number; reviews: number; lessons: StudiedGroup["lessons"] }>();
  const at = (id: string) => { if (!g.has(id)) g.set(id, { days: new Set(), answered: 0, missed: 0, reviews: 0, lessons: [] }); return g.get(id)!; };
  for (const a of i.attempts) {
    const d = inMonth(a.answeredAt), m = materialOf.get(a.questionId);
    if (!d || !m || !byId.has(m)) continue;
    const x = at(m);
    x.days.add(d); x.answered++; if (!a.correct) x.missed++;
  }
  for (const r of i.reviews ?? []) {
    const d = inMonth(r.reviewedAt);
    if (!d || !byId.has(r.materialId)) continue;
    const x = at(r.materialId);
    x.days.add(d); x.reviews++;
  }
  const unplaced: StudiedMonth["unplaced"] = [];
  for (const s of i.sessions) {
    const d = inMonth(s.lastActiveAt);
    if (!d) continue;
    const known = s.materialIds.filter(m => byId.has(m));
    if (!known.length) { unplaced.push({ id: s.id, title: s.title, day: d, completed: s.status === "completed" }); continue; }
    for (const m of known) { const x = at(m); x.days.add(d); x.lessons.push({ id: s.id, title: s.title, completed: s.status === "completed" }); }
  }
  const dueBy = new Map<string, number>();
  for (const c of i.cards) if (c.status === "active" && c.materialId && c.nextReviewAt.slice(0, 10) <= i.today) dueBy.set(c.materialId, (dueBy.get(c.materialId) ?? 0) + 1);
  const groups: StudiedGroup[] = [...g.entries()].map(([id, x]) => {
    const days = [...x.days].sort(), dueCards = dueBy.get(id) ?? 0;
    return {
      materialId: id, title: byId.get(id)!.title, days, lastDay: days[days.length - 1], uploadedOn: localDay(byId.get(id)!.createdAt, i.tz),
      answered: x.answered, missed: x.missed, reviews: x.reviews, lessons: x.lessons, dueCards,
      consolidation: dueCards > 0 ? "due" as const : x.missed > 0 ? "missed" as const : x.answered + x.reviews === 0 ? "not_revised" as const : "up_to_date" as const,
    };
  }).sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.title.localeCompare(b.title));
  const studied = new Set(groups.map(x => x.materialId));
  const uploadedNotStudied = i.materials.filter(m => !studied.has(m.id) && localDay(m.createdAt, i.tz).startsWith(month)).map(m => ({ id: m.id, title: m.title, uploadedOn: localDay(m.createdAt, i.tz) }));
  return { month, groups, uploadedNotStudied, unplaced };
}

// ── All topics: the catalogue ──

export const CATALOGUE_STATUSES = ["due", "needs_practice", "revised", "not_revised"] as const;
export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];
export const CATALOGUE_STATUS_LABEL: Record<CatalogueStatus, string> = { due: "Due", needs_practice: "Needs practice", revised: "Revised", not_revised: "Not revised yet" };
export const CATALOGUE_PAGE = 20;

export type CatalogueRow = {
  materialId: string; title: string; topics: string[]; uploadedOn: string; lastStudied: string | null;
  answered: number; dueCards: number; competencyIds: string[]; status: CatalogueStatus;
};
export type CatalogueFilters = { q: string; material: string | null; topic: string | null; competency: string | null; status: CatalogueStatus | null; from: string | null; page: number };

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Pure. Filters from the address. Anything unusable is no filter. */
export function parseCatalogueFilters(p: Record<string, string | undefined>): CatalogueFilters {
  const page = Number(p.page);
  return {
    q: (p.q ?? "").trim().slice(0, 120), material: p.m || null, topic: (p.t ?? "").trim().slice(0, 120) || null, competency: p.c || null,
    status: (CATALOGUE_STATUSES as readonly unknown[]).includes(p.status) ? p.status as CatalogueStatus : null,
    from: p.from && DATE.test(p.from) ? p.from : null, page: Number.isInteger(page) && page > 0 ? page : 1,
  };
}
export const hasCatalogueFilters = (f: CatalogueFilters): boolean => !!(f.q || f.material || f.topic || f.competency || f.status || f.from);

/** Pure. One row per material, oldest learning included, each with its topics and where its revision stands. */
export function buildCatalogue(i: {
  today: string; tz: string;
  materials: readonly { id: string; title: string; createdAt: string }[];
  topicsOf: (materialId: string) => readonly string[];
  questions: readonly { id: string; materialId: string; competencyId: string | null }[];
  attempts: readonly { questionId: string; correct: boolean; answeredAt: string }[];
  reviews: readonly { reviewedAt: string; materialId: string }[] | null;
  cards: readonly { nextReviewAt: string; status: string; materialId?: string | null }[];
  competenciesOf?: (materialId: string) => readonly string[];
}): CatalogueRow[] {
  const q = new Map(i.questions.map(x => [x.id, x]));
  const s = new Map<string, { last: string | null; answered: number; latest: Map<string, boolean>; comps: Set<string> }>();
  const of = (id: string) => { if (!s.has(id)) s.set(id, { last: null, answered: 0, latest: new Map(), comps: new Set() }); return s.get(id)!; };
  const later = (a: string | null, b: string) => (!a || b > a ? b : a);
  for (const x of i.questions) if (x.competencyId) of(x.materialId).comps.add(x.competencyId);
  for (const a of [...i.attempts].sort((x, y) => x.answeredAt.localeCompare(y.answeredAt))) {
    const qq = q.get(a.questionId);
    if (!qq) continue;
    const x = of(qq.materialId);
    x.answered++; x.last = later(x.last, localDay(a.answeredAt, i.tz)); x.latest.set(a.questionId, a.correct);
  }
  for (const r of i.reviews ?? []) { const x = of(r.materialId); x.last = later(x.last, localDay(r.reviewedAt, i.tz)); }
  const due = new Map<string, number>();
  for (const c of i.cards) if (c.status === "active" && c.materialId && c.nextReviewAt.slice(0, 10) <= i.today) due.set(c.materialId, (due.get(c.materialId) ?? 0) + 1);
  return i.materials.map(m => {
    const x = s.get(m.id), dueCards = due.get(m.id) ?? 0;
    const missing = x ? [...x.latest.values()].some(v => !v) : false;
    const status: CatalogueStatus = dueCards > 0 ? "due" : missing ? "needs_practice" : x?.last ? "revised" : "not_revised";
    return {
      materialId: m.id, title: m.title, topics: [...i.topicsOf(m.id)], uploadedOn: localDay(m.createdAt, i.tz), lastStudied: x?.last ?? null,
      answered: x?.answered ?? 0, dueCards, competencyIds: [...new Set([...(x?.comps ?? []), ...(i.competenciesOf?.(m.id) ?? [])])], status,
    };
  }).sort((a, b) => (b.lastStudied ?? "").localeCompare(a.lastStudied ?? "") || b.uploadedOn.localeCompare(a.uploadedOn) || a.title.localeCompare(b.title));
}

/** Pure. The rows that match, and one page of them. */
export function filterCatalogue(rows: readonly CatalogueRow[], f: CatalogueFilters): { rows: CatalogueRow[]; total: number; pages: number } {
  const words = norm(f.q).split(" ").filter(Boolean);
  const topic = f.topic ? norm(f.topic) : null;
  const kept = rows.filter(r => {
    if (f.material && r.materialId !== f.material) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.competency && !r.competencyIds.includes(f.competency)) return false;
    if (f.from && (!r.lastStudied || r.lastStudied < f.from)) return false;
    if (topic && !r.topics.some(t => norm(t) === topic)) return false;
    const hay = norm([r.title, ...r.topics].join(" "));
    return words.every(w => hay.includes(w));
  });
  const pages = Math.max(1, Math.ceil(kept.length / CATALOGUE_PAGE));
  const page = Math.min(f.page, pages);
  return { rows: kept.slice((page - 1) * CATALOGUE_PAGE, page * CATALOGUE_PAGE), total: kept.length, pages };
}
