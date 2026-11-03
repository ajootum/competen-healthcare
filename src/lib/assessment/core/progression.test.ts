import { describe, expect, it } from "vitest";
import { evaluateProgression, stageForOrdinal, type ProgressionEvidence } from "./progression";
import { validateProgression } from "./validate";
import { RESP_ASSESS } from "./fixtures";
import type { ProgressionDoc, StageScale } from "./rules-ast";
import type { Attestation, OutcomeClass } from "./types";

const SCALE: StageScale = {
  stages: [
    { code: "unstaged", label: "Not staged", ordinal: 0 },
    { code: "novice", label: "Novice", ordinal: 1 },
    { code: "adv_beginner", label: "Advanced beginner", ordinal: 2 },
    { code: "competent", label: "Competent", ordinal: 3 },
    { code: "proficient", label: "Proficient", ordinal: 4 },
    { code: "expert", label: "Expert", ordinal: 5 },
  ],
  bands: [
    { stage: "unstaged", from_ordinal: 0, to_ordinal: 0 },
    { stage: "novice", from_ordinal: 1, to_ordinal: 2 },
    { stage: "adv_beginner", from_ordinal: 3, to_ordinal: 3 },
    { stage: "competent", from_ordinal: 4, to_ordinal: 4 },
    { stage: "proficient", from_ordinal: 5, to_ordinal: 5 },
    { stage: "expert", from_ordinal: 6, to_ordinal: 6 },
  ],
};

const NOW = "2026-11-03T00:00:00Z";
const day = (n: number) => new Date(Date.parse(NOW) - n * 86400000).toISOString();

const competentRule = {
  all: [
    { count: { where: { outcomeClass: "positive" as const, minLevelStage: { group: "skills", atLeast: "competent" } } }, op: ">=" as const, value: 2 },
    { distinctAssessors: {}, op: ">=" as const, value: 2 },
    { not: { anyCriticalFailure: { withinDays: 180 } } },
  ],
};
const PROG: ProgressionDoc = {
  schema: "asmt.progression/1",
  notStaged: "unstaged",
  target: { stage: "competent" },
  evidence: { attestation: ["assessor_evaluated"], withinDays: 365 },
  stageRules: [
    { stage: "novice", when: { count: { where: { attestation: "assessor_evaluated" } }, op: ">=", value: 2 } },
    { stage: "adv_beginner", when: { count: { where: { outcomeClass: "positive", minLevelStage: { group: "skills", atLeast: "adv_beginner" } } }, op: ">=", value: 2 } },
    { stage: "competent", when: competentRule },
  ],
  repeated: "best",
  conflicting: "latest",
  permitOrdinalMean: false,
  permitSingleAssessment: false,
};

let n = 0;
function ev(daysAgo: number, assessor: string | null, cls: OutcomeClass, skills: number | null, extra: Partial<ProgressionEvidence> = {}): ProgressionEvidence {
  n++;
  return {
    id: `e${n}`, attestation: "assessor_evaluated" as Attestation, methods: ["direct_observation"], assessor_id: assessor,
    submitted_at: day(daysAgo), outcome_class: cls, outcome_code: cls === "positive" ? "ACHIEVED" : "NOT_ACH",
    group_min_ordinal: { know: 4, skills, applied: 4 }, critical_failed: false, ...extra,
  };
}
const run = (evidence: ProgressionEvidence[], rules: ProgressionDoc = PROG) => evaluateProgression(rules, SCALE, evidence, NOW);

describe("stage bands", () => {
  it("map a level ordinal to a stage", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((o) => stageForOrdinal(SCALE, o))).toEqual(["unstaged", "novice", "novice", "adv_beginner", "competent", "proficient", "expert"]);
    expect(stageForOrdinal(SCALE, 9)).toBeNull();
  });
});

describe("unassessed is not the same as not staged", () => {
  it("no evidence at all", () => {
    const r = run([]);
    expect(r.state).toBe("unassessed");
    expect(r.stage).toBeNull();
    expect(r.outstanding[0].kind).toBe("no_evidence");
  });
  it("evidence exists but no rule holds", () => {
    const r = run([ev(10, "a1", "positive", 4)]);
    expect(r.state).toBe("not_staged");
    expect(r.stage).toBeNull();
    expect(r.qualifying_ids).toHaveLength(1);
  });
  it("only evidence outside the filter is still unassessed", () => {
    const r = run([ev(500, "a1", "positive", 6)]);
    expect(r.state).toBe("unassessed");
    expect(r.excluded[0].why).toMatch(/older than 365 days/);
  });
});

