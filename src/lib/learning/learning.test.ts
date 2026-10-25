/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import {
  blueprintProblems, cpdHours, evaluateCompletion, externalTemplate, hostedTemplate, learnerView, normaliseBlueprint, outcomeRows, resumePoint, scoreCheck, type Blueprint,
} from "./blueprint";
import { DEFAULT_LEARNING_POLICY, LEARNING_TERMS, resolveLearningPolicy } from "./policy";
import { mediaPath, validatePrice, versionState } from "./studio";
import { CERTIFICATE_DISCLAIMER, certificateIds, evidenceProblem } from "./record";
import { coursePeriod, isLearningTxRef } from "./commerce";
import { learningCpdLines, learningForCompetencies, learningPassportItems, type LearningReference } from "./products";

// COMPETEN-LEARNING-01: the pure rules of the learning blueprint, completion, prices and references. The database
// rules (460-464) are proven by the planted-failure SQL suite; these are the server's own decisions.

const COMP = "11111111-1111-4111-8111-111111111111";
const policy = { formats: DEFAULT_LEARNING_POLICY.formats, levels: DEFAULT_LEARNING_POLICY.levels };

function ecg(): Blueprint {
  const b = hostedTemplate("ECG Interpretation");
  b.summary = "Read a 12-lead ECG systematically and recognise the rhythms that need escalation.";
  b.objectives = [{ id: "obj-1", text: "Identify sinus rhythm", outcomeRefs: [{ competencyId: COMP, index: 0, relation: "develops" }] }];
  b.modules[0].activities = [
    { id: "l1", kind: "lesson", title: "The 12-lead ECG", minutes: 30, blocks: [{ type: "text", text: "A 12-lead ECG records the heart's electrical activity from twelve views." }] },
    { id: "q1", kind: "check", title: "Check", passMark: 50, questions: [
      { id: "a1", prompt: "Normal PR interval?", options: [{ id: "a", text: "0.12-0.20 s" }, { id: "b", text: "0.40 s" }], correct: ["a"], rationale: "Normal PR is 120-200 ms." },
      { id: "a2", prompt: "Which leads are lateral?", options: [{ id: "a", text: "I, aVL, V5, V6" }, { id: "b", text: "II, III, aVF" }], correct: ["a"], rationale: "II, III and aVF are inferior." },
    ] },
  ];
  b.completion = { requiredActivityIds: ["l1", "q1"], assessedCheckIds: ["q1"] };
  return b;
}

describe("the learning blueprint", () => {
  it("a complete hosted course has no problems, and the template has some (control)", () => {
    expect(blueprintProblems(ecg(), "hosted", policy)).toEqual([]);
    expect(blueprintProblems(hostedTemplate("x"), "hosted", policy).length).toBeGreaterThan(3);
  });
  it("names an unmapped course, an unknown level and a missing key", () => {
    const b = ecg(); b.objectives[0].outcomeRefs = []; b.level = "expert";
    (b.modules[0].activities[1] as any).questions[0].correct = ["z"];
    const p = blueprintProblems(b, "hosted", policy).join(" | ");
    expect(p).toMatch(/CFCA competency/); expect(p).toMatch(/Learning policy lists/); expect(p).toMatch(/mark the correct option/);
  });
  it("an external listing needs an https link, a return note and a review date, and no CFCA mapping is required", () => {
    const e = externalTemplate("ACLS");
    e.summary = "An externally provided course in advanced cardiac life support."; e.objectives = [{ id: "obj-1", text: "Lead a resuscitation", outcomeRefs: [] }];
    expect(blueprintProblems(e, "external", policy).join(" ")).toMatch(/https.*\n?|secure/);
    e.external = { ...e.external!, url: "https://provider.example/acls", providerNote: "Complete it there, then come back to record it.", reviewDueOn: "2027-04-01" };
    expect(blueprintProblems(e, "external", policy)).toEqual([]);
    e.external.url = "http://provider.example/acls";
    expect(blueprintProblems(e, "external", policy).join(" ")).toMatch(/secure \(https\)/);
  });
  it("an AI draft cannot go forward until an educator records the check", () => {
    const b = ecg(); b.provenance.kind = "ai_draft";
    expect(blueprintProblems(b, "hosted", policy).join(" ")).toMatch(/AI draft/);
  });
  it("normalising drops unknown keys and an unknown relation becomes develops, never verification", () => {
    const n = normaliseBlueprint({ ...ecg(), evil: 1, objectives: [{ id: "obj-1", text: "x", outcomeRefs: [{ competencyId: COMP, index: 0, relation: "verifies_competence" }] }] }, "hosted") as any;
    expect(n.evil).toBeUndefined();
    expect(n.objectives[0].outcomeRefs[0].relation).toBe("develops");
    expect(normaliseBlueprint(ecg(), "external").modules).toEqual([]);
  });
  it("outcome rows are one per objective, competency, outcome and relation", () => {
    const b = ecg(); b.objectives[0].outcomeRefs.push({ competencyId: COMP, index: 0, relation: "develops" }, { competencyId: COMP, index: -1, relation: "assesses" });
    expect(outcomeRows(b)).toEqual([
      { competency_id: COMP, outcome_index: 0, relation: "develops", objective_key: "obj-1" },
      { competency_id: COMP, outcome_index: -1, relation: "assesses", objective_key: "obj-1" },
    ]);
  });
});

