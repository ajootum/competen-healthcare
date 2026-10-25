/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { checkLcpdDraft, checkRequirement, DEFAULT_LCPD, recordableTypes, resolveLcpd } from "./lcpd-config";
import { cpdCsv, inEffect, NOT_VERIFIED, parseSetting, summarise } from "./cpd-requirements";
import { parseCpd } from "./validate";
import { cpdHoursByYear } from "./progress";

// COMPETEN-PROFESSIONAL-LCPD-01 (Stage 4 Learning and CPD): flexible CPD recording (LCPD-2), configuration with no seeded
// regulatory rule (s11), CPD requirements counted against but never "met" or "verified" (LCPD-5).

const TODAY = "2026-10-25";
const REQ = {
  code: "example_body_cpd", label: "Example CPD requirement", profession: "Nursing", jurisdiction: "Exampleland", body: "Example Nursing Council",
  source: { title: "Example Council CPD Standard", reference: "Section 4", url: "https://example.org/cpd" }, reviewStatus: "reviewed", reviewedOn: "2026-10-01",
  cycleMonths: 12, requiredHours: 20, requiredCredits: null, eligibleTypes: ["course", "workshop", "mentorship"],
  mandatoryCategories: [{ label: "Infection prevention", types: ["course"], minHours: 2 }], evidence: "Certificates", reportingPeriod: "Annual",
  effectiveFrom: "2026-01-01", effectiveTo: null, version: "2026.1",
};
const codes = new Set(DEFAULT_LCPD.activityTypes.map(t => t.code));

describe("configuration: no regulatory rule is seeded or invented", () => {
  it("the defaults carry no CPD requirement, and offer the owner's new activity types", () => {
    expect(DEFAULT_LCPD.requirements).toEqual([]);
    expect(resolveLcpd(null).requirements).toEqual([]);
    for (const c of ["workplace_learning", "mentorship", "quality_improvement", "reflective_practice", "self_study", "teaching", "research", "conference"]) expect(codes.has(c)).toBe(true);
    expect(DEFAULT_LCPD.reflectionTemplates.map(t => t.code)).toEqual(["quick", "guided", "detailed"]);
  });

  it("a requirement must name its authoritative source and its review status", () => {
    expect(checkRequirement(REQ, codes)).toMatchObject({ ok: true });
    expect(checkRequirement({ ...REQ, source: { title: "" } }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, reviewStatus: undefined }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, reviewStatus: "reviewed", reviewedOn: null }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, body: "" }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, requiredHours: null, requiredCredits: null }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, eligibleTypes: ["made_up"] }, codes)).toMatchObject({ ok: false });
    expect(checkRequirement({ ...REQ, source: { ...REQ.source, url: "http://insecure.example" } }, codes)).toMatchObject({ ok: true, value: { source: { url: null } } });
  });

  it("an invalid draft is refused whole, with the reason, and nothing is silently dropped", () => {
    expect(checkLcpdDraft({ requirements: [REQ] })).toMatchObject({ ok: true });
    expect(checkLcpdDraft({ requirements: [{ ...REQ, source: {} }] })).toMatchObject({ ok: false });
    expect(checkLcpdDraft({ activityTypes: [{ code: "Bad Code", label: "" }] })).toMatchObject({ ok: false });
  });
});

describe("LCPD-2: only a description and a date are required once 490 is applied", () => {
  it("with 490: no hours, a configured type, decimal credits", () => {
    const types = recordableTypes(DEFAULT_LCPD, true).map(t => t.code);
    expect(parseCpd({ activityType: "mentorship", title: "Mentored a new graduate", activityDate: "2026-10-01" }, TODAY, { types, flexible: true })).toMatchObject({ ok: true, value: { hours: null } });
    expect(parseCpd({ activityType: "course", title: "ECG course", activityDate: "2026-10-01", cpdPoints: "0.5" }, TODAY, { types, flexible: true })).toMatchObject({ ok: true, value: { cpd_points: 0.5 } });
    expect(parseCpd({ activityType: "course", title: "x", activityDate: "2026-10-01" }, TODAY, { types, flexible: true })).toMatchObject({ ok: false });
    expect(parseCpd({ activityType: "course", title: "Future course", activityDate: "2026-12-01" }, TODAY, { types, flexible: true })).toMatchObject({ ok: false });
    expect(parseCpd({ activityType: "not_offered", title: "Something", activityDate: "2026-10-01" }, TODAY, { types, flexible: true })).toMatchObject({ ok: false });
  });

  it("without 490 (fail closed): 373's rule exactly -- hours required, whole points, the nine types", () => {
    const types = recordableTypes(DEFAULT_LCPD, false).map(t => t.code);
    expect(types).not.toContain("mentorship");
    expect(parseCpd({ activityType: "course", title: "ECG course", activityDate: "2026-10-01" }, TODAY, { types, flexible: false })).toMatchObject({ ok: false });
    expect(parseCpd({ activityType: "course", title: "ECG course", activityDate: "2026-10-01", hours: "2", cpdPoints: "0.5" }, TODAY, { types, flexible: false })).toMatchObject({ ok: false });
    expect(parseCpd({ activityType: "course", title: "ECG course", activityDate: "2026-10-01", hours: "2" }, TODAY)).toMatchObject({ ok: true, value: { hours: 2 } });
  });

  it("an entry with no hours is counted as an entry, never as zero hours", () => {
    const [y] = cpdHoursByYear([{ id: "a", goal_id: null, hours: null, activity_date: "2026-03-01", evidence_class: "self_declared" }, { id: "b", goal_id: null, hours: 2, activity_date: "2026-04-01", evidence_class: "self_declared" }]);
    expect(y).toMatchObject({ hours: 2, entries: 2, withoutHours: 1 });
  });
});

