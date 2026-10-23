import { describe, expect, it } from "vitest";
import { outcomesFrom, type CatalogueCompetency } from "./catalogue";
import { checkAnalysis, conceptInSection, mapStates, primaryCompetency, shortlist, MAX_PROPOSALS_PER_SECTION, type AnalysisSection } from "./mapping";
import {
  checkCaseTitle, checkSupplementary, explainPromptVersion, explainSystem, parseCase, splitSupplementary, CASE_FALLBACK_TITLE, EXPLAIN_SYSTEM, type Passage,
} from "./generation";
import { buildCompetencyProgress } from "./competency-progress";

// COMPETEN-SCHOLAR-01 S2-S4: competency proposals, explanation modes, multi-step cases, progress by competency.

const RESP = "Respiratory assessment includes respiratory rate, oxygen saturation and the use of accessory muscles. Wheeze suggests narrowed airways. Position the patient upright to ease breathing.";
const SECTIONS: AnalysisSection[] = [{ chunkId: "k1", content: RESP }, { chunkId: "k2", content: "Hand hygiene before and after patient contact prevents cross infection." }];

const comp = (id: string, layer: CatalogueCompetency["layer"], title: string, outcomes: string[] = []): CatalogueCompetency => ({
  id, layer, profession: "Nursing", catalogue: "Test", frameworkId: "f", domain: "D", code: null, title, outcomes,
});
const COMPS = [
  comp("u-anat", "foundational", "Respiratory anatomy and physiology"),
  comp("u-assess", "profession", "Respiratory assessment", ["Measures respiratory rate"]),
  comp("u-ipc", "profession", "Infection prevention and control"),
];

