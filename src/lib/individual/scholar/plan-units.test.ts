import { describe, expect, it } from "vitest";
import {
  COMPLEXITY_FACTOR, IMAGE_SLIDE_MINUTES, MAX_UNITS, PRACTICE_MAX, PRACTICE_MIN, READ_WPM, REVISION_REVIEWS, THIN_CHARS,
  citeUnit, estimateBasis, estimateUnit, mergeUnits, parseStoredUnits, pictureOnlyWithin, plannedOrder, rangesOf, splitUnit, storedOrdinals,
  textFacts, titleFromParts, toStored, toggleExcluded, togglePriority, unitCount, unitFrom, unitSections, unitTotals, type UnitSection,
} from "./plan-units";
import { buildUnits, commonStems } from "./plan-units-build";
import { sectionProfile } from "./learn";
import { acceptedUnstarted, buildProposal, type MaterialIn } from "./plan-proposal";
import { buildStudyPlan, unstartedHref, unstartedReason } from "./study-plan";

// ── a deck like the owner's: chapters of slides under shared headings, thin picture slides, picture-only slides ──
const line = (heading: string, words: number, long = false) => `${heading}\n${Array.from({ length: words }, (_, i) => (long && i % 3 === 0 ? "mobilisation" : "the patient")).join(" ")}.`;
const DECK: { slide: number; text: string }[] = [
  { slide: 1, text: "Essential Nursing Care" },                                     // thin title slide
  { slide: 2, text: line("Objectives", 40) },
  { slide: 3, text: line("Eye Care", 70) }, { slide: 4, text: line("Eye Care Assessment", 60) }, { slide: 5, text: "Eye Care Assessment" }, // 5: thin, carries on
  { slide: 6, text: line("Eye Care Essential Care", 80) },
  // slide 7 is picture-only (no section)
  { slide: 8, text: line("Oral Care", 70) }, { slide: 9, text: line("Oral Care Assessment", 60) }, { slide: 10, text: line("Oral Care Essential Care", 80) },
  { slide: 11, text: line("Infection Control", 90, true) }, { slide: 12, text: line("Infection Control Standard Precautions", 90, true) }, { slide: 13, text: line("Infection Control Surveillance", 80, true) },
];
const EMPTY = [7];
const sections = DECK.map((d, i) => ({ chunkId: `c${i + 1}`, ordinal: i + 1, pageFrom: d.slide, pageTo: d.slide, topics: [] as string[] }));
const profiles = new Map(DECK.map((d, i) => [`c${i + 1}`, sectionProfile(d.text)]));
const input = { materialId: "m1", title: "Essential Nursing Care", unit: "slide" as const, sections, profiles, quality: { emptyUnits: EMPTY, aiReadUnits: [12] } };

describe("the facts of a section's text", () => {
  it("counts words, long words and numbers, the speaker-notes marker aside", () => {
    expect(textFacts("Eye care\nApply 0.9% saline every 12-hours, lagophthalmos is common.\n\nSpeaker notes:\nsay it slowly")).toEqual({ words: 13, longWords: 1, numeric: 2 });
  });
  it("profiles each section: sparse under THIN_CHARS, AI-read from the quality record, unread without a profile", () => {
    const parts = unitSections({ ...input, sections: [...sections, { chunkId: "c99", ordinal: 99, pageFrom: 40, pageTo: 40, topics: [] }] });
    expect(parts[0]).toMatchObject({ chunkId: "c1", page: 1, sparse: true, aiRead: false, heading: "Essential Nursing Care" });
    expect(parts.find(p => p.chunkId === "c11")).toMatchObject({ page: 12, aiRead: true, sparse: false });
    expect(parts.find(p => p.chunkId === "c99")).toMatchObject({ chars: null, words: 100, heading: null });
    expect(THIN_CHARS).toBe(160);
  });
});