describe("(planted) self evidence never supports a stage", () => {
  const self = (d: number) => ev(d, null, "positive", 6, { attestation: "self_reported" });
  it("self-reported records are excluded by default and reported", () => {
    const r = run([self(1), self(2), self(3)]);
    expect(r.state).toBe("unassessed");
    expect(r.excluded).toHaveLength(3);
    expect(r.excluded[0].why).toMatch(/self-reported/);
  });
  it("and they cannot add to genuine evidence", () => {
    const r = run([ev(5, "a1", "positive", 4), self(1), self(2)]);
    expect(r.state).toBe("not_staged");
    expect(r.qualifying_ids).toHaveLength(1);
  });
  it("even a rule that lists self_reported cannot admit them, and the validator refuses it", () => {
    const rules: ProgressionDoc = { ...PROG, evidence: { attestation: ["assessor_evaluated", "self_reported"] } };
    expect(run([self(1), self(2)], rules).state).toBe("unassessed");
    expect(validateProgression(rules, SCALE, RESP_ASSESS).errors.map((e) => e.code)).toContain("self_evidence");
  });
  it("auditor evidence is allowed when the rules accept it", () => {
    const rules: ProgressionDoc = { ...PROG, evidence: { attestation: ["assessor_evaluated", "auditor_recorded"] } };
    const r = run([ev(5, "a1", "positive", 4, { attestation: "auditor_recorded" }), ev(4, "a2", "positive", 4)], rules);
    expect(r.qualifying_ids).toHaveLength(2);
  });
});

describe("(planted) a single assessment never promotes unless permitted", () => {
  const oneIsEnough: ProgressionDoc = {
    ...PROG, stageRules: [{ stage: "competent", when: { count: { where: { outcomeClass: "positive", minLevelStage: { group: "skills", atLeast: "competent" } } }, op: ">=", value: 1 } }],
  };
  it("the validator refuses a stage one assessment can reach", () => {
    const v = validateProgression(oneIsEnough, SCALE, RESP_ASSESS);
    expect(v.errors.map((e) => e.code)).toContain("single_assessment");
  });
  it("permitting it is allowed and shown as a warning", () => {
    const v = validateProgression({ ...oneIsEnough, permitSingleAssessment: true }, SCALE, RESP_ASSESS);
    expect(v.errors).toEqual([]);
    expect(v.warnings.map((w) => w.code)).toContain("single_assessment_permitted");
  });
  it("the engine itself also refuses, even for a rule that slipped past validation", () => {
    const r = run([ev(5, "a1", "positive", 6)], oneIsEnough);
    expect(r.state).toBe("not_staged");
    expect(r.outstanding.map((o) => o.kind)).toContain("single_assessment");
  });
  it("with the permission it stages", () => {
    const r = run([ev(5, "a1", "positive", 6)], { ...oneIsEnough, permitSingleAssessment: true });
    expect(r.state).toBe("staged");
    expect(r.stage).toBe("competent");
  });
  it("two assessments by one assessor satisfy a count of two but not two assessors", () => {
    const r = run([ev(20, "a1", "positive", 4), ev(10, "a1", "positive", 4)]);
    expect(r.stage).toBe("adv_beginner");
    expect(r.outstanding.some((o) => o.text.includes("distinct assessors"))).toBe(true);
  });
  it("the shipped rules pass validation", () => {
    expect(validateProgression(PROG, SCALE, RESP_ASSESS).errors).toEqual([]);
  });
});

