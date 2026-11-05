import { appendPlanEvent, learningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { learnerCalendarSchema, listEntries } from "../learning-plan/entry-store";
import { expandEntries, plusDays } from "../learning-plan/recurrence";
import { latestPerRef, type Occurrence, type PlanEvent, type ScholarPlanSettings } from "../learning-plan/types";
import { isMyPlanOn, type IndividualPolicy } from "../policy";
import { loadLearnerCatalogue } from "./competency-view";
import { studyActivityDays, selfReportedStudy, type StudyStamp } from "./learning-definitions";
import { loadMastery, prefetchMastery } from "./mastery-data";
import type { MasteryResult } from "./mastery";
import { weakTopics, type MonthlyBreakdown } from "./monthly-review";
import { listMonthlyReviews, loadMonthlyOverview, monthlyReviewOn } from "./monthly-review-data";
import { detectCarryOvers, type CarryNote, type MissedItem } from "./plan-carry";
import { examOffers, planCalendarFrom, type ExamOffer } from "./plan-calendar";
import { buildAdjustments, buildInsights, buildTiles, type Adjustment, type InsightTiles, type Insights } from "./plan-insights";
import { buildComingUp, buildDoneToday, planRefOfKey, relatesTo, type ComingUpItem, type DoneItem } from "./plan-today-view";
import { monthsOfWeek, weekAgenda, type AgendaDay } from "./plan-view";
import { mergeDueRevisionDays } from "./plan-workspace";
import type { CalendarItem } from "./study-calendar";
import { acceptedMaterialIds, acceptedUnstarted, buildProposal, postponedTopics, proposalDecisions, type MaterialIn, type PlanProposal, type ProposalDecision } from "./plan-proposal";
import { parseStoredUnits, type StoredUnit } from "./plan-units";
import { buildUnits } from "./plan-units-build";
import { sectionProfiles } from "./learn";
import { chooseToday, type PlanRecommendation, type UnfinishedItem } from "./plan-recommend";
import { competencyGapsForPlan } from "@/lib/assessment/adapters/scholar/overview-data";
import { isoWeek, reflectionOffer, type ReflectionOffer, type Workload } from "./plan-reflection";
import { effectiveSettings, settingsFromRow, sessionMinutesOf } from "./plan-settings";
import { buildStudyPlan, unstartedMappedSections, type PlanCalendar, type StudyPlanInput, type StudyPlanResult, type StudyPlanSettings, type UnstartedSection } from "./study-plan";
import {
  calendarSchema, caseDecisionTimes, competencyProgressRows, countDue, evaluationEvidence, getEvaluation, getStudyPlan, learningEventTimes, listLearningSessions, listMaterials,
  chunkContents, listRevisionSessions, materialQualities, sectionsOf, studyPlanSchema, topicsOfSections, type Admin, type SectionRef, learnedChunkIds } from "./store";
import { experienceHref } from "../experiences";
import { buildStudyCalendar, entriesHorizon, readStudyCalendar, type CalendarLoad, type CalendarReads } from "./study-calendar-data";
import type { MasteryEntry } from "./mastery";

// ── MY PLAN: THE READS ── PLP-01..04 (owner GO 2 Nov 2026), My Plan calendar enhancement ─────────────────────────────
//
// Assembles the pure planner, the next-activity engine, the proposal and the insights from records that already exist. EVERY READ
// IS THE CALLER'S OWN (keyed on the guard's user id, never a request body) and Scholar's own experience. NO AI.
//
// FAIL CLOSED. Without 780 (or the policy) My Plan is off. Without 840 it still works from 780 and 830: decisions, reflections,
// proposal memory, goal type, session minutes, carry-over notices and the learner calendar are simply absent (`features` says which).
// Unreadable is said (`reason: "unreadable"`), never drawn as an empty plan.

export type PlanCtx = { admin: Admin; userId: string };
export type PlanFeatures = { settingsExtras: boolean; decisions: boolean; learnerCalendar: boolean; calendarMoves: boolean };

export type PlanContext = {
  ok: true;
  today: string; tz: string;
  features: PlanFeatures;
  /** The settings the plan runs on: the saved ones, or the implicit starting plan (`starting`). Never null. */
  settings: ScholarPlanSettings;
  /** True when nothing is saved and the starting plan stands in. It is never written until the learner saves the setup. */
  starting: boolean;
  mastery: MasteryResult;
  dueCards: number;
  unstarted: UnstartedSection[];
  accepted: MaterialIn[];
  events: PlanEvent[];
  occurrences: Occurrence[];
  postponed: Set<string>;
  calendar: PlanCalendar;
  materials: { id: string; title: string }[];
};
export type NotReady = { ok: false; reason: "off" | "not_provisioned" | "unreadable" };
/** Why My Plan is not on for this learner (the gate in front of every plan read). */
const gateReason = (policy: IndividualPolicy, plan780: boolean): NotReady => ({ ok: false, reason: policy.scholarMyPlan === "on" && policy.scholarStudyPlan && !plan780 ? "not_provisioned" : "off" });
/** An un-awaited read that may be dropped (the gate refused) must not become an unhandled rejection: the real await still sees the error. */
const guard = <T>(p: Promise<T>): Promise<T> => { p.catch(() => {}); return p; };

const EVENT_KINDS = ["proposal", "topic_postponed", "recommendation_declined", "reflection", "auto_adjust", "settings_change"] as const;

/**
 * MY PLAN PERF: start the plan's reads before HQ's policy has been read. They are the learner's own rows, keyed on the guard's user id, and every one of them
 * is read once per request (cache()), so the loader that runs a moment later is answered by these instead of asking again. Nothing here is used by itself
 * and nothing throws: if My Plan turns out to be off, the answers are simply never read. `months` are the calendar months the page will show (none: skip the calendar).
 */
export function warmPlanReads(ctx: PlanCtx, o: { now: Date; today: string; months: readonly string[]; entriesTo?: string }): void {
  const { admin, userId } = ctx;
  const quiet = (p: Promise<unknown>) => { p.catch(() => {}); };
  try {
    prefetchMastery(admin, userId, o.now.toISOString());
    quiet(Promise.all([
      studyPlanSchema(admin, userId), learningPlanSchema(admin, userId), learnerCalendarSchema(admin, userId), calendarSchema(admin, userId), getStudyPlan(admin, userId),
      listMaterials(admin, userId), competencyProgressRows(admin, userId), loadLearnerCatalogue(admin, userId), countDue(admin, userId),
      listPlanEvents(admin, userId, "scholar", EVENT_KINDS), listEntries(admin, userId, "scholar", o.entriesTo ?? plusDays(o.today, 60)),
      ...o.months.map(month => readStudyCalendar({ admin, userId, month, today: o.today, needPostponed: false })),
    ]));
  } catch { /* the loaders report anything that is really wrong */ }
}

/**
 * Everything the plan reads, once. `reason: "off"` when HQ has My Plan (or the study plan) off, "not_provisioned" without 780.
 * The learner calendar occurrences cover 90 days back (for self-reported study) to 60 days ahead.
 */
export async function loadPlanContext(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; /** The last date the learner's own entries are read to (default: 60 days on). A caller that also reads the calendar passes the calendar's own, so the entries are read once. */ entriesTo?: string }): Promise<PlanContext | NotReady> {
  const { admin, userId } = ctx;
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) return gateReason(policy, plan780);
  // MY PLAN PERF: every read below that does not depend on another is started at once (it used to be nine steps in a row). The reads are the caller's own,
  // keyed on the guard's user id as before; only the order and the overlap changed.
  prefetchMastery(admin, userId, o.now.toISOString());
  const has840P = learningPlanSchema(admin, userId), hasEntriesP = learnerCalendarSchema(admin, userId), has830P = calendarSchema(admin, userId);
  const eventsP = has840P.then(has => (has ? listPlanEvents(admin, userId, "scholar", EVENT_KINDS) : null));
  const entriesP = hasEntriesP.then(async has => {
    if (!has) return null;
    const le = await listEntries(admin, userId, "scholar", o.entriesTo ?? plusDays(o.today, 60));
    return le.ok ? le.data : null;
  });
  const matsP = listMaterials(admin, userId), rowsP = competencyProgressRows(admin, userId);
  // the sections of the accepted materials need only the events and the materials, so they are read while the rest still loads
  const sectionsP = Promise.all([eventsP, matsP]).then(async ([evs, ms]) => {
    if (!ms.ok || (evs && !evs.ok)) return null;
    const ids = acceptedMaterialIds(evs?.ok ? evs.data : []).filter(id => ms.data.some(m => m.id === id));
    return { ids, read: await readMaterialSections(admin, userId, ids) };
  }).catch(() => null);
  const [has840, hasEntries, has830, row, mats, rows, learner, due, evs, entries] = await Promise.all([
    has840P, hasEntriesP, has830P, getStudyPlan(admin, userId), matsP, rowsP, loadLearnerCatalogue(admin, userId), countDue(admin, userId), eventsP, entriesP,
  ]);
  if (!row.ok || !mats.ok) return { ok: false, reason: "unreadable" };
  const competencies = learner?.provisioned && learner.programme && learner.competencies ? learner.competencies.map(c => ({ id: c.id, title: c.title })) : null;
  const mastery = await loadMastery(admin, userId, policy, o.now.toISOString(), {
    materials: mats.data.map(m => ({ id: m.id, title: m.title })), linked: rows.ok ? { mappings: rows.data.mappings, concepts: rows.data.concepts } : null, competencies,
  });
  if (!mastery.ok) return { ok: false, reason: "unreadable" };
  if (due === null) return { ok: false, reason: "unreadable" };

  const events = evs?.ok ? evs.data : [];
  if (evs && !evs.ok && !evs.notProvisioned) return { ok: false, reason: "unreadable" };

  // accepted materials feed the plan: their unstarted sections, in the order accepted, a topic counted once
  const sec = await sectionsP;
  // P2: a lesson read, opened or taught counts as started (policy scholar_plan_started_signal), not only a question answered.
  const learned = sec?.read && policy.scholarPlanStartedSignal === "learning" ? await learnedChunkIds(admin, userId, sec.read.secs.map(s => s.chunkId)) : new Set<string>();
  const accepted = sec?.read ? assembleMaterials(sec.ids, mats.data, sec.read, rows.ok ? rows.data : null, learned, policy.scholarPlanStartedSignal, storedUnitsOf(events, sec.read.secs)) : [];
  const mapped = rows.ok && competencies
    ? unstartedMappedSections({ mappings: rows.data.mappings, concepts: rows.data.concepts, questions: rows.data.questions, attempts: rows.data.attempts, competencies })
    : [];
  const unstarted = acceptedUnstarted(accepted, mapped);

  const occurrences: Occurrence[] = entries ? expandEntries(entries.entries, entries.exceptions, plusDays(o.today, -90), plusDays(o.today, 60)) : [];
  const eff = effectiveSettings(row.data ? settingsFromRow(row.data) : null);
  return {
    ok: true, today: o.today, tz: o.tz,
    features: { settingsExtras: has840, decisions: has840, learnerCalendar: hasEntries, calendarMoves: has830 },
    settings: eff.settings, starting: eff.starting,
    mastery: mastery.data, dueCards: due, unstarted, accepted, events, occurrences,
    postponed: postponedTopics(events, o.today), calendar: planCalendarFrom(occurrences), materials: mats.data.map(m => ({ id: m.id, title: m.title })),
  };
}

