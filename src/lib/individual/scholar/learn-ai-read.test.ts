import { describe, expect, it } from "vitest";
import { aiReadByMaterial, aiReadMark } from "./learn-ai-read";
import type { ExtractionQuality } from "./extract";

const q = (o: Partial<ExtractionQuality>): ExtractionQuality => ({ unit: "slide", units: 10, emptyUnits: [], chars: 1, sections: 1, ...o });

describe("aiReadMark", () => {
  const read = new Set([3, 7]);
  it("marks a section on a slide read by AI with the shared label", () => {
    const m = aiReadMark(read, { materialId: "m", pageFrom: 3, pageTo: 3, unit: "slide" });
    expect(m).toMatchObject({ aiRead: true });
    expect((m as { aiReadNote: string }).aiReadNote).toContain("Text read from the slide picture by AI (slide 3)");
  });
  it("marks a span that includes one, and uses the page wording for a PDF", () => {
    const m = aiReadMark(read, { materialId: "m", pageFrom: 6, pageTo: 8, unit: "page" });
    expect((m as { aiReadNote: string }).aiReadNote).toContain("page image by AI (page 7)");
  });
  it("marks nothing otherwise", () => {
    expect(aiReadMark(read, { materialId: "m", pageFrom: 4, pageTo: 5, unit: "slide" })).toEqual({});
    expect(aiReadMark(read, { materialId: "m", pageFrom: null, pageTo: null, unit: "section" })).toEqual({});
    expect(aiReadMark(undefined, { materialId: "m", pageFrom: 3, pageTo: 3 })).toEqual({});
    expect(aiReadMark(new Set(), { materialId: "m", pageFrom: 3, pageTo: 3 })).toEqual({});
  });
});

describe("aiReadByMaterial", () => {
  it("keeps only materials with AI-read (or still-empty) units", () => {
    const m = aiReadByMaterial(new Map<string, ExtractionQuality | null>([["a", q({ aiReadUnits: [2] })], ["b", q({})], ["c", null], ["d", q({ unit: "section", units: 1, aiReadUnits: [1] })]]));
    expect([...m.keys()]).toEqual(["a"]);
    expect(m.get("a")?.has(2)).toBe(true);
  });
});
