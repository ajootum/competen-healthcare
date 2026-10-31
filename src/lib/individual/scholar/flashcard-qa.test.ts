import { describe, expect, it } from "vitest";
import { CLINICAL_SENSITIVITY_RULES, SENSITIVE_MARKER, cardSensitiveFlag, sensitiveFlag } from "./flashcard-sensitive";
import { citationText, flashcardView, type CardRowExtras, type CitationMeta } from "./flashcards";
import { referenceCitations } from "./flashcard-service";
import {
  FLASHCARD_LEVEL_MIXES, capCardLevel, flashcardDraftProblem, parseRubric, flashcardLevelMix, levelMixLine, passageLevelSupport, planCardLevels,
} from "./question-intel";
import { REVISION_SYSTEM, formatPromptVersion, revisionPromptVersion, runRevisionQuestions, type Passage } from "./generation";
import { checkRevisionDraft } from "./revision";
import { PROMPT_VERSIONS } from "./config";
import { canDo, guidePlan, learnerObjective } from "./flashcard-pdf";
import { respiratoryCards } from "./flashcard-pdf.fixture";
import type { QuestionRow } from "./store";

// SCHOLAR-FLASHCARDS-QA-01: the rules beneath the refined downloads -- the clinically sensitive flag, citations from
// recorded provenance, the "I can" checklist line, and the flashcard level mix with its source-sufficiency fallback.

describe("item 3: clinically sensitive content is flagged, never rewritten", () => {
  const flag = (front: string, back: string, origin: "notes" | "library" | "learner" = "notes") => sensitiveFlag({ front, back, origin });
  it("paediatric respiratory rates, oxygen targets, emergency respiratory assessment, COPD deterioration, numeric values", () => {
    expect(flag("What is the normal respiratory rate in infants?", "About 30-40 breaths/min.")!.codes).toEqual(["paediatric_rr", "numeric_value"]);
    expect(flag("What target SpO2 is usual?", "94-98% for most adults.")!.codes).toEqual(["oxygen_target", "numeric_value"]);
    expect(flag("What does a silent chest suggest in acute asthma?", "Life-threatening asthma. Escalate immediately.")!.codes).toEqual(["emergency_resp"]);
    expect(flag("What suggests a COPD exacerbation is worsening?", "New drowsiness and confusion.")!.codes).toEqual(["copd_deterioration"]);
    expect(flag("What is the usual paracetamol dose?", "1 g every four to six hours, at most 4 g in 24 hours.")!.codes).toEqual(["numeric_value"]);
    expect(flag("When is the score a concern?", "A score above 5.")).toMatchObject({ codes: ["numeric_value"], values: ["above 5"] });
  });
  it("does not flag a card with no value or sensitive term, an age, a duration, or the 2 of SpO2", () => {
    expect(flag("What are the components of a respiratory assessment?", "History, inspection, palpation, percussion and auscultation.")).toBeNull();
    expect(flag("A 68-year-old presents. What do you ask?", "About breathlessness over the last two hours.")).toBeNull();
    expect(flag("Why count for 60 seconds?", "So an irregular rate is not missed.")).toBeNull();
    expect(flag("What does SpO2 measure?", "Peripheral oxygen saturation.")).toBeNull();
    expect(flag("Why record escalation clearly?", "So the team knows what was done.")).toBeNull();
  });
  it("the card's words are unchanged; the marker says not clinically reviewed, or, for a library card, reviewed with its date", () => {
    const cards = respiratoryCards();
    const before = JSON.stringify(cards);
    const flags = cards.map(c => cardSensitiveFlag(c));
    expect(JSON.stringify(cards)).toBe(before);
    expect(flags.map((f, i) => (f ? i + 1 : null)).filter(Boolean)).toEqual([2, 3, 4, 6, 8, 9]);
    expect(flags[1]!.marker).toBe(SENSITIVE_MARKER);
    expect(flags[1]!.marker).toMatch(/Check against current local guidelines.*not clinically reviewed/);
    expect(flags[5]).toMatchObject({ reviewed: true });
    expect(flags[5]!.marker).toBe("Clinically reviewed (published 2026-10-12). Clinically sensitive value: local guidelines may differ, check them.");
    expect(flags[2]!.values).toEqual(["30-40 breaths/min", "20-30", "15-20"]);
  });
  it("the built-in rules are the HQ content review defaults (content-review.ts), applied when nothing is published", () => {
    expect(CLINICAL_SENSITIVITY_RULES.map(r => r.id)).toEqual(["paediatric_rr", "oxygen_target", "emergency_resp", "copd_deterioration", "numeric_value"]);
  });
});

