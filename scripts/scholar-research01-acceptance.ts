/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-RESEARCH-01 ACCEPTANCE -- a local build against STAGING, with REAL capabilities: live PubMed, OpenAlex and
 * Crossref, the real model, staging's real AI policy, risk rules and ai_model_eligibility rows.
 *
 *   R1  Research & Explain on a clinical-educational Learn step (thin oxygen-therapy notes): the Holdings research
 *       service returns genuine records (PMID from PubMed, DOI confirmed by Crossref), only verified abstracts are evidence
 *   R2  the subject is classified clinical educational by the published risk rules
 *   R3  the cheapest ELIGIBLE model is chosen by routing: production's published D1 lists (scholar.teach: Sonnet, Opus)
 *       over staging's eligibility rows -- Sonnet is not eligible at clinical educational, so Opus
 *   R4  the ONE Learn engine writes the answer; the research part passes its own checks, cites [E n] that map to the
 *       provider records, and is kept apart from the notes part (which never cites [E n])
 *   R5  a high-risk topic is still refused: classified high-risk clinical, no eligible model, and staging's real gate
 *       (the one the route calls BEFORE any search, scholarRiskGate) refuses it
 *   R6  with nothing published, Learn is notes only, staging's engine is not operational and no seeded source is invocable
 *   R7  research usage (630) is recorded under the Scholar AI action and attributed to its outcome (600)
 *   R8  retention runs through the existing job runner (plat_job_runs) and keeps current records
 *
 * ⚠ STAGING ONLY. It writes NO configuration: the research policy and the D1 routing lists are applied in memory. The
 * rows it causes: the gateway's plat_ai_requests rows for the R4 call, this run's plat_research_requests and plat_ai_outcomes
 * rows (codes and counts only), and one plat_job_runs row for R8 (operation
 * individual_scholar_learn_research), exactly as scripts/run-routing-evaluation.ts does.
 *
 *   npx tsx scripts/scholar-research01-acceptance.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
