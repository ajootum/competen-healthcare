/* eslint-disable @typescript-eslint/no-explicit-any */
import { cleanEntryInput, cleanOccurrenceInput, cleanRange, type EntryInput } from "../learning-plan/calendar-entries";
import { appendPlanEvent, learningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { createEntry, deleteEntry, getEntry, learnerCalendarSchema, listEntries, putException, removeException, updateEntry } from "../learning-plan/entry-store";
import { expandEntries, expandEntry, plusDays, seriesDates } from "../learning-plan/recurrence";
import { latestPerRef, type CalendarEntry } from "../learning-plan/types";
import { isStudyPlanOn, loadIndividualPolicy, type IndividualPolicy } from "../policy";
import type { IndividualContext } from "../guard";
import { learnerTimeZone, localDay } from "./learning-definitions";
import { examOffers } from "./plan-calendar";
import { carryKey } from "./plan-carry";
import { loadInsights, loadProposal, loadToday, type PlanCtx } from "./plan-data";
import { isProposalDecision, topicKey } from "./plan-proposal";
import { STORED_UNITS_BASIS, parseStoredUnits } from "./plan-units";
import { cleanReflection, isoWeek, reflectionOffer } from "./plan-reflection";
import { cleanPlanSettings, increaseNeedsConfirmation, settingsDiff, settingsFromRow } from "./plan-settings";
import { audit } from "./http";
import { clearStudyPlan, getStudyPlan, listMaterials, saveStudyPlan, sectionsOf, studyPlanSchema } from "./store";
import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";

// ── MY PLAN: THE REQUEST SERVICES ── PLP-01..04 and the My Plan calendar enhancement ───────────────────────────────────
//
// The logic behind the /api/individual/scholar/plan/* routes and the study-plan route, as plain functions of (the guard's context, a body,
// the request headers) returning { status, body }. The routes are thin; this is what is tested end to end. EVERY function acts on the CALLER'S OWN
// rows only (ctx.userId, never a body field) and on experience "scholar" only. NO AI.

export type Reply = { status: number; body: Record<string, unknown> };
type Headers = { get(name: string): string | null };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const refuse = (status: number, error: string, extra: Record<string, unknown> = {}): Reply => reply(status, { error, ...extra });

const when = (headers: Headers, now = new Date()) => { const tz = learnerTimeZone(headers); return { now, tz, today: localDay(now, tz) }; };
const NOT_OFFERED = "My Plan is not offered here.";
const reason = (r: "off" | "not_provisioned" | "unreadable" | "not_found"): Reply =>
  r === "off" ? refuse(403, NOT_OFFERED) : r === "not_provisioned" ? refuse(409, "My Plan is not available here yet.") : r === "not_found" ? refuse(404, "That could not be found.") : refuse(503, "Your plan could not be read just now. Try again shortly.");

async function myPlanPolicy(ctx: PlanCtx): Promise<IndividualPolicy | Reply> {
  const policy = await loadIndividualPolicy(ctx.admin);
  return policy.scholarMyPlan === "on" ? policy : refuse(403, NOT_OFFERED);
}
const isReply = (x: unknown): x is Reply => !!x && typeof x === "object" && "status" in x && "body" in x;
const asCtx = (ctx: PlanCtx) => ctx as unknown as IndividualContext;

// ── today, insights, proposal ──
export async function todayService(ctx: PlanCtx, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  const v = await loadToday(ctx, policy, when(headers, now));
  return v.ok ? reply(200, v as any) : reason(v.reason);
}
export async function insightsService(ctx: PlanCtx, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  const v = await loadInsights(ctx, policy, when(headers, now));
  return v.ok ? reply(200, v as any) : reason(v.reason);
}
export async function proposalGetService(ctx: PlanCtx, materialId: unknown, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  if (typeof materialId !== "string" || !/^[0-9a-f-]{36}$/i.test(materialId)) return refuse(400, "Choose one of your materials.");
  const v = await loadProposal(ctx, policy, materialId, when(headers, now));
  return v.ok ? reply(200, v as any) : reason(v.reason);
}
export async function proposalPostService(ctx: PlanCtx, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  if (policy.scholarPlanProposal !== "on") return refuse(403, "Plan proposals are not offered here.");
  const materialId = body?.materialId, decision = body?.decision;
  if (typeof materialId !== "string" || !/^[0-9a-f-]{36}$/i.test(materialId)) return refuse(400, "Choose one of your materials.");
  if (!isProposalDecision(decision)) return refuse(400, "Choose accept, not now or decline.");
  if (!(await learningPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "Your answer cannot be remembered here yet. Your plan is unchanged.");
  // only the caller's own material
  const mats = await listMaterials(ctx.admin, ctx.userId);
  if (!mats.ok) return reason("unreadable");
  if (!mats.data.some(m => m.id === materialId)) return refuse(404, "That material could not be found.");
  // SCHOLAR-PLAN-UNITS-01: an acceptance may carry the learning units the learner reviewed, by section ordinals of THIS material only.
  let value: Record<string, unknown> = { at: when(headers, now).today };
  if (decision === "accepted" && body?.units !== undefined) {
    const secs = await sectionsOf(ctx.admin, ctx.userId, [materialId]);
    if (!secs.ok) return reason("unreadable");
    const units = parseStoredUnits({ units: body.units }, new Set(secs.data.map(s => s.ordinal)));
    if (!units) return refuse(400, "The learning units do not match this material. Reload the page and try again.");
    if (!units.some(u => !u.x)) return refuse(400, "Keep at least one learning unit, or choose not to plan these notes.");
    value = { ...value, basis: STORED_UNITS_BASIS, units };
    if (Buffer.byteLength(JSON.stringify(value), "utf8") > 8000) return refuse(400, "Too many learning units to remember: merge some and try again.");
  }
  const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "proposal", ref: materialId, status: decision, value });
  if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your answer cannot be remembered here yet.") : refuse(500, "Your answer could not be saved just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_plan_proposal", "individual_learning_plan_event", materialId, { decision });
  return reply(200, { ok: true, decision });
}