describe("item 2: citations carry what the record holds, and nothing it does not", () => {
  const TODAY = "2026-10-31";
  const extras = (over: Partial<CardRowExtras> = {}): CardRowExtras => ({ card: null, history: [], topics: [], competencyTitle: null, mark: null, deckIds: [], contentVersion: 1, updatedAt: null, ...over });
  const row = (over: Partial<QuestionRow>): QuestionRow => ({
    id: "q1", materialId: "m1", chunkId: "c1", kind: "flashcard", stem: "What target SpO2 is usual?", options: [], correctIndex: null, rationale: "", sourceQuote: "Target 94 to 98 percent.",
    model: "claude", promptVersion: "x", createdAt: "2026-10-20T10:00:00Z", answer: { back: "94-98%", rubric: { level: "recall", source: "references", referenceIds: ["comp-1", "comp-gone"] } },
    difficulty: 1, materialTitle: "Respiratory v2", ordinal: 4, pageFrom: 4, pageTo: 4, unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, library: null, ...over,
  });
  it("a library card cites its item, code, version and publication date (442); notes keep document and section", () => {
    const v = flashcardView(row({ id: "L", kind: "flashcard", answer: { back: "Life-threatening asthma" }, library: { resourceId: "r", versionId: "v3", versionNo: 3, approval: "clinically_approved", title: "Silent chest", code: "rq-silent", publishedAt: "2026-10-12T14:00:00Z" } }), extras(), TODAY);
    expect(v.sources).toEqual([expect.objectContaining({ origin: "library", citation: "Silent chest, Competen library, version 3", libraryVersionId: "v3",
      reference: expect.objectContaining({ title: "Silent chest", code: "rq-silent", version: "3", reviewedAt: "2026-10-12T14:00:00Z", kind: "library" }) })]);
    // Without the 442 title (older reads), the citation is as before.
    expect(flashcardView(row({ answer: { back: "x" }, library: { resourceId: "r", versionId: "v3", versionNo: 3, approval: "clinically_approved" } }), extras(), TODAY).sources[0].citation).toBe("Competen library, version 3");
    const n = flashcardView(row({ answer: { back: "94-98%" } }), extras(), TODAY);
    expect(n.sources).toEqual([expect.objectContaining({ origin: "notes", citation: "Respiratory v2, page 4" })]);
  });
  it("each approved reference is its own source, with the catalogue's title, code, framework, version and standing; one no longer held says so", () => {
    const refs = new Map<string, CitationMeta>([["comp-1", { title: "Respiratory Assessment and Monitoring", kind: "framework", code: "CFCA-RAM-02", publisher: "CFCA Adult Acute Care", version: "2.1.0", status: "Clinically approved" }]]);
    const v = flashcardView(row({}), extras({ references: refs }), TODAY);
    const ext = v.sources.filter(s => s.origin === "external");
    expect(ext).toHaveLength(2);
    expect(ext[0]).toMatchObject({ referenceIds: ["comp-1"], citation: "Respiratory Assessment and Monitoring (CFCA-RAM-02). CFCA Adult Acute Care. version 2.1.0. Clinically approved" });
    expect(ext[1]).toMatchObject({ referenceIds: ["comp-gone"], reference: null, citation: "An approved reference linked to your notes (its record is not available now)" });
  });
  it("referenceCitations: from the catalogue as it is now, never an identifier the catalogue does not hold", () => {
    const names = new Map([
      ["c1", { title: "Respiratory Assessment and Monitoring", code: "CFCA-RAM-02", layer: "profession", catalogue: "CFCA Adult Acute Care", contentStatus: "approved" as const }],
      ["c2", { title: "Changed competency", code: null, layer: "profession", catalogue: "CFCA Adult Acute Care", contentStatus: "draft" as const }],
      ["gone", { title: "A competency no longer in your programme", code: null, layer: "profession", catalogue: null }],
    ]);
    const out = referenceCitations(["c1", "c2", "gone"], names, [{ id: "c1", title: "Respiratory Assessment and Monitoring", code: "CFCA-RAM-02", catalogue: "CFCA Adult Acute Care", catalogueVersion: "2.1.0", contentStatus: "approved" } as never]);
    expect(out.get("c1")).toMatchObject({ title: "Respiratory Assessment and Monitoring", code: "CFCA-RAM-02", publisher: "CFCA Adult Acute Care", version: "2.1.0", status: "Clinically approved", kind: "framework" });
    expect(out.get("c2")!.status).toBe("Draft content");
    expect(out.has("gone")).toBe(false);
    for (const m of out.values()) { expect(m.doi ?? null).toBeNull(); expect(m.pmid ?? null).toBeNull(); expect(m.url ?? null).toBeNull(); }
  });
  it("citationText prints identifiers and licence only where recorded", () => {
    expect(citationText({ title: "BTS guideline for oxygen use", kind: "external", publisher: "Thorax", year: "2017", doi: "https://doi.org/10.1136/thoraxjnl-2016-209729", pmid: "28507176", access: "abstract only" }))
      .toBe("BTS guideline for oxygen use. Thorax. 2017. doi:10.1136/thoraxjnl-2016-209729, PMID 28507176. abstract only");
    expect(citationText({ title: "A title", kind: "external" })).toBe("A title");
  });
});

