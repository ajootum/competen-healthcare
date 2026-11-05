// ── SCHOLAR-APPLY-CONNECTED-01: WHAT A LEARNER HAS ACTUALLY STUDIED, FOR PRACTICE ── owner GO 5 Nov 2026 ───────────────────
//
// Pure: no I/O, no clock of its own, no AI. It reads what the learner's own records already say and picks the sections an
// integrated case is written from. The case itself comes from the one existing engine (runCaseBlueprint), under its checks.
//
//   STUDIED   A section counts as studied only where a record says so: a lesson the learner reached, a question answered, a card
//             reviewed, or a case that sent them back to it. An uploaded section with no such record is never called studied. A
//             learner who chooses a material or competency may practise from it, and it is labelled as not studied yet.
//   CONNECTED Sections are joined by what they share: concepts from the analysis, and competency links. No AI decides this.
//   PLAN      Priorities are read, never changed. A priority with nothing studied behind it says so rather than pretending.

export const DRAW_FROM = ["all", "plan", "recent", "gaps", "selected", "session"] as const;
export type DrawFrom = (typeof DRAW_FROM)[number];
/** What a learner picks in the builder. "selected" and "session" are reached from a material, competency or lesson. */
export const DRAW_CHOICES = ["all", "plan", "recent", "gaps"] as const;
export const DRAW_LABEL: Record<(typeof DRAW_CHOICES)[number], string> = { all: "All my previous learning", plan: "My Plan priorities", recent: "Recently studied learning", gaps: "Identified learning gaps" };
export const RECENT_DAYS = 30;
export const CONNECTED_SECTIONS_MAX = 6;

