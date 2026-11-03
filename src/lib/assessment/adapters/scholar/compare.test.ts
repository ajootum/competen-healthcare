import { describe, expect, it } from "vitest";
import { compareBands, differs, evidenceBand, feedbackText, learningLinks, selfBand } from "./compare";

describe("bands", () => {
  it("puts a self rating into thirds of the scale, whatever the scale", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(r => selfBand(r, 6))).toEqual(["lower", "lower", "middle", "middle", "higher", "higher", "higher"]);
    expect([selfBand(0, 3), selfBand(1, 3), selfBand(2, 3), selfBand(3, 3)]).toEqual(["lower", "middle", "higher", "higher"]);
  });
  it("has no band without a rating or a scale", () => {
    expect(selfBand(null, 6)).toBeNull();
    expect(selfBand(3, null)).toBeNull();
    expect(selfBand(3, 0)).toBeNull();
  });
  it("puts practice into the bands Progress itself uses, and only with enough answers", () => {
    const e = (latestAccuracy: number | null, answered: number) => ({ latestAccuracy, answered, sectionsAccepted: 1 });
    expect([evidenceBand(e(49, 5)), evidenceBand(e(50, 5)), evidenceBand(e(79, 5)), evidenceBand(e(80, 5))]).toEqual(["lower", "middle", "middle", "higher"]);
    expect(evidenceBand(e(90, 2))).toBeNull();
    expect(evidenceBand(e(null, 9))).toBeNull();
    expect(evidenceBand(null)).toBeNull();
  });
});

describe("compare", () => {
  it("names the state from the two bands", () => {
    expect(compareBands("higher", "lower")).toBe("self_higher");
    expect(compareBands("lower", "higher")).toBe("evidence_higher");
    expect(compareBands("middle", "middle")).toBe("aligned");
    expect(compareBands(null, "middle")).toBe("no_self");
    expect(compareBands("middle", null)).toBe("no_evidence");
    expect(compareBands(null, null)).toBe("no_self");
  });
  it("differs only when self and practice point different ways", () => {
    expect(["self_higher", "evidence_higher"].every(s => differs(s as never))).toBe(true);
    expect(["aligned", "no_self", "no_evidence"].some(s => differs(s as never))).toBe(false);
  });
  it("uses the fixed wording, naming the competency only where it helps", () => {
    expect(feedbackText("self_higher", "Airway")).toBe("Your self-rating is higher than your recent practice results suggest. Practising Airway may help you confirm it.");
    expect(feedbackText("evidence_higher", "Airway")).toMatch(/Your recent practice results are higher than your self-rating/);
    expect(feedbackText("aligned", "Airway")).toMatch(/point the same way/);
    expect(feedbackText("no_evidence", "Airway")).toMatch(/not enough practice linked to Airway/);
    expect(feedbackText("no_self", "Airway")).toMatch(/not rated yourself on Airway/);
  });
  it("never uses clinical or verdict words", () => {
    for (const s of ["self_higher", "evidence_higher", "aligned", "no_evidence", "no_self"] as const) expect(feedbackText(s, "Airway")).not.toMatch(/competent|unsafe|fail|incompetent|verified|certif|diagnos/i);
  });
});

describe("learning links", () => {
  const id = "c0000000-0000-4000-8000-000000000001";
  it("opens Learn on the competency and the three other spaces", () => {
    const l = learningLinks(id, null);
    expect(l.map(x => x.key)).toEqual(["learn", "revise", "apply", "evaluate"]);
    expect(l[0].href).toBe(`/individual/scholar/study/learn?competency=${id}`);
    expect(l[1].href).toBe("/individual/scholar/study/revise");
  });
  it("carries an open study session on every link, and nothing when it is not a session id", () => {
    const study = "11111111-1111-4111-8111-111111111111";
    for (const x of learningLinks(id, study)) expect(x.href).toContain(`study=${study}`);
    for (const x of learningLinks(id, "not-an-id")) expect(x.href).not.toContain("study=");
  });
});