describe("delivery", () => {
  it("the learner view carries no key and no rationale, and the stored version still does (control)", () => {
    const v = learnerView(ecg());
    const q = (v.modules[0].activities[1] as any).questions[0];
    expect(q.correct).toEqual([]); expect(q.rationale).toBe("");
    expect(JSON.stringify(v)).not.toMatch(/120-200 ms/);
    expect(JSON.stringify(ecg())).toMatch(/120-200 ms/);
  });
  it("scores each question all-or-nothing against the stored key, and the pass mark decides", () => {
    const q = ecg().modules[0].activities[1] as any;
    expect(scoreCheck(q, { a1: ["a"], a2: ["a"] })).toMatchObject({ score: 2, max: 2, passed: true });
    expect(scoreCheck(q, { a1: ["a"], a2: ["b"] })).toMatchObject({ score: 1, passed: true });
    expect(scoreCheck(q, { a1: ["a", "b"], a2: ["b"] })).toMatchObject({ score: 0, passed: false });
    expect(scoreCheck(q, {})).toMatchObject({ score: 0, passed: false });
  });
  it("completion: lessons alone are not enough, a failed check is not done, a passed assessed check is assessed knowledge", () => {
    const b = ecg();
    expect(evaluateCompletion(b, [{ activity_key: "l1", kind: "lesson", passed: null }])).toMatchObject({ complete: false, kind: null, satisfied: 1, required: 2 });
    expect(evaluateCompletion(b, [{ activity_key: "l1", kind: "lesson", passed: null }, { activity_key: "q1", kind: "check", passed: false }]).complete).toBe(false);
    expect(evaluateCompletion(b, [{ activity_key: "l1", kind: "lesson", passed: null }, { activity_key: "q1", kind: "check", passed: true }])).toMatchObject({ complete: true, kind: "assessed_knowledge" });
    b.completion.assessedCheckIds = [];
    expect(evaluateCompletion(b, [{ activity_key: "l1", kind: "lesson", passed: null }, { activity_key: "q1", kind: "check", passed: true }]).kind).toBe("course_completion");
    b.completion.requiredActivityIds = [];
    expect(evaluateCompletion(b, []).complete).toBe(false);
  });
  it("resume is the first activity not done, a failed check counting as not done", () => {
    const b = ecg();
    expect(resumePoint(b, [])).toBe("l1");
    expect(resumePoint(b, [{ activity_key: "l1", kind: "lesson", passed: null }, { activity_key: "q1", kind: "check", passed: false }])).toBe("q1");
    expect(resumePoint(b, [{ activity_key: "l1", kind: "lesson", passed: null }, { activity_key: "q1", kind: "check", passed: true }])).toBeNull();
  });
  it("CPD hours are the course's own figure, else its lesson time, never invented", () => {
    const b = ecg(); expect(cpdHours(b)).toBe(0.5);
    b.cpd.hours = 2; expect(cpdHours(b)).toBe(2);
    expect(cpdHours({ ...externalTemplate("x"), cpd: { hours: null, points: null, note: "" } })).toBeNull();
  });
});

describe("prices, media, review state", () => {
  it("validates a UGX price in whole units and refuses an unsupported currency or a sub-unit amount", () => {
    expect(validatePrice({ currency: "ugx", amountMajor: 25000, accessDays: 365 })).toEqual({ ok: true, currency: "UGX", amountMinor: 25000, accessDays: 365 });
    expect(validatePrice({ currency: "UGX", amountMajor: 25000, accessDays: "" })).toMatchObject({ ok: true, accessDays: null });
    expect(validatePrice({ currency: "XXX", amountMajor: 1, accessDays: null }).ok).toBe(false);
    expect(validatePrice({ currency: "UGX", amountMajor: 0, accessDays: null }).ok).toBe(false);
    expect(validatePrice({ currency: "UGX", amountMajor: 25000.5, accessDays: null }).ok).toBe(false);
    expect(validatePrice({ currency: "UGX", amountMajor: 1, accessDays: 4000 }).ok).toBe(false);
  });
  it("a media path is the draft id then a random, safe name, matching what a lesson block accepts", () => {
    const p = mediaPath("AAAAAAAA-1111-4111-8111-111111111111", "ECG strip (1).png", "abcdef0123456789");
    expect(p).toBe("aaaaaaaa-1111-4111-8111-111111111111/abcdef012345-ECG-strip-1-.png");
    expect(/^[a-z0-9-]{8,}\/[A-Za-z0-9._-]{1,200}$/.test(p)).toBe(true);
  });
  it("a listing is never shown as clinically approved, and approval needs the 395 count", () => {
    expect(versionState("submitted", "listing", [{ decision: "approved" }], 1)).toBe("listing_pending");
    expect(versionState("submitted", "clinical", [], 1)).toBe("in_review");
    expect(versionState("submitted", "clinical", [{ decision: "approved" }], 2)).toBe("in_review");
    expect(versionState("submitted", "clinical", [{ decision: "approved" }], 1)).toBe("approved");
    expect(versionState("submitted", "clinical", [{ decision: "approved" }, { decision: "rejected" }], 1)).toBe("changes_requested");
  });
});

