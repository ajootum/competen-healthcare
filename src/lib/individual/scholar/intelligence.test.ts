import { describe, it, expect } from "vitest";
import { buildIntelligence, type IAttempt, type IQuestion, type IReview, type Thresholds } from "./intelligence";
import { eligibleAchievements, studyAchievementsFrom, studyDetail, STUDY_ACHIEVEMENT_KINDS } from "./passport-items";
import { DEFAULT_POLICY, POLICIES, resolvePolicy } from "../policy";
import { NO_CATALOGUE, NO_MAPPINGS } from "./competency-sources";

// COMPETEN-SCHOLAR-01 S5. Four measures tracked separately, each measured / insufficient / not_measured,
// recommendations with reasons, and revision as a Passport achievement on the existing path.

const t: Thresholds = { minAnswers: 5, windowDays: 28 };
const today = "2026-10-23";
const mats = [{ id: "m1", title: "Cardiology", createdAt: "2026-10-01T00:00:00Z" }, { id: "m2", title: "Renal", createdAt: "2026-10-05T00:00:00Z" }];
const q = (id: string, materialId: string, kind: "mcq" | "case" = "mcq"): IQuestion => ({ id, materialId, kind });
const at = (questionId: string, correct: boolean, answeredAt = "2026-10-20T10:00:00Z"): IAttempt => ({ questionId, correct, answeredAt });
const base = { materials: mats, cards: [], reviews: [] as IReview[], catalogue: null, mappings: null, today, t };

describe("the four measures are separate, and each says when it cannot be measured", () => {
  it("with no material: engagement not measured, everything else not measured, and the next step is to add material", () => {
    const li = buildIntelligence({ ...base, materials: [], questions: [], attempts: [] });
    expect(li.engagement.state).toBe("not_measured");
    expect(li.knowledge.state).toBe("not_measured");
    expect(li.reasoning.state).toBe("not_measured");
    expect(li.coverage.state).toBe("not_measured");
    expect(li.recommendations[0].id).toBe("add-material");
  });

  it("below the threshold, knowledge is insufficient with have/need -- never a percentage", () => {
    const questions = [q("a", "m1"), q("b", "m1"), q("c", "m1")];
    const li = buildIntelligence({ ...base, questions, attempts: [at("a", true), at("b", false)] });
    expect(li.knowledge).toMatchObject({ state: "insufficient", have: 2, need: 5 });
  });

  it("knowledge counts MCQ only and reasoning counts scenarios only", () => {
    const questions = [...["a", "b", "c", "d", "e"].map(id => q(id, "m1")), ...["v", "w", "x", "y", "z"].map(id => q(id, "m2", "case"))];
    const attempts = [
      ...["a", "b", "c", "d", "e"].map(id => at(id, true)),
      ...["v", "w"].map(id => at(id, true)), ...["x", "y", "z"].map(id => at(id, false)),
    ];
    const li = buildIntelligence({ ...base, questions, attempts });
    expect(li.knowledge).toMatchObject({ state: "measured", answered: 5, accuracy: 100 });
    expect(li.reasoning).toMatchObject({ state: "measured", answered: 5, accuracy: 40 });
    expect(li.recommendations.some(r => r.id === "more-scenarios")).toBe(true);
  });

  it("latest try, first try and corrections are distinct figures", () => {
    const questions = ["a", "b", "c", "d", "e"].map(id => q(id, "m1"));
    const attempts = [
      at("a", false, "2026-10-01T10:00:00Z"), at("a", true, "2026-10-02T10:00:00Z"),
      at("b", true), at("c", true), at("d", false), at("e", true),
    ];
    const li = buildIntelligence({ ...base, questions, attempts });
    expect(li.knowledge).toMatchObject({ state: "measured", accuracy: 80, firstTryAccuracy: 60, corrected: 1 });
  });

  it("recall is not measured when the review log is absent, and measured from recent reviews when present", () => {
    const questions = ["a", "b", "c", "d", "e"].map(id => q(id, "m1"));
    const attempts = questions.map(x => at(x.id, true));
    const absent = buildIntelligence({ ...base, questions, attempts, reviews: null });
    expect(absent.knowledge.state === "measured" && absent.knowledge.recall.state).toBe("not_measured");
    expect(absent.engagement.state === "measured" && absent.engagement.reviews).toBeNull();
    const reviews = [3, 4, 5, 4, 4].map((quality, i) => ({ materialId: "m1", quality, reviewedAt: `2026-10-1${i}T09:00:00Z` }));
    const present = buildIntelligence({ ...base, questions, attempts, reviews });
    expect(present.knowledge.state === "measured" && present.knowledge.recall).toMatchObject({ state: "measured", reviews: 5, meanQuality: 4 });
    expect(present.engagement).toMatchObject({ state: "measured", reviews: 5, reviewsSince: "2026-10-10" });
  });

  it("engagement counts distinct study days in the window, from answers and reviews together", () => {
    const questions = [q("a", "m1"), q("b", "m1")];
    const attempts = [at("a", true, "2026-10-20T08:00:00Z"), at("b", true, "2026-10-20T18:00:00Z"), at("a", true, "2026-08-01T08:00:00Z")];
    const reviews = [{ materialId: "m1", quality: 4, reviewedAt: "2026-10-21T08:00:00Z" }];
    const li = buildIntelligence({ ...base, questions, attempts, reviews });
    expect(li.engagement).toMatchObject({ state: "measured", studyDays: 2, answered: 2, reviews: 1, lastStudied: "2026-10-21", daysSinceStudy: 2 });
  });
});

