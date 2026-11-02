import type { MasteryEntry } from "./mastery";
import { agendaTone, whenLabel, type AgendaDay } from "./plan-view";
import { topicKey } from "./plan-proposal";
import { withStudy } from "./study-carry";

// ── MY PLAN -> TODAY: THE SMALL DECISIONS ── My Plan correction (CE-03) ──────────────────────────────────────────────
//
// Pure, no I/O, no clock of its own, no AI. What the Today screen shows below its main card, taken from the SAME agenda days the Calendar draws
// (so a move or a postponement shows in both): what comes up next, what is already done today, what the next activity is about, and whether its
// button says Start or Resume. Imports nothing that touches a database, so server and client components both read it.

export const COMING_UP_MAX = 5;
export type ComingUpItem = {
  key: string;
  /** "scholar": a recommendation of the plan. "personal": the learner's own entry. */
  source: "scholar" | "personal";
  /** The word beside the icon: "Scholar plan", "Your activity", "Cards due", "Monthly review". */
  label: string;
  title: string;
  date: string;
  /** "7:00 PM · 30 min", "20 min", "All day" or "". */
  when: string;
  /** Where a Scholar item opens. A personal one has none (it opens in the calendar). */
  href: string | null;
};

/** The activity ref inside a planned calendar key (`plan:${ref}|${nth}`), or null for any other key. */
export function planRefOfKey(key: string): string | null {
  return key.startsWith("plan:") ? key.slice(5).split("|")[0] || null : null;
}

/**
 * Pure. The next few things after the main card: from today on, the planned Scholar activities (without the one already shown), the learner's own
 * activities, cards due on a later day and the monthly review, in the order the calendar reads them. Times the learner is unavailable and what is
 * already done are not "coming up". Today's cards due have their own card. At most `max`.
 */
/**
 * Pure. Today's schedule on the Today view: today's calendar items (all of them still decide whether anything is planned) without the one already shown as "Your next study session" (its plan activity, and
 * the cards-due row when that session is the due-cards review), so nothing is listed twice.
 */
export function todaySchedule(items: AgendaDay["items"], nextRef: string | null): AgendaDay["items"] {
  if (!nextRef) return [...items];
  return items.filter(i => !(i.kind === "planned" && planRefOfKey(i.key) === nextRef) && !(i.kind === "due_revision" && nextRef === "revise:due"));
}

/** `fromTomorrow`: today is already listed on the page (Today's schedule), so Coming up starts tomorrow. */
export function buildComingUp(days: readonly AgendaDay[], o: { today: string; nextRef: string | null; max?: number; fromTomorrow?: boolean }): ComingUpItem[] {
  const out: ComingUpItem[] = [];
  const max = o.max ?? COMING_UP_MAX;
  for (const d of days) {
    if (d.date < o.today || (o.fromTomorrow && d.date === o.today)) continue;
    for (const i of d.items) {
      if (out.length >= max) return out;
      const tone = agendaTone(i);
      if (tone === "done" || tone === "unavailable") continue;
      if (i.kind === "planned") {
        if (d.date === o.today && o.nextRef && planRefOfKey(i.key) === o.nextRef) continue;
        out.push({ key: i.key, source: "scholar", label: "Scholar plan", title: i.title, date: d.date, when: whenLabel({ minutes: i.minutes }), href: i.href });
      } else if (i.kind === "due_revision") {
        if (d.date === o.today) continue;
        out.push({ key: i.key, source: "scholar", label: "Cards due", title: i.title, date: d.date, when: "", href: i.href });
      } else if (i.kind === "monthly_review") {
        out.push({ key: i.key, source: "scholar", label: "Monthly review", title: i.title, date: d.date, when: "", href: i.href });
      } else if (i.kind === "personal" && i.occurrence) {
        out.push({ key: i.key, source: "personal", label: "Your activity", title: i.title, date: d.date, when: whenLabel(i.occurrence), href: null });
      }
    }
  }
  return out;
}

export type DoneItem = { key: string; title: string; detail: string | null; href: string | null; /** Recorded learning, or the learner's own word. */ basis: "recorded" | "self_reported" };
/**
 * Pure. What was done today: the records that qualify (a lesson, a revision or case session, an evaluation, the cards reviewed) from the calendar, and the
 * learner's own study sessions they marked completed, shown apart as their word. Nothing is added up or scored.
 */
export function buildDoneToday(days: readonly AgendaDay[], today: string): DoneItem[] {
  const day = days.find(d => d.date === today);
  if (!day) return [];
  const out: DoneItem[] = [];
  for (const i of day.items) {
    if (i.kind === "completed") out.push({ key: i.key, title: i.title, detail: i.detail, href: i.href, basis: "recorded" });
    else if (i.kind === "personal" && i.occurrence?.entryType === "study_session" && i.occurrence.status === "completed" && i.occurrence.selfReported) {
      out.push({ key: i.key, title: i.title, detail: "Marked done by you", href: null, basis: "self_reported" });
    }
  }
  return [...out.filter(i => i.basis === "recorded"), ...out.filter(i => i.basis === "self_reported")];
}

/**
 * Pure. What an activity is about, in the learner's words: the topic (as the evidence names it) and the material it sits in, e.g.
 * "Renal · from Renal notes". Null when the activity is not about one topic or material (mixed practice, your due cards).
 */
export function relatesTo(rec: { topics: readonly string[] }, entries: readonly MasteryEntry[], materials: readonly { id: string; title: string }[]): string | null {
  const want = new Set(rec.topics);
  if (!want.size) return null;
  const hit = entries.find(e => want.has(topicKey(e.key)) || want.has(topicKey(e.label)));
  const materialOf = (id: string | null | undefined) => (id ? materials.find(m => m.id === id)?.title ?? null : null);
  if (hit) {
    const mat = materialOf(hit.materialId);
    return mat && topicKey(mat) !== topicKey(hit.label) ? `${hit.label} · from ${mat}` : hit.label;
  }
  const mats = materials.filter(m => want.has(topicKey(m.id)));
  if (mats.length) return mats.length === 1 ? `From ${mats[0].title}` : `From ${mats[0].title} and ${mats.length - 1} more`;
  return null;
}

/** Start, or Resume when the next activity is a lesson or revision session the learner already opened and left. */
export const startLabel = (rec: { rule: string }): "Start" | "Resume" => (rec.rule === "unfinished" ? "Resume" : "Start");
/** Where Start opens: the activity's own destination, with the connected study session carried along (?study=) when there is one. */
export const startHref = (href: string | null, studyId: string | null | undefined): string | null => (href ? withStudy(href, studyId) : null);

/** Pure. "Today", "Tomorrow" or "Wed 4 Nov": a day in the words a learner uses. */
export function dayWord(date: string, today: string): string {
  if (date === today) return "Today";
  const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (n === 1) return "Tomorrow";
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}
