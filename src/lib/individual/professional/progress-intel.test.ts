/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_POLICY } from "../policy";
import { buckets, careerJourney, competencyProgress, learningProgress, nextSteps, overview, stepKey, timeline, type Extra } from "./progress-intel";
import type { EvaluationInput } from "./evaluation";

// COMPETEN-PROFESSIONAL-PROGRESS-01 PR1-PR6: next steps from findings, history kept as it happened, periods only group,
// five competency columns never combined, volume never called competence, first steps for a new professional.

const P = DEFAULT_POLICY.professionalProgress;
const TODAY = "2026-10-26";
const hrefs = { cpd: "/cpd", development: "/dev", goal: (id: string) => `/dev?goal=${id}`, need: (id: string) => `/dev?need=${id}`, competencies: "/c", competency: (id: string) => `/c?c=${id}`,
  learning: () => "/learn", learningRecord: (id: string) => `/rec/${id}`, verification: "/c" };
const empty = (): EvaluationInput => ({ today: TODAY, needs: [], goals: [], cpd: [], evidence: [], activities: [], activityGoals: [], milestones: [], planCompetencies: [], goalEvidence: [], reviews: [],
  needCompetencies: [], goalNeeds: [], reflections: [], learning: { enabled: true, refs: [] }, learningReflections: { available: true, bySubject: new Map() }, mappings: [], passport: [],
  stage5: { available: true, entries: [], assessments: [], links: [] }, verification: { available: true, decisions: [] }, names: new Map(), versions: new Map(), hrefs });
const noExtra = (): Extra => ({ items: [], context: [], evaluations: [], catalogue: [], requirement: null, decisions: [] });
const cpd = (id: string, title: string, date: string, extra: any = {}) => ({ id, goal_id: null, activity_type: "course", title, provider: null, hours: 2, cpd_points: null, activity_date: date, reflection: null, document_name: null, evidence_class: "self_declared", created_at: `${date}T10:00:00Z`, ...extra });
const steps = (i: EvaluationInput, x: Extra = noExtra()) => nextSteps(i, x, P, { profile: "/profile", competencies: "/c", learning: "/learn" }, 90);

describe("PR1/PR5: next steps", () => {
  it("a newly registered professional gets useful first steps, not warnings", () => {
    const s = steps(empty());
    expect(s.map(x => x.rule)).toEqual(["first_steps", "first_steps", "first_steps"]);
    expect(overview(empty(), [], P).newProfessional).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/overdue|behind|fail|incompeten/i);
  });

  it("every step names its finding and opens its owning module; a reflection is suggested for completed training", () => {
    const i = empty(); i.cpd = [cpd("c1", "ECG workshop", "2026-10-01")];
    const s = steps(i);
    const r = s.find(x => x.rule === "reflect_on_training")!;
    expect(r.finding).toMatch(/Recorded 2026-10-01, with no reflection yet/);
    expect(r.href).toBe("/cpd");
    expect(s.every(x => x.href && x.finding)).toBe(true);
  });

  it("review a goal after related learning; an expiring credential; dismissed and deferred steps are hidden", () => {
    const i = empty();
    i.goals = [{ id: "g1", need_id: null, title: "ECG", detail: null, target_date: null, status: "in_progress", completed_at: null, created_at: "2026-09-01T00:00:00Z" }];
    i.cpd = [cpd("c1", "ECG workshop", "2026-10-02", { goal_id: "g1", reflection: "x" })];
    const x = noExtra();
    x.items = [{ id: "r1", section: "registration", title: "Licence", type_code: null, type_label: null, organisation: null, jurisdiction: null, self_declared_identifier: null, started_on: null, ended_on: null,
      expires_on: "2026-12-01", target_on: null, detail: null, document_name: null, evidence_class: "self_declared", supersedes_id: null, superseded_at: null, withdrawn_at: null, withdrawn_reason: null, created_at: "2025-01-01T00:00:00Z" }];
    const s = steps(i, x);
    expect(s.map(z => z.rule)).toEqual(expect.arrayContaining(["review_goal_after_learning", "credential_expiry"]));
    x.decisions = [{ recommendation_key: stepKey("credential_expiry", "r1"), decision: "dismissed", deferred_until: null, decided_at: "2026-10-20T00:00:00Z" },
      { recommendation_key: stepKey("review_goal_after_learning", "g1"), decision: "deferred", deferred_until: "2026-11-30", decided_at: "2026-10-20T00:00:00Z" }];
    expect(steps(i, x).map(z => z.rule)).not.toEqual(expect.arrayContaining(["credential_expiry"]));
    expect(steps(i, x).some(z => z.rule === "review_goal_after_learning")).toBe(false);
  });

  it("no rule creates, purchases or requests anything: the module has no write and no request call", () => {
    const src = readFileSync("src/lib/individual/professional/progress-intel.ts", "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.insert\(|\.update\(|\.delete\(|requestVerification|createGoal|createNeed|checkout|purchase\(/);
  });
});

