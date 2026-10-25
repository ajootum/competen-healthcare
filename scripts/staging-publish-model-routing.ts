/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * STAGING ONLY -- publish the owner's Scholar model routing as CONFIGURATION, through the existing audited path
 * (fair-use-admin.ts saveModelRoutingDraft + publishPolicies: the HQ page's own server functions, a versioned CONFIG-002
 * publish with its audit row). No code, no direct table write.
 *
 *   npx tsx scripts/staging-publish-model-routing.ts            dry run: what is in force, what would be published
 *   npx tsx scripts/staging-publish-model-routing.ts --apply    save the draft and publish it (refused if any OTHER
 *                                                                draft is pending in the AI scope: publish takes all)
 *   npx tsx scripts/staging-publish-model-routing.ts --prove    after publishing: route checks, and ONE Revision
 *                                                                question generation through the production runner
 *
 * THE DECISION (owner, relayed by the coordinator, 25 October 2026): "I think allow the questions to go to the next
 * model", then "stick with the old rule.. keep this configureable not code". Sonnet stays NOT approved for clinical
 * activities. For Scholar questions, teach, ask and case_steps the candidates are [the current primary, Opus 4.8]:
 * selection skips Sonnet (not eligible) and takes Opus where its eligibility is recorded. evaluate and case-reasoning
 * feedback are left alone (no eligible model, "self" the default). Everything else routes exactly as today.
 *
 * WHAT "EXACTLY AS TODAY" MEANS HERE. Unpublished routing is the deployment primary with its per-tier models
 * (config.ts providerModels). A published document replaces that for EVERY activity, so it restates it: the primary
 * enabled with the same per-tier models, alone in every tier. Other providers stay disabled (failover deferred).
 *
 * ⚠ IT REFUSES ANYTHING NOT JUDGED NON-PRODUCTION (production-guard judgeTarget). The production equivalent is the
 * owner's, by hand, on the HQ page.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
// The runner's own reads (loadModelRouting, eligibility, policy) take this client; nothing reads the default env client.
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--prove") ? "prove" : "dry";
const ACTOR = { userId: null as unknown as string, name: "IND-007 staging script (owner routing GO via coordinator, 2026-10-25)" };
const ROUTED = ["questions", "teach", "ask", "case_steps"] as const;
const OPUS = "claude-opus-4-8";

