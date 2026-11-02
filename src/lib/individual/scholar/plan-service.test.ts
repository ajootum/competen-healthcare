import { beforeEach, describe, expect, it, vi } from "vitest";

// The My Plan request services, end to end over the real event and entry stores, against an in-memory client. Every function acts on the
// CALLER'S rows: learner B can neither read nor change learner A's plan events, calendar entries or proposals, and the Scholar services never
// reach a Professional entry.

const h = vi.hoisted(() => ({
  A: "aaaaaaaa-0000-4000-8000-00000000000a", B: "bbbbbbbb-0000-4000-8000-00000000000b",
  MAT_A: "aaaaaaaa-0000-4000-8000-0000000000a1",
  plans: new Map<string, Record<string, unknown>>(), audits: [] as string[],
  policy: { on: true, studyPlan: true, reflection: true, proposal: true },
}));
vi.mock("./store", async orig => {
  const real = await orig<typeof import("./store")>();
  return {
    ...real,
    studyPlanSchema: async () => true,
    getStudyPlan: async (_a: unknown, userId: string) => ({ ok: true, data: h.plans.get(userId) ?? null }),
    saveStudyPlan: async (_a: unknown, userId: string, v: Record<string, unknown>) => { const row = { ...v, updatedAt: "now", goalType: v.goalType ?? null, sessionMinutes: v.sessionMinutes ?? null }; h.plans.set(userId, row); return { ok: true, plan: row }; },
    clearStudyPlan: async (_a: unknown, userId: string) => { h.plans.delete(userId); return "ok"; },
    listMaterials: async (_a: unknown, userId: string) => ({ ok: true, data: userId === h.A ? [{ id: h.MAT_A, title: "Renal notes" }] : [] }),
  };
});
vi.mock("./plan-data", () => ({ loadToday: async () => ({ ok: false, reason: "off" }), loadInsights: async () => ({ ok: false, reason: "off" }), loadProposal: async () => ({ ok: false, reason: "off" }) }));
vi.mock("./http", () => ({ audit: async (_c: unknown, action: string) => { h.audits.push(action); } }));
vi.mock("../policy", async orig => {
  const real = await orig<typeof import("../policy")>();
  return {
    ...real,
    loadIndividualPolicy: async () => ({
      ...real.resolvePolicy([]), scholarMyPlan: h.policy.on ? "on" : "off", scholarStudyPlan: h.policy.studyPlan,
      scholarPlanWeeklyReflection: h.policy.reflection ? "on" : "off", scholarPlanProposal: h.policy.proposal ? "on" : "off",
    }),
  };
});

import { fakeAdmin } from "../learning-plan/fake-admin";
import { resetLearningPlanSchema, listPlanEvents } from "../learning-plan/event-store";
import { createEntry, resetLearnerCalendarSchema } from "../learning-plan/entry-store";
import {
  decisionService, entriesListService, entryCreateService, entryDeleteService, entryUpdateService, occurrenceService, proposalPostService, reflectionService, settingsGetService,
  settingsService, todayService,
} from "./plan-service";

const { A, B, MAT_A } = h;
const NOW = new Date("2026-11-02T09:00:00Z");   // a Monday
const hdr = (tz: string | null = null) => ({ get: (n: string) => (n === "x-vercel-ip-timezone" ? tz : null) });
const DEFAULTS = { individual_learning_calendar_entry: { status: "planned" } };
let admin: ReturnType<typeof fakeAdmin>;
const ctx = (userId: string) => ({ admin, userId }) as never;
const events = async (userId: string, kind: string) => { const r = await listPlanEvents(admin, userId, "scholar", [kind as never]); return r.ok ? r.data : []; };

beforeEach(() => {
  admin = fakeAdmin({}, DEFAULTS);
  resetLearningPlanSchema(); resetLearnerCalendarSchema();
  h.plans.clear(); h.audits.length = 0;
  Object.assign(h.policy, { on: true, studyPlan: true, reflection: true, proposal: true });
});

