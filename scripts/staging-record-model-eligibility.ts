/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * STAGING ONLY -- record the owner's model-eligibility decision of 25 October 2026 through the existing mechanism
 * (fair-use-admin.ts changeRate "eligibility", the same checks the HQ page runs), and nothing else.
 *
 *   npx tsx scripts/staging-record-model-eligibility.ts             dry run: what would be recorded, and what is in force
 *   npx tsx scripts/staging-record-model-eligibility.ts --apply     record it (idempotent: a decision already in force is kept)
 *
 * THE DECISION, verbatim (owner, "COMPETEN -- APPLICATION DEPLOYMENT AND PILOT PREPARATION", s5): "Use Opus for
 * clinical educational tutoring within its evaluated eligibility." Its evidence is D5-v1, run 4b92dda5, corrected for
 * one rubric false positive under the owner's own criterion (docs/evidence/AI-EVAL/d5-evaluation-2026-10-24.md).
 *
 * ⚠ TUTORING ONLY: Scholar teach and ask, claude-opus-4-8, up to clinical_educational. Not questions, case steps or
 * evaluation (D5-v2, not yet accepted), and not high-risk clinical. Nothing else is touched: no policy, flag, price or
 * other model.
 *
 * ⚠ IT REFUSES ANYTHING NOT JUDGED NON-PRODUCTION (production-guard judgeTarget). The production step is the owner's,
 * by hand, on the HQ page: docs/evidence/AI-EVAL/opus-tutoring-eligibility.md.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { changeRate, checkRate } from "../src/lib/ai/fair-use-admin";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const apply = process.argv.includes("--apply");

const OPUS_TUTORING = ["teach", "ask"].map(activity => ({
  kind: "eligibility" as const, product: "scholar", activity, provider: "anthropic", modelPrefix: "claude-opus-4-8", eligible: true,
  maxRiskTier: "clinical_educational",
  evidenceRef: "eval-run:4b92dda5-bc86-4412-b57c-17bd2868df3f (D5-v1, corrected 2026-10-25: docs/evidence/AI-EVAL/d5-evaluation-2026-10-24.md)",
  note: "Owner 2026-10-25 (APPLICATION DEPLOYMENT AND PILOT PREPARATION s5): Opus for clinical educational tutoring within its evaluated eligibility. Tutoring only. Recorded on staging by IND-007.",
}));

(async () => {
  console.log(`Model eligibility -- ${apply ? "APPLY" : "dry run"} -- target ${(verdict as any).ref}`);
  for (const d of OPUS_TUTORING) {
    const v = checkRate("eligibility", d);
    if (!v.ok) { console.error(`  REFUSED by the mechanism's own checks: ${v.error}`); process.exit(1); }
    const { data: cur, error } = await admin.from("ai_model_eligibility").select("id, eligible, max_risk_tier, evidence_ref, effective_from")
      .eq("product", d.product).eq("activity", d.activity).eq("provider", d.provider).eq("model_prefix", d.modelPrefix).is("effective_to", null);
    if (error) { console.error(`  ${d.activity}: could not read (${error.message})`); process.exit(1); }
    const live = cur?.[0];
    if (live?.eligible && live.max_risk_tier === d.maxRiskTier) { console.log(`  ${d.activity}: already in force (${live.id}), kept`); continue; }
    if (!apply) { console.log(`  ${d.activity}: would record eligible up to ${d.maxRiskTier}${live ? ` (replacing ${live.id})` : ""}`); continue; }
    const r = await changeRate(admin, "eligibility", d, null as unknown as string);
    if (!r.ok) { console.error(`  ${d.activity}: ${r.error}`); process.exit(1); }
    console.log(`  ${d.activity}: recorded ${r.id}`);
  }
})();
