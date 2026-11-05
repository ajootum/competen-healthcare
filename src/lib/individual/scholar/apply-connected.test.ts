import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLearnedSections, howStudied, parseDraw, pickConnected, poolFor, relatedness, sectionMatchesTopic, termsOfText, type LearnedSection, type RecordInput } from "./apply-context";
import { filterPractice, gapsOfDebrief, matchesPractice, parsePracticeFilters, practiceGlance, practiceStatus, type PracticeRow } from "./practice-library";
import { CASE_INTEGRATED_SUFFIX, integratedCaseLine } from "./generation";
import { caseBlueprintLabels } from "./store";

const TODAY = "2026-11-05";
const materials = [{ id: "m1", title: "Critical care notes" }, { id: "m2", title: "Handover lecture" }, { id: "m3", title: "Uploaded, never opened" }, { id: "paper", title: "Exam paper" }];
const base: RecordInput = { materials, questions: [], attempts: [], cards: [], lessons: [], caseGaps: [], concepts: new Map(), competencies: new Map() };
const sec = (over: Partial<LearnedSection> & { chunkId: string }): LearnedSection => ({ materialId: "m1", materialTitle: "Critical care notes", concepts: [], competencyIds: [], signals: [{ kind: "lesson", day: "2026-11-01" }], gap: false, lastDay: "2026-11-01", ...over });

describe("what counts as studied", () => {
  it("never counts an uploaded section with no record of learning", () => {
    expect(buildLearnedSections(base)).toEqual([]);
    const s = buildLearnedSections({ ...base, lessons: [{ chunkId: "c1", materialId: "m1", day: "2026-11-01" }] });
    expect(s.map(x => x.materialId)).toEqual(["m1"]);
    expect(s.some(x => x.materialId === "m3")).toBe(false);
  });
  it("gathers lessons, answers and flashcard reviews across materials", () => {
    const s = buildLearnedSections({
      ...base, questions: [{ id: "q1", chunkId: "c2", materialId: "m2" }, { id: "q2", chunkId: "c3", materialId: "m1" }],
      lessons: [{ chunkId: "c1", materialId: "m1", day: "2026-10-30" }],
      attempts: [{ questionId: "q1", correct: true, day: "2026-11-03", at: "2026-11-03T10:00:00Z" }],
      cards: [{ questionId: "q2", day: "2026-11-04", lastQuality: 4 }],
    });
    expect(s.map(x => x.chunkId)).toEqual(["c3", "c2", "c1"]);
    expect(new Set(s.map(x => x.materialId))).toEqual(new Set(["m1", "m2"]));
    expect(s.every(x => !x.gap)).toBe(true);
  });
  it("marks a gap from the latest answer only, a forgotten card, or a case", () => {
    const q = [{ id: "q1", chunkId: "c1", materialId: "m1" }, { id: "q2", chunkId: "c2", materialId: "m1" }, { id: "q3", chunkId: "c3", materialId: "m1" }];
    const s = buildLearnedSections({
      ...base, questions: q,
      attempts: [{ questionId: "q1", correct: false, day: "2026-11-01", at: "2026-11-01T10:00:00Z" }, { questionId: "q1", correct: true, day: "2026-11-02", at: "2026-11-02T10:00:00Z" }, { questionId: "q2", correct: false, day: "2026-11-02", at: "2026-11-02T10:00:00Z" }],
      cards: [{ questionId: "q3", day: "2026-11-02", lastQuality: 1 }],
    });
    expect(Object.fromEntries(s.map(x => [x.chunkId, x.gap]))).toEqual({ c1: false, c2: true, c3: true });
  });
  it("leaves out a prepared examination paper, which is questions and not notes", () => {
    const s = buildLearnedSections({ ...base, excludedMaterials: new Set(["paper"]), lessons: [{ chunkId: "c1", materialId: "paper", day: TODAY }] });
    expect(s).toEqual([]);
  });
  it("leaves out a section whose material has gone", () => {
    expect(buildLearnedSections({ ...base, lessons: [{ chunkId: "c1", materialId: "gone", day: TODAY }] })).toEqual([]);
  });
  it("says how the record shows it was met, and says when it does not", () => {
    expect(howStudied({ signals: [{ kind: "lesson", day: "2026-11-01" }] })).toBe("Studied in a lesson, 1 Nov");
    expect(howStudied({ signals: [{ kind: "lesson", day: "2026-11-02" }, { kind: "missed", day: "2026-11-01" }] })).toBe("Missed in revision, 1 Nov");
    expect(howStudied({ signals: [] })).toBe("In your materials, not studied yet");
  });
});

