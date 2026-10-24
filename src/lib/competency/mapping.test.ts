import { describe, expect, it } from "vitest";
import {
  checkMappingReply, conceptInText, leadingCompetency, mappingStates, mappingSystem, shortlist, MAX_PROPOSALS_PER_SUBJECT,
  type MappingCandidate, type MappingSubject,
} from "./mapping";

// COMPETEN-HOLDINGS-SHARED-ENGINES-01: the shared competency-mapping engine (Scholar S2 first, Professional next).

const RESP = "Respiratory assessment includes respiratory rate, oxygen saturation and the use of accessory muscles. Wheeze suggests narrowed airways. Position the patient upright to ease breathing.";
const SECTIONS: MappingSubject[] = [{ ref: "k1", text: RESP }, { ref: "k2", text: "Hand hygiene before and after patient contact prevents cross infection." }];
const cand = (competencyId: string, layer: MappingCandidate["layer"], title: string, outcomes: string[] = []): MappingCandidate => ({ competencyId, layer, code: null, title, outcomes });
const COMPS = [
  cand("u-anat", "foundational", "Respiratory anatomy and physiology"),
  cand("u-assess", "profession", "Respiratory assessment", ["Measures respiratory rate"]),
  cand("u-ipc", "profession", "Infection prevention and control"),
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
    const r = checkMappingReply(raw, SECTIONS, COMPS);
    expect(r.dropped).toEqual([]);
    expect(r.subjects[0]).toEqual({
      ref: "k1", concepts: ["respiratory rate", "accessory muscles"],
      proposals: [
        { competencyId: "u-assess", layer: "profession", confidence: 0.92, rationale: "It lists what respiratory assessment includes." },
        { competencyId: "u-anat", layer: "foundational", confidence: 0.6, rationale: "It describes breathing." },
      ],
    });
    expect(r.subjects[1].proposals.map(p => p.competencyId)).toEqual(["u-ipc"]);
  });

  it("drops an unknown tag, a raw uuid, an unknown section, a weak proposal and a concept the notes do not mention", () => {
    const raw = JSON.stringify([
      { section: "S1", concepts: ["peak flow"], competencies: [
        { tag: "C9", confidence: 0.9 }, { tag: "3f1c0d2e-0000-4000-8000-000000000000", confidence: 0.9 }, { tag: "C2", confidence: 0.1 },
      ] },
      { section: "S7", concepts: [], competencies: [] },
    ]);
    const r = checkMappingReply(raw, SECTIONS, COMPS);
    expect(r.subjects[0]).toEqual({ ref: "k1", concepts: [], proposals: [] });
    expect(r.dropped.map(d => d.reason).sort()).toEqual(["concept_not_in_text", "low_confidence", "unknown_competency", "unknown_competency", "unknown_subject"]);
  });

  it("keeps a proposal but removes a rationale that adds a figure the section lacks", () => {
    const raw = JSON.stringify([{ section: "S1", concepts: [], competencies: [{ tag: "C2", confidence: 0.8, rationale: "A respiratory rate above 20 is raised." }] }]);
    const r = checkMappingReply(raw, SECTIONS, COMPS);
    expect(r.subjects[0].proposals).toEqual([{ competencyId: "u-assess", layer: "profession", confidence: 0.8, rationale: null }]);
    expect(r.dropped.map(d => d.reason)).toEqual(["rationale_ungrounded"]);
  });

  it("caps proposals per section, and refuses a reply that is not JSON", () => {
    const many = Array.from({ length: 6 }, (_, i) => cand(`x${i}`, "profession", `Respiratory ${i}`));
    const raw = JSON.stringify([{ section: "S1", concepts: [], competencies: many.map((_, i) => ({ tag: `C${i + 1}`, confidence: 0.9 })) }]);
    expect(checkMappingReply(raw, SECTIONS, many).subjects[0].proposals).toHaveLength(MAX_PROPOSALS_PER_SUBJECT);
    expect(checkMappingReply("I think C2.", SECTIONS, COMPS)).toEqual({ subjects: [], dropped: [{ reason: "malformed" }] });
  });

  it("a concept is in the section when each of its words is, by prefix", () => {
    expect(conceptInText("narrowed airway", RESP)).toBe(true);
    expect(conceptInText("pulmonary embolism", RESP)).toBe(false);
  });

  it("shortlists a large catalogue by overlap with the text, keeping catalogue order", () => {
    const big = [...Array.from({ length: 70 }, (_, i) => cand(`z${i}`, "specialty", `Unrelated topic ${i}`)), cand("hit", "profession", "Accessory muscles of breathing")];
    const s = shortlist(SECTIONS, big, 5);
    expect(s).toHaveLength(5);
    expect(s.map(c => c.competencyId)).toContain("hit");
  });

  it("the state of a mapping is its latest decision, and every decision is counted", () => {
    const states = mappingStates([
      { mappingId: "m1", decision: "accepted", decidedBy: "student", createdAt: "2026-10-01T10:00:00Z" },
      { mappingId: "m1", decision: "rejected", decidedBy: "student", createdAt: "2026-10-02T10:00:00Z" },
      { mappingId: "m2", decision: "accepted", decidedBy: "reviewer", createdAt: "2026-10-01T10:00:00Z" },
    ]);
    expect(states.get("m1")).toMatchObject({ state: "rejected", history: 2 });
    expect(states.get("m2")).toMatchObject({ state: "accepted", decidedBy: "reviewer", history: 1 });
    expect(states.get("m3")).toBeUndefined();
  });

  it("a question practises the accepted link first, then the strongest proposal, never a rejected one", () => {
    expect(leadingCompetency([
      { competencyId: "c-prop", byPerson: false, confidence: 0.95, state: "proposed" },
      { competencyId: "c-acc", byPerson: false, confidence: 0.4, state: "accepted" },
      { competencyId: "c-rej", byPerson: false, confidence: 0.99, state: "rejected" },
    ])).toBe("c-acc");
    expect(leadingCompetency([{ competencyId: "c-rej", byPerson: false, confidence: 0.99, state: "rejected" }])).toBeNull();
    expect(leadingCompetency([])).toBeNull();
  });

});

describe("the engine is product-neutral", () => {
  it("the framing comes from the caller, and the prompt names no product or profession of its own", () => {
    const sys = mappingSystem({ person: "a registered professional", subjects: "entries in their development record" });
    expect(sys).toContain("a registered professional");
    expect(sys).toContain("entries in their development record");
    expect(sys).not.toMatch(/scholar|professional record|nurs|student/i);
  });

  it("an identifier the caller's screen flags is dropped, and an unclassified catalogue keeps a null layer", () => {
    const raw = JSON.stringify([{ section: "S1", concepts: ["respiratory rate"], competencies: [{ tag: "C1", confidence: 0.7, rationale: "It covers respiratory rate." }] }]);
    const r = checkMappingReply(raw, SECTIONS, [cand("u-x", null, "Respiratory rate")], t => (/rate/.test(t) ? ["flag"] : []));
    expect(r.subjects[0].concepts).toEqual([]);
    expect(r.subjects[0].proposals).toEqual([{ competencyId: "u-x", layer: null, confidence: 0.7, rationale: null }]);
    expect(r.dropped.map(d => d.reason)).toEqual(["identifier", "identifier"]);
  });
});
