/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { judgeKeys, V2_SET, type QuestionItem } from "../../../scripts/ai-eval-set-d5v2";

// D5-v2.1 (owner "IND-007 — MULTI-PROVIDER AI CLOSURE", 25 October 2026): the A-to-E key rule's `when` matched
// "reassessed", so a question about the reassessment interval was judged as if it asked for the first assessment. The
// Opus q.postop flag was determined a rule false positive. This narrows that one rule and nothing else.

const postop = (V2_SET.find(i => i.code === "q.postop") as QuestionItem).rules;
const ate = postop.filter(r => r.label === "a structured A to E assessment");
const q = (stem: string, key: string) => ({ stem, options: [key, "x", "y", "z"], correctIndex: 0 });

describe("D5-v2.1: the A-to-E rule no longer reads 'reassess' as 'assess'", () => {
  it("a reassessment-interval question is not judged by the A-to-E rule", () => {
    expect(judgeKeys([q("Within what time should the observations be reassessed?", "Within 30 minutes")], ate)).toEqual({ judged: 0, violations: [] });
  });

  it("control: a question about the first assessment is still judged, and a wrong key still trips it", () => {
    expect(judgeKeys([q("How should you assess this patient first?", "Sit them upright")], ate).violations.length).toBe(1);
    expect(judgeKeys([q("How should you assess this patient first?", "A structured A to E assessment")], ate).violations).toEqual([]);
    expect(judgeKeys([q("Which structured framework should be used to escalate?", "SBAR")], ate).violations.length).toBe(1);   // items 1-3 untouched
  });

  it("re-scores run 6c2c8067's stored questions offline: only Opus q.postop changes, to passed (Opus 3/3)", () => {
    const run = JSON.parse(readFileSync("docs/evidence/AI-EVAL/run-d5v2-2026-10-25.json", "utf8"));
    expect(run.evalSetVersion).toBe("D5-v2");                                         // the stored run stays what it was
    const items = new Map(V2_SET.filter(i => i.activity === "questions").map(i => [i.code, i as QuestionItem]));
    const changed: string[] = [], opus: boolean[] = [];
    for (const r of run.rows.filter((x: any) => items.has(x.itemCode))) {
      const kept = JSON.parse(r.output ?? "{}").kept ?? [];
      const now = kept.length >= 1 && judgeKeys(kept, items.get(r.itemCode)!.rules).violations.length === 0;
      if (now !== r.passed) changed.push(`${r.modelRequested} ${r.itemCode}`);
      if (r.modelRequested === "claude-opus-4-8") opus.push(now);
    }
    expect(changed).toEqual(["claude-opus-4-8 q.postop"]);
    expect(opus).toEqual([true, true, true]);
  });
});
