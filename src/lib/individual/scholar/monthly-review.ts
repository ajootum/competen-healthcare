// ── THE MONTHLY LEARNING REVIEW ── SCHOLAR-MONTHLY-REVIEW-01 (owner GO, 1 Nov 2026) ───────────────────────────────
//
// Pure: no I/O, no clock of its own (`today` is passed in), NO AI. Three things live here, each deterministic:
//   1. monthActivity   what the learner ACTUALLY did in one calendar month (UTC, YYYY-MM): the lessons they studied, the
//                      materials and sections they worked on, the subjects and competencies those sections map to, and
//                      their revision and case sessions. Only real, dated records count. Nothing is inferred.
//   2. monthlyBlueprint the shape of a balanced review: how many questions each section gets, in proportion to the
//                      time and breadth the learner gave it, split core knowledge / application (scenario and case-step)
//                      / previously identified gaps by the policy shares. It returns TARGETS per section and type,
//                      never question text. The same input always gives the same blueprint.
//   3. selectForBlueprint the stored questions that meet those targets (stored first), and what is still short.
//
// ⚠ OPTIONAL AND FORMATIVE. A monthly review is recommended, never required, and nothing waits on it. It is not an
//   assessment and not verified competence: the standing line below is shown wherever its results are.
// ⚠ A KIND WITH NOTHING STORED IS SAID, NOT HIDDEN. When no application or gap question exists for a section its share
//   goes to core knowledge, and the result records that it did (`spilled`).

export const MONTHLY_REVIEW_VERSION = "monthly-review/1";
export const MONTHLY_STANDING_LINE = "Optional formative review · not verified competence";
/** Sections one review can cover (the Learn "sources" scope holds at most this many). */
export const MAX_REVIEW_SECTIONS = 24;