describe("the estimate of one unit", () => {
  const part = (words: number, extra: Partial<UnitSection> = {}): UnitSection => ({ chunkId: "x", ordinal: 1, page: 1, heading: null, topics: [], chars: words * 6, words, longWords: 0, numeric: 0, sparse: false, aiRead: false, started: false, ...extra });
  it("reads at READ_WPM, adds IMAGE_SLIDE_MINUTES per image-based slide, revises REVISION_REVIEWS times and practises per section within the bounds", () => {
    const e = estimateUnit([part(300), part(300), part(10, { sparse: true })], 1);
    expect(e.reading).toBe(Math.ceil(610 / READ_WPM + 2 * IMAGE_SLIDE_MINUTES));   // 2 image-based: the sparse one and the picture-only slide
    expect(e.complexity).toBe("plain");
    expect(e.learning).toBe(Math.ceil(e.reading * COMPLEXITY_FACTOR.plain));
    expect(e.revision).toBe(REVISION_REVIEWS * Math.max(3, Math.round(e.reading * 0.25)));
    expect(e.practice).toBe(Math.min(PRACTICE_MAX, Math.max(PRACTICE_MIN, 2 * 3)));
    expect(e.total).toBe(e.reading + e.learning + e.revision + e.practice);
    expect(e.imageSlides).toBe(2);
  });
  it("dense text (long words, numbers) multiplies the learning time, never the reading", () => {
    const plain = estimateUnit([part(300)], 0), dense = estimateUnit([part(300, { longWords: 90, numeric: 30 })], 0);
    expect(dense.complexity).toBe("dense");
    expect(dense.reading).toBe(plain.reading);
    expect(dense.learning).toBe(Math.ceil(plain.reading * COMPLEXITY_FACTOR.dense));
  });
  it("a unit whose text could not be read is sized at the fallback and says how many", () => {
    expect(estimateUnit([part(100, { chars: null })], 0).unread).toBe(1);
  });
  it("never goes below two minutes of reading or five of practice", () => {
    expect(estimateUnit([part(3)], 0)).toMatchObject({ reading: 2, practice: PRACTICE_MIN });
  });
});

describe("building the units from the material's own headings", () => {
  const units = buildUnits(input);
  it("groups every section into contiguous units in document order, one per chapter here, thin slides joining their chapter", () => {
    expect(units.map(u => u.parts.map(p => p.ordinal))).toEqual([[1, 2, 3, 4, 5, 6], [7, 8, 9], [10, 11, 12]]);
    expect(units.flatMap(u => u.parts).length).toBe(sections.length);
    expect(units.map(u => u.id)).toEqual(["u1", "u2", "u3"]);
  });
  it("titles a unit by its lesson title and lists what it covers, and cites where it is in the notes", () => {
    expect(units[0].title).toMatch(/eye care/i);
    expect(units[0].cite).toBe("slides 1-6");
    expect(units[1].title).toMatch(/oral care/i);
    expect(units[1].covers.join(" ")).toMatch(/assessment|essential/i);
    expect(units[2].cite).toBe("slides 11-13");
  });
  it("a picture-only slide inside a unit's span is counted with it (the learner still looks at it)", () => {
    expect(pictureOnlyWithin(units[1].parts, EMPTY)).toEqual([]);                  // 7 lies before slide 8, outside the span
    expect(pictureOnlyWithin([...units[0].parts, ...units[1].parts], EMPTY)).toEqual([7]);
    expect(units.map(u => u.estimate.imageSlides)).toEqual([2, 0, 1]);              // the title slide and slide 5 are sparse, slide 12 was AI-read
  });
  it("ignores the heading word most headings share, so 'care' does not glue chapters together", () => {
    expect([...commonStems(unitSections(input))]).toEqual(["care"]);
  });
  it("counts about one unit per UNIT_TARGET_CHARS, at least enough for the caps, at most MAX_UNITS", () => {
    expect(unitCount(unitSections(input))).toBeGreaterThanOrEqual(2);
    const many = Array.from({ length: 600 }, (_, i) => ({ chunkId: `c${i}`, ordinal: i + 1, page: 1, heading: null, topics: [], chars: 600, words: 100, longWords: 0, numeric: 0, sparse: false, aiRead: false, started: false }));
    expect(unitCount(many)).toBe(MAX_UNITS);
  });
  it("with no sections there are no units", () => {
    expect(buildUnits({ ...input, sections: [] })).toEqual([]);
  });
});

