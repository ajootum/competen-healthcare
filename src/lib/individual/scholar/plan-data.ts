import { appendPlanEvent, learningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { learnerCalendarSchema, listEntries } from "../learning-plan/entry-store";
import { expandEntries, plusDays } from "../learning-plan/recurrence";
import { latestPerRef, type Occurrence, type PlanEvent, type ScholarPlanSettings } from "../learning-plan/types";
import { isMyPlanOn, type IndividualPolicy } from "../policy";
import { loadLearnerCatalogue } from "./competency-view";
import { studyActivityDays, selfReportedStudy, type StudyStamp } from "./learning-definitions";
import { loadMastery } from "./mastery-data";
import type { MasteryResult } from "./mastery";
import { weakTopics, type MonthlyBreakdown } from "./monthly-review";
import { listMonthlyReviews, loadMonthlyOverview, monthlyReviewOn } from "./monthly-review-data";
import { detectCarryOvers, type CarryNote, type MissedItem } from "./plan-carry";
import { examOffers, planCalendarFrom, type ExamOffer } from "./plan-calendar";
import { buildInsights, type Insights } from "./plan-insights";
import { acceptedMaterialIds, acceptedUnstarted, buildProposal, postponedTopics, proposalDecisions, type MaterialIn, type PlanProposal, type ProposalDecision } from "./plan-proposal";
import { chooseToday, type PlanRecommendation, type UnfinishedItem } from "./plan-recommend";
import { isoWeek, reflectionOffer, type ReflectionOffer, type Workload } from "./plan-reflection";
import { settingsFromRow, sessionMinutesOf } from "./plan-settings";
import { buildStudyPlan, unstartedMappedSections, type PlanCalendar, type StudyPlanInput, type StudyPlanResult, type StudyPlanSettings, type UnstartedSection } from "./study-plan";
import {
  calendarSchema, caseDecisionTimes, competencyProgressRows, countDue, evaluationEvidence, getEvaluation, getStudyPlan, learningEventTimes, listLearningSessions, listMaterials,
  listChunks, listRevisionSessions, sectionsOf, studyPlanSchema, topicsOfSections, type Admin,
} from "./store";
import { experienceHref } from "../experiences";
import { loadStudyCalendar, type CalendarLoad } from "./study-calendar-data";
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
  settings: ScholarPlanSettings | null;
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

const EVENT_KINDS = ["proposal", "topic_postponed", "recommendation_declined", "reflection", "auto_adjust", "settings_change"] as const;

/**
 * Everything the plan reads, once. `reason: "off"` when HQ has My Plan (or the study plan) off, "not_provisioned" without 780.
 * The learner calendar occurrences cover 90 days back (for self-reported study) to 60 days ahead.
 */
export async function loadPlanContext(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }): Promise<PlanContext | NotReady> {
  const { admin, userId } = ctx;
  const plan780 = await studyPlanSchema(admin, userId);
  if (!isMyPlanOn(policy, plan780)) return { ok: false, reason: policy.scholarMyPlan === "on" && policy.scholarStudyPlan && !plan780 ? "not_provisioned" : "off" };
  const [has840, hasEntries, has830] = await Promise.all([learningPlanSchema(admin, userId), learnerCalendarSchema(admin, userId), calendarSchema(admin, userId)]);
  const [row, mats, rows] = await Promise.all([getStudyPlan(admin, userId), listMaterials(admin, userId), competencyProgressRows(admin, userId)]);
  if (!row.ok || !mats.ok) return { ok: false, reason: "unreadable" };
  const learner = await loadLearnerCatalogue(admin, userId);
  const competencies = learner?.provisioned && learner.programme && learner.competencies ? learner.competencies.map(c => ({ id: c.id, title: c.title })) : null;
  const mastery = await loadMastery(admin, userId, policy, o.now.toISOString(), {
    materials: mats.data.map(m => ({ id: m.id, title: m.title })), linked: rows.ok ? { mappings: rows.data.mappings, concepts: rows.data.concepts } : null, competencies,
  });
  if (!mastery.ok) return { ok: false, reason: "unreadable" };
  const due = await countDue(admin, userId);
  if (due === null) return { ok: false, reason: "unreadable" };

  const evs = has840 ? await listPlanEvents(admin, userId, "scholar", EVENT_KINDS) : null;
  const events = evs?.ok ? evs.data : [];
  if (evs && !evs.ok && !evs.notProvisioned) return { ok: false, reason: "unreadable" };

  // accepted materials feed the plan: their unstarted sections, in the order accepted, a topic counted once
  const acceptedIds = acceptedMaterialIds(events).filter(id => mats.data.some(m => m.id === id));
  const accepted = await materialsIn(admin, userId, acceptedIds, mats.data, rows.ok ? rows.data : null);
  const mapped = rows.ok && competencies
    ? unstartedMappedSections({ mappings: rows.data.mappings, concepts: rows.data.concepts, questions: rows.data.questions, attempts: rows.data.attempts, competencies })
    : [];
  const unstarted = acceptedUnstarted(accepted, mapped);

  let occurrences: Occurrence[] = [];
  if (hasEntries) {
    const le = await listEntries(admin, userId, "scholar", plusDays(o.today, 60));
    if (le.ok) occurrences = expandEntries(le.data.entries, le.data.exceptions, plusDays(o.today, -90), plusDays(o.today, 60));
  }
  return {
    ok: true, today: o.today, tz: o.tz,
    features: { settingsExtras: has840, decisions: has840, learnerCalendar: hasEntries, calendarMoves: has830 },
    settings: row.data ? settingsFromRow(row.data) : null,
    mastery: mastery.data, dueCards: due, unstarted, accepted, events, occurrences,
    postponed: postponedTopics(events, o.today), calendar: planCalendarFrom(occurrences), materials: mats.data.map(m => ({ id: m.id, title: m.title })),
  };
}