describe("competency coverage reads S1 and S2 through interfaces, and is never guessed", () => {
  const questions = [q("a", "m1"), q("b", "m1")];
  it("not connected is Not measured with the reason -- the placeholders answer null, not empty", async () => {
    expect(await NO_CATALOGUE.competenciesFor(null, "u")).toEqual({ ok: true, value: null });
    expect(await NO_MAPPINGS.mappingsFor(null, "u", [])).toEqual({ ok: true, value: null });
    const li = buildIntelligence({ ...base, questions, attempts: [] });
    expect(li.coverage).toMatchObject({ state: "not_measured" });
    expect(buildIntelligence({ ...base, questions, attempts: [], competencyUnreadable: true }).coverage)
      .toMatchObject({ state: "not_measured", reason: "Competency information could not be read just now." });
  });
  it("with a catalogue and mappings: practised, practised with a right answer, and the gaps", () => {
    const catalogue = ["c1", "c2", "c3"].map(id => ({ id, code: null, name: id.toUpperCase(), frameworkId: "f", frameworkName: "NMC proficiencies" }));
    const mappings = [{ questionId: "a", competencyId: "c1" }, { questionId: "b", competencyId: "c2" }];
    const li = buildIntelligence({ ...base, questions, attempts: [at("a", true), at("b", false)], catalogue, mappings });
    expect(li.coverage).toMatchObject({ state: "measured", total: 3, practised: 2, practisedCorrect: 1, gaps: [{ id: "c3", name: "C3" }] });
    expect(li.recommendations.some(r => r.id === "coverage-gaps")).toBe(true);
  });
});

describe("recommendations say what to do and why, most urgent first", () => {
  it("due cards first, then a weak material, each with a reason and a link", () => {
    const questions = ["a", "b", "c", "d", "e"].map(id => q(id, "m1"));
    const attempts = [at("a", true), ...["b", "c", "d", "e"].map(id => at(id, false))];
    const cards = [{ materialId: "m1", status: "active" as const, nextReviewAt: "2026-10-22" }];
    const li = buildIntelligence({ ...base, questions, attempts, cards });
    expect(li.recommendations[0]).toMatchObject({ id: "review-due", href: "/individual/scholar/study/revise" });
    const revisit = li.recommendations.find(r => r.id === "revisit-m1");
    expect(revisit?.reason).toContain("20%");
    expect(li.recommendations.find(r => r.id === "generate-m2")).toBeTruthy();
  });
  it("idle for a week suggests picking up again", () => {
    const li = buildIntelligence({ ...base, questions: [q("a", "m1")], attempts: [at("a", true, "2026-10-01T09:00:00Z")] });
    expect(li.recommendations.some(r => r.id === "pick-up" && r.reason.includes("22 days"))).toBe(true);
  });
});

describe("revision in the Passport (migration 391), on the existing path", () => {
  const questions = [{ id: "a", materialId: "m1", kind: "mcq" as const }];
  const reviews = [{ materialId: "m1", reviewedAt: "2026-10-10T09:00:00Z" }, { materialId: "m1", reviewedAt: "2026-10-12T09:00:00Z" }];
  it("is offered once a material has reviews, as a count, with the latest review date", () => {
    const e = eligibleAchievements({ materials: mats, questions, attempts: [], choices: [], reviews });
    expect(e).toEqual([expect.objectContaining({ materialId: "m1", achievement: "revision_reviews", answered: 2, lastStudied: "2026-10-12T09:00:00Z" })]);
    expect(studyDetail({ achievement: "revision_reviews", answered: 2 })).toBe("2 revision reviews of own notes");
  });
  it("a chosen revision achievement shows its count; without reviews it is dropped, never shown as zero", () => {
    const choices = [{ materialId: "m1", achievement: "revision_reviews" as const, label: "Cardiology revision", includedAt: "2026-10-13T00:00:00Z" }];
    expect(studyAchievementsFrom({ choices, questions, attempts: [], reviews })[0]).toMatchObject({ answered: 2 });
    expect(studyAchievementsFrom({ choices, questions, attempts: [] })).toEqual([]);
  });
  it("the kinds are the three 391 allows, and policy offers them by default", () => {
    expect([...STUDY_ACHIEVEMENT_KINDS]).toEqual(["practice_questions", "practice_scenarios", "revision_reviews"]);
    expect(DEFAULT_POLICY.passportAchievementKinds).toContain("revision_reviews");
  });
});

