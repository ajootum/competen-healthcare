import { describe, expect, it, vi } from "vitest";
import { capPolicyOf, questionCapPolicy } from "./safety-caps";
import { capForSafety, criteriaMarks, type Criterion } from "./scoring-rules";

// Owner decision 1 (4 Nov 2026, migration 998): the rules-v3 caps apply only to a library copy whose safety markers the clinical
// reviewers explicitly approved, and only while scholar_clinical_scoring_caps (the master switch) is on.

const VERSION = "11111111-1111-4111-8111-111111111111";
const libraryCopy = { library: { versionId: VERSION } };
const personal = { library: null };
const admin = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

// A part marked against weighted criteria, with a safety-critical criterion the answer missed: 3 of 4 weight met.
const criteria: Criterion[] = [{ text: "Checks airway", weight: 1, safetyCritical: true }, { text: "Gives oxygen", weight: 3, safetyCritical: false }];
const missedCritical = (caps: { capsActive: boolean }) => criteriaMarks(criteria, [1], false, caps);

describe("questionCapPolicy (998 gate)", () => {
  it("approved library copy, switch on: capped", async () => {
    const a = admin(true);
    const caps = await questionCapPolicy(a, libraryCopy, true);
    expect(caps).toEqual({ capsActive: true });
    expect(a.rpc).toHaveBeenCalledWith("ckri_library_caps_approved", { p_version: VERSION });
    expect(missedCritical(caps)).toMatchObject({ outcome: "critical_missed", score: 0, correct: false });
    expect(capForSafety({ correct: true, score: 1 }, "unsafe", caps)).toEqual({ correct: false, score: 0.5 });
  });

  it("library copy whose markers are not approved: flag recorded, not capped", async () => {
    const caps = await questionCapPolicy(admin(false), libraryCopy, true);
    expect(caps).toEqual({ capsActive: false });
    const m = missedCritical(caps);
    expect(m.outcome).toBe("critical_missed");
    expect(m.score).toBe(0.75);
    expect(capForSafety({ correct: true, score: 1 }, "unsafe", caps)).toEqual({ correct: true, score: 1 });
  });

  it("a failed read or 998 absent caps nothing", async () => {
    expect(await questionCapPolicy(admin(null, { message: "function ckri_library_caps_approved(uuid) does not exist" }), libraryCopy, true)).toEqual({ capsActive: false });
    expect(await questionCapPolicy({ rpc: vi.fn(async () => { throw new Error("network"); }) }, libraryCopy, true)).toEqual({ capsActive: false });
    expect(await questionCapPolicy(admin("true"), libraryCopy, true)).toEqual({ capsActive: false });
  });

  it("personal (AI) question: never capped, nothing read", async () => {
    const a = admin(true);
    expect(await questionCapPolicy(a, personal, true)).toEqual({ capsActive: false });
    expect(await questionCapPolicy(a, {}, true)).toEqual({ capsActive: false });
    expect(a.rpc).not.toHaveBeenCalled();
    expect(missedCritical({ capsActive: false }).score).toBe(0.75);
  });

  it("switch off: nothing capped, nothing read, even for an approved library copy", async () => {
    const a = admin(true);
    expect(await questionCapPolicy(a, libraryCopy, false)).toEqual({ capsActive: false });
    expect(a.rpc).not.toHaveBeenCalled();
  });

  it("capPolicyOf needs all three", () => {
    for (const switchOn of [true, false]) for (const libraryVersionId of [VERSION, null]) for (const markersApproved of [true, false])
      expect(capPolicyOf({ switchOn, libraryVersionId, markersApproved }).capsActive).toBe(switchOn && !!libraryVersionId && markersApproved);
  });
});

describe("every learner scoring route takes the cap from the 998 gate", () => {
  it("no route builds caps from the policy switch alone", async () => {
    const { readFileSync } = await import("node:fs");
    const routes = ["src/app/api/individual/scholar/revision/answer/route.ts", "src/app/api/individual/scholar/revision/scenario/route.ts",
      "src/app/api/individual/scholar/clinical/sessions/[kind]/[id]/answer/route.ts"];
    for (const r of routes) expect(readFileSync(r, "utf8"), r).not.toMatch(/capsActive:\s*policy\.scholarClinicalScoringCaps/);
    const answer = readFileSync(routes[0], "utf8");
    expect(answer.match(/questionCapPolicy\(ctx\.admin, q, policy\.scholarClinicalScoringCaps === "on"\)/g)?.length).toBe(2);
    expect(readFileSync(routes[2], "utf8")).toMatch(/const CASE_CAPS: CapPolicy = \{ capsActive: false \}/);
  });
});
