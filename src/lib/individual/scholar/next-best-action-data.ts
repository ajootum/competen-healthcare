import { appendPlanEvent, learningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { createEntry, deleteEntry, learnerCalendarSchema, listEntries } from "../learning-plan/entry-store";
import { expandEntries, plusDays } from "../learning-plan/recurrence";
import type { PlanEvent, ScholarPlanSettings } from "../learning-plan/types";
import { isMyPlanOn, loadIndividualPolicy, type IndividualPolicy } from "../policy";
import type { IndividualContext } from "../guard";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import { audit } from "./http";
import { learnerTimeZone, localDay } from "./learning-definitions";
import { loadLearningState } from "./learning-state-data";
import { chooseNextActions, nbaDates, snoozeUntil, type NbaCheck, type NbaRecommendation, type NbaTopic } from "./next-best-action";
import { outcomeOf } from "./learning-need";
import { settingsFromRow } from "./plan-settings";
import {
  countDue, getStudyPlan, listCheckAttempts, listLearningSessions, listMappings, listMaterials, sectionTopicRows, sessionsByIds, studyPlanSchema, workspaceSchema, type Admin,
} from "./store";

// ── SALE-2026-11 R3 / SALE-11: THE READS AND THE LEARNER'S CHOICES BEHIND NEXT BEST ACTIONS ──────────────────────────────────
//
// Reads (every one keyed on the guard's user id, Scholar only): the kept lesson checks with R1's decision (950, 416 response.adaptive),
// the learning state (R1, derived each time), the cards due (372: R2's retrieval read replaces this count when it lands), the
// unfinished lessons (414), the sections with an accepted competency mapping (Apply), My Plan settings (780/840) and the learner's own
// exam and placement entries (840), and the next_action decisions (975). The pure choice is next-best-action.ts. NO AI.
//
// WRITES ONLY ON THE LEARNER'S CHOICE (POST plan/next-action):
//   accept   one study-session entry in their own calendar (today or tomorrow), then one next_action event, status accepted
//   snooze   one next_action event, status deferred, until 1, 3 or 7 days on
//   dismiss  one next_action event, status declined: not offered again until its evidence changes
// The suggestion is recomputed on the server from the learner's own records: the title, minutes and link written are the server's,
// never the request's. Without 975 nothing is recorded (409) and the card is read only. NOTHING ELSE CHANGES THE PLAN.

export type NbaView = {
  on: true;
  items: NbaRecommendation[];
  dismissed: number; snoozed: number;
  /** 975 is applied: accept, snooze and dismiss can be recorded. */
  canDecide: boolean;
  /** The learner's own calendar exists (accept adds to it). */
  canPlan: boolean;
  retrievalSource: "cards" | "r2" | null;
};
type Ctx = { admin: Admin; userId: string };

const DAY = 86_400_000;

/** Reads everything the rules use and returns the suggestions. Null when off. Unreadable parts are simply left out (never invented). */
export async function loadNextActions(ctx: Ctx, policy: IndividualPolicy, o: { now: Date; today: string; settings?: ScholarPlanSettings | null }): Promise<NbaView | null> {
  const { admin, userId } = ctx;
  if (policy.scholarNextBestAction !== "on") return null;
  if (!isMyPlanOn(policy, await studyPlanSchema(admin, userId))) return null;
  const nowIso = o.now.toISOString();
  const [has840, hasCal, has975] = await Promise.all([learningPlanSchema(admin, userId), learnerCalendarSchema(admin, userId), workspaceSchema(admin)]);
  const settingsP = o.settings !== undefined ? Promise.resolve(o.settings) : getStudyPlan(admin, userId).then(r => (r.ok && r.data ? settingsFromRow(r.data) : null)).catch(() => null);
  const [settings, kept, sessions, due, mats, topicRows, mappings, entries, events] = await Promise.all([
    settingsP,
    listCheckAttempts(admin, userId, { limit: 200 }).catch(() => null),
    listLearningSessions(admin, userId, 10).catch(() => null),
    countDue(admin, userId),
    listMaterials(admin, userId),
    sectionTopicRows(admin, userId).catch(() => null),
    listMappings(admin, userId).catch(() => null),
    hasCal ? listEntries(admin, userId, "scholar", plusDays(o.today, 30)).catch(() => null) : Promise.resolve(null),
    has840 && has975 ? listPlanEvents(admin, userId, "scholar", ["next_action"], new Date(o.now.getTime() - 120 * DAY).toISOString()).catch(() => null) : Promise.resolve(null),
  ]);
  const checks = kept?.ok ? kept.data : [];
  const titles = new Map((await sessionsByIds(admin, userId, [...new Set(checks.flatMap(c => (c.sessionId ? [c.sessionId] : [])))])).map(s => [s.id, s.title]));
  const nbaChecks: NbaCheck[] = checks.map(c => ({
    attemptId: c.attemptId, sessionId: c.sessionId, step: c.step, sessionTitle: c.sessionId ? titles.get(c.sessionId) ?? null : null, question: c.question, at: c.answeredAt,
    outcome: outcomeOf({ verdict: c.response.verdict, selfGrade: c.response.selfGrade }),
    adaptive: c.response.adaptive ? { need: c.response.adaptive.need, misconception: c.response.adaptive.misconception } : null,
  }));
  let topics: NbaTopic[] = [];
  if (policy.scholarLearningState === "on" && mats.ok && mats.data.length) {
    const concepts = new Map<string, string[]>((topicRows?.ok ? topicRows.data : []).map(r => [r.chunkId, r.topics]));
    const ls = await loadLearningState(admin, userId, policy, nowIso, { materials: mats.data.map(m => ({ id: m.id, title: m.title })), concepts }).catch(() => null);
    const word = (t: { dimensions: { key: string; word: NbaTopic["understanding"] }[] }, k: string) => t.dimensions.find(d => d.key === k)?.word ?? "none";
    topics = ls?.ok ? ls.data.map(t => ({
      key: t.key, label: t.label, chunkIds: t.chunkIds, lastAt: t.lastAt, understanding: word(t, "understanding"), application: word(t, "application"),
      misconceptions: word(t, "misconceptions"), repeatedMisconception: t.repeatedMisconception ?? null,
    })) : [];
  }
  const occurrences = entries?.ok ? expandEntries(entries.data.entries, entries.data.exceptions, o.today, plusDays(o.today, 30)) : [];
  const result = chooseNextActions({
    today: o.today,
    settings: settings ? { goalType: settings.goalType, sessionMinutes: settings.sessionMinutes ?? (settings.daysPerWeek ? Math.round(settings.weeklyMinutes / settings.daysPerWeek) : null), priorities: settings.priorities } : null,
    dates: nbaDates({ examDate: settings?.examDate ?? null, examLabel: settings?.examLabel ?? null, occurrences }),
    retrieval: due === null ? null : { due, source: "cards" },
    checks: nbaChecks, topics,
    unfinished: sessions?.ok ? sessions.data.filter(s => s.status === "active").map(s => ({ sessionId: s.id, title: s.title, lastAt: s.lastActiveAt })) : [],
    applyChunks: new Set(mappings?.ok ? mappings.data.mappings.filter(m => m.state === "accepted").map(m => m.chunkId) : []),
    decisions: (events?.ok ? events.data : []) as PlanEvent[],
    max: policy.scholarNextBestActionMax,
  });
  return { on: true, ...result, canDecide: has840 && has975, canPlan: hasCal, retrievalSource: due === null ? null : "cards" };
}

// ── the learner's choice ──
export type Reply = { status: number; body: Record<string, unknown> };
type Headers = { get(name: string): string | null };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const refuse = (status: number, error: string): Reply => reply(status, { error });
export const NBA_DECISIONS = ["accept", "snooze", "dismiss"] as const;
export type NbaDecision = (typeof NBA_DECISIONS)[number];
const REF = /^nba:[a-z]+(:[A-Za-z0-9._-]{1,80}){0,2}$/;

/** POST plan/next-action { ref, decision: accept | snooze | dismiss, days? (snooze 1, 3 or 7), date? (accept: "today" | "tomorrow") }. */
export async function nextActionService(ctx: Ctx, raw: unknown, headers: Headers, now = new Date()): Promise<Reply> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const policy = await loadIndividualPolicy(ctx.admin);
  if (policy.scholarMyPlan !== "on" || policy.scholarNextBestAction !== "on") return refuse(403, "Next learning actions are not offered here.");
  const ref = typeof body.ref === "string" ? body.ref : "";
  const decision = body.decision;
  if (!REF.test(ref)) return refuse(400, "That suggestion could not be found.");
  if (!(NBA_DECISIONS as readonly unknown[]).includes(decision)) return refuse(400, "Choose add to today, later or dismiss.");
  const today = localDay(now, learnerTimeZone(headers));
  if (!(await learningPlanSchema(ctx.admin, ctx.userId)) || !(await workspaceSchema(ctx.admin))) return refuse(409, "Your choice cannot be remembered here yet. Your plan is unchanged.");
  const view = await loadNextActions(ctx, policy, { now, today });
  if (!view) return refuse(403, "Next learning actions are not offered here.");
  // the server's own suggestion, never the request's words (it may since have been dismissed or snoozed elsewhere: not found)
  const rec = view.items.find(i => i.ref === ref);
  if (!rec) return refuse(404, "That suggestion is no longer offered. Reload to see the current ones.");
  const failed = () => refuse(500, "That could not be saved just now. Try again shortly. Your plan is unchanged.");
  const asCtx = ctx as unknown as IndividualContext;
  if (decision === "dismiss") {
    const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "next_action", ref, status: "declined", value: { fingerprint: rec.fingerprint, action: rec.kind, on: today } });
    if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your choice cannot be remembered here yet.") : failed();
    await audit(asCtx, "individual_scholar_next_action", "individual_learning_plan_event", null, { decision, action: rec.kind });
    return reply(200, { ok: true, decision });
  }
  if (decision === "snooze") {
    const until = snoozeUntil(today, body.days);
    if (!until) return refuse(400, "Choose tomorrow, in three days or next week.");
    const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "next_action", ref, status: "deferred", value: { fingerprint: rec.fingerprint, action: rec.kind, until, on: today } });
    if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your choice cannot be remembered here yet.") : failed();
    await audit(asCtx, "individual_scholar_next_action", "individual_learning_plan_event", null, { decision, action: rec.kind, until });
    return reply(200, { ok: true, decision, until });
  }
  // accept: the learner's own calendar entry first, then the record; the entry is taken back if the record cannot be kept
  if (rec.state === "planned") return reply(200, { ok: true, decision, already: true, date: rec.plannedFor });
  if (!view.canPlan) return refuse(409, "Your calendar is not available here yet, so this cannot be added. You can still start it now.");
  const date = body.date === "tomorrow" ? plusDays(today, 1) : today;
  const safe = (s: string | null) => (s && !findPatientIdentifiers(s).length ? s : null);
  const about = safe(rec.about);
  const title = `${rec.action}${about ? `: ${about}` : ""}`.slice(0, 200);
  const made = await createEntry(ctx.admin, ctx.userId, "scholar", {
    entryType: "study_session", title, description: safe(rec.reason)?.slice(0, 2000) ?? null, entryDate: date, startTime: null, endTime: null,
    durationMinutes: Math.max(5, rec.minutes), link: rec.link && safe(rec.link.label) ? rec.link : null, recurrence: null,
  });
  if (!made.ok) return made.error === "not_provisioned" ? refuse(409, "Your calendar is not available here yet.") : failed();
  const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "next_action", ref, status: "accepted", value: { fingerprint: rec.fingerprint, action: rec.kind, date, entryId: made.entry.id, on: today } });
  if (r !== "ok") {
    await deleteEntry(ctx.admin, ctx.userId, "scholar", made.entry.id).catch(() => null);
    return r === "not_provisioned" ? refuse(409, "Your choice cannot be remembered here yet.") : failed();
  }
  await audit(asCtx, "individual_scholar_next_action", "individual_learning_plan_event", made.entry.id, { decision, action: rec.kind, date });
  return reply(200, { ok: true, decision, date, entryId: made.entry.id });
}