// ── decisions: decline a suggestion, postpone a topic, take back an automatic change ──
const REF = /^[A-Za-z0-9:@|._-]{1,200}$/;
const CARRY_REF = /^(learn|revise|apply|evaluate):[a-z0-9-]{1,80}@\d{4}-\d{2}-\d{2}$/;
export async function decisionService(ctx: PlanCtx, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  const { today } = when(headers, now);
  if (!(await learningPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "Your choice cannot be remembered here yet. Your plan is unchanged.");
  const kind = body?.kind;
  const failed = () => refuse(500, "That could not be saved just now. Try again shortly.");
  if (kind === "recommendation_declined") {
    const ref = typeof body?.ref === "string" ? body.ref : "";
    const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint.slice(0, 200) : null;
    if (!REF.test(ref)) return refuse(400, "That suggestion could not be found.");
    const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind, ref, status: "declined", value: fingerprint ? { fingerprint } : {} });
    if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your choice cannot be remembered here yet.") : failed();
    await audit(asCtx(ctx), "individual_scholar_plan_declined", "individual_learning_plan_event", null, {});
    return reply(200, { ok: true });
  }
  if (kind === "topic_postponed") {
    const label = typeof body?.ref === "string" ? body.ref.replace(/\s+/g, " ").trim() : "";
    if (!label || label.length > 120) return refuse(400, "Choose the topic to put off.");
    if (findPatientIdentifiers(label).length) return refuse(422, "That looks like it identifies a patient. Remove it and save again.");
    const until = body?.until === undefined || body?.until === null ? plusDays(today, 1) : body.until;
    if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until) || until <= today || until > plusDays(today, 90)) return refuse(400, "Choose a date after today and within 90 days.");
    const key = topicKey(label);
    if (!key) return refuse(400, "Choose the topic to put off.");
    const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind, ref: key, status: "deferred", value: { until, label } });
    if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your choice cannot be remembered here yet.") : failed();
    await audit(asCtx(ctx), "individual_scholar_plan_postponed", "individual_learning_plan_event", null, { until });
    return reply(200, { ok: true, until });
  }
  if (kind === "auto_adjust") {
    const ref = typeof body?.ref === "string" ? body.ref : "";
    if (body?.status !== "undone" || !CARRY_REF.test(ref)) return refuse(400, "That change could not be found.");
    const evs = await listPlanEvents(ctx.admin, ctx.userId, "scholar", ["auto_adjust"]);
    if (!evs.ok) return failed();
    const cur = latestPerRef(evs.data).get(ref);
    if (!cur) return refuse(404, "That change could not be found.");
    if (cur.status === "undone") return reply(200, { ok: true, already: true });
    const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind, ref, status: "undone", value: { undoneOn: today } });
    if (r !== "ok") return failed();
    await audit(asCtx(ctx), "individual_scholar_plan_undo", "individual_learning_plan_event", null, {});
    return reply(200, { ok: true });
  }
  return refuse(400, "Unknown choice.");
}

