import { describe, expect, it } from "vitest";
import { PROFESSIONAL_SEARCH_MODULES, allowedProfessionalModules, professionalScopeLine, professionalSearchPath, type ProfessionalSearchKey } from "./registry-professional";
import { SCHOLAR_SEARCH_MODULES } from "./registry";
import { PROFESSIONAL } from "../experiences";

const all = new Set<ProfessionalSearchKey>(PROFESSIONAL_SEARCH_MODULES.map(m => m.key));

describe("the Professional search registry", () => {
  it("registers Professional modules only, and none of Scholar's", () => {
    expect(PROFESSIONAL_SEARCH_MODULES.every(m => m.product === "Professional")).toBe(true);
    expect(SCHOLAR_SEARCH_MODULES.every(m => m.product === "Scholar")).toBe(true);
    expect(PROFESSIONAL_SEARCH_MODULES.map(m => m.segment).filter(s => s.startsWith("study"))).toEqual([]);
  });
  it("every segment is a module Professional lists", () => {
    const listed = PROFESSIONAL.modules.map(m => m.segment);
    for (const m of PROFESSIONAL_SEARCH_MODULES) expect(listed).toContain(m.segment);
  });
  it("every module says what it searches", () => {
    for (const m of PROFESSIONAL_SEARCH_MODULES) {
      expect(m.recordTypes.length).toBeGreaterThan(0);
      expect(m.fields.length).toBeGreaterThan(0);
      expect(professionalScopeLine(m.key)).toMatch(/^Searching /);
    }
  });
  it("a person sees only the modules they may open", () => {
    expect(allowedProfessionalModules({ modules: all }).length).toBe(PROFESSIONAL_SEARCH_MODULES.length);
    expect(allowedProfessionalModules({ modules: new Set<ProfessionalSearchKey>(["cpd"]) }).map(m => m.key)).toEqual(["cpd"]);
    expect(allowedProfessionalModules({ modules: new Set() })).toEqual([]);
  });
  it("a module search goes to its own page with the words", () => {
    expect(professionalSearchPath("cpd", "sepsis care")).toBe("cpd?q=sepsis+care");
    expect(professionalSearchPath("competencies", "x")).toBe("competencies?q=x");
  });
});