/** The sections of these materials with their topics and whether each has been practised, as the proposal and the plan read them. */
export async function materialsIn(admin: Admin, userId: string, ids: readonly string[], mats: readonly { id: string; title: string }[], rows: { questions: { id: string; chunkId: string }[]; attempts: { questionId: string }[] } | null, signal: "learning" | "practice" = "practice"): Promise<MaterialIn[]> {
  const read = await readMaterialSections(admin, userId, ids);
  if (!read) return [];
  const learned = signal === "learning" ? await learnedChunkIds(admin, userId, read.secs.map(s => s.chunkId)) : new Set<string>();
  return assembleMaterials(ids, mats, read, rows, learned, signal);
}

type SectionsRead = { secs: readonly SectionRef[]; topics: ReadonlyMap<string, string[]>; headings: ReadonlyMap<string, string> };
/**
 * The sections of these materials, their topics and (for a section with no topic) its first line. It does not need the learner's answers, so it can be
 * read while those load. null when the sections cannot be read.
 */
async function readMaterialSections(admin: Admin, userId: string, ids: readonly string[]): Promise<SectionsRead | null> {
  if (!ids.length) return { secs: [], topics: new Map(), headings: new Map() };
  const secs = await sectionsOf(admin, userId, ids);
  if (!secs.ok) return null;
  const topics = await topicsOfSections(admin, userId, secs.data.map(s => s.chunkId));
  // A section with no topic found yet is named by its own first line (a slide or page heading), never "Section n" when the text says more.
  // Only those sections' text is read (one batch read, not every section of each material one material after another); the first five such materials, as before.
  const bare = (s: SectionRef) => !(topics.get(s.chunkId) ?? []).length;
  const untitled = ids.filter(id => secs.data.some(s => s.materialId === id && bare(s))).slice(0, 5);
  const headings = new Map<string, string>();
  if (untitled.length) {
    const want = secs.data.filter(s => untitled.includes(s.materialId) && bare(s)).map(s => s.chunkId);
    for (const r of await chunkContents(admin, userId, want)) { const h = headingOf(r.content); if (h) headings.set(r.id, h); }
  }
  return { secs: secs.data, topics, headings };
}
/**
 * SCHOLAR-INDEPENDENT-LEARNING-01 P2. Pure. The sections that count as STARTED for My Plan, under policy scholar_plan_started_signal:
 *   practice  a question on the section was answered (the earlier rule)
 *   learning  that, or the section was learned on: a lesson opened, read (the learner's own mark, 920), taught or checked
 * A started section is not planned again as new. Deterministic, from records Scholar already keeps; no AI.
 */
