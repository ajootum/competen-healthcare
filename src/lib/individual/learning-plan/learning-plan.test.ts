import { beforeEach, describe, expect, it } from "vitest";
import { cleanEntryInput, cleanOccurrenceInput, cleanRange, occurrenceToPlanItem } from "./calendar-entries";
import { appendPlanEvent, learningPlanSchema, listPlanEvents, resetLearningPlanSchema } from "./event-store";
import { createEntry, deleteEntry, getEntry, learnerCalendarSchema, listEntries, putException, removeException, resetLearnerCalendarSchema, updateEntry } from "./entry-store";
import { fakeAdmin } from "./fake-admin";
import { MAX_OCCURRENCES, expandEntries, expandEntry, seriesDates, seriesWithinLimit, weekdayOf } from "./recurrence";
import { latestPerRef, occurrenceKey, OCCURRENCE_KEY, type CalendarEntry, type EntryException, type PlanEvent } from "./types";
import { activityToPlanItem, goalToPlanItem, professionalPlanItems } from "./professional-adapter";

const TODAY = "2026-11-02"; // a Monday
const entry = (o: Partial<CalendarEntry> = {}): CalendarEntry => ({
  id: "11111111-1111-4111-8111-111111111111", experience: "scholar", entryType: "study_session", title: "Renal revision", description: null, entryDate: "2026-11-03",
  startTime: "09:00", endTime: "09:45", durationMinutes: null, link: null, recurrence: null, status: "planned", completedAt: null, createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", ...o,
});
const exc = (entryId: string, occurrenceDate: string, o: Partial<EntryException> = {}): EntryException => ({
  entryId, occurrenceDate, action: "cancelled", newDate: null, newStartTime: null, newEndTime: null, title: null, completedAt: null, ...o,
});
const weekly = (o: Partial<CalendarEntry> = {}) => entry({ recurrence: { freq: "weekly", interval: 1, byweekday: [1, 3], count: 6 }, ...o });
const dates = (list: { date: string }[]) => list.map(o => o.date);

