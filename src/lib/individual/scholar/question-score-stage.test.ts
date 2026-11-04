// SQIE-CLOSE-2026-11 WS-H (directive s7): A QUESTION SCORE NEVER SETS A COMPETENCY STAGE.
//
// "Do not convert a single MCQ score directly into a Benner/DACUM competence stage." Stages 0-6 come only from a published
// scale-to-stage mapping (660, src/lib/competency/stage-mapping.ts) applied by an authorised verification decision (690) or a
// progression decision (892), never from practice. This file pins that, three ways:
//   1. no Scholar module imports the stage mapping or the Benner scale;
//   2. no module that records, snapshots or reads a question attempt imports the assessment layer or names a table or column
//      that holds a stage (the 893 self-assessment adapter is a separate evidence class and is not a question score);
//   3. the rows a question attempt writes -- the 416/950 attempt and the 791/990 snapshot -- hold exactly their known columns,
//      none of them a stage, for a perfect score of every marking.
// Each scanner is first shown to catch a planted violation, so a green run means something.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAttemptSnapshot, snapshotInsertRow } from "./attempt-snapshot";
import type { QuestionRow } from "./store";

const ROOTS = ["src/lib/individual/scholar", "src/app/api/individual/scholar", "src/app/individual/(app)/[experience]/(scholar)"];
const walk = (d: string): string[] => readdirSync(d).flatMap(f => {
  const p = join(d, f);
  return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
});
const FILES = ROOTS.flatMap(walk).map(p => ({ path: p.replace(/\\/g, "/"), src: readFileSync(p, "utf8") }));

const importsOf = (src: string) => [...src.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(m => m[1]);
/** Pure. The stage modules a source imports. */
const stageImports = (src: string) => importsOf(src).filter(s => /(^|\/)competency\/stage-mapping$|(^|\/)benner$/.test(s));
/** A module on the question-score path: it records, snapshots or reads question attempts. */
const ATTEMPT_PATH = /individual_scholar_attempt\b|individual_scholar_attempt_snapshot|recordAttempt\b|recordRevisionAttempt|recordCheckAttempt|keepAttemptSnapshot|keepCheckAttemptSnapshot|attemptIntegrity\b|buildAttemptSnapshot/;
/** Tables and columns that hold a competency stage (660, 690, 892, 893). */
const STAGE_HOLDERS = /\b(competency_stage(_mapping(_band)?)?|competency_verification_decision|asmt_progression_decision|asmt_scholar_stage_band|stage_code|stage_mapping_id)\b/;
/** Pure. Why an attempt-path source could reach a stage, or null. */
function stageReach(src: string): string | null {
  if (!ATTEMPT_PATH.test(src)) return null;
  const a = importsOf(src).find(s => s.startsWith("@/lib/assessment") || /competency\/(stage-mapping|verification)/.test(s));
  if (a) return `imports ${a}`;
  const t = STAGE_HOLDERS.exec(src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
  return t ? `names ${t[1]}` : null;
}

describe("a question score never sets a competency stage (WS-H)", () => {
  it("the scanners catch a planted violation (the control can fail)", () => {
    expect(stageImports(`import { stageFor } from "@/lib/competency/stage-mapping";`)).toEqual(["@/lib/competency/stage-mapping"]);
    expect(stageImports(`import { getBennerLabel } from "../../benner";`)).toEqual(["../../benner"]);
    expect(stageReach(`import { x } from "@/lib/assessment/adapters/scholar/store";\nawait recordAttempt(a, b, q, 1);`)).toMatch(/imports/);
    expect(stageReach(`await keepAttemptSnapshot(ctx, q, a);\nawait admin.from("competency_verification_decision").insert({ stage_code: "competent" });`)).toMatch(/names/);
    // A comment naming a stage table is not a reach; a file off the attempt path is not scanned.
    expect(stageReach(`// competency_stage is never read here\nawait recordCheckAttempt(a, b, c);`)).toBeNull();
    expect(stageReach(`await admin.from("competency_stage").select("code");`)).toBeNull();
  });

  it("the scan reads the real Scholar tree", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.filter(f => ATTEMPT_PATH.test(f.src)).length).toBeGreaterThan(5);
  });

  it("no Scholar module imports the stage mapping or the Benner scale", () => {
    expect(FILES.flatMap(f => stageImports(f.src).map(s => `${f.path}: ${s}`))).toEqual([]);
  });

  it("no module on the question-attempt path imports the assessment layer or names a stage table or column", () => {
    expect(FILES.flatMap(f => { const r = stageReach(f.src); return r ? [`${f.path}: ${r}`] : []; })).toEqual([]);
  });

  it("a perfect score of every marking writes a snapshot with exactly its 791/990 columns, none a stage", () => {
    const q = {
      id: "11111111-1111-4111-8111-111111111111", materialId: "m", chunkId: "c", kind: "mcq", stem: "Which sign comes first?", options: ["Fever", "Rash", "Cough", "Pain"],
      correctIndex: 0, rationale: "The notes say fever.", sourceQuote: "Fever comes first.", model: "m", promptVersion: "p", createdAt: "2026-11-04T00:00:00Z",
      answer: null, difficulty: 2, materialTitle: "Notes", ordinal: 1, pageFrom: null, pageTo: null, unit: "page", latest: null,
      competencyId: "22222222-2222-4222-8222-222222222222", caseId: null, caseStep: null, caseTitle: null,
    } as unknown as QuestionRow;
    const COLUMNS = ["answer_key", "assessed_at", "attempt_id", "competency_ids", "competency_provenance", "content_hash", "feedback", "marking", "outcome", "presented", "question_id", "question_version", "response", "rubric", "rubric_hash", "score"];
    for (const marking of ["deterministic", "self_graded", "ai_evaluation"]) {
      const s = buildAttemptSnapshot(q, {
        attemptId: "33333333-3333-4333-8333-333333333333", answeredAt: "2026-11-04T10:00:00Z", chosenIndex: 0, response: null, correct: true, score: 1, marking,
        provenance: [{ competencyId: q.competencyId!, frameworkId: "44444444-4444-4444-8444-444444444444", frameworkCode: "NMC", frameworkVersion: "2.1.0", contentHash: "abc" }],
      });
      expect(s).not.toBeNull();
      const row = snapshotInsertRow(s!);
      expect(Object.keys(row).sort()).toEqual(COLUMNS);
      expect(JSON.stringify(row)).not.toMatch(/stage_code|"stage"|benner|novice|proficient|expert|advanced.beginner|verified_competence/i);
      expect(row.outcome).toBe("correct");
    }
  });
});