if (new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://x").host !== new URL(url).host) { console.error("REFUSING: the gateway's usage log is not the staging project."); process.exit(1); }

const EVAL_USER = "00000000-0000-0000-0000-00000000e7a1";
const NOTES = [
  "Oxygen therapy notes.",
  "Oxygen is given to reach a target saturation range.",
  "Monitor the oxygen saturation and escalate to the nurse in charge if hypoxaemia worsens.",
];
const HIGH_RISK = "Calculate the insulin dose and adjust the insulin infusion rate for a patient with sepsis.";

let pass = 0; const fails: string[] = [];
const ok = (n: string, c: boolean, d = "") => { if (c) { pass++; console.log(`  PASS  ${n}`); } else { fails.push(n); console.log(`  FAIL  ${n}${d ? ` -- ${d}` : ""}`); } };
const note = (s: string) => console.log(`        ${s}`);

(async () => {
  const { resolvePolicy, policyPath } = await import("../src/lib/individual/policy");
  const { runResearch } = await import("../src/lib/holdings/research/service");
  const { researchEvidence, externalReferences } = await import("../src/lib/individual/scholar/learn-research");
  const { SEED_REGISTRY, resolveRegistry, notInvocable } = await import("../src/lib/holdings/research/registry");
  const { DEFAULT_POLICY, resolveWorkflows, workflowOperational } = await import("../src/lib/holdings/research/engine-config");
  const { loadResearchEngine, researchOperational } = await import("../src/lib/holdings/research/load");
  const { runLearn, LEARN_RESEARCH_OPERATION } = await import("../src/lib/individual/scholar/generation");
  const { generate } = await import("../src/lib/ai/client") as any;
  const { aiStatus } = await import("../src/lib/ai/config");
  const { withinRequestRisk } = await import("../src/lib/individual/scholar/http");
  const { researchUsage, researchCostByOutcome } = await import("../src/lib/holdings/research/load");
  const { recordAiOutcome } = await import("../src/lib/ai/outcomes");
  const { runJob } = await import("../src/lib/platform/jobs");
  const ACTION = (await import("node:crypto")).randomUUID();
  const { loadProductPolicy, loadModelRouting, resolveRiskSubject, unmeteredGate } = await import("../src/lib/ai/allowance");
  const { classifyRisk } = await import("../src/lib/ai/clinical-risk");
  const { routeCandidates, selectRoute, clinicalGate } = await import("../src/lib/ai/model-routing");
  const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

  // In memory only: the owner's publication this acceptance assumes. Nothing is written.
  const published = (await admin.from("workspace_config_overrides").select("config_path, published").eq("scope_type", "platform").eq("scope_ref", "individual").like("config_path", "individual.policy.%")).data ?? [];
  resolvePolicy([...published, { config_path: policyPath("scholar_learn_source_modes"), published: { enabled: ["notes", "library", "research"] } }]);
  // The engine as the owner would leave it after the Phase 1 lifecycle (Integrated, Evaluated, Approved, Active), in memory.
  const stamp = { at: new Date().toISOString(), by: "acceptance", ok: true, detail: "in-memory acceptance only" };
  const registry = resolveRegistry(Object.fromEntries(["pubmed", "openalex", "crossref", "google_scholar_link"].map(id => [id, { ...SEED_REGISTRY[id], status: "active", checks: { connectivity: stamp, approval: stamp, activation: stamp } }])));
  const plan = { product: "scholar" as const, activity: "learn" as const, registry, policy: DEFAULT_POLICY, workflow: resolveWorkflows({ basic: { status: "active" } }).basic };
  const usage: any[] = [];

  console.log("R1  live research");
  // Real research usage rows on staging (630), under this action's id, through the engine's own recorder and budgets.
  const recorder = researchUsage(admin, { actionId: ACTION, product: "scholar", operation: LEARN_RESEARCH_OPERATION, workflow: "basic", policy: plan.policy });
  const research = await runResearch("oxygen therapy target saturation", plan, { usage: { record: async (row: any) => { usage.push(row); await recorder.record(row); }, allow: recorder.allow } });
  const lr = { state: research.state as any, message: null, query: research.query, scholarLink: research.scholarLink, items: research.items, evidence: research.evidence, calls: research.calls, codes: research.codes,
    sourceVersions: research.sourceVersions, excerptChars: DEFAULT_POLICY.rules.excerptChars, furtherReading: true, licensing: Object.fromEntries(Object.values(registry).map((r: any) => [r.id, r.licensing])) };
  note(`research usage recorded apart from AI: ${usage.map(u => `${u.provider} ${u.capability} ${u.requests} req ${u.outcome} ${u.costUsd}`).join("; ")}`);
  note(`Google Scholar link (Active link record only): ${research.scholarLink}`);
  for (const r of externalReferences(lr)) note(`${r.tag ?? "--"} ${r.provider} PMID ${r.pmid ?? "-"} DOI ${r.doi ?? "-"} verified pmid=${r.verified.pmid} doi=${r.verified.doi} ${r.evidence ? "EVIDENCE" : "further reading"} | ${r.title.slice(0, 70)} (${r.year})`);
  note(`calls: ${JSON.stringify(research.calls)} codes: ${research.codes.join(",") || "-"}`);
  ok("R1. genuine records came back, each with its own record link, and at least one verified abstract is evidence",
    research.state === "searched" && research.items.length > 0 && research.evidence.length > 0
    && research.items.every(i => /^https:\/\/(pubmed\.ncbi\.nlm\.nih\.gov|doi\.org|openalex\.org)\//.test(i.url))
    && research.evidence.every(n => research.items[n].abstract && (research.items[n].verified.pmid || research.items[n].verified.doi === true)));

  console.log("R2  risk");
  const passages = NOTES.map((content, i) => ({ chunkId: `c${i}`, materialId: "m", materialTitle: "Oxygen therapy notes", ordinal: i, pageFrom: 1, pageTo: 1, content }));
  const { policy: aiPolicy } = await loadProductPolicy(admin, "scholar");
  const subject = { text: ["Teach me this step.", ...NOTES].join("\n\n"), competencyIds: [], topicTerms: [] };
  const risk = classifyRisk(aiPolicy.risk, await resolveRiskSubject(admin, subject), (aiPolicy.activities.teach?.riskFloor ?? "standard_educational") as any);
  note(`risk: ${risk.tier} (${risk.rule})`);
  ok("R2. the Research & Explain request on oxygen therapy is classified clinical educational", risk.tier === "clinical_educational");
  // Discovery is not generation: every verified abstract may inform the answer (the route no longer drops any).
  const evidence = researchEvidence(lr);
  const wouldHaveDropped = (await withinRequestRisk(admin, "teach", subject, evidence.map(e => `${e.title}\n${e.abstract}`))).filter(k => !k).length;
  note(`verified evidence given to the model: ${evidence.length} (the old discovery filter would have dropped ${wouldHaveDropped})`);
  ok("R2b. legitimate educational research is not excluded at discovery: every verified abstract is evidence", evidence.length === lr.evidence.length && evidence.length > 0);
  // Generation stays restricted: research text that would lift the request above its tier is withheld.
  const dosing = "Patients received an insulin infusion and the dose was titrated to glucose with intravenous antibiotics [E1].";
  const bounded = (await withinRequestRisk(admin, "teach", subject, [dosing]))[0];
  ok("R2c. a research part carrying high-risk clinical detail would be withheld (risk_raised) by the published rules", bounded === false);

  console.log("R3  routing");
  const staged = await loadModelRouting(admin);
  const S = { provider: "anthropic", model: "claude-sonnet-4-6" }, O = { provider: "anthropic", model: "claude-opus-4-8" };
  const d1 = { ...staged!, activities: { ...staged!.activities, "scholar.teach": [S, O], "scholar.ask": [S, O] } };
  const rows = (await admin.from("ai_model_eligibility").select("activity, provider, model_prefix, eligible, max_risk_tier").eq("product", "scholar")).data ?? [];
  const route = selectRoute(routeCandidates(d1 as any, null, { product: "scholar", activity: "teach", tier: "reasoning" }, (staged as any).registry), aiStatus().available, clinicalGate(rows, "teach", risk.tier));
  note(`route: ${route ? `${route.provider}/${route.model}` : "none"}`);
  ok("R3. the cheapest ELIGIBLE model is chosen: Sonnet is not eligible at clinical educational, so Opus", route?.model === O.model);

  console.log("R4  the Learn engine, real model");
  const seen: any[] = [];
  if (!route) { ok("R4. the model answered", false, "no eligible route"); }
  const raw: string[] = [];
  const r: any = !route ? { ok: false, error: "no_route" } : await runLearn(EVAL_USER, { action: "teach", question: "Teach me this step.", passages: passages as any, references: [], depth: "standard", background: false, history: [], learnerContext: null, research: evidence },
    async (g: any) => { seen.push(g); const x = await generate({ ...g, route, context: { ...g.context, actionId: ACTION } }); if (x.ok) raw.push(x.text); return x; });
  // The route's generation-side check on what the research part wrote, exactly as learn/act applies it.
  if (r.ok && r.research?.ok && !(await withinRequestRisk(admin, "teach", subject, [r.research.text]))[0]) r.research = { ok: false, reason: "risk_raised" };
  if (!r.ok) { ok("R4. the model answered", false, r.error); }
  else {
    note(`model ${r.model} prompt ${r.promptVersion} operation ${seen[0]?.context?.operation}`);
    note(`notes part: ${r.check.ok ? "SHOWN" : `withheld (${r.check.reason})`}${r.check.ok ? ` -- ${r.check.text.slice(0, 160).replace(/\n/g, " ")}…` : ""}`);
    if (!r.research?.ok && process.env.SHOW_RAW) console.log(raw.join("\n---\n"));
    note(`research part: ${r.research?.ok ? `SHOWN, cites E${r.research.cited.join(", E")}` : `withheld (${r.research?.reason ?? "not written"})`}`);
    if (r.research && !r.research.ok && r.research.violations) note(`  what the check found beyond the sources: ${JSON.stringify(r.research.violations).slice(0, 400)}`);
    if (r.research?.ok) console.log(`\n        FROM RESEARCH (External research label):\n        ${r.research.text.replace(/\n/g, "\n        ")}\n`);
    const refs = externalReferences(lr);
    if (r.research?.ok) for (const n of r.research.cited) { const x = refs[n - 1]; note(`[E${n}] -> ${x.provider} PMID ${x.pmid ?? "-"} DOI ${x.doi ?? "-"} ${x.url}`); }
    ok("R4. an explanation was written on Opus with its own operation; the research part passed its checks and every [E n] maps to a provider record",
      r.model.startsWith("claude-opus") && seen[0]?.context?.operation === LEARN_RESEARCH_OPERATION && r.research?.ok === true
      && r.research.cited.every((n: number) => !!refs[n - 1]?.evidence && !!(refs[n - 1].pmid || refs[n - 1].doi)));
    ok("R4b. the notes part never cites external research", !(r.check.ok && /\[E\d+\]/.test(r.check.text)));
  }

  console.log("R5  a high-risk topic");
  const hr = classifyRisk(aiPolicy.risk, await resolveRiskSubject(admin, { text: HIGH_RISK, competencyIds: [], topicTerms: [] }), (aiPolicy.activities.teach?.riskFloor ?? "standard_educational") as any);
  const hrRoute = selectRoute(routeCandidates(d1 as any, null, { product: "scholar", activity: "teach", tier: "heavy" }, (staged as any).registry), aiStatus().available, clinicalGate(rows, "teach", hr.tier));
  const gate: any = await unmeteredGate(admin, "scholar", "teach", "reasoning", { text: HIGH_RISK, competencyIds: [], topicTerms: [] });
  note(`risk: ${hr.tier} (${hr.rule}); D1 route: ${hrRoute ? hrRoute.model : "none"}; staging gate: ${gate.ok ? "ok" : gate.error}`);
  ok("R5. still refused: high-risk clinical, no eligible model under D1 routing, and the pre-search gate refuses", hr.tier === "high_risk_clinical" && hrRoute === null && !gate.ok && gate.error === "not_eligible");

  console.log("R7  cost attribution (staging, 630)");
  if (r.ok) {
    const shown = (r.check.ok ? 1 : 0) + (r.research?.ok ? 1 : 0), withheld = (r.check.ok ? 0 : 1) + (r.research && !r.research.ok ? 1 : 0);
    await recordAiOutcome(admin, { actionId: ACTION, product: "scholar", activity: "learn_research:teach", operation: `${LEARN_RESEARCH_OPERATION}:teach`, outputKind: "explanation",
      outcome: shown ? (withheld ? "partial" : "accepted") : "rejected", accepted: shown, rejected: withheld, reasons: ["acceptance_run"], promptVersion: r.promptVersion });
  }
  const urows = (await admin.from("plat_research_requests").select("action_id, provider, capability, requests, outcome, cost_usd").eq("action_id", ACTION)).data ?? [];
  const orows = (await admin.from("plat_ai_outcomes").select("action_id, outcome").eq("action_id", ACTION)).data ?? [];
  const byOutcome = researchCostByOutcome(urows, orows);
  note(`research rows for action ${ACTION.slice(0, 8)}: ${urows.length} (${urows.map((u: any) => `${u.provider}/${u.capability}`).join(", ")}); outcome ${orows[0]?.outcome ?? "none"}`);
  note(`cost by outcome: ${JSON.stringify(byOutcome)}`);
  ok("R7. research requests and spend are recorded under the Scholar AI action and attributed to its outcome",
    urows.length > 0 && orows.length === 1 && byOutcome.unlinked.actions === 0 && Object.values(byOutcome).reduce((s, b) => s + b.requests, 0) === urows.reduce((s: number, u: any) => s + u.requests, 0));

  console.log("R8  retention through the existing job runner (staging)");
  const job: any = await runJob(admin, "research_retention", "manual", null);
  const run = (await admin.from("plat_job_runs").select("status, detail").eq("job_key", "research_retention").order("started_at", { ascending: false }).limit(1)).data?.[0];
  const stillThere = (await admin.from("plat_research_requests").select("id", { count: "exact", head: true }).eq("action_id", ACTION)).count ?? 0;
  note(`job: ${job.ok ? "ok" : job.error} -- ${run?.status}: ${run?.detail}`);
  ok("R8. the retention job ran in plat_job_runs and kept today's records", !!job.ok && run?.status === "success" && stillThere === urows.length);

  console.log("R6  defaults");
  const def = resolvePolicy([]).scholarResearch;
  const live = await loadResearchEngine(admin);
  const seeded = resolveRegistry(null);
  ok("R6. with nothing published: notes only; on staging the engine is not operational and no seeded source is invocable",
    JSON.stringify(def.modes) === '["notes"]' && !researchOperational(live, "scholar", "learn")
    && Object.values(seeded).every((r: any) => notInvocable(r, { product: "scholar", activity: "learn", capability: "search" }) !== null)
    && !workflowOperational(resolveWorkflows(null).basic, seeded, { product: "scholar", activity: "learn" }));

  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
