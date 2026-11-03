import { experienceHref } from "@/lib/individual/experiences";
import { COGNITIVE_LEVELS } from "./question-intel";
import { withStudy } from "./study-carry";
import { topicKey } from "./plan-proposal";
import type { MasteryEntry } from "./mastery";

// ── THE STUDY PLAN ── SCHOLAR-COMPANION-01, Learning and Progress Intelligence E ────────────────────────────────
//
// Pure: no I/O, no clock of its own (`today` is passed in), NO AI, and the plan is never stored. What the learner typed
// (the exam date, the time they have, their goal and priority topics: individual_scholar_study_plan, migration 780) and
// what their practice already shows (topic entries from buildMastery, cards due, programme sections mapped to a
// competency but never practised) are turned into the next seven days of study. The same input always gives the same plan.
//
// THE RULES, in the order they are applied
//   1. Time. A session is weekly minutes / days per week. Each session holds 1 or more activities of 15 to 30 minutes
//      (about 25). Where the time is too short for the days chosen (under 15 minutes a day), fewer days are used and the
//      plan says so.
//   2. Cards due. Every session starts with a spaced-review activity while cards are due (Revise). A session of one
//      activity alternates it with new study.
//   3. Priorities first: the topics the learner named come before everything else. A priority on a topic that needs work
//      or is not started is Learn, one that is developing and below application is Apply, otherwise Revise.
//   4. Needs work: Learn, then Revise to check it holds.
//   5. Developing and not yet shown at application level: Apply.
//   6. Mapped sections never practised are SPREAD across the weeks remaining (a share each week), never all at once. With
//      no exam date the spread is over four weeks.
//   7. Phase. build (more than 21 days left) puts new ground before checking. consolidate (8 to 21 days) checks and applies
//      before new ground, and adds light revision of what is going well. final_week (7 days or fewer, up to the day
//      before the exam) is mixed practice, review of the weak topics and one evaluate activity. no_date is a rolling week.
//   8. Whatever time is left is mixed practice across the learner's own topics.
//
// PLP-01..04 / MY PLAN CALENDAR (owner GO 2 Nov 2026), all optional inputs, so the plan above is unchanged without them:
//   - every activity has a STABLE `ref` (`${space}:${topic key | chunk id | "due" | "mixed"}`), so a move survives a change of wording;
//   - `postponed` topics (put off by the learner) and `excludeRefs` (a carry-over the learner took back) are left out;
//   - `calendar` (the learner's OWN entries, plan-calendar.ts): an all-day busy day or placement plans no study that day (the week's minutes
//     are shared across the days left, never above the agreed time); a timed one leaves the day open and is noted; a personal study session
//     takes its minutes off that day (and its topic is not planned that day too).
//
// ⚠ A STUDY PLAN IS NOT AN ASSESSMENT. Nothing here says how competent anyone is, and nothing is written to the Passport.
// ⚠ EVERY REASON IS IN THE LEARNER'S OWN NUMBERS (their accuracy, their cards, their sections), or their own choice.

export type PlanSpace = "learn" | "revise" | "apply" | "evaluate";
export type StudyPlanPhase = "build" | "consolidate" | "final_week" | "no_date";

export type StudyPlanSettings = {
  /** YYYY-MM-DD, or null. */
  examDate: string | null;
  examLabel: string | null;
  weeklyMinutes: number;
  daysPerWeek: number;
  goal: string | null;
  priorities: readonly string[];
};
export type UnstartedSection = {
  chunkId: string; label: string; competencyTitle?: string | null; materialIds?: readonly string[];
  /** SCHOLAR-PLAN-UNITS-01: a learning unit of an accepted material (several sections, opened together), else one section. */
  kind?: "section" | "unit"; chunkIds?: readonly string[]; sections?: number; minutes?: number | null;
};
/** The most sections one Learn link opens (learn.ts MAX_SCOPE_SECTIONS, repeated so this file stays client-safe). */
const UNIT_LINK_SECTIONS = 24;
/** Pure. Where "Start on" opens: one section, or all of a unit's sections as chosen sources. */
export const unstartedHref = (s: Pick<UnstartedSection, "chunkId" | "chunkIds">) =>
  (s.chunkIds && s.chunkIds.length > 1 ? learnHref(s.chunkIds.slice(0, UNIT_LINK_SECTIONS).map(id => `s=${encodeURIComponent(id)}`).join("&")) : learnHref(`section=${s.chunkId}`));