describe("recurrence: the dates a series gives", () => {
  it("a one-off entry is its one date", () => {
    expect(seriesDates(entry())).toEqual(["2026-11-03"]);
  });
  it("daily: every N days, by count or until, inclusive", () => {
    expect(seriesDates(entry({ recurrence: { freq: "daily", interval: 1, count: 3 } }))).toEqual(["2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(seriesDates(entry({ recurrence: { freq: "daily", interval: 2, until: "2026-11-09" } }))).toEqual(["2026-11-03", "2026-11-05", "2026-11-07", "2026-11-09"]);
  });
  it("weekly: the chosen weekdays (Monday = 0), from the first date, every N weeks", () => {
    expect(weekdayOf("2026-11-03")).toBe(1);
    expect(seriesDates(weekly())).toEqual(["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"]);
    expect(seriesDates(entry({ recurrence: { freq: "weekly", interval: 2, byweekday: [0], count: 3 } }))).toEqual(["2026-11-16", "2026-11-30", "2026-12-14"]);
  });
  it("weekly with no weekdays repeats on the weekday of the first date; the first date is never skipped when it is a chosen weekday", () => {
    expect(seriesDates(entry({ recurrence: { freq: "weekly", interval: 1, count: 3 } }))).toEqual(["2026-11-03", "2026-11-10", "2026-11-17"]);
  });
  it("when both an end date and a count are given, whichever ends it first", () => {
    expect(seriesDates(entry({ recurrence: { freq: "daily", interval: 1, count: 10, until: "2026-11-05" } }))).toHaveLength(3);
  });
  it("a series never gives more than 200 occurrences, and an open-ended or over-long one is refused", () => {
    const long = entry({ recurrence: { freq: "daily", interval: 1, count: 200 } });
    expect(seriesDates(long)).toHaveLength(MAX_OCCURRENCES);
    expect(seriesWithinLimit(entry({ recurrence: { freq: "daily", interval: 1 } }))).toBe(false);
    expect(seriesWithinLimit(entry({ recurrence: { freq: "daily", interval: 1, until: "2028-01-01" } }))).toBe(false);
    expect(seriesWithinLimit(entry({ recurrence: { freq: "weekly", interval: 1, until: "2027-01-01" } }))).toBe(true);
    expect(seriesWithinLimit(entry({ recurrence: { freq: "daily", interval: 1, count: 201 } }))).toBe(false);
  });
});

describe("recurrence: one occurrence is changed alone", () => {
  const e = weekly();
  const all = () => expandEntry(e, [], "2026-11-01", "2026-12-31");
  it("expands the series into occurrences keyed entry@date, in the range asked", () => {
    const occ = all();
    expect(dates(occ)).toEqual(["2026-11-03", "2026-11-05", "2026-11-10", "2026-11-12", "2026-11-17", "2026-11-19"]);
    expect(occ[0].key).toBe(occurrenceKey(e.id, "2026-11-03"));
    expect(OCCURRENCE_KEY.test(occ[0].key)).toBe(true);
    expect(dates(expandEntry(e, [], "2026-11-10", "2026-11-12"))).toEqual(["2026-11-10", "2026-11-12"]);
  });
  it("cancelling one occurrence removes only that one", () => {
    const occ = expandEntry(e, [exc(e.id, "2026-11-10")], "2026-11-01", "2026-12-31");
    expect(dates(occ)).toEqual(["2026-11-03", "2026-11-05", "2026-11-12", "2026-11-17", "2026-11-19"]);
    expect(expandEntry(e, [exc(e.id, "2026-11-10")], "2026-11-01", "2026-12-31", { includeCancelled: true }).find(o => o.occurrenceDate === "2026-11-10")?.status).toBe("cancelled");
  });
  it("moving one occurrence changes its date and nothing else, and it keeps its key", () => {
    const base = all();
    const occ = expandEntry(e, [exc(e.id, "2026-11-10", { action: "moved", newDate: "2026-11-11" })], "2026-11-01", "2026-12-31");
    const moved = occ.find(o => o.occurrenceDate === "2026-11-10")!;
    expect(moved.date).toBe("2026-11-11");
    expect(moved.moved).toBe(true);
    expect(moved.key).toBe(occurrenceKey(e.id, "2026-11-10"));
    // every other occurrence is deep-equal to what it was without the exception
    for (const o of occ.filter(x => x.occurrenceDate !== "2026-11-10")) expect(o).toEqual(base.find(b => b.occurrenceDate === o.occurrenceDate));
    expect(occ).toHaveLength(base.length);
  });
  it("a moved occurrence appears in the range it moved INTO, and not the one it left", () => {
    const ex = [exc(e.id, "2026-11-10", { action: "moved", newDate: "2026-12-30" })];
    expect(dates(expandEntry(e, ex, "2026-12-29", "2026-12-31"))).toEqual(["2026-12-30"]);
    expect(dates(expandEntry(e, ex, "2026-11-10", "2026-11-10"))).toEqual([]);
  });
  it("editing one occurrence changes its title and times alone", () => {
    const base = all();
    const occ = expandEntry(e, [exc(e.id, "2026-11-12", { action: "edited", title: "Renal revision (long)", newStartTime: "10:00", newEndTime: "11:00" })], "2026-11-01", "2026-12-31");
    const one = occ.find(o => o.occurrenceDate === "2026-11-12")!;
    expect([one.title, one.startTime, one.endTime, one.edited]).toEqual(["Renal revision (long)", "10:00", "11:00", true]);
    for (const o of occ.filter(x => x.occurrenceDate !== "2026-11-12")) expect(o).toEqual(base.find(b => b.occurrenceDate === o.occurrenceDate));
  });
  it("completing one occurrence marks only that one, as self-reported", () => {
    const occ = expandEntry(e, [exc(e.id, "2026-11-03", { action: "completed" })], "2026-11-01", "2026-12-31");
    expect(occ.filter(o => o.selfReported).map(o => o.occurrenceDate)).toEqual(["2026-11-03"]);
    expect(occ.filter(o => !o.selfReported).every(o => o.status === "planned")).toBe(true);
  });
  it("a completed or cancelled SERIES applies to every occurrence that has no exception of its own", () => {
    const done = expandEntry(weekly({ status: "completed" }), [exc(e.id, "2026-11-10")], "2026-11-01", "2026-12-31");
    expect(done.every(o => o.status === "completed")).toBe(true);
    expect(done.some(o => o.occurrenceDate === "2026-11-10")).toBe(false);   // its own exception (cancelled) wins
    expect(expandEntry(weekly({ status: "cancelled" }), [], "2026-11-01", "2026-12-31")).toEqual([]);
  });
  it("an all-day entry has no times; the length comes from the entry or from its times", () => {
    expect(expandEntry(entry({ startTime: null, endTime: null }), [], TODAY, "2026-11-30")[0].allDay).toBe(true);
    expect(expandEntry(entry(), [], TODAY, "2026-11-30")[0].durationMinutes).toBe(45);
    expect(expandEntry(entry({ durationMinutes: 30 }), [], TODAY, "2026-11-30")[0].durationMinutes).toBe(30);
  });
  it("an exception of another entry is ignored", () => {
    expect(dates(expandEntry(e, [exc("22222222-2222-4222-8222-222222222222", "2026-11-10")], "2026-11-01", "2026-12-31"))).toHaveLength(6);
  });
  it("occurrence keys are uuid@date, so they can never equal a Scholar plan key (plan:space:topic|nth)", () => {
    for (const o of all()) { expect(o.key.startsWith("plan:")).toBe(false); expect(o.key.includes("|")).toBe(false); expect(o.key.includes(":")).toBe(false); }
  });
  it("many entries are merged in date, time and title order", () => {
    const a = entry({ id: "aaaaaaaa-1111-4111-8111-111111111111", title: "B", entryDate: "2026-11-03", startTime: "10:00", endTime: "11:00" });
    const b = entry({ id: "bbbbbbbb-1111-4111-8111-111111111111", title: "A", entryDate: "2026-11-03", startTime: "09:00", endTime: "09:30" });
    expect(expandEntries([a, b], [], TODAY, "2026-11-30").map(o => o.title)).toEqual(["A", "B"]);
  });
});

describe("calendar entry validation", () => {
  const ok = { entryType: "study_session", title: "  Renal   revision ", entryDate: "2026-11-05", startTime: "14:00", endTime: "15:00" };
  it("accepts a valid entry and tidies the title", () => {
    const r = cleanEntryInput(ok, TODAY);
    expect(r.ok && r.value.title).toBe("Renal revision");
    expect(r.ok && r.value.startTime).toBe("14:00");
  });
  it("requires a title, a known type and a real date within 3 years", () => {
    expect(cleanEntryInput({ ...ok, title: "  " }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, entryType: "party" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, entryDate: "2026-02-30" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, entryDate: "2030-01-01" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, entryDate: "2023-01-01" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, title: "x".repeat(201) }, TODAY).ok).toBe(false);
  });
  it("checks times: end after start, an end needs a start, HH:MM only", () => {
    expect(cleanEntryInput({ ...ok, endTime: "13:00" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, startTime: null, endTime: "13:00" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, startTime: "25:00" }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, startTime: "14:00:00", endTime: "15:00:00" }, TODAY).ok).toBe(true);
    const allDay = cleanEntryInput({ entryType: "busy", title: "Away", entryDate: "2026-11-05" }, TODAY);
    expect(allDay.ok && allDay.value.startTime).toBeNull();
  });
  it("checks duration, link and recurrence", () => {
    expect(cleanEntryInput({ ...ok, durationMinutes: 4 }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, durationMinutes: 45 }, TODAY).ok).toBe(true);
    expect(cleanEntryInput({ ...ok, link: { kind: "topic", id: "renal", label: "Renal" } }, TODAY).ok).toBe(true);
    expect(cleanEntryInput({ ...ok, link: { kind: "planet", id: "x", label: "y" } }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "weekly", interval: 1, byweekday: [1], count: 4 } }, TODAY).ok).toBe(true);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "weekly", interval: 1 } }, TODAY).ok).toBe(false);          // no end
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "monthly", interval: 1, count: 4 } }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "daily", interval: 9, count: 4 } }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "daily", interval: 1, count: 500 } }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "weekly", interval: 1, byweekday: [9], count: 4 } }, TODAY).ok).toBe(false);
    expect(cleanEntryInput({ ...ok, recurrence: { freq: "daily", interval: 1, until: "2026-11-01" } }, TODAY).ok).toBe(false);
  });
  it("refuses text that identifies a patient, in the title or the description", () => {
    const r = cleanEntryInput({ ...ok, title: "Review for Mrs Jane Smith, DOB 12/03/1948, MRN 4455667" }, TODAY);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.identifier).toBe(true);
    expect(cleanEntryInput({ ...ok, description: "Patient NHS number 943 476 5919" }, TODAY).ok).toBe(false);
  });
  it("an edit keeps every field the body leaves out", () => {
    const base = cleanEntryInput(ok, TODAY);
    if (!base.ok) throw new Error("setup");
    const r = cleanEntryInput({ title: "Cardiac revision" }, TODAY, base.value);
    expect(r.ok && [r.value.title, r.value.entryDate, r.value.startTime]).toEqual(["Cardiac revision", "2026-11-05", "14:00"]);
  });
  it("occurrence changes: a real date, a known action, a move needs a new date, restore is allowed", () => {
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "moved", newDate: "2026-11-11" }, TODAY).ok).toBe(true);
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "moved" }, TODAY).ok).toBe(false);
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "restore" }, TODAY).ok).toBe(true);
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "delete" }, TODAY).ok).toBe(false);
    expect(cleanOccurrenceInput({ date: "bad", action: "completed" }, TODAY).ok).toBe(false);
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "edited" }, TODAY).ok).toBe(false);
    expect(cleanOccurrenceInput({ date: "2026-11-10", action: "edited", title: "Longer" }, TODAY).ok).toBe(true);
  });
  it("a list range is real, ordered, within 3 years and at most 400 days", () => {
    expect(cleanRange("2026-11-01", "2026-12-01", TODAY).ok).toBe(true);
    expect(cleanRange("2026-12-01", "2026-11-01", TODAY).ok).toBe(false);
    expect(cleanRange("2026-01-01", "2027-12-31", TODAY).ok).toBe(false);
    expect(cleanRange("2020-01-01", "2020-02-01", TODAY).ok).toBe(false);
  });
});

