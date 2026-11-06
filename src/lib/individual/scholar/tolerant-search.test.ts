import { describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("./learn-search", () => ({
  searchLibrary: async (_a: unknown, _u: unknown, p: { q: string; tab?: string }) => {
    h.asked.push(p.q);
    const found = p.q.includes("pneumonia");
    // As Learn does: a tab that is not asked for is not read, so its count is null.
    const c = (tab: string, n: number) => (p.tab === "all" || p.tab === tab ? n : null);
    return { params: p, terms: [], counts: { topics: c("topics", found ? 1 : 0), documents: c("documents", 0), sections: c("sections", 0), sessions: c("sessions", 0) } };
  },
}));
vi.mock("./store", () => ({ sectionTopicRows: async () => ({ ok: true, data: [{ chunkId: "c1", topics: ["Pneumonia in pregnancy"] }] }) }));

import { nothingFound, searchLibraryTolerant } from "./tolerant-search";

const params = (q: string) => ({ q, tab: "all", page: 1, sort: "relevance", type: null, within: null, subject: null }) as never;

describe("searchLibraryTolerant", () => {
  it("corrects one slip against the learner's own topics, says so, and keeps their words in params", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("pneumonai"), []);
    expect(r.showingFor).toBe("pneumonia");
    expect(r.params.q).toBe("pneumonai");
    expect(h.asked).toEqual(["pneumonai", "pneumonia"]);
  });
  it("never turns hypotension into hypertension", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("hypotension"), []);
    expect(r.showingFor).toBeNull();
    expect(h.asked).toEqual(["hypotension"]);
  });
  it("never corrects with a type, date or subject filter set", async () => {
    for (const f of [{ type: "pdf" }, { within: 30 }, { subject: "none" }]) {
      h.asked = [];
      const r = await searchLibraryTolerant({}, "u1", { ...(params("pneumonai") as object), ...f } as never, []);
      expect(r.showingFor).toBeNull();
      expect(h.asked).toEqual(["pneumonai"]);
    }
  });
  it("leaves a query with operators as typed", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("pneumonai -pregnancy"), []);
    expect(r.showingFor).toBeNull();
    expect(h.asked).toEqual(["pneumonai -pregnancy"]);
  });
  it("corrects on a tab other than All, where the other tabs' counts are null", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", { ...(params("pneumonai") as object), tab: "topics" } as never, []);
    expect(r.showingFor).toBe("pneumonia");
  });
  it("a read that failed on the tab asked for is not 'nothing found'", () => {
    const r = (counts: object, tab: string) => ({ params: { tab }, counts }) as never;
    expect(nothingFound(r({ topics: 0, documents: null, sections: null, sessions: null }, "topics"))).toBe(true);
    expect(nothingFound(r({ topics: null, documents: 0, sections: 0, sessions: 0 }, "topics"))).toBe(false);
    expect(nothingFound(r({ topics: 0, documents: 0, sections: 0, sessions: null }, "all"))).toBe(false);
  });
  it("does not search twice when the first search finds something", async () => {
    h.asked = [];
    const r = await searchLibraryTolerant({}, "u1", params("pneumonia"), []);
    expect(r.showingFor).toBeNull();
    expect(h.asked).toHaveLength(1);
  });
});