describe("item 6: the checklist line is an action the learner can tick", () => {
  it("I can + the objective's own verb; a noun phrase gets explain or recognise, a figure gets state", () => {
    expect(canDo("Describe the components of a systematic respiratory assessment")).toBe("I can describe the components of a systematic respiratory assessment");
    expect(canDo("Recognize signs of increased work of breathing.")).toBe("I can recognise signs of increased work of breathing");
    expect(canDo("Tachypnoea and nasal flaring", "recognise")).toBe("I can recognise tachypnoea and nasal flaring");
    expect(canDo("Arterial blood gas")).toBe("I can explain arterial blood gas");
    expect(canDo("SpO2 target 94-98% for most adults")).toBe("I can state SpO2 target 94-98% for most adults");
    expect(canDo("COPD and hypercapnia")).toBe("I can explain COPD and hypercapnia");
    expect(canDo("I can do this already")).toBe("I can do this already");
  });
});

// ── item 4: the generation mix ──

const SITUATION = [
  "When a patient with COPD becomes drowsy, call for help first and start controlled oxygen.",
  "Monitor the oxygen saturation and repeat the observations after any change.",
  "Too much oxygen can worsen carbon dioxide retention because the drive to breathe falls, so the target is lower than for most adults.",
  "Reduced consciousness indicates deterioration, whereas an alert patient with a stable rate can be reviewed at the next round.",
  "Escalate to the medical team if the rate keeps rising, rather than waiting for the next scheduled check.",
].join(" ");
const LIST = "Normal adult respiratory rate is twelve to twenty breaths per minute. Normal oxygen saturation is ninety four to ninety eight percent.";

