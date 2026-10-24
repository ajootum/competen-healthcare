import { describe, expect, it } from "vitest";
import { applyContentFloor, normaliseStatus, projectForProgramme, structureLabel, type CatalogueCompetency, type ProgrammeConfig, type S1Competency } from "./catalogue";
import {
  checkCaseTitle, checkSupplementary, explainPromptVersion, explainSystem, modeUserPrompt, parseCase, splitSupplementary, CASE_FALLBACK_TITLE, EXPLAIN_SYSTEM, type Passage,
} from "./generation";
import { buildCompetencyProgress } from "./competency-progress";
import { PROMPT_VERSIONS } from "./config";
import { buildIntelligence } from "./intelligence";
import { buildLearnerContext, CONTEXT_PREAMBLE } from "./learner-context";
import { fromProgrammeCatalogue, type CompetencyRef } from "./competency-sources";
import { MAPPING_PROMPT_VERSION } from "@/lib/competency/mapping";

// COMPETEN-SCHOLAR-01 S2-S4: competency proposals, explanation modes, multi-step cases, progress by competency.

const RESP = "Respiratory assessment includes respiratory rate, oxygen saturation and the use of accessory muscles. Wheeze suggests narrowed airways. Position the patient upright to ease breathing.";

const comp = (id: string, layer: CatalogueCompetency["layer"], title: string, outcomes: string[] = []): CatalogueCompetency => ({
  id, layer, profession: "Nursing", catalogue: "Test", frameworkId: "f", domain: "D", code: null, title, outcomes, expectedLevel: null, practice: null, cpu: null, contentStatus: "unreviewed", statusNote: null,
});
const COMPS = [
  comp("u-anat", "foundational", "Respiratory anatomy and physiology"),
  comp("u-assess", "profession", "Respiratory assessment", ["Measures respiratory rate"]),
  comp("u-ipc", "profession", "Infection prevention and control"),
];

describe("the S1 catalogue, narrowed by a programme", () => {
  it("a programme narrows S1's Scholar catalogue and never widens it; S1's layer wins, the programme's fills a gap", () => {
    const s1 = (id: string, fw: string, layer: S1Competency["layer"]): S1Competency => ({
      competencyId: id, code: null, title: id, layer, profession: layer === "foundational" ? null : { label: "From S1" },
      catalogue: { id: fw, name: fw }, domain: { name: "D" }, outcomes: ["o"],
    });
    const programme: ProgrammeConfig = {
      code: "p", label: "P", profession: "From programme", country: null, level: null,
      frameworks: [{ frameworkId: "fw-prof", layer: "profession", sortOrder: 0 }, { frameworkId: "fw-found", layer: "profession", sortOrder: 1 }, { frameworkId: "fw-unclassified", layer: "specialty", sortOrder: 2 }],
    };
    const out = projectForProgramme([s1("a", "fw-prof", "profession"), s1("b", "fw-found", "foundational"), s1("c", "fw-other", "profession"), s1("d", "fw-unclassified", null)], programme);
    expect(out.map(c => c.id)).toEqual(["b", "a", "d"]);
    expect(out[0]).toMatchObject({ layer: "foundational", profession: "From programme", outcomes: ["o"] });
    expect(out[1]).toMatchObject({ layer: "profession", profession: "From S1" });
    expect(out[2].layer).toBe("specialty");
  });
});