/** Pure. Why a unit or section is planned, in the learner's own numbers. */
export const unstartedReason = (s: UnstartedSection): string => {
  if (s.kind === "unit") {
    const size = `${s.sections ?? 1} ${s.sections === 1 ? "section" : "sections"}${s.minutes ? `, about ${s.minutes} minutes in all` : ""}`;
    return `This learning unit of your notes (${size}) has no practice yet${s.minutes && s.minutes > MAX_ACTIVITY_MINUTES ? ", so it may take more than one session" : ""}.`;
  }
  return s.competencyTitle ? `This section of your notes is linked to ${s.competencyTitle} and has no practice yet.` : "This section of your notes has no practice yet.";
};
/** The learner's own calendar as the plan reads it (plan-calendar.ts). Dates are YYYY-MM-DD. */
export type PlanCalendar = {
  /** Days with an all-day busy or placement entry: no study is planned. */
  blockedDays: readonly string[];
  /** Day -> notes for timed busy or placement entries, e.g. "around your 14:00-18:00 placement". */
  timedNotes: Readonly<Record<string, readonly string[]>>;
  /** Day -> minutes of the learner's own planned study sessions. */
  personalMinutes: Readonly<Record<string, number>>;
  /** Day -> normalised topics, material ids and decks the learner's own study sessions are about. */
  personalTopics: Readonly<Record<string, readonly string[]>>;
};
export type StudyPlanInput = {
  plan: StudyPlanSettings;
  /** The topic entries of buildMastery (MasteryResult.topics). */
  entries: readonly MasteryEntry[];
  /** Spaced-review cards due today. */
  dueCards: number;
  /** Sections of the programme accepted-mapped to a competency with no practice yet. */
  unstarted: readonly UnstartedSection[];
  /** YYYY-MM-DD. */
  today: string;
  /** A connected study session: carried onto every link. */
  studyId?: string | null;
  /** Normalised topic keys or labels the learner put off: nothing about them is planned. */
  postponed?: ReadonlySet<string>;
  /** Activity refs left out (a carry-over the learner took back). */
  excludeRefs?: ReadonlySet<string>;
  /** The learner's own calendar entries, as the plan reads them. */
  calendar?: PlanCalendar | null;
};
export type PlanActivity = { space: PlanSpace; title: string; reason: string; href: string; minutes: number; ref: string; note?: string };
export type PlanDay = { day: string; minutes: number; activities: PlanActivity[] };
export type StudyPlanResult = {
  daysLeft: number | null;
  examPassed: boolean;
  phase: StudyPlanPhase;
  thisWeek: PlanDay[];
  summary: string;
  /** Plain-words things the learner should know about how this plan was made. */
  notes: string[];
  sessionMinutes: number;
  studyDays: number;
};

/** More days than this to the exam: build. At most this many (and more than FINAL_WEEK_DAYS): consolidate. */
export const CONSOLIDATE_DAYS = 21;
export const FINAL_WEEK_DAYS = 7;
export const SPREAD_WEEKS_NO_DATE = 4;
export const MIN_ACTIVITY_MINUTES = 15;
export const MAX_ACTIVITY_MINUTES = 30;
const TARGET_ACTIVITY_MINUTES = 25;
const WINDOW_DAYS = 7;
const DAY = 86_400_000;

const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, " ");
const fnv = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
/** A short, stable, URL-safe key for a topic (a-z, 0-9 and hyphens only): the same words give the same key whatever else changes. */
export const refKey = (raw: string) => { const base = norm(raw); const slug = base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, ""); return `${slug || "topic"}-${fnv(base)}`; };
const chunkKey = (id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? id.toLowerCase() : refKey(id));
export const PLAN_REF = /^(learn|revise|apply|evaluate):[a-z0-9-]{1,80}$/;
const dayNum = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY);
const addDays = (iso: string, n: number) => new Date((dayNum(iso) + n) * DAY).toISOString().slice(0, 10);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const LADDER: readonly string[] = COGNITIVE_LEVELS;
const belowApplication = (e: MasteryEntry) => e.highestLevel === null || LADDER.indexOf(e.highestLevel) < LADDER.indexOf("application");