/** The sections of these materials with their topics and whether each has been practised, as the proposal and the plan read them. */
export async function materialsIn(admin: Admin, userId: string, ids: readonly string[], mats: readonly { id: string; title: string }[], rows: { questions: { id: string; chunkId: string }[]; attempts: { questionId: string }[] } | null): Promise<MaterialIn[]> {
  if (!ids.length) return [];
  const secs = await sectionsOf(admin, userId, ids);
  if (!secs.ok) return [];
  const topics = await topicsOfSections(admin, userId, secs.data.map(s => s.chunkId));
  // A section with no topic found yet is named by its own first line (a slide or page heading), never "Section n" when the text says more.
  const untitled = ids.filter(id => secs.data.some(s => s.materialId === id && !(topics.get(s.chunkId) ?? []).length));
  const headings = new Map<string, string>();
  for (const id of untitled.slice(0, 5)) {
    const c = await listChunks(admin, userId, id);
    if (c.ok) for (const r of c.data) { const h = headingOf(r.content); if (h) headings.set(r.id, h); }
  }
  const answered = new Set((rows?.attempts ?? []).map(a => a.questionId));
  const started = new Set((rows?.questions ?? []).filter(q => answered.has(q.id)).map(q => q.chunkId));
  return ids.map(id => ({
    materialId: id, title: mats.find(m => m.id === id)?.title ?? "Your notes",
    sections: secs.data.filter(s => s.materialId === id).map(s => ({ chunkId: s.chunkId, ordinal: s.ordinal, topics: topics.get(s.chunkId) ?? [], started: started.has(s.chunkId), heading: headings.get(s.chunkId) ?? null })),
  }));
}

