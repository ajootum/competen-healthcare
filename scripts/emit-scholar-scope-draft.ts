/**
 * SQIE D-1 (30 Oct 2026): the ONE production file that DRAFTS the Scholar risk rules with the four use rules read from
 * the learner's request only (clinical-risk.ts scope "request"): high.real-patient, high.administration-now,
 * high.urgent-direction, high.personal-safety. high.identifiable keeps reading the study material too. It writes a DRAFT
 * of ai.fair_use.scholar only, and only while nothing else is pending there. A governed publisher publishes it on HQ,
 * AI, Fair use. Nothing here publishes.
 *
 * Input: the published Scholar risk section as JSON (for 30 Oct: src/lib/ai/fixtures/scholar-risk-2026-10-30.json, the
 * SCHOLAR-EDU-AI-01 rules before educational alignment), passed through withScholarEducational, so the draft equals the
 * published educational rules plus the four scopes.
 *
 *   npx tsx scripts/emit-scholar-scope-draft.ts <scholar-risk.json> <out.sql>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { SCHOLAR_HIGH_KEPT, SCHOLAR_REQUEST_SCOPED, withScholarEducational } from "./scholar-edu-policy";

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** Pure: the SQL for one risk section. Refuses anything that would weaken the kept high-risk rules. */
export function scopeDraftSql(risk: unknown): string {
  const r = withScholarEducational(risk);
  const rules: { id: string; tier: string; scope?: string }[] = r.rules;
  for (const id of SCHOLAR_HIGH_KEPT) if (!rules.some(x => x.id === id && x.tier === "high_risk_clinical")) throw new Error(`Refusing: ${id} is not high risk.`);
  for (const id of SCHOLAR_REQUEST_SCOPED) if (rules.find(x => x.id === id)?.scope !== "request") throw new Error(`Refusing: ${id} is not request-scoped.`);
  if (rules.find(x => x.id === "high.identifiable")?.scope === "request") throw new Error("Refusing: high.identifiable must read the study material.");
  const json = JSON.stringify(r);
  if (!/^[\x20-\x7e]*$/.test(json)) throw new Error("Refusing: the rules are not plain ASCII.");
  return [
    "-- SCHOLAR RISK SCOPE DRAFT (SQIE D-1, 30 Oct 2026). Paste whole. One transaction.",
    "-- Drafts ai.fair_use.scholar with the four use rules (real patient, giving now, acting now, personal safety)",
    "-- read from the learner request only. Identifiable details are still caught in the study material. All stay high risk.",
    "-- Only while nothing is pending for ai.fair_use.scholar (draft equals published). Publish on HQ, AI, Fair use, Publish.",
    "-- Needs the app release that reads rule scope. Without it the scope field is ignored (as strict as today).",
    "begin;",
    `update workspace_config_overrides set draft = jsonb_set(published, '{risk}', ${q(json)}::jsonb), updated_at = now()`,
    "  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.fair_use.scholar' and draft is not distinct from published;",
    "select r->>'id' as rule, r->>'tier' as tier, coalesce(r->>'scope', 'subject') as scope, (o.draft is distinct from o.published) as pending",
    "  from workspace_config_overrides o, jsonb_array_elements(o.draft->'risk'->'rules') r",
    "  where o.scope_type = 'platform' and o.scope_ref = 'ai_fair_use' and o.config_path = 'ai.fair_use.scholar'",
    "  order by 1;",
    "commit;",
  ].join("\n") + "\n";
}

if (process.argv[2]) {
  const sql = scopeDraftSql(JSON.parse(readFileSync(process.argv[2], "utf8")));
  writeFileSync(process.argv[3], sql);
  console.log(`wrote ${process.argv[3]} sha256 ${createHash("sha256").update(sql).digest("hex")}`);
}