export function startedSections(answered: ReadonlySet<string>, learned: ReadonlySet<string>, signal: "learning" | "practice"): Set<string> {
  return signal === "learning" ? new Set([...answered, ...learned]) : new Set(answered);
}
function assembleMaterials(ids: readonly string[], mats: readonly { id: string; title: string }[], read: SectionsRead, rows: { questions: { id: string; chunkId: string }[]; attempts: { questionId: string }[] } | null, learned: ReadonlySet<string> = new Set(), signal: "learning" | "practice" = "practice", units?: ReadonlyMap<string, StoredUnit[] | null>): MaterialIn[] {
  const answered = new Set((rows?.attempts ?? []).map(a => a.questionId));
  const started = startedSections(new Set((rows?.questions ?? []).filter(q => answered.has(q.id)).map(q => q.chunkId)), learned, signal);
  return ids.map(id => {
    const secs = read.secs.filter(s => s.materialId === id);
    return {
      materialId: id, title: mats.find(m => m.id === id)?.title ?? "Your notes", unit: secs[0]?.unit ?? "section",
      sections: secs.map(s => ({ chunkId: s.chunkId, ordinal: s.ordinal, topics: read.topics.get(s.chunkId) ?? [], started: started.has(s.chunkId), heading: read.headings.get(s.chunkId) ?? null, pageFrom: s.pageFrom, pageTo: s.pageTo })),
      units: units?.get(id) ?? null,
    };
  });
}
/**
 * SCHOLAR-PLAN-UNITS-01. Pure. The learning units each material's latest ACCEPTED proposal carries (value.units), checked against the
 * material's own section ordinals. A material accepted without units (an older acceptance, or text that could not be read) maps to null.
 */
