import { describe, expect, it } from "vitest";
import { ALL_LEAVES, NAV_STORAGE_KEY, SCHOLAR_NAV, activeOf, parseExpanded, visibleItems, visibleModules } from "./nav";
import { SCHOLAR_SPACES } from "./spaces";
import { FOUNDATION_NAV } from "../experiences";

const keyOf = (path: string) => activeOf(path)?.leaf.key ?? null;
const learning = SCHOLAR_NAV.modules[0];

describe("Scholar navigation model", () => {
  it("is Home, three modules with the agreed labels, and the four shared links", () => {
    expect(SCHOLAR_NAV.home.segment).toBe("");
    expect(SCHOLAR_NAV.modules.map(m => m.label)).toEqual(["My Learning", "Courses & Training", "My Competencies"]);
    expect(SCHOLAR_NAV.shared.map(l => l.label)).toEqual(["Personal AI", "Competen Passport", "Profile & history", "Settings"]);
  });

  it("gives every SCHOLAR_SPACES segment exactly one My Learning leaf, in order, with the sidebar's words", () => {
    const spaces = learning.items.filter(l => l.key !== "search-history" && l.key !== "notebook");
    expect(spaces.map(l => l.segment)).toEqual(SCHOLAR_SPACES.map(s => s.segment));
    for (const s of SCHOLAR_SPACES) expect(learning.items.filter(l => l.segment === s.segment)).toHaveLength(1);
    expect(learning.items.map(l => l.label)).toEqual(["My Plan", "My Library", "My Notebook", "My Search History", "Learn", "Revise", "Apply", "Evaluate", "My Progress"]);
    expect(learning.items.every(l => l.carriesStudy)).toBe(true);
  });

  it("lists Courses and Competencies leaves as agreed, with an Overview first", () => {
    const [, courses, comp] = SCHOLAR_NAV.modules;
    expect(courses.items.map(l => [l.label, l.segment])).toEqual([
      ["Overview", "courses"], ["Explore Courses", "courses/explore"], ["My Courses", "courses/mine"],
      ["My Programmes", "courses/programmes"], ["Learning Progress", "courses/progress"],
    ]);
    expect(comp.items.map(l => [l.label, l.segment])).toEqual([
      ["Overview", "my-competencies"], ["Assessments", "my-competencies/assessments"], ["My Evidence", "my-competencies/evidence"],
    ]);
    expect(comp.items.every(l => l.segment === "my-competencies" || l.segment.startsWith("my-competencies/"))).toBe(true);
  });

  it("repeats the foundation segments and labels of the registry, and uses no segment twice", () => {
    for (const l of SCHOLAR_NAV.shared) {
      const f = FOUNDATION_NAV.find(n => n.segment === l.segment);
      expect(f?.label).toBe(l.label);
    }
    const segs = ALL_LEAVES.map(l => l.segment);
    expect(new Set(segs).size).toBe(segs.length);
    expect(new Set(ALL_LEAVES.map(l => l.key)).size).toBe(ALL_LEAVES.length);
  });

  it("marks no leaf as future: Assessments is operational and verification has its place in My Evidence", () => {
    expect(ALL_LEAVES.filter(l => l.status === "future")).toEqual([]);
  });

  it("offers no enrol, buy, pay or certify wording", () => {
    for (const l of ALL_LEAVES) expect(l.label).not.toMatch(/enrol|buy|pay|certif/i);
    for (const m of SCHOLAR_NAV.modules) expect(m.label).not.toMatch(/enrol|buy|pay|certif/i);
  });

  it("shows My Notebook only where it is offered, after My Library, and makes it current on its pages", () => {
    expect(visibleItems(learning, { myPlan: true }).map(l => l.key)).not.toContain("notebook");
    expect(visibleItems(learning, { myPlan: true, notebook: false }).map(l => l.key)).not.toContain("notebook");
    expect(visibleItems(learning, { myPlan: true, notebook: true }).map(l => l.key).slice(0, 3)).toEqual(["plan", "library", "notebook"]);
    expect(activeOf("/individual/scholar/study/notebook")?.leaf.key).toBe("notebook");
    expect(activeOf("/individual/scholar/study/notebook/new")?.leaf.key).toBe("notebook");
  });

  it("shows My Search History only while HQ offers it, right after My Library, and makes it current on its own page", () => {
    expect(visibleItems(learning, { myPlan: true }).map(l => l.key)).not.toContain("search-history");
    expect(visibleItems(learning, { myPlan: true, searchHistory: false }).map(l => l.key)).not.toContain("search-history");
    expect(visibleItems(learning, { myPlan: true, searchHistory: true }).map(l => l.key).slice(0, 3)).toEqual(["plan", "library", "search-history"]);
    expect(activeOf("/individual/scholar/study/saved/searches")?.leaf.key).toBe("search-history");
    expect(activeOf("/individual/scholar/study/saved")?.leaf.key).toBe("learn");
  });

  it("hides the My Plan leaf while its gate is off", () => {
    expect(visibleItems(learning, { myPlan: false }).map(l => l.key)).not.toContain("plan");
    expect(visibleItems(learning, { myPlan: true })[0].key).toBe("plan");
    expect(visibleItems(SCHOLAR_NAV.modules[1], { myPlan: false })).toHaveLength(5);
  });
});

