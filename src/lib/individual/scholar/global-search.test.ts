import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ read: [] as string[], failLearn: false }));

vi.mock("../learning-plan/entry-store", () => ({ listEntries: async () => { h.read.push("plan"); return { ok: true, data: { entries: [{ id: "e1", title: "Sepsis revision", entryDate: "2026-11-09", status: "planned" }], exceptions: [] } }; } }));
vi.mock("./apply-context-data", () => ({ loadPracticeRows: async () => { h.read.push("apply"); return []; } }));
vi.mock("./competency-view", () => ({ loadLearnerCatalogue: async () => { h.read.push("competencies"); return { competencies: [{ id: "c1", title: "Recognise sepsis", code: "N1" }] }; } }));
vi.mock("./learn-search", () => ({
  displayTitle: (t: string) => t, parseSearchParams: (x: unknown) => x,
  searchLibrary: async () => {
    h.read.push("learn");
    if (h.failLearn) throw new Error("down");
    return { topics: { items: [{ name: "Sepsis", sections: 2 }] }, sections: { items: [{ chunkId: "ch1", materialId: "m1", materialTitle: "Sepsis notes", location: "Page 2", topics: [] }] }, sessions: { items: [] } };
  },
}));
vi.mock("./saved-library", () => ({ cardHrefPath: (f: string) => `cards:${f}`, lessonHrefPath: (s: string, n: number) => `lesson:${s}:${n}` }));
vi.mock("./store", () => ({
  getStudyPlan: async () => ({ ok: true, data: { goal: "Pass the sepsis module", examLabel: null, examDate: null, priorities: [] } }),
  librarySearch: async () => { h.read.push("saved"); return { ok: true, data: { rows: [], total: 0 } }; },
  listEvaluations: async () => { h.read.push("evaluate"); return { ok: true, data: [] }; },
  listMaterials: async () => ({ ok: true, data: [{ id: "m1", title: "Sepsis notes", fileName: "s.pdf" }, { id: "m2", title: "Wound care", fileName: "w.pdf" }] }),
}));

import { globalSearch, parseGlobalQuery, plainHit, planSearchRows, savedHitPath } from "./global-search";

const open = { planOn: true, savedOn: true, modules: new Set(["competencies"]) } as never;

describe("parseGlobalQuery", () => {
  it("needs two characters and tidies the rest", () => {
    expect(parseGlobalQuery("a")).toBeNull();
    expect(parseGlobalQuery("   ")).toBeNull();
    expect(parseGlobalQuery(null)).toBeNull();
    expect(parseGlobalQuery("  sepsis   care ")).toBe("sepsis care");
    expect(parseGlobalQuery("x".repeat(400))).toHaveLength(120);
  });
});

describe("globalSearch", () => {
  it("groups results by module and record type, and says where each belongs", async () => {
    const g = await globalSearch({ admin: {}, userId: "u1" }, open, "sepsis");
    const lib = g.find(x => x.module === "library")!;
    expect(lib.label).toBe("My Library");
    expect(lib.types[0].results.map(r => r.id)).toEqual(["m1"]);
    expect(g.find(x => x.module === "learn")!.types.map(t => t.label)).toEqual(["Topics", "Sections of your notes"]);
  });
  it("⚠ a section opens in its material, and never starts a lesson", async () => {
    const g = await globalSearch({ admin: {}, userId: "u1" }, open, "sepsis");
    const sec = g.find(x => x.module === "learn")!.types.find(t => t.label === "Sections of your notes")!;
    expect(sec.results[0].path).toBe("study/m1#c-ch1");
  });
  it("⚠ a module the person may not see is never read", async () => {
    h.read = [];
    const g = await globalSearch({ admin: {}, userId: "u1" }, { planOn: false, savedOn: false, modules: new Set() } as never, "sepsis");
    expect(g.map(x => x.module)).not.toEqual(expect.arrayContaining(["plan"]));
    expect(g.map(x => x.module)).not.toEqual(expect.arrayContaining(["saved"]));
    expect(g.map(x => x.module)).not.toEqual(expect.arrayContaining(["competencies"]));
    expect(h.read).not.toContain("plan");
    expect(h.read).not.toContain("saved");
  });
  it("a source that fails says so, and is not shown as nothing found", async () => {
    h.failLearn = true;
    const g = await globalSearch({ admin: {}, userId: "u1" }, open, "sepsis");
    h.failLearn = false;
    expect(g.find(x => x.module === "learn")).toMatchObject({ unreadable: true, types: [] });
    expect(g.find(x => x.module === "library")!.unreadable).toBe(false);
  });
  it("every group keeps a way to search that module's own page", async () => {
    const g = await globalSearch({ admin: {}, userId: "u1" }, open, "sepsis");
    expect(g.find(x => x.module === "revise")).toMatchObject({ types: [], unreadable: false, morePath: "study/revise?view=topics&q=sepsis" });
  });
});

describe("planSearchRows", () => {
  const plan = { goal: "Pass the sepsis module", examLabel: "Sepsis exam", examDate: "2026-12-01", priorities: ["Wound care", "Sepsis bundle"] };
  const entries = [
    { id: "b", title: "Sepsis later", entryDate: "2026-12-05", status: "planned" },
    { id: "a", title: "Sepsis sooner", entryDate: "2026-11-05", status: "planned" },
    { id: "x", title: "Sepsis cancelled", entryDate: "2026-11-01", status: "cancelled" },
    { id: "w", title: "Wound care", entryDate: "2026-11-02", status: "planned" },
  ];
  it("finds the goal, exam, priorities and own entries, soonest first, and no cancelled entry", () => {
    expect(planSearchRows(plan, entries, "sepsis").map(r => r.id)).toEqual(["goal", "exam", "priority-1", "a", "b"]);
  });
  it("an entry opens on its date", () => {
    expect(planSearchRows(null, entries, "sooner")[0].path).toBe("study/plan?view=calendar&date=2026-11-05");
  });
  it("copes with no plan", () => {
    expect(planSearchRows(null, [], "x")).toEqual([]);
  });
});

describe("plainHit", () => {
  it("never shows the search's own markers", () => {
    expect(plainHit("early recognition of {{hl}}deterioration{{/hl}} on the ward")).toBe("early recognition of deterioration on the ward");
  });
});

describe("savedHitPath", () => {
  const base = { id: "i", label: "L", sessionId: null, step: null, materialId: null, chunkId: null, artefactId: null };
  it("opens the thing itself", () => {
    expect(savedHitPath({ ...base, kind: "lesson" })).toBe("study/learn?session=i");
    expect(savedHitPath({ ...base, kind: "flashcard" })).toBe("cards:L");
    expect(savedHitPath({ ...base, kind: "note", sessionId: "s", step: 2 })).toBe("lesson:s:2");
    expect(savedHitPath({ ...base, kind: "note", materialId: "m", chunkId: "c" })).toBe("study/m#c-c");
    expect(savedHitPath({ ...base, kind: "artefact" })).toBe("study/saved");
  });
});