describe("highest stage wins, and ordinals are never averaged", () => {
  it("two assessors, both positive at competent level", () => {
    const r = run([ev(30, "a1", "positive", 4), ev(10, "a2", "positive", 5)]);
    expect(r.state).toBe("staged");
    expect(r.stage).toBe("competent");
    expect(r.outstanding).toEqual([]);
  });
  it("a high and a low result are not averaged into a middle one", () => {
    const r = run([ev(30, "a1", "positive", 6), ev(10, "a2", "positive", 1)]);
    expect(r.stage).toBe("novice"); // two assessments, only one at competent: the mean (3.5) plays no part
  });
  it("a critical failure inside the window blocks the stage and says so", () => {
    const r = run([ev(30, "a1", "positive", 4), ev(10, "a2", "positive", 4), ev(60, "a3", "positive", 4, { critical_failed: true })]);
    expect(r.stage).toBe("adv_beginner");
    expect(r.outstanding.some((o) => o.text.includes("critical failure"))).toBe(true);
  });
  it("an old critical failure outside its own window does not", () => {
    const r = run([ev(30, "a1", "positive", 4), ev(10, "a2", "positive", 4), ev(300, "a3", "positive", 4, { critical_failed: true })]);
    expect(r.stage).toBe("competent");
  });
});

describe("repeated assessments", () => {
  const rule = (permit = true): ProgressionDoc => ({
    ...PROG, permitSingleAssessment: permit,
    stageRules: [{ stage: "competent", when: { count: { where: { minLevelStage: { group: "skills", atLeast: "competent" } } }, op: ">=", value: 1 } }],
  });
  const seq = [ev(90, "a1", "positive", 4), ev(60, "a1", "positive", 2), ev(30, "a1", "positive", 4), ev(10, "a1", "positive", 2)];
  it("best: any record that meets the test is enough", () => {
    expect(run(seq, { ...rule(), repeated: "best" }).stage).toBe("competent");
  });
  it("latest: only the most recent record counts", () => {
    expect(run(seq, { ...rule(), repeated: "latest" }).state).toBe("not_staged");
    expect(run([...seq, ev(1, "a1", "positive", 5)], { ...rule(), repeated: "latest" }).stage).toBe("competent");
  });
  it("all_must_meet: one weak record spoils it", () => {
    expect(run(seq, { ...rule(), repeated: "all_must_meet" }).state).toBe("not_staged");
    expect(run([ev(90, "a1", "positive", 4), ev(30, "a1", "positive", 5)], { ...rule(), repeated: "all_must_meet" }).stage).toBe("competent");
  });
  it("latest makes a count above one impossible, and the validator says so", () => {
    const v = validateProgression({ ...PROG, repeated: "latest" }, SCALE, RESP_ASSESS);
    expect(v.errors.map((e) => e.code)).toContain("unreachable");
  });
});

describe("conflicting evidence", () => {
  const permit: ProgressionDoc = { ...PROG, permitSingleAssessment: true, stageRules: [{ stage: "adv_beginner", when: { count: { where: { outcomeClass: "positive" } }, op: ">=", value: 1 } }] };
  const disagree = () => [ev(40, "a1", "positive", 4), ev(10, "a2", "negative", 2)];
  it("is detected between the latest records of different assessors", () => {
    const r = run(disagree(), permit);
    expect(r.conflict).toBe(true);
    expect(r.working_ids).toHaveLength(1);
  });
  it("latest: the most recent record decides", () => {
    const e = disagree();
    expect(run(e, { ...permit, conflicting: "latest" }).working_ids).toEqual([e[1].id]);
    const flipped = [ev(40, "a1", "negative", 2), ev(10, "a2", "positive", 4)];
    const r = run(flipped, { ...permit, conflicting: "latest" });
    expect(r.state).toBe("staged");
  });
  it("lowest: the weakest assessor's record decides", () => {
    const flipped = [ev(40, "a1", "negative", 2), ev(10, "a2", "positive", 4)];
    const r = run(flipped, { ...permit, conflicting: "lowest" });
    expect(r.working_ids).toEqual([flipped[0].id]);
    expect(r.state).toBe("not_staged");
  });
  it("improvement by the same assessor is not a conflict", () => {
    const r = run([ev(40, "a1", "negative", 2), ev(10, "a1", "positive", 4)], permit);
    expect(r.conflict).toBe(false);
    expect(r.working_ids).toHaveLength(2);
  });
  it("a conflict is reported in what is outstanding", () => {
    const r = run(disagree());
    expect(r.outstanding.some((o) => o.kind === "conflict")).toBe(true);
  });
});