describe("connecting what was studied", () => {
  const a = sec({ chunkId: "a", concepts: ["Respiratory assessment", "Deterioration", "Escalation"], competencyIds: ["k1"], gap: true, lastDay: "2026-11-04" });
  const b = sec({ chunkId: "b", materialId: "m2", materialTitle: "Handover lecture", concepts: ["SBAR escalation of deterioration"] });
  const c = sec({ chunkId: "c", concepts: ["Hand hygiene"] });
  const d = sec({ chunkId: "d", materialId: "m2", materialTitle: "Handover lecture", concepts: ["Documentation"], competencyIds: ["k1"] });
  it("joins by shared concepts and competencies, competencies counting more", () => {
    expect(relatedness(a, b)).toBe(2);
    expect(relatedness(a, c)).toBe(0);
    expect(relatedness(a, d)).toBe(2);
  });
  it("starts from a gap and reaches across materials, leaving out what is unrelated", () => {
    const p = pickConnected([c, b, a, d], { today: TODAY })!;
    expect(p.chunkIds[0]).toBe("a");
    expect(p.chunkIds).toEqual(expect.arrayContaining(["b", "d"]));
    expect(p.chunkIds).not.toContain("c");
    expect(p.materials).toBe(2);
    expect(p.hasGap).toBe(true);
    expect(p.why).toContain("across 2 of your materials");
    expect(p.why).toContain("missed earlier");
  });
  it("names the competencies a case combines", () => {
    expect(pickConnected([a, d], { today: TODAY })!.competencyIds).toEqual(["k1"]);
  });
  it("uses the learner's priority to choose where to start", () => {
    const x = sec({ chunkId: "x", concepts: ["Sepsis recognition"], lastDay: "2026-11-01" });
    const y = sec({ chunkId: "y", concepts: ["Hand hygiene"], lastDay: "2026-11-01" });
    expect(pickConnected([y, x], { today: TODAY, priorities: ["Sepsis recognition"] })!.chunkIds[0]).toBe("x");
  });
  it("does not offer a section with no patient in it, however recently it was missed", () => {
    const qi = sec({ chunkId: "qi", gap: true, lastDay: TODAY, suited: false, concepts: ["Quality improvement"] });
    const care = sec({ chunkId: "care", suited: true, concepts: ["Hygiene care"] });
    expect(poolFor([qi, care], { from: "all", topic: null }, { today: TODAY, priorities: [] }).map(s => s.chunkId)).toEqual(["care"]);
    expect(poolFor([qi], { from: "gaps", topic: null }, { today: TODAY, priorities: [] })).toEqual([]);
  });
  it("leads with a section that can carry a case, ahead of a more recent gap that cannot", () => {
    const thin = sec({ chunkId: "thin", gap: true, lastDay: TODAY, suited: true, caseReady: false });
    const full = sec({ chunkId: "full", lastDay: "2026-10-01", suited: true, caseReady: true });
    expect(pickConnected([thin, full], { today: TODAY })!.chunkIds[0]).toBe("full");
  });
  it("relates sections by what their text says where the analysis has no concepts", () => {
    const x = sec({ chunkId: "x", materialId: "m1", terms: termsOfText("Oxygen saturation falling. Oxygen therapy, oxygen delivery, escalate saturation. Respiratory rate rising, respiratory distress.") });
    const y = sec({ chunkId: "y", materialId: "m2", terms: termsOfText("Respiratory distress with falling oxygen saturation needs escalation. Respiratory rate and oxygen again.") });
    const z = sec({ chunkId: "z", materialId: "m2", terms: termsOfText("Hygiene measures and pressure area checks during the morning bath, moving slowly with dignity.") });
    expect(relatedness(x, y)).toBeGreaterThan(0);
    expect(relatedness(x, z)).toBe(0);
    expect(pickConnected([x, y, z], { today: TODAY })!.chunkIds).toEqual(["x", "y"]);
  });
  it("lets a related section with no patient of its own join a case, but never lead one", () => {
    const lead = sec({ chunkId: "lead", caseReady: true, suited: true, concepts: ["Deterioration"], competencyIds: ["k9"] });
    const handover = sec({ chunkId: "handover", materialId: "m2", materialTitle: "Handover lecture", suited: false, gap: true, lastDay: TODAY, concepts: ["Handover of deterioration"], competencyIds: ["k9"] });
    const pool = poolFor([lead, handover], { from: "all", topic: null }, { today: TODAY, priorities: [] });
    expect(pool.map(s => s.chunkId)).toEqual(["lead"]);
    expect(pickConnected(pool, { today: TODAY, companions: [lead, handover] })!.chunkIds).toEqual(["lead", "handover"]);
  });
  it("gives nothing rather than something invented", () => {
    expect(pickConnected([], { today: TODAY })).toBeNull();
  });
  it("draws from what was chosen, within what was studied", () => {
    const old = sec({ chunkId: "old", lastDay: "2026-08-01", concepts: ["Sepsis recognition"] });
    const o = { today: TODAY, priorities: ["Sepsis recognition"] };
    expect(poolFor([a, old], { from: "recent", topic: null }, o).map(s => s.chunkId)).toEqual(["a"]);
    expect(poolFor([a, old], { from: "gaps", topic: null }, o).map(s => s.chunkId)).toEqual(["a"]);
    expect(poolFor([a, old], { from: "plan", topic: null }, o).map(s => s.chunkId)).toEqual(["old"]);
    expect(poolFor([a, old], { from: "all", topic: null }, o)).toHaveLength(2);
    expect(poolFor([a, old], { from: "plan", topic: "Respiratory assessment" }, o).map(s => s.chunkId)).toEqual(["a"]);
  });
  it("matches a topic by its words, not by any one common word", () => {
    expect(sectionMatchesTopic({ concepts: ["Recognition of clinical deterioration"], materialTitle: "x" }, "Recognition of deterioration")).toBe(true);
    expect(sectionMatchesTopic({ concepts: ["Hand hygiene"], materialTitle: "Patient care" }, "Patient care")).toBe(false);
  });
  it("reads any choice safely, defaulting to all previous learning", () => {
    expect(parseDraw(undefined)).toMatchObject({ from: "all", topic: null });
    expect(parseDraw({ from: "gaps" }).from).toBe("gaps");
    expect(parseDraw({ from: "everyone", sessionId: "nope", materialIds: ["x"] })).toMatchObject({ from: "all", sessionId: null, materialIds: [] });
  });
  it("is the existing engine, told to integrate, with the passages still the only source", () => {
    const line = integratedCaseLine(["SBAR", "Deterioration"]);
    expect(line).toContain("ONE patient");
    expect(line).toContain("Every fact still comes only from the passages");
    expect(line).toContain("recognise, interpret, prioritise, decide, communicate and reassess");
    expect(CASE_INTEGRATED_SUFFIX).toBe("+connected-v1");
  });
});

