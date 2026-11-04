import { experienceHref } from "../experiences";
import { dayNumber } from "../learning-plan/recurrence";
import { latestPerRef, type EntryLink, type GoalType, type PlanEvent } from "../learning-plan/types";
import type { EvidenceWord } from "./learning-state";
import type { LearningNeed } from "./learning-need";
import { topicKey } from "./plan-proposal";
import { lessonHrefPath } from "./saved-library";
import { applyHref, refKey, reviseHref } from "./study-plan";

// ── SALE-2026-11 R3 / SALE-11: NEXT BEST LEARNING ACTIONS ───────────────────────────────────────────────────────────────
//
// Pure, no AI, no clock of its own (`today` and `now` are passed in). It EXTENDS My Plan's next-activity engine (plan-recommend.ts),
// which stays as it is: that one says what to study next; this one names an ACTION, never only a topic, from evidence the learner
// already made and that R1 already reads:
//
//   misconception   R1 kept a lesson check as "a likely misconception" (416 response.adaptive, need misconception), not since put
//                   right in that lesson, or the learning state names a misconception that came up on different questions
//   prerequisite    R1 kept a check as "possibly a missing foundation" (need prerequisite_gap): the earlier lesson comes first
//   retrieval       cards due for review (R2 will hand its own due count here when it lands: `retrieval.source`)
//   continue        a lesson started in the last 14 days and not finished
//   apply           a topic with some evidence of understanding and no evidence of applying it, on a section with an accepted
//                   competency mapping (the Learn page's own signal that a case is clinically relevant there)
//
// Priority is a TRANSPARENT score: a base per action (BASE) plus named adjustments for the learner's goal, the nearest exam or
// placement date, their available time, their own priorities and recency. Each adjustment that applied is said in `because`.
// The same input always gives the same answer.
//
// ⚠ A SUGGESTION, NEVER A CHANGE. Nothing here writes. Accept (add to today), snooze and dismiss are the learner's own choices,
// recorded as 975 next_action plan events by next-best-action-data.ts. A dismissed suggestion returns only when its evidence changes
// (`fingerprint`); a snoozed one returns on the date chosen. It says nothing about competence.

export const NBA_KINDS = ["misconception", "prerequisite", "retrieval", "continue", "apply"] as const;
export type NbaKind = (typeof NBA_KINDS)[number];
export const NBA_ACTION: Record<NbaKind, string> = {
  misconception: "Review this misconception", prerequisite: "Revisit a prerequisite before going on", retrieval: "retrieval exercise",
  continue: "Continue your unfinished lesson", apply: "Apply this in a case",
};
/** The starting score of each action before adjustments. Uncalibrated starting rules, to be recalibrated with SALE-15/18. */
export const BASE: Record<NbaKind, number> = { prerequisite: 60, misconception: 55, retrieval: 50, continue: 40, apply: 30 };
/** Minutes each action is expected to take (retrieval is worked out from the cards due). */
export const MINUTES: Record<Exclude<NbaKind, "retrieval">, number> = { misconception: 5, prerequisite: 10, continue: 15, apply: 10 };
/** Seconds of retrieval per due card, and the bounds of a retrieval exercise. */
export const RETRIEVAL = { secondsPerCard: 40, minMinutes: 3, maxMinutes: 15 } as const;
/** An exam or placement within this many days changes the order. */
export const DATE_HORIZON_DAYS = 14;
/** Checks older than this are not suggested again (misconception.ts RECENT_MISS_DAYS). */
export const RECENT_DAYS = 30;
/** Lessons left longer ago than this are not offered to continue (plan-data unfinishedOf). */
export const UNFINISHED_DAYS = 14;
export const SNOOZE_DAYS = [1, 3, 7] as const;

