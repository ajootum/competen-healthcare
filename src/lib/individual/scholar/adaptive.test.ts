import { afterEach, describe, expect, it } from "vitest";
import {
  adaptationOutcomes, blueprintLimits, blueprintOf, blueprintScope, buildAdaptiveReport, cognitiveOf, deadlineOf, difficultyTrajectory, formatRotation,
  nextDifficulty, parseBlueprintRequest, selectNext, startingDifficulty, stopReason, type AdaptiveBlueprint, type Candidate, type ReportItem,
} from "./adaptive";
import { stateOutcomes } from "./adaptive-service";
import { ADAPTIVE_FALLBACK_NOTE, ADAPTIVE_FORMATS, ADAPTIVE_HELP, ADAPTIVE_REPORT_LABEL, ADAPTIVE_RULE } from "./config";
import { DEFAULT_POLICY, policyDef } from "../policy";
import { createAdaptiveSession, isAdaptiveScope, resetAdaptiveSchema } from "./store";
import { EXPERIENCES } from "../experiences";

// SCHOLAR-PRACTICE-EXAMS-01: Adaptive Exams. Transparent rule-based adaptation over the revision engine.

const T = true, F = false;
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("the rule (adaptDifficulty, the count starting again after each change)", () => {
  it("steps up after three right in a row, once, and needs three more for the next step", () => {
    expect(difficultyTrajectory("easy", [T, T, T])).toEqual(["easy", "easy", "easy", "standard"]);
    expect(difficultyTrajectory("easy", [T, T, T, T])).toEqual(["easy", "easy", "easy", "standard", "standard"]);
    expect(nextDifficulty("easy", [T, T, T, T, T, T])).toBe("harder");
    expect(nextDifficulty("harder", [T, T, T, T, T, T])).toBe("harder");
  });
  it("steps down after two of the last three missed", () => {
    expect(nextDifficulty("standard", [F, T, F])).toBe("easy");
    expect(nextDifficulty("standard", [F, F])).toBe("standard"); // fewer than three since the last change: unchanged
    expect(nextDifficulty("harder", [T, F, F])).toBe("standard");
    expect(nextDifficulty("easy", [F, F, F])).toBe("easy");
  });
  it("holds on one miss in three, and starts counting again after a change", () => {
    expect(nextDifficulty("standard", [T, F, T])).toBe("standard");
    // up after 1-3, then the window is 4-6 only: two of those three missed steps it down again
    expect(difficultyTrajectory("standard", [T, T, T, F, T, F])).toEqual(["standard", "standard", "standard", "harder", "harder", "harder", "standard"]);
  });
  it("an answer waiting for the student's own marking does not move it", () => {
    expect(nextDifficulty("standard", [T, null, T, null, T])).toBe("harder");
    expect(nextDifficulty("standard", [F, null, F])).toBe("standard");
  });
  it("the rule is stated in words, and is the rule applied", () => {
    expect(ADAPTIVE_RULE).toMatch(/Harder after 3 correct in a row; easier after 2 of the last 3 missed/);
  });
});

