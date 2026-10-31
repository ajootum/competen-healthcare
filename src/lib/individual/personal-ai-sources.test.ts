import { describe, expect, it } from "vitest";
import { citedSources, dropUnknownTags, numberPassages, STUDY_MATERIAL_CAP } from "./personal-ai-sources";

const p = (title: string, content: string, over: Record<string, unknown> = {}) => ({ materialTitle: title, ordinal: 1, pageFrom: 3, pageTo: 3, content, ...over });

describe("numbered study passages (Learn-step Personal AI)", () => {
  it("numbers each section [S1]..[Sn] with its citation, in order", () => {
    const n = numberPassages([p("Renal notes", "Nephrotic syndrome is heavy proteinuria."), p("Deck", "Nephritic is haematuria.", { unit: "slide", pageFrom: 4, pageTo: 4 })]);
    expect(n.text).toBe("[S1] (Renal notes, page 3)\nNephrotic syndrome is heavy proteinuria.\n\n[S2] (Deck, slide 4)\nNephritic is haematuria.");
    expect(n.sources).toEqual([
      { tag: "S1", materialTitle: "Renal notes", citation: "Renal notes, page 3" },
      { tag: "S2", materialTitle: "Deck", citation: "Deck, slide 4" },
    ]);
  });
  it("keeps the 6000-character cap but gives every section its tag and some text", () => {
    const n = numberPassages([p("A", "a".repeat(9000)), p("B", "b".repeat(9000)), p("C", "c".repeat(9000))]);
    expect(n.text.length).toBeLessThanOrEqual(STUDY_MATERIAL_CAP);
    for (const t of ["[S1]", "[S2]", "[S3]"]) expect(n.text).toContain(t);
    expect(n.text).toContain("c");
  });
  it("a short section does not starve the others of room it did not use", () => {
    const n = numberPassages([p("A", "short"), p("B", "b".repeat(9000))]);
    expect(n.text.length).toBeGreaterThan(5000);
  });
  it("lists only the notes an answer cites, and drops tags that name no note", () => {
    const s = numberPassages([p("A", "x"), p("B", "y")]).sources;
    expect(citedSources("Uses it [S2] and again [S2].", s).map(x => x.tag)).toEqual(["S2"]);
    expect(citedSources("No tags.", s)).toEqual([]);
    expect(dropUnknownTags("Real [S1] and invented [S7] and [S0].", 2)).toBe("Real [S1] and invented and.");
  });
});
