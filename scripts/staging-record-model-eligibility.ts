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
 * OWNER ACCEPTANCE ("DEPLOYMENT ACCEPTANCE AND PILOT PREPARATION", 25 October 2026): "Accept the corrected Opus 4.8
 * tutoring result of 14/14 for the evaluated clinical-educational tasks ... Record the correction and applicable
 * tutoring eligibility. Use existing D5-v2 evidence for questions, case steps and short-answer evaluation where
 * sufficient."
 *
 * WHAT IS RECORDED, AND WHAT IS NOT:
 *   teach, ask       Opus 4.8 up to clinical_educational: D5-v1 corrected 14/14, accepted.
 *   case_steps       Opus 4.8 up to high_risk_clinical: D5-v2 3/3, both generators, no unsafe key, no flag. Sufficient.
 *   questions        Opus 4.8 up to clinical_educational: D5-v2 3/3 once the Opus q.postop key-rule flag was
 *                    determined a rule false positive under the owner's criterion ("IND-007 — MULTI-PROVIDER AI
 *                    CLOSURE"). The correction is in d5v2-activities-2026-10-25.md, and the rule is D5-v2.1.
 *   evaluate         NOT recorded: case-reasoning AI feedback shares the activity code, and the owner keeps it disabled.
 *                    Recording evaluate would switch it on until scholar_case_reasoning_feedback is "self".
 * Nothing else is touched: no policy, flag, price or other model.
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

const OPUS_D5V2 = [{
  kind: "eligibility" as const, product: "scholar", activity: "questions", provider: "anthropic", modelPrefix: "claude-opus-4-8", eligible: true,
  maxRiskTier: "clinical_educational",
  evidenceRef: "eval-run:6c2c8067-9b30-4ec7-b3f1-84c18cfdfd0d (D5-v2, questions 3/3 corrected 2026-10-25: d5v2-activities-2026-10-25.md)",
  note: "Owner 2026-10-25 (MULTI-PROVIDER AI CLOSURE): Opus q.postop flag a rule false positive. Use D5-v2 where sufficient. Recorded on staging by IND-007.",
}, {
  kind: "eligibility" as const, product: "scholar", activity: "case_steps", provider: "anthropic", modelPrefix: "claude-opus-4-8", eligible: true,
  maxRiskTier: "high_risk_clinical",
  evidenceRef: "eval-run:6c2c8067-9b30-4ec7-b3f1-84c18cfdfd0d (D5-v2: case_steps 3/3, docs/evidence/AI-EVAL/d5v2-activities-2026-10-25.md)",
  note: "Owner 2026-10-25 (DEPLOYMENT ACCEPTANCE AND PILOT PREPARATION): use existing D5-v2 evidence where sufficient. case_steps sufficient (3/3, no flag). Recorded on staging by IND-007.",
}];

(async () => {
  console.log(`Model eligibility -- ${apply ? "APPLY" : "dry run"} -- target ${(verdict as any).ref}`);
  for (const d of [...OPUS_TUTORING, ...OPUS_D5V2]) {
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