describe("the next question: library, then stored, then written, then nearest", () => {
  const c = (n: number, o: Partial<Candidate> = {}): Candidate => ({ id: id(n), kind: "mcq", difficulty: 2, library: false, createdAt: `2026-10-0${n % 9}T00:00:00Z`, lastAnsweredAt: null, ...o });
  it("takes a governed library question at the asked difficulty before a stored one", () => {
    const r = selectNext({ target: "standard", pool: [c(1), c(2, { library: true, difficulty: null })], exclude: new Set(), formats: ["mcq"], lastKind: null });
    expect(r.exact).toMatchObject({ id: id(2), from: "library", match: "exact", level: 2 });
  });
  it("then a stored question at that difficulty, never one already in the exam, nor a format the blueprint leaves out", () => {
    const pool = [c(1, { difficulty: 3 }), c(2, { difficulty: 3, kind: "short" }), c(3, { difficulty: 3, kind: "flashcard" }), c(4, { library: true })];
    const r = selectNext({ target: "harder", pool, exclude: new Set([id(1)]), formats: ["mcq", "short"], lastKind: null });
    expect(r.exact).toMatchObject({ id: id(2), from: "stored", match: "exact" });
  });
  it("prefers never-answered, then a different format from the last", () => {
    const pool = [c(1, { lastAnsweredAt: "2026-10-01" }), c(2, { kind: "mcq" }), c(3, { kind: "short" })];
    expect(selectNext({ target: "standard", pool, exclude: new Set(), formats: ["mcq", "short"], lastKind: "mcq" }).exact?.id).toBe(id(3));
    expect(selectNext({ target: "standard", pool, exclude: new Set(), formats: ["mcq", "short"], lastKind: "short" }).exact?.id).toBe(id(2));
  });
  it("with none at the difficulty, offers nothing exact (so new ones may be written) and keeps the nearest", () => {
    const r = selectNext({ target: "harder", pool: [c(1, { difficulty: 1 }), c(2, { difficulty: 2 }), c(3, { library: true, difficulty: null })], exclude: new Set(), formats: ["mcq"], lastKind: null });
    expect(r.exact).toBeNull();
    expect(r.nearest).toMatchObject({ id: id(3), from: "library", match: "nearest", level: 2 });
  });
  it("a question just written for the asked difficulty counts when the request allowed its difficulty", () => {
    const r = selectNext({ target: "harder", pool: [c(5, { difficulty: 2 })], exclude: new Set(), formats: ["mcq"], lastKind: null, fresh: new Set([id(5)]) });
    expect(r.exact).toMatchObject({ id: id(5), from: "generated", match: "range" });
    expect(selectNext({ target: "easy", pool: [c(6, { difficulty: 3 })], exclude: new Set(), formats: ["mcq"], lastKind: null, fresh: new Set([id(6)]) }).exact).toBeNull();
  });
  it("nothing left at all: no pick (the exam stops)", () => {
    expect(selectNext({ target: "standard", pool: [c(1)], exclude: new Set([id(1)]), formats: ["mcq"], lastKind: null })).toEqual({ exact: null, nearest: null });
  });
  it("writes in the formats after the last one first", () => {
    expect(formatRotation(["mcq", "short", "mrq"], "short")).toEqual(["mrq", "mcq", "short"]);
    expect(formatRotation(["mcq", "short"], null)).toEqual(["mcq", "short"]);
  });
});

describe("when it stops", () => {
  const startedAt = "2026-10-30T10:00:00.000Z";
  it("at its length", () => {
    expect(stopReason({ answered: 10, length: 10, startedAt, now: Date.parse(startedAt), timeLimitMinutes: null })).toBe("length");
    expect(stopReason({ answered: 9, length: 10, startedAt, now: Date.parse(startedAt) + 9e9, timeLimitMinutes: null })).toBeNull();
  });
  it("at its time limit", () => {
    expect(stopReason({ answered: 3, length: 10, startedAt, now: Date.parse(startedAt) + 20 * 60_000, timeLimitMinutes: 20 })).toBe("time");
    expect(stopReason({ answered: 3, length: 10, startedAt, now: Date.parse(startedAt) + 19 * 60_000, timeLimitMinutes: 20 })).toBeNull();
    expect(deadlineOf(startedAt, 20)).toBe("2026-10-30T10:20:00.000Z");
    expect(deadlineOf(startedAt, null)).toBeNull();
  });
});