// ── weekly reflection ──
export async function reflectionService(ctx: PlanCtx, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  if (policy.scholarPlanWeeklyReflection !== "on") return refuse(403, "The weekly reflection is not offered here.");
  const { today } = when(headers, now);
  const clean = cleanReflection(body, isoWeek(today));
  if (!clean.ok) return refuse(clean.identifier ? 422 : 400, clean.message);
  if (!(await learningPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "Your reflection cannot be kept here yet.");
  const r = await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "reflection", ref: clean.value.week, status: null, value: { workload: clean.value.workload, ...(clean.value.note ? { note: clean.value.note } : {}) } });
  if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your reflection cannot be kept here yet.") : refuse(500, "Your reflection could not be saved just now. Try again shortly.");
  const row = await getStudyPlan(ctx.admin, ctx.userId);
  const offer = row.ok && row.data ? reflectionOffer(clean.value.workload, settingsFromRow(row.data), policy.scholarPlanMaxWeeklyMinutes) : null;
  await audit(asCtx(ctx), "individual_scholar_plan_reflection", "individual_learning_plan_event", null, { workload: clean.value.workload });
  // The offer is NEVER applied here.
  return reply(200, { ok: true, offer });
}

// ── plan settings (the study-plan route and plan/settings) ──
export async function settingsGetService(ctx: PlanCtx, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  const { today } = when(headers, now);
  if (!isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "The study plan is not available here yet.");
  const row = await getStudyPlan(ctx.admin, ctx.userId);
  if (!row.ok) return reason("unreadable");
  const settings = row.data ? settingsFromRow(row.data) : null;
  let offers: unknown[] = [];
  if (await learnerCalendarSchema(ctx.admin, ctx.userId)) {
    const le = await listEntries(ctx.admin, ctx.userId, "scholar", plusDays(today, 1100));
    if (le.ok) offers = examOffers(expandEntries(le.data.entries, le.data.exceptions, today, plusDays(today, 1095)), settings, today);
  }
  return reply(200, { settings, examOffers: offers, maxWeeklyMinutes: policy.scholarPlanMaxWeeklyMinutes, extras: await learningPlanSchema(ctx.admin, ctx.userId) });
}

/**
 * Save the plan settings: the three questions (goalType, sessionMinutes, daysPerWeek; examDate for an exam) or the old shape. A workload
 * increase beyond scholar_plan_max_weekly_minutes needs confirmIncrease:true (else 409). `applyExamOffer` (an exam entry's occurrence key) with
 * confirm:true sets the exam date and the exam goal from the learner's own calendar entry: never silent. Both are logged as a settings change.
 */
