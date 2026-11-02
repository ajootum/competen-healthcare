import { describe, expect, it } from "vitest";
import { PDF_MIME, PPTX_MIME } from "./config";
import {
  FILTERED_SEARCH_READ, NO_SCOPE, SECTION_FIRST, SECTION_PAGE, chunkAllowed, filterChips, groupHits, hasLibraryFilters, itemActions, itemAllowed, locationLabel,
  markExcerpt, materialsOf, noteAttachedTo, noteDatesLabel, originalLink, ownedQuery, pageFiltered, practisePath, reviseCardsPath, sectionHits,
  type FilterScope, type MaterialName, type SectionRow,
} from "./library-organise";
import { parseLibraryQuery, snippetParts } from "./saved-library";

// SCHOLAR-CE-2026 CE-02: result grouping and merging, filter parsing and scoping, section hits, links, note provenance.

const M1 = "11111111-1111-4111-8111-111111111111", M2 = "22222222-2222-4222-8222-222222222222", FOREIGN = "99999999-9999-4999-8999-999999999999";
const S1 = "33333333-3333-4333-8333-333333333333", S2 = "44444444-4444-4444-8444-444444444444";
const C1 = "55555555-5555-4555-8555-555555555551", C2 = "55555555-5555-4555-8555-555555555552", C3 = "55555555-5555-4555-8555-555555555553";
const A1 = "66666666-6666-4666-8666-666666666661", A2 = "66666666-6666-4666-8666-666666666662", COMP = "77777777-7777-4777-8777-777777777777";

const scope = (over: Partial<FilterScope> = {}): FilterScope => ({ ...NO_SCOPE, ...over });
const ref = (o: Partial<{ materialId: string | null; sessionId: string | null; artefactId: string | null; chunkId: string | null }> = {}) => ({ materialId: null, sessionId: null, artefactId: null, chunkId: null, ...o });

describe("CE-02 filter parsing (URL-driven)", () => {
  it("reads material, topic, session and competency, and drops anything malformed", () => {
    const q = parseLibraryQuery({ material: M1, topic: " Cardiac   output ", session: S1.toUpperCase(), competency: COMP, msec: "3" });
    expect(q).toMatchObject({ material: M1, topic: "Cardiac output", session: S1, competency: COMP, msec: 3 });
    expect(parseLibraryQuery({ session: "nope", material: "x", competency: "y", msec: "0" })).toMatchObject({ session: null, material: null, competency: null, msec: 1 });
    expect(parseLibraryQuery({ msec: "21" }).msec).toBe(1);
    expect(parseLibraryQuery({}).view).toBe("recent");
    expect(parseLibraryQuery({ view: "notes" }).view).toBe("notes");
  });
  it("detects active filters", () => {
    expect(hasLibraryFilters(parseLibraryQuery({}))).toBe(false);
    expect(hasLibraryFilters(parseLibraryQuery({ session: S1 }))).toBe(true);
  });
});

describe("CE-02 ownership: ids the learner does not own are dropped", () => {
  const owned = { materialIds: new Set([M1]), sessionIds: new Set([S1]), competencyIds: new Set([COMP]) };
  it("keeps their own and drops another learner's material, session and competency", () => {
    expect(ownedQuery(parseLibraryQuery({ material: M1, session: S1, competency: COMP }), owned)).toMatchObject({ material: M1, session: S1, competency: COMP });
    expect(ownedQuery(parseLibraryQuery({ material: FOREIGN, session: FOREIGN, competency: FOREIGN }), owned)).toMatchObject({ material: null, session: null, competency: null });
  });
  it("drops a competency when no catalogue was read for it, never keeps it", () => {
    expect(ownedQuery(parseLibraryQuery({ competency: COMP }), { ...owned, competencyIds: new Set() }).competency).toBeNull();
  });
  it("leaves a topic alone (it is only matched against their own sections)", () => {
    expect(ownedQuery(parseLibraryQuery({ topic: "Sepsis" }), owned).topic).toBe("Sepsis");
  });
});

