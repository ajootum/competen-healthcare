/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect } from "vitest";
import { parseCpd, parseEvidence, parseGoal, parseNeed, parseProfile, isoDate, documentPath } from "./validate";
import { cpdHoursByYear, evidenceCoverage, planProgress } from "./progress";
import { ownRecordsFrom, summariseOwn, loadOwnRecords } from "./passport-records";
import { loadProfessionalRecord } from "./record";
import { reminderMessage } from "./reminders";
import { parseShare } from "./share";
import { documentProblem } from "./documents";
import { professionalContext, cleanActivity, taskInstruction } from "./assistant";
import type { ProfessionalRecord } from "./record";
import { EXPERIENCES, FOUNDATION_NAV, bottomNavFor, navFor } from "../experiences";

const TODAY = "2026-10-22";

describe("validation mirrors migration 373", () => {
  it("accepts real dates only", () => {
    expect(isoDate("2026-02-28")).toBe("2026-02-28");
    expect(isoDate("2026-02-30")).toBeUndefined();
    expect(isoDate("")).toBeNull();
  });

  it("never reads a class, a verified flag or an owner from the body", () => {
    const r = parseEvidence({ kind: "credential", title: "BLS card", evidence_class: "independently_verified", verified: true, user_id: "x" }, TODAY);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value)).not.toEqual(expect.arrayContaining(["evidence_class", "verified", "user_id"]));
  });

  it("refuses CPD in the future and hours out of range", () => {
    expect(parseCpd({ activityType: "course", title: "ALS", hours: 8, activityDate: "2026-10-23" }, TODAY).ok).toBe(false);
    expect(parseCpd({ activityType: "course", title: "ALS", hours: 0, activityDate: TODAY }, TODAY).ok).toBe(false);
    const ok = parseCpd({ activityType: "course", title: "ALS", hours: "7.25", activityDate: TODAY, cpdPoints: "" }, TODAY);
    expect(ok.ok && ok.value.hours).toBe(7.3);
    expect(ok.ok && ok.value.cpd_points).toBeNull();
  });

  it("keeps expiry to credentials, and after the issue date", () => {
    expect(parseEvidence({ kind: "competency", title: "Cannulation", expiresOn: "2027-01-01" }, TODAY).ok).toBe(false);
    expect(parseEvidence({ kind: "credential", title: "Licence", issuedOn: "2026-01-01", expiresOn: "2025-01-01" }, TODAY).ok).toBe(false);
  });

  it("needs a target date on every goal, and a framework for a competency", () => {
    expect(parseGoal({ title: "ALS course" }).ok).toBe(false);
    expect(parseNeed({ title: "Resus", frameworkCompetencyId: "6f1c3c8e-6b7a-4c1e-9f55-2d3b8a1e0c11" }).ok).toBe(false);
  });

  it("stores the profile under self_declared_* names only", () => {
    const r = parseProfile({ profession: "Nurse", registrationNumber: " 123 " });
    expect(r.ok && Object.keys(r.value).every(k => k.startsWith("self_declared_"))).toBe(true);
    expect(r.ok && r.value.self_declared_registration_number).toBe("123");
  });

  it("prefixes every document path with its owner", () => {
    expect(documentPath("u1", "my cert?.pdf", "r").path).toBe("u1/r-my cert_.pdf");
    expect(documentProblem({ type: "text/html", size: 10 })).not.toBeNull();
    expect(documentProblem({ type: "application/pdf", size: 11 * 1024 * 1024 })).not.toBeNull();
    // Vercel caps a route handler body at ~4.5 MB, so the app refuses above 4 MB (the bucket allows 10).
    expect(documentProblem({ type: "application/pdf", size: 5 * 1024 * 1024 })).not.toBeNull();
    expect(documentProblem({ type: "application/pdf", size: 4 * 1024 * 1024 })).toBeNull();
  });

  it("clamps a share request the way the estate route does", () => {
    expect(parseShare({ scope: "everything", days: 9999 })).toEqual({ scope: "summary", label: null, days: 365 });
  });
});

describe("progress invents nothing", () => {
  it("is not measured with no goals, and does not count dropped ones", () => {
    expect(planProgress([], TODAY).completion).toBeNull();
    const p = planProgress([
      { id: "a", need_id: null, status: "done", target_date: "2026-01-01" },
      { id: "b", need_id: null, status: "dropped", target_date: "2026-01-01" },
      { id: "c", need_id: null, status: "planned", target_date: "2026-01-01" },
    ], TODAY);
    expect(p.completion).toBe(0.5);
    expect(p.overdue).toBe(1);
  });

  it("sums hours by year with no target", () => {
    const y = cpdHoursByYear([
      { id: "1", goal_id: null, hours: 1.5, activity_date: "2026-03-01", evidence_class: "self_declared" },
      { id: "2", goal_id: null, hours: "2.5", activity_date: "2026-04-01", evidence_class: "source_linked" },
      { id: "3", goal_id: null, hours: 3, activity_date: "2025-04-01", evidence_class: "self_declared" },
    ]);
    expect(y).toEqual([{ year: 2026, hours: 4, entries: 2, withDocument: 1 }, { year: 2025, hours: 3, entries: 1, withDocument: 0 }]);
  });

  it("counts CPD toward a need through its goal, and leaves set-aside needs out of the ratio", () => {
    const c = evidenceCoverage(
      [{ id: "n1", title: "Resus", status: "open" }, { id: "n2", title: "Wounds", status: "open" }, { id: "n3", title: "Old", status: "closed" }],
      [{ id: "g1", need_id: "n1", status: "planned", target_date: TODAY }],
      [{ id: "c1", goal_id: "g1", hours: 2, activity_date: TODAY, evidence_class: "source_linked" }],
      [{ id: "e1", need_id: "n3", evidence_class: "self_declared" }],
    );
    expect(c.counted).toBe(2);
    expect(c.covered).toBe(1);
    expect(c.ratio).toBe(0.5);
    expect(c.byClass).toEqual({ self_declared: 1, source_linked: 1 });
    expect(evidenceCoverage([], [], [], []).ratio).toBeNull();
  });
});