/** Pure. A section's first line, cleaned of markdown and bullets, up to 80 characters (null when there is none worth showing). */
export function headingOf(content: string): string | null {
  const line = content.split(/\n/).map(l => l.replace(/^[\s#*•●▪·–-]+/, "").replace(/\*\*/g, "").trim()).find(l => l.length >= 3) ?? "";
  return line ? (line.length > 80 ? `${line.slice(0, 77).trimEnd()}…` : line) : null;
}

/** The inputs of buildStudyPlan for a day, from the context. */
export function planInputOf(c: PlanContext, today: string, extra: Partial<StudyPlanInput> = {}): StudyPlanInput | null {
  if (!c.settings) return null;
  const s = c.settings;
  return {
    plan: { examDate: s.examDate, examLabel: s.examLabel, weeklyMinutes: s.weeklyMinutes, daysPerWeek: s.daysPerWeek, goal: s.goal, priorities: s.priorities },
    entries: c.mastery.topics, dueCards: c.dueCards, unstarted: c.unstarted, today, postponed: c.postponed, calendar: c.calendar, ...extra,
  };
}

// ── TODAY ──
export type TodayNote = { text: string; /** The undo token for an automatic change: POST plan/decision { kind: "auto_adjust", ref, status: "undone" }. */ undo?: { kind: "auto_adjust"; ref: string } };
/** The plan the study calendar is built from: the saved settings, the evidence, the unstarted sections (accepted materials included), postponed topics and the learner's own calendar. Null with no saved plan. */
export function calendarPlanOf(c: PlanContext): { settings: StudyPlanSettings; entries: readonly MasteryEntry[]; unstarted: readonly UnstartedSection[]; postponed: ReadonlySet<string>; calendar: PlanCalendar } | null {
  if (!c.settings) return null;
  const s = c.settings;
  return { settings: { examDate: s.examDate, examLabel: s.examLabel, weeklyMinutes: s.weeklyMinutes, daysPerWeek: s.daysPerWeek, goal: s.goal, priorities: s.priorities }, entries: c.mastery.topics, unstarted: c.unstarted, postponed: c.postponed, calendar: c.calendar };
}

/** The month calendar for My Plan: the study calendar (planned, due, done, monthly review) plus the learner's own entries, from one context. */
export async function loadPlanCalendar(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string; month: string }): Promise<{ ok: true; calendar: CalendarLoad | null; features: PlanFeatures } | NotReady> {
  const c = await loadPlanContext(ctx, policy, o);
  if (!c.ok) return c;
  if (policy.scholarStudyCalendar !== "on") return { ok: true, calendar: null, features: c.features };
  const calendar = await loadStudyCalendar({ admin: ctx.admin, userId: ctx.userId, policy, month: o.month, today: o.today, plan: calendarPlanOf(c) });
  return calendar ? { ok: true, calendar, features: c.features } : { ok: false, reason: "unreadable" };
}

export type TodayView = {
  ok: true;
  today: string; tz: string;
  hasPlan: boolean;
  settings: ScholarPlanSettings | null;
  next: PlanRecommendation | null;
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
export async function loadToday(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }): Promise<TodayView | NotReady> {
  const c = await loadPlanContext(ctx, policy, o);
  if (!c.ok) return c;
  const { admin, userId } = ctx;
  const today = c.today;
  const yesterday = plusDays(today, -1);
  const notes: TodayNote[] = [];
  let missed: MissedItem[] = [];
  let carried: CarryNote[] = [];
  let week: StudyPlanResult | null = null;
  const base = planInputOf(c, today);
  if (base) {
    week = buildStudyPlan(base);
    if (c.features.decisions) {
      const past = buildStudyPlan({ ...base, today: yesterday });
      const r = detectCarryOvers({ past, current: week, yesterday, events: c.events });
      carried = r.carried; missed = r.missed;
      if (r.excludeRefs.length) week = buildStudyPlan({ ...base, excludeRefs: new Set(r.excludeRefs) });
      for (const n of carried) {
        if (!n.recorded) await appendPlanEvent(admin, userId, "scholar", { kind: "auto_adjust", ref: n.key, status: "applied", value: { activityRef: n.ref, title: n.title.slice(0, 120), from: n.from, to: n.to, reason: n.reason.slice(0, 300) } });
        notes.push({ text: n.reason, undo: { kind: "auto_adjust", ref: n.key } });
      }
    }
    for (const m of missed) notes.push({ text: `"${m.title}" from ${m.from} is Missed, not rescheduled. You can reschedule it from the calendar.` });
    if (c.calendar.blockedDays.includes(today)) notes.push({ text: "Nothing is planned today: you marked it as busy." });
    for (const t of c.calendar.timedNotes[today] ?? []) notes.push({ text: `Today's study fits ${t}.` });
    for (const n of week.notes) notes.push({ text: n });
  }

  const [ls, rs, mo, reviews] = await Promise.all([
    listLearningSessions(admin, userId, 10), listRevisionSessions(admin, userId, 10),
    monthlyReviewOn(policy) ? loadMonthlyOverview(admin, userId, policy, today) : Promise.resolve(null), monthlyReviewOn(policy) ? listMonthlyReviews(admin, userId) : Promise.resolve(null),
  ]);
  // the monthly review's weak topics, from the most recent original review
  let monthlyWeak: { month: string; topics: string[] } | null = null;
  const latest = mo?.latest;
  if (latest) {
    const ev = await getEvaluation(admin, userId, latest.id);
    const b = ev.ok && ev.data ? (ev.data.results?.monthly as MonthlyBreakdown | undefined) : undefined;
    if (b) { const topics = weakTopics(b, 3); if (topics.length) monthlyWeak = { month: latest.month, topics }; }
  }
  void reviews;
  const unfinished = unfinishedOf(
    ls.ok ? ls.data.filter(s => s.status === "active").map(s => ({ id: s.id, title: s.title, lastActiveAt: s.lastActiveAt })) : [],
    rs.ok ? rs.data.filter(r => r.status === "active").map(r => ({ id: r.id, mode: r.mode, lastActiveAt: r.lastActiveAt, position: r.position, total: r.total })) : [], today,
  );
  const choice = chooseToday({
    today, ruleOrder: policy.scholarPlanRuleOrder, settings: c.settings, plan: week, entries: c.mastery.topics, dueCards: c.dueCards, unfinished, monthlyWeak,
    coverage: c.unstarted.filter(u => (u.materialIds ?? []).length > 0), calendar: c.occurrences, events: c.events, postponed: c.postponed,
    fallbackMinutes: Math.min(30, Math.max(10, c.settings ? sessionMinutesOf(c.settings) : 25)),
  });

  const nudge = mo && !mo.optedOut ? mo.nudges[0] : null;
  const wk = isoWeek(today);
  const refl = latestPerRef(c.events.filter(e => e.kind === "reflection")).get(wk) ?? null;
  const reflWorkload = refl && typeof refl.value.workload === "string" ? (refl.value.workload as Workload) : null;
  return {
    ok: true, today, tz: c.tz, hasPlan: c.settings !== null, settings: c.settings, next: choice.next, alternatives: choice.alternatives, dueCards: c.dueCards,
    upcomingMonthlyReview: nudge ? { month: nudge.month, recommendedDate: nudge.recommended, late: nudge.late, startHref: experienceHref("scholar", "study/evaluate") } : null,
    notes, missed, week, examOffers: examOffers(c.occurrences, c.settings, today), personalWeek: c.occurrences.filter(x => x.status !== "cancelled" && x.date >= today && x.date <= plusDays(today, 6)), declinedHidden: choice.declined, features: c.features,
    reflection: {
      enabled: policy.scholarPlanWeeklyReflection === "on" && c.features.decisions, week: wk, answered: refl !== null,
      offer: reflWorkload ? reflectionOffer(reflWorkload, c.settings, policy.scholarPlanMaxWeeklyMinutes) : null,
    },
  };
}

// ── INSIGHTS ──
export type InsightsView = { ok: true; today: string; insights: Insights } | NotReady;
/** Study consistency, practice performance and retention evidence for the learner, each "not measured" without evidence, never zero. */
export async function loadInsights(ctx: PlanCtx, policy: IndividualPolicy, o: { now: Date; tz: string; today: string }): Promise<InsightsView> {
  const c = await loadPlanContext(ctx, policy, o);
  if (!c.ok) return c;
  const { admin, userId } = ctx;
  const [ev, lessons, decisions] = await Promise.all([evaluationEvidence(admin, userId), learningEventTimes(admin, userId), caseDecisionTimes(admin, userId)]);
  if (!ev.ok) return { ok: false, reason: "unreadable" };
  const d = ev.data;
  const stamps: StudyStamp[] = [
    ...d.attempts.map(a => ({ kind: "answer" as const, at: a.answeredAt })), ...d.reviews.map(r => ({ kind: "review" as const, at: r.reviewedAt })),
    ...(lessons.ok ? lessons.data.map(at => ({ kind: "lesson" as const, at })) : []), ...(decisions.ok ? decisions.data.map(at => ({ kind: "decision" as const, at })) : []),
    ...d.checks.map(x => ({ kind: "check" as const, at: x.createdAt })),
  ];
  return {
    ok: true, today: c.today,
    insights: buildInsights({
      studyDays: studyActivityDays(stamps, c.tz), today: c.today,
      attempts: d.attempts.map(a => ({ marking: a.marking, correct: a.correct, answeredAt: a.answeredAt })), reviews: d.reviews.map(r => ({ quality: r.quality, reviewedAt: r.reviewedAt })),
      selfReported: c.features.learnerCalendar ? selfReportedStudy(c.occurrences.filter(x => x.date <= c.today)) : null,
    }),
  };
}

// ── PROPOSAL ──
export type ProposalView = { ok: true; proposal: PlanProposal; decision: ProposalDecision | null; hasPlan: boolean; recordable: boolean } | { ok: false; reason: "off" | "not_provisioned" | "unreadable" | "not_found" };
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
  const all = await materialsIn(admin, userId, [materialId, ...earlierIds], mats.data, rows.ok ? rows.data : null);
  const self = all.find(m => m.materialId === materialId) ?? { materialId, title: mat.title, sections: [] };
  const s = row.data;
  const proposal = buildProposal({
    material: self, earlier: all.filter(m => m.materialId !== materialId),
    settings: s ? { sessionMinutes: s.sessionMinutes ?? Math.max(10, Math.round(s.weeklyMinutes / Math.max(1, s.daysPerWeek))), daysPerWeek: s.daysPerWeek } : null,
    sectionMinutes: policy.scholarPlanSectionMinutes, firstPlan: s === null,
  });
  return { ok: true, proposal, decision, hasPlan: s !== null, recordable: has840 };
}