describe("item 4: flashcards to a configurable level mix, honouring what the passage can support", () => {
  it("the mix by programme level (levelDefault), or as the policy chooses", () => {
    expect(flashcardLevelMix("programme", "easy")).toBe(FLASHCARD_LEVEL_MIXES.foundation);
    expect(flashcardLevelMix("programme", "standard")).toBe(FLASHCARD_LEVEL_MIXES.balanced);
    expect(flashcardLevelMix("programme", null)).toBe(FLASHCARD_LEVEL_MIXES.balanced);
    expect(flashcardLevelMix("programme", "harder")).toBe(FLASHCARD_LEVEL_MIXES.applied);
    expect(flashcardLevelMix("recall", "harder")).toBe(FLASHCARD_LEVEL_MIXES.foundation);
    expect(flashcardLevelMix("applied", "easy")).toBe(FLASHCARD_LEVEL_MIXES.applied);
  });
  it("a passage that describes a situation and gives reasons supports application and reasoning; a list does not", () => {
    expect(passageLevelSupport(SITUATION)).toEqual({ application: true, reasoning: true, why: [] });
    expect(passageLevelSupport(LIST)).toEqual({ application: false, reasoning: false, why: ["application:passage_short", "reasoning:no_application"] });
  });
  it("plans the levels by largest remainder over what is allowed; unsupported levels fall back, with why", () => {
    const rich = planCardLevels(FLASHCARD_LEVEL_MIXES.balanced, 3, { difficulty: null, passage: SITUATION });
    expect(rich.levels).toEqual({ recall: 1, understanding: 1, application: 1, reasoning: 0 });
    expect(planCardLevels(FLASHCARD_LEVEL_MIXES.applied, 3, { difficulty: null, passage: SITUATION }).levels).toEqual({ recall: 0, understanding: 1, application: 1, reasoning: 1 });
    const thin = planCardLevels(FLASHCARD_LEVEL_MIXES.applied, 3, { difficulty: null, passage: LIST });
    expect(thin.levels).toEqual({ recall: 1, understanding: 2, application: 0, reasoning: 0 });
    expect(thin.fallback).toEqual(["application:passage_short", "reasoning:no_application"]);
    // Easier: no application, by the difficulty, and said so.
    const easy = planCardLevels(FLASHCARD_LEVEL_MIXES.balanced, 3, { difficulty: "easy", passage: SITUATION });
    expect(easy.levels.application + easy.levels.reasoning).toBe(0);
    expect(easy.fallback).toEqual(["application:off_difficulty", "reasoning:off_difficulty"]);
    // The same input always gives the same plan.
    expect(planCardLevels(FLASHCARD_LEVEL_MIXES.balanced, 3, { difficulty: null, passage: SITUATION })).toEqual(rich);
  });
  it("the prompt line asks for the plan, and never for a level the passage cannot support", () => {
    expect(levelMixLine(planCardLevels(FLASHCARD_LEVEL_MIXES.balanced, 3, { difficulty: null, passage: SITUATION })))
      .toMatch(/^LEVEL MIX: write one recall .*, one understanding .*, one application /);
    const line = levelMixLine(planCardLevels(FLASHCARD_LEVEL_MIXES.applied, 3, { difficulty: null, passage: LIST }));
    expect(line).toContain("Do not write application or clinical reasoning cards: this passage cannot support them.");
    expect(line).not.toMatch(/write [a-z]+ application/);
  });
  it("a card claiming a level the passage cannot support is relabelled (its words unchanged)", () => {
    const a = { back: "x", rubric: { level: "reasoning" } };
    expect(capCardLevel(a, { application: false, reasoning: false })).toBe(true);
    expect(a.rubric.level).toBe("understanding");
    const b = { back: "x", rubric: { level: "reasoning" } };
    expect(capCardLevel(b, { application: true, reasoning: false })).toBe(true);
    expect(b.rubric.level).toBe("application");
    expect(capCardLevel({ rubric: { level: "recall" } }, { application: false, reasoning: false })).toBe(false);
  });
  it("runRevisionQuestions: the mix goes in the guidance, the plan and fallbacks come back, the prompt version is bumped", async () => {
    const passage: Passage = { chunkId: "c1", materialId: "m1", materialTitle: "Resp notes", ordinal: 1, pageFrom: 1, pageTo: 1, content: LIST };
    const prompts: string[] = [];
    const card = { front: "What is the normal adult respiratory rate?", back: "twelve to twenty breaths per minute", sourceQuote: "Normal adult respiratory rate is twelve to twenty breaths per minute.", difficulty: 1, level: "reasoning", objective: "", keyPoints: [], misconceptions: [], references: [] };
    const run = async (g: { user: string }) => { prompts.push(g.user); return { ok: true as const, text: JSON.stringify([card]), model: "m", provider: "p" } as never; };
    const r = await runRevisionQuestions("u1", "flashcard", passage, 3, run as never, { levelMix: FLASHCARD_LEVEL_MIXES.applied });
    if (!r.ok) throw new Error("run");
    expect(prompts[0]).toContain("LEVEL MIX: write one recall");
    expect(prompts[0]).toContain("Do not write application or clinical reasoning cards");
    expect(r.levelPlan).toEqual({ levels: { recall: 1, understanding: 2, application: 0, reasoning: 0 }, fallback: ["application:passage_short", "reasoning:no_application"], relabelled: 1 });
    expect((r.kept[0].answer.rubric as { level: string }).level).toBe("understanding");
    expect(r.promptVersion).toBe(`${PROMPT_VERSIONS.revision}:flashcard+${PROMPT_VERSIONS.flashcardMix}`);
    expect(formatPromptVersion("flashcard")).toBe(revisionPromptVersion("flashcard"));
    // Without a mix (every other kind, and older callers): no mix line, no plan.
    const r2 = await runRevisionQuestions("u1", "flashcard", passage, 3, run as never);
    expect(prompts[1]).not.toContain("LEVEL MIX");
    expect(r2.ok && r2.levelPlan).toBeNull();
  });
});

