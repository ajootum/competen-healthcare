import type { EntryType, Occurrence } from "../learning-plan/types";
import type { PlanCalendar } from "./study-plan";
import type { GoalType } from "../learning-plan/types";

// ── THE LEARNER'S OWN CALENDAR, AS THE PLAN READS IT ── My Plan calendar enhancement (owner GO 2 Nov 2026) ───────────
//
// Pure. The plan only READS the learner's calendar entries; it never creates, moves or completes one.
//
//   busy / placement, ALL DAY   no Scholar study is planned that day (the week's minutes are shared across the days left)
//   busy / placement, TIMED     the day stays available (Scholar activities have no times today) and its activities carry a note
//                               such as "around your 14:00-18:00 placement"
//   study_session               planned time: it takes its minutes off that day's Scholar session, and a topic or material it is
//                               about is not planned again that day. It is NOT evidence of study (learning-definitions.ts)
//   exam                        an OFFER to use it as the plan's exam date (examOffers). Applying it is the learner's explicit call
//   deadline                    a recommendation candidate when it is within 14 days and linked to a material or topic (plan-recommend.ts)

import { topicKey } from "./plan-proposal";
const LABEL: Partial<Record<EntryType, string>> = { placement: "placement", busy: "busy time" };

/** Pure. The plan's view of the learner's own occurrences (cancelled ones are ignored). */
export function planCalendarFrom(occurrences: readonly Occurrence[]): PlanCalendar {
  const blocked = new Set<string>();
  const timed: Record<string, string[]> = {};
  const minutes: Record<string, number> = {};
  const topics: Record<string, string[]> = {};
  for (const o of occurrences) {
    if (o.status === "cancelled") continue;
    if (o.entryType === "busy" || o.entryType === "placement") {
      if (o.allDay) blocked.add(o.date);
      else (timed[o.date] ??= []).push(`around your ${o.startTime}${o.endTime ? `–${o.endTime}` : ""} ${LABEL[o.entryType]}`);
    } else if (o.entryType === "study_session") {
      minutes[o.date] = (minutes[o.date] ?? 0) + (o.durationMinutes ?? 0);
      if (o.link) (topics[o.date] ??= []).push(topicKey(o.link.label), topicKey(o.link.id));
    }
  }
  for (const d of Object.keys(timed)) timed[d].sort();
  return { blockedDays: [...blocked].sort(), timedNotes: timed, personalMinutes: minutes, personalTopics: topics };
}

export type ExamOffer = {
  /** The occurrence key, `${entryId}@${date}`. */
  key: string; entryId: string; title: string; date: string; goalType: GoalType;
  /** True when the plan already has this exam date and the exam goal. */
  applied: boolean;
  /** What applying it does, in words. */
  effect: string;
};
/**
 * Pure. An offer for each upcoming exam entry to use it as the plan's exam date and exam-preparation goal. Never applied here:
 * applying is an explicit request with confirm:true, logged as a settings change.
 */
export function examOffers(occurrences: readonly Occurrence[], settings: { examDate: string | null; goalType: GoalType | null } | null, today: string): ExamOffer[] {
  return occurrences
    .filter(o => o.entryType === "exam" && o.status !== "cancelled" && o.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
    .map(o => ({
      key: o.key, entryId: o.entryId, title: o.title, date: o.date, goalType: "exam" as const,
      applied: settings?.examDate === o.date && settings?.goalType === "exam",
      effect: `Your plan would count down to ${o.title} on ${o.date} and plan exam preparation. You can undo it by changing your plan settings.`,
    }));
}
