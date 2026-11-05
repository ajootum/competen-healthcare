// ── SALE-2026-11 R2 / SALE-08 (retrieval-schedule.ts; retrieval.ts is the chunk search): WHEN EACH ASSESSED TOPIC IS DUE TO BE RECALLED AGAIN ── pure, client-safe, NO AI ──────────────
//
// Retrieval scheduling for concepts assessed through lesson checks, practice questions, card reviews and cases -- not only
// flashcards. A topic is scheduled from the SAME evidence as the learning state (learning-state.ts StateEvidence, joined to the
// same topic as Progress by topic): nothing new is stored and nothing is generated. retention-data.ts reads; this module decides.
//
// THE RULE (S1-S7, each kept on the item with its reason in words):
//   S1 recall history   the topic's marked answers, one outcome per day (the day's mean), replayed through the SHARED SM-2
//                       (revision.ts scheduleReview, the one the revision cards and flashcards use, with the policy's SRS bounds):
//                       expanding intervals 1, 6, then x ease after successful recall; a miss restarts at one day. Same-day answers
//                       are one retrieval, so a lesson's checks do not count as spaced practice.
//   S2 difficulty       a topic whose questions are mostly application or reasoning is a harder one: the SRS harder-interval share.
//   S3 misconception    the same misconception on DIFFERENT questions, with the latest answer still not right: the interval is cut
//                       to `misconceptionPercent` of itself (it comes back sooner).
//   S4 exam             with an exam date ahead, a retrieval that would fall after (exam - buffer) is brought forward to it.
//   S5 priority         a topic the learner named as a priority in their plan comes first among equally due ones.
//   S6 availability     at most `perDay` due topics fit one study session (session length x share / minutes per topic); the rest
//                       are shown for following study days, spaced by the days a week the learner set. Never added to the plan.
//   S7 cards            a topic known only from card reviews is left to its cards' own schedule (372): not scheduled twice.
//
// ⚠ A SUGGESTION, NEVER A CHANGE. Nothing here writes to My Plan or the calendar (R3 reads this through retention-data.ts
//   loadRetrievalSchedule). The learner chooses whether and when.
// ⚠ FORMATIVE. Due for retrieval says when recall is worth practising, from the learner's own answers. It is not a score, not
//   retention proven, and never competence.
// ⚠ UNCALIBRATED DEFAULTS. SM-2's intervals are an established spacing rule; the misconception share, buffer, minutes and share
//   are HQ policy keys (scholar_retrieval_*) with stated starting values, to be recalibrated with pilot data (SALE-15/18).

import { scheduleReview, SRS_DEFAULTS, type SrsParams } from "./revision";
import { realMisconceptions } from "./learning-need";
import { sameMisconception } from "./misconception";
import type { StateEvidence, StateTopic } from "./learning-state";

export type RetrievalPolicy = {
  /** S3: share of the interval after a repeated misconception, percent. */
  misconceptionPercent: number;
  /** S4: days before the exam by which a topic is recalled. */
  examBufferDays: number;
  /** S6: minutes one topic's retrieval takes. */
  minutesPerTopic: number;
  /** S6: share of one study session for retrieval, percent. */
  sharePercent: number;
};
export const DEFAULT_RETRIEVAL_POLICY: RetrievalPolicy = { misconceptionPercent: 50, examBufferDays: 2, minutesPerTopic: 5, sharePercent: 30 };
/** The session length used for S6 when the learner set none. */
export const DEFAULT_SESSION_MINUTES = 30;
/** Upcoming: due within this many days. */
export const UPCOMING_DAYS = 7;

/** What the learner said in their plan (780/840), as S4-S6 read it. Null: no plan. */
export type RetrievalPlan = { examDate: string | null; examLabel: string | null; daysPerWeek: number | null; sessionMinutes: number | null; weeklyMinutes: number | null; priorities: readonly string[] };
/** A revision card's question placed on a topic (372), for S7 and the "review cards" action. */
export type TopicCard = { topicKey: string; nextReviewAt: string; status: string };