export const learnHref = (q: string) => experienceHref("scholar", `study/learn?${q}`);
export const reviseHref = (q = "") => experienceHref("scholar", `study/revise${q ? `?${q}` : ""}`);
export const applyHref = (q = "") => experienceHref("scholar", `study/apply${q ? `?${q}` : ""}`);
const evaluateHref = () => experienceHref("scholar", "study/evaluate");

type Item = { space: PlanSpace; title: string; reason: string; href: string; ref: string; topics?: string[] };
const tag = (e: MasteryEntry): { topics: string[] } => ({ topics: [...new Set([topicKey(e.key), topicKey(e.label), ...(e.materialId ? [topicKey(e.materialId)] : [])])] });

// A material topic opens Learn on that material (the lesson itself), not the material overview page.
export const topicLearn = (e: MasteryEntry) => (e.topicSource === "material" && e.materialId ? learnHref(`material=${e.materialId}`) : learnHref(`topic=${encodeURIComponent(e.label)}`));
export const topicRevise = (e: MasteryEntry, harder = false) => reviseHref(e.materialId ? `material=${e.materialId}${harder ? "&difficulty=harder" : ""}` : "");
export const topicApply = (e: MasteryEntry) => (e.chunkId ? applyHref(`section=${e.chunkId}&from=revision`) : topicRevise(e, true));
export const noun = (e: MasteryEntry) => (e.topicSource === "material" ? `your notes "${e.label}"` : e.label);
export const acc = (e: MasteryEntry) => (e.recentAccuracy === null ? "" : ` (${e.recentAccuracy}% recent accuracy)`);

const learnItem = (e: MasteryEntry, priority: boolean): Item => ({
  space: "learn", title: `Learn ${noun(e)}`, href: topicLearn(e), ref: `learn:${refKey(e.key)}`, ...tag(e),
  reason: e.status === "not_started"
    ? (priority ? `You put ${noun(e)} first, and you have not practised it yet.` : `${noun(e)} is in your notes and you have not practised it yet.`)
    : `${priority ? `You put ${noun(e)} first, and it` : noun(e)} needs work: your recent accuracy is ${e.recentAccuracy}% over ${plural(e.attempts, "answer")}, so go back over it first.`,
});
const reviseAfterItem = (e: MasteryEntry): Item => ({
  space: "revise", title: `Check ${noun(e)} has stuck`, href: topicRevise(e), ref: `revise:${refKey(e.key)}`, ...tag(e),
  reason: `After learning ${noun(e)} again, practice questions on it show whether it holds${e.recentAccuracy === null ? "" : ` (it was ${e.recentAccuracy}%)`}.`,
});
const applyItem = (e: MasteryEntry, priority: boolean): Item => ({
  space: "apply", title: `Use ${noun(e)} in a scenario`, href: topicApply(e), ref: `apply:${refKey(e.key)}`, ...tag(e),
  reason: `${priority ? `You put ${noun(e)} first. ` : ""}You are developing on ${noun(e)}${acc(e)} and have not yet shown it at application level. A scenario shows whether it holds when you use it.`,
});
const reviseTopicItem = (e: MasteryEntry, priority: boolean): Item => ({
  space: "revise", title: `Revise ${noun(e)}`, href: topicRevise(e), ref: `revise:${refKey(e.key)}`, ...tag(e),
  reason: priority ? `You put ${noun(e)} first${e.status === "secure" ? `, and it is going well${acc(e)}, so keep it fresh` : acc(e)}.` : `Keep ${noun(e)} fresh, it is going well${acc(e)}.`,
});
const unstartedItem = (s: UnstartedSection): Item => ({
  space: "learn", title: `Start on ${s.label}`, href: unstartedHref(s), ref: `learn:${chunkKey(s.chunkId)}`, topics: [topicKey(s.label), ...(s.materialIds ?? []).map(topicKey)],
  reason: unstartedReason(s),
});
const mixedItem = (reason: string): Item => ({ space: "revise", title: "Mixed practice across your topics", href: reviseHref(), reason, ref: "revise:mixed" });
const weakReviewItem = (e: MasteryEntry): Item => ({
  space: "revise", title: `Review ${noun(e)}`, href: topicRevise(e), ref: `revise:${refKey(e.key)}`, ...tag(e),
  reason: `${noun(e)} is still ${e.status === "needs_work" ? "needing work" : "developing"}${acc(e)}, and the exam is close.`,
});