(async () => {
  const { providerModels, primaryProvider } = await import("../src/lib/ai/config");
  const { MODEL_ROUTING_PATH, resolveModelRouting } = await import("../src/lib/ai/model-routing");
  const { FAIR_USE_SCOPE } = await import("../src/lib/ai/fair-use-policy");
  const { loadProductPolicy } = await import("../src/lib/ai/allowance");
  console.log(`Model routing -- ${mode} -- target ${(verdict as any).ref}`);

  const primary = primaryProvider();
  if (primary !== "anthropic") { console.error(`STOP: the deployment primary is ${primary}, not anthropic. The owner's rule assumes Sonnet is the primary.`); process.exit(1); }
  const models = providerModels("anthropic");
  console.log(`  primary anthropic, per-tier models as today: ${JSON.stringify(models)}`);

  // 1. The activities: each must be clinical (an eligibility gate exists), so a candidate list can only choose an eligible model.
  const { policy, readable } = await loadProductPolicy(admin, "scholar");
  if (!readable) { console.error("STOP: the Scholar AI policy cannot be read."); process.exit(1); }
  for (const a of ROUTED) {
    const p = policy.activities[a];
    if (!p) { console.error(`STOP: scholar.${a} is not in the published Scholar policy.`); process.exit(1); }
    console.log(`  scholar.${a}: tier ${p.tier}, risk floor ${p.riskFloor}`);
    // A standard-educational activity has no eligibility gate: it runs on the current primary today, and a list would
    // only pin its tier. It is left exactly as it is.
    if (p.riskFloor === "standard_educational") console.log(`    -> left unrouted: standard educational, it already runs on the current primary`);
  }

  // 2. Opus eligibility in force for each routed activity, and nothing for Sonnet.
  const { data: elig, error: eErr } = await admin.from("ai_model_eligibility").select("id, activity, provider, model_prefix, eligible, max_risk_tier")
    .eq("product", "scholar").eq("provider", "anthropic").is("effective_to", null);
  if (eErr) { console.error(`STOP: eligibility unreadable (${eErr.message}).`); process.exit(1); }
  const route: Record<string, { provider: string; model: string }[]> = {};
  for (const a of ROUTED) {
    const opus = (elig ?? []).find((e: any) => e.activity === a && e.eligible && OPUS.startsWith(e.model_prefix));
    const sonnet = (elig ?? []).find((e: any) => e.activity === a && e.eligible && models[policy.activities[a].tier as "cheap" | "reasoning" | "heavy"].startsWith(e.model_prefix));
    console.log(`  scholar.${a}: Opus eligibility ${opus ? `${opus.id} up to ${opus.max_risk_tier}` : "NONE"}; current primary eligible: ${sonnet ? sonnet.id : "no"}`);
    if (opus && policy.activities[a].riskFloor !== "standard_educational") route[`scholar.${a}`] = [{ provider: "anthropic", model: models[policy.activities[a].tier as "cheap" | "reasoning" | "heavy"] }, { provider: "anthropic", model: OPUS }];
  }

  // 3. The document: today's routing restated, plus the activity lists.
  const doc = {
    providers: { anthropic: { enabled: true, models: { cheap: models.cheap, reasoning: models.reasoning, heavy: models.heavy } }, openai: { enabled: false, models: {} }, gemini: { enabled: false, models: {} } },
    tiers: { cheap: ["anthropic"], reasoning: ["anthropic"], heavy: ["anthropic"] },
    activities: route,
  };
  const stored = resolveModelRouting(doc);
  if (JSON.stringify(stored.activities) !== JSON.stringify(route)) { console.error("STOP: the resolver would not keep this document as written."); process.exit(1); }
  console.log(`  document: ${JSON.stringify(doc)}`);

  // 4. What is pending and published in the AI scope now.
  const { data: rows, error: rErr } = await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef);
  if (rErr) { console.error(`STOP: AI scope unreadable (${rErr.message}).`); process.exit(1); }
  const pending = (rows ?? []).filter((r: any) => JSON.stringify(r.draft ?? null) !== JSON.stringify(r.published ?? null)).map((r: any) => r.config_path);
  const current = (rows ?? []).find((r: any) => r.config_path === MODEL_ROUTING_PATH);
  console.log(`  ai.model_routing published now: ${current?.published ? JSON.stringify(current.published) : "none (legacy routing)"}`);
  console.log(`  pending drafts in the AI scope: ${pending.length ? pending.join(", ") : "none"}`);
  const { data: lastVer } = await admin.from("workspace_config_versions").select("id, created_at").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).order("created_at", { ascending: false }).limit(1);
  console.log(`  latest AI-scope version (the rollback point): ${lastVer?.[0]?.id ?? "none"} ${lastVer?.[0]?.created_at ?? ""}`);

  if (mode === "dry") return;

  if (mode === "apply") {
    const others = pending.filter((p: string) => p !== MODEL_ROUTING_PATH);
    if (others.length) { console.error(`STOP: other drafts are pending (${others.join(", ")}). Publishing would publish them too.`); process.exit(1); }
    const { saveModelRoutingDraft, publishPolicies } = await import("../src/lib/ai/fair-use-admin");
    const s = await saveModelRoutingDraft(admin, ACTOR, doc);
    if (!s.ok) { console.error(`draft refused: ${JSON.stringify(s)}`); process.exit(1); }
    const p: any = await publishPolicies(admin, ACTOR, "Owner 2026-10-25: Scholar questions, teach, ask, case_steps may use the next eligible model (Opus 4.8). Sonnet not approved for clinical activities. Configuration only.");
    if (!p.ok) { console.error(`publish refused: ${JSON.stringify(p)}`); process.exit(1); }
    console.log(`  PUBLISHED: version ${p.version_id}, ${p.modules} module(s)`);
    return;
  }

  // --prove: the production runner's own routing decision, then one real generation through it.
  const { unmeteredGate, runMeteredAi } = await import("../src/lib/ai/allowance");
  for (const a of [...ROUTED, "evaluate"]) {
    const g: any = await unmeteredGate(admin, "scholar", a, "reasoning");
    console.log(`  gate scholar.${a}: ${g.ok ? `route ${g.route?.provider}/${g.route?.model}` : `REFUSED ${g.error}`}`);
  }
  const userId = process.env.PROVE_USER_ID ?? "";
  if (!/^[0-9a-f-]{36}$/.test(userId)) { console.log("  (set PROVE_USER_ID to a staging Scholar member to run one generation)"); return; }
  const { runRevisionQuestions } = await import("../src/lib/individual/scholar/generation");
  const passage = { chunkId: "prove-routing-1", materialId: "prove-routing", materialTitle: "Hand hygiene", ordinal: 1, pageFrom: 1, pageTo: 1, content: "Hand hygiene is the single most effective way to prevent the spread of infection. Staff clean their hands before touching a patient, before a clean or aseptic procedure, after body fluid exposure risk, after touching a patient, and after touching patient surroundings. Alcohol-based hand rub is used when hands are not visibly soiled. Soap and water are used when hands are visibly soiled." } as any;
  const run = async (g: any, part = "main") => runMeteredAi(admin, { userId, product: "scholar", activity: "questions", requestId: `${userId}:prove-routing-${Date.now()}:${part}`, generate: g, risk: { passages: [passage] } as any }) as any;
  const r: any = await runRevisionQuestions(userId, "short", passage, 1, run);
  console.log(`  Revision generation (questions): ${r.ok ? `ok, ${r.kept.length} kept, provider ${r.provider}, model ${r.model}` : `REFUSED/failed ${r.error ?? JSON.stringify(r)}`}`);
})().catch(e => { console.error(e); process.exit(1); });
