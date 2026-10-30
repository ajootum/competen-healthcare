/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * D5-v4: re-score a stored run under the CURRENT rubric (scripts/ai-eval-set-d5v4.ts), offline. No model is called, no
 * database is touched. Only rows whose shown text the judge can re-read unchanged are re-scored: Learn check questions
 * (the shown text IS the question) and Explain simplify answers (simplify carries no background). Every changed row
 * keeps its earlier verdict under `original`. Proposals and totals are recomputed.
 *
 *   npx tsx scripts/rescore-d5v4.ts docs/evidence/AI-EVAL/run-d5v4-<date>.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { HAIKU_ACTIVITIES, TARGET_ACTIVITIES, V4_SET, judgeText, proposeActivity } from "./ai-eval-set-d5v4";

const file = process.argv[2];
if (!file) { console.error("Pass the evidence file."); process.exit(1); }
const ev = JSON.parse(readFileSync(file, "utf8"));
const changed: string[] = [];
for (const r of ev.rows) {
  const it = V4_SET.find(i => i.code === r.itemCode);
  const rereadable = it && ((it.activity === "check") || (it.via === "explain" && it.activity === "simplify"));
  if (!it || !rereadable) continue;
  const j = judgeText(it.code, it as any, r.output ?? null);
  if (j.passed !== r.passed || j.safetyFailure !== r.safetyFailure) {
    r.original = r.original ?? { passed: r.passed, safetyFailure: r.safetyFailure, score: r.score, checks: r.checks };
    Object.assign(r, { passed: j.passed, safetyFailure: j.safetyFailure, score: j.score, checks: j.checks });
    changed.push(`${r.modelRequested} ${r.itemCode}: ${r.original.passed ? "pass" : "miss"}${r.original.safetyFailure ? "+SAFETY" : ""} -> ${j.passed ? "pass" : "miss"}${j.safetyFailure ? "+SAFETY" : ""}`);
  }
}
const models = [...new Set(ev.rows.map((r: any) => r.modelRequested))] as string[];
ev.proposals = models.flatMap(m => TARGET_ACTIVITIES.filter(a => !m.includes("haiku") || HAIKU_ACTIVITIES.includes(a)).map(a => {
  const p = proposeActivity(ev.rows.filter((r: any) => r.modelRequested === m && r.task === a), a, "D5-v4");
  return { provider: "anthropic", model: m, activity: a, tier: p.tier, rationale: p.rationale };
}));
ev.totals = models.map(m => { const rs = ev.rows.filter((r: any) => r.modelRequested === m);
  const t = ev.totals?.find((x: any) => x.model === m) ?? {};
  return { ...t, model: m, passed: rs.filter((r: any) => r.passed).length, of: rs.length, safetyFailures: rs.filter((r: any) => r.safetyFailure).length }; });
ev.rescore = { at: new Date().toISOString(), changed, note: "Rubric corrected before recording: the check-question dose pattern matched a mention of a dose, and explain.simplify.paeds required escalation its question does not ask. Re-scored offline; no model called." };
writeFileSync(file, JSON.stringify(ev, null, 1));
console.log(changed.length ? changed.join("\n") : "No row changed.");
console.log(ev.proposals.map((p: any) => `${p.model} ${p.activity}: ${p.tier ?? "none"}`).join("\n"));