describe("gates", () => {
  it("My Plan off: every service answers 403 and writes nothing", async () => {
    h.policy.on = false;
    expect((await todayService(ctx(A), hdr(), NOW)).status).toBe(403);
    expect((await decisionService(ctx(A), { kind: "recommendation_declined", ref: "revise:due" }, hdr(), NOW)).status).toBe(403);
    expect((await entryCreateService(ctx(A), { entryType: "busy", title: "x", entryDate: "2026-11-05" }, hdr(), NOW)).status).toBe(403);
    expect(admin.log.filter(l => l.startsWith("insert"))).toEqual([]);
  });
  it("without migration 840 the decision, reflection, proposal and entry services answer 409 and write nothing", async () => {
    const missing = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "42P01" } }) }), limit: async () => ({ data: null, error: { code: "42P01" } }) }) }) };
    const c = { admin: missing, userId: A } as never;
    expect((await decisionService(c, { kind: "recommendation_declined", ref: "revise:due" }, hdr(), NOW)).status).toBe(409);
    expect((await reflectionService(c, { week: "2026-W45", workload: "manageable" }, hdr(), NOW)).status).toBe(409);
    expect((await proposalPostService(c, { materialId: MAT_A, decision: "accepted" }, hdr(), NOW)).status).toBe(409);
    expect((await entryCreateService(c, { entryType: "busy", title: "x", entryDate: "2026-11-05" }, hdr(), NOW)).status).toBe(409);
  });
});

describe("decisions", () => {
  it("records a declined suggestion with its evidence fingerprint, for the caller only", async () => {
    const r = await decisionService(ctx(A), { kind: "recommendation_declined", ref: "revise:due", fingerprint: "due:7" }, hdr(), NOW);
    expect(r.status).toBe(200);
    const mine = await events(A, "recommendation_declined");
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ ref: "revise:due", status: "declined", value: { fingerprint: "due:7" }, experience: "scholar" });
    expect(await events(B, "recommendation_declined")).toEqual([]);
  });
  it("postpones a topic until tomorrow by default (in the learner's day), or a chosen date within 90 days", async () => {
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "Renal" }, hdr("Africa/Nairobi"), new Date("2026-11-02T22:30:00Z"))).body).toMatchObject({ ok: true, until: "2026-11-04" });
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "Cardiac", until: "2026-11-09" }, hdr(), NOW)).body).toMatchObject({ until: "2026-11-09" });
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "Cardiac", until: "2026-11-02" }, hdr(), NOW)).status).toBe(400);
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "Cardiac", until: "2027-06-01" }, hdr(), NOW)).status).toBe(400);
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "   " }, hdr(), NOW)).status).toBe(400);
    expect((await decisionService(ctx(A), { kind: "topic_postponed", ref: "Mrs Jane Smith MRN 4455667" }, hdr(), NOW)).status).toBe(422);
    const ev = await events(A, "topic_postponed");
    expect(ev.map(e => e.ref).sort()).toEqual(["cardiac", "renal"]);
  });
  it("undoes an automatic change only when the caller has an applied event for it; idempotently; and B cannot undo A's", async () => {
    const ref = "learn:renal-1abc@2026-11-01";
    expect((await decisionService(ctx(A), { kind: "auto_adjust", ref, status: "undone" }, hdr(), NOW)).status).toBe(404);   // nothing applied: cannot be fabricated
    await (await import("../learning-plan/event-store")).appendPlanEvent(admin, A, "scholar", { kind: "auto_adjust", ref, status: "applied", value: { from: "2026-11-01", to: "2026-11-02" } });
    expect((await decisionService(ctx(B), { kind: "auto_adjust", ref, status: "undone" }, hdr(), NOW)).status).toBe(404);
    expect(await events(B, "auto_adjust")).toEqual([]);
    expect((await decisionService(ctx(A), { kind: "auto_adjust", ref, status: "undone" }, hdr(), NOW)).status).toBe(200);
    expect((await decisionService(ctx(A), { kind: "auto_adjust", ref, status: "undone" }, hdr(), NOW)).body).toMatchObject({ already: true });
    expect((await events(A, "auto_adjust")).filter(e => e.status === "undone")).toHaveLength(1);
    expect((await decisionService(ctx(A), { kind: "auto_adjust", ref: "not a ref", status: "undone" }, hdr(), NOW)).status).toBe(400);
    expect((await decisionService(ctx(A), { kind: "auto_adjust", ref, status: "applied" }, hdr(), NOW)).status).toBe(400);
  });
  it("refuses an unknown kind and a malformed ref", async () => {
    expect((await decisionService(ctx(A), { kind: "everything" }, hdr(), NOW)).status).toBe(400);
    expect((await decisionService(ctx(A), { kind: "recommendation_declined", ref: "bad ref!" }, hdr(), NOW)).status).toBe(400);
  });
});

