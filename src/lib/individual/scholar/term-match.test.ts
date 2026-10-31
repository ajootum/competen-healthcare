import { describe, expect, it } from "vitest";
import { termCovered, termIndex } from "./term-match";
import { groundingOutcome, matchedTerms } from "./evidence-recovery";

// SCHOLAR-GUIDED-LEARNING-01 (owner, 31 Oct): key-term support by variant, deterministically. Each pass has a control.
const covers = (term: string, text: string) => termCovered(term, termIndex(text));

describe("key-term coverage beyond literal words", () => {
  it("morphological variants count: error/errors/erroneous, culture/cultural", () => {
    expect(covers("error", "Erroneous entries were found.")).toBe(true);
    expect(covers("erroneous", "Errors are reported.")).toBe(true);
    expect(covers("errors", "An error is reported.")).toBe(true);
    expect(covers("cultural", "A just culture supports reporting.")).toBe(true);
    expect(covers("culture", "Cultural change takes time.")).toBe(true);
  });
  it("an abbreviation and its expansion count both ways: PDSA / Plan-Do-Study-Act", () => {
    expect(covers("pdsa", "Use a Plan-Do-Study-Act cycle.")).toBe(true);
    expect(covers("pdsa", "Use a plan do study act cycle.")).toBe(true);
    expect(covers("study", "Run a PDSA cycle.")).toBe(true);
    expect(covers("sbar", "Hand over with situation, background, assessment, recommendation.")).toBe(true);
    expect(covers("sbar", "Hand over with Situation-Background-Assessment-Recommendation.")).toBe(true);
  });
  it("spelling variants and plurals count", () => {
    expect(covers("pediatric", "Paediatric early warning scores.")).toBe(true);
    expect(covers("behaviours", "At-risk behavior is coached.")).toBe(true);
  });
  it("control: a genuinely absent concept stays uncovered, and numbers stay literal", () => {
    expect(covers("blame", "A just culture supports reporting.")).toBe(false);
    expect(covers("sepsis", "Use a Plan-Do-Study-Act cycle.")).toBe(false);
    expect(covers("2", "There are two types.")).toBe(false);
    expect(covers("pdsa", "Plan the study, then act.")).toBe(false);
  });
  it("the grounding outcome reads the same coverage", () => {
    const g = groundingOutcome(["erroneous", "culture", "pdsa", "sepsis"], [{ content: "Errors in a just cultural setting; a Plan-Do-Study-Act cycle." }]);
    expect(g.covered).toEqual(["erroneous", "culture", "pdsa"]);
    expect(g.uncoveredTerms).toEqual(["sepsis"]);
    expect(matchedTerms("Errors and culture", ["error", "blame"])).toEqual(["error"]);
  });
});