describe("CE-02 active filter chips", () => {
  const names = { materials: new Map([[M1, "Cardiac notes"]]), sessions: new Map([[S1, "Heart failure · 1 Nov 2026"]]), competencies: new Map([[COMP, "Recognise deterioration"]]) };
  it("lists each active filter in a fixed order with its name", () => {
    const chips = filterChips(parseLibraryQuery({ competency: COMP, topic: "Sepsis", session: S1, material: M1 }), names);
    expect(chips.map(c => c.key)).toEqual(["material", "topic", "session", "competency"]);
    expect(chips[0]).toEqual({ key: "material", label: "Material", text: "Cardiac notes" });
    expect(chips[2].text).toBe("Heart failure · 1 Nov 2026");
  });
  it("shows a neutral name for an id it has no name for, and no chips when there are no filters", () => {
    expect(filterChips(parseLibraryQuery({ material: M2 }), names)[0].text).toBe("Chosen material");
    expect(filterChips(parseLibraryQuery({}), names)).toEqual([]);
  });
});

describe("CE-02 item and section filters", () => {
  it("passes everything when no filter is active", () => {
    expect(itemAllowed(ref(), NO_SCOPE)).toBe(true);
    expect(chunkAllowed({ id: C1, materialId: M1 }, NO_SCOPE)).toBe(true);
  });
  it("material: an item's own material, else its saved lesson's, else its session's", () => {
    const s = scope({ material: M1, artefactMaterial: new Map([[A1, M1], [A2, M2]]), sessionMaterials: new Map([[S1, new Set([M1])], [S2, new Set([M2])]]) });
    expect(itemAllowed(ref({ materialId: M1 }), s)).toBe(true);
    expect(itemAllowed(ref({ materialId: M2 }), s)).toBe(false);
    expect(itemAllowed(ref({ artefactId: A1 }), s)).toBe(true);
    expect(itemAllowed(ref({ artefactId: A2 }), s)).toBe(false);
    expect(itemAllowed(ref({ sessionId: S1 }), s)).toBe(true);
    expect(itemAllowed(ref({ sessionId: S2 }), s)).toBe(false);
    expect(itemAllowed(ref(), s)).toBe(false);
    expect(materialsOf(ref({ sessionId: S1 }), s)).toEqual([M1]);
  });
  it("session: its own notes and sessions, its saved lessons, its sections", () => {
    const s = scope({ session: S1, sessionArtefacts: new Set([A1]), sessionChunks: new Set([C1]) });
    expect(itemAllowed(ref({ sessionId: S1 }), s)).toBe(true);
    expect(itemAllowed(ref({ artefactId: A1 }), s)).toBe(true);
    expect(itemAllowed(ref({ chunkId: C1 }), s)).toBe(true);
    expect(itemAllowed(ref({ sessionId: S2, artefactId: A2, chunkId: C2 }), s)).toBe(false);
    expect(chunkAllowed({ id: C1, materialId: M1 }, s)).toBe(true);
    expect(chunkAllowed({ id: C2, materialId: M1 }, s)).toBe(false);
  });
  it("topic / competency: items on the allowed sections, or built on them", () => {
    const s = scope({ chunkSet: new Set([C1]), chunkArtefacts: new Set([A1]) });
    expect(itemAllowed(ref({ chunkId: C1 }), s)).toBe(true);
    expect(itemAllowed(ref({ artefactId: A1 }), s)).toBe(true);
    expect(itemAllowed(ref({ chunkId: C2 }), s)).toBe(false);
    expect(itemAllowed(ref({ sessionId: S1 }), s)).toBe(false);
    expect(chunkAllowed({ id: C2, materialId: M1 }, s)).toBe(false);
  });
  it("combines filters: an item must pass every one", () => {
    const s = scope({ material: M1, chunkSet: new Set([C1]), chunkArtefacts: new Set() });
    expect(itemAllowed(ref({ materialId: M1, chunkId: C1 }), s)).toBe(true);
    expect(itemAllowed(ref({ materialId: M2, chunkId: C1 }), s)).toBe(false);
    expect(itemAllowed(ref({ materialId: M1, chunkId: C2 }), s)).toBe(false);
  });
});