export function storedUnitsOf(events: readonly PlanEvent[], secs: readonly Pick<SectionRef, "materialId" | "ordinal">[]): Map<string, StoredUnit[] | null> {
  const out = new Map<string, StoredUnit[] | null>();
  for (const [ref, e] of latestPerRef(events.filter(x => x.kind === "proposal"))) {
    if (e.status !== "accepted") continue;
    const ordinals = new Set(secs.filter(s => s.materialId === ref).map(s => s.ordinal));
    out.set(ref, ordinals.size ? parseStoredUnits(e.value, ordinals) : null);
  }
  return out;
}

/** Pure. A section's first line, cleaned of markdown and bullets, up to 80 characters (null when there is none worth showing). */
export function headingOf(content: string): string | null {
  const line = content.split(/\n/).map(l => l.replace(/^[\s#*•●▪·–-]+/, "").replace(/\*\*/g, "").trim()).find(l => l.length >= 3) ?? "";
  return line ? (line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line) : null;
}

/** The inputs of buildStudyPlan for a day, from the context. */
export function planInputOf(c: PlanContext, today: string, extra: Partial<StudyPlanInput> = {}): StudyPlanInput {
  const s = c.settings;
  return {
    plan: { examDate: s.examDate, examLabel: s.examLabel, weeklyMinutes: s.weeklyMinutes, daysPerWeek: s.daysPerWeek, goal: s.goal, priorities: s.priorities },
    entries: c.mastery.topics, dueCards: c.dueCards, unstarted: c.unstarted, today, postponed: c.postponed, calendar: c.calendar, ...extra,
  };
}

// ── TODAY ──
export type TodayNote = { text: string; /** The undo token for an automatic change: POST plan/decision { kind: "auto_adjust", ref, status: "undone" }. */ undo?: { kind: "auto_adjust"; ref: string } };
/** The plan the study calendar is built from: the saved settings (or the starting plan), the evidence, the unstarted sections (accepted materials included), postponed topics and the learner's own calendar. */
export function calendarPlanOf(c: PlanContext): { settings: StudyPlanSettings; entries: readonly MasteryEntry[]; unstarted: readonly UnstartedSection[]; postponed: ReadonlySet<string>; calendar: PlanCalendar } {
  const s = c.settings;
  return { settings: { examDate: s.examDate, examLabel: s.examLabel, weeklyMinutes: s.weeklyMinutes, daysPerWeek: s.daysPerWeek, goal: s.goal, priorities: s.priorities }, entries: c.mastery.topics, unstarted: c.unstarted, postponed: c.postponed, calendar: c.calendar };
}

/** The month calendar for My Plan: the study calendar (planned, due, done, monthly review) plus the learner's own entries, from one context. */
export type CalendarOutcome = { ok: true; calendar: CalendarLoad | null; features: PlanFeatures } | NotReady;
export async function loadPlanCalendar(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; month: string }): Promise<CalendarOutcome> {
  return (await loadPlanCalendars(ctx, policy, { now: o.now, tz: o.tz, today: o.today, months: [o.month] }))[0];
}
/**
 * MY PLAN PERF: one or more months from ONE plan context. The context and each month's reads are started together (the calendar's reads do not depend on the
 * plan; only the pure build does), and the learner's entries are read once. One outcome per month, in order.
 */
export async function loadPlanCalendars(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; months: readonly string[] }): Promise<CalendarOutcome[]> {
  const { admin, userId } = ctx;
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) { const r = gateReason(policy, plan780); return o.months.map(() => r); }
  const calOn = policy.scholarStudyCalendar === "on";
  const readsP = guard(Promise.all(o.months.map(month => (calOn ? readStudyCalendar({ admin, userId, month, today: o.today, needPostponed: false }) : Promise.resolve(null)))));
  const c = await loadPlanContext(ctx, policy, { ...o, entriesTo: o.months[0] ? entriesHorizon(o.months[0], o.today) : undefined });
  if (!c.ok) return o.months.map(() => c);
  if (!calOn) return o.months.map(() => ({ ok: true as const, calendar: null, features: c.features }));
  const reads = await readsP;
  return o.months.map((month, i): CalendarOutcome => {
    const r = reads[i];
    return r ? { ok: true, calendar: buildStudyCalendar(r, { policy, month, today: o.today, plan: calendarPlanOf(c) }), features: c.features } : { ok: false, reason: "unreadable" };
  });
}