/** A kept lesson check (950) with R1's decision on it, as the learner's own record has it. */
export type NbaCheck = {
  attemptId: string; sessionId: string | null; step: number | null; sessionTitle: string | null; question: string; at: string;
  outcome: "right" | "partly" | "wrong" | null;
  adaptive: { need: LearningNeed; misconception: string | null } | null;
};
/** One topic's learning state (R1 learning-state.ts), reduced to what the rules read. */
export type NbaTopic = {
  key: string; label: string; chunkIds: readonly string[]; lastAt: string | null;
  understanding: EvidenceWord; application: EvidenceWord; misconceptions: EvidenceWord;
  /** The misconception named on different questions (R1 dimension M1 "stronger"), else null. */
  repeatedMisconception: string | null;
};
export type NbaDate = { kind: "exam" | "placement"; title: string; date: string };
export type NbaSettings = { goalType: GoalType | null; sessionMinutes: number | null; priorities: readonly string[] };
export type NbaInput = {
  today: string;
  settings: NbaSettings | null;
  /** The learner's exam date (My Plan settings) and their own exam and placement calendar entries. */
  dates: readonly NbaDate[];
  /** Due retrieval. `source` says where the count came from: the revision cards (372) until R2's read is available. Null: unreadable. */
  retrieval: { due: number; source: "cards" | "r2" } | null;
  checks: readonly NbaCheck[];
  topics: readonly NbaTopic[];
  unfinished: readonly { sessionId: string; title: string; lastAt: string }[];
  /** Sections where a short case is offered (an accepted competency mapping: the Learn page's own Apply signal). Empty: no Apply. */
  applyChunks: ReadonlySet<string>;
  /** next_action plan events (975), any order. */
  decisions: readonly PlanEvent[];
  max: number;
};

export type NbaRecommendation = {
  ref: string; kind: NbaKind;
  /** The action, first and in the learner's words ("Review this misconception", "8-minute retrieval exercise"). */
  action: string;
  /** What it is about (a lesson, a topic, the cards due), or null. */
  about: string | null;
  /** One short reason, from their own records. */
  reason: string;
  /** Every rule and adjustment that placed it, in plain words ("Why this?"). */
  because: string[];
  minutes: number;
  href: string;
  fingerprint: string;
  score: number;
  /** The calendar link an accept writes (840 entry link). */
  link: EntryLink | null;
  /** planned: accepted for today or later and its evidence unchanged. */
  state: "new" | "planned";
  plannedFor: string | null;
};
export type NbaResult = { items: NbaRecommendation[]; dismissed: number; snoozed: number };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const days = (from: string, to: string) => dayNumber(to.slice(0, 10)) - dayNumber(from.slice(0, 10));
const clip = (s: string, n = 90) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const lessonName = (c: { sessionTitle: string | null; step: number | null }) =>
  `${c.sessionTitle ? clip(c.sessionTitle, 60) : "your lesson"}${c.step !== null ? `, lesson ${c.step + 1}` : ""}`;
const href = (path: string) => experienceHref("scholar", path);

/** Pure. The retrieval exercise's length from the cards due, within the bounds and the learner's session. */
export function retrievalMinutes(due: number, sessionMinutes: number | null): number {
  const m = Math.min(RETRIEVAL.maxMinutes, Math.max(RETRIEVAL.minMinutes, Math.ceil((due * RETRIEVAL.secondsPerCard) / 60)));
  return sessionMinutes ? Math.max(RETRIEVAL.minMinutes, Math.min(m, sessionMinutes)) : m;
}

type Draft = Omit<NbaRecommendation, "score" | "because" | "state" | "plannedFor"> & { topic: string | null; at: string | null };

