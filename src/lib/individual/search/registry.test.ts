import { describe, expect, it } from "vitest";
import { SCHOLAR_SEARCH_MODULES, allowedSearchModules, moduleSearchPath, scopeLine } from "./registry";
import type { ScholarModuleKey } from "../scholar/module-access";

const open = { planOn: true, savedOn: true, modules: new Set<ScholarModuleKey>(["competencies", "courses"]) };
const keys = (a: Parameters<typeof allowedSearchModules>[0]) => allowedSearchModules(a).map(m => m.key);

describe("the search registry", () => {
  it("registers the Scholar areas the standard names", () => {
    expect(SCHOLAR_SEARCH_MODULES.map(m => m.key)).toEqual(expect.arrayContaining(["library", "learn", "revise", "apply", "evaluate", "plan", "competencies"]));
  });
  it("every module says what it searches and where it goes", () => {
    for (const m of SCHOLAR_SEARCH_MODULES) {
      expect(m.recordTypes.length).toBeGreaterThan(0);
      expect(m.fields.length).toBeGreaterThan(0);
      expect(m.segment.length).toBeGreaterThan(0);
      expect(scopeLine(m.key)).toMatch(/^Searching /);
    }
  });
  it("a person sees only what they may open", () => {
    expect(keys(open)).toEqual(SCHOLAR_SEARCH_MODULES.map(m => m.key));
    expect(keys({ ...open, planOn: false })).not.toContain("plan");
    expect(keys({ ...open, savedOn: false })).not.toContain("saved");
    expect(keys({ ...open, modules: new Set() })).not.toContain("competencies");
    expect(keys({ ...open, modules: new Set() })).not.toContain("courses");
    expect(keys({ ...open, modules: new Set<ScholarModuleKey>(["competencies"]) })).not.toContain("courses");
  });
  it("a module's search keeps the view it needs", () => {
    expect(moduleSearchPath("revise", "sepsis care")).toBe("study/revise?view=topics&q=sepsis+care");
    expect(moduleSearchPath("apply", "x")).toBe("study/apply?view=library&q=x");
    expect(moduleSearchPath("evaluate", "x")).toBe("study/evaluate?view=history&q=x");
    expect(moduleSearchPath("library", "x")).toBe("study/library?q=x");
  });
});