/**
 * The seven agenda days from `from`, from the SAME month calendar the Calendar view draws, so a move, a postponement or an unavailable day shows the same
 * in both. Null when the study calendar is off for this learner, or could not be read.
 */
export async function loadAgendaDays(ctx: PlanCtx, policy: IndividualPolicy, c: PlanContext, from: string, today: string, count = 7): Promise<AgendaDay[] | null> {
  if (policy.scholarStudyCalendar !== "on") return null;
  const reads = await Promise.all(monthsOfWeek(from, count).map(month => readStudyCalendar({ admin: ctx.admin, userId: ctx.userId, month, today, needPostponed: false })));
  return agendaFrom(reads, policy, c, from, today, count);
}
/** Pure. The agenda days from the months' reads and the plan (null when a month could not be read). */
function agendaFrom(reads: readonly (CalendarReads | null)[], policy: IndividualPolicy, c: PlanContext, from: string, today: string, count: number): AgendaDay[] | null {
  const months = monthsOfWeek(from, count);
  const views = months.map((month, i) => (reads[i] ? buildStudyCalendar(reads[i]!, { policy, month, today, plan: calendarPlanOf(c) }) : null));
  if (views.some(v => !v)) return null;
  return mergeDueRevisionDays(weekAgenda(views.flatMap(v => (v ? v.view.days : [])), from, today, count));
}

export type TodayView = {
  ok: true;
  today: string; tz: string;
  /** A plan is saved. False: the starting plan stands in (see `starting`). */
  hasPlan: boolean;
  starting: boolean;
  settings: ScholarPlanSettings;
  next: PlanRecommendation | null;
  /** What the next activity is about ("Renal · from Renal notes"), or null. */
  nextAbout: string | null;
  /** After the main card: the next few planned and personal items, from the same days the Calendar shows. */
  comingUp: ComingUpItem[];
  /** Today's items from the same calendar (own entries, the plan, cards due once, what was done), or null when the calendar is off. */
  todayItems: CalendarItem[] | null;
  /** What was done today, from qualifying records, and the learner's own marks shown apart. */
  doneToday: DoneItem[];
  alternatives: PlanRecommendation[];
  dueCards: number;
  upcomingMonthlyReview: { month: string; recommendedDate: string; late: boolean; startHref: string } | null;
  notes: TodayNote[];
  /** Planned activities the learner took back (Reschedule uses the calendar move). */
  missed: MissedItem[];
  week: StudyPlanResult | null;
  examOffers: ExamOffer[];
  /** The learner's own calendar entries for the next seven days (today first), beside the plan. */
  personalWeek: Occurrence[];
  declinedHidden: number;
  features: PlanFeatures;
  reflection: { enabled: boolean; week: string; answered: boolean; offer: ReflectionOffer | null };
};

function unfinishedOf(sessions: { id: string; title: string; lastActiveAt: string }[], rev: { id: string; mode: string; lastActiveAt: string; position: number; total: number }[], today: string): UnfinishedItem[] {
  const recent = (iso: string) => (Date.parse(`${today}T00:00:00Z`) - Date.parse(iso)) / 86_400_000 <= 14;
  return [
    ...sessions.filter(s => recent(s.lastActiveAt)).map(s => ({ id: `learn-${s.id}`, title: s.title, kind: "lesson" as const, lastAt: s.lastActiveAt, href: `${experienceHref("scholar", "study/learn")}?session=${encodeURIComponent(s.id)}` })),
    ...rev.filter(r => recent(r.lastActiveAt)).map(r => ({ id: `revise-${r.id}`, title: `your ${r.mode === "mock" ? "mock " : ""}revision session`, kind: "revision" as const, lastAt: r.lastActiveAt, href: `${experienceHref("scholar", "study/revise")}?session=${encodeURIComponent(r.id)}` })),
  ];
}

/**
 * Today for the learner: ONE next activity with why / why now / if postponed, two alternatives, the cards due, the monthly review that is coming,
 * and notes (the routine changes made, each with an undo). A carry-over of an unfinished planned activity is recorded ONCE (auto_adjust,
 * idempotent by activity and day) the first time it is shown, and only where 840 is present. Reads only otherwise.
 */
