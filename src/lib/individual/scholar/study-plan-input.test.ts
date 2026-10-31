import { describe, expect, it } from "vitest";
import { STUDY_PLAN_LIMITS, cleanStudyPlanInput, isIsoDate } from "./study-plan-input";

const TODAY = "2026-11-02";
const ok = (b: unknown) => cleanStudyPlanInput(b, TODAY);
const base = { weeklyMinutes: 250, daysPerWeek: 5 };

describe("cleanStudyPlanInput", () => {
  it("accepts the smallest form: time and days, everything else empty", () => {
    expect(ok(base)).toEqual({ ok: true, value: { examDate: null, examLabel: null, weeklyMinutes: 250, daysPerWeek: 5, goal: null, priorities: [] } });
  });
  it("accepts numbers typed as text, a date, text fields and priorities, trimmed and de-duplicated", () => {
    const r = ok({ weeklyMinutes: " 300 ", daysPerWeek: "3", examDate: "2027-03-01", examLabel: "  NCK   licensing ", goal: " Pass first time ", priorities: ["Renal", " renal ", "Cardiac", ""] });
    expect(r).toEqual({ ok: true, value: { examDate: "2027-03-01", examLabel: "NCK licensing", weeklyMinutes: 300, daysPerWeek: 3, goal: "Pass first time", priorities: ["Renal", "Cardiac"] } });
  });
  it("holds the table's own limits at both ends", () => {
    for (const m of [29, 3001, 0, -5, 1.5, "abc", null, undefined]) expect(ok({ ...base, weeklyMinutes: m }).ok).toBe(false);
    for (const m of [30, 3000]) expect(ok({ ...base, weeklyMinutes: m }).ok).toBe(true);
    for (const d of [0, 8, 2.5, "x", null]) expect(ok({ ...base, daysPerWeek: d }).ok).toBe(false);
    for (const d of [1, 7]) expect(ok({ ...base, daysPerWeek: d }).ok).toBe(true);
    expect(ok({ ...base, examLabel: "x".repeat(121) }).ok).toBe(false);
    expect(ok({ ...base, examLabel: "x".repeat(120) }).ok).toBe(true);
    expect(ok({ ...base, goal: "g".repeat(301) }).ok).toBe(false);
    expect(ok({ ...base, goal: "g".repeat(300) }).ok).toBe(true);
    expect(ok({ ...base, priorities: Array.from({ length: 11 }, (_, i) => `T${i}`) }).ok).toBe(false);
    expect(ok({ ...base, priorities: Array.from({ length: 10 }, (_, i) => `T${i}`) }).ok).toBe(true);
    expect(ok({ ...base, priorities: "Renal" }).ok).toBe(false);
    expect(STUDY_PLAN_LIMITS.priorities).toBe(10);
  });
  it("the exam date is optional, real, not in the past, and within three years", () => {
    expect(ok({ ...base, examDate: "" })).toMatchObject({ ok: true, value: { examDate: null } });
    expect(ok({ ...base, examDate: TODAY })).toMatchObject({ ok: true, value: { examDate: TODAY } });
    expect(ok({ ...base, examDate: "2026-11-01" })).toMatchObject({ ok: false });
    expect(ok({ ...base, examDate: "2026-02-30" })).toMatchObject({ ok: false });
    expect(ok({ ...base, examDate: "01/03/2027" })).toMatchObject({ ok: false });
    expect(ok({ ...base, examDate: "2029-11-02" }).ok).toBe(true);
    expect(ok({ ...base, examDate: "2029-11-03" }).ok).toBe(false);
  });
  it("refuses text that looks like it identifies a patient", () => {
    const r = ok({ ...base, goal: "Look after patient NHS no 943 476 5919" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.identifier).toBe(true);
  });
  it("a body that is not an object is a refusal, not a crash", () => {
    for (const b of [null, undefined, "x", 5, []]) expect(ok(b).ok).toBe(false);
  });
  it("isIsoDate", () => {
    expect(isIsoDate("2028-02-29")).toBe(true);
    expect(isIsoDate("2027-02-29")).toBe(false);
    expect(isIsoDate(20270101)).toBe(false);
  });
});