const row = (over: Partial<PracticeRow> & { key: string }): PracticeRow => ({ format: "case", title: "T", href: "/x", replayCaseId: null, createdAt: "2026-11-01T10:00:00Z", lastAt: "2026-11-01T10:00:00Z", status: "completed", attempts: [], concepts: [], competencies: [], sources: [], gaps: [], revise: null, reviewLabel: "", ...over });

describe("My Practice Library", () => {
  const rows = [
    row({ key: "a", title: "A child in distress", concepts: ["Respiratory assessment"], competencies: ["Escalation"], sources: ["Critical care notes"], gaps: ["Reassessment"], status: "needs_review", lastAt: "2026-11-04T10:00:00Z" }),
    row({ key: "b", format: "osce", title: "Station one", status: "in_progress" }),
    row({ key: "c", format: "paper", title: "Paper 2025", status: "not_started", lastAt: "2026-09-01T10:00:00Z" }),
  ];
  const f = (p: Record<string, string> = {}) => filterPractice(rows, parsePracticeFilters(p)).rows.map(r => r.key);
  it("finds by title, topic, competency, source and gap", () => {
    expect(f({ q: "child" })).toEqual(["a"]);
    expect(f({ q: "respiratory" })).toEqual(["a"]);
    expect(f({ q: "escalation" })).toEqual(["a"]);
    expect(f({ q: "critical care" })).toEqual(["a"]);
    expect(f({ q: "reassessment" })).toEqual(["a"]);
    expect(f({ q: "nothing like this" })).toEqual([]);
    expect(matchesPractice(rows[0], "CHILD distress")).toBe(true);
  });
  it("filters by format, status, date and learning gap", () => {
    expect(f({ format: "osce" })).toEqual(["b"]);
    expect(f({ status: "needs_review" })).toEqual(["a"]);
    expect(f({ from: "2026-10-01" })).toEqual(["a", "b"]);
    expect(f({ gap: "1" })).toEqual(["a"]);
    expect(f()).toEqual(["a", "b", "c"]);
  });
  it("reads a finished debrief's gaps, and never a wrong answer's text", () => {
    expect(gapsOfDebrief({ missedFindings: [{ label: "Respiratory rate" }], safetyEvents: ["Did not escalate"], dimensions: [{ dimension: "prioritise", answered: 2, correct: 1 }, { dimension: "recognise", answered: 1, correct: 1 }] })).toEqual(["Respiratory rate", "Did not escalate", "Reasoning: prioritise"]);
    expect(gapsOfDebrief(null)).toEqual([]);
  });
  it("tells where a stored activity stands from its attempts", () => {
    expect(practiceStatus([], [])).toBe("not_started");
    expect(practiceStatus([{ status: "active" }, { status: "completed" }], ["x"])).toBe("in_progress");
    expect(practiceStatus([{ status: "completed" }], ["x"])).toBe("needs_review");
    expect(practiceStatus([{ status: "completed" }], [])).toBe("completed");
  });
  it("counts from the rows", () => {
    expect(practiceGlance([row({ key: "x", attempts: [{ id: "1", href: "/", status: "completed", startedAt: "", finishedAt: null, note: null }], gaps: ["g", "h"] }), row({ key: "y", gaps: ["g"] })])).toEqual({ saved: 2, attempts: 1, revisit: 2 });
  });
  it("searches what a case is about, never how it unfolds or its answers", () => {
    const labels = caseBlueprintLabels({ learningObjectives: [{ text: "Recognise deterioration" }], differentials: [{ label: "Sepsis", reasoning: "SECRET" }], patient: { presentingComplaint: "Breathless" }, expectedReasoning: "SECRET", decisionPoints: [{ prompt: "SECRET" }] });
    expect(labels).toEqual(["Recognise deterioration", "Sepsis", "Breathless"]);
  });
});

