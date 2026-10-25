/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * IND-007 owner decision D5 -- run the focused evaluation set against candidate models, and record the evidence.
 *
 *   npx tsx scripts/run-model-evaluation.ts --out docs/evidence/AI-EVAL/run-<date>.json
 *       Calls each candidate with the production Scholar prompt (src/lib/individual/personal-ai.ts), scores every
 *       answer (src/lib/ai/model-evaluation.ts), prices it at the staging price row in force, and writes the
 *       evidence file. It writes NOTHING to the database.
 *   npx tsx scripts/run-model-evaluation.ts --record docs/evidence/AI-EVAL/run-<date>.json
 *       STAGING ONLY, needs migration 419. Records that file as one run, its results, and the eligibility each model's
 *       results would support (ai_model_evaluation_proposal). It never writes ai_model_eligibility.
 *
 * ⚠ IT PROPOSES, A HUMAN DECIDES. Eligibility is recorded on the HQ page by the owner or an appointed clinical reviewer,
 * citing the run. A premium model is proposed for a tier only when its answers pass, never because it is premium.
 *
 * Candidates: the models this deployment can call. Anthropic's three tiers have a key on staging. OpenAI and Gemini
 * have no key there, so they are recorded as not evaluated rather than guessed at.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { judgeTarget } from "./production-guard";
import { scoreAnswer, proposeTier, type EvalScore } from "../src/lib/ai/model-evaluation";
import { assistantSystemPrompt, assistantUserMessage } from "../src/lib/individual/personal-ai";
import { EVAL_SET, EVAL_SET_VERSION } from "./ai-eval-set-d5";
import { PROVISIONAL_ACTIVITIES } from "./ai-provisional-policy";
import { evaluationCandidates, pinnedCall, registeredCandidates } from "./ai-eval-candidates";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };

// Every provider the gateway supports. Those without a key here are reported NOT EVALUATED (ai-eval-candidates.ts).
// --only anthropic,openai narrows the run.
const { candidates: CANDIDATES, notEvaluated: NOT_EVALUATED } = evaluationCandidates(arg("only"));

type Row = { itemCode: string; task: string; tier: string; provider: string; modelRequested: string; modelReturned: string | null; inputTokens: number | null; outputTokens: number | null;
  costUsd: number | null; priceId: string | null; latencyMs: number; status: "ok" | "refusal" | "error"; output: string | null; error?: string; score: EvalScore };