export async function settingsService(ctx: PlanCtx, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!policy.scholarStudyPlan) return refuse(403, "The study plan is not offered here.");
  if (!isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "The study plan is not available here yet.");
  const { today } = when(headers, now);
  const row = await getStudyPlan(ctx.admin, ctx.userId);
  if (!row.ok) return refuse(503, "Your study plan could not be read just now. Try again shortly.");
  const current = row.data ? settingsFromRow(row.data) : null;
  let source: Record<string, unknown> = {};

  let input = body;
  if (typeof body?.applyExamOffer === "string") {
    if (policy.scholarMyPlan !== "on") return refuse(403, NOT_OFFERED);
    if (!current) return refuse(409, "Set up your study plan first, then use your exam date from the calendar.");
    const key = body.applyExamOffer as string;
    const id = key.split("@")[0];
    const le = (await learnerCalendarSchema(ctx.admin, ctx.userId)) ? await getEntry(ctx.admin, ctx.userId, "scholar", id) : null;
    const offer = le?.ok && le.data ? examOffers(expandEntry(le.data.entry, le.data.exceptions, today, plusDays(today, 1095)), current, today).find(o => o.key === key) : undefined;
    if (!offer) return refuse(404, "That exam could not be found in your calendar.");
    if (body.confirm !== true) return refuse(409, offer.effect, { needsConfirmation: true, offer });
    input = { goalType: "exam", sessionMinutes: current.sessionMinutes ?? Math.max(10, Math.round(current.weeklyMinutes / Math.max(1, current.daysPerWeek))), daysPerWeek: current.daysPerWeek, examDate: offer.date, examLabel: offer.title.slice(0, 120), goal: current.goal, priorities: current.priorities };
    source = { source: "exam_entry", entryKey: key };
  }

  const clean = cleanPlanSettings(input, today);
  if (!clean.ok) return refuse(clean.identifier ? 422 : 400, clean.message);
  const inc = increaseNeedsConfirmation(current, clean.value, policy.scholarPlanMaxWeeklyMinutes);
  if (inc.needsConfirmation && body?.confirmIncrease !== true) return refuse(409, inc.message, { needsConfirmation: true, from: inc.from, to: inc.to, max: inc.max });
  const saved = await saveStudyPlan(ctx.admin, ctx.userId, clean.value);
  if (!saved.ok) return saved.error === "not_provisioned" ? refuse(409, "The study plan is not available here yet.") : refuse(500, "Your study plan could not be saved just now. Try again shortly.");
  const extras = await learningPlanSchema(ctx.admin, ctx.userId);
  if (extras) {
    const diff = settingsDiff(current, clean.value);
    await appendPlanEvent(ctx.admin, ctx.userId, "scholar", { kind: "settings_change", ref: "settings", value: { ...diff, ...source, confirmedIncrease: inc.needsConfirmation } });
  }
  await audit(asCtx(ctx), "individual_scholar_study_plan_saved", "individual_scholar_study_plan", ctx.userId, {
    dated: clean.value.examDate !== null, weeklyMinutes: clean.value.weeklyMinutes, daysPerWeek: clean.value.daysPerWeek, priorities: clean.value.priorities.length,
    goalType: clean.value.goalType, sessionMinutes: clean.value.sessionMinutes,
  });
  return reply(200, { ok: true, extras });
}

export async function settingsClearService(ctx: PlanCtx): Promise<Reply> {
  const policy = await loadIndividualPolicy(ctx.admin);
  if (!policy.scholarStudyPlan) return refuse(403, "The study plan is not offered here.");
  if (!isStudyPlanOn(policy, await studyPlanSchema(ctx.admin, ctx.userId))) return refuse(409, "The study plan is not available here yet.");
  const r = await clearStudyPlan(ctx.admin, ctx.userId);
  if (r === "not_provisioned") return refuse(409, "The study plan is not available here yet.");
  if (r === "failed") return refuse(500, "Your study plan could not be cleared just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_study_plan_cleared", "individual_scholar_study_plan", ctx.userId, {});
  return reply(200, { ok: true });
}

// ── the learner's own calendar entries (Scholar: experience "scholar" only) ──
async function entriesGate(ctx: PlanCtx): Promise<IndividualPolicy | Reply> {
  const policy = await myPlanPolicy(ctx);
  if (isReply(policy)) return policy;
  if (!(await learnerCalendarSchema(ctx.admin, ctx.userId))) return refuse(409, "Your own calendar entries are not available here yet.");
  return policy;
}
const inputOf = (e: CalendarEntry): EntryInput => ({ entryType: e.entryType, title: e.title, description: e.description, entryDate: e.entryDate, startTime: e.startTime, endTime: e.endTime, durationMinutes: e.durationMinutes, link: e.link, recurrence: e.recurrence });
const unreadable = () => refuse(503, "Your calendar could not be read just now. Try again shortly.");