describe("the route and its boundaries", () => {
  const route = readFileSync("src/app/api/individual/scholar/clinical/cases/route.ts", "utf8");
  const del = readFileSync("src/app/api/individual/scholar/materials/[id]/route.ts", "utf8");
  const data = readFileSync("src/lib/individual/scholar/apply-context-data.ts", "utf8");
  const store = readFileSync("src/lib/individual/scholar/store.ts", "utf8");
  it("runs the one existing engine and its checks", () => {
    expect(route).toContain("await runCaseBlueprint(");
    expect(route.match(/runCaseBlueprint\(/g)).toHaveLength(1);
    expect(route).toContain('entry === "connected" ? "notes" : entry');
  });
  it("still keeps its readiness, repeat and reuse checks before any AI for a connected case", () => {
    const at = (s: string) => route.indexOf(s);
    expect(at("storedPrivateCase(")).toBeLessThan(at("await runCaseBlueprint("));
    expect(at("caseReadiness(")).toBeLessThan(at("await runCaseBlueprint("));
    expect(at("await aiPreflight(ctx)")).toBeLessThan(at("await runCaseBlueprint("));
  });
  it("reads no AI to list or pick anything", () => {
    expect(data).not.toMatch(/scholarAiRunner|runCaseBlueprint|generate\(/);
  });
  it("never publishes: nothing here offers a case to a shared catalogue", () => {
    expect(data).not.toMatch(/offerCase|createCandidate|case_candidate/);
  });
  it("removes a case drawing on a deleted material, whichever material it is filed under", () => {
    expect(del).toContain("casesDrawingOn(ctx.admin, ctx.userId, id)");
    expect(del).toContain("deletePrivateCases(ctx.admin, ctx.userId, drawing)");
    expect(del.indexOf("casesDrawingOn(ctx.admin")).toBeLessThan(del.indexOf("deleteMaterial(ctx.admin"));
    expect(store).toContain('materialId ? casesDrawingOn(admin, userId, materialId)');
  });
  it("keys every new read on the caller", () => {
    for (const name of ["learnedStepRows", "reviewedCardRows", "chunkConceptRows", "practiceCaseRows", "casesDrawingOn", "deletePrivateCases"]) {
      const body = store.slice(store.indexOf(`export async function ${name}`), store.indexOf(`export async function ${name}`) + 900);
      expect(body).toContain('.eq("user_id", userId)');
    }
  });
});