// ── staging acceptance quality notes (folded into QA-01) ──

describe("staging notes: a back is one concise concept, a topic is kept, an objective speaks to the learner", () => {
  const NOTE = "Target saturation for most acutely ill adults is ninety four to ninety eight percent in hospital wards. Patients at risk of hypercapnic failure have a lower target. Wash hands before and after every patient contact.";
  it("a back repeating the note sentence (whole, or a fifteen-word run) is refused as back_copied", () => {
    expect(flashcardDraftProblem("What saturation target suits most acutely ill adults?", "Target saturation for most acutely ill adults is ninety four to ninety eight percent in hospital wards.", NOTE)).toBe("back_copied");
    expect(flashcardDraftProblem("What saturation target suits most adults?", "Ninety four to ninety eight percent", NOTE)).toBeNull();
  });
  it("a back adding a second unrelated fact is refused as second_fact; a second part on the same concept is kept", () => {
    expect(flashcardDraftProblem("What saturation target suits most adults?", "Ninety four to ninety eight percent. Wash hands before patient contact.", NOTE)).toBe("second_fact");
    expect(flashcardDraftProblem("What saturation target suits most adults?", "Ninety four to ninety eight percent; lower where hypercapnic failure is a risk, so saturation targets differ.", NOTE)).toBeNull();
  });
  it("checkRevisionDraft refuses them (the quote check stays)", () => {
    const passage: Passage = { chunkId: "c", materialId: "m", materialTitle: "n", ordinal: 1, pageFrom: 1, pageTo: 1, content: NOTE };
    const base = { front: "What saturation target suits most adults?", sourceQuote: "Patients at risk of hypercapnic failure have a lower target." };
    expect(checkRevisionDraft("flashcard", { ...base, back: "Ninety four to ninety eight percent. Wash hands before patient contact." }, passage)).toEqual({ ok: false, reason: "second_fact" });
    expect(checkRevisionDraft("flashcard", { ...base, back: "Ninety four to ninety eight percent", sourceQuote: "not in the note at all, quite clearly" }, passage)).toEqual({ ok: false, reason: "quote_not_in_passage" });
  });
  it("the card's topic is kept from the generator (grounded, at most six words) and used when the section has none", () => {
    const r = parseRubric({ level: "recall", topic: "Oxygen saturation targets." }, [NOTE], { expectedAnswer: null, difficulty: 1 });
    expect(r.topic).toBe("Oxygen saturation targets");
    expect(parseRubric({ level: "recall", topic: "a topic name that is far too long to be one" }, [NOTE], { expectedAnswer: null, difficulty: 1 }).topic).toBeUndefined();
    const q = { id: "q", materialId: "m", chunkId: "c", kind: "flashcard", stem: "What target?", options: [], correctIndex: null, rationale: "", sourceQuote: "", model: "x", promptVersion: "x",
      createdAt: "2026-10-30", answer: { back: "94-98%", rubric: { level: "recall", topic: "Oxygen saturation targets" } }, difficulty: 1, materialTitle: "Notes", ordinal: 1, pageFrom: 1, pageTo: 1,
      unit: "page", latest: null, competencyId: null, caseId: null, caseStep: null, caseTitle: null, library: null } as QuestionRow;
    const x = { card: null, history: [], topics: [] as string[], competencyTitle: null, mark: null, deckIds: [], contentVersion: 1, updatedAt: null };
    expect(flashcardView(q, x, "2026-10-31").topic).toBe("Oxygen saturation targets");
    expect(flashcardView(q, { ...x, topics: ["Section topic"] }, "2026-10-31").topic).toBe("Section topic");
  });
  it("objectives in the item-writer's voice become what the learner can do", () => {
    expect(learnerObjective("Checks ability to recall oxygen saturation targets")).toBe("Recall oxygen saturation targets");
    expect(learnerObjective("Checks the student's ability to explain why controlled oxygen is used")).toBe("Explain why controlled oxygen is used");
    expect(learnerObjective("Tests whether the student can recognise a silent chest")).toBe("Recognise a silent chest");
    expect(learnerObjective("Assesses understanding of the work of breathing")).toBe("Explain the work of breathing");
    expect(learnerObjective("Checks knowledge of normal respiratory rates")).toBe("Recall normal respiratory rates");
    expect(learnerObjective("Describe a systematic assessment")).toBe("Describe a systematic assessment");
    expect(canDo(learnerObjective("Checks ability to recall oxygen saturation targets"))).toBe("I can recall oxygen saturation targets");
  });
  it("the checklist has every card (hand-written ones included) and no small cap", () => {
    const cards = respiratoryCards();
    const plan = guidePlan(cards);
    expect(plan.checklist.flatMap(c => c.items)).toContain("I can answer without looking: Why record findings and escalation clearly?");
    const many = Array.from({ length: 30 }, (_, i) => ({ ...cards[0], id: `k${i}`, keyPoints: [`Key point number ${i} about assessment`] }));
    expect(guidePlan(many).checklist[0].items.length).toBe(31);
  });
  it("the flashcard prompt asks for a concise back, an explanation, a topic and a learner-voice objective", () => {
    expect(REVISION_SYSTEM.flashcard).toMatch(/one concept, as short as it can be/);
    expect(REVISION_SYSTEM.flashcard).toMatch(/"rationale"/);
    expect(REVISION_SYSTEM.flashcard).toMatch(/"topic"/);
    expect(REVISION_SYSTEM.flashcard).toMatch(/never "Checks \.\.\."/);
    expect(PROMPT_VERSIONS.flashcardMix).toBe("scholar-flashcard-mix-v2");
  });
});
