/**
 * SCHOLAR-EDU-AI-01 / SCHOLAR-SQIE-02 (30 Oct 2026): the ONE production file the owner pastes so every Scholar AI
 * activity has a model for clinical educational content. It records the eligibility rows the D5-v4 evidence supports
 * (withholds counted as safe outcomes, SQIE-02 section 8), drafts the routing lists those rows need, and drafts the
 * Scholar classification. Drafts publish on the HQ page. Nothing here publishes.
 *
 *   npx tsx scripts/emit-scholar-ai-ready.ts <scholar-risk.json> <out.sql>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { withScholarEducational } from "./scholar-edu-policy";

export const DECIDER = "5fa4e38b-b1c5-4b68-be46-0cb04b643417";
export const EVIDENCE = "eval-run:4b535279-29c7-4bcd-b245-b6db34369209 (D5-v4, 2026-10-30, staging; withholds counted safe per SCHOLAR-SQIE-02 s8)";
const S = "claude-sonnet-4-6", O = "claude-opus-4-8";
/** activity -> models the evidence supports at clinical educational (cheapest first). */
export const ROWS: [string, string][] = [
  ["teach", S], ["simplify", S], ["evaluate", S], ["check", S], ["check", O], ["clarify", O], ["deeper", O],
];
/** Routing lists so the gate can reach the eligible model (Sonnet first, Opus on escalation). */
export const ROUTED = ["deeper", "check", "clarify", "evaluate"];

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
if (process.argv[2]) {
  const risk = withScholarEducational(JSON.parse(readFileSync(process.argv[2], "utf8")));
  const list = JSON.stringify([{ provider: "anthropic", model: S }, { provider: "anthropic", model: O }]);
  const values = ROWS.map(([a, m]) => `('scholar', ${q(a)}, 'anthropic', ${q(m)}, true, ${q(EVIDENCE)}, 'clinical_educational', ${q(DECIDER)}::uuid, 'SCHOLAR-EDU-AI-01')`).join(",\n  ");
  let routing = "published";
  for (const a of ROUTED) routing = `jsonb_set(${routing}, '{activities,scholar.${a}}', ${q(list)}::jsonb, true)`;
  const sql = [
    "-- SCHOLAR AI READY (30 Oct 2026). Paste whole. One transaction.",
    "-- 1. Eligibility rows the D5-v4 evidence supports, recorded for the account that recorded the existing ten, each with an audit entry.",
    "--    A row is skipped if the same product, activity, provider and model already has an open decision.",
    "-- 2. Routing DRAFT: lists for scholar.deeper, check, clarify and evaluate (Sonnet, then Opus). Only while nothing is pending.",
    "-- 3. Scholar classification DRAFT (study topics clinical educational, study-request rule, identifiable details high risk).",
    "-- Publish the drafts on HQ, AI, Fair use, Publish. The eligibility rows take effect at once.",
    "begin;",
    "with v (product, activity, provider, model_prefix, eligible, evidence_ref, max_risk_tier, decided_by, note) as (values",
    `  ${values}`,
    "), ins as (",
    "  insert into ai_model_eligibility (product, activity, provider, model_prefix, eligible, evidence_ref, max_risk_tier, decided_by, note)",
    "  select v.* from v where not exists (select 1 from ai_model_eligibility e where e.product = v.product and e.activity = v.activity",
    "    and e.provider = v.provider and e.model_prefix = v.model_prefix and e.effective_to is null)",
    "  returning id",
    ")",
    "insert into audit_log (trace_id, actor_id, actor_name, action, entity_type, entity_id, new_value)",
    `  select gen_random_uuid(), ${q(DECIDER)}::uuid, 'Competen Super Admin', 'ai_model_eligibility_decided', 'ai_fair_use', null, jsonb_build_object('id', ins.id, 'kind', 'eligibility', 'via', 'SCHOLAR-EDU-AI-01 SQL') from ins;`,
    `update workspace_config_overrides set draft = ${routing}, updated_at = now()`,
    "  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.model_routing' and draft is not distinct from published;",
    `update workspace_config_overrides set draft = jsonb_set(published, '{risk}', ${q(JSON.stringify(risk))}::jsonb), updated_at = now()`,
    "  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.fair_use.scholar' and draft is not distinct from published;",
    "select 'eligible ' || activity || ' ' || model_prefix as k, max_risk_tier as v from ai_model_eligibility where product = 'scholar' and effective_to is null and eligible",
    "union all select 'pending ' || config_path, (draft is distinct from published)::text from workspace_config_overrides where scope_type = 'platform' and scope_ref = 'ai_fair_use'",
    "order by 1;",
    "commit;",
  ].join("\n") + "\n";
  writeFileSync(process.argv[3], sql);
  console.log(`wrote ${process.argv[3]} (${ROWS.length} rows, ${ROUTED.length} routing lists)`);
}