describe("one computation: progress by competency agrees with S5 coverage, number for number", () => {
  it("each competency's answered and right-on-latest equal coverage's evidence and positive, over the same accepted links", () => {
    const mappings = [
      { competencyId: "u-assess", chunkId: "k1", state: "accepted" as const },
      { competencyId: "u-anat", chunkId: "k1", state: "proposed" as const },
      { competencyId: "u-ipc", chunkId: "k2", state: "accepted" as const },
    ];
    const questions = [
      { id: "q1", chunkId: "k1", competencyId: "u-assess" }, { id: "q2", chunkId: "k1", competencyId: "u-assess" },
      { id: "q3", chunkId: "k1", competencyId: "u-anat" }, { id: "q4", chunkId: "k2", competencyId: "u-ipc" },
    ];
    const attempts = [
      { questionId: "q1", correct: false, answeredAt: "2026-10-01T10:00:00Z" }, { questionId: "q1", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
      { questionId: "q2", correct: false, answeredAt: "2026-10-02T10:00:00Z" }, { questionId: "q3", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
      { questionId: "q4", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
    ];
    const mine = buildCompetencyProgress({ competencies: COMPS, mappings, questions, attempts });
    // What S5 reads: the accepted pairs only (store.acceptedQuestionCompetencies applies the same rule).
    const accepted = new Set(mappings.filter(m => m.state === "accepted").map(m => `${m.chunkId}|${m.competencyId}`));
    const li = buildIntelligence({
      materials: [{ id: "m1", title: "M" }], questions: questions.map(q => ({ id: q.id, materialId: "m1", kind: "mcq" as const })), attempts,
      cards: [], reviews: null, today: "2026-10-24", t: { minAnswers: 1, windowDays: 28 },
      catalogue: fromProgrammeCatalogue(COMPS).ok ? (fromProgrammeCatalogue(COMPS) as { value: CompetencyRef[] }).value : null,
      mappings: questions.filter(q => accepted.has(`${q.chunkId}|${q.competencyId}`)).map(q => ({ questionId: q.id, competencyId: q.competencyId })),
    });
    expect(li.coverage.state).toBe("measured");
    const cov = li.coverage as Extract<typeof li.coverage, { state: "measured" }>;
    for (const r of mine.layers.flatMap(l => l.rows)) {
      const c = cov.rows.find(x => x.id === r.id)!;
      expect([r.id, r.answered, r.latestCorrect ?? 0]).toEqual([r.id, c.evidence, c.positive]);
    }
    expect(cov.covered).toBe(mine.layers.flatMap(l => l.rows).filter(r => r.answered > 0).length);
  });
});

describe("provenance", () => {
  it("the map prompt version Scholar records is the Holdings engine's own", () => {
    expect(PROMPT_VERSIONS.map).toBe(MAPPING_PROMPT_VERSION);
  });
});

describe("explanation modes and what lies beyond the notes", () => {
  it("explain keeps the v2 prompt and version; every other mode adds to it and has its own version", () => {
    expect(explainSystem("explain")).toBe(EXPLAIN_SYSTEM);
    expect(explainPromptVersion("explain")).toBe("scholar-explain-v2");
    expect(explainSystem("summary").startsWith(EXPLAIN_SYSTEM)).toBe(true);
    expect(explainPromptVersion("tutor")).toBe("scholar-explain-modes-v5:tutor");
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
        { competencyId: "gone", chunkId: "k1", state: "accepted" },
      ],
      questions: [
        { id: "q1", chunkId: "k1", competencyId: "u-assess" }, { id: "q2", chunkId: "k1", competencyId: "u-assess" },
        { id: "q3", chunkId: "k1", competencyId: "gone" }, { id: "q4", chunkId: "k1", competencyId: null },
        // Practised through a link the person has not accepted (proposed) or has rejected: counts for nothing.
        { id: "q5", chunkId: "k1", competencyId: "u-anat" }, { id: "q6", chunkId: "k2", competencyId: "u-ipc" },
      ],
      attempts: [
        { questionId: "q1", correct: false, answeredAt: "2026-10-01T10:00:00Z" },
        { questionId: "q1", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
        { questionId: "q5", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
        { questionId: "q6", correct: true, answeredAt: "2026-10-02T10:00:00Z" },
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

describe("P1: the tutor's view of the student (learner-context.ts)", () => {
  const row = (title: string, status: "no_notes" | "notes_linked" | "practising", latestAccuracy: number | null) =>
    ({ id: title, layer: "profession" as const, catalogue: "C", domain: "D", code: null, title, structure: null, contentStatus: "unreviewed" as const, sectionsAccepted: 1, sectionsProposed: 0,
      questions: 1, answered: latestAccuracy === null ? 0 : 1, latestCorrect: latestAccuracy === null ? null : 1, latestAccuracy, status });

  it("is words only: programme, accepted links here, needs-practice and not-yet -- no figure or code survives", () => {
    const ctx = buildLearnerContext({
      programme: "Nursing (Uganda), diploma",
      passageCompetencies: [{ title: "Safe oxygen administration", structure: "Oxygen Therapy › CPU-OXYSAFE-001 Safe Oxygen Administration" }],
      progress: [row("Respiratory assessment", "practising", 40), row("Hand hygiene", "practising", 100), row("Oxygen titration", "notes_linked", null), row("Untouched", "no_notes", null)],
    })!;
    expect(ctx).toContain("I study: Nursing (Uganda), diploma.");
    expect(ctx).toContain("Safe oxygen administration (Oxygen Therapy › Safe Oxygen Administration)");
    expect(ctx).toContain("need more practice on: Respiratory assessment.");
    expect(ctx).toContain("not practised yet: Oxygen titration.");
    expect(ctx).not.toMatch(/\d|Hand hygiene|Untouched|CPU-/);
  });

  it("is nothing when there is nothing to say", () => {
    expect(buildLearnerContext({ programme: null, passageCompetencies: [], progress: null })).toBeNull();
  });

  it("goes ahead of the passages, framed as not-the-notes; other modes and the grounding never see it", () => {
    const P: Passage = { chunkId: "k1", materialId: "m1", materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: RESP };
    const u = modeUserPrompt("Teach me", [P], [], "I study: Nursing.");
    expect(u.startsWith(CONTEXT_PREAMBLE)).toBe(true);
    expect(u.indexOf("I study: Nursing.")).toBeLessThan(u.indexOf("PASSAGES FROM MY NOTES"));
    expect(modeUserPrompt("Teach me", [P], [])).not.toContain(CONTEXT_PREAMBLE);
  });
});

describe("P1: codes come out cleanly", () => {
  it("a CPU code is removed without leaving a gap inside the brackets", () => {
    expect(buildLearnerContext({ programme: null, progress: null, passageCompetencies: [{ title: "T", structure: "CPU-RESPASS-001 Systematic Respiratory Assessment" }] }))
      .toContain("T (Systematic Respiratory Assessment)");
  });
});

describe("content status: labelled, never hidden silently (owner ruling 2026-10-24)", () => {
  const programme: ProgrammeConfig = { code: "p", label: "P", profession: "X", country: null, level: null, frameworks: [{ frameworkId: "f", layer: "profession", sortOrder: 0 }] };
  const s1 = (id: string, contentStatus?: string): S1Competency => ({
    competencyId: id, code: null, title: id, layer: "profession", profession: null, catalogue: { id: "f", name: "F" }, domain: { name: "D" }, outcomes: [],
    practice: { code: "PRA-OXY-001", name: "Oxygen Therapy" }, cpu: { code: "CPU-OXYSAFE-001", name: "Safe Oxygen Administration" }, contentStatus, statusNote: contentStatus === "draft" ? "Awaiting review" : null,
  });

  it("the projection carries practice, CPU and status; an unknown or missing status is unreviewed, never approved", () => {
    const [a, b, c] = projectForProgramme([s1("a", "approved"), s1("b", "draft"), s1("c")], programme);
    expect(a).toMatchObject({ contentStatus: "approved", practice: { name: "Oxygen Therapy" }, cpu: { code: "CPU-OXYSAFE-001" } });
    expect(b).toMatchObject({ contentStatus: "draft", statusNote: "Awaiting review" });
    expect(c.contentStatus).toBe("unreviewed");
    expect(normaliseStatus("weird")).toBe("unreviewed");
    expect(structureLabel(a)).toBe("Oxygen Therapy › CPU-OXYSAFE-001 Safe Oxygen Administration");
  });

  it("the floor offers what meets it and COUNTS what it holds back", () => {
    const rows = projectForProgramme([s1("a", "approved"), s1("b", "draft"), s1("c", "unreviewed")], programme);
    expect(applyContentFloor(rows, "unreviewed")).toMatchObject({ belowFloor: 0 });
    expect(applyContentFloor(rows, "unreviewed").kept).toHaveLength(3);
    expect(applyContentFloor(rows, "draft").kept.map(r => r.id)).toEqual(["a", "b"]);
    expect(applyContentFloor(rows, "approved")).toMatchObject({ kept: [{ id: "a" }], belowFloor: 2 });
  });
});