export type Draw = { from: DrawFrom; topic: string | null; sessionId: string | null; materialIds: string[]; competencyId: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** Pure. A request's choice. Anything unknown means all previous learning, the default. */
export function parseDraw(raw: unknown): Draw {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const from = (DRAW_FROM as readonly unknown[]).includes(r.from) ? r.from as DrawFrom : "all";
  return {
    from, topic: typeof r.topic === "string" && r.topic.trim() ? r.topic.trim().slice(0, 120) : null, sessionId: isId(r.sessionId) ? r.sessionId : null,
    materialIds: Array.isArray(r.materialIds) ? r.materialIds.filter(isId).slice(0, 10) : [], competencyId: isId(r.competencyId) ? r.competencyId : null,
  };
}

export type SignalKind = "lesson" | "answered" | "reviewed" | "missed" | "forgotten" | "case_gap";
export type Signal = { kind: SignalKind; day: string };
export type LearnedSection = {
  chunkId: string; materialId: string; materialTitle: string; concepts: string[]; competencyIds: string[];
  signals: Signal[];
  /** Latest answer wrong, last card not remembered, or a case sent them back to it. */
  gap: boolean; lastDay: string;
  /** Words that say what the section is about, from its own text, where the analysis has no concepts for it. */
  terms?: readonly string[];
  /** The section's own heading, for naming it. */
  heading?: string | null;
  /** False: the case engine's readiness check says this text has no patient to write a case about. */
  suited?: boolean;
  /** True: the same check finds a patient's presentation, what it means, and what happens next, all in this section. */
  caseReady?: boolean;
};

export type RecordInput = {
  materials: readonly { id: string; title: string }[];
  /** Prepared examination papers: the learner's questions, not notes that answer them. */
  excludedMaterials?: ReadonlySet<string>;
  questions: readonly { id: string; chunkId: string; materialId: string }[];
  /** Newest or oldest first, either: the latest is worked out here. */
  attempts: readonly { questionId: string; correct: boolean; day: string; at: string }[];
  cards: readonly { questionId: string; day: string; lastQuality: number | null }[];
  /** Only the steps the learner reached. */
  lessons: readonly { chunkId: string; materialId: string; day: string }[];
  caseGaps: readonly { chunkId: string; day: string }[];
  concepts: ReadonlyMap<string, readonly string[]>;
  competencies: ReadonlyMap<string, readonly string[]>;
};

/** Pure. Every section the records show the learner has studied, newest first. Nothing is here because it was uploaded. */
export function buildLearnedSections(i: RecordInput): LearnedSection[] {
  const titles = new Map(i.materials.map(m => [m.id, m.title]));
  const q = new Map(i.questions.map(x => [x.id, x]));
  const by = new Map<string, { materialId: string | null; signals: Signal[]; gap: boolean }>();
  const at = (chunkId: string, materialId: string | null) => { if (!by.has(chunkId)) by.set(chunkId, { materialId, signals: [], gap: false }); const v = by.get(chunkId)!; v.materialId ??= materialId; return v; };
  const latest = new Map<string, { correct: boolean; at: string }>();
  for (const a of i.attempts) {
    const qq = q.get(a.questionId);
    if (!qq) continue;
    at(qq.chunkId, qq.materialId).signals.push({ kind: "answered", day: a.day });
    const prev = latest.get(a.questionId);
    if (!prev || a.at > prev.at) latest.set(a.questionId, { correct: a.correct, at: a.at });
  }
  for (const [id, l] of latest) if (!l.correct) { const qq = q.get(id)!, v = at(qq.chunkId, qq.materialId); v.gap = true; v.signals.push({ kind: "missed", day: l.at.slice(0, 10) }); }
  for (const c of i.cards) {
    const qq = q.get(c.questionId);
    if (!qq) continue;
    const v = at(qq.chunkId, qq.materialId);
    v.signals.push({ kind: "reviewed", day: c.day });
    if (c.lastQuality !== null && c.lastQuality < 3) { v.gap = true; v.signals.push({ kind: "forgotten", day: c.day }); }
  }
  for (const l of i.lessons) at(l.chunkId, l.materialId).signals.push({ kind: "lesson", day: l.day });
  for (const g of i.caseGaps) { const v = at(g.chunkId, null); v.gap = true; v.signals.push({ kind: "case_gap", day: g.day }); }
  const out: LearnedSection[] = [];
  for (const [chunkId, v] of by) {
    if (!v.materialId || !titles.has(v.materialId) || i.excludedMaterials?.has(v.materialId)) continue;
    const signals = v.signals.sort((a, b) => b.day.localeCompare(a.day));
    out.push({ chunkId, materialId: v.materialId, materialTitle: titles.get(v.materialId)!, concepts: [...(i.concepts.get(chunkId) ?? [])], competencyIds: [...(i.competencies.get(chunkId) ?? [])], signals, gap: v.gap, lastDay: signals[0].day });
  }
  return out.sort((a, b) => b.lastDay.localeCompare(a.lastDay) || a.chunkId.localeCompare(b.chunkId));
}

const STOP = new Set(["with", "from", "that", "this", "their", "care", "patient", "patients", "clinical", "health", "healthcare", "management", "assessment", "introduction", "overview", "principles", "people", "using", "based"]);
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !STOP.has(w));
/** Pure. Whether a section is about a topic the learner named, by its concepts and its material's title. */
export const sectionMatchesTopic = (s: Pick<LearnedSection, "concepts" | "materialTitle" | "terms">, topic: string): boolean => {
  const want = wordsOf(topic);
  if (!want.length) return false;
  const have = new Set(wordsOf([...s.concepts, s.materialTitle, ...(s.terms ?? [])].join(" ")));
  return want.every(w => have.has(w)) || want.filter(w => have.has(w)).length >= Math.max(2, Math.ceil(want.length / 2));
};
/** Pure. The words a section's text is most about: frequent, and long enough to mean something. For relating sections only, never shown or stored. */
export function termsOfText(text: string, max = 30): string[] {
  const counts = new Map<string, number>();
  for (const w of wordsOf(text)) if (w.length >= 5) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([w]) => w);
}
/** Below this, two sections share words and not a subject: 4 words of their text, 2 of their concepts, or one competency. */
export const RELATED_AT_LEAST = 2;
/** Pure. How strongly two sections are about the same thing: shared competencies count most, then concepts. Sharing a few words of their text counts for less. */
export function relatedness(a: LearnedSection, b: LearnedSection): number {
  const words = new Set(a.concepts.flatMap(wordsOf));
  const shared = new Set(b.concepts.flatMap(wordsOf).filter(w => words.has(w))).size;
  const terms = new Set(a.terms ?? []);
  const sharedTerms = (b.terms ?? []).filter(t => terms.has(t)).length;
  return shared + 2 * b.competencyIds.filter(c => a.competencyIds.includes(c)).length + Math.floor(sharedTerms / 2);
}

const daysAgo = (day: string, today: string) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 864e5);
const HOW: Record<SignalKind, string> = { lesson: "Studied in a lesson", answered: "Answered in revision", reviewed: "Reviewed as flashcards", missed: "Missed in revision", forgotten: "Not remembered on a flashcard", case_gap: "Came up in a practice case" };
const short = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
/** Pure. How the record shows this section was met, from the record only. */
export const howStudied = (s: Pick<LearnedSection, "signals">): string => {
  const pick = s.signals.find(x => x.kind === "missed" || x.kind === "forgotten" || x.kind === "case_gap") ?? s.signals[0];
  return pick ? `${HOW[pick.kind]}, ${short(pick.day)}` : "In your materials, not studied yet";
};

export type ConnectedArea = { chunkId: string; materialId: string; label: string; materialTitle: string; how: string };
export type ConnectedPick = {
  title: string; why: string; chunkIds: string[]; areas: ConnectedArea[]; competencyIds: string[];
  materials: number; hasGap: boolean; topic: string | null;
  /** All of it comes from records of study, so it may be called what the learner studied. */
  allStudied: boolean;
};

const labelOf = (s: LearnedSection, used: Set<string>): string => {
  // A heading names a section. A first sentence does not.
  const heading = s.heading && s.heading.length <= 60 && !/[.!?…]$/.test(s.heading) ? s.heading : "";
  const fresh = [...s.concepts, heading].find(c => c && !used.has(c.toLowerCase()));
  return fresh ?? s.materialTitle;
};

