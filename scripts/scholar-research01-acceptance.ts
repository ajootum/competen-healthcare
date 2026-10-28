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
 *   R6  with nothing published, Learn is notes only and research is off
 *
 * ⚠ STAGING ONLY. It writes NO configuration: the research policy and the D1 routing lists are applied in memory. The
 * only rows it causes are the gateway's own plat_ai_requests usage rows for the R4 call (operation
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
  const { researchConfig, researchEvidence, externalReferences } = await import("../src/lib/individual/scholar/learn-research");
  const { runLearn, LEARN_RESEARCH_OPERATION } = await import("../src/lib/individual/scholar/generation");
  const { generate } = await import("../src/lib/ai/client") as any;
  const { aiStatus } = await import("../src/lib/ai/config");
  const { evidenceWithinRisk } = await import("../src/lib/individual/scholar/http");
  const { loadProductPolicy, loadModelRouting, resolveRiskSubject, unmeteredGate } = await import("../src/lib/ai/allowance");
  const { classifyRisk } = await import("../src/lib/ai/clinical-risk");
  const { routeCandidates, selectRoute, clinicalGate } = await import("../src/lib/ai/model-routing");
  const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

  // In memory only: the owner's publication this acceptance assumes. Nothing is written.
  const published = (await admin.from("workspace_config_overrides").select("config_path, published").eq("scope_type", "platform").eq("scope_ref", "individual").like("config_path", "individual.policy.%")).data ?? [];
  const policy = resolvePolicy([...published,
    { config_path: policyPath("scholar_learn_source_modes"), published: { enabled: ["notes", "library", "research"] } },
    { config_path: policyPath("scholar_research_providers"), published: { order: ["pubmed", "openalex"] } }]);
  const rp = policy.scholarResearch;

  console.log("R1  live research");
  const research = await runResearch("oxygen therapy target saturation", researchConfig(rp));
  const lr = { state: research.state as any, message: null, query: research.query, scholarLink: research.scholarLink, items: research.items, evidence: research.evidence, calls: research.calls, codes: research.codes };
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
  // The route's own filter: evidence that would lift the request's tier is not used (it stays as further reading).
  const keep = await evidenceWithinRisk(admin, "teach", subject, researchEvidence(lr).map(e => `${e.title}\n${e.abstract}`));
  lr.evidence = lr.evidence.filter((_: number, k: number) => keep[k]);
  const evidence = researchEvidence(lr);
  note(`evidence kept within the request's tier: ${keep.filter(Boolean).length} of ${keep.length}`);
  ok("R2b. some verified evidence stays within the request's own risk tier", evidence.length > 0);

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
    async (g: any) => { seen.push(g); const x = await generate({ ...g, route }); if (x.ok) raw.push(x.text); return x; });
  if (!r.ok) { ok("R4. the model answered", false, r.error); }
  else {
    note(`model ${r.model} prompt ${r.promptVersion} operation ${seen[0]?.context?.operation}`);
    note(`notes part: ${r.check.ok ? "SHOWN" : `withheld (${r.check.reason})`}${r.check.ok ? ` -- ${r.check.text.slice(0, 160).replace(/\n/g, " ")}…` : ""}`);
    if (!r.research?.ok && process.env.SHOW_RAW) console.log(raw.join("\n---\n"));
    note(`research part: ${r.research?.ok ? `SHOWN, cites E${r.research.cited.join(", E")}` : `withheld (${r.research?.reason ?? "not written"})`}`);
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

  console.log("R6  defaults");
  const def = resolvePolicy([]).scholarResearch;
  ok("R6. with nothing published: notes only, no provider", JSON.stringify(def.modes) === '["notes"]' && def.providers.length === 0);

  console.log(fails.length ? `\nRED -- ${pass} passed, ${fails.length} failed` : `\nALL GREEN -- ${pass} passed, 0 failed`);
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