/** The occurrences (each series expanded, exceptions applied) in a date range of at most 400 days. */
export async function entriesListService(ctx: PlanCtx, query: { from?: unknown; to?: unknown; includeCancelled?: unknown }, headers: Headers, now = new Date()): Promise<Reply> {
  const g = await entriesGate(ctx);
  if (isReply(g)) return g;
  const { today } = when(headers, now);
  const range = cleanRange(query.from ?? plusDays(today, -7), query.to ?? plusDays(today, 60), today);
  if (!range.ok) return refuse(400, range.message);
  const r = await listEntries(ctx.admin, ctx.userId, "scholar", range.value.to);
  if (!r.ok) return unreadable();
  return reply(200, { occurrences: expandEntries(r.data.entries, r.data.exceptions, range.value.from, range.value.to, { includeCancelled: query.includeCancelled === true || query.includeCancelled === "1" }), from: range.value.from, to: range.value.to });
}
export async function entryCreateService(ctx: PlanCtx, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const g = await entriesGate(ctx);
  if (isReply(g)) return g;
  const { today } = when(headers, now);
  const clean = cleanEntryInput(body, today);
  if (!clean.ok) return refuse(clean.identifier ? 422 : 400, clean.message);
  const r = await createEntry(ctx.admin, ctx.userId, "scholar", clean.value);
  if (!r.ok) return r.error === "not_provisioned" ? refuse(409, "Your own calendar entries are not available here yet.") : refuse(500, "That could not be saved just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_calendar_entry_created", "individual_learning_calendar_entry", r.entry.id, { type: r.entry.entryType, recurring: !!r.entry.recurrence });
  return reply(201, { ok: true, entry: r.entry, occurrences: expandEntry(r.entry, [], plusDays(today, -7), plusDays(today, 60)) });
}
/** Change the WHOLE series: its fields (any left out keep their value), and/or its status (planned, completed, cancelled). */
export async function entryUpdateService(ctx: PlanCtx, id: string, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const g = await entriesGate(ctx);
  if (isReply(g)) return g;
  const { today } = when(headers, now);
  const cur = await getEntry(ctx.admin, ctx.userId, "scholar", id);
  if (!cur.ok) return unreadable();
  if (!cur.data) return refuse(404, "That entry could not be found.");
  const status = body?.status;
  if (status !== undefined && status !== "planned" && status !== "completed" && status !== "cancelled") return refuse(400, "Choose planned, completed or cancelled.");
  const fieldKeys = ["entryType", "title", "description", "entryDate", "startTime", "endTime", "durationMinutes", "link", "recurrence"];
  const touches = fieldKeys.some(k => body?.[k] !== undefined);
  let fields: EntryInput | undefined;
  if (touches) {
    const clean = cleanEntryInput(body, today, inputOf(cur.data.entry));
    if (!clean.ok) return refuse(clean.identifier ? 422 : 400, clean.message);
    fields = clean.value;
  }
  if (!fields && status === undefined) return refuse(400, "Nothing to change.");
  const r = await updateEntry(ctx.admin, ctx.userId, "scholar", id, { fields, status });
  if (r === "not_found") return refuse(404, "That entry could not be found.");
  if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your own calendar entries are not available here yet.") : refuse(500, "That could not be saved just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_calendar_entry_updated", "individual_learning_calendar_entry", id, { status: status ?? null, fields: !!fields });
  return reply(200, { ok: true });
}
export async function entryDeleteService(ctx: PlanCtx, id: string): Promise<Reply> {
  const g = await entriesGate(ctx);
  if (isReply(g)) return g;
  const r = await deleteEntry(ctx.admin, ctx.userId, "scholar", id);
  if (r === "not_found") return refuse(404, "That entry could not be found.");
  if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your own calendar entries are not available here yet.") : refuse(500, "That could not be deleted just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_calendar_entry_deleted", "individual_learning_calendar_entry", id, {});
  return reply(200, { ok: true });
}
/** Cancel, move, edit or complete ONE occurrence (or restore it). Every other occurrence of the series is untouched. */
export async function occurrenceService(ctx: PlanCtx, id: string, body: any, headers: Headers, now = new Date()): Promise<Reply> {
  const g = await entriesGate(ctx);
  if (isReply(g)) return g;
  const { today } = when(headers, now);
  const clean = cleanOccurrenceInput(body, today);
  if (!clean.ok) return refuse(clean.identifier ? 422 : 400, clean.message);
  const cur = await getEntry(ctx.admin, ctx.userId, "scholar", id);
  if (!cur.ok) return unreadable();
  if (!cur.data) return refuse(404, "That entry could not be found.");
  if (!seriesDates(cur.data.entry).includes(clean.value.date)) return refuse(404, "That occurrence could not be found.");
  const v = clean.value;
  const r = v.action === "restore"
    ? await removeException(ctx.admin, ctx.userId, "scholar", id, v.date)
    : await putException(ctx.admin, ctx.userId, "scholar", id, { ...v, action: v.action }, cur.data.exceptions.find(e => e.occurrenceDate === v.date) ?? null);
  if (r === "not_found") return refuse(404, "That entry could not be found.");
  if (r !== "ok") return r === "not_provisioned" ? refuse(409, "Your own calendar entries are not available here yet.") : refuse(500, "That could not be saved just now. Try again shortly.");
  await audit(asCtx(ctx), "individual_scholar_calendar_occurrence", "individual_learning_calendar_entry", id, { action: v.action });
  return reply(200, { ok: true });
}

export { carryKey };