export async function loadToday(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; /** SCHOLAR-REVISE-WORKSPACE-01: read the plan and record nothing. Revise shows the plan; only My Plan changes it. */ readOnly?: boolean }): Promise<TodayView | NotReady> {
  const { admin, userId } = ctx;
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) return gateReason(policy, plan780);
  // MY PLAN PERF: what Today shows beside the plan (the seven agenda days' calendars, the unfinished sessions, the monthly review) does not depend on the plan
  // context, so it is read while the context loads, not after it. The pure builds and the choice of the next activity still run on the context afterwards.
  const weekMonths = monthsOfWeek(o.today, 7);
  const calOn = policy.scholarStudyCalendar === "on";
  const readsP = guard(Promise.all(weekMonths.map(month => (calOn ? readStudyCalendar({ admin, userId, month, today: o.today, needPostponed: false }) : Promise.resolve(null)))));
  const besideP = guard((async () => {
    // the monthly review's weak topics, from the most recent original review (read beside the overview: it is the overview's own "latest", from the same list)
    const weakP = guard((async () => {
      const reviews = monthlyReviewOn(policy) ? await listMonthlyReviews(admin, userId) : null;
      const latest = (reviews ?? []).filter(r => r.retakeOf === null).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (!latest) return null;
      const ev = await getEvaluation(admin, userId, latest.id);
      const b = ev.ok && ev.data ? (ev.data.results?.monthly as MonthlyBreakdown | undefined) : undefined;
      const topics = b ? weakTopics(b, 3) : [];
      return topics.length ? { month: latest.month, topics } : null;
    })());
    const [ls, rs, mo] = await Promise.all([
      listLearningSessions(admin, userId, 10), listRevisionSessions(admin, userId, 10),
      monthlyReviewOn(policy) ? loadMonthlyOverview(admin, userId, policy, o.today) : Promise.resolve(null),
    ]);
    const monthlyWeak: { month: string; topics: string[] } | null = mo ? await weakP : null;
    return { ls, rs, mo, monthlyWeak };
  })());
  const c = await loadPlanContext(ctx, policy, { ...o, entriesTo: entriesHorizon(weekMonths[0], o.today) });
  if (!c.ok) return c;
  const today = c.today;
  const yesterday = plusDays(today, -1);
  const notes: TodayNote[] = [];
  let missed: MissedItem[] = [];
  let carried: CarryNote[] = [];
  const base = planInputOf(c, today);
  let week: StudyPlanResult = buildStudyPlan(base);
  // A carry-over is recorded once, and only for a plan the learner SAVED: the starting plan never writes anything.
  if (c.features.decisions && !c.starting) {
    const past = buildStudyPlan({ ...base, today: yesterday });
    const r = detectCarryOvers({ past, current: week, yesterday, events: c.events });
    carried = r.carried; missed = r.missed;
    if (r.excludeRefs.length) week = buildStudyPlan({ ...base, excludeRefs: new Set(r.excludeRefs) });
    if (!o.readOnly) await Promise.all(carried.filter(n => !n.recorded).map(n => appendPlanEvent(admin, userId, "scholar", { kind: "auto_adjust", ref: n.key, status: "applied", value: { activityRef: n.ref, title: n.title.slice(0, 120), from: n.from, to: n.to, reason: n.reason.slice(0, 300) } })));
    for (const n of carried) notes.push({ text: n.reason, undo: { kind: "auto_adjust", ref: n.key } });
  }
  for (const m of missed) notes.push({ text: `"${m.title}" from ${m.from} is Missed, not rescheduled. You can reschedule it from the calendar.` });
  if (c.calendar.blockedDays.includes(today)) notes.push({ text: "Nothing is planned today: you marked it as busy." });
  for (const t of c.calendar.timedNotes[today] ?? []) notes.push({ text: `Today's study fits ${t}.` });
  for (const n of week.notes) notes.push({ text: n });

  const { ls, rs, mo, monthlyWeak } = await besideP;
  const unfinished = unfinishedOf(
    ls.ok ? ls.data.filter(s => s.status === "active").map(s => ({ id: s.id, title: s.title, lastActiveAt: s.lastActiveAt })) : [],
    rs.ok ? rs.data.filter(r => r.status === "active").map(r => ({ id: r.id, mode: r.mode, lastActiveAt: r.lastActiveAt, position: r.position, total: r.total })) : [], today,
  );
  // The Calendar and Today read one plan: an activity the learner moved off today in the Calendar is not suggested here, and one moved onto today appears below.
  const agenda = calOn ? agendaFrom(await readsP, policy, c, today, today, 7) : null;
  const planned = new Set((agenda?.find(d => d.date === today)?.items ?? []).flatMap(i => (i.kind === "planned" ? [planRefOfKey(i.key) ?? ""] : [])));
  // moved off today: an item whose original day was today (from the calendar's own moves), or a plan activity of today the calendar no longer shows (cards due excepted: its count is the calendar's own)
  const movedOffToday = new Set<string>(agenda
    ? [
      ...agenda.flatMap(d => d.items.flatMap(i => (i.kind === "planned" && i.movedFrom === today ? [planRefOfKey(i.key) ?? ""] : []))),
      ...(week.thisWeek.find(d => d.day === today)?.activities ?? []).map(a => a.ref).filter(r => r !== "revise:due" && !planned.has(r)),
    ].filter(Boolean)
    : []);
  // CHECKLIST STUDIO S3: the learner's OWN self-assessment gaps, only when the rule is in their order (the module gate and the readiness probe are the adapter's).
  const competencyGaps = policy.scholarPlanRuleOrder.includes("competency") ? await competencyGapsForPlan(admin, userId) : [];
  const choice = chooseToday({
    competencyGaps, today, ruleOrder: policy.scholarPlanRuleOrder, settings: c.settings, plan: week, entries: c.mastery.topics, dueCards: c.dueCards, unfinished, monthlyWeak,
    coverage: c.unstarted.filter(u => (u.materialIds ?? []).length > 0), calendar: c.occurrences, events: c.events, postponed: c.postponed,
    moved: movedOffToday, fallbackMinutes: Math.min(30, Math.max(10, sessionMinutesOf(c.settings))),
  });
  const nextAbout = choice.next ? relatesTo(choice.next, c.mastery.topics, c.materials) : null;

  const nudge = mo && !mo.optedOut ? mo.nudges[0] : null;
  const wk = isoWeek(today);
  const refl = latestPerRef(c.events.filter(e => e.kind === "reflection")).get(wk) ?? null;
  const reflWorkload = refl && typeof refl.value.workload === "string" ? (refl.value.workload as Workload) : null;
  return {
    ok: true, today, tz: c.tz, hasPlan: !c.starting, starting: c.starting, settings: c.settings, next: choice.next, nextAbout, alternatives: choice.alternatives, dueCards: c.dueCards,
    comingUp: agenda ? buildComingUp(agenda, { today, nextRef: choice.next?.ref ?? null, fromTomorrow: true }) : [], doneToday: agenda ? buildDoneToday(agenda, today) : [], todayItems: agenda ? agenda.find(d => d.date === today)?.items ?? [] : null,
    upcomingMonthlyReview: nudge ? { month: nudge.month, recommendedDate: nudge.recommended, late: nudge.late, startHref: experienceHref("scholar", "study/evaluate") } : null,
    notes, missed, week, examOffers: examOffers(c.occurrences, c.settings, today), personalWeek: c.occurrences.filter(x => x.status !== "cancelled" && x.date >= today && x.date <= plusDays(today, 6)), declinedHidden: choice.declined, features: c.features,
    reflection: {
      enabled: policy.scholarPlanWeeklyReflection === "on" && c.features.decisions, week: wk, answered: refl !== null,
      offer: reflWorkload ? reflectionOffer(reflWorkload, c.settings, policy.scholarPlanMaxWeeklyMinutes) : null,
    },
  };
}

