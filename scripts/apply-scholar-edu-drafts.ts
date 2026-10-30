/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-EDU-AI-01 (30 Oct 2026) -- the Scholar educational classification as a DRAFT of the scholar fair-use policy.
 *
 *   npx tsx scripts/apply-scholar-edu-drafts.ts --staging [--publish]   draft (and publish) on STAGING (ACTOR_ID, PUBLISHER_ID)
 *   npx tsx scripts/apply-scholar-edu-drafts.ts --emit-sql <in> <out>   production: <in> is the published scholar risk section,
 *       read read-only. Writes SQL that sets only the scholar DRAFT, and only while nothing else is pending.
 *
 * It never publishes production and never touches Professional.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { publishScope, setOverride } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath } from "../src/lib/ai/fair-use-policy";
import { withScholarEducational } from "./scholar-edu-policy";

async function staging() {
  loadEnvConfig(process.cwd());
  const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
  const v = judgeTarget(url);
  if (!v.ok || v.ref !== "ezhvpgtcqcdsgylrxgdb" || !key) { console.error("REFUSING: not the staging project."); process.exit(1); }
  const admin: any = createClient(url, key, { auth: { persistSession: false } });
  const actor = { userId: process.env.ACTOR_ID ?? "", name: "Scholar educational rules (staging)" };
  if (!/^[0-9a-f-]{36}$/i.test(actor.userId)) { console.error("Set ACTOR_ID to the staging profile drafting this."); process.exit(1); }
  const { data } = await admin.from("workspace_config_overrides").select("published").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", fairUsePath("scholar")).maybeSingle();
  if (!data?.published) { console.error("scholar: no published policy"); process.exit(1); }
  const next = { ...data.published, risk: withScholarEducational(data.published.risk) };
  const r = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath("scholar"), next);
  console.log(`scholar: risk draft ${r.ok ? "saved" : `FAILED ${(r as any).error}`} (${next.risk.rules.length} rules)`);
  if (process.argv.includes("--publish")) {
    const p = await publishScope(admin, { userId: process.env.PUBLISHER_ID ?? "", name: "Scholar educational rules publish (staging)" }, FAIR_USE_SCOPE, { label: "Scholar educational classification", note: "SCHOLAR-EDU-AI-01, staging" });
    console.log(`publish: ${p.ok ? "ok" : (p as any).error}`);
  }
}

function emitSql(input: string, out: string) {
  const risk = withScholarEducational(JSON.parse(readFileSync(input, "utf8")));
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  writeFileSync(out, [
    "-- SCHOLAR-EDU-AI-01 (30 Oct 2026): DRAFT ONLY. Sets the risk draft of the scholar fair-use policy: medicines, emergencies,",
    "-- paediatric deterioration and high-risk competencies become clinical educational for study, a study-request rule is added,",
    "-- and identifiable patient information is high risk. Applies only while nothing else is pending. Publish on the HQ page.",
    "begin;",
    `update workspace_config_overrides set draft = jsonb_set(published, '{risk}', ${q(JSON.stringify(risk))}::jsonb), updated_at = now()`,
    `  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = ${q(fairUsePath("scholar"))} and draft is not distinct from published;`,
    "select config_path, draft is distinct from published as pending, jsonb_array_length(draft -> 'risk' -> 'rules') as draft_rules from workspace_config_overrides",
    "  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = 'ai.fair_use.scholar';",
    "commit;",
  ].join("\n") + "\n");
  console.log(`wrote ${out}`);
}

if (process.argv.includes("--emit-sql")) { const i = process.argv.indexOf("--emit-sql"); emitSql(process.argv[i + 1], process.argv[i + 2]); }
else if (process.argv.includes("--staging")) staging().catch(e => { console.error(e); process.exit(1); });
else console.log("Use --staging [--publish] or --emit-sql <in> <out>.");