const RECORD: ProfessionalRecord = {
  provisioned: true,
  profile: { self_declared_profession: "Midwife", self_declared_registration_body: "UNMC", self_declared_registration_number: "M-1", self_declared_registration_country: "Uganda", self_declared_registration_expires_on: "2027-01-01", updated_at: null },
  needs: [{ id: "n1", title: "Neonatal resus", detail: null, origin: "self_identified", status: "open", framework_id: null, framework_competency_id: null, created_at: "", closed_at: null }],
  goals: [{ id: "g1", need_id: "n1", title: "NLS course", detail: null, target_date: "2027-03-01", status: "planned", completed_at: null, created_at: "" }],
  cpd: [{ id: "c1", goal_id: "g1", activity_type: "course", title: "NLS", provider: null, hours: 7.5, cpd_points: null, activity_date: "2026-09-01", reflection: "Secret reflection", document_name: "c.pdf", evidence_class: "source_linked", created_at: "" }],
  evidence: [],
};

describe("the Passport and the AI see the same own record", () => {
  it("labels every own item by provenance and never carries the reflection", () => {
    const items = ownRecordsFrom(RECORD)!;
    expect(items.map(i => i.evidence)).toEqual(["self_declared", "source_linked"]);
    expect(JSON.stringify(items)).not.toContain("Secret reflection");
    expect(summariseOwn(items).byKind).toEqual({ registration: 1, credential: 0, competency_evidence: 0, cpd: 1 });
  });

  // IND-003 follow-up 4: before migration 373 the tables do not exist, so nobody can hold a record -- [] (the
  // access.ts isNotProvisioned rule), never null, which would show every Passport an Unreadable warning.
  const errClient = (error: { code: string; message: string }) => ({
    from: () => { const b: any = new Proxy({}, { get: (_t, k) => k === "then" ? (r: any) => r({ data: null, error }) : () => b }); return b; },
  });
  it("reads an environment without migration 373 as no records, not as unreadable", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      const rec = await loadProfessionalRecord(errClient({ code, message: "relation does not exist" }), "u");
      expect(rec.provisioned).toBe(false);
      expect(await loadOwnRecords(errClient({ code, message: "x" }), "u")).toEqual([]);
    }
  });
  it("keeps any other read failure as unreadable (null)", async () => {
    expect(await loadOwnRecords(errClient({ code: "57014", message: "statement timeout" }), "u")).toBeNull();
  });

  it("returns null, not [], when a section could not be read", () => {
    expect(ownRecordsFrom({ ...RECORD, cpd: null })).toBeNull();
  });

  it("grounds the AI on the record, says self-declared, and invents no target", () => {
    const ctx = professionalContext(RECORD, TODAY);
    expect(ctx).toContain("self-declared, not checked");
    expect(ctx).toContain("2026: 7.5 hours in 1 entries");
    expect(ctx).toContain("No target is set");
    expect(ctx).not.toContain("Secret reflection");
    expect(taskInstruction("cpd_plan")).toContain("Do not state any required number of CPD hours");
    expect(cleanActivity({ title: "x" })).toBeNull();
  });

  it("puts nothing about the credential in a reminder's subject line", () => {
    const m = reminderMessage({ table: "individual_professional_evidence", id: "e", userId: "u", expiresOn: "2026-11-01", title: "Licence ABC", prior: null }, TODAY);
    expect(m.title).not.toContain("Licence ABC");
    expect(m.body).toContain("Competen has not checked this");
  });
});

describe("the registry composes each experience's navigation", () => {
  it("puts Professional's modules after Home and before the foundation, and leaves Scholar's unchanged", () => {
    expect(navFor("professional").map(n => n.segment)).toEqual(["", "registration", "development", "cpd", "evidence", "progress", "assistant", "passport", "profile", "settings"]);
    // Each experience shows its own modules and never the other's (Scholar has `study` since IND-004).
    const pro = EXPERIENCES.professional.modules.map(m => m.segment);
    const sch = EXPERIENCES.scholar.modules.map(m => m.segment);
    expect(navFor("scholar").map(n => n.segment).filter(s => pro.includes(s))).toEqual([]);
    expect(navFor("professional").map(n => n.segment).filter(s => sch.includes(s))).toEqual([]);
    expect(navFor("scholar").map(n => n.key).filter(k => FOUNDATION_NAV.some(f => f.module === k))).toEqual(FOUNDATION_NAV.map(n => n.module));
    expect(navFor("professional").some(n => n.segment === "share")).toBe(false);
  });

  it("keeps the bottom bar to five destinations, without Settings", () => {
    for (const k of ["scholar", "professional"] as const) {
      const b = bottomNavFor(k);
      expect(b.length).toBeLessThanOrEqual(5);
      expect(b[0].key).toBe("home");
      expect(b.some(i => i.key === "settings")).toBe(false);
    }
    expect(bottomNavFor("professional").map(i => i.segment)).toEqual(["", "development", "cpd", "assistant", "passport"]);
    expect(EXPERIENCES.professional.planned.some(p => p.key === "credentials" || p.key === "development-cpd")).toBe(false);
  });
});