describe("CE-02 result grouping and merging", () => {
  const hit = (kind: "artefact" | "note" | "lesson" | "flashcard" | "card_note", id: string) => ({ kind, id });
  it("groups by what a hit is in a fixed order, keeping the search's own order inside each group", () => {
    const groups = groupHits([hit("flashcard", "f1"), hit("note", "n1"), hit("artefact", "a1"), hit("lesson", "s1"), hit("card_note", "n2"), hit("artefact", "a2")]);
    expect(groups.map(g => g.key)).toEqual(["lessons", "notes", "cards", "sessions"]);
    expect(groups[0].hits.map(h => h.id)).toEqual(["a1", "a2"]);
    expect(groups[1].hits.map(h => h.id)).toEqual(["n1", "n2"]);
    expect(groups[0].label).toBe("Saved lessons");
  });
  it("leaves empty groups out and handles no hits", () => {
    expect(groupHits([])).toEqual([]);
    expect(groupHits([hit("flashcard", "f")]).map(g => g.key)).toEqual(["cards"]);
  });
  it("filters a wide read and pages it, with the exact filtered total", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({ n: i }));
    const even = pageFiltered(rows, r => r.n % 2 === 0, 2, 10);
    expect(even.total).toBe(30);
    expect(even.items.map(r => r.n)).toEqual([20, 22, 24, 26, 28, 30, 32, 34, 36, 38]);
    expect(pageFiltered(rows, () => false, 1, 10)).toEqual({ items: [], total: 0 });
    expect(FILTERED_SEARCH_READ).toBe(200);
  });
});

describe("CE-02 From your materials", () => {
  const text = "The preload of the heart is the stretch of the ventricle before it contracts. Afterload is the resistance it pumps against.";
  const rows: SectionRow[] = [
    { id: C1, materialId: M1, ordinal: 1, pageFrom: 4, pageTo: 4, content: text },
    { id: C2, materialId: M2, ordinal: 2, pageFrom: 7, pageTo: 8, content: "Preload and afterload again, on a PDF." },
    { id: C3, materialId: M1, ordinal: 3, pageFrom: null, pageTo: null, content: "A section with no page." },
  ];
  const names = new Map<string, MaterialName>([[M1, { title: "Cardiac slides", mime: PPTX_MIME, unit: "slide" }], [M2, { title: "Physiology text", mime: PDF_MIME, unit: "page" }]]);

  it("names the location from the section's own citation fields", () => {
    expect(locationLabel(rows[0], "slide")).toBe("Slide 4");
    expect(locationLabel(rows[1], "page")).toBe("Pages 7-8");
    expect(locationLabel(rows[2], "section")).toBe("Section 3");
  });
  it("marks the matching words in a short excerpt, as text markers and never HTML", () => {
    const parts = snippetParts(markExcerpt(text, "preload"));
    expect(parts.some(p => p.mark && /^preload$/i.test(p.text))).toBe(true);
    expect(markExcerpt("a <b>bold</b> {{hl}}x{{/hl}} preload", "preload")).not.toMatch(/\{\{hl\}\}x/);
    expect(markExcerpt("Nothing here", "").length).toBeGreaterThan(0);
  });
  it("shapes hits with material, location, excerpt and the three actions", () => {
    const r = sectionHits(rows, "preload", names, NO_SCOPE, 1);
    expect(r.total).toBe(3);
    const first = r.hits[0];
    expect(first).toMatchObject({ chunkId: C1, materialTitle: "Cardiac slides", location: "Slide 4" });
    expect(first.openInLearn).toBe(`study/learn?section=${C1}`);
    expect(first.original).toEqual({ href: `/api/individual/scholar/materials/${M1}/slides?slide=4`, label: "View original slide 4", newTab: true });
    expect(first.sourceHref).toBe(`study/${M1}#c-${C1}`);
    expect(r.hits[1].original?.href).toBe(`/api/individual/scholar/materials/${M2}#page=7`);
    expect(r.hits[2].original).toBeNull();
  });
  it("shows 10 first and 10 more on each next page, saying when more remain", () => {
    const many: SectionRow[] = Array.from({ length: 35 }, (_, i) => ({ id: `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`, materialId: M1, ordinal: i + 1, pageFrom: i + 1, pageTo: i + 1, content: "preload" }));
    expect(sectionHits(many, "preload", names, NO_SCOPE, 1)).toMatchObject({ total: 35, more: true });
    expect(sectionHits(many, "preload", names, NO_SCOPE, 1).hits).toHaveLength(SECTION_FIRST);
    expect(sectionHits(many, "preload", names, NO_SCOPE, 2).hits).toHaveLength(SECTION_FIRST + SECTION_PAGE);
    const last = sectionHits(many, "preload", names, NO_SCOPE, 4);
    expect(last.hits).toHaveLength(35);
    expect(last.more).toBe(false);
  });
  it("applies the filters to sections: material, session and topic/competency sections", () => {
    expect(sectionHits(rows, "preload", names, scope({ material: M2 }), 1).hits.map(h => h.chunkId)).toEqual([C2]);
    expect(sectionHits(rows, "preload", names, scope({ session: S1, sessionChunks: new Set([C3]) }), 1).hits.map(h => h.chunkId)).toEqual([C3]);
    expect(sectionHits(rows, "preload", names, scope({ chunkSet: new Set() }), 1).hits).toEqual([]);
  });
  it("falls back to a neutral material name when a section's material is not in the list", () => {
    expect(sectionHits(rows, "preload", new Map(), NO_SCOPE, 1).hits[0].materialTitle).toBe("Your material");
  });
});