describe("the shared PlanItem", () => {
  it("maps an occurrence to a plan item in the learner's own words", () => {
    const o = expandEntry(entry(), [], TODAY, "2026-11-30")[0];
    const item = occurrenceToPlanItem(o);
    expect(item).toMatchObject({ experience: "scholar", source: "calendar_entry", ref: o.key, title: "Renal revision", minutes: 45, due: "2026-11-03" });
    expect(item.why).toMatch(/your calendar/);
  });
  it("the Professional adapter maps open activities and dated open goals, and leaves out finished ones", () => {
    const act = { id: "a1", activity_type_code: null, activity_type_label: null, title: "Attend resuscitation course", detail: null, status: "planned", planned_start: "2026-11-20", planned_end: "2026-11-21", provider: null, external_url: null, learning_offering_id: null, learning_record_id: null, cpd_id: null, depends_on_activity_id: null, created_at: "", updated_at: "" };
    const done = { ...act, id: "a2", status: "completed" };
    const goal = { id: "g1", need_id: null, title: "Lead a teaching session", detail: null, target_date: "2026-12-01", status: "in_progress", completed_at: null, created_at: "", updated_at: "", goal_type_code: null, goal_type_label: null, motivation: null, intended_outcome: "Teach confidently", priority_code: null, priority_label: null, expected_evidence: null, start_date: null, review_date: null, template_code: null, template_label: null, template_answers: null, created_from: "direct", source_framework_competency_id: null, source_learning_offering_id: null, aspiration_item_id: null, reflection_id: null, reviewed_at: null };
    const dropped = { ...goal, id: "g2", status: "dropped" };
    const undated = { ...goal, id: "g3", target_date: null };
    const items = professionalPlanItems({ activities: [act, done] as never, goals: [goal, dropped, undated] as never }, TODAY);
    expect(items.map(i => i.ref)).toEqual(["activity:a1", "goal:g1"]);
    expect(items.every(i => i.experience === "professional" && i.minutes === null)).toBe(true);
    expect(activityToPlanItem(done as never, TODAY)).toBeNull();
    expect(goalToPlanItem(undated as never, TODAY)).toBeNull();
  });
  it("latestPerRef keeps the newest event for each ref", () => {
    const ev = (id: string, ref: string, at: string, status: PlanEvent["status"]): PlanEvent => ({ id, experience: "scholar", kind: "proposal", ref, status, value: {}, createdAt: at });
    const m = latestPerRef([ev("1", "m1", "2026-11-01T00:00:00Z", "accepted"), ev("2", "m1", "2026-11-02T00:00:00Z", "declined"), ev("3", "m2", "2026-11-01T00:00:00Z", "accepted")]);
    expect(m.get("m1")?.status).toBe("declined");
    expect(m.get("m2")?.status).toBe("accepted");
  });
});

