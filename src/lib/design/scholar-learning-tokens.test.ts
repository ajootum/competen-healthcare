// SCHOLAR LEARNING DESIGN SYSTEM: every learning tone, light and staged dark, clears WCAG AA for the pairs the components
// draw (docs/design/SCHOLAR-LEARNING-DESIGN-SYSTEM.md, "Contrast"). A tone that fails here cannot ship.
import { describe, expect, it } from "vitest";
import { contrast } from "./colour-map";
import { learningPairs } from "./scholar-learning-contrast";
import { LEARNING_TONES, cssVariables, learningTone } from "./tokens";

describe("Scholar learning tones", () => {
  it("are the semantic set the design system names", () => {
    expect(LEARNING_TONES).toEqual(["teach", "check", "aiBeyond", "explain", "guide", "challenge", "practice", "quickCheck", "notes", "sources", "next",
      "memory", "caution", "key", "example", "record", "summary"]);
  });
  it("clear WCAG AA on every pair, light and dark", () => {
    const fails = learningPairs().filter(p => p.ratio < p.min);
    expect(fails.map(f => `${f.scheme} ${f.tone} ${f.what} ${f.ratio}`)).toEqual([]);
  });
  it("the check can fail: a pale accent is caught", () => {
    expect(contrast("#C9DFBF", learningTone.teach.light.surface)).toBeLessThan(3);
  });
  it("memory is its own identity, apart from ai-beyond, quick-check and check", () => {
    const m = learningTone.memory.light;
    for (const other of ["aiBeyond", "quickCheck", "check", "challenge"] as const) {
      expect(m.accent).not.toBe(learningTone[other].light.accent);
      expect(m.surface).not.toBe(learningTone[other].light.surface);
    }
  });
  it("reach the stylesheet as --cmp-learn-<tone>-<role> and their staged dark twins", () => {
    const v = cssVariables();
    for (const tone of LEARNING_TONES) {
      const k = tone.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();
      for (const role of ["surface", "border", "accent", "ink"] as const) {
        expect(v[`--cmp-learn-${k}-${role}`]).toBe(learningTone[tone].light[role]);
        expect(v[`--cmp-learn-dark-${k}-${role}`]).toBe(learningTone[tone].dark[role]);
      }
    }
  });
});