/** Pure. Every candidate before ordering and the learner's decisions. */
export function nbaCandidates(i: NbaInput): Draft[] {
  const out: Draft[] = [];
  const recent = (at: string) => days(at, i.today) <= RECENT_DAYS;
  // R1 decisions per lesson: the newest kept check of each (session, step), and whether a later one was right
  const byLesson = new Map<string, NbaCheck[]>();
  for (const c of i.checks) if (c.sessionId && c.step !== null) byLesson.set(`${c.sessionId}:${c.step}`, [...(byLesson.get(`${c.sessionId}:${c.step}`) ?? []), c]);
  for (const [, list] of [...byLesson.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...list].sort((a, b) => b.at.localeCompare(a.at) || a.attemptId.localeCompare(b.attemptId));
    const open = sorted.find(c => c.adaptive && (c.adaptive.need === "misconception" || c.adaptive.need === "prerequisite_gap"));
    if (!open || !recent(open.at)) continue;
    // put right since: a right answer kept after it in the same lesson
    if (sorted.some(c => c.at > open.at && c.outcome === "right")) continue;
    const sessionId = open.sessionId!, step = open.step!;
    if (open.adaptive!.need === "misconception") {
      const what = open.adaptive!.misconception ? clip(open.adaptive!.misconception, 120) : null;
      out.push({
        ref: `nba:mis:${sessionId}:${step}`, kind: "misconception", action: NBA_ACTION.misconception, about: what ? `"${what}"` : lessonName(open),
        reason: `Your answer in ${lessonName(open)} on ${open.at.slice(0, 10)} suggested ${what ? `"${what}"` : "an incorrect idea"}, and it has not been put right there yet.`,
        minutes: MINUTES.misconception, href: href(lessonHrefPath(sessionId, step)), fingerprint: `mis:${open.attemptId}`,
        link: { kind: "lesson", id: sessionId, label: clip(lessonName(open), 120) }, topic: open.sessionTitle, at: open.at,
      });
    } else if (step > 0) {
      out.push({
        ref: `nba:prereq:${sessionId}:${step}`, kind: "prerequisite", action: NBA_ACTION.prerequisite, about: `${open.sessionTitle ? clip(open.sessionTitle, 60) : "Your lesson"}, lesson ${step}`,
        reason: `Several different questions in ${lessonName(open)} were not answered well yet. Lesson ${step}, which it builds on, is the place to start.`,
        minutes: MINUTES.prerequisite, href: href(lessonHrefPath(sessionId, step - 1)), fingerprint: `prereq:${open.attemptId}`,
        link: { kind: "lesson", id: sessionId, label: clip(lessonName({ sessionTitle: open.sessionTitle, step: step - 1 }), 120) }, topic: open.sessionTitle, at: open.at,
      });
    }
  }
  // the learning state: a misconception named on DIFFERENT questions of a topic (R1 M1 "stronger")
  for (const t of [...i.topics].sort((a, b) => a.key.localeCompare(b.key))) {
    if (t.misconceptions !== "stronger" || !t.repeatedMisconception || !t.lastAt || !recent(t.lastAt)) continue;
    if (out.some(o => o.kind === "misconception" && o.about === `"${clip(t.repeatedMisconception, 120)}"`)) continue;
    out.push({
      ref: `nba:mis:t-${refKey(t.key)}`, kind: "misconception", action: NBA_ACTION.misconception, about: `"${clip(t.repeatedMisconception, 120)}" in ${t.label}`,
      reason: `"${clip(t.repeatedMisconception, 120)}" came up on different questions about ${t.label}: a likely misconception to correct.`,
      minutes: MINUTES.misconception, href: href("study/revise/mistakes"), fingerprint: `mis:${t.key}:${t.lastAt}`,
      link: { kind: "topic", id: clip(t.key, 120), label: clip(t.label, 120) }, topic: t.label, at: t.lastAt,
    });
  }
  // due retrieval
  if (i.retrieval && i.retrieval.due > 0) {
    const n = i.retrieval.due, m = retrievalMinutes(n, i.settings?.sessionMinutes ?? null);
    out.push({
      ref: "nba:retrieval", kind: "retrieval", action: `${m}-minute ${NBA_ACTION.retrieval}`, about: `${plural(n, "card")} due`,
      reason: `${plural(n, "card has", "cards have")} reached ${n === 1 ? "its" : "their"} review date. Recalling ${n === 1 ? "it" : "them"} now, without looking, is what makes ${n === 1 ? "it" : "them"} stick.`,
      minutes: m, href: reviseHref(), fingerprint: `due:${i.today}`,
      link: { kind: "deck", id: "due", label: "Cards due for review" }, topic: null, at: null,
    });
  }
  // unfinished lessons, most recently left first
  for (const u of [...i.unfinished].sort((a, b) => b.lastAt.localeCompare(a.lastAt) || a.sessionId.localeCompare(b.sessionId))) {
    if (days(u.lastAt, i.today) > UNFINISHED_DAYS) continue;
    out.push({
      ref: `nba:continue:${u.sessionId}`, kind: "continue", action: NBA_ACTION.continue, about: clip(u.title, 80),
      reason: `You started ${clip(u.title, 80)} on ${u.lastAt.slice(0, 10)} and stopped part way. It is quick to pick up where you left off.`,
      minutes: MINUTES.continue, href: `${href("study/learn")}?session=${encodeURIComponent(u.sessionId)}`, fingerprint: `continue:${u.sessionId}:${u.lastAt}`,
      link: { kind: "lesson", id: u.sessionId, label: clip(u.title, 120) }, topic: u.title, at: u.lastAt,
    });
  }
  // apply: understanding shown, application not yet
  if (i.applyChunks.size) {
    for (const t of [...i.topics].sort((a, b) => (b.lastAt ?? "").localeCompare(a.lastAt ?? "") || a.key.localeCompare(b.key))) {
      const chunk = t.chunkIds.find(c => i.applyChunks.has(c));
      if (!(t.understanding === "some" || t.understanding === "stronger") || !(t.application === "none" || t.application === "thin") || !chunk) continue;
      out.push({
        ref: `nba:apply:${refKey(t.key)}`, kind: "apply", action: `Apply ${clip(t.label, 60)} in a case`, about: t.label,
        reason: `You have shown some understanding of ${t.label}, but ${t.application === "none" ? "have not yet applied it" : "have little evidence of applying it"}. A short case shows whether you can use it.`,
        minutes: MINUTES.apply, href: applyHref(`section=${chunk}&from=revision`), fingerprint: `apply:${t.key}:${t.understanding}:${t.application}`,
        link: { kind: "topic", id: clip(t.key, 120), label: clip(t.label, 120) }, topic: t.label, at: t.lastAt,
      });
    }
  }
  return out;
}