export type RetrievalAction = { kind: "cards" | "questions" | "case"; label: string; href: string };
export type RetrievalItem = {
  topicKey: string; label: string; materialId: string | null; chunkIds: string[];
  /** The day the next retrieval is due (YYYY-MM-DD), and the day S6 places it on (the same, or a later study day). */
  dueOn: string; suggestedOn: string;
  state: "due" | "upcoming" | "later";
  /** Days past dueOn (0 when not yet due). */
  overdueDays: number;
  intervalDays: number;
  lastPracticedOn: string;
  /** Distinct days with a marked answer, and how many of those days were recalled well / not. */
  history: { days: number; recalled: number; lapses: number };
  flags: { misconception: boolean; harder: boolean; exam: boolean; priority: boolean; cardsOnly: boolean };
  /** The rules that shaped it, in order (S1 ... S7). */
  rules: string[];
  /** Why, in the learner's words. The first is the main reason. */
  reasons: string[];
  minutes: number;
  action: RetrievalAction;
};
export type RetrievalSchedule = {
  today: string;
  due: RetrievalItem[];
  upcoming: RetrievalItem[];
  /** Scheduled beyond the upcoming window. */
  later: number;
  /** Topics met but never assessed with a mark: nothing to recall yet. */
  notAssessed: number;
  /** S6: topics that fit one study session, and the basis in words. */
  capacity: { perDay: number; minutesPerDay: number; basis: string };
  note: string;
};
export const RETRIEVAL_NOTE = "When recall is worth practising again, from your own answers by a stated spacing rule. A suggestion only: nothing is added to your plan, and it is never a judgement of competence.";

const DAY = 86_400_000;
const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const marked = (e: StateEvidence) => e.outcome !== null && e.marking !== "unmarked";
const right = (e: StateEvidence) => e.outcome !== null && e.outcome >= 0.75;

/** Pure. A day's mean outcome as an SM-2 quality: recalled well 4, partly 3, not recalled 1. */
export const qualityOf = (mean: number): number => (mean >= 0.75 ? 4 : mean >= 0.5 ? 3 : 1);

/** Pure. S1: the topic's marked answers, one per day, replayed through the shared SM-2. Null with no marked answer. */
export function replayRecall(rows: readonly StateEvidence[], difficulty: number | null, srs: SrsParams = SRS_DEFAULTS): { lastDay: string; interval: number; days: number; recalled: number; lapses: number } | null {
  const byDay = new Map<string, number[]>();
  for (const r of rows) if (marked(r)) byDay.set(dayOf(r.at), [...(byDay.get(dayOf(r.at)) ?? []), r.outcome as number]);
  const days = [...byDay.keys()].sort();
  if (!days.length) return null;
  let state = { ease: 2.5, interval: 0, reps: 0 };
  let recalled = 0, lapses = 0;
  for (const d of days) {
    const xs = byDay.get(d)!;
    const q = qualityOf(xs.reduce((a, b) => a + b, 0) / xs.length);
    if (q >= 3) recalled++; else lapses++;
    const next = scheduleReview(state, q, difficulty, srs);
    state = { ease: next.ease, interval: next.interval, reps: next.reps };
  }
  return { lastDay: days[days.length - 1], interval: Math.max(1, state.interval), days: days.length, recalled, lapses };
}

/** Pure. S2: most of the topic's distinct questions ask to apply or reason. */
export function isHarderTopic(rows: readonly StateEvidence[]): boolean {
  const items = new Map<string, StateEvidence["level"]>();
  for (const r of rows) if (r.source !== "osce") items.set(r.itemId, r.level);
  const levels = [...items.values()];
  return levels.length > 0 && levels.filter(l => l === "application" || l === "reasoning").length * 2 > levels.length;
}

/** Pure. S3: the same misconception on two or more DIFFERENT questions, and the latest marked answer on the topic not right. */
export function repeatedMisconception(rows: readonly StateEvidence[]): string | null {
  const ms = rows.filter(marked).sort((a, b) => b.at.localeCompare(a.at));
  if (!ms.length || right(ms[0])) return null;
  const seen: { tag: string; items: Set<string> }[] = [];
  for (const r of ms) if (!right(r)) for (const m of realMisconceptions(r.misconceptions)) {
    const g = seen.find(x => sameMisconception(x.tag, m));
    if (g) g.items.add(r.itemId); else seen.push({ tag: m, items: new Set([r.itemId]) });
  }
  return seen.find(g => g.items.size >= 2)?.tag ?? null;
}

