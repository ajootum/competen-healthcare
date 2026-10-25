import { describe, expect, it } from "vitest";
import { resolvePolicy } from "../policy";
import {
  aiCompetencyQuestion, parseAiMappings, parseEntry, parseEvidenceLink, parseEvidenceType, parseSelfAssessment, reassessDue, suggestEvidence, type OfferedLike, type ScaleLevel,
} from "./competency-form";
import { parseShareCompetencies } from "./share-competency";

// COMPETEN-PROFESSIONAL-COMPETENCY-01 (Stage 5): the pure rules.

const policy = resolvePolicy([]).professionalCompetency;
const ecg: OfferedLike = { competencyId: "11111111-1111-4111-8111-111111111111", title: "ECG interpretation", description: null, layer: "advanced",
  catalogue: { id: "22222222-2222-4222-8222-222222222222", version: "1.2.0" }, outcomes: ["Identify sinus rhythm", "Recognise atrial fibrillation"] };
const levels: ScaleLevel[] = [
  { id: "33333333-3333-4333-8333-333333333331", scaleId: "s", scaleLabel: "Platform scale", score: 2, label: "Developing" },
  { id: "33333333-3333-4333-8333-333333333333", scaleId: "s", scaleLabel: "Platform scale", score: 4, label: "Competent with support" },
];

describe("My Competencies (C1)", () => {
  it("adds an offered catalogue competency with its version and layer group", () => {
    const r = parseEntry({ competencyId: ecg.competencyId }, policy, [ecg]);
    expect(r.ok && r.value).toMatchObject({ kind: "catalogue", framework_version: "v1.2.0", title: "ECG interpretation", category_code: "specialty" });
  });
  it("refuses a competency that is not offered, and works without a catalogue in the person's own words", () => {
    expect(parseEntry({ competencyId: "44444444-4444-4444-8444-444444444444" }, policy, [ecg]).ok).toBe(false);
    const own = parseEntry({ title: "Respiratory assessment", category: "quality" }, policy, []);
    expect(own.ok && own.value).toMatchObject({ kind: "personal", framework_id: null, category_label: "Quality and safety" });
    expect(parseEntry({ title: "Respiratory assessment" }, { ...policy, personal: "off" }, []).ok).toBe(false);
  });
});

describe("self-assessment (C2): self-reported, never judged by evidence", () => {
  const ctx = { levels, outcomes: ecg.outcomes, frameworkVersion: "v1.2.0", policy };
  it("takes a level from the CFCA scale, an outcome, confidence and a private reflection", () => {
    const r = parseSelfAssessment({ levelId: levels[1].id, outcome: "Identify sinus rhythm", confidence: "fairly-sure", reflection: "Rate first", interest: "true" }, ctx);
    expect(r.ok && r.value).toMatchObject({ level_label: "Competent with support", level_score: 4, learning_outcome: "Identify sinus rhythm", confidence_label: "Fairly sure", development_interest: true, framework_version: "v1.2.0" });
  });
  it("accepts any level whatever evidence exists: nothing here reads evidence", () => {
    expect(parseSelfAssessment({ levelId: levels[1].id }, ctx).ok).toBe(true);
  });
  it("refuses a level off the scale, an outcome not the competency's, and a verified claim has no field to go in", () => {
    expect(parseSelfAssessment({ levelId: "not-a-level" }, ctx).ok).toBe(false);
    expect(parseSelfAssessment({ levelId: levels[0].id, outcome: "Invented outcome" }, ctx).ok).toBe(false);
    const r = parseSelfAssessment({ levelId: levels[0].id, basis: "verified", verified: true }, ctx);
    expect(r.ok && Object.keys(r.value).some(k => /verif|basis/.test(k))).toBe(false);
  });
  it("says plainly when no scale is configured", () => {
    expect(parseSelfAssessment({ levelId: levels[0].id }, { ...ctx, levels: [] }).ok).toBe(false);
  });
  it("suggests reassessment after the configured interval only", () => {
    expect(reassessDue("2026-01-01T00:00:00Z", "2026-10-25", 180)).toBe(true);
    expect(reassessDue("2026-10-01T00:00:00Z", "2026-10-25", 180)).toBe(false);
    expect(reassessDue(null, "2026-10-25", 180)).toBe(false);
  });
});

describe("evidence (C3, C4)", () => {
  it("links one record to an outcome with a configured relation", () => {
    const r = parseEvidenceLink({ sourcePick: "cpd:55555555-5555-4555-8555-555555555555", outcome: "Recognise atrial fibrillation", relation: "application" }, { outcomes: ecg.outcomes, policy });
    expect(r.ok && r.value).toMatchObject({ kind: "cpd", learning_outcome: "Recognise atrial fibrillation", relation_label: "Application" });
  });
  it("refuses an unknown kind, an outcome of another competency, and an unknown relation", () => {
    expect(parseEvidenceLink({ kind: "assessment", sourceId: "55555555-5555-4555-8555-555555555555", relation: "knowledge" }, { outcomes: [], policy }).ok).toBe(false);
    expect(parseEvidenceLink({ kind: "cpd", sourceId: "55555555-5555-4555-8555-555555555555", outcome: "x", relation: "knowledge" }, { outcomes: ecg.outcomes, policy }).ok).toBe(false);
    expect(parseEvidenceLink({ kind: "cpd", sourceId: "55555555-5555-4555-8555-555555555555", relation: "certified" }, { outcomes: [], policy }).ok).toBe(false);
  });
  it("types additional evidence in the same record", () => {
    const r = parseEvidenceType({ evidenceType: "observation", author: "A senior colleague" }, policy);
    expect(r.ok && r.value).toEqual({ evidence_type_code: "observation", evidence_type_label: "Practical observation", author_name: "A senior colleague" });
    expect(parseEvidenceType({ evidenceType: "verified-competence" }, policy).ok).toBe(false);
  });
  it("suggests records by shared words, deterministically", () => {
    expect(suggestEvidence("Recognise atrial fibrillation", [{ title: "Atrial fibrillation workshop" }, { title: "Wound care" }]).map(i => i.title)).toEqual(["Atrial fibrillation workshop"]);
  });
});

describe("AI help: asked for, parsed, never trusted blindly", () => {
  it("forbids verification, invention and judgements of competence, and fits the gateway", () => {
    const q = aiCompetencyQuestion("map", ecg, [{ title: "ECG workshop" }]);
    expect(q).toMatch(/never describe anything as verified/);
    expect(q.length).toBeLessThanOrEqual(650);
  });
  it("keeps only in-range, known-relation mappings", () => {
    const a = "- E1 :: O2 :: application :: ok\n- E9 :: O1 :: knowledge :: out of range\n- E1 :: none :: certified :: bad relation\n- E1 :: none :: knowledge :: whole";
    expect(parseAiMappings(a, 1, 2, policy.relations.map(r => r.code))).toEqual([
      { item: 0, outcome: 1, relation: "application", basis: "ok" }, { item: 0, outcome: null, relation: "knowledge", basis: "whole" },
    ]);
  });
});

describe("Passport selection (S11)", () => {
  it("reads only ticked, known parts per entry", () => {
    const id = "66666666-6666-4666-8666-666666666666";
    expect(parseShareCompetencies({ [`competency:${id}:self_assessment`]: "true", [`competency:${id}:evidence`]: "true", [`competency:${id}:reflection`]: "true", [`competency:${id}:assessed_outcomes`]: "false" }))
      .toEqual([{ myCompetencyId: id, parts: ["self_assessment", "evidence"] }]);
  });
});
