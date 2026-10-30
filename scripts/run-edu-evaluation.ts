/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * D5-v4 (SCHOLAR-EDU-AI-01) -- run the clinical_educational evaluation of deeper, check, clarify, simplify, evaluate
 * (and teach/ask on medicines and emergency notes), scripts/ai-eval-set-d5v4.ts, and record it. STAGING ONLY. Same
 * form as run-routing-evaluation.ts (D5-v3): the PRODUCTION generators, the candidate model pinned through the
 * Holdings gateway (pinnedCall), each answer scored on what the student would be shown.
 *
 *   npx tsx scripts/run-edu-evaluation.ts --out docs/evidence/AI-EVAL/run-d5v4-<date>.json [--only-models sonnet,opus,haiku]
 *   npx tsx scripts/run-edu-evaluation.ts --record docs/evidence/AI-EVAL/run-d5v4-<date>.json   (migration 419)
 *
 * The environment comes from `--env-dir <dir>` (its .env.local, loaded by @next/env, never printed), else the cwd.
 * ⚠ It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project AND the gateway's usage log
 *   (NEXT_PUBLIC_SUPABASE_URL) is that same project.
 * ⚠ BUDGET: the run stops before any call once the priced spend passes --max-usd (default 2.00).
 * ⚠ It never writes ai_model_eligibility: it PROPOSES per activity, and a human decides.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";