/** Pure. From a pool, one group of related sections: the most pressing section, and what connects to it, across materials first. */
export function pickConnected(pool: readonly LearnedSection[], o: { today: string; priorities?: readonly string[]; topic?: string | null; max?: number; allStudied?: boolean; lead?: string | null; /** Other studied sections that may join a case without leading it: one with no patient of its own can still add escalation or handover. */ companions?: readonly LearnedSection[] }): ConnectedPick | null {
  if (!pool.length) return null;
  const priorities = o.priorities ?? [], max = o.max ?? CONNECTED_SECTIONS_MAX;
  // A section that can carry a case on its own leads: a recent gap with no patient in it cannot start one.
  const score = (s: LearnedSection) => (s.caseReady ? 6 : 0) + (s.gap ? 3 : 0) + (priorities.some(p => sectionMatchesTopic(s, p)) ? 2 : 0) + (daysAgo(s.lastDay, o.today) <= 7 ? 2 : daysAgo(s.lastDay, o.today) <= RECENT_DAYS ? 1 : 0) + Math.min(s.signals.length, 3) * 0.1;
  const seed = [...pool].sort((a, b) => score(b) - score(a) || b.lastDay.localeCompare(a.lastDay) || a.chunkId.localeCompare(b.chunkId))[0];
  const others = [...new Map([...pool, ...(o.companions ?? [])].map(s => [s.chunkId, s])).values()].filter(s => s.chunkId !== seed.chunkId).map(s => ({ s, r: relatedness(seed, s) })).filter(x => x.r >= RELATED_AT_LEAST)
    // The closest first. Another material wins only between equals: a weak link to another document is not integration.
    .sort((a, b) => b.r - a.r || Number(b.s.materialId !== seed.materialId) - Number(a.s.materialId !== seed.materialId) || score(b.s) - score(a.s) || a.s.chunkId.localeCompare(b.s.chunkId));
  const chosen = [seed, ...others.slice(0, max - 1).map(x => x.s)];
  const used = new Set<string>();
  const areas = chosen.map(s => { const label = labelOf(s, used); used.add(label.toLowerCase()); return { chunkId: s.chunkId, materialId: s.materialId, label, materialTitle: s.materialTitle, how: howStudied(s) }; });
  const materials = new Set(chosen.map(s => s.materialId)).size;
  const hasGap = chosen.some(s => s.gap);
  const names = [...new Set(areas.map(a => a.label))];
  const title = o.topic ? `Integrated practice: ${o.topic}` : names.length > 1 ? `Integrated practice: ${names[0]} and ${names[1]}` : `Practice: ${names[0]}`;
  const verb = o.allStudied === false ? "Draws on" : "Connects";
  const what = chosen.length > 1 ? `${verb} ${chosen.length} related areas${materials > 1 ? ` across ${materials} of your materials` : ""}` : `${verb} one area`;
  const why = `${o.lead ? `${o.lead} ` : ""}${what}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " and more" : ""}.${hasGap ? " Includes something you missed earlier." : ""}`;
  return { title, why, chunkIds: chosen.map(s => s.chunkId), areas, competencyIds: [...new Set(chosen.flatMap(s => s.competencyIds))], materials, hasGap, topic: o.topic ?? null, allStudied: o.allStudied !== false };
}

/** Pure. The pool a choice draws from. Plan and gaps stay within what was studied, so nothing is claimed that was not. */
export function poolFor(all: readonly LearnedSection[], d: Pick<Draw, "from" | "topic">, o: { today: string; priorities: readonly string[] }): LearnedSection[] {
  // A section with no patient in it cannot make a case, so it is not offered as one, whatever else the record says about it.
  const usable = all.filter(s => s.suited !== false);
  const named = (s: LearnedSection) => !d.topic || sectionMatchesTopic(s, d.topic);
  if (d.from === "recent") return usable.filter(s => daysAgo(s.lastDay, o.today) <= RECENT_DAYS && named(s));
  if (d.from === "gaps") return usable.filter(s => s.gap && named(s));
  if (d.from === "plan") return d.topic ? usable.filter(named) : usable.filter(s => o.priorities.some(p => sectionMatchesTopic(s, p)));
  return usable.filter(named);
}

export const NOTHING_STUDIED: Record<DrawFrom, string> = {
  all: "Nothing you have studied yet describes a patient's care, which a case needs. Work through a lesson on clinical care first, or choose one of your materials.",
  plan: "Nothing you have studied matches your My Plan priorities yet. Study the topic first, or choose one of your materials.",
  recent: `You have not studied anything in the last ${RECENT_DAYS} days. Choose all your previous learning instead.`,
  gaps: "No learning gaps are on record yet. Choose all your previous learning instead.",
  selected: "Those materials have no sections that can be used yet.",
  session: "That lesson has no sections you have reached yet.",
};