describe("CE-02 actions from a saved item", () => {
  it("builds Revise (flashcards, scoped to the section), Practise and Open source", () => {
    expect(itemActions({ materialId: M1, chunkId: C1 })).toEqual([
      { key: "revise", label: "Revise (flashcards)", path: `study/revise/flashcards?material=${M1}&section=${C1}` },
      { key: "practise", label: "Practise (in Learn)", path: `study/learn?section=${C1}` },
      { key: "source", label: "Open source", path: `study/${M1}#c-${C1}` },
    ]);
  });
  it("falls back to the whole material when there is no section, and to nothing when there is neither", () => {
    expect(itemActions({ materialId: M1, chunkId: null }).map(a => a.path)).toEqual([`study/revise/flashcards?material=${M1}`, `study/revise?material=${M1}`, `study/${M1}`]);
    expect(itemActions({ materialId: null, chunkId: null })).toEqual([]);
    expect(practisePath(null, C1)).toBe(`study/learn?section=${C1}`);
    expect(reviseCardsPath(M1, null)).toBe(`study/revise/flashcards?material=${M1}`);
  });
  it("links the original page or slide only where the file keeps pages", () => {
    expect(originalLink(M1, PDF_MIME, 3, "page")).toMatchObject({ href: `/api/individual/scholar/materials/${M1}#page=3`, label: "View original page 3" });
    expect(originalLink(M1, PPTX_MIME, 3, "slide")?.label).toBe("View original slide 3");
    expect(originalLink(M1, "text/plain", 3, "section")).toBeNull();
    expect(originalLink(M1, PDF_MIME, null, "page")).toBeNull();
    expect(originalLink("not-an-id", PDF_MIME, 3, "page")).toBeNull();
    expect(originalLink(M1, PDF_MIME, 0, "page")).toBeNull();
  });
});

describe("CE-02 note provenance", () => {
  it("shows when a note was written, and edited only when it changed on a later day", () => {
    expect(noteDatesLabel("2026-11-02T09:00:00Z", "2026-11-02T09:00:00Z")).toBe("Written 2 Nov 2026");
    expect(noteDatesLabel("2026-11-02T09:00:00Z", "2026-11-02T18:00:00Z")).toBe("Written 2 Nov 2026");
    expect(noteDatesLabel("2026-11-02T09:00:00Z", "2026-11-05T08:00:00Z")).toBe("Written 2 Nov 2026 · edited 5 Nov 2026");
    expect(noteDatesLabel("2026-11-02T09:00:00Z")).toBe("Written 2 Nov 2026");
    expect(noteDatesLabel("2026-11-02T09:00:00Z", "garbage")).toBe("Written 2 Nov 2026");
  });
  it("says what a note is attached to", () => {
    expect(noteAttachedTo({ targetKind: "artefact", lessonTitle: "Preload", materialTitle: "Cardiac" })).toBe("Saved lesson: Preload (Cardiac)");
    expect(noteAttachedTo({ targetKind: "lesson", sessionTitle: "Heart failure", step: 2, location: "Slide 4" })).toBe("Heart failure · Lesson 3 · Slide 4");
    expect(noteAttachedTo({ targetKind: "material", materialTitle: "Cardiac" })).toBe("Material: Cardiac");
    expect(noteAttachedTo({ targetKind: "section", materialTitle: "Cardiac", location: "Slide 4" })).toBe("Cardiac, Slide 4");
    expect(noteAttachedTo({ targetKind: "material" })).toBe("Material: your material");
  });
});