describe("weekly reflection", () => {
  it("keeps a private reflection and returns an offer that is never applied", async () => {
    h.plans.set(A, { examDate: null, examLabel: null, weeklyMinutes: 160, daysPerWeek: 4, goal: null, priorities: [], goalType: "learn", sessionMinutes: 40 });
    const r = await reflectionService(ctx(A), { week: "2026-W45", workload: "too_demanding", note: "Long shifts" }, hdr(), NOW);
    expect(r.status).toBe(200);
    expect(r.body.offer).toMatchObject({ proposedSessionMinutes: 30, applied: false });
    expect(h.plans.get(A)).toMatchObject({ sessionMinutes: 40, weeklyMinutes: 160 });       // unchanged
    const ev = await events(A, "reflection");
    expect(ev[0]).toMatchObject({ ref: "2026-W45", value: { workload: "too_demanding", note: "Long shifts" } });
    expect(await events(B, "reflection")).toEqual([]);
  });
  it("is refused when switched off, with a patient identifier in the note, or for a future week", async () => {
    expect((await reflectionService(ctx(A), { week: "2026-W45", workload: "too_demanding", note: "Mrs Jane Smith MRN 4455667" }, hdr(), NOW)).status).toBe(422);
    expect((await reflectionService(ctx(A), { week: "2026-W50", workload: "manageable" }, hdr(), NOW)).status).toBe(400);
    h.policy.reflection = false;
    expect((await reflectionService(ctx(A), { week: "2026-W45", workload: "manageable" }, hdr(), NOW)).status).toBe(403);
    expect(await events(A, "reflection")).toEqual([]);
  });
  it("a manageable week, or no saved plan, gives no offer", async () => {
    expect((await reflectionService(ctx(A), { week: "2026-W45", workload: "too_light" }, hdr(), NOW)).body.offer).toBeNull();
  });
});

describe("proposal answers", () => {
  it("keeps accept / not now / decline for the caller's own material only", async () => {
    expect((await proposalPostService(ctx(A), { materialId: MAT_A, decision: "accepted" }, hdr(), NOW)).status).toBe(200);
    expect((await events(A, "proposal"))[0]).toMatchObject({ ref: MAT_A, status: "accepted" });
    expect((await proposalPostService(ctx(B), { materialId: MAT_A, decision: "accepted" }, hdr(), NOW)).status).toBe(404);
    expect(await events(B, "proposal")).toEqual([]);
    expect((await proposalPostService(ctx(A), { materialId: MAT_A, decision: "maybe" }, hdr(), NOW)).status).toBe(400);
    expect((await proposalPostService(ctx(A), { materialId: "nope", decision: "accepted" }, hdr(), NOW)).status).toBe(400);
    h.policy.proposal = false;
    expect((await proposalPostService(ctx(A), { materialId: MAT_A, decision: "accepted" }, hdr(), NOW)).status).toBe(403);
  });
});