// ── INSIGHTS ──
export type InsightsView = {
  ok: true; today: string; insights: Insights;
  /** The four tiles over the last 28 days. */
  tiles: InsightTiles;
  /** What the learner can do about it, each with where to do it now and, where it is meaningful, how to put it in the plan. */
  adjustments: Adjustment[];
  settings: ScholarPlanSettings;
  starting: boolean;
  features: Pick<PlanFeatures, "settingsExtras" | "decisions" | "learnerCalendar">;
} | NotReady;
/** Study consistency, practice performance and retention evidence for the learner, each "not measured" without evidence, never zero; the four tiles and the adjustments. */
export async function loadInsights(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }): Promise<InsightsView> {
  const { admin, userId } = ctx;
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) return gateReason(policy, plan780);
  // MY PLAN PERF: the evidence rows do not depend on the plan context, so they are read while it loads.
  const evidenceP = guard(Promise.all([evaluationEvidence(admin, userId), learningEventTimes(admin, userId), caseDecisionTimes(admin, userId)]));
  const c = await loadPlanContext(ctx, policy, o);
  if (!c.ok) return c;
  const [ev, lessons, decisions] = await evidenceP;
  if (!ev.ok) return { ok: false, reason: "unreadable" };
  const d = ev.data;
  const stamps: StudyStamp[] = [
    ...d.attempts.map(a => ({ kind: "answer" as const, at: a.answeredAt })), ...d.reviews.map(r => ({ kind: "review" as const, at: r.reviewedAt })),
    ...(lessons.ok ? lessons.data.map(at => ({ kind: "lesson" as const, at })) : []), ...(decisions.ok ? decisions.data.map(at => ({ kind: "decision" as const, at })) : []),
    ...d.checks.map(x => ({ kind: "check" as const, at: x.createdAt })),
  ];
  const studyDays = studyActivityDays(stamps, c.tz);
  const insights = buildInsights({
    studyDays, today: c.today,
    attempts: d.attempts.map(a => ({ marking: a.marking, correct: a.correct, answeredAt: a.answeredAt })), reviews: d.reviews.map(r => ({ quality: r.quality, reviewedAt: r.reviewedAt })),
    selfReported: c.features.learnerCalendar ? selfReportedStudy(c.occurrences.filter(x => x.date <= c.today)) : null,
  });
  const declined = new Map([...latestPerRef(c.events.filter(e => e.kind === "recommendation_declined" && e.ref.startsWith("insight:"))).entries()]
    .map(([ref, e]) => [ref, typeof e.value.fingerprint === "string" ? e.value.fingerprint : null] as const));
  const hrefs = {
    flashcards: experienceHref("scholar", "study/revise/flashcards"), revise: experienceHref("scholar", "study/revise"),
    mistakes: experienceHref("scholar", "study/revise/mistakes"), learn: experienceHref("scholar", "study/learn"),
  };
  return {
    ok: true, today: c.today, insights,
    tiles: buildTiles({ studyDays, today: c.today, tz: c.tz, dueCards: c.dueCards, attempts: d.attempts, occurrences: c.occurrences }),
    adjustments: buildAdjustments({ insights, dueCards: c.dueCards, today: c.today, hrefs, settings: c.settings, canAddEntry: c.features.learnerCalendar, declined }),
    settings: c.settings, starting: c.starting,
    features: { settingsExtras: c.features.settingsExtras, decisions: c.features.decisions, learnerCalendar: c.features.learnerCalendar },
  };
}