// ── the stores, against an in-memory client: the filters are the real ones ──
const A = "aaaaaaaa-0000-4000-8000-00000000000a", B = "bbbbbbbb-0000-4000-8000-00000000000b";
const DEFAULTS = { individual_learning_calendar_entry: { status: "planned" } };
const input = (o = {}) => { const r = cleanEntryInput({ entryType: "busy", title: "Placement week", entryDate: "2026-11-09", ...o }, TODAY); if (!r.ok) throw new Error(r.message); return r.value; };

describe("the plan event store", () => {
  beforeEach(() => resetLearningPlanSchema());
  it("appends for the caller and experience, and lists only those", async () => {
    const admin = fakeAdmin();
    expect(await appendPlanEvent(admin, A, "scholar", { kind: "proposal", ref: "m1", status: "accepted" })).toBe("ok");
    expect(await appendPlanEvent(admin, A, "professional", { kind: "proposal", ref: "p1", status: "accepted" })).toBe("ok");
    expect(await appendPlanEvent(admin, B, "scholar", { kind: "proposal", ref: "m2", status: "declined" })).toBe("ok");
    const a = await listPlanEvents(admin, A, "scholar", ["proposal"]);
    expect(a.ok && a.data.map(e => e.ref)).toEqual(["m1"]);
    const b = await listPlanEvents(admin, B, "scholar", ["proposal"]);
    expect(b.ok && b.data.map(e => e.ref)).toEqual(["m2"]);
    const pro = await listPlanEvents(admin, A, "professional", ["proposal"]);
    expect(pro.ok && pro.data.map(e => e.ref)).toEqual(["p1"]);
  });
  it("refuses an unknown kind, a too-long ref and an oversized value, and never writes them", async () => {
    const admin = fakeAdmin();
    expect(await appendPlanEvent(admin, A, "scholar", { kind: "other" as never, ref: "x" })).toBe("failed");
    expect(await appendPlanEvent(admin, A, "scholar", { kind: "reflection", ref: "x".repeat(201) })).toBe("failed");
    expect(await appendPlanEvent(admin, A, "scholar", { kind: "reflection", ref: "w", value: { note: "y".repeat(9000) } })).toBe("failed");
    expect(admin.tables.individual_learning_plan_event ?? []).toHaveLength(0);
  });
  it("fails closed without 840: the detector says no and writes answer not_provisioned", async () => {
    const missing = { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: "42P01" } }) }) }) };
    expect(await learningPlanSchema(missing)).toBe(false);
    expect(await appendPlanEvent(missing, A, "scholar", { kind: "reflection", ref: "w" })).toBe("not_provisioned");
    const l = await listPlanEvents(missing, A, "scholar", ["reflection"]);
    expect(l).toEqual({ ok: false, notProvisioned: true });
  });
});

