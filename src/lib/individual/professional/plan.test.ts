import { describe, expect, it } from "vitest";
import { resolvePolicy } from "../policy";
import {
  aiPlanQuestion, checkGoalStatusChange, matchCompetencies, milestoneIdeas, parseActivityForm, parseAiPlanLines, parseGoalForm, parseGoalSource,
  parseMilestone, parseReview, planReminders, templatePrompts,
} from "./plan-form";

// COMPETEN-PROFESSIONAL-PLAN-01 (Stage 3): the pure planning rules.

const policy = resolvePolicy([]).professionalPlan;

describe("goal form (P1)", () => {
  it("saves with only a description", () => {
    const r = parseGoalForm({ title: "ECG interpretation" }, policy);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ title: "ECG interpretation", target_date: null, template_code: null, goal_type_code: null });
  });
  it("refuses a missing description and a target before the start", () => {
    expect(parseGoalForm({}, policy).ok).toBe(false);
    expect(parseGoalForm({ title: "ECG", startDate: "2027-02-01", targetDate: "2027-01-01" }, policy).ok).toBe(false);
  });
  it("copies the option label, and refuses an option that is not offered", () => {
    const r = parseGoalForm({ title: "ECG interpretation", type: "skill", priority: "high" }, policy);
    expect(r.ok && r.value.goal_type_label).toBe("Develop a skill");
    expect(parseGoalForm({ title: "ECG interpretation", priority: "urgent" }, policy).ok).toBe(false);
  });
  it("keeps template answers by prompt, and SMART is never required", () => {
    expect(templatePrompts("SMART: Specific | Measurable | Achievable | Relevant | Time-bound").prompts).toHaveLength(5);
    const r = parseGoalForm({ title: "ECG interpretation", template: "smart", answer0: "Read rhythm strips", answer4: "By June" }, policy);
    expect(r.ok && r.value.template_answers).toEqual({ Specific: "Read rhythm strips", "Time-bound": "By June" });
    expect(r.ok && r.value.template_label).toBe("SMART");
    expect(policy.fields.includes("template") && parseGoalForm({ title: "No template" }, policy).ok).toBe(true);
  });
  it("on a revision, touches only the fields sent", () => {
    const r = parseGoalForm({ outcome: "Recognise common arrhythmias" }, policy, true);
    expect(r.ok && Object.keys(r.value)).toEqual(["intended_outcome"]);
  });
});

describe("where a goal came from", () => {
  const n = "11111111-1111-4111-8111-111111111111";
  it("derives the source from the id given, and refuses a source without its id", () => {
    expect(parseGoalSource({}).ok && (parseGoalSource({}) as { value: { createdFrom: string } }).value.createdFrom).toBe("direct");
    const r = parseGoalSource({ needId: n });
    expect(r.ok && r.value).toMatchObject({ createdFrom: "need", needId: n });
    expect(parseGoalSource({ createdFrom: "reflection" }).ok).toBe(false);
    expect(parseGoalSource({ createdFrom: "employer" }).ok).toBe(false);
    expect(parseGoalSource({ needId: "not-an-id" }).ok).toBe(false);
  });
});

describe("statuses, reopening and review (P6)", () => {
  it("any offered status follows any other; reopening follows the rule", () => {
    expect(checkGoalStatusChange("planned", "deferred", policy).ok).toBe(true);
    expect(checkGoalStatusChange("done", "in_progress", policy).ok).toBe(true);
    expect(checkGoalStatusChange("done", "in_progress", { ...policy, reopen: "off" }).ok).toBe(false);
    expect(checkGoalStatusChange("planned", "verified", policy).ok).toBe(false);
  });
  it("addressed makes the goal done and nothing more; reopened opens it", () => {
    const a = parseReview({ decision: "addressed", learned: "Rate and rhythm first" }, "in_progress", policy);
    expect(a.ok && a.value).toMatchObject({ status: "done", columns: { learned: "Rate and rhythm first" } });
    const o = parseReview({ decision: "reopened" }, "done", policy);
    expect(o.ok && o.value.status).toBe("in_progress");
    expect(parseReview({ decision: "reopened" }, "planned", policy).ok).toBe(false);
    expect(parseReview({ decision: "certified" }, "planned", policy).ok).toBe(false);
  });
  it("reprioritise needs an offered priority; continue changes no status", () => {
    expect(parseReview({ decision: "reprioritise" }, "planned", policy).ok).toBe(false);
    const r = parseReview({ decision: "reprioritise", priority: "low" }, "planned", policy);
    expect(r.ok && r.value.priority).toEqual(["low", "Low"]);
    const c = parseReview({ decision: "continue" }, "in_progress", policy);
    expect(c.ok && c.value.status).toBeNull();
  });
});