describe("the blueprint", () => {
  const limits = blueprintLimits({ length: 15, maxLength: 30, formats: [...ADAPTIVE_FORMATS], revisionFormats: ["mcq", "mrq", "short", "flashcard", "structured"], feedback: "end" });
  it("is bounded by the policy and by Revision's own formats", () => {
    expect(limits).toEqual({ defaultLength: 15, maxLength: 30, formats: ["mcq", "mrq", "short", "structured"], defaultFeedback: "end" });
    expect(blueprintLimits({ length: 40, maxLength: 20, formats: ["mcq"], revisionFormats: ["mcq"], feedback: "end" }).defaultLength).toBe(20);
    expect(blueprintLimits({ length: 1, maxLength: 99, formats: ["mcq"], revisionFormats: ["mcq"], feedback: "end" })).toMatchObject({ defaultLength: 5, maxLength: 50 });
  });
  it("defaults to the programme's competencies and the policy's length, and leaves structured out with feedback at the end", () => {
    const r = parseBlueprintRequest({}, limits);
    expect(r.ok && r.value).toMatchObject({ scope: { kind: "programme" }, length: 15, feedback: "end", formats: ["mcq", "mrq", "short"], start: null, timeLimitMinutes: null, source: "notes" });
    const i = parseBlueprintRequest({ feedback: "immediate" }, limits);
    expect(i.ok && i.value.formats).toContain("structured");
  });
  it("refuses what is out of bounds", () => {
    expect(parseBlueprintRequest({ length: 4 }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ length: 31 }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ formats: ["flashcard"] }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ timeLimitMinutes: 7 }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ start: "hardest" }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ scope: { kind: "documents", materialIds: ["x"] } }, limits).ok).toBe(false);
    expect(parseBlueprintRequest({ scope: { kind: "competencies", competencyIds: [id(1)] }, timeLimitMinutes: 30, start: "harder" }, limits).ok).toBe(true);
  });
  it("starts at the student's choice, else the programme level's default, else the policy's, else standard", () => {
    expect(startingDifficulty("easy", "harder", "standard")).toEqual({ start: "easy", from: "chosen" });
    expect(startingDifficulty(null, "harder", "easy")).toEqual({ start: "harder", from: "programme" });
    expect(startingDifficulty(null, null, "easy")).toEqual({ start: "easy", from: "policy" });
    expect(startingDifficulty(null, null, "any")).toEqual({ start: "standard", from: "policy" });
  });
  it("round-trips through a set's scope, within 417's 4000 bytes, and marks the set adaptive", () => {
    const bp: AdaptiveBlueprint = {
      v: 1, title: "Adaptive exam: Respiratory", scope: { kind: "programme" }, formats: ["mcq", "short"], length: 20, start: "standard", startFrom: "programme",
      feedback: "end", timeLimitMinutes: 30, source: "notes", sections: Array.from({ length: 30 }, (_, i) => id(i + 1)), competencyIds: Array.from({ length: 20 }, (_, i) => id(i + 100)),
      libraryIds: Array.from({ length: 12 }, (_, i) => id(i + 200)), calls: 2, stopped: "time",
    };
    const scope = blueprintScope(bp);
    expect(JSON.stringify(scope).length).toBeLessThanOrEqual(4000);
    expect(blueprintOf(scope)).toEqual(bp);
    expect(isAdaptiveScope(scope)).toBe(true);
    expect(isAdaptiveScope({ kind: "library" })).toBe(false);
    expect(blueprintOf({ kind: "library" })).toBeNull();
  });
});

