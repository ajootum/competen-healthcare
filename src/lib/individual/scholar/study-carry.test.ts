import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adaptivePrefill, casePrefill, chooseOutcome, evaluationPrefill, flashcardPrefill, isStudyId, osceFilterPrefill, revisePrefill, stageHref,
  studyScopeOf, studyStages, withStudy, type StudyScope,
} from "./study-carry";

// SCHOLAR-SESSION-AI-02 slice B: carrying one study session across the four spaces. Pure functions only.

const S = "22222222-2222-4222-8222-222222222222";
const M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const M2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const K1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const K2 = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("withStudy", () => {
  it("adds study= to a bare path, keeps other parameters and the fragment", () => {
    expect(withStudy("/individual/scholar/study/revise", S)).toBe(`/individual/scholar/study/revise?study=${S}`);
    expect(withStudy("/x?session=1&view=decks#top", S)).toBe(`/x?session=1&view=decks&study=${S}#top`);
  });
  it("replaces an existing study= rather than repeating it", () => {
    expect(withStudy(`/x?study=${M1}&a=1`, S)).toBe(`/x?study=${S}&a=1`);
  });
  it("leaves the link exactly as given with no valid id (absent, empty, not a uuid)", () => {
    for (const id of [null, undefined, "", "new", "1; drop", `${S}x`]) expect(withStudy("/x?a=1#h", id as string | null)).toBe("/x?a=1#h");
    expect(isStudyId(S)).toBe(true);
    expect(isStudyId("nope")).toBe(false);
  });
  it("stage links carry the session, and Learn reopens the session itself", () => {
    expect(stageHref("learn", S)).toBe(`/individual/scholar/study/learn?session=${S}&study=${S}`);
    expect(stageHref("evaluate", S)).toBe(`/individual/scholar/study/evaluate?study=${S}`);
  });
});

const scope = (over: Partial<StudyScope> = {}): StudyScope => ({ kind: "document", materialIds: [M1], chunkIds: [K1], topic: null, competencyId: null, outcome: null, ...over });
const have = { materialIds: [M1, M2], competencyIds: [C1] };

describe("studyScopeOf", () => {
  it("collects materials and sections in step order, once each, and keeps an outcome only with a competency", () => {
    const steps = [{ sections: [{ chunkId: K1, materialId: M1 }, { chunkId: K2, materialId: M2 }] }, { sections: [{ chunkId: K1, materialId: M1 }] }];
    expect(studyScopeOf({ scopeKind: "documents", topic: "  ", competencyId: null, objectiveOutcome: "x" }, steps))
      .toEqual({ kind: "documents", materialIds: [M1, M2], chunkIds: [K1, K2], topic: null, competencyId: null, outcome: null });
    expect(studyScopeOf({ scopeKind: "competency", topic: null, competencyId: C1, objectiveOutcome: "Explain eGFR" }, []).outcome).toBe("Explain eGFR");
  });
});