import { judgeTarget } from "./production-guard";
import { runEvaluate, runExplain, runLearn, type AiRun, type Passage } from "../src/lib/individual/scholar/generation";
import { buildEvidence, runAnswer } from "../src/lib/individual/scholar/exam-answer";
import { ALL_CANDIDATES, pinnedCall, type Candidate } from "./ai-eval-candidates";
import {
  EVAL_SET_VERSION_V4, HAIKU_ACTIVITIES, PASSAGES_V4, TARGET_ACTIVITIES, V4_SET, judgeBoundary, judgeClarify, judgeMark, judgeText, proposeActivity,
  type Judged, type PassageKeyV4, type V4Item,
} from "./ai-eval-set-d5v4";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
loadEnvConfig(arg("env-dir") ?? process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
// The gateway logs plat_ai_requests through NEXT_PUBLIC_SUPABASE_URL: it must be the same staging project.
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x").host !== new URL(url).host) { console.error("REFUSING: the gateway's usage log is not the staging project."); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const EVAL_USER = "00000000-0000-0000-0000-00000000e7a1";

const passage = (k: PassageKeyV4, i = 0): Passage => ({ chunkId: `00000000-0000-0000-0000-0000000d5${String(i).padStart(3, "0")}`, materialId: "00000000-0000-0000-0000-0000000d5bbb",
  materialTitle: `D5-v4 study notes (${k})`, ordinal: i + 1, pageFrom: 1, pageTo: 1, content: PASSAGES_V4[k], unit: "page" } as Passage);
// The learn/act route's canned prompts (CANNED), so each action asks exactly what a student's button press asks.
const CANNED: Record<string, string> = { teach: "Teach me this step.", simplify: "Explain this as simply as possible.", deeper: "Help me understand this in more depth.", check: "Check my understanding of this." };
// Production fallbacks (policy.ts): scholar_beyond_notes "labelled" (background on for teach/deeper/examples), depth "standard".
const BACKGROUND = true, DEPTH = "standard";

type Res = Judged & { shown: string | null; withheld: string | null };
const err = (e: string): Res => ({ shown: null, withheld: `error:${e}`, passed: false, score: 0, safetyFailure: false, checks: {} });

async function runItem(it: V4Item, run: AiRun): Promise<Res> {
  if (it.via === "evaluate") {
    const r: any = await runEvaluate(EVAL_USER, { question: it.question, accepted: it.accepted, answer: it.answer, passage: passage(it.passage) }, run);
    if (!r.ok) return err(r.error);
    const ev = r.evaluation;
    return { shown: ev.ok ? `VERDICT: ${ev.verdict}\n${ev.feedback}` : null, withheld: ev.ok ? null : ev.reason, ...judgeMark(it, ev.ok ? ev.verdict : null) };
  }
  const ps = it.passages.map((k, i) => passage(k, i));
  if (it.via === "exam") {
    const r: any = await runAnswer(run as any, EVAL_USER, { question: it.question, evidence: buildEvidence(ps, [], []), attempt: it.attempt, optionLabels: [] });
    if (!r.ok) return err(r.error);
    if (!r.check.ok) return { shown: null, withheld: r.check.reason, ...judgeText(it.code, it, null) };
    const c = r.check.content;
    const shown = [`EXAM ANSWER: ${c.examAnswer}`, `EXPLANATION: ${c.explanation}`, c.currentGuidance ? `CURRENT GUIDANCE: ${c.currentGuidance}` : null,
      c.unsupported.length ? `UNSUPPORTED: ${c.unsupported.join("; ")}` : null, c.uncertainty.length ? `UNCERTAINTY: ${c.uncertainty.join("; ")}` : null].filter(Boolean).join("\n");
    return { shown, withheld: null, ...judgeText(it.code, it, shown) };
  }
  if (it.via === "explain") {
    const r: any = await runExplain(EVAL_USER, it.question, ps, it.activity, [], null, run);
    if (!r.ok) return err(r.error);
    if (!r.check.ok) return { shown: null, withheld: r.check.reason, ...judgeText(it.code, it, null) };
    const extra = r.supplementary?.ok ? r.supplementary.text : "";
    const shown = extra ? `${r.check.text}\n\nBEYOND THE NOTES: ${extra}` : r.check.text;
    return { shown, withheld: null, ...judgeText(it.code, it, r.check.text, extra) };
  }
  // Learn
  const question = it.activity === "clarify" ? `Your check question was: ${it.checkQuestion}\nMy answer: ${it.answer}` : it.activity === "ask" ? it.question! : CANNED[it.activity];
  const r: any = await runLearn(EVAL_USER, { action: it.activity, question, passages: ps, references: [], depth: DEPTH as any, background: BACKGROUND, history: [], learnerContext: null }, run);
  if (!r.ok) return err(r.error);
  if (it.activity === "check") {
    const q = r.question;
    return q?.ok ? { shown: q.question, withheld: null, ...judgeText(it.code, it, q.question) } : { shown: null, withheld: q?.reason ?? "malformed", ...judgeText(it.code, it, null) };
  }
  if (!r.check.ok) {
    const withheld = r.check.reason;
    const j = it.via === "learn" && "boundary" in it && it.boundary ? judgeBoundary(it.code, it, null, withheld) : judgeText(it.code, it, null);
    return { shown: null, withheld, ...j, checks: { ...j.checks, violations: r.check.violations?.map((v: any) => v.kind ?? v) } };
  }
  const bg = r.background?.ok ? r.background.text : "";
  const flags = (r.flags?.kept ?? []).map((f: any) => f.text).join("\n");
  const extra = [bg, flags].filter(Boolean).join("\n");
  const shown = [r.check.text, bg ? `BEYOND THE NOTES: ${bg}` : null, flags ? `CHECK THIS: ${flags}` : null].filter(Boolean).join("\n\n");
  const shownWithVerdict = it.activity === "clarify" ? `VERDICT: ${r.verdict ?? "none"}\n${shown}` : shown;
  const j = it.activity === "clarify" ? judgeClarify(it, r.verdict, r.check.text) : judgeText(it.code, it, r.check.text, extra);
  // judgeClarify scans the answer; background/flags are scanned here for the clarify case too.
  if (it.activity === "clarify" && extra && judgeText(it.code, it, "", extra).safetyFailure) { j.safetyFailure = true; j.passed = false; }
  return { shown: shownWithVerdict, withheld: null, ...j };
}

async function run(out: string) {
  const want = (arg("only-models") ?? "sonnet,opus,haiku").split(",");
  const cands: Candidate[] = ALL_CANDIDATES.filter(c => c.provider === "anthropic" && want.some(w => c.model.includes(w)));
  const maxUsd = Number(arg("max-usd") ?? "2.00");
  const startedAt = new Date().toISOString();
  const rows: any[] = []; let spent = 0;
  for (const c of cands) {
    const price = (await admin.rpc("ai_price_at", { p_provider: c.provider, p_model: c.model, p_at: new Date().toISOString() })).data;
    if (!price?.id) { console.error(`No staging price row for ${c.model}: refusing to run unpriced.`); process.exit(1); }
    const items = c.model.includes("haiku") ? V4_SET.filter(i => HAIKU_ACTIVITIES.includes(i.activity)) : V4_SET;
    for (const item of items) {
      if (spent > maxUsd) { console.error(`BUDGET: spent $${spent.toFixed(4)} > $${maxUsd}; stopping before ${c.model} ${item.code}.`); break; }
      let inT = 0, outT = 0, calls = 0, returned: string | null = null;
      const pinned: AiRun = async g => {
        calls++;
        const m = await pinnedCall(c, { system: g.system, user: g.user, maxTokens: g.maxTokens ?? 1500 });
        inT += m.input ?? 0; outT += m.output ?? 0;
        if (m.ok) { returned = m.model; return { ok: true, text: m.text, provider: c.provider, model: m.model, usage: { input: m.input, output: m.output } } as any; }
        return { ok: false, error: m.refusal ? "refusal" : "failed", detail: m.error } as any;
      };
      const t0 = Date.now();
      let res: Res;
      try { res = await runItem(item, pinned); } catch (e: any) { res = err(String(e?.message ?? e).slice(0, 200)); }
      const cost = +((inT * +price.input_per_mtok_usd + outT * +price.output_per_mtok_usd) / 1e6 + calls * +price.extra_per_request_usd).toFixed(6);
      spent += cost;
      rows.push({ itemCode: item.code, task: item.activity, via: item.via, tier: "clinical_educational", provider: c.provider, modelRequested: c.model, modelReturned: returned, inputTokens: inT, outputTokens: outT, calls,
        costUsd: cost, priceId: price.id, latencyMs: Date.now() - t0, status: res.withheld?.startsWith("error:refusal") ? "refusal" : res.withheld?.startsWith("error") ? "error" : "ok",
        output: res.shown, withheld: res.withheld, checks: res.checks, score: res.score, passed: res.passed, safetyFailure: res.safetyFailure });
      console.log(`  ${c.model.padEnd(26)} ${item.code.padEnd(40)} ${res.passed ? "PASS" : "----"}${res.safetyFailure ? " SAFETY" : ""} ${res.withheld ? `withheld:${res.withheld}` : ""} calls ${calls} in ${inT} out ${outT} $${cost}`);
    }
  }
  const finishedAt = new Date().toISOString();
  // Actual usage as the gateway logged it (plat_ai_requests), for this run's window and operation only.
  const { data: logged } = await admin.from("plat_ai_requests").select("model, input_tokens, output_tokens, cost_usd, status")
    .eq("operation", "ai_model_evaluation").gte("created_at", startedAt).lte("created_at", new Date(Date.now() + 5000).toISOString());
  const ledger = cands.map(c => { const ls = (logged ?? []).filter((l: any) => (l.model ?? "").startsWith(c.model.replace(/-\d{8}$/, "")));
    return { model: c.model, requests: ls.length, inputTokens: ls.reduce((s: number, l: any) => s + (l.input_tokens ?? 0), 0), outputTokens: ls.reduce((s: number, l: any) => s + (l.output_tokens ?? 0), 0),
      costUsd: +ls.reduce((s: number, l: any) => s + Number(l.cost_usd ?? 0), 0).toFixed(6) }; });
  const proposals = cands.flatMap(c => TARGET_ACTIVITIES.filter(a => !c.model.includes("haiku") || HAIKU_ACTIVITIES.includes(a)).map(a => {
    const p = proposeActivity(rows.filter(r => r.modelRequested === c.model && r.task === a), a, "D5-v4");
    return { provider: c.provider, model: c.model, activity: a, tier: p.tier, rationale: p.rationale };
  }));
  const totals = cands.map(c => { const rs = rows.filter(r => r.modelRequested === c.model);
    return { model: c.model, passed: rs.filter(r => r.passed).length, of: rs.length, safetyFailures: rs.filter(r => r.safetyFailure).length, calls: rs.reduce((s, r) => s + r.calls, 0),
      costUsd: +rs.reduce((s, r) => s + r.costUsd, 0).toFixed(6), perRequestUsd: +(rs.reduce((s, r) => s + r.costUsd, 0) / Math.max(1, rs.reduce((s, r) => s + r.calls, 0))).toFixed(6) }; });
  writeFileSync(out, JSON.stringify({ evalSetVersion: EVAL_SET_VERSION_V4, ranAt: startedAt, finishedAt, target: (verdict as any).ref, prompt: "production Scholar generators (runLearn, runExplain, runAnswer, runEvaluate), model pinned", background: BACKGROUND, depth: DEPTH, totals, ledger, proposals, rows }, null, 1));
  console.log(JSON.stringify({ totals, ledger, proposals: proposals.map(p => `${p.model} ${p.activity}: ${p.tier ?? "none"}`) }, null, 1));
  console.log(`Evidence written to ${out}. Nothing written to the database except the gateway's own usage rows.`);
}

async function record(file: string) {
  const ev = JSON.parse(readFileSync(file, "utf8"));
  const { data: runRow, error } = await admin.from("ai_model_evaluation_run").insert({ eval_set_version: ev.evalSetVersion, label: `D5-v4 Scholar clinical educational ${ev.ranAt.slice(0, 10)}`,
    note: `SCHOLAR-EDU-AI-01. Sonnet 4.6, Opus 4.8 as escalation, Haiku 4.5 on simplify only. Learn teach/ask/deeper/simplify/check/clarify, Explain deeper/simplify, practice-paper answer (deeper), short-answer evaluate. Synthetic medicines, emergency, paediatric and pyelonephritis notes, no patient data. Evidence file ${file}. An evaluation, not an eligibility decision.` }).select("id").single();
  if (error) throw new Error(error.message);
  const res = await admin.from("ai_model_evaluation_result").insert(ev.rows.map((r: any) => ({
    run_id: runRow.id, item_code: r.itemCode, task: r.task, risk_tier: r.tier, provider: r.provider, model_requested: r.modelRequested, model_returned: r.modelReturned,
    input_tokens: r.inputTokens, output_tokens: r.outputTokens, cost_usd: r.costUsd, price_id: r.priceId, latency_ms: r.latencyMs, status: r.status, output: r.output,
    rubric: { checks: r.checks, calls: r.calls, via: r.via, withheld: r.withheld, safetyFailure: r.safetyFailure }, score: r.score, passed: r.passed,
  })));
  if (res.error) throw new Error(res.error.message);
  const pr = await admin.from("ai_model_evaluation_proposal").insert(ev.proposals.map((p: any) => ({
    run_id: runRow.id, product: "scholar", activity: p.activity, provider: p.provider, model_prefix: p.model, proposed_max_risk_tier: p.tier, rationale: p.rationale })));
  if (pr.error) throw new Error(pr.error.message);
  console.log(`Recorded run ${runRow.id}: ${ev.rows.length} results, ${ev.proposals.length} proposals. No eligibility written.`);
}

const out = arg("out"), rec = arg("record");
(out ? run(out) : rec ? record(rec) : Promise.reject(new Error("Pass --out <file> or --record <file>."))).catch(e => { console.error(e.message ?? e); process.exit(1); });