describe("the report", () => {
  const item = (n: number, o: Partial<ReportItem>): ReportItem => ({
    questionId: id(n), kind: "mcq", stem: `Question ${n}?`, difficulty: 2, cognitive: "understanding", chunkId: id(50 + (n % 2)), materialId: id(90), materialTitle: "Respiratory notes",
    topic: n % 2 ? "Oxygen therapy" : "Asthma", competencyId: n % 2 ? id(70) : null, library: false, generated: false,
    outcome: { correct: true, score: 1, marking: "deterministic" }, keyPoints: [], misconceptions: [], ...o,
  });
  const names = new Map([[id(70), "Administers oxygen safely"]]);
  it("computes the practice score with partial credit, by topic, competency, level and format, and the difficulty path", () => {
    const items = [
      item(1, {}), item(2, {}), item(3, { library: true }),
      item(4, { difficulty: 3, outcome: { correct: false, score: 0.5, marking: "deterministic" }, kind: "mrq", keyPoints: ["Check the airway first"], misconceptions: ["Oxygen is always harmless"] }),
      item(5, { difficulty: 3, outcome: { correct: false, score: 0, marking: "ai_evaluation" }, kind: "short", cognitive: "application", generated: true, keyPoints: ["Titrate to target saturation"] }),
      item(6, { outcome: "held", kind: "short" }), item(7, { outcome: "unanswered" }),
    ];
    const r = buildAdaptiveReport({ items, length: 10, start: "standard", startFrom: "programme", competencyNames: names, fallback: false, stop: "ended" });
    expect(r.label).toBe(ADAPTIVE_REPORT_LABEL);
    expect(r.score).toEqual({ state: "measured", percent: 70, marked: 5 });
    expect(r).toMatchObject({ of: 10, answered: 6, marked: 5, held: 1, finish: "harder", fallback: null, stopped: "You ended the exam before its last question." });
    expect(r.trajectory.map(p => [p.asked, p.offered, p.result])).toEqual([
      ["standard", "standard", "right"], ["standard", "standard", "right"], ["standard", "standard", "right"],
      ["harder", "harder", "missed"], ["harder", "harder", "missed"], ["harder", "standard", "held"],
    ]);
    expect(r.byTopic).toEqual([
      { key: "Oxygen therapy", label: "Oxygen therapy", marked: 3, correct: 2, percent: 67 },
      { key: "Asthma", label: "Asthma", marked: 2, correct: 1, percent: 75 },
    ]);
    expect(r.byCompetency).toEqual([{ key: id(70), label: "Administers oxygen safely", marked: 3, correct: 2, percent: 67 }]);
    expect(r.byLevel.map(g => g.key)).toEqual(["understanding", "application"]);
    expect(r.byFormat.map(g => [g.key, g.percent])).toEqual([["mcq", 100], ["mrq", 50], ["short", 0]]);
    expect(r.sources).toEqual({ library: 1, stored: 4, generated: 1 });
    expect(r.gaps).toEqual([
      { label: "Asthma", chunkId: id(50), materialId: id(90), missed: 1, keyPoints: ["Check the airway first"], misconceptions: ["Oxygen is always harmless"] },
      { label: "Oxygen therapy", chunkId: id(51), materialId: id(90), missed: 1, keyPoints: ["Titrate to target saturation"], misconceptions: [] },
    ]);
    expect(r.recommendations.map(x => x.id)).toEqual(["grade", `learn:${id(50)}`, `learn:${id(51)}`, "weak", "spaced"]);
    expect(r.strengths).toEqual([]);
  });
  it("names strengths (two or more marked, 80% or more) and has no gaps when nothing was missed", () => {
    const r = buildAdaptiveReport({ items: [item(1, {}), item(3, {}), item(5, {})], length: 3, start: "easy", startFrom: "chosen", competencyNames: names, fallback: false, stop: "length" });
    expect(r.strengths).toEqual(["Oxygen therapy", "Administers oxygen safely"]);
    expect(r.gaps).toEqual([]);
    expect(r.finish).toBe("standard");
    expect(r.stopped).toBeNull();
    expect(r.recommendations).toEqual([]);
  });
  it("nothing marked is Not measured, never zero", () => {
    const r = buildAdaptiveReport({ items: [item(1, { outcome: "held" })], length: 5, start: "standard", startFrom: "policy", competencyNames: names, fallback: false, stop: null });
    expect(r.score).toEqual({ state: "not_measured", reason: "Your answers are waiting for your own marking." });
    expect(buildAdaptiveReport({ items: [], length: 5, start: "standard", startFrom: "policy", competencyNames: names, fallback: false, stop: "exhausted" }).score.state).toBe("not_measured");
  });
  it("a held answer marked after the exam ended counts in the score but not in the path the rule took", () => {
    const items = [item(1, {}), item(2, {}), item(3, { outcome: { correct: true, score: 1, marking: "self_graded" }, markedAfterEnd: true })];
    expect(adaptationOutcomes(items)).toEqual([true, true, null]);
    const r = buildAdaptiveReport({ items, length: 3, start: "standard", startFrom: "policy", competencyNames: names, fallback: false, stop: "length" });
    expect(r.finish).toBe("standard");
    expect(r.score).toMatchObject({ percent: 100, marked: 3 });
  });
  it("says so when 720 is absent and the exam was kept as mock practice marked adaptive", () => {
    expect(buildAdaptiveReport({ items: [item(1, {})], length: 5, start: "standard", startFrom: "policy", competencyNames: names, fallback: true, stop: null }).fallback).toBe(ADAPTIVE_FALLBACK_NOTE);
  });
  it("cognitive level from the rubric, else from difficulty", () => {
    expect(cognitiveOf("reasoning", 1)).toBe("reasoning");
    expect(cognitiveOf(null, 1)).toBe("recall");
    expect(cognitiveOf(null, null)).toBe("understanding");
    expect(cognitiveOf(null, 3)).toBe("application");
  });
});

describe("the session's outcomes, as stored", () => {
  it("right/missed in order, held, the current one unanswered; marked after the end flagged", () => {
    const session = { completedAt: "2026-10-30T11:00:00Z" } as never;
    const o = stateOutcomes({
      session, questionIds: [id(1), id(2), id(3), id(4)], held: [{ questionId: id(3), response: { text: "x" } }],
      attempts: [
        { questionId: id(1), correct: true, score: 1, marking: "deterministic", answeredAt: "2026-10-30T10:01:00Z" },
        { questionId: id(2), correct: false, score: 0, marking: "self_graded", answeredAt: "2026-10-30T11:05:00Z" },
      ],
    });
    expect(o).toEqual([
      { outcome: { correct: true, score: 1, marking: "deterministic" }, markedAfterEnd: false },
      { outcome: { correct: false, score: 0, marking: "self_graded" }, markedAfterEnd: true },
      { outcome: "held" }, { outcome: "unanswered" },
    ]);
  });
});

