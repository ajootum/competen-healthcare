/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * SCHOLAR-RISK-01 (owner GO 31 Oct 2026) -- the proposed Scholar risk section (scholar-risk01-policy.ts).
 *
 *   npx tsx scripts/apply-scholar-risk01.ts --staging [--publish]          draft (and publish) on STAGING (ACTOR_ID, PUBLISHER_ID)
 *   npx tsx scripts/apply-scholar-risk01.ts --emit <in.json> <out-dir>     production: <in> is the published scholar risk section,
 *       read read-only. Writes proposed-scholar-risk.json (the whole risk section) and draft-scholar-risk.sql (sets only
 *       the scholar DRAFT, only while nothing else is pending). A second person publishes it on the HQ page.
 *
 * It never publishes production and never touches Professional.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { publishScope, setOverride } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath } from "../src/lib/ai/fair-use-policy";
import { withScholarRisk01 } from "./scholar-risk01-policy";

async function staging() {
  loadEnvConfig(process.cwd());
  const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
  const v = judgeTarget(url);
  if (!v.ok || v.ref !== "ezhvpgtcqcdsgylrxgdb" || !key) { console.error("REFUSING: not the staging project."); process.exit(1); }
  const admin: any = createClient(url, key, { auth: { persistSession: false } });
  const actor = { userId: process.env.ACTOR_ID ?? "", name: "Scholar education-first risk (staging)" };
  if (!/^[0-9a-f-]{36}$/i.test(actor.userId)) { console.error("Set ACTOR_ID to the staging profile drafting this."); process.exit(1); }
  const { data } = await admin.from("workspace_config_overrides").select("published, draft").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", fairUsePath("scholar")).maybeSingle();
  if (!data?.published) { console.error("scholar: no published policy"); process.exit(1); }
  const next = { ...data.published, risk: withScholarRisk01(data.published.risk) };
  const r = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath("scholar"), next);
  console.log(`scholar: risk draft ${r.ok ? "saved" : `FAILED ${(r as any).error}`} (${next.risk.rules.length} rules, unknownHandling ${next.risk.unknownHandling})`);
  if (process.argv.includes("--publish")) {
    const p = await publishScope(admin, { userId: process.env.PUBLISHER_ID ?? "", name: "Scholar education-first risk publish (staging)" }, FAIR_USE_SCOPE, { label: "Scholar education-first risk", note: "SCHOLAR-RISK-01, staging" });
    console.log(`publish: ${p.ok ? "ok" : (p as any).error}`);
  }
}

function emit(input: string, dir: string) {
  const raw = readFileSync(input, "utf8").replace(/^﻿/, "");
  const risk = withScholarRisk01(JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)));
  writeFileSync(join(dir, "proposed-scholar-risk.json"), JSON.stringify(risk, null, 2) + "\n");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  writeFileSync(join(dir, "draft-scholar-risk.sql"), [
    "-- SCHOLAR-RISK-01 (31 Oct 2026): DRAFT ONLY. Sets the risk section of the scholar fair-use DRAFT to proposed-scholar-risk.json.",
    "-- Applies only while nothing else is pending for scholar. Nothing is effective until a second person publishes on the HQ page.",
    "begin;",
    `update workspace_config_overrides set draft = jsonb_set(published, '{risk}', ${q(JSON.stringify(risk))}::jsonb), updated_at = now()`,
    `  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = ${q(fairUsePath("scholar"))} and draft is not distinct from published`,
    "returning config_path, draft -> 'risk' ->> 'unknownHandling' as unknown_handling, jsonb_array_length(draft -> 'risk' -> 'rules') as draft_rules",
    "commit;",
  ].join("\n") + "\n");
  console.log(`wrote ${join(dir, "proposed-scholar-risk.json")} and draft-scholar-risk.sql (${risk.rules.length} rules)`);
}

if (process.argv.includes("--emit")) { const i = process.argv.indexOf("--emit"); emit(process.argv[i + 1], process.argv[i + 2]); }
else if (process.argv.includes("--staging")) staging().catch(e => { console.error(e); process.exit(1); });
else console.log("Use --staging [--publish] or --emit <in.json> <out-dir>.");