/** Pure. The next seven days of study, from the settings, the evidence and the day. Deterministic. */
export function buildStudyPlan(input: StudyPlanInput): StudyPlanResult {
  const { plan, entries, today } = input;
  const notes: string[] = [];
  const dueCards = Math.max(0, Math.floor(input.dueCards));
  const examNum = plan.examDate && Number.isFinite(dayNum(plan.examDate)) ? dayNum(plan.examDate) : null;
  const todayNum = dayNum(today);
  const rawLeft = examNum === null ? null : examNum - todayNum;
  const examPassed = rawLeft !== null && rawLeft < 0;
  const daysLeft = rawLeft !== null && rawLeft >= 0 ? rawLeft : null;
  const phase: StudyPlanPhase = daysLeft === null ? "no_date" : daysLeft <= FINAL_WEEK_DAYS ? "final_week" : daysLeft <= CONSOLIDATE_DAYS ? "consolidate" : "build";
  const exam = plan.examLabel?.trim() || "your exam";
  if (examPassed) notes.push(`The exam date you gave (${plan.examDate}) has passed, so this is a rolling weekly plan. Change the date to plan towards another exam.`);

  // ── the days: the next seven, or up to the day before the exam ──
  const windowLen = phase === "final_week" ? Math.min(WINDOW_DAYS, daysLeft!) : WINDOW_DAYS;
  const weeklyMinutes = Math.max(0, Math.floor(plan.weeklyMinutes));
  const wanted = Math.min(7, Math.max(1, Math.floor(plan.daysPerWeek)));
  const affordable = Math.max(1, Math.floor(weeklyMinutes / MIN_ACTIVITY_MINUTES));
  const perWeekDays = Math.min(wanted, affordable);
  if (perWeekDays < wanted) notes.push(`${plural(weeklyMinutes, "minute")} a week is too little for ${plural(wanted, "day")} (a session needs at least ${MIN_ACTIVITY_MINUTES} minutes), so the plan uses ${plural(perWeekDays, "day")}.`);
  let sessionMinutes = Math.round(weeklyMinutes / perWeekDays);
  // The learner's own calendar: an all-day busy day or placement plans no study. The week's minutes are shared across the days left, never above.
  const cal = input.calendar ?? null;
  const blocked = new Set(cal?.blockedDays ?? []);
  const freeIdx: number[] = [];
  for (let i = 0; i < windowLen; i++) if (!blocked.has(addDays(today, i))) freeIdx.push(i);
  const studyDays = Math.min(perWeekDays, freeIdx.length);
  if (freeIdx.length < windowLen) {
    const days = Array.from({ length: windowLen }, (_, i) => addDays(today, i)).filter(d => blocked.has(d));
    notes.push(`Nothing is planned on ${days.join(", ")}: you marked ${days.length === 1 ? "it" : "them"} as busy.`);
    if (studyDays > 0 && studyDays < Math.min(perWeekDays, windowLen)) { sessionMinutes = Math.round(weeklyMinutes / studyDays); notes.push(`Your ${plural(weeklyMinutes, "minute")} are shared across the ${plural(studyDays, "day")} left, so the week stays within the time you agreed.`); }
  }
  if (phase === "final_week" && daysLeft! > 0 && studyDays < perWeekDays && freeIdx.length === windowLen) notes.push(`Only ${plural(windowLen, "day")} are left before the exam, so the plan has ${plural(studyDays, "study day")}.`);

  // ── activities per session ──
  const hasDue = dueCards > 0;
  const slotsFor = (m: number) => {
    let n = Math.max(1, Math.round(m / TARGET_ACTIVITY_MINUTES));
    while (m / n > MAX_ACTIVITY_MINUTES) n++;
    if (hasDue && n === 1 && m >= 2 * MIN_ACTIVITY_MINUTES) n = 2;
    return n;
  };
  const slots = slotsFor(sessionMinutes);
  const alternateDue = hasDue && slots === 1;
  if (alternateDue) notes.push("Your sessions are short, so reviewing due cards alternates with new study.");

  const dayIdx: number[] = [];
  for (let i = 0; i < studyDays; i++) dayIdx.push(freeIdx[Math.floor((i * freeIdx.length) / studyDays)]);
  const allSessions = dayIdx.map((d, i) => {
    const day = addDays(today, d);
    // A personal study session is planned time too: Scholar plans only what is left of this day's session minutes.
    const minutes = Math.max(0, sessionMinutes - Math.floor(cal?.personalMinutes[day] ?? 0));
    return { day, dueSlot: hasDue && (!alternateDue || i % 2 === 0), minutes, slots: minutes > 0 ? slotsFor(minutes) : 0 };
  });
  const covered = allSessions.filter(s => s.minutes <= 0).map(s => s.day);
  if (covered.length) notes.push(`Your own study ${covered.length === 1 ? "session" : "sessions"} on ${covered.join(", ")} cover${covered.length === 1 ? "s" : ""} the time, so Scholar plans nothing then.`);
  const sessions = allSessions.filter(s => s.minutes > 0);

  // ── the candidate activities, in priority order ──
  const used = new Set<string>();
  const byKey = new Map(entries.map(e => [norm(e.key), e]));
  const queue: Item[] = [];
  const postponed = input.postponed ?? new Set<string>();
  const excluded = input.excludeRefs ?? new Set<string>();
  const push = (list: Item[], item: Item) => {
    if (excluded.has(item.ref) || (item.topics ?? []).some(t => postponed.has(t))) return;
    const k = `${item.space}|${item.title}`;
    if (!used.has(k)) { used.add(k); list.push(item); }
  };
  const touched = new Set<string>();   // topic keys already placed by a priority or a rule
  const hasEvidence = entries.some(e => e.attempts > 0);

  const lists = { priority: [] as Item[], weakLearn: [] as Item[], weakRevise: [] as Item[], apply: [] as Item[], secure: [] as Item[], unstarted: [] as Item[] };

  if (phase !== "final_week") {
    for (const p of plan.priorities) {
      const k = norm(p);
      if (!k || touched.has(k)) continue;
      touched.add(k);
      const e = byKey.get(k);
      if (!e) { push(lists.priority, { space: "learn", title: `Learn ${p.trim()}`, href: learnHref(`topic=${encodeURIComponent(p.trim())}`), reason: `You put ${p.trim()} first.`, ref: `learn:${refKey(p)}`, topics: [topicKey(p)] }); continue; }
      if (e.status === "needs_work" || e.status === "not_started") { push(lists.priority, learnItem(e, true)); if (e.status === "needs_work") push(lists.weakRevise, reviseAfterItem(e)); }
      else if (e.status === "developing" && belowApplication(e)) push(lists.priority, applyItem(e, true));
      else push(lists.priority, reviseTopicItem(e, true));
    }
    const rest = entries.filter(e => !touched.has(norm(e.key)));
    for (const e of rest.filter(x => x.status === "needs_work")) { push(lists.weakLearn, learnItem(e, false)); push(lists.weakRevise, reviseAfterItem(e)); }
    for (const e of rest.filter(x => x.status === "developing" && belowApplication(x))) push(lists.apply, applyItem(e, false));
    for (const e of rest.filter(x => x.status === "secure").slice(0, 2)) push(lists.secure, reviseTopicItem(e, false));

    // the not-yet-practised sections: a share of them each week over the weeks remaining
    const weeks = daysLeft === null ? SPREAD_WEEKS_NO_DATE : Math.max(1, Math.ceil(daysLeft / 7));
    const share = Math.ceil(input.unstarted.length / weeks);
    for (const s of input.unstarted.slice(0, share)) push(lists.unstarted, unstartedItem(s));
    if (input.unstarted.length > 0 && weeks > 1) {
      const units = input.unstarted.filter(s => s.kind === "unit").length;
      const what = units === input.unstarted.length ? `${plural(units, "learning unit")} of your notes` : units ? `${plural(input.unstarted.length - units, "section")} and ${plural(units, "learning unit")} of your notes` : `${plural(input.unstarted.length, "section")} of your notes linked to your programme`;
      notes.push(`${what} ${input.unstarted.length === 1 ? "has" : "have"} no practice yet. About ${share} ${share === 1 ? "is" : "are"} planned each week over the ${plural(weeks, "week")} ${daysLeft === null ? "ahead" : "before the exam"}.`);
    }
    // not-started topics of the notes stand in where the programme maps nothing
    if (input.unstarted.length === 0) for (const e of rest.filter(x => x.status === "not_started").slice(0, 3)) push(lists.unstarted, learnItem(e, false));
  }

  const mixedReason = hasEvidence ? "Questions across all your topics keep each one fresh, and show which need attention." : "You have little practice recorded yet, so start with mixed practice. The plan sharpens as you answer questions.";
  const freeSlots = sessions.reduce((n, s) => n + (s.dueSlot && alternateDue ? 0 : (s.dueSlot ? s.slots - 1 : s.slots)), 0);

  if (phase === "final_week") {
    const prio = (e: MasteryEntry) => Number(plan.priorities.some(p => norm(p) === norm(e.key)));
    const weak = entries.filter(e => (e.status === "needs_work" || e.status === "developing") && !tag(e).topics.some(t => postponed.has(t)))
      .sort((a, b) => prio(b) - prio(a) || (a.status === "needs_work" ? 0 : 1) - (b.status === "needs_work" ? 0 : 1)
        || (a.recentAccuracy ?? 0) - (b.recentAccuracy ?? 0) || a.label.localeCompare(b.label));
    // weak-topic review and mixed practice, alternating, weak first
    let w = 0, m = 0;
    for (let i = 0; i < freeSlots; i++) {
      if (i % 2 === 0 && w < weak.length) queue.push(weakReviewItem(weak[w++]));
      else queue.push(mixedItem(m++ === 0 ? mixedReason : "More mixed practice keeps every topic fresh in your last days."));
    }
  } else {
    // consolidate checks and applies before new ground. build and no_date put new ground before applying, and keep a
    // reserve for it so urgent items never push it out of every week.
    const order = phase === "consolidate"
      ? [lists.priority, lists.weakLearn, lists.weakRevise, lists.apply, lists.unstarted, lists.secure]
      : [lists.priority, lists.weakLearn, lists.weakRevise, lists.unstarted, lists.apply];
    let cut = order.flat().slice(0, freeSlots);
    const reserve = phase === "consolidate" ? [] : lists.unstarted.slice(0, Math.max(1, Math.floor(freeSlots / 4)));
    const missing = reserve.filter(i => !cut.includes(i));
    if (missing.length) cut = [...cut.slice(0, Math.max(0, freeSlots - missing.length)), ...missing];
    queue.push(...cut);
  }

  // ── fill the sessions ──
  const rest = [...queue];
  // Take the next planned item that is not about what the learner's own study session covers that day.
  const take = (day: string): Item | undefined => {
    const covers = new Set(cal?.personalTopics[day] ?? []);
    const i = rest.findIndex(it => !(it.topics ?? []).some(t => covers.has(t)));
    return i >= 0 ? rest.splice(i, 1)[0] : undefined;
  };
  const evalDay = phase === "final_week" && daysLeft! > 0 && sessions.length ? Math.max(0, sessions.length - 2) : -1;
  const thisWeek: PlanDay[] = sessions.map((s, si) => {
    const n = s.slots;
    const base = Math.floor(s.minutes / n);
    const extra = s.minutes - base * n;
    const notes_ = cal?.timedNotes[s.day];
    const note = notes_ && notes_.length ? notes_.join(" and ") : undefined;
    const acts: PlanActivity[] = [];
    for (let a = 0; a < n; a++) {
      const minutes = base + (a < extra ? 1 : 0);
      let item: Item | undefined;
      if (si === evalDay && a === n - 1) {
        item = { space: "evaluate", title: `A practice evaluation before ${exam}`, href: evaluateHref(), ref: "evaluate:eval", reason: "One evaluation in your last week shows where your practice stands. It is a study aid, not an assessment of competence." };
      } else if (a === 0 && s.dueSlot) {
        item = {
          space: "revise", title: "Review your due cards", href: reviseHref(), ref: "revise:due",
          reason: si === 0 ? `${plural(dueCards, "card has", "cards have")} reached ${dueCards === 1 ? "its" : "their"} review date. Reviewing on time is what makes them stick.` : "Cards come due as you study, so each session starts with a short review.",
        };
      } else {
        item = take(s.day) ?? mixedItem(mixedReason);
      }
      acts.push({ space: item.space, title: item.title, reason: item.reason, ref: item.ref, href: withStudy(item.href, input.studyId), minutes, ...(note ? { note } : {}) });
    }
    return { day: s.day, minutes: acts.reduce((m, x) => m + x.minutes, 0), activities: acts };
  });

  // ── the summary, in words ──
  const when = daysLeft === null ? (examPassed ? "Rolling weekly plan." : "Rolling weekly plan, with no exam date set.")
    : daysLeft === 0 ? `${exam[0].toUpperCase()}${exam.slice(1)} is today, so there is nothing to plan.`
      : `${plural(daysLeft, "day")} until ${exam}.`;
  const what = phase === "build" ? "Building: new ground first, then checking it holds."
    : phase === "consolidate" ? "Consolidating: checking and applying what you have covered before taking on more."
      : phase === "final_week" ? (daysLeft === 0 ? "" : "Final week: mixed practice, review of the topics still weak, and one practice evaluation.")
        : "Each week: what needs work first, then new ground.";
  const load = thisWeek.length
    ? `${plural(thisWeek.length, "study day")} in the next seven days, about ${plural(sessionMinutes, "minute")} each (${plural(thisWeek.reduce((m, d) => m + d.minutes, 0), "minute")} in all).`
    : "";
  const goal = plan.goal?.trim() ? `Your goal: ${plan.goal.trim()}` : "";
  const summary = [when, what, load, goal].filter(Boolean).join(" ");

  return { daysLeft, examPassed, phase, thisWeek, summary, notes, sessionMinutes, studyDays };
}