describe("settings: the three questions, the approval rule and the exam offer", () => {
  const three = { goalType: "learn", sessionMinutes: 30, daysPerWeek: 4 };
  it("saves the three answers and logs the change with before and after", async () => {
    const r = await settingsService(ctx(A), three, hdr(), NOW);
    expect(r.status).toBe(200);
    expect(h.plans.get(A)).toMatchObject({ goalType: "learn", sessionMinutes: 30, weeklyMinutes: 120, daysPerWeek: 4 });
    const ev = await events(A, "settings_change");
    expect(ev).toHaveLength(1);
    expect(ev[0].value).toMatchObject({ before: null, after: { goalType: "learn", weeklyMinutes: 120 } });
    await settingsService(ctx(A), { ...three, sessionMinutes: 45 }, hdr(), NOW);
    expect((await events(A, "settings_change"))[0].value).toMatchObject({ before: { sessionMinutes: 30 }, after: { sessionMinutes: 45 }, changed: ["sessionMinutes", "weeklyMinutes"] });
  });
  it("still accepts the old shape", async () => {
    expect((await settingsService(ctx(A), { weeklyMinutes: 200, daysPerWeek: 4 }, hdr(), NOW)).status).toBe(200);
    expect(h.plans.get(A)).toMatchObject({ weeklyMinutes: 200, goalType: null });
  });
  it("a workload increase beyond the maximum answers 409 with the explanation until confirmIncrease is true", async () => {
    const big = { goalType: "learn", sessionMinutes: 120, daysPerWeek: 7 };      // 840 a week, over the 600 default
    const refused = await settingsService(ctx(A), big, hdr(), NOW);
    expect(refused.status).toBe(409);
    expect(refused.body).toMatchObject({ needsConfirmation: true, to: 840, max: 600 });
    expect(String(refused.body.error)).toMatch(/Confirm/);
    expect(h.plans.has(A)).toBe(false);
    expect((await settingsService(ctx(A), { ...big, confirmIncrease: true }, hdr(), NOW)).status).toBe(200);
    expect(h.plans.get(A)).toMatchObject({ weeklyMinutes: 840 });
    expect((await events(A, "settings_change"))[0].value).toMatchObject({ confirmedIncrease: true });
    // saving the same plan again is not an increase
    expect((await settingsService(ctx(A), big, hdr(), NOW)).status).toBe(200);
  });
  it("the study plan switch gates the settings", async () => {
    h.policy.studyPlan = false;
    expect((await settingsService(ctx(A), three, hdr(), NOW)).status).toBe(403);
  });
  it("an exam in the learner's own calendar is only an offer: applying it needs confirm:true, and then logs a settings change", async () => {
    await settingsService(ctx(A), three, hdr(), NOW);
    const made = await entryCreateService(ctx(A), { entryType: "exam", title: "Final OSCE", entryDate: "2026-12-10" }, hdr(), NOW);
    expect(made.status).toBe(201);
    const key = `${(made.body.entry as { id: string }).id}@2026-12-10`;
    const offers = (await settingsGetService(ctx(A), hdr(), NOW)).body.examOffers as { key: string; applied: boolean }[];
    expect(offers.map(o => o.key)).toEqual([key]);
    expect(h.plans.get(A)).toMatchObject({ goalType: "learn", examDate: null });                 // an offer changes nothing
    const ask = await settingsService(ctx(A), { applyExamOffer: key }, hdr(), NOW);
    expect(ask.status).toBe(409);
    expect(ask.body).toMatchObject({ needsConfirmation: true });
    expect(h.plans.get(A)).toMatchObject({ goalType: "learn", examDate: null });
    const done = await settingsService(ctx(A), { applyExamOffer: key, confirm: true }, hdr(), NOW);
    expect(done.status).toBe(200);
    expect(h.plans.get(A)).toMatchObject({ goalType: "exam", examDate: "2026-12-10", examLabel: "Final OSCE", sessionMinutes: 30, daysPerWeek: 4 });
    const last = (await events(A, "settings_change"))[0];
    expect(last.value).toMatchObject({ source: "exam_entry", entryKey: key });
  });
  it("learner B cannot apply A's exam entry as their own exam date", async () => {
    await settingsService(ctx(A), three, hdr(), NOW);
    await settingsService(ctx(B), three, hdr(), NOW);
    const made = await entryCreateService(ctx(A), { entryType: "exam", title: "A's exam", entryDate: "2026-12-10" }, hdr(), NOW);
    const key = `${(made.body.entry as { id: string }).id}@2026-12-10`;
    const r = await settingsService(ctx(B), { applyExamOffer: key, confirm: true }, hdr(), NOW);
    expect(r.status).toBe(404);
    expect(h.plans.get(B)).toMatchObject({ examDate: null });
    expect((await settingsGetService(ctx(B), hdr(), NOW)).body.examOffers).toEqual([]);
  });
  it("applying an exam offer needs an existing plan", async () => {
    const made = await entryCreateService(ctx(A), { entryType: "exam", title: "Final OSCE", entryDate: "2026-12-10" }, hdr(), NOW);
    const key = `${(made.body.entry as { id: string }).id}@2026-12-10`;
    expect((await settingsService(ctx(A), { applyExamOffer: key, confirm: true }, hdr(), NOW)).status).toBe(409);
  });
});