describe("PR2: history as it happened", () => {
  it("occurrence and recording dates are both kept, and repeated practice is marked, never merged", () => {
    const i = empty();
    i.cpd = [cpd("c1", "ECG workshop", "2025-03-01"), cpd("c2", "ECG Workshop", "2026-03-01", { created_at: "2026-04-10T00:00:00Z" })];
    const ev = timeline(i, noExtra(), P);
    const later = ev.find(e => e.key === "cpd:c2")!;
    expect(later.repeat).toBe(true);
    expect(later.occurredOn).toBe("2026-03-01");
    expect(later.recordedOn).toBe("2026-04-10");
    expect(ev.find(e => e.key === "cpd:c1")!.repeat).toBe(false);
    expect(ev).toHaveLength(2);
  });

  it("changing the period only groups: the same events, the same dates", () => {
    const i = empty();
    i.cpd = [cpd("c1", "A", "2025-01-15"), cpd("c2", "B", "2025-06-15"), cpd("c3", "C", "2026-02-15")];
    const ev = timeline(i, noExtra(), P);
    for (const k of ["week", "month", "quarter", "year", "phase"] as const) {
      const b = buckets(ev, k, []);
      expect(b.flatMap(x => x.events).map(e => `${e.key}@${e.occurredOn}`).sort()).toEqual(ev.map(e => `${e.key}@${e.occurredOn}`).sort());
    }
    expect(buckets(ev, "year", []).map(b => b.label)).toEqual(["2026", "2025"]);
  });

  it("professional phases are the person's own recorded context periods", () => {
    const i = empty(); i.cpd = [cpd("c1", "A", "2024-05-01"), cpd("c2", "B", "2026-05-01")];
    const ctxs = [
      { self_declared_profession: "Nurse", self_declared_practice_jurisdiction: null, self_declared_professional_status: null, self_declared_primary_specialty: null, self_declared_professional_title: null, self_declared_practice_setting: null, self_declared_current_role: "Staff nurse", self_declared_years_experience: null, self_declared_registration_body: null, self_declared_registration_country: null, effective_from: "2023-01-01T00:00:00Z", effective_to: "2025-12-31T00:00:00Z" },
      { self_declared_profession: "Nurse", self_declared_practice_jurisdiction: null, self_declared_professional_status: null, self_declared_primary_specialty: "Critical care", self_declared_professional_title: null, self_declared_practice_setting: null, self_declared_current_role: "Charge nurse", self_declared_years_experience: null, self_declared_registration_body: null, self_declared_registration_country: null, effective_from: "2026-01-01T00:00:00Z", effective_to: null },
    ];
    const b = buckets(timeline(i, noExtra(), P), "phase", ctxs as any);
    expect(b.map(x => x.label)).toEqual(["Nurse, Charge nurse, Critical care", "Nurse, Staff nurse"]);
    const j = careerJourney(i, { ...noExtra(), context: ctxs as any }, P);
    expect(j.transitions.map(t => t.change)).toEqual(expect.arrayContaining(["role: Staff nurse to Charge nurse", "specialty: not recorded to Critical care"]));
  });
});

describe("PR3/PR4: competency and learning progress", () => {
  it("five columns kept apart, a version difference stated, nothing recorded is not a gap", () => {
    const i = empty();
    i.stage5 = { available: true, entries: [{ id: "e1", kind: "catalogue", framework_competency_id: "fc1", framework_version: "v2", title: "ECG", removed_at: null, interest: false }],
      assessments: [{ id: "a1", my_competency_id: "e1", learning_outcome: null, framework_version: "v1", scale_label: null, level_label: "Competent", confidence_label: null, development_interest: false, assessed_at: "2026-01-01T00:00:00Z" },
        { id: "a2", my_competency_id: "e1", learning_outcome: null, framework_version: "v2", scale_label: null, level_label: "Proficient", confidence_label: null, development_interest: false, assessed_at: "2026-09-01T00:00:00Z" }], links: [] };
    const c = competencyProgress(i, noExtra());
    const r = c.tree[0].rows[0];
    expect(r.selfAssessed).toMatch(/^Proficient \(self-reported/);
    expect(r.independent).toBeNull();
    expect(r.limitations.join(" ")).toMatch(/v1 and v2: not directly comparable|v2 and v1: not directly comparable/);
    expect(JSON.stringify(c)).not.toMatch(/"score"|average|percent/i);
    const none = competencyProgress({ ...empty(), stage5: { available: true, entries: [{ id: "e2", kind: "personal", framework_competency_id: null, framework_version: null, title: "Leading huddles", removed_at: null, interest: false }], assessments: [], links: [] } }, noExtra());
    expect(none.personal[0].limitations[0]).toMatch(/not evidence of a gap/);
  });

  it("learning volume is activity, and a CPD requirement is only ever 'recorded'", () => {
    const i = empty(); i.cpd = [cpd("c1", "A", "2026-01-01"), cpd("c2", "B", "2026-02-01")];
    const p = learningProgress(i, { ...noExtra(), requirement: { label: "Req", text: "Recorded in the cycle ..." } });
    expect(p.participation.state).toBe("measured");
    expect(p.hours).toBe(4);
    expect(JSON.stringify(p)).not.toMatch(/complian|met\b|accepted/i);
    expect(learningProgress(empty(), noExtra()).participation.state).toBe("not_measured");
  });
});