/** Pure. S6: how many due topics fit one study session. */
export function retrievalCapacity(plan: RetrievalPlan | null, p: RetrievalPolicy): { perDay: number; minutesPerDay: number; basis: string } {
  const session = plan?.sessionMinutes ?? (plan?.weeklyMinutes && plan.daysPerWeek ? Math.round(plan.weeklyMinutes / plan.daysPerWeek) : null);
  const minutes = Math.max(p.minutesPerTopic, Math.round((session ?? DEFAULT_SESSION_MINUTES) * p.sharePercent / 100));
  const perDay = Math.max(1, Math.floor(minutes / p.minutesPerTopic));
  const basis = session
    ? `About ${minutes} minutes of your ${session}-minute study session (${p.sharePercent}%), at about ${p.minutesPerTopic} minutes a topic.`
    : `About ${minutes} minutes a day (${p.sharePercent}% of a ${DEFAULT_SESSION_MINUTES}-minute session; set your own in My Plan), at about ${p.minutesPerTopic} minutes a topic.`;
  return { perDay, minutesPerDay: minutes, basis };
}

export type RetrievalHrefs = {
  /** A Revise session prefilled with these sections (existing questions first). */
  questions: (materialId: string | null, chunkIds: readonly string[]) => string;
  /** The due revision cards of a material. */
  cards: (materialId: string | null) => string;
};

/**
 * Pure. SALE-08: the retrieval schedule. `today` is the learner's local day. Items are ordered for display only (most overdue
 * relative to their interval first, then a repeated misconception, an exam ahead, a priority topic, a harder topic, the name);
 * no number is shown that looks like a score.
 */