// ── PROPOSAL ──
export type ProposalView = {
  ok: true; proposal: PlanProposal; decision: ProposalDecision | null; hasPlan: boolean; recordable: boolean;
  /** LEARNING-CLOSE-2026-11 LE-02: the learning units the latest acceptance carries (null: not accepted, or accepted without units), for a re-review. */
  accepted: StoredUnit[] | null;
} | { ok: false; reason: "off" | "not_provisioned" | "unreadable" | "not_found" };
/**
 * The proposal for one of the learner's own materials, the current decision, and whether a plan already exists (first versus later
 * upload). Reads only. `recordable` is false without 840: the proposal is still shown but the answer cannot be remembered.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the same time argument every plan read takes, kept so the services call them alike
export async function loadProposal(ctx: PlanCtx, policy: IndividualPolicy, materialId: string, _o: { now: Date; tz: string; today: string }): Promise<ProposalView> {
  const { admin, userId } = ctx;
  if (policy.scholarPlanProposal !== "on") return { ok: false, reason: "off" };
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) return { ok: false, reason: plan780 ? "off" : "not_provisioned" };
  const [mats, row, has840, rows] = await Promise.all([listMaterials(admin, userId), getStudyPlan(admin, userId), learningPlanSchema(admin, userId), competencyProgressRows(admin, userId)]);
  if (!mats.ok || !row.ok) return { ok: false, reason: "unreadable" };
  const mat = mats.data.find(m => m.id === materialId);
  if (!mat) return { ok: false, reason: "not_found" };
  const evs = has840 ? await listPlanEvents(admin, userId, "scholar", ["proposal"]) : null;
  const events = evs?.ok ? evs.data : [];
  const decision = proposalDecisions(events).get(materialId) ?? null;
  const earlierIds = acceptedMaterialIds(events).filter(id => id !== materialId && mats.data.some(m => m.id === id));
  const all = await materialsIn(admin, userId, [materialId, ...earlierIds], mats.data, rows.ok ? rows.data : null, policy.scholarPlanStartedSignal);
  const self = all.find(m => m.materialId === materialId) ?? { materialId, title: mat.title, sections: [] };
  const s = row.data;
  // SCHOLAR-PLAN-UNITS-01: the material's own text (headings, size) and extraction quality make the learning units and their estimates.
  const [profiles, qualities] = await Promise.all([sectionProfiles(admin, userId, self.sections.map(x => x.chunkId)), materialQualities(admin, userId, [materialId])]);
  const units = profiles.size ? buildUnits({ materialId, title: self.title, unit: self.unit ?? "section", sections: self.sections, profiles, quality: qualities.get(materialId) ?? null }) : null;
  const proposal = buildProposal({
    material: self, earlier: all.filter(m => m.materialId !== materialId),
    settings: s ? { sessionMinutes: s.sessionMinutes ?? Math.max(10, Math.round(s.weeklyMinutes / Math.max(1, s.daysPerWeek))), daysPerWeek: s.daysPerWeek } : null,
    sectionMinutes: policy.scholarPlanSectionMinutes, firstPlan: s === null && earlierIds.length === 0, units,
  });
  // LEARNING-CLOSE-2026-11 LE-02: the units as accepted (the latest acceptance's), checked against this material's own ordinals.
  const accepted = decision === "accepted" ? storedUnitsOf(events, self.sections.map(x => ({ materialId, ordinal: x.ordinal }))).get(materialId) ?? null : null;
  // A plan exists once settings are saved OR a material has been accepted into it: the next upload is offered as an addition.
  return { ok: true, proposal, decision, hasPlan: s !== null || earlierIds.length > 0, recordable: has840, accepted };
}