describe("activeOf", () => {
  it("names the leaf, longest segment first", () => {
    expect(keyOf("study")).toBe("library");
    expect(keyOf("study/2f7c1a5e-0000-4000-8000-000000000000")).toBe("library");
    expect(keyOf("study/ready")).toBe("library");
    expect(keyOf("study/plan")).toBe("plan");
    expect(keyOf("study/saved")).toBe("learn");
    expect(keyOf("study/revise/flashcards")).toBe("revise");
    expect(keyOf("study/apply/osce/abc")).toBe("apply");
    expect(keyOf("study/progress/explore")).toBe("progress");
    expect(keyOf("courses")).toBe("courses");
    expect(keyOf("courses/explore")).toBe("courses-explore");
    expect(keyOf("my-competencies")).toBe("competencies");
    expect(keyOf("my-competencies/gaps")).toBe("competencies");
    expect(keyOf("passport/share")).toBe("passport");
    expect(keyOf("ai-allowance")).toBe("settings");
    expect(keyOf("")).toBe("home");
  });

  it("keeps the retired My Competencies pages on the leaf that took over, and gives the new routes their own", () => {
    for (const old of ["profile", "frameworks", "gaps"]) expect(keyOf(`my-competencies/${old}`)).toBe("competencies");
    expect(keyOf("my-competencies/practice")).toBe("competencies-assessments");
    expect(keyOf("my-competencies/verification")).toBe("competencies-evidence");
    expect(keyOf("my-competencies/assessments")).toBe("competencies-assessments");
    expect(keyOf("my-competencies/assessments/2f7c1a5e-0000-4000-8000-000000000000")).toBe("competencies-assessments");
    expect(keyOf("my-competencies/assessments/start/CHK-RESP-ASSESS")).toBe("competencies-assessments");
    expect(keyOf("my-competencies/assessments/2f7c1a5e-0000-4000-8000-000000000000/report")).toBe("competencies-assessments");
    expect(keyOf("my-competencies/evidence")).toBe("competencies-evidence");
    expect(keyOf("/individual/scholar/my-competencies/frameworks#frameworks")).toBe("competencies");
  });

  it("names the holding module, and none for Home and the shared links", () => {
    expect(activeOf("study/learn")?.module).toBe("learning");
    expect(activeOf("courses/mine")?.module).toBe("courses");
    expect(activeOf("my-competencies/evidence")?.module).toBe("competencies");
    expect(activeOf("")?.module).toBeNull();
    expect(activeOf("passport")?.module).toBeNull();
  });

  it("accepts a full pathname, a query and a fragment, and claims no lookalike or unknown path", () => {
    expect(keyOf("/individual/scholar/study/learn?study=x#top")).toBe("learn");
    expect(keyOf("/individual/scholar/")).toBe("home");
    expect(keyOf("/individual/scholar")).toBe("home");
    expect(keyOf("studying")).toBeNull();
    expect(keyOf("courses-extra")).toBeNull();
    expect(keyOf("nowhere")).toBeNull();
  });
});

describe("parseExpanded", () => {
  it("reads the stored module keys", () => {
    expect(NAV_STORAGE_KEY).toBe("cmp:scholar:nav:v1");
    expect(parseExpanded(JSON.stringify(["courses", "learning"]))).toEqual(["learning", "courses"]);
  });
  it("treats null, bad JSON, the wrong shape and unknown keys as nothing open", () => {
    expect(parseExpanded(null)).toEqual([]);
    expect(parseExpanded(undefined)).toEqual([]);
    expect(parseExpanded("")).toEqual([]);
    expect(parseExpanded("{nope")).toEqual([]);
    expect(parseExpanded('{"learning":true}')).toEqual([]);
    expect(parseExpanded('["bogus",42,null]')).toEqual([]);
    expect(parseExpanded('["competencies","bogus"]')).toEqual(["competencies"]);
  });
});

describe("visibleModules (private module development access)", () => {
  it("is My Learning alone when nothing is allowed, and never greys a module", () => {
    expect(visibleModules([]).map(m => m.key)).toEqual(["learning"]);
    expect(visibleModules([]).flatMap(m => m.items.map(l => l.segment)).some(s => s.startsWith("courses") || s.startsWith("my-competencies"))).toBe(false);
  });
  it("adds exactly the modules named, in sidebar order", () => {
    expect(visibleModules(["courses"]).map(m => m.key)).toEqual(["learning", "courses"]);
    expect(visibleModules(["competencies"]).map(m => m.key)).toEqual(["learning", "competencies"]);
    expect(visibleModules(["competencies", "courses"]).map(m => m.key)).toEqual(["learning", "courses", "competencies"]);
  });
  it("ignores a key that is not a module", () => expect(visibleModules(["bogus", "learning"]).map(m => m.key)).toEqual(["learning"]));
});