describe("the insight thresholds are Individual policy, clamped", () => {
  it("defaults to 5 answers and 28 days, and clamps what is published", () => {
    expect(DEFAULT_POLICY.scholarInsightMinAnswers).toBe(5);
    expect(DEFAULT_POLICY.scholarInsightWindowDays).toBe(28);
    const p = resolvePolicy([
      { config_path: "individual.policy.scholar_insight_min_answers", published: { value: 1 } },
      { config_path: "individual.policy.scholar_insight_window_days", published: { value: 400 } },
    ]);
    const def = (k: string) => POLICIES.find(x => x.key === k) as { min: number; max: number };
    expect(p.scholarInsightMinAnswers).toBe(def("scholar_insight_min_answers").min);
    expect(p.scholarInsightWindowDays).toBe(def("scholar_insight_window_days").max);
  });
});

describe("below a threshold, the recommendation says how many more answers are needed", () => {
  it("knowledge measured, scenarios short: work through N more scenarios", () => {
    const questions = [...["a", "b", "c", "d", "e"].map(id => q(id, "m1")), ...["x", "y"].map(id => q(id, "m1", "case"))];
    const attempts = [...["a", "b", "c", "d", "e"].map(id => at(id, true)), at("x", true), at("y", false)];
    const li = buildIntelligence({ ...base, materials: [mats[0]], questions, attempts });
    expect(li.recommendations.find(r => r.id === "more-scenarios-to-measure")).toMatchObject({ title: "Work through 3 more practice scenarios", href: "/individual/scholar/study/apply" });
  });
});

describe("S1/S2 readiness: expected levels order the gaps, and case questions are reasoning", () => {
  it("gaps come highest expected level first, with the level named", () => {
    const catalogue = [
      { id: "c1", code: null, name: "Asepsis", frameworkId: "f", frameworkName: "CF-FOUND", expectedLevel: { score: 2, label: "Competent" } },
      { id: "c2", code: null, name: "Handover", frameworkId: "f", frameworkName: "CF-FOUND", expectedLevel: { score: 4, label: "Proficient" } },
      { id: "c3", code: null, name: "Consent", frameworkId: "f", frameworkName: "CF-FOUND", expectedLevel: null },
    ];
    const li = buildIntelligence({ ...base, questions: [q("a", "m1")], attempts: [], catalogue, mappings: [] });
    expect(li.coverage.state === "measured" && li.coverage.gaps).toEqual([
      { id: "c2", name: "Handover", expected: "Proficient" }, { id: "c1", name: "Asepsis", expected: "Competent" }, { id: "c3", name: "Consent", expected: null },
    ]);
  });
  it("a question with a case_id counts as reasoning, never as knowledge", () => {
    const questions = ["a", "b", "c", "d", "e"].map(id => ({ id, materialId: "m1", kind: "mcq" as const, caseId: "case-1" }));
    const li = buildIntelligence({ ...base, questions, attempts: questions.map(x => at(x.id, true)) });
    expect(li.reasoning).toMatchObject({ state: "measured", answered: 5 });
    expect(li.knowledge.state).toBe("not_measured");
  });
});

describe("S1 adapter (fromCatalogue)", () => {
  it("unreadable refuses, an empty allowlist is not available, rows map with the expected level", async () => {
    const { fromCatalogue, COMPETENCY_SOURCES, S1_CATALOGUE } = await import("./competency-sources");
    expect(fromCatalogue(null)).toEqual({ ok: false });
    expect(fromCatalogue([])).toEqual({ ok: true, value: null });
    const row = { competencyId: "c1", code: "F1", title: "Hand hygiene", description: null, layer: "foundational" as const, profession: null,
      catalogue: { id: "f1", name: "CF-FOUND", code: "CF", version: "1.0.0" }, domain: { id: "d", name: "Safety" }, outcomes: [],
      expectedLevel: { id: "l", score: 3, label: "Competent" }, cpu: null, links: { prerequisites: [], extends: [], sharedWith: [] } };
    expect(fromCatalogue([row])).toEqual({ ok: true, value: [{ id: "c1", code: "F1", name: "Hand hygiene", frameworkId: "f1", frameworkName: "CF-FOUND", expectedLevel: { score: 3, label: "Competent" } }] });
    expect(COMPETENCY_SOURCES.catalogue).toBe(S1_CATALOGUE);
  });
  it("with S1 connected and no accepted maps yet, coverage says the questions are not yet linked", () => {
    const catalogue = [{ id: "c1", code: null, name: "Hand hygiene", frameworkId: "f1", frameworkName: "CF-FOUND", expectedLevel: null }];
    expect(buildIntelligence({ ...base, questions: [q("a", "m1")], attempts: [], catalogue, mappings: null }).coverage)
      .toMatchObject({ state: "not_measured", reason: "Your practice questions are not yet linked to competencies." });
  });
});