describe("migration 720: detected once, mock fallback without it", () => {
  afterEach(() => resetAdaptiveSchema());
  const fake = (refuse: boolean) => {
    const inserts: { table: string; row: Record<string, unknown> }[] = [];
    const admin = {
      from(table: string) {
        return {
          insert(row: Record<string, unknown>) {
            inserts.push({ table, row });
            const refused = refuse && table === "individual_scholar_revision_session" && row.mode === "adaptive";
            const result = refused ? { data: null, error: { code: "23514", message: "violates check constraint" } } : { data: { id: id(inserts.length) }, error: null };
            return Object.assign(Promise.resolve(result), { select: () => ({ single: () => Promise.resolve(result) }) });
          },
          delete: () => ({ eq: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
        };
      },
    };
    return { admin, inserts };
  };
  it("uses mode 'adaptive' where 720 allows it", async () => {
    const { admin, inserts } = fake(false);
    const r = await createAdaptiveSession(admin, id(99), { setId: id(98), feedback: "end", total: 10, firstQuestionId: id(97) });
    expect(r).toMatchObject({ ok: true, mode: "adaptive" });
    expect(inserts.filter(x => x.table === "individual_scholar_revision_session").map(x => x.row.mode)).toEqual(["adaptive"]);
    expect(inserts.find(x => x.table === "individual_scholar_revision_session_item")?.row).toMatchObject({ ordinal: 1, question_id: id(97), user_id: id(99) });
  });
  it("falls back to 'mock' on 417's CHECK, and does not ask again", async () => {
    const { admin, inserts } = fake(true);
    expect(await createAdaptiveSession(admin, id(99), { setId: id(98), feedback: "end", total: 10, firstQuestionId: id(97) })).toMatchObject({ ok: true, mode: "mock" });
    expect(await createAdaptiveSession(admin, id(99), { setId: id(98), feedback: "end", total: 10, firstQuestionId: id(96) })).toMatchObject({ ok: true, mode: "mock" });
    expect(inserts.filter(x => x.table === "individual_scholar_revision_session").map(x => x.row.mode)).toEqual(["adaptive", "mock", "mock"]);
  });
});

describe("policy defaults", () => {
  it("adaptive exams are on, 15 questions by default, 30 at most, every adaptive format", () => {
    expect(DEFAULT_POLICY.scholarAdaptiveExams).toBe("on");
    expect(DEFAULT_POLICY.scholarAdaptiveLength).toBe(15);
    expect(DEFAULT_POLICY.scholarAdaptiveMaxLength).toBe(30);
    expect(DEFAULT_POLICY.scholarAdaptiveFormats).toEqual([...ADAPTIVE_FORMATS]);
    expect(ADAPTIVE_FORMATS).not.toContain("flashcard");
    expect(policyDef("scholar_adaptive_length")).toMatchObject({ min: 5, max: 50 });
  });
});

describe("no calibrated-score or verification claim", () => {
  it("the report label disclaims, and nothing else claims", () => {
    expect(ADAPTIVE_REPORT_LABEL).toBe("Practice estimate from rule-based adaptation — not a calibrated exam score, not a formal examination result, and not verified competence.");
    const r = buildAdaptiveReport({
      items: [{ questionId: id(1), kind: "mcq", stem: "Q?", difficulty: 2, cognitive: "recall", chunkId: id(2), materialId: id(3), materialTitle: "Notes", topic: null, competencyId: null, library: false, generated: false, outcome: { correct: false, score: 0, marking: "deterministic" }, keyPoints: [], misconceptions: [] }],
      length: 5, start: "standard", startFrom: "policy", competencyNames: new Map(), fallback: true, stop: "time",
    });
    const { label, ...rest } = r;
    expect(label).toBe(ADAPTIVE_REPORT_LABEL);
    const text = JSON.stringify(rest) + ADAPTIVE_RULE + ADAPTIVE_HELP + ADAPTIVE_FALLBACK_NOTE + (policyDef("scholar_adaptive_exams")?.help ?? "");
    expect(text).not.toMatch(/calibrat|psychometric|\bIRT\b|ability estimate|\btheta\b|verified|certif|\bpass(ed)?\b|\bfail(ed)?\b|\bgrade\b|mastery|competent/i);
  });
});

describe("the planned registry no longer says adaptive exams are unbuilt", () => {
  it("drops the osce-adaptive entry, and Scholar still lists its genuine gaps", () => {
    expect(EXPERIENCES.scholar.planned.map(p => p.key)).not.toContain("osce-adaptive");
    expect(EXPERIENCES.scholar.planned.length).toBeGreaterThan(0);
  });
});