describe("concepts and proposed competency mappings", () => {
  it("maps tags back to the catalogue's own ids, several per section, sorted by confidence", () => {
    const raw = JSON.stringify([
      { section: "S1", concepts: ["respiratory rate", "accessory muscles"], competencies: [
        { tag: "C1", confidence: 0.6, rationale: "It describes breathing." },
        { tag: "C2", confidence: 0.92, rationale: "It lists what respiratory assessment includes." },
      ] },
      { section: "S2", concepts: ["hand hygiene"], competencies: [{ tag: "C3", confidence: 0.9, rationale: "Hand hygiene prevents cross infection." }] },
    ]);
    const r = checkAnalysis(raw, SECTIONS, COMPS);
    expect(r.dropped).toEqual([]);
    expect(r.sections[0]).toEqual({
      chunkId: "k1", concepts: ["respiratory rate", "accessory muscles"],
      proposals: [
        { competencyId: "u-assess", layer: "profession", confidence: 0.92, rationale: "It lists what respiratory assessment includes." },
        { competencyId: "u-anat", layer: "foundational", confidence: 0.6, rationale: "It describes breathing." },
      ],
    });
    expect(r.sections[1].proposals.map(p => p.competencyId)).toEqual(["u-ipc"]);
  });

  it("drops an unknown tag, a raw uuid, an unknown section, a weak proposal and a concept the notes do not mention", () => {
    const raw = JSON.stringify([
      { section: "S1", concepts: ["peak flow"], competencies: [
        { tag: "C9", confidence: 0.9 }, { tag: "3f1c0d2e-0000-4000-8000-000000000000", confidence: 0.9 }, { tag: "C2", confidence: 0.1 },
      ] },
      { section: "S7", concepts: [], competencies: [] },
    ]);
    const r = checkAnalysis(raw, SECTIONS, COMPS);
    expect(r.sections[0]).toEqual({ chunkId: "k1", concepts: [], proposals: [] });
    expect(r.dropped.map(d => d.reason).sort()).toEqual(["concept_not_in_section", "low_confidence", "unknown_competency", "unknown_competency", "unknown_section"]);
  });

  it("keeps a proposal but removes a rationale that adds a figure the section lacks", () => {
    const raw = JSON.stringify([{ section: "S1", concepts: [], competencies: [{ tag: "C2", confidence: 0.8, rationale: "A respiratory rate above 20 is raised." }] }]);
    const r = checkAnalysis(raw, SECTIONS, COMPS);
    expect(r.sections[0].proposals).toEqual([{ competencyId: "u-assess", layer: "profession", confidence: 0.8, rationale: null }]);
    expect(r.dropped.map(d => d.reason)).toEqual(["rationale_ungrounded"]);
  });

  it("caps proposals per section, and refuses a reply that is not JSON", () => {
    const many = Array.from({ length: 6 }, (_, i) => comp(`x${i}`, "profession", `Respiratory ${i}`));
    const raw = JSON.stringify([{ section: "S1", concepts: [], competencies: many.map((_, i) => ({ tag: `C${i + 1}`, confidence: 0.9 })) }]);
    expect(checkAnalysis(raw, SECTIONS, many).sections[0].proposals).toHaveLength(MAX_PROPOSALS_PER_SECTION);
    expect(checkAnalysis("I think C2.", SECTIONS, COMPS)).toEqual({ sections: [], dropped: [{ reason: "malformed" }] });
  });

  it("a concept is in the section when each of its words is, by prefix", () => {
    expect(conceptInSection("narrowed airway", RESP)).toBe(true);
    expect(conceptInSection("pulmonary embolism", RESP)).toBe(false);
  });

  it("shortlists a large catalogue by overlap with the text, keeping catalogue order", () => {
    const big = [...Array.from({ length: 70 }, (_, i) => comp(`z${i}`, "specialty", `Unrelated topic ${i}`)), comp("hit", "profession", "Accessory muscles of breathing")];
    const s = shortlist(SECTIONS, big, 5);
    expect(s).toHaveLength(5);
    expect(s.map(c => c.id)).toContain("hit");
  });

  it("the state of a mapping is its latest decision, and every decision is counted", () => {
    const states = mapStates([
      { mapId: "m1", decision: "accepted", decidedBy: "student", createdAt: "2026-10-01T10:00:00Z" },
      { mapId: "m1", decision: "rejected", decidedBy: "student", createdAt: "2026-10-02T10:00:00Z" },
      { mapId: "m2", decision: "accepted", decidedBy: "reviewer", createdAt: "2026-10-01T10:00:00Z" },
    ]);
    expect(states.get("m1")).toMatchObject({ state: "rejected", history: 2 });
    expect(states.get("m2")).toMatchObject({ state: "accepted", decidedBy: "reviewer", history: 1 });
    expect(states.get("m3")).toBeUndefined();
  });

  it("a question practises the accepted link first, then the strongest proposal, never a rejected one", () => {
    expect(primaryCompetency([
      { id: "a", competencyId: "c-prop", source: "ai", confidence: 0.95, state: "proposed" },
      { id: "b", competencyId: "c-acc", source: "ai", confidence: 0.4, state: "accepted" },
      { id: "c", competencyId: "c-rej", source: "ai", confidence: 0.99, state: "rejected" },
    ])).toBe("c-acc");
    expect(primaryCompetency([{ id: "c", competencyId: "c-rej", source: "ai", confidence: 0.99, state: "rejected" }])).toBeNull();
    expect(primaryCompetency([])).toBeNull();
  });

  it("outcomes come from the catalogue's own description, and none is invented", () => {
    expect(outcomesFrom("- Measures respiratory rate\n- Recognises wheeze")).toEqual(["Measures respiratory rate", "Recognises wheeze"]);
    expect(outcomesFrom(null)).toEqual([]);
  });
});