// ── months and days (UTC) ──
const DAY = 86_400_000;
export const isMonth = (x: unknown): x is string => typeof x === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(x) && Number(x.slice(0, 4)) >= 2000;
export const isDay = (x: unknown): x is string => typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
export const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
export const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10);
export const monthOf = (iso: string) => iso.slice(0, 7);
export const monthStart = (m: string) => `${m}-01`;
export const nextMonth = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`; };
export const prevMonth = (m: string) => { const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)); return mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`; };
export const monthEnd = (m: string) => addDays(monthStart(nextMonth(m)), -1);
export const daysInMonth = (m: string) => Number(monthEnd(m).slice(8, 10));
export const monthLabel = (m: string) => new Date(`${monthStart(m)}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
/** The recommended date for a month's review: `days` before the month ends, never before it starts. */
export const recommendedDate = (m: string, days: number) => { const d = addDays(monthEnd(m), -Math.max(0, Math.floor(days))); return d < monthStart(m) ? monthStart(m) : d; };
const isoOf = (at: string) => { const t = Date.parse(at); return Number.isFinite(t) ? new Date(t).toISOString() : at; };
const inMonth = (at: string, m: string) => isoOf(at).slice(0, 7) === m;

// ── 1. WHAT THE LEARNER DID ──
export type SectionDir = { chunkId: string; materialId: string; materialTitle: string; label: string };
export type ActivityRecords = {
  /** Every section the records below can name (the learner's own). */
  sections: readonly SectionDir[];
  /** One row per learning event of a lesson (a session and step), with the sections that step taught. */
  lessons: readonly { sessionId: string; step: number; title: string; chunkIds: readonly string[]; at: string }[];
  /** Materials with the date they were added. */
  materials: readonly { id: string; title: string; at: string }[];
  /** Answers to revision questions, with the section each question belongs to. */
  answers: readonly { questionId: string; chunkId: string; at: string; sessionId: string | null }[];
  /** Spaced reviews of cards, by the section of the card's question. */
  reviews: readonly { chunkId: string; at: string }[];
  revisionSessions: readonly { id: string; mode: string; at: string }[];
  caseSessions: readonly { id: string; at: string; chunkIds: readonly string[] }[];
  /** Section -> the topics Scholar found in it (the learner's corrections included). */
  topics: Readonly<Record<string, readonly string[]>>;
  /** Section -> competency links that are not rejected. */
  links: readonly { chunkId: string; competencyId: string }[];
  competencies: readonly { id: string; title: string }[];
};
export type ActiveSection = SectionDir & { weight: number; lessons: number; answers: number; reviews: number; cases: number; firstAt: string; lastAt: string };
export type MonthActivity = {
  month: string;
  lessons: { sessionId: string; step: number; title: string; firstAt: string }[];
  materials: { id: string; title: string }[];
  sections: ActiveSection[];
  subjects: string[];
  competencies: { id: string; title: string }[];
  revisionSessions: number;
  caseSessions: number;
  answers: number;
  reviews: number;
  /** The distinct days (YYYY-MM-DD) with any real activity. */
  activeDays: string[];
};

/** Pure. What the learner did in `month`. Only records dated inside the month count. */
export function monthActivity(r: ActivityRecords, month: string): MonthActivity {
  const dir = new Map(r.sections.map(s => [s.chunkId, s]));
  const per = new Map<string, ActiveSection>();
  const days = new Set<string>();
  const touch = (chunkId: string, at: string, kind: "lessons" | "answers" | "reviews" | "cases") => {
    const s = dir.get(chunkId);
    if (!s) return;   // a section that is no longer the learner's: not counted
    const a = per.get(chunkId) ?? { ...s, weight: 0, lessons: 0, answers: 0, reviews: 0, cases: 0, firstAt: at, lastAt: at };
    a[kind]++;
    const t = isoOf(at);
    if (t < a.firstAt) a.firstAt = t;
    if (t > a.lastAt) a.lastAt = t;
    per.set(chunkId, a);
  };
  const lessonKeys = new Map<string, { sessionId: string; step: number; title: string; firstAt: string }>();
  for (const l of r.lessons) {
    if (!inMonth(l.at, month)) continue;
    days.add(isoOf(l.at).slice(0, 10));
    const k = `${l.sessionId}:${l.step}`;
    const prev = lessonKeys.get(k);
    if (!prev) { lessonKeys.set(k, { sessionId: l.sessionId, step: l.step, title: l.title, firstAt: isoOf(l.at) }); for (const c of new Set(l.chunkIds)) touch(c, l.at, "lessons"); }
    else if (isoOf(l.at) < prev.firstAt) prev.firstAt = isoOf(l.at);
  }
  let answers = 0, reviews = 0, cases = 0, rev = 0;
  for (const a of r.answers) if (inMonth(a.at, month)) { answers++; days.add(isoOf(a.at).slice(0, 10)); touch(a.chunkId, a.at, "answers"); }
  for (const v of r.reviews) if (inMonth(v.at, month)) { reviews++; days.add(isoOf(v.at).slice(0, 10)); touch(v.chunkId, v.at, "reviews"); }
  for (const c of r.caseSessions) if (inMonth(c.at, month)) { cases++; days.add(isoOf(c.at).slice(0, 10)); for (const id of new Set(c.chunkIds)) touch(id, c.at, "cases"); }
  for (const s of r.revisionSessions) if (inMonth(s.at, month)) { rev++; days.add(isoOf(s.at).slice(0, 10)); }
  const sections = [...per.values()].map(s => ({ ...s, weight: Math.max(1, 2 * s.lessons + s.answers + s.reviews + 2 * s.cases) }))
    .sort((a, b) => b.weight - a.weight || a.materialTitle.localeCompare(b.materialTitle) || a.chunkId.localeCompare(b.chunkId));
  const matIds = new Set(sections.map(s => s.materialId));
  const materials = new Map<string, string>();
  for (const s of sections) materials.set(s.materialId, s.materialTitle);
  for (const m of r.materials) if (inMonth(m.at, month)) { matIds.add(m.id); materials.set(m.id, m.title); days.add(isoOf(m.at).slice(0, 10)); }
  const active = new Set(sections.map(s => s.chunkId));
  const subjects = [...new Set(sections.flatMap(s => r.topics[s.chunkId] ?? []).map(t => t.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const compIds = new Set(r.links.filter(l => active.has(l.chunkId)).map(l => l.competencyId));
  const competencies = r.competencies.filter(c => compIds.has(c.id)).sort((a, b) => a.title.localeCompare(b.title));
  return {
    month, lessons: [...lessonKeys.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt) || a.sessionId.localeCompare(b.sessionId) || a.step - b.step),
    materials: [...matIds].map(id => ({ id, title: materials.get(id) ?? "A material" })).sort((a, b) => a.title.localeCompare(b.title)),
    sections, subjects, competencies, revisionSessions: rev, caseSessions: cases, answers, reviews, activeDays: [...days].sort(),
  };
}

// ── 2. THE BLUEPRINT ──
export type ReviewPolicy = { minQuestions: number; maxQuestions: number; perSection: number; mix: string };
export type ReviewMix = { core: number; application: number; gaps: number };
const MIXES: Record<string, ReviewMix> = {
  "60_25_15": { core: 60, application: 25, gaps: 15 }, "50_30_20": { core: 50, application: 30, gaps: 20 },
  "70_20_10": { core: 70, application: 20, gaps: 10 }, "40_30_30": { core: 40, application: 30, gaps: 30 },
};
/** Pure. The shares a policy value names. An unknown value is the default, never an error. */
export const parseMix = (mix: string): ReviewMix => MIXES[mix] ?? MIXES["60_25_15"];
export type BlueprintSection = { chunkId: string; materialId: string; materialTitle: string; label: string; weight: number; core: number; application: number; gaps: number };
export type Blueprint = {
  version: string;
  month: string;
  policy: { minQuestions: number; maxQuestions: number; perSection: number; mix: ReviewMix };
  /** The number of questions asked for in all. */
  length: number;
  sections: BlueprintSection[];
  totals: ReviewMix;
  /** Sections the learner worked on that this review leaves out because the length is shorter than their number. */
  omittedSections: number;
};
/** Previously identified gaps: how many missed questions each section has (mistake notebook, flashcard gaps and missed attempts all read the same attempts). */
export type GapSignals = Readonly<Record<string, number>>;

/** Largest-remainder apportionment of `total` over `weights`. Deterministic: ties go to the earlier index. */
export function apportion(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (total <= 0 || !weights.length) return weights.map(() => 0);
  if (sum <= 0) { const base = Math.floor(total / weights.length); return weights.map((_, i) => base + (i < total - base * weights.length ? 1 : 0)); }
  const exact = weights.map(w => (w / sum) * total);
  const out = exact.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => ({ i, r: e - Math.floor(e) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out;
}

/** Pure. The review's length for `sections` worked-on sections: sections x perSection, held between the fewest and the most. */
export function reviewLength(sections: number, p: Pick<ReviewPolicy, "minQuestions" | "maxQuestions" | "perSection">): number {
  if (sections <= 0) return 0;
  const max = Math.max(1, Math.floor(p.maxQuestions));
  const min = Math.min(Math.max(1, Math.floor(p.minQuestions)), max);
  return Math.min(max, Math.max(min, sections * Math.max(1, Math.floor(p.perSection))));
}

/** Pure. A balanced blueprint from the month's activity, the known gaps and the policy. Deterministic. */
export function monthlyBlueprint(activity: MonthActivity, gaps: GapSignals, policy: ReviewPolicy): Blueprint {
  const mix = parseMix(policy.mix);
  const maxQ = Math.max(1, Math.floor(policy.maxQuestions));
  const minQ = Math.min(Math.max(1, Math.floor(policy.minQuestions)), maxQ);
  const per = Math.max(1, Math.floor(policy.perSection));
  const all = [...activity.sections].sort((a, b) => b.weight - a.weight || a.chunkId.localeCompare(b.chunkId));
  const length = reviewLength(Math.min(all.length, MAX_REVIEW_SECTIONS), { minQuestions: minQ, maxQuestions: maxQ, perSection: per });
  const base = { version: MONTHLY_REVIEW_VERSION, month: activity.month, policy: { minQuestions: minQ, maxQuestions: maxQ, perSection: per, mix } };
  if (!length) return { ...base, length: 0, sections: [], totals: { core: 0, application: 0, gaps: 0 }, omittedSections: 0 };

  const cap = Math.min(all.length, MAX_REVIEW_SECTIONS);
  const chosen = all.slice(0, Math.min(cap, length));   // at least one question each; fewer questions than sections drops the lightest
  // Items per section: one each for breadth, the rest in proportion to the time and breadth given.
  const extra = apportion(length - chosen.length, chosen.map(s => s.weight));
  const total = chosen.map((_, i) => 1 + extra[i]);
  // Items per type: the policy shares of the length. Gaps cannot exceed the gaps that are known.
  const [, nApp0, nGap0] = apportion(length, [mix.core, mix.application, mix.gaps]);
  const gapAvail = chosen.map(s => Math.max(0, Math.floor(gaps[s.chunkId] ?? 0)));
  const nGap = Math.min(nGap0, gapAvail.reduce((a, b) => a + b, 0));
  const nApp = nApp0;
  const room = total.slice();
  const g = chosen.map(() => 0), a = chosen.map(() => 0);
  // Gaps: one at a time to the section with most gaps left. Ties: heavier section, then the earlier.
  for (let k = 0; k < nGap; k++) {
    let best = -1;
    for (let i = 0; i < chosen.length; i++) {
      if (room[i] <= 0 || gapAvail[i] - g[i] <= 0) continue;
      if (best < 0 || gapAvail[i] - g[i] > gapAvail[best] - g[best]) best = i;
    }
    if (best < 0) break;
    g[best]++; room[best]--;
  }
  // Application: one at a time to the section with most room left, keeping one place for core knowledge where it can.
  for (let k = 0; k < nApp; k++) {
    let best = -1;
    for (let i = 0; i < chosen.length; i++) {
      if (room[i] <= (total[i] > 1 ? 1 : 0)) continue;
      if (best < 0 || room[i] > room[best]) best = i;
    }
    if (best < 0) break;
    a[best]++; room[best]--;
  }
  const sections: BlueprintSection[] = chosen.map((s, i) => ({
    chunkId: s.chunkId, materialId: s.materialId, materialTitle: s.materialTitle, label: s.label, weight: s.weight, core: room[i], application: a[i], gaps: g[i],
  }));
  const totals = sections.reduce((t, s) => ({ core: t.core + s.core, application: t.application + s.application, gaps: t.gaps + s.gaps }), { core: 0, application: 0, gaps: 0 });
  return { ...base, length, sections, totals, omittedSections: all.length - chosen.length };
}

/** Pure. A blueprint read back from a request, or null if it is not one. The shape only: it states what was asked for, and the stored questions are read from the session. */
export function parseBlueprint(raw: unknown, month: string): Blueprint | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  if (b.month !== month || !Array.isArray(b.sections) || b.sections.length < 1 || b.sections.length > MAX_REVIEW_SECTIONS) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const n = (x: unknown) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 50 ? (x as number) : null);
  const sections: BlueprintSection[] = [];
  const seen = new Set<string>();
  for (const s of b.sections as Record<string, unknown>[]) {
    if (!s || typeof s.chunkId !== "string" || !uuid.test(s.chunkId) || typeof s.materialId !== "string" || !uuid.test(s.materialId) || seen.has(s.chunkId)) return null;
    const core = n(s.core), application = n(s.application), gaps = n(s.gaps), weight = typeof s.weight === "number" && Number.isFinite(s.weight) && s.weight >= 0 && s.weight < 100000 ? s.weight : null;
    if (core === null || application === null || gaps === null || weight === null) return null;
    seen.add(s.chunkId);
    sections.push({
      chunkId: s.chunkId, materialId: s.materialId, materialTitle: String(s.materialTitle ?? "").slice(0, 200), label: String(s.label ?? "").slice(0, 120), weight, core, application, gaps,
    });
  }
  const totals = sections.reduce((t, s) => ({ core: t.core + s.core, application: t.application + s.application, gaps: t.gaps + s.gaps }), { core: 0, application: 0, gaps: 0 });
  const length = totals.core + totals.application + totals.gaps;
  if (length < 1 || length > 50) return null;
  const p = (b.policy ?? {}) as Record<string, unknown>;
  const pm = (p.mix ?? {}) as Record<string, unknown>;
  const pn = (x: unknown, d: number) => (Number.isInteger(x) && (x as number) >= 0 && (x as number) <= 100 ? (x as number) : d);
  return {
    version: MONTHLY_REVIEW_VERSION, month,
    policy: { minQuestions: pn(p.minQuestions, 10), maxQuestions: pn(p.maxQuestions, 30), perSection: pn(p.perSection, 2), mix: { core: pn(pm.core, 60), application: pn(pm.application, 25), gaps: pn(pm.gaps, 15) } },
    length, sections, totals, omittedSections: Number.isInteger(b.omittedSections) && (b.omittedSections as number) >= 0 && (b.omittedSections as number) < 1000 ? (b.omittedSections as number) : 0,
  };
}

/**
 * Pure. The blueprint in a short, URL-safe form, for carrying a review from its start to its end without storing anything
 * (the review needs no migration): mix shares, the fewest and most questions, per section, sections omitted, then one
 * chunk.core.application.gaps.weight token per section. Names and labels are not carried: they are read back from the learner own sections.
 */
export function compactBlueprint(bp: Blueprint): string {
  const m = bp.policy.mix, p = bp.policy;
  return [[m.core, m.application, m.gaps, p.minQuestions, p.maxQuestions, p.perSection, bp.omittedSections].join("."), ...bp.sections.map(s => [s.chunkId, s.core, s.application, s.gaps, s.weight].join("."))].join("~");
}
/** Pure. A compact blueprint read back for `month`, or null if it is not one. Names and labels are empty until enrichBlueprint fills them. */
export function expandBlueprint(raw: unknown, month: string): Blueprint | null {
  if (typeof raw !== "string" || raw.length < 10 || raw.length > 4000) return null;
  const [head, ...rest] = raw.split("~");
  const h = head.split(".").map(Number);
  if (h.length !== 7 || !h.every(n => Number.isInteger(n) && n >= 0 && n <= 1000) || rest.length < 1 || rest.length > MAX_REVIEW_SECTIONS) return null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const seen = new Set<string>();
  const sections: BlueprintSection[] = [];
  for (const t of rest) {
    const [chunkId, core, application, gaps, weight] = t.split(".");
    const nums = [core, application, gaps, weight].map(Number);
    if (!uuid.test(chunkId ?? "") || seen.has(chunkId) || nums.some(n => !Number.isInteger(n) || n < 0 || n > 100000) || nums[0] > 50 || nums[1] > 50 || nums[2] > 50) return null;
    seen.add(chunkId);
    sections.push({ chunkId, materialId: "", materialTitle: "", label: "", weight: nums[3], core: nums[0], application: nums[1], gaps: nums[2] });
  }
  const totals = sections.reduce((t, s) => ({ core: t.core + s.core, application: t.application + s.application, gaps: t.gaps + s.gaps }), { core: 0, application: 0, gaps: 0 });
  const length = totals.core + totals.application + totals.gaps;
  if (length < 1 || length > 50) return null;
  return {
    version: MONTHLY_REVIEW_VERSION, month, policy: { minQuestions: h[3], maxQuestions: h[4], perSection: h[5], mix: { core: h[0], application: h[1], gaps: h[2] } },
    length, sections, totals, omittedSections: h[6],
  };
}
/** Pure. A blueprint with each section named from the learner own sections (a section that is no longer theirs keeps empty names). */
export function enrichBlueprint(bp: Blueprint, dir: readonly SectionDir[]): Blueprint {
  const by = new Map(dir.map(d => [d.chunkId, d]));
  return { ...bp, sections: bp.sections.map(s => { const d = by.get(s.chunkId); return d ? { ...s, materialId: d.materialId, materialTitle: d.materialTitle, label: d.label } : s; }) };
}

// ── 3. THE STORED QUESTIONS THAT MEET IT ──
export type PoolQuestion = { id: string; chunkId: string; /** a scenario or case-step question */ application: boolean; /** a question the learner missed and has not yet put right */ gap: boolean };
export type PickedQuestion = { id: string; chunkId: string; bucket: "core" | "application" | "gaps" };
export type Selection = {
  picked: PickedQuestion[];
  /** Core knowledge questions still wanted, by section, once stored ones are used: what generation (if allowed) fills. */
  shortfall: { chunkId: string; count: number }[];
  shortfallTotal: number;
  /** Application and gap places that no stored question could fill and that core knowledge took instead. */
  spilled: { application: number; gaps: number };
};
const fnv = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h; };

/** Pure. Stored questions for each place in the blueprint, in a fixed seeded order. Deterministic for the same pool and seed. */
export function selectForBlueprint(bp: Blueprint, pool: readonly PoolQuestion[], seed: string): Selection {
  const ranked = [...pool].sort((x, y) => fnv(`${seed}:${x.id}`) - fnv(`${seed}:${y.id}`) || x.id.localeCompare(y.id));
  const used = new Set<string>();
  const picked: PickedQuestion[] = [];
  const spilled = { application: 0, gaps: 0 };
  const take = (chunkId: string, want: number, bucket: PickedQuestion["bucket"], ok: (q: PoolQuestion) => boolean) => {
    let got = 0;
    for (const q of ranked) {
      if (got >= want) break;
      if (q.chunkId !== chunkId || used.has(q.id) || !ok(q)) continue;
      used.add(q.id); picked.push({ id: q.id, chunkId, bucket }); got++;
    }
    return got;
  };
  const short = new Map<string, number>();
  for (const s of bp.sections) {
    const gotGap = take(s.chunkId, s.gaps, "gaps", q => q.gap);
    const gotApp = take(s.chunkId, s.application, "application", q => q.application && !q.gap);
    spilled.gaps += s.gaps - gotGap; spilled.application += s.application - gotApp;
    const needCore = s.core + (s.gaps - gotGap) + (s.application - gotApp);
    const gotCore = take(s.chunkId, needCore, "core", q => !q.application && !q.gap);
    if (needCore > gotCore) short.set(s.chunkId, needCore - gotCore);
  }
  // Stored questions of the other worked-on sections come before anything new is written, lightest breadth cost first.
  let shortfallTotal = [...short.values()].reduce((a, b) => a + b, 0);
  if (shortfallTotal > 0) {
    for (let progress = true; progress && shortfallTotal > 0;) {
      progress = false;
      for (const s of bp.sections) {
        if (shortfallTotal <= 0) break;
        const q = ranked.find(x => x.chunkId === s.chunkId && !used.has(x.id) && !x.application && !x.gap);
        if (!q) continue;
        used.add(q.id); picked.push({ id: q.id, chunkId: s.chunkId, bucket: "core" });
        const from = [...short.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
        if (from) { if (from[1] <= 1) short.delete(from[0]); else short.set(from[0], from[1] - 1); }
        shortfallTotal--; progress = true;
      }
    }
  }
  const order = new Map(bp.sections.map((s, i) => [s.chunkId, i]));
  const bucketRank = { core: 0, application: 1, gaps: 2 } as const;
  picked.sort((a, b) => (order.get(a.chunkId) ?? 99) - (order.get(b.chunkId) ?? 99) || bucketRank[a.bucket] - bucketRank[b.bucket] || fnv(`${seed}:${a.id}`) - fnv(`${seed}:${b.id}`));
  return {
    picked, spilled, shortfallTotal: Math.max(0, shortfallTotal),
    shortfall: [...short.entries()].map(([chunkId, count]) => ({ chunkId, count })).sort((a, b) => (order.get(a.chunkId) ?? 99) - (order.get(b.chunkId) ?? 99)),
  };
}

// ── 4. THE RESULT, BY TOPIC ──
export type Band = "strong" | "developing" | "needs_work";
export type SectionResult = {
  chunkId: string; materialId: string; materialTitle: string; label: string; topics: string[];
  asked: number; answered: number; correct: number;
  /** Answers marked by the learner or by AI: shown, not counted in the figure. */
  other: number;
  percent: number | null; band: Band | null;
  /** "ok" a figure; "too_few" fewer than two code-marked answers; "none" nothing answered. */
  state: "ok" | "too_few" | "none";
};
export type MonthlyBreakdown = {
  overall: { asked: number; answered: number; correct: number; other: number; unanswered: number; percent: number | null };
  byType: { core: { asked: number; answered: number; correct: number }; application: { asked: number; answered: number; correct: number } };
  bySection: SectionResult[];
  missed: { questionId: string; chunkId: string }[];
};
export const BREAKDOWN_MIN_ANSWERS = 2;

/** Pure. How the review went, by section and topic. Each question is judged on its latest answer; only code-marked answers make the figure. */
export function monthlyBreakdown(input: {
  sections: readonly SectionDir[];
  topics: Readonly<Record<string, readonly string[]>>;
  questions: readonly { id: string; chunkId: string; application: boolean }[];
  attempts: readonly { questionId: string; correct: boolean; marking: string; answeredAt: string }[];
  bands: { strong: number; developing: number };
}): MonthlyBreakdown {
  const latest = new Map<string, { correct: boolean; marking: string; answeredAt: string }>();
  for (const a of input.attempts) { const l = latest.get(a.questionId); if (!l || a.answeredAt > l.answeredAt) latest.set(a.questionId, a); }
  const dir = new Map(input.sections.map(s => [s.chunkId, s]));
  const rows = new Map<string, SectionResult>();
  const ty = { core: { asked: 0, answered: 0, correct: 0 }, application: { asked: 0, answered: 0, correct: 0 } };
  const missed: MonthlyBreakdown["missed"] = [];
  for (const q of input.questions) {
    const s = dir.get(q.chunkId);
    const row = rows.get(q.chunkId) ?? { chunkId: q.chunkId, materialId: s?.materialId ?? "", materialTitle: s?.materialTitle ?? "A section", label: s?.label ?? "a section", topics: [...(input.topics[q.chunkId] ?? [])].slice(0, 4), asked: 0, answered: 0, correct: 0, other: 0, percent: null, band: null, state: "none" as const };
    row.asked++;
    const t = q.application ? ty.application : ty.core;
    t.asked++;
    const l = latest.get(q.id);
    if (l && l.marking === "deterministic") {
      row.answered++; t.answered++;
      if (l.correct) { row.correct++; t.correct++; } else missed.push({ questionId: q.id, chunkId: q.chunkId });
    } else if (l) row.other++;
    rows.set(q.chunkId, row);
  }
  const bySection = [...rows.values()].map(r => {
    if (r.answered === 0) return { ...r, state: "none" as const };
    if (r.answered < BREAKDOWN_MIN_ANSWERS) return { ...r, state: "too_few" as const };
    const percent = Math.round((r.correct / r.answered) * 100);
    return { ...r, state: "ok" as const, percent, band: (percent >= input.bands.strong ? "strong" : percent >= input.bands.developing ? "developing" : "needs_work") as Band };
  }).sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.label.localeCompare(b.label));
  const asked = input.questions.length, answered = ty.core.answered + ty.application.answered, correct = ty.core.correct + ty.application.correct;
  const other = bySection.reduce((n, r) => n + r.other, 0);
  return {
    overall: { asked, answered, correct, other, unanswered: Math.max(0, asked - answered - other), percent: answered >= BREAKDOWN_MIN_ANSWERS ? Math.round((correct / answered) * 100) : null },
    byType: ty, bySection, missed,
  };
}

/** Pure. Topic labels worth putting first in a study plan: the sections that need work, then those still developing. At most `max`, each 1 to 120 characters, no repeats. */
export function weakTopics(b: Pick<MonthlyBreakdown, "bySection">, max = 10): string[] {
  const out: string[] = [];
  const rank = (r: SectionResult) => (r.band === "needs_work" ? 0 : r.band === "developing" ? 1 : 2);
  for (const r of [...b.bySection].filter(x => x.band === "needs_work" || x.band === "developing").sort((x, y) => rank(x) - rank(y) || (x.percent ?? 0) - (y.percent ?? 0))) {
    const label = (r.topics[0] ?? r.materialTitle).replace(/\s+/g, " ").trim().slice(0, 120);
    if (label && !out.some(o => o.toLowerCase() === label.toLowerCase())) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

// ── 5. WHICH REVIEW IS THE MONTH'S ORIGINAL ──
export type ReviewRow = { id: string; month: string; createdAt: string; retakeOf: string | null; late: boolean; confidence?: string };
export type MonthStanding<T extends ReviewRow = ReviewRow> = { original: T | null; retakes: T[] };
/** Pure. The first completed review of a month is its original. Every later one is a practice retake, listed newest first. The original is never replaced. */
export function monthStanding<T extends ReviewRow>(rows: readonly T[], month: string): MonthStanding<T> {
  const mine = rows.filter(r => r.month === month).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const original = mine.find(r => r.retakeOf === null) ?? mine[0] ?? null;
  return { original, retakes: mine.filter(r => r !== original).reverse() };
}

/** Pure. Whether the review of `month` has passed its month, so taking it is late (still allowed, and said). */
export const isLate = (month: string, takenAt: string) => monthOf(takenAt) > month;

export type Nudge = { month: string; due: boolean; recommended: string; late: boolean };
/**
 * Pure. Which reviews to remind about: this month's from its recommended date, and last month's while it is still not taken
 * and fourteen days or fewer into this month. None when the learner has opted out, reminders are off, or the month had no activity.
 */
export function reviewNudges(o: { today: string; recommendDays: number; reminders: boolean; optedOut: boolean; done: ReadonlySet<string>; active: ReadonlySet<string> }): Nudge[] {
  if (!o.reminders || o.optedOut) return [];
  const cur = monthOf(o.today), prev = prevMonth(cur);
  const out: Nudge[] = [];
  if (o.active.has(prev) && !o.done.has(prev) && o.today <= addDays(monthStart(cur), 13)) out.push({ month: prev, due: true, recommended: recommendedDate(prev, o.recommendDays), late: true });
  const rec = recommendedDate(cur, o.recommendDays);
  if (o.active.has(cur) && !o.done.has(cur) && o.today >= rec) out.push({ month: cur, due: true, recommended: rec, late: false });
  return out;
}

/** The reference of the "do not suggest monthly reviews" choice in the study calendar entries (830). */
export const OPTOUT_REF = "monthly_review_optout";
/** Pure. Whether the learner chose not to be shown monthly review suggestions. */
export const optedOutOf = (entries: readonly { kind: string; ref: string }[]): boolean => entries.some(e => e.kind === "preference" && e.ref === OPTOUT_REF);