/** Pure. The score of a candidate and every adjustment said in words. */
export function scoreOf(d: Draft, i: NbaInput): { score: number; because: string[] } {
  let score = BASE[d.kind];
  const because: string[] = [];
  const goal = i.settings?.goalType ?? null;
  const g = (n: number, why: string) => { score += n; because.push(why); };
  if (goal === "exam" && (d.kind === "retrieval" || d.kind === "misconception")) g(d.kind === "retrieval" ? 10 : 5, "Your goal is to prepare for an exam.");
  if (goal === "revise" && d.kind === "retrieval") g(15, "Your goal is to revise what you have learned.");
  if (goal === "learn" && (d.kind === "continue" || d.kind === "prerequisite")) g(d.kind === "continue" ? 15 : 5, "Your goal is to learn consistently.");
  const near = [...i.dates].filter(x => x.date >= i.today && days(i.today, x.date) <= DATE_HORIZON_DAYS).sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title))[0];
  if (near) {
    const left = days(i.today, near.date);
    const when = left === 0 ? "today" : `in ${plural(left, "day")}`;
    const lift: Record<NbaKind, number> = { retrieval: 25, misconception: 15, prerequisite: 10, apply: near.kind === "placement" ? 25 : 10, continue: 0 };
    if (lift[d.kind]) g(lift[d.kind], `Your ${near.kind === "placement" ? "placement" : "exam"} "${clip(near.title, 60)}" is ${when}${d.kind === "apply" && near.kind === "placement" ? ": applying what you know matters most before it" : ""}.`);
  }
  const prios = new Set((i.settings?.priorities ?? []).map(topicKey).filter(Boolean));
  const tk = d.topic ? topicKey(d.topic) : "";
  if (tk && [...prios].some(p => tk.includes(p) || p.includes(tk))) g(15, `You chose ${clip(d.topic!, 60)} as a priority.`);
  if (d.at && (d.kind === "misconception" || d.kind === "prerequisite") && days(d.at, i.today) <= 2) g(5, "It came up in the last two days.");
  const available = i.settings?.sessionMinutes ?? null;
  if (available !== null && d.kind !== "retrieval" && d.minutes > available) g(-15, `It takes about ${d.minutes} minutes, longer than your usual ${available}-minute session.`);
  else if (available !== null) because.push(`It fits your usual ${available}-minute session (about ${d.minutes} minutes).`);
  if (i.retrieval?.source === "cards" && d.kind === "retrieval") because.push("Counted from your revision cards.");
  return { score, because };
}