describe("the learner's review", () => {
  const units = buildUnits(input);
  const ctx = { unit: "slide" as const, emptyUnits: EMPTY };
  it("merge joins a unit with the next, re-titled from the parts and re-estimated, ids renumbered", () => {
    const m = mergeUnits(units, 0, ctx);
    expect(m.map(u => u.parts.length)).toEqual([9, 3]);
    expect(m[0].title).toMatch(/^Eye care.* and Oral care/i);
    expect(m[0].estimate.total).toBeGreaterThan(units[0].estimate.total);
    expect(m[0].estimate.imageSlides).toBe(3);                                       // the picture-only slide 7 now lies inside
    expect(m.map(u => u.id)).toEqual(["u1", "u2"]);
    expect(mergeUnits(units, 2, ctx)).toHaveLength(3);                               // the last has no next
  });
  it("split cuts a unit before a section, both halves keeping its flags", () => {
    const flagged = togglePriority(units, 0);
    const s = splitUnit(flagged, 0, 4, ctx);
    expect(s.map(u => u.parts.map(p => p.ordinal))).toEqual([[1, 2, 3], [4, 5, 6], [7, 8, 9], [10, 11, 12]]);
    expect(s[0].priority && s[1].priority).toBe(true);
    expect(s[1].cite).toBe("slides 4-6");
    expect(splitUnit(units, 0, 1, ctx)).toHaveLength(3);                             // nothing before the first section
    expect(splitUnit(units, 0, 99, ctx)).toHaveLength(3);
  });
  it("leave out and put first are exclusive, and the totals count only what is planned", () => {
    const x = toggleExcluded(togglePriority(units, 1), 1);
    expect(x[1]).toMatchObject({ excluded: true, priority: false });
    const t = unitTotals(x);
    expect(t).toMatchObject({ units: 3, planned: 2, excluded: 1, sections: 9 });
    expect(t.total).toBe(x[0].estimate.total + x[2].estimate.total);
    expect(toggleExcluded(x, 1)[1].excluded).toBe(false);
    expect(togglePriority(x, 1)[1]).toMatchObject({ excluded: false, priority: true });
  });
  it("the planned order puts the units marked first before the rest, each in document order", () => {
    expect(plannedOrder(togglePriority(toggleExcluded(units, 0), 2)).map(u => u.id)).toEqual(["u3", "u2"]);
  });
  it("the basis says how each figure is made and what could not be read", () => {
    const b = estimateBasis(unitTotals(units), { unread: 2, imageSlides: 3, unit: "slide" });
    expect(b.join("\n")).toMatch(/150 words a minute/);
    expect(b.join("\n")).toMatch(/3 short reviews/);
    expect(b.join("\n")).toMatch(/2 sections could not be read/);
    expect(b[b.length - 1]).toMatch(/approximate/);
  });
  it("a unit from parts with no usable heading is titled by where it is", () => {
    const bare = unitFrom("u9", [{ chunkId: "z", ordinal: 7, page: 9, heading: "Objectives", topics: [], chars: 500, words: 80, longWords: 0, numeric: 0, sparse: false, aiRead: false, started: false }], ctx);
    expect(bare.title).toBe("Slide 9");
    expect(titleFromParts([{ ...bare.parts[0], heading: null, topics: ["Sepsis"] }], "page").title).toBe("Sepsis");
    expect(citeUnit([{ ...bare.parts[0], page: null }], "slide")).toBe("section 7");
  });
});