describe("the learner's own calendar entries", () => {
  const session = { entryType: "study_session", title: "Renal revision", entryDate: "2026-11-03", startTime: "09:00", endTime: "09:45", recurrence: { freq: "weekly", interval: 1, byweekday: [1], count: 4 } };
  it("creates a series, lists its occurrences for the caller, and learner B sees none of it", async () => {
    const made = await entryCreateService(ctx(A), session, hdr(), NOW);
    expect(made.status).toBe(201);
    const listed = await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW);
    expect((listed.body.occurrences as { date: string }[]).map(o => o.date)).toEqual(["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);
    expect((await entriesListService(ctx(B), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences).toEqual([]);
  });
  it("learner B cannot change, complete, cancel or delete A's entry or any of its occurrences", async () => {
    const id = ((await entryCreateService(ctx(A), session, hdr(), NOW)).body.entry as { id: string }).id;
    expect((await entryUpdateService(ctx(B), id, { title: "Hacked" }, hdr(), NOW)).status).toBe(404);
    expect((await entryUpdateService(ctx(B), id, { status: "completed" }, hdr(), NOW)).status).toBe(404);
    expect((await occurrenceService(ctx(B), id, { date: "2026-11-10", action: "cancelled" }, hdr(), NOW)).status).toBe(404);
    expect((await entryDeleteService(ctx(B), id)).status).toBe(404);
    const mine = (await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences as { title: string; status: string }[];
    expect(mine).toHaveLength(4);
    expect(mine.every(o => o.title === "Renal revision" && o.status === "planned")).toBe(true);
    expect(admin.tables.individual_learning_calendar_exception ?? []).toHaveLength(0);
  });
  it("the Scholar services never see a Professional entry of the same learner", async () => {
    const pro = await createEntry(admin, A, "professional", { entryType: "placement", title: "Ward placement", description: null, entryDate: "2026-11-05", startTime: null, endTime: null, durationMinutes: null, link: null, recurrence: null });
    if (!pro.ok) throw new Error("setup");
    const listed = await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW);
    expect(listed.body.occurrences).toEqual([]);
    expect((await entryUpdateService(ctx(A), pro.entry.id, { title: "Changed" }, hdr(), NOW)).status).toBe(404);
    expect((await entryDeleteService(ctx(A), pro.entry.id)).status).toBe(404);
    expect((await occurrenceService(ctx(A), pro.entry.id, { date: "2026-11-05", action: "completed" }, hdr(), NOW)).status).toBe(404);
    expect(admin.tables.individual_learning_calendar_entry).toHaveLength(1);
    expect(admin.tables.individual_learning_calendar_entry[0]).toMatchObject({ title: "Ward placement", status: "planned" });
  });
  it("changing ONE occurrence leaves every other occurrence unchanged; restore puts it back", async () => {
    const id = ((await entryCreateService(ctx(A), session, hdr(), NOW)).body.entry as { id: string }).id;
    const before = (await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences as { date: string; occurrenceDate: string; title: string; status: string }[];
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-10", action: "edited", title: "Renal revision (long)", newStart: "10:00", newEnd: "11:00" }, hdr(), NOW)).status).toBe(200);
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-17", action: "completed" }, hdr(), NOW)).status).toBe(200);
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-24", action: "moved", newDate: "2026-11-26" }, hdr(), NOW)).status).toBe(200);
    const after = (await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences as typeof before;
    const byOcc = (l: typeof before, d: string) => l.find(o => o.occurrenceDate === d)!;
    expect(byOcc(after, "2026-11-03")).toEqual(byOcc(before, "2026-11-03"));                      // untouched
    expect(byOcc(after, "2026-11-10").title).toBe("Renal revision (long)");
    expect(byOcc(after, "2026-11-17").status).toBe("completed");
    expect(byOcc(after, "2026-11-24").date).toBe("2026-11-26");
    expect(after.filter(o => o.title === "Renal revision")).toHaveLength(3);   // the edited one is the only one with another title
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-24", action: "cancelled" }, hdr(), NOW)).status).toBe(200);
    expect((await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences).toHaveLength(3);
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-24", action: "restore" }, hdr(), NOW)).status).toBe(200);
    expect((await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences).toHaveLength(4);
    // a date the series never gave is not an occurrence
    expect((await occurrenceService(ctx(A), id, { date: "2026-11-11", action: "cancelled" }, hdr(), NOW)).status).toBe(404);
  });
  it("a series edit changes the series, a series delete removes it with its exceptions, and a completion is the learner's word", async () => {
    const id = ((await entryCreateService(ctx(A), session, hdr(), NOW)).body.entry as { id: string }).id;
    expect((await entryUpdateService(ctx(A), id, { title: "Renal and cardiac" }, hdr(), NOW)).status).toBe(200);
    const titles = ((await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences as { title: string }[]).map(o => o.title);
    expect(new Set(titles)).toEqual(new Set(["Renal and cardiac"]));
    expect((await entryUpdateService(ctx(A), id, { status: "completed" }, hdr(), NOW)).status).toBe(200);
    const done = (await entriesListService(ctx(A), { from: "2026-11-01", to: "2026-12-31" }, hdr(), NOW)).body.occurrences as { selfReported: boolean }[];
    expect(done.every(o => o.selfReported)).toBe(true);
    expect((await entryUpdateService(ctx(A), id, {}, hdr(), NOW)).status).toBe(400);
    expect((await entryUpdateService(ctx(A), id, { status: "done" }, hdr(), NOW)).status).toBe(400);
    await occurrenceService(ctx(A), id, { date: "2026-11-10", action: "cancelled" }, hdr(), NOW);
    expect((await entryDeleteService(ctx(A), id)).status).toBe(200);
    expect(admin.tables.individual_learning_calendar_entry).toHaveLength(0);
    expect((await entryDeleteService(ctx(A), id)).status).toBe(404);
  });
  it("validates what is sent: a title, real dates, times, a bounded series, no patient identifiers, and a 400-day range", async () => {
    expect((await entryCreateService(ctx(A), { entryType: "busy", title: "", entryDate: "2026-11-05" }, hdr(), NOW)).status).toBe(400);
    expect((await entryCreateService(ctx(A), { entryType: "busy", title: "x", entryDate: "2031-11-05" }, hdr(), NOW)).status).toBe(400);
    expect((await entryCreateService(ctx(A), { ...session, recurrence: { freq: "daily", interval: 1 } }, hdr(), NOW)).status).toBe(400);
    expect((await entryCreateService(ctx(A), { entryType: "other", title: "Case of Mrs Jane Smith MRN 4455667", entryDate: "2026-11-05" }, hdr(), NOW)).status).toBe(422);
    expect((await entriesListService(ctx(A), { from: "2026-01-01", to: "2027-06-01" }, hdr(), NOW)).status).toBe(400);
    expect(admin.tables.individual_learning_calendar_entry ?? []).toHaveLength(0);
  });
  it("writes only the caller's id from the guard, whatever the body claims", async () => {
    await entryCreateService(ctx(A), { ...session, userId: B, user_id: B, experience: "professional" }, hdr(), NOW);
    expect(admin.tables.individual_learning_calendar_entry[0]).toMatchObject({ user_id: A, experience: "scholar" });
  });
});