describe("LCPD-5: a requirement is counted against, never met, and nothing is verified", () => {
  const req = checkRequirement(REQ, codes);
  if (!req.ok) throw new Error(req.error);
  const cpd = [
    { activity_type: "course", activity_date: "2026-03-01", hours: 4, cpd_points: null },
    { activity_type: "conference", activity_date: "2026-04-01", hours: 6, cpd_points: 2 },
    { activity_type: "mentorship", activity_date: "2026-05-01", hours: null, cpd_points: null },
    { activity_type: "course", activity_date: "2025-12-01", hours: 9, cpd_points: null },        // previous cycle
  ];
  const learning: any[] = [{ completedOn: "2026-06-01", hours: 1.5 }];

  it("recorded, potentially eligible, and verified kept apart", () => {
    const s = summarise(req.value, "2026-01-01", cpd, learning, TODAY);
    expect(s.cycle).toEqual({ start: "2026-01-01", end: "2027-01-01", current: true });
    expect(s.recorded).toEqual({ entries: 4, hours: 11.5, credits: 2, withoutHours: 1 });
    expect(s.eligible).toMatchObject({ entries: 3, hours: 5.5 });                                 // the conference does not count
    expect(s.verified).toBeNull();
    expect(s.verifiedReason).toBe(NOT_VERIFIED);
    expect(s.mandatory).toEqual([{ label: "Infection prevention", minHours: 2, eligibleHours: 5.5 }]);
    expect(JSON.stringify(s)).not.toMatch(/complian|met\b|accepted": true/i);
  });

  it("the cycle rolls forward to the one that contains today", () => {
    expect(summarise(req.value, "2024-01-01", cpd, learning, TODAY).cycle).toMatchObject({ start: "2026-01-01", current: true });
  });

  it("a person follows only a requirement in effect now, from a cycle start not in the future", () => {
    expect(parseSetting({ requirementCode: REQ.code, cycleStart: "2026-01-01" }, [req.value], TODAY)).toMatchObject({ ok: true });
    expect(parseSetting({ requirementCode: REQ.code, cycleStart: "2027-01-01" }, [req.value], TODAY)).toMatchObject({ ok: false });
    expect(parseSetting({ requirementCode: "nope", cycleStart: "2026-01-01" }, [req.value], TODAY)).toMatchObject({ ok: false });
    expect(inEffect({ ...req.value, effectiveTo: "2026-06-30" }, TODAY)).toBe(false);
    expect(parseSetting({ requirementCode: null }, [req.value], TODAY)).toMatchObject({ ok: true, value: { requirementCode: null, cycleStart: null } });
  });
});

describe("export", () => {
  it("is the person's own log as CSV: quoted, safe from spreadsheet formulas, evidence in words, never verified", () => {
    const csv = cpdCsv([{ activity_date: "2026-03-01", created_at: "2026-03-05T10:00:00Z", title: "=HYPERLINK(\"x\")", activity_type: "course", provider: null, hours: null, cpd_points: null, evidence_class: "self_declared" }], c => c.toUpperCase());
    expect(csv.split("\r\n")[1]).toBe(`"2026-03-01","2026-03-05","'=HYPERLINK(""x"")","COURSE","","","","Self-declared"`);
    expect(csv).not.toMatch(/verified/i);
  });
});