/**
 * Pure. The programme sections that are accepted-mapped to a competency of the programme and have no answered question yet,
 * in a fixed order (most sections under one competency first, as Study next lists them), each labelled by its first topic.
 */
export function unstartedMappedSections(o: {
  mappings: readonly { chunkId: string; competencyId: string; state: string }[];
  concepts: ReadonlyMap<string, readonly string[]>;
  questions: readonly { id: string; chunkId: string }[];
  attempts: readonly { questionId: string }[];
  competencies: readonly { id: string; title: string }[];
}): UnstartedSection[] {
  const title = new Map(o.competencies.map(c => [c.id, c.title]));
  const answered = new Set(o.attempts.map(a => a.questionId));
  const practised = new Set(o.questions.filter(q => answered.has(q.id)).map(q => q.chunkId));
  const seen = new Set<string>();
  const fresh: (UnstartedSection & { competencyId: string })[] = [];
  for (const m of o.mappings) {
    if (m.state !== "accepted" || !title.has(m.competencyId) || practised.has(m.chunkId) || seen.has(m.chunkId)) continue;
    seen.add(m.chunkId);
    fresh.push({ chunkId: m.chunkId, label: o.concepts.get(m.chunkId)?.find(x => x.trim())?.trim() ?? "a section of your notes", competencyTitle: title.get(m.competencyId)!, competencyId: m.competencyId });
  }
  const perComp = new Map<string, number>();
  for (const f of fresh) perComp.set(f.competencyId, (perComp.get(f.competencyId) ?? 0) + 1);
  return fresh
    .sort((a, b) => perComp.get(b.competencyId)! - perComp.get(a.competencyId)! || a.competencyTitle!.localeCompare(b.competencyTitle!) || a.label.localeCompare(b.label) || a.chunkId.localeCompare(b.chunkId))
    .map(({ chunkId, label, competencyTitle }) => ({ chunkId, label, competencyTitle }));
}