describe("the learner calendar store: ownership and experience", () => {
  beforeEach(() => resetLearnerCalendarSchema());
  it("learner B cannot read, change, complete or delete learner A's entries", async () => {
    const admin = fakeAdmin({}, DEFAULTS);
    const made = await createEntry(admin, A, "scholar", input());
    if (!made.ok) throw new Error("setup");
    const id = made.entry.id;
    const bList = await listEntries(admin, B, "scholar", "2027-01-01");
    expect(bList.ok && bList.data.entries).toEqual([]);
    const bGet = await getEntry(admin, B, "scholar", id);
    expect(bGet.ok && bGet.data).toBeNull();
    expect(await updateEntry(admin, B, "scholar", id, { status: "completed" })).toBe("not_found");
    expect(await deleteEntry(admin, B, "scholar", id)).toBe("not_found");
    expect(await putException(admin, B, "scholar", id, { date: "2026-11-09", action: "cancelled", newDate: null, newStart: null, newEnd: null, title: null }, null)).toBe("not_found");
    expect(admin.tables.individual_learning_calendar_exception ?? []).toHaveLength(0);
    const aGet = await getEntry(admin, A, "scholar", id);
    expect(aGet.ok && aGet.data?.entry.status).toBe("planned");
  });
  it("a Scholar read never returns a Professional entry, and a Scholar write cannot touch one", async () => {
    const admin = fakeAdmin({}, DEFAULTS);
    const pro = await createEntry(admin, A, "professional", input({ title: "Ward placement", entryType: "placement" }));
    const sch = await createEntry(admin, A, "scholar", input({ title: "Exam week" }));
    if (!pro.ok || !sch.ok) throw new Error("setup");
    const scholar = await listEntries(admin, A, "scholar", "2027-01-01");
    expect(scholar.ok && scholar.data.entries.map(e => e.title)).toEqual(["Exam week"]);
    const professional = await listEntries(admin, A, "professional", "2027-01-01");
    expect(professional.ok && professional.data.entries.map(e => e.title)).toEqual(["Ward placement"]);
    expect((await getEntry(admin, A, "scholar", pro.entry.id)).ok).toBe(true);
    const crossGet = await getEntry(admin, A, "scholar", pro.entry.id);
    expect(crossGet.ok && crossGet.data).toBeNull();
    expect(await updateEntry(admin, A, "scholar", pro.entry.id, { status: "cancelled" })).toBe("not_found");
    expect(await deleteEntry(admin, A, "scholar", pro.entry.id)).toBe("not_found");
    expect(await putException(admin, A, "scholar", pro.entry.id, { date: "2026-11-09", action: "completed", newDate: null, newStart: null, newEnd: null, title: null }, null)).toBe("not_found");
    const stillThere = await getEntry(admin, A, "professional", pro.entry.id);
    expect(stillThere.ok && stillThere.data?.entry.status).toBe("planned");
  });
  it("an exception replaces the earlier change to that occurrence, a completion keeps the move, and restore removes it", async () => {
    const admin = fakeAdmin({}, DEFAULTS);
    const made = await createEntry(admin, A, "scholar", input({ entryType: "study_session", recurrence: { freq: "daily", interval: 1, count: 3 } }));
    if (!made.ok) throw new Error("setup");
    const id = made.entry.id;
    const blank = { newDate: null, newStart: null, newEnd: null, title: null };
    expect(await putException(admin, A, "scholar", id, { date: "2026-11-10", action: "moved", ...blank, newDate: "2026-11-12" }, null)).toBe("ok");
    let got = await getEntry(admin, A, "scholar", id);
    const prior = got.ok && got.data ? got.data.exceptions[0] : null;
    expect(prior?.newDate).toBe("2026-11-12");
    expect(await putException(admin, A, "scholar", id, { date: "2026-11-10", action: "completed", ...blank }, prior)).toBe("ok");
    got = await getEntry(admin, A, "scholar", id);
    const ex = got.ok && got.data ? got.data.exceptions : [];
    expect(ex).toHaveLength(1);
    expect([ex[0].action, ex[0].newDate]).toEqual(["completed", "2026-11-12"]);
    expect(await removeException(admin, A, "scholar", id, "2026-11-10")).toBe("ok");
    got = await getEntry(admin, A, "scholar", id);
    expect(got.ok && got.data?.exceptions).toEqual([]);
  });
  it("fails closed without the tables", async () => {
    const missing = { from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { code: "42P01" } }) }) }) };
    expect(await learnerCalendarSchema(missing)).toBe(false);
    expect(await createEntry(missing, A, "scholar", input())).toEqual({ ok: false, error: "not_provisioned" });
    expect(await listEntries(missing, A, "scholar", "2027-01-01")).toEqual({ ok: false, notProvisioned: true });
  });
});