describe("scope -> prefill of each page's existing control", () => {
  it("Revise: competency, then topic, then the session's materials (only those the learner has)", () => {
    expect(revisePrefill(scope({ kind: "competency", competencyId: C1 }), have)).toEqual({ kind: "competency", competencyId: C1 });
    expect(revisePrefill(scope({ kind: "topic", topic: "Sepsis" }), have)).toEqual({ kind: "topic", topic: "Sepsis" });
    expect(revisePrefill(scope({ materialIds: [M2, "ffffffff-ffff-4fff-8fff-ffffffffffff"] }), have)).toEqual({ kind: "documents", materialIds: [M2] });
    // A competency not in the learner's catalogue is not pre-chosen; an unmapped topic still is (D2: never blocked).
    expect(revisePrefill(scope({ kind: "competency", competencyId: "99999999-9999-4999-8999-999999999999", materialIds: [] }), have)).toBeNull();
    expect(revisePrefill(null, have)).toBeNull();
  });
  it("Flashcards and Adaptive reuse the same focus on their own rows", () => {
    expect(flashcardPrefill(scope(), have)).toEqual({ open: "notes", materialIds: [M1], topic: "", competencyId: "" });
    expect(flashcardPrefill(scope({ kind: "competency", competencyId: C1 }), have)?.open).toBe("competency");
    expect(adaptivePrefill(scope({ kind: "competency", competencyId: C1 }), have)).toEqual({ kind: "competencies", competencyIds: [C1] });
    expect(adaptivePrefill(scope({ kind: "topic", topic: "AKI" }), have)).toEqual({ kind: "topic", topic: "AKI" });
  });
  it("Apply: from the section for a one-section session, else the competency, else the first material", () => {
    expect(casePrefill(scope({ kind: "section" }), have)).toEqual({ chunkId: K1, from: "teach" });
    expect(casePrefill(scope({ competencyId: C1 }), have)).toEqual({ entry: "competency", competencyId: C1 });
    expect(casePrefill(scope({ materialIds: [M2] }), have)).toEqual({ entry: "notes", materialId: M2 });
    expect(casePrefill(scope({ materialIds: [] }), have)).toBeNull();
  });
  it("OSCE: the competency filter, else the topic search", () => {
    expect(osceFilterPrefill(scope({ competencyId: C1, topic: "x" }))).toEqual({ competency: C1 });
    expect(osceFilterPrefill(scope({ topic: "Chest pain" }))).toEqual({ q: "Chest pain" });
    expect(osceFilterPrefill(scope())).toBeNull();
  });
  it("Evaluate: outcome, competency, topic, one material or several", () => {
    expect(evaluationPrefill(scope({ kind: "competency", competencyId: C1, outcome: "O1" }), have)).toEqual({ kind: "outcome", competencyId: C1, outcome: "O1" });
    expect(evaluationPrefill(scope({ kind: "competency", competencyId: C1 }), have)).toEqual({ kind: "competency", competencyId: C1 });
    expect(evaluationPrefill(scope({ kind: "topic", topic: "Sepsis" }), have)).toEqual({ kind: "topic", topic: "Sepsis" });
    expect(evaluationPrefill(scope(), have)).toEqual({ kind: "document", materialId: M1 });
    expect(evaluationPrefill(scope({ kind: "documents", materialIds: [M1, M2] }), have)).toEqual({ kind: "documents", materialIds: [M1, M2] });
  });
  it("D2: the outcome asked for when it is the competency's, otherwise its first, otherwise none", () => {
    expect(chooseOutcome("B", ["A", "B"])).toBe("B");
    expect(chooseOutcome("Z", ["A", "B"])).toBe("A");
    expect(chooseOutcome(undefined, [])).toBeNull();
  });
});

describe("studyStages (the bar's progress marks)", () => {
  it("Learn is started with its step, or done when the session is completed", () => {
    const [learn] = studyStages({ status: "active", currentStep: 1 }, 4, []);
    expect(learn).toMatchObject({ space: "learn", mark: "started", detail: "Step 2 of 4" });
    expect(studyStages({ status: "completed", currentStep: 3 }, 4, [])[0].mark).toBe("done");
  });
  it("Revise and Apply are started by their own linked activities; Evaluate is done by an evaluation", () => {
    const s = studyStages({ status: "active", currentStep: 0 }, 1, [{ kind: "revision_session" }, { kind: "flashcard_deck" }, { kind: "osce_attempt" }]);
    expect(s.map(x => [x.space, x.mark, x.detail])).toEqual([
      ["learn", "started", "Step 1 of 1"], ["revise", "started", "2 activities"], ["apply", "started", "1 activity"], ["evaluate", "none", "Not yet"],
    ]);
    expect(studyStages({ status: "active", currentStep: 0 }, 0, [{ kind: "evaluation" }])[3]).toMatchObject({ mark: "done", detail: "1 evaluation" });
  });
  it("unreadable links (null) read as nothing linked, never as an error mark", () => {
    expect(studyStages({ status: "active", currentStep: 0 }, 2, null).slice(1).every(x => x.mark === "none")).toBe(true);
  });
});

// ── GUARDS: the session code makes no AI call and writes no assessment, verification, DACUM or Passport row (D5) ──
const SESSION_CODE = [
  "src/lib/individual/scholar/study-carry.ts", "src/lib/individual/scholar/study-context.ts", "src/lib/individual/scholar/study-session.ts",
  "src/app/individual/(app)/[experience]/(scholar)/study/_components/study-session-bar.tsx",
  "src/app/individual/(app)/[experience]/(scholar)/study/_components/study-active.ts",
];
const read = (f: string) => readFileSync(join(process.cwd(), f), "utf8").replace(/^\s*(\/\/|\*|\/\*).*$/gm, "");

describe("guards on the study session code", () => {
  it("D5: no session file names an evaluation, verification, DACUM or Passport table", () => {
    const bad = /individual_scholar_evaluation\b|competency_verification_|dacum|passport_/i;
    expect(SESSION_CODE.filter(f => bad.test(read(f)))).toEqual([]);
  });
  it("stage navigation makes zero AI calls: no session file reaches generation, the AI runner or a vendor SDK", () => {
    const ai = /from "[^"]*(generation|\/http|@\/lib\/ai\/|openai|anthropic)[^"]*"|\bgenerate\(|aiPreflight/;
    expect(SESSION_CODE.filter(f => ai.test(read(f)))).toEqual([]);
  });
});