describe("recency window", () => {
  it("evidence older than withinDays drops out and can unstage", () => {
    const old = [ev(400, "a1", "positive", 4), ev(380, "a2", "positive", 4), ev(10, "a3", "positive", 2)];
    const r = run(old);
    expect(r.excluded.map((x) => x.id)).toEqual([old[0].id, old[1].id]);
    expect(r.state).toBe("not_staged");
  });
  it("now is an input: the same evidence at an earlier date counts", () => {
    const e = [ev(400, "a1", "positive", 4), ev(380, "a2", "positive", 4)];
    const r = evaluateProgression(PROG, SCALE, e, new Date(Date.parse(NOW) - 100 * 86400000));
    expect(r.qualifying_ids).toHaveLength(2);
    expect(r.stage).toBe("competent");
  });
  it("a method filter", () => {
    const rules: ProgressionDoc = { ...PROG, evidence: { attestation: ["assessor_evaluated"], methods: ["simulation_osce"] } };
    expect(run([ev(5, "a1", "positive", 4)], rules).state).toBe("unassessed");
  });
});

describe("target and outstanding", () => {
  it("lists what is still unmet for the target stage", () => {
    const r = run([ev(30, "a1", "positive", 2), ev(10, "a2", "positive", 2)]);
    expect(r.stage).toBe("novice");
    expect(r.target).toBe("competent");
    const text = r.outstanding.map((o) => o.text).join(" | ");
    expect(text).toMatch(/records matching/);
  });
  it("a programme target comes from outside", () => {
    const rules: ProgressionDoc = { ...PROG, target: { fromProgramme: true } };
    const r = evaluateProgression(rules, SCALE, [ev(30, "a1", "positive", 2)], NOW, { programmeTarget: "adv_beginner" });
    expect(r.target).toBe("adv_beginner");
    expect(r.outstanding.length).toBeGreaterThan(0);
    expect(evaluateProgression(rules, SCALE, [], NOW).target).toBeNull();
  });
  it("nothing is outstanding once the target is met", () => {
    expect(run([ev(30, "a1", "positive", 4), ev(10, "a2", "positive", 5)]).outstanding).toEqual([]);
  });
});

describe("determinism", () => {
  it("same evidence and time, same trace hash, whatever the input order", () => {
    const e = [ev(30, "a1", "positive", 4), ev(10, "a2", "positive", 5)];
    const a = run(e), b = run([...e].reverse());
    expect(a.trace_hash).toBe(b.trace_hash);
    expect(a.trace_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(run([e[0]]).trace_hash).not.toBe(a.trace_hash);
  });
});

describe("validateProgression", () => {
  it("unknown stage, group and keys", () => {
    const bad: ProgressionDoc = { ...PROG, stageRules: [{ stage: "ghost", when: { count: { where: { minLevelStage: { group: "nope", atLeast: "ghost" } } }, op: ">=", value: 2 } }] };
    const codes = validateProgression({ ...bad, extra: 1 } as unknown as ProgressionDoc, SCALE, RESP_ASSESS).errors.map((e) => e.code);
    expect(codes).toEqual(expect.arrayContaining(["unresolved_ref", "unknown_key"]));
  });
  it("schema and enumerations", () => {
    const bad = { ...PROG, schema: "x", repeated: "sometimes" } as unknown as ProgressionDoc;
    expect(validateProgression(bad, SCALE).errors.map((e) => e.code)).toEqual(expect.arrayContaining(["bad_schema", "bad_value"]));
  });
  it("a contradictory stage rule is unreachable", () => {
    const rules: ProgressionDoc = { ...PROG, stageRules: [{ stage: "novice", when: { all: [{ count: { where: {} }, op: ">=", value: 3 }, { count: { where: {} }, op: "<", value: 2 }] } }] };
    expect(validateProgression(rules, SCALE).errors.map((e) => e.code)).toContain("unreachable");
  });
  it("permitOrdinalMean is shown to the reviewer", () => {
    expect(validateProgression({ ...PROG, permitOrdinalMean: true }, SCALE, RESP_ASSESS).warnings.map((w) => w.code)).toContain("ordinal_mean_enabled");
  });
});