export function buildRetrievalSchedule(input: {
  topics: readonly StateTopic[]; evidence: readonly StateEvidence[]; cards: readonly TopicCard[]; today: string;
  plan: RetrievalPlan | null; srs?: SrsParams; policy?: Partial<RetrievalPolicy>; hrefs: RetrievalHrefs;
}): RetrievalSchedule {
  const P = { ...DEFAULT_RETRIEVAL_POLICY, ...input.policy };
  const srs = input.srs ?? SRS_DEFAULTS;
  const today = input.today;
  const rows = new Map<string, StateEvidence[]>();
  for (const e of input.evidence) rows.set(e.topicKey, [...(rows.get(e.topicKey) ?? []), e]);
  const cards = new Map<string, TopicCard[]>();
  for (const c of input.cards) cards.set(c.topicKey, [...(cards.get(c.topicKey) ?? []), c]);
  const exam = input.plan?.examDate && input.plan.examDate >= today ? input.plan.examDate : null;
  const priorities = (input.plan?.priorities ?? []).map(norm).filter(Boolean);
  const items: RetrievalItem[] = [];
  let notAssessed = 0;

  for (const t of input.topics) {
    const r = rows.get(t.key) ?? [];
    const mine = (cards.get(t.key) ?? []).filter(c => c.status === "active");
    const harder = isHarderTopic(r);
    const replay = replayRecall(r, harder ? 3 : null, srs);
    if (!replay) { notAssessed++; continue; }
    const rules = ["S1"];
    const reasons: string[] = [];
    const cardsOnly = r.filter(marked).every(e => e.source === "review");
    let interval = replay.interval;
    let dueOn = addDays(replay.lastDay, interval);
    const ago = daysBetween(replay.lastDay, today);
    if (cardsOnly) {
      // S7: the cards (372) already schedule it; the topic is due when its earliest active card is.
      rules.push("S7");
      const next = mine.map(c => c.nextReviewAt).sort()[0];
      if (next) { dueOn = next; interval = Math.max(1, daysBetween(replay.lastDay, next)); }
      reasons.push(`Known from your revision cards only, so it follows their schedule: next card review on ${dueOn}.`);
    } else {
      reasons.push(replay.lapses && replay.recalled === 0
        ? `Last practised ${ago === 0 ? "today" : `${plural(ago, "day")} ago`}, not recalled well yet, so it comes back after ${plural(interval, "day")}.`
        : `Last practised ${ago === 0 ? "today" : `${plural(ago, "day")} ago`}. Recalled well on ${replay.recalled} of ${plural(replay.days, "practice day")}, so the gap before the next recall is ${plural(interval, "day")} (the spacing grows each time you recall it).`);
      if (harder) {
        rules.push("S2");
        if (srs.harderIntervalPercent < 100) reasons.push(`Most of its questions ask you to apply or reason, so the gap is ${srs.harderIntervalPercent}% of the usual.`);
      }
      const mis = repeatedMisconception(r);
      if (mis) {
        rules.push("S3");
        interval = Math.max(1, Math.round(interval * P.misconceptionPercent / 100));
        dueOn = addDays(replay.lastDay, interval);
        reasons.push(`The same misconception ("${mis.length > 80 ? `${mis.slice(0, 79)}…` : mis}") came up on different questions and is not corrected yet, so it comes back sooner.`);
      }
    }
    let examFlag = false;
    if (exam) {
      const by = addDays(exam, -P.examBufferDays);
      if (dueOn > by && by > replay.lastDay) {
        rules.push("S4"); examFlag = true;
        dueOn = by < today ? today : by;
        reasons.push(`Your ${input.plan?.examLabel ? `${input.plan.examLabel} ` : ""}exam is on ${exam}, so it is brought forward to ${dueOn}.`);
      } else if (daysBetween(today, exam) <= 28) examFlag = true;
    }
    const priority = priorities.some(p => norm(t.label).includes(p) || p.includes(norm(t.label)));
    if (priority) { rules.push("S5"); reasons.push("You named it as a priority in your plan."); }
    const overdueDays = Math.max(0, daysBetween(dueOn, today));
    const state: RetrievalItem["state"] = dueOn <= today ? "due" : daysBetween(today, dueOn) <= UPCOMING_DAYS ? "upcoming" : "later";
    const hasOsce = r.some(e => e.source === "osce");
    const cardsDue = mine.some(c => c.nextReviewAt <= today);
    const action: RetrievalAction = cardsOnly || (cardsDue && !r.some(e => e.source !== "review" && marked(e)))
      ? { kind: "cards", label: "Review the due cards", href: input.hrefs.cards(t.materialId) }
      : hasOsce && harder
        ? { kind: "case", label: "Practise it in a case", href: input.hrefs.questions(t.materialId, t.chunkIds) }
        : { kind: "questions", label: "Recall it now", href: input.hrefs.questions(t.materialId, t.chunkIds) };
    items.push({
      topicKey: t.key, label: t.label, materialId: t.materialId, chunkIds: [...t.chunkIds], dueOn, suggestedOn: dueOn < today ? today : dueOn, state, overdueDays,
      intervalDays: interval, lastPracticedOn: replay.lastDay, history: { days: replay.days, recalled: replay.recalled, lapses: replay.lapses },
      flags: { misconception: rules.includes("S3"), harder, exam: examFlag, priority, cardsOnly }, rules, reasons, minutes: P.minutesPerTopic, action,
    });
  }

  const order = (a: RetrievalItem, b: RetrievalItem) =>
    b.overdueDays / Math.max(1, b.intervalDays) - a.overdueDays / Math.max(1, a.intervalDays)
    || Number(b.flags.misconception) - Number(a.flags.misconception) || Number(b.flags.exam) - Number(a.flags.exam)
    || Number(b.flags.priority) - Number(a.flags.priority) || Number(b.flags.harder) - Number(a.flags.harder)
    || a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label);
  const capacity = retrievalCapacity(input.plan, P);
  const due = items.filter(i => i.state === "due").sort(order);
  // S6: beyond one session's worth, the next study days, spaced by the learner's days a week (every day with none set).
  const gap = input.plan?.daysPerWeek ? Math.max(1, Math.round(7 / Math.min(7, Math.max(1, input.plan.daysPerWeek)))) : 1;
  due.forEach((it, i) => {
    const slot = Math.floor(i / capacity.perDay);
    if (slot > 0) {
      it.suggestedOn = addDays(today, slot * gap);
      it.rules.push("S6");
      it.reasons.push(`More is due than fits one study session (${capacity.perDay} ${capacity.perDay === 1 ? "topic" : "topics"}), so this one is for ${it.suggestedOn}.`);
    }
  });
  const upcoming = items.filter(i => i.state === "upcoming").sort((a, b) => a.dueOn.localeCompare(b.dueOn) || a.label.localeCompare(b.label));
  return { today, due, upcoming, later: items.filter(i => i.state === "later").length, notAssessed, capacity, note: RETRIEVAL_NOTE };
}

const shortDay = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Pure. One line for a list: when, and the main reason. */
export function retrievalLine(i: RetrievalItem, today: string): string {
  // SCHOLAR-REVISE-WORKSPACE-01: one meaning per date. A topic placed on a later day is not "due today" on that same line.
  if (i.state === "due" && i.suggestedOn > today) return `Planned for ${shortDay(i.suggestedOn)}${i.overdueDays > 0 ? `, was due ${shortDay(i.dueOn)}` : ""}`;
  return i.state !== "due" ? `Due ${shortDay(i.dueOn)}` : i.overdueDays > 0 ? `Due since ${shortDay(i.dueOn)}` : "Due today";
}