describe("explanation modes and what lies beyond the notes", () => {
  it("explain keeps the v2 prompt and version; every other mode adds to it and has its own version", () => {
    expect(explainSystem("explain")).toBe(EXPLAIN_SYSTEM);
    expect(explainPromptVersion("explain")).toBe("scholar-explain-v2");
    expect(explainSystem("summary").startsWith(EXPLAIN_SYSTEM)).toBe(true);
    expect(explainPromptVersion("tutor")).toBe("scholar-explain-modes-v1:tutor");
  });

  it("splits the background off the answer at the marker line", () => {
    expect(splitSupplementary("Answer [S1].\n\n**BEYOND THE NOTES:**\nAirways carry air to the lungs.")).toEqual({ main: "Answer [S1].", extra: "Airways carry air to the lungs." });
    expect(splitSupplementary("Answer [S1].")).toEqual({ main: "Answer [S1].", extra: null });
  });

  it("withholds background with a figure, a dose, a citation tag, or in a notes-only mode", () => {
    expect(checkSupplementary("Airways carry air to the lungs.", "deeper")).toEqual({ ok: true, text: "Airways carry air to the lungs." });
    expect(checkSupplementary("A normal rate is 12 to 20.", "deeper")).toEqual({ ok: false, reason: "figures" });
    expect(checkSupplementary("A typical salbutamol dose is given by inhaler.", "tutor")).toEqual({ ok: false, reason: "dosing" });
    expect(checkSupplementary("As your notes say [S1], airways narrow.", "deeper")).toEqual({ ok: false, reason: "citation" });
    expect(checkSupplementary("Airways carry air.", "summary")).toEqual({ ok: false, reason: "not_this_mode" });
  });
});

describe("multi-step practice cases", () => {
  const P: Passage = { chunkId: "k1", materialId: "m1", materialTitle: "Respiratory notes", ordinal: 1, pageFrom: 2, pageTo: 2, content: RESP };

  it("parses the case object, and refuses anything else", () => {
    expect(parseCase('```json\n{"title": "Wheeze", "steps": [{"stem": "x"}]}\n```')).toEqual({ title: "Wheeze", steps: [{ stem: "x" }] });
    expect(parseCase("[1, 2]")).toBeNull();
    expect(parseCase('{"title": "x"}')).toBeNull();
  });

  it("a title that adds a figure or an identifier becomes the neutral fallback", () => {
    expect(checkCaseTitle("A patient with wheeze", P)).toBe("A patient with wheeze");
    expect(checkCaseTitle("A 67 year old with wheeze", P)).toBe(CASE_FALLBACK_TITLE);
    expect(checkCaseTitle("NHS 943 476 5919 wheeze", P)).toBe(CASE_FALLBACK_TITLE);
  });
});

describe("progress by competency", () => {
  it("counts linked sections and latest-try accuracy, and leaves the unmeasured null", () => {
    const p = buildCompetencyProgress({
      competencies: COMPS,
      mappings: [
        { competencyId: "u-assess", chunkId: "k1", state: "accepted" },
        { competencyId: "u-anat", chunkId: "k1", state: "proposed" },
        { competencyId: "u-ipc", chunkId: "k2", state: "rejected" },
      ],
      questions: [{ id: "q1", competencyId: "u-assess" }, { id: "q2", competencyId: "u-assess" }, { id: "q3", competencyId: "gone" }, { id: "q4", competencyId: null }],
      attempts: [
        { questionId: "q1", correct: false, answeredAt: "2026-10-01T10:00:00Z" },
        { questionId: "q1", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
      ],
    });
    const rows = p.layers.flatMap(l => l.rows);
    expect(p.layers.map(l => l.layer)).toEqual(["foundational", "profession"]);
    expect(rows.find(r => r.id === "u-assess")).toMatchObject({ sectionsAccepted: 1, questions: 2, answered: 1, latestCorrect: 1, latestAccuracy: 100, status: "practising" });
    expect(rows.find(r => r.id === "u-anat")).toMatchObject({ sectionsProposed: 1, latestAccuracy: null, status: "notes_linked" });
    expect(rows.find(r => r.id === "u-ipc")).toMatchObject({ sectionsAccepted: 0, sectionsProposed: 0, latestAccuracy: null, status: "no_notes" });
    expect(p.totals).toEqual({ competencies: 3, withNotes: 2, practising: 1 });
    expect(p.outsideProgramme).toBe(1);
  });
});