async function run(out: string) {
  // Registered providers (no-code, provider-registry.ts) that are active here join the same run. --only narrows them too.
  const only = arg("only");
  for (const c of await registeredCandidates(admin)) if (!only || only.split(",").includes(c.provider)) CANDIDATES.push(c);
  if (!CANDIDATES.length) { console.error(`Nothing can be evaluated here: ${NOT_EVALUATED.map(n => n.why).join("; ")}.`); process.exit(1); }
  const rows: Row[] = [];
  for (const c of CANDIDATES) {
    const price = (await admin.rpc("ai_price_at", { p_provider: c.provider, p_model: c.model, p_at: new Date().toISOString() })).data;
    for (const item of EVAL_SET) {
      const system = assistantSystemPrompt("scholar", item.mode);
      const grounding = item.study ? [`Study material (from the person's own Scholar workspace):\n${item.study}`] : [];
      const user = assistantUserMessage(item.mode, grounding, { question: item.prompt });
      const t0 = Date.now();
      let row: Row;
      try {
        const m = await pinnedCall(c, { system, user, maxTokens: 1500 });
        const inT = m.input ?? null, outT = m.output ?? null;
        const cost = price?.id && inT !== null && outT !== null ? +((inT * +price.input_per_mtok_usd + outT * +price.output_per_mtok_usd) / 1e6 + +price.extra_per_request_usd).toFixed(6) : null;
        const status: Row["status"] = m.ok ? "ok" : m.refusal ? "refusal" : "error";
        const text = m.ok ? m.text : null;
        row = { itemCode: item.code, task: item.task, tier: item.tier, provider: c.provider, modelRequested: c.model, modelReturned: m.ok ? m.model : null, inputTokens: inT, outputTokens: outT,
          costUsd: cost, priceId: price?.id ?? null, latencyMs: Date.now() - t0, status, output: text, ...(m.ok ? {} : { error: m.error }), score: scoreAnswer(item, status === "ok" ? text : null) };
      } catch (e: any) {
        row = { itemCode: item.code, task: item.task, tier: item.tier, provider: c.provider, modelRequested: c.model, modelReturned: null, inputTokens: null, outputTokens: null,
          costUsd: null, priceId: price?.id ?? null, latencyMs: Date.now() - t0, status: "error", output: null, error: String(e?.message ?? e).slice(0, 300), score: scoreAnswer(item, null) };
      }
      rows.push(row);
      console.log(`  ${c.model.padEnd(28)} ${item.code.padEnd(26)} ${row.status.padEnd(7)} score ${row.score.score.toFixed(2)} ${row.score.passed ? "PASS" : "----"} $${row.costUsd ?? "?"}`);
    }
  }
  const proposals = CANDIDATES.map(c => {
    const passed = new Map(rows.filter(r => r.modelRequested === c.model).map(r => [r.itemCode, r.score.passed]));
    return { provider: c.provider, model: c.model, ...proposeTier(EVAL_SET, passed) };
  });
  const totals = CANDIDATES.map(c => {
    const rs = rows.filter(r => r.modelRequested === c.model);
    return { model: c.model, passed: rs.filter(r => r.score.passed).length, of: rs.length, costUsd: +rs.reduce((s, r) => s + (r.costUsd ?? 0), 0).toFixed(6), returned: [...new Set(rs.map(r => r.modelReturned).filter(Boolean))] };
  });
  writeFileSync(out, JSON.stringify({ evalSetVersion: EVAL_SET_VERSION, ranAt: new Date().toISOString(), target: (verdict as any).ref, prompt: "assistantSystemPrompt('scholar', mode), production", notEvaluated: NOT_EVALUATED, totals, proposals, rows }, null, 1));
  console.log(JSON.stringify({ totals, proposals }, null, 1));
  console.log(`Evidence written to ${out}. Nothing written to the database.`);
}

async function record(file: string) {
  const ev = JSON.parse(readFileSync(file, "utf8"));
  const probe = await admin.from("ai_model_evaluation_run").select("id").limit(0);
  if (probe.error) { console.error(`Migration 419 is not applied here (${probe.error.message}). Nothing written.`); process.exit(1); }
  const { data: runRow, error } = await admin.from("ai_model_evaluation_run").insert({ eval_set_version: ev.evalSetVersion, label: `D5 evaluation ${ev.ranAt.slice(0, 10)}`,
    note: `Production Scholar prompt. Not evaluated: ${ev.notEvaluated.map((n: any) => `${n.provider} (${n.why})`).join(", ")}. Evidence file ${file}.` }).select("id").single();
  if (error) throw new Error(error.message);
  const res = await admin.from("ai_model_evaluation_result").insert(ev.rows.map((r: Row) => ({
    run_id: runRow.id, item_code: r.itemCode, task: r.task, risk_tier: r.tier, provider: r.provider, model_requested: r.modelRequested, model_returned: r.modelReturned,
    input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd, price_id: r.priceId, latency_ms: r.latencyMs, status: r.status, output: r.output,
    rubric: { required: r.score.required, forbidden: r.score.forbidden, error: r.error ?? null }, score: r.score.score, passed: r.score.passed,
  })));
  if (res.error) throw new Error(res.error.message);
  const props = ev.proposals.flatMap((p: any) => (["scholar", "professional"] as const).flatMap(product => Object.keys(PROVISIONAL_ACTIVITIES[product]).map(activity => ({
    run_id: runRow.id, product, activity, provider: p.provider, model_prefix: p.model, proposed_max_risk_tier: p.tier, rationale: p.rationale,
  }))));
  const pr = await admin.from("ai_model_evaluation_proposal").insert(props);
  if (pr.error) throw new Error(pr.error.message);
  console.log(`Recorded run ${runRow.id}: ${ev.rows.length} results, ${props.length} proposals. No eligibility written.`);
}

const out = arg("out"), rec = arg("record");
(out ? run(out) : rec ? record(rec) : Promise.reject(new Error("Pass --out <file> or --record <file>."))).catch(e => { console.error(e.message ?? e); process.exit(1); });
