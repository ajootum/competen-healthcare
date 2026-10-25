import { beforeEach, describe, expect, it, vi } from "vitest";

// REVISION-01 R2: what a question practises -- its competency and learning outcome -- read from the student's own
// section links at feedback time. A link no longer live (rejected, or now to another competency) shows nothing, and
// it is always labelled practice, not competence. The store and the catalogue are mocked: these pin Scholar's rule.

const links: { chunkId: string; competencyId: string; outcome: string | null; accepted: boolean }[] = [];
vi.mock("./store", async orig => ({ ...(await orig<typeof import("./store")>()), sectionLinks: vi.fn(async () => links) }));
vi.mock("./competency-view", async orig => ({
  ...(await orig<typeof import("./competency-view")>()),
  loadLearnerCatalogue: vi.fn(async () => ({ competencies: [] })),
  competencyLabels: vi.fn(async (_a: unknown, _c: unknown, ids: string[]) => new Map(ids.map(id => [id, { title: `Named ${id}`, code: "CF-1", layer: "profession", catalogue: null }]))),
}));

const { questionLinks } = await import("./revision-links");
const { NOT_COMPETENCE_LABEL } = await import("./config");

const C = "00000000-0000-4000-8000-0000000000c1", D = "00000000-0000-4000-8000-0000000000d1";
beforeEach(() => { links.length = 0; });

describe("questionLinks", () => {
  it("names the competency and its outcome where the section is still linked to it", async () => {
    links.push({ chunkId: "k1", competencyId: C, outcome: "Administer oxygen to a target range", accepted: true });
    const m = await questionLinks({}, "u", [{ id: "q1", chunkId: "k1", competencyId: C }]);
    expect(m.get("q1")).toEqual({ competency: `CF-1 Named ${C}`, outcome: "Administer oxygen to a target range" });
  });
  it("shows nothing for a question with no competency, or whose link is gone or now names another competency", async () => {
    links.push({ chunkId: "k2", competencyId: D, outcome: null, accepted: true });
    const m = await questionLinks({}, "u", [{ id: "q0", chunkId: "k1", competencyId: null }, { id: "q2", chunkId: "k2", competencyId: C }, { id: "q3", chunkId: "k9", competencyId: C }]);
    expect(m.size).toBe(0);
  });
  it("is labelled practice, never competence, in the feedback", async () => {
    const { feedbackView } = await import("./revision-view");
    const q = { id: "q1", kind: "mcq", correctIndex: 0, options: ["a", "b"], answer: null, rationale: "r", sourceQuote: "s", materialId: "m", chunkId: "k1", materialTitle: "T", ordinal: 1, pageFrom: null, pageTo: null, unit: "section" } as never;
    expect(feedbackView(q, { correct: true, score: 1, marking: "deterministic", link: { competency: "CF-1 X", outcome: null } }).practises)
      .toEqual({ competency: "CF-1 X", outcome: null, label: NOT_COMPETENCE_LABEL });
    expect(feedbackView(q, { correct: true, score: 1, marking: "deterministic" }).practises).toBeNull();
  });
});