/** Pure. The suggestions in order, without those the learner dismissed (evidence unchanged) or snoozed (until a later date). */
export function chooseNextActions(i: NbaInput): NbaResult {
  const latest = latestPerRef(i.decisions.filter(e => e.kind === "next_action"));
  let dismissed = 0, snoozed = 0;
  const seen = new Set<string>();
  const items: NbaRecommendation[] = [];
  for (const d of nbaCandidates(i)) {
    if (seen.has(d.ref)) continue;
    seen.add(d.ref);
    const e = latest.get(d.ref);
    const fp = e && typeof e.value.fingerprint === "string" ? e.value.fingerprint : null;
    let state: NbaRecommendation["state"] = "new";
    let plannedFor: string | null = null;
    if (e?.status === "declined" && fp === d.fingerprint) { dismissed++; continue; }
    if (e?.status === "deferred" && typeof e.value.until === "string" && e.value.until > i.today) { snoozed++; continue; }
    if (e?.status === "accepted" && fp === d.fingerprint) {
      const on = typeof e.value.date === "string" ? e.value.date : null;
      if (!on || on < i.today) continue;
      state = "planned"; plannedFor = on;
    }
    const { score, because } = scoreOf(d, i);
    const { topic: _t, at: _a, ...rest } = d;
    items.push({ ...rest, score, because: [d.reason, ...because], state, plannedFor });
  }
  items.sort((a, b) => b.score - a.score || NBA_KINDS.indexOf(a.kind) - NBA_KINDS.indexOf(b.kind) || a.ref.localeCompare(b.ref));
  return { items: items.slice(0, Math.max(1, Math.min(5, i.max))), dismissed, snoozed };
}

/** Pure. The exam and placement dates the rules read: the plan's exam date, then the learner's own exam and placement entries. */
export function nbaDates(o: { examDate: string | null; examLabel: string | null; occurrences: readonly { entryType: string; status: string; title: string; date: string }[] }): NbaDate[] {
  const out: NbaDate[] = [];
  if (o.examDate) out.push({ kind: "exam", title: o.examLabel?.trim() || "your exam", date: o.examDate });
  for (const x of o.occurrences) if ((x.entryType === "exam" || x.entryType === "placement") && x.status !== "cancelled") out.push({ kind: x.entryType as "exam" | "placement", title: x.title, date: x.date });
  return out;
}

/** Pure. A snooze date: one of the offered day counts after today (default tomorrow). */
export function snoozeUntil(today: string, daysAhead: unknown): string | null {
  const n = daysAhead === undefined || daysAhead === null ? 1 : Number(daysAhead);
  if (!(SNOOZE_DAYS as readonly number[]).includes(n)) return null;
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
