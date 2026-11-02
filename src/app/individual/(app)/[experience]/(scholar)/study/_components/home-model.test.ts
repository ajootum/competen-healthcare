import { describe, expect, it } from "vitest";
import { buildActivity, continueTarget, examCheckpoint, failedPart, HOME_CARDS, offPart, okPart, visibleHomeCards, type ActivityInput } from "./home-model";
import type { ScholarModuleKey } from "@/lib/individual/scholar/module-access";

const ALL: ScholarModuleKey[] = ["courses", "competencies"];

const base: ActivityInput = { study: null, nextStep: offPart, courses: offPart, monthly: offPart, exam: offPart, gaps: offPart, due: 0, materials: okPart([]) };

describe("home cards", () => {
  it("carries the exact copy", () => {
    expect(HOME_CARDS.map(c => [c.title, c.line, c.cta])).toEqual([
      ["My Learning", "Learn your way.", "Continue Learning"],
      ["Courses & Training", "Learn through structured programmes.", "Explore Courses"],
      ["My Competencies", "Develop and demonstrate your competencies.", "View My Competencies"],
    ]);
  });
});

describe("visibleHomeCards (private module development access)", () => {
  it("shows My Learning alone when no module is allowed", () => expect(visibleHomeCards([]).map(c => c.key)).toEqual(["learning"]));
  it("shows exactly the allowed modules, My Learning first", () => {
    expect(visibleHomeCards(["competencies"]).map(c => c.key)).toEqual(["learning", "competencies"]);
    expect(visibleHomeCards(["courses"]).map(c => c.key)).toEqual(["learning", "courses"]);
    expect(visibleHomeCards(ALL).map(c => c.key)).toEqual(["learning", "courses", "competencies"]);
  });
});

describe("continueTarget", () => {
  const study = { id: "0b5f1c2e-1111-4222-8333-444455556666", space: "revise" as const };
  it("no material goes to Upload in My Library", () => expect(continueTarget({ noMaterial: true, study, resumeSessionId: "s" }).href).toBe("/individual/scholar/study#upload"));
  it("a study session reopens in its last stage", () => {
    const t = continueTarget({ noMaterial: false, study, resumeSessionId: "s" });
    expect(t.kind).toBe("study");
    expect(t.href).toContain("/individual/scholar/study/revise");
    expect(t.href).toContain(study.id);
  });
  it("else the active learning session", () => expect(continueTarget({ noMaterial: false, study: null, resumeSessionId: "abc" }).href).toBe("/individual/scholar/study/learn?session=abc"));
  it("else Learn", () => expect(continueTarget({ noMaterial: false, study: null, resumeSessionId: null }).href).toBe("/individual/scholar/study/learn"));
});

describe("examCheckpoint", () => {
  it("is null when there is no date or it has passed", () => {
    expect(examCheckpoint(null, "2026-11-02")).toBeNull();
    expect(examCheckpoint({ examDate: null, examLabel: null }, "2026-11-02")).toBeNull();
    expect(examCheckpoint({ examDate: "2026-11-01", examLabel: null }, "2026-11-02")).toBeNull();
  });
  it("says how far away it is", () => {
    expect(examCheckpoint({ examDate: "2026-11-02", examLabel: "Finals" }, "2026-11-02")?.when).toBe("today");
    expect(examCheckpoint({ examDate: "2026-11-03", examLabel: null }, "2026-11-02")?.when).toBe("tomorrow");
    expect(examCheckpoint({ examDate: "2026-11-12", examLabel: "Finals" }, "2026-11-02")).toMatchObject({ when: "in 10 days", label: "Finals, 12 November 2026" });
  });
});

describe("buildActivity and the private Courses module", () => {
  it("leaves the Active courses section out for a learner who may not see Courses & Training", () => {
    const input = { ...base, courses: okPart([{ id: "c1", title: "C1" }]) };
    expect(buildActivity(input, ["competencies"]).some(x => x.key === "courses")).toBe(false);
    expect(buildActivity(input, []).some(x => x.key === "courses")).toBe(false);
    expect(buildActivity(input, ["courses"]).some(x => x.key === "courses")).toBe(true);
  });
});

describe("buildActivity", () => {
  it("is empty when nothing is real", () => expect(buildActivity(base, ALL)).toEqual([]));
  it("lists real rows only", () => {
    const s = buildActivity({ ...base, due: 4, materials: okPart([{ id: "m1", title: "Notes" }]), gaps: okPart([1, 2, 3, 4].map(n => ({ id: `g${n}`, name: `G${n}` }))) }, ALL);
    expect(s.map(x => x.key)).toEqual(["gaps", "progress"]);
    expect(s[0].items).toHaveLength(3);
    expect(s[1].items.map(i => i.text)).toEqual(["4 cards due", "Notes"]);
  });
  it("says a failed read could not be read, and keeps the other rows", () => {
    const s = buildActivity({ ...base, due: null, courses: failedPart, monthly: failedPart, materials: okPart([{ id: "m1", title: "Notes" }]) }, ALL);
    expect(s.find(x => x.key === "courses")).toMatchObject({ items: [], failed: ["Your courses"] });
    expect(s.find(x => x.key === "upcoming")?.failed).toEqual(["Your monthly review"]);
    expect(s.find(x => x.key === "progress")).toMatchObject({ failed: ["Your cards due"] });
    expect(s.find(x => x.key === "progress")?.items).toHaveLength(1);
  });
  it("calls monthly reviews and exam dates learning checkpoints, never assessments", () => {
    const s = buildActivity({ ...base, monthly: okPart([{ month: "2026-10" }]), exam: okPart({ label: "Finals, 12 November 2026", when: "in 10 days" }) }, ALL);
    const text = JSON.stringify(s);
    expect(s[0].heading).toBe("Upcoming learning checkpoints");
    expect(text).toContain("not a formal assessment");
    expect(text).not.toMatch(/enrol|certif/i);
  });
  it("caps courses at three and points to My Courses", () => {
    const s = buildActivity({ ...base, courses: okPart([1, 2, 3, 4, 5].map(n => ({ id: `c${n}`, title: `C${n}` }))) }, ALL);
    expect(s[0].items).toHaveLength(4);
    expect(s[0].items[3].href).toBe("/individual/scholar/courses/mine");
  });
});