describe("records, certificates, commerce", () => {
  it("certificate ids match the 462 CHECKs", () => {
    const { no, code } = certificateIds(Buffer.from(Array.from({ length: 40 }, (_, i) => (i * 37) % 256)));
    expect(no).toMatch(/^LC-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/); expect(code).toMatch(/^[a-z0-9]{24}$/);
  });
  it("the certificate disclaimer refuses every overclaim the owner named", () => {
    for (const w of ["accreditation", "regulatory approval", "CPD accreditation", "clinical competence"]) expect(CERTIFICATE_DISCLAIMER).toMatch(new RegExp(w));
  });
  it("evidence documents are PDF or image, at most 4 MB", () => {
    expect(evidenceProblem({ type: "application/pdf", size: 1000 })).toBeNull();
    expect(evidenceProblem({ type: "text/html", size: 10 })).toMatch(/PDF/);
    expect(evidenceProblem({ type: "image/png", size: 5 * 1024 * 1024 })).toMatch(/4 MB/);
  });
  it("a course reference is lrn-, never cin-, so the experience adapter never sees it", () => {
    expect(isLearningTxRef("lrn-1")).toBe(true); expect(isLearningTxRef("cin-1")).toBe(false); expect(isLearningTxRef(null)).toBe(false);
  });
  it("an access period starts now, or where a live paid period ends, and null days is no end", () => {
    const now = new Date("2026-10-25T00:00:00Z");
    expect(coursePeriod(now, 30, null)).toEqual({ startsAt: "2026-10-25T00:00:00.000Z", endsAt: "2026-11-24T00:00:00.000Z" });
    expect(coursePeriod(now, 30, "2026-11-01T00:00:00Z").startsAt).toBe("2026-11-01T00:00:00.000Z");
    expect(coursePeriod(now, 30, "2026-10-01T00:00:00Z").startsAt).toBe("2026-10-25T00:00:00.000Z");
    expect(coursePeriod(now, null, null).endsAt).toBeNull();
  });
  it("the policy clamps, and its terms version must be one the terms text holds", () => {
    expect(resolveLearningPolicy({ checkAttempts: 99, termsVersion: "learning-terms/9", levels: ["Bad Level"] })).toMatchObject({ checkAttempts: 20, termsVersion: "learning-terms/1", levels: DEFAULT_LEARNING_POLICY.levels });
    expect(LEARNING_TERMS["learning-terms/1"].text).toMatch(/does not include Competen Scholar or Competen Professional/);
  });
});

describe("references for Professional and the Passport", () => {
  const ref: LearningReference = { recordId: "r1", offeringId: "o1", code: "LRN-ECG-01", title: "ECG Interpretation", versionNo: 1, delivery: "hosted", provider: "Competen Holdings",
    completedOn: "2026-10-25", completionKind: "assessed_knowledge", outcomeLabel: "Assessed knowledge", evidenceClass: "platform_recorded", evidenceLabel: "Recorded by Competen Learning",
    hours: 0.5, cpdNote: "", certificates: [{ no: "LC-AAAA-BBBB-CCCC", outcome: "assessed_knowledge", verificationCode: "x".repeat(24), revoked: false }, { no: "LC-REVO-KEDD-XXXX", outcome: "course_completion", verificationCode: "y".repeat(24), revoked: true }],
    competencies: [{ id: COMP, name: "ECG", relation: "develops", relationLabel: "Develops knowledge or skills" }] };
  it("a CPD line is labelled as from Learning, with its own hours", () => {
    expect(learningCpdLines([ref])[0]).toMatchObject({ source: "learning", activityType: "course", hours: 0.5, evidenceLabel: "Recorded by Competen Learning" });
  });
  it("learning serves a need only through a shared competency, computed on read", () => {
    expect(learningForCompetencies([ref], [COMP])).toHaveLength(1);
    expect(learningForCompetencies([ref], ["other"])).toHaveLength(0);
  });
  it("Passport items never say verified, and a revoked certificate is not listed", () => {
    const [p] = learningPassportItems([ref]);
    expect(JSON.stringify(p)).not.toMatch(/verified/i);
    expect(p.certificateNos).toEqual(["LC-AAAA-BBBB-CCCC"]);
  });
});