describe("what is stored with the acceptance", () => {
  const units = buildUnits(input);
  it("round-trips titles, ordinal ranges, flags and minutes within the event limits", () => {
    const stored = toStored(toggleExcluded(togglePriority(units, 0), 2));
    expect(stored).toEqual([
      { t: units[0].title.slice(0, 60), o: [[1, 6]], p: 1, m: units[0].estimate.total },
      { t: units[1].title.slice(0, 60), o: [[7, 9]], m: units[1].estimate.total },
      { t: units[2].title.slice(0, 60), o: [[10, 12]], x: 1, m: units[2].estimate.total },
    ]);
    expect(parseStoredUnits({ units: stored }, new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toEqual(stored);
    expect(storedOrdinals(stored[0])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rangesOf([...units[0].parts, ...units[2].parts])).toEqual([[1, 6], [10, 12]]);
    expect(Buffer.byteLength(JSON.stringify({ units: toStored(Array.from({ length: MAX_UNITS }, () => units[0])) }))).toBeLessThan(8000);
  });
  it("refuses a wrong shape: overlaps, ordinals not of the material, bad flags, too many", () => {
    expect(parseStoredUnits(null)).toBeNull();
    expect(parseStoredUnits({ units: [] })).toBeNull();
    expect(parseStoredUnits({ units: [{ t: "A", o: [[1, 3]] }, { t: "B", o: [[3, 4]] }] })).toBeNull();
    expect(parseStoredUnits({ units: [{ t: "A", o: [[1, 3]] }] }, new Set([1, 2]))).toBeNull();
    expect(parseStoredUnits({ units: [{ t: "A", o: [[3, 1]] }] })).toBeNull();
    expect(parseStoredUnits({ units: [{ t: "A", o: [[1, 1]], x: true }] })).toBeNull();
    expect(parseStoredUnits({ units: [{ t: "", o: [[1, 1]] }] })).toBeNull();
    expect(parseStoredUnits({ units: Array.from({ length: MAX_UNITS + 1 }, (_, i) => ({ t: "A", o: [[i + 1, i + 1]] })) })).toBeNull();
    expect(parseStoredUnits({ units: [{ t: " A ", o: [[2, 2], [4, 5]], p: 1, m: 30 }] })).toEqual([{ t: "A", o: [[2, 2], [4, 5]], p: 1, m: 30 }]);
  });
});

describe("units in the proposal and the plan", () => {
  const units = buildUnits(input);
  const material: MaterialIn = { materialId: "m1", title: "Essential Nursing Care", unit: "slide", sections: sections.map(s => ({ ...s, topics: [], started: false })) };
  it("a proposal with units estimates from them, apart, and states the basis", () => {
    const p = buildProposal({ material, earlier: [], settings: null, sectionMinutes: 12, firstPlan: true, units });
    expect(p.units).toHaveLength(3);
    expect(p.totals?.total).toBe(units.reduce((t, u) => t + u.estimate.total, 0));
    expect(p.workloadMinutes).toBe(p.totals!.total);
    expect(p.summary).toMatch(/12 sections grouped into 3 learning units, about .* in all \(reading .*, learning .*, revision .*, practice .*\)/);
    expect(p.basis.length).toBeGreaterThan(3);
    expect(p.unit).toBe("slide");
  });
  it("without units (text not read) the proposal keeps sections x minutes and says why", () => {
    const p = buildProposal({ material, earlier: [], settings: null, sectionMinutes: 12, firstPlan: true, units: null });
    expect(p.units).toBeNull();
    expect(p.workloadMinutes).toBe(12 * 12);
    expect(p.basis[0]).toMatch(/12 minutes a section/);
  });
  it("an accepted material with stored units feeds the plan one entry per kept unit, the ones put first before the rest, opening every section of the unit", () => {
    const stored = toStored(toggleExcluded(togglePriority(units, 2), 1));
    const u = acceptedUnstarted([{ ...material, units: stored }], []);
    expect(u.map(x => x.label)).toEqual([units[2].title.slice(0, 60), units[0].title.slice(0, 60)]);
    expect(u[0]).toMatchObject({ kind: "unit", chunkId: "c10", chunkIds: ["c10", "c11", "c12"], sections: 3, minutes: units[2].estimate.total, materialIds: ["m1"] });
    expect(unstartedHref(u[0])).toBe("/individual/scholar/study/learn?s=c10&s=c11&s=c12");
    expect(unstartedReason(u[0])).toMatch(/learning unit of your notes \(3 sections, about \d+ minutes in all\) has no practice yet/);
  });
  it("a unit every section of which has practice is done, and a material accepted without units still feeds its sections", () => {
    const stored = toStored(units);
    const practised = { ...material, units: stored, sections: material.sections.map(s => ({ ...s, started: s.ordinal <= 6 })) };
    expect(acceptedUnstarted([practised], []).map(x => x.label)).toEqual([units[1].title.slice(0, 60), units[2].title.slice(0, 60)]);
    expect(acceptedUnstarted([material], []).every(x => x.kind === undefined)).toBe(true);
    expect(acceptedUnstarted([material], [])).toHaveLength(12);
  });
  it("the study plan schedules a unit as one Learn activity that opens all of it, and says units in its note", () => {
    const u = acceptedUnstarted([{ ...material, units: toStored(units) }], []);
    const r = buildStudyPlan({ plan: { examDate: null, examLabel: null, weeklyMinutes: 150, daysPerWeek: 5, goal: null, priorities: [] }, entries: [], dueCards: 0, unstarted: u, today: "2026-11-03" });
    const acts = r.thisWeek.flatMap(d => d.activities).filter(a => a.title.startsWith("Start on"));
    expect(acts.length).toBeGreaterThan(0);
    expect(acts[0].href).toMatch(/\?s=c1&s=c2/);
    expect(r.notes.join(" ")).toMatch(/3 learning units of your notes have no practice yet/);
  });
});
