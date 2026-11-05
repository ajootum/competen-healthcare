import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("./learn-search", () => ({
  searchLibrary: async (_a: unknown, _u: unknown, p: { q: string }) => {
    h.asked.push(p.q);
    const found = p.q.includes("hypertension");
    return { params: p, terms: [], counts: { topics: found ? 1 : 0, documents: 0, sections: 0, sessions: 0 } };
  },
}));
vi.mock("./store", () => ({ sectionTopicRows: async () => ({ ok: true, data: [{ chunkId: "c1", topics: ["Hypertension in pregnancy"] }] }) }));

import { searchLibraryTolerant } from "./tolerant-search";

const params = (q: string) => ({ q, tab: "all", page: 1, sort: "relevance", type: null, within: null, subject: null }) as never;

describe("searchLibraryTolerant", () => {
  it("corrects one slip against the learner's own topics, says so, and keeps their words in params", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("hypertenison"), []);
    expect(r.showingFor).toBe("hypertension");
    expect(r.params.q).toBe("hypertenison");
    expect(h.asked).toEqual(["hypertenison", "hypertension"]);
  });
  it("never turns hypotension into hypertension", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("hypotension"), []);
    expect(r.showingFor).toBeNull();
    expect(h.asked).toEqual(["hypotension"]);
  });
  it("does not search twice when the first search finds something", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("hypertension"), []);
    expect(r.showingFor).toBeNull();
    expect(h.asked).toHaveLength(1);
  });
});