describe("activities (P2) and the Stage 3/4 contract", () => {
  it("never accepts completed by hand", () => {
    const r = parseActivityForm({ title: "Read an ECG book", status: "completed" }, policy);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/CPD|learning record/);
  });
  it("takes no hours, credits or evidence, and only http links", () => {
    const r = parseActivityForm({ title: "ECG course", type: "external-course", hours: 3, cpd_points: 2, evidence_class: "verified", url: "https://example.org/ecg" }, policy);
    expect(r.ok).toBe(true);
    if (r.ok) for (const k of ["hours", "cpd_points", "evidence_class", "actual_start", "actual_end"]) expect(k in r.value).toBe(false);
    expect(parseActivityForm({ title: "Bad link", url: "javascript:alert(1)" }, policy).ok).toBe(false);
  });
  it("offers every activity kind the GO names, with no profession or country", () => {
    const codes = policy.activityTypes.map(t => t.code);
    for (const c of ["competen-course", "partner-course", "external-course", "workshop", "independent-study", "mentorship", "workplace-learning", "teaching", "research", "quality-improvement", "reflective-practice", "other"])
      expect(codes).toContain(c);
    expect(JSON.stringify(policy)).not.toMatch(/nurs|uganda|midwi/i);
  });
});

describe("milestones, reminders and suggestions (P4)", () => {
  it("a milestone needs only a title", () => {
    expect(parseMilestone({ title: "Read 50 strips" }, policy).ok).toBe(true);
    expect(parseMilestone({ title: "x" }, policy).ok).toBe(false);
  });
  it("ideas come only from the person's own dates", () => {
    expect(milestoneIdeas({ start_date: null, target_date: "2027-01-01" })).toEqual([]);
    expect(milestoneIdeas({ start_date: "2026-11-01", target_date: "2027-01-01" }).map(i => i.type)).toEqual(["checkpoint", "evidence-gathered"]);
  });
  it("reminds about open goals only, in date order", () => {
    const goals = [
      { id: "a", title: "ECG", status: "in_progress", target_date: "2026-11-01", review_date: "2026-10-30", reviewed_at: null, updated_at: "2026-10-25T00:00:00Z" },
      { id: "b", title: "Done one", status: "done", target_date: "2026-10-26", review_date: null, reviewed_at: null, updated_at: "2026-01-01T00:00:00Z" },
    ];
    const r = planReminders({ goals, milestones: [{ goal_id: "a", title: "Halfway", due_on: "2026-10-28", achieved_on: null }], today: "2026-10-25", leadDays: 14, reviewDays: 90 });
    expect(r.map(x => x.kind)).toEqual(["milestone", "review", "target"]);
    expect(r.every(x => x.goalId === "a")).toBe(true);
  });
  it("competency matches are deterministic word overlaps", () => {
    const offered = [{ competencyId: "1", title: "ECG interpretation" }, { competencyId: "2", title: "Wound care" }];
    expect(matchCompetencies("Interpret 12-lead ECGs: interpretation of rhythm", offered).map(c => c.competencyId)).toEqual(["1"]);
    expect(matchCompetencies("", offered)).toEqual([]);
  });
});

describe("AI help: asked for, parsed, never trusted blindly", () => {
  it("asks about the goal only, and forbids invention and deficiency", () => {
    const q = aiPlanQuestion("activities", { title: "ECG interpretation", intended_outcome: null });
    expect(q).toMatch(/ECG interpretation/);
    expect(q).toMatch(/Do not invent/);
    expect(q.length).toBeLessThan(650);
  });
  it("keeps at most three lines in the expected shape", () => {
    expect(parseAiPlanLines("- A :: x\nnoise\n- Read strips daily :: practice\n- Shadow a colleague :: workplace\n- Fourth :: no")).toHaveLength(3);
    expect(parseAiPlanLines("Just some prose.")).toEqual([]);
  });
});
