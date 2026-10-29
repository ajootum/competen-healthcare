/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN AI educational guidance (GO A) and Supervised Pilot (GO 2), 29 Oct 2026 -- the policy change as DRAFTS.
 *
 *   npx tsx scripts/apply-ai-pilot-drafts.ts --staging            drafts on STAGING, then publishes them there
 *   npx tsx scripts/apply-ai-pilot-drafts.ts --emit-sql <in> <out>  production: from the published risk sections read
 *       read-only into <in> (JSON {"scholar": {...risk...}, "professional": {...}}), writes SQL that sets only the DRAFTS,
 *       and only where nothing else is pending. A governed publisher then reviews and publishes them on the HQ page.
 *
 * It never publishes production. The mode document starts as Strict Production for everyone: the owner names the
 * authorised test cohort on the HQ page before publishing it.
 */
import { loadEnvConfig } from "@next/env";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { setOverride, publishScope } from "../src/lib/config/workspace-config-write";
import { FAIR_USE_SCOPE, fairUsePath } from "../src/lib/ai/fair-use-policy";
import { MODE_SCOPE, modePath, resolveModeDoc } from "../src/lib/ai/operating-mode";
import { PILOT_MODE_DOC, withProductionAdditions } from "./ai-pilot-policy";

const PRODUCTS = ["scholar", "professional"] as const;

async function staging() {
  loadEnvConfig(process.cwd());
  const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
  const v = judgeTarget(url);
  if (!v.ok || v.ref !== "ezhvpgtcqcdsgylrxgdb" || !key) { console.error("REFUSING: not the staging project."); process.exit(1); }
  const admin: any = createClient(url, key, { auth: { persistSession: false } });
  const actor = { userId: process.env.ACTOR_ID ?? "", name: "AI pilot drafts (staging)" };
  if (!/^[0-9a-f-]{36}$/i.test(actor.userId)) { console.error("Set ACTOR_ID to the staging profile drafting this."); process.exit(1); }
  for (const p of PRODUCTS) {
    const { data } = await admin.from("workspace_config_overrides").select("published, draft").eq("scope_type", FAIR_USE_SCOPE.scopeType).eq("scope_ref", FAIR_USE_SCOPE.scopeRef).eq("config_path", fairUsePath(p)).maybeSingle();
    if (!data?.published) { console.log(`${p}: no published policy, skipped`); continue; }
    const next = { ...data.published, risk: withProductionAdditions(data.published.risk) };
    const r = await setOverride(admin, actor, FAIR_USE_SCOPE, fairUsePath(p), next);
    console.log(`${p}: risk draft ${r.ok ? "saved" : `FAILED ${(r as any).error}`} (${next.risk.rules.length} rules)`);
  }
  const m = await setOverride(admin, actor, MODE_SCOPE, modePath("scholar"), resolveModeDoc(PILOT_MODE_DOC));
  console.log(`scholar mode draft ${m.ok ? "saved" : `FAILED ${(m as any).error}`}`);
  if (process.argv.includes("--publish")) {
    const pub = { userId: process.env.PUBLISHER_ID ?? "", name: "AI pilot publish (staging)" };
    for (const scope of [FAIR_USE_SCOPE, MODE_SCOPE]) {
      const r = await publishScope(admin, pub, scope, { label: "AI educational rules and operating modes", note: "owner GO 29 Oct 2026, staging" });
      console.log(`publish ${scope.scopeRef}: ${r.ok ? "ok" : (r as any).error}`);
    }
  }
}

function emitSql(input: string, out: string) {
  const published = JSON.parse(readFileSync(input, "utf8"));
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const lines = [
    "-- AI GO A + GO 2 (29 Oct 2026): DRAFTS ONLY. Sets the risk drafts of the scholar and professional fair-use policies",
    "-- and the scholar mode draft. Each update applies only while nothing else is pending (draft equals published).",
    "-- Publish on the HQ page afterwards. Nothing here publishes.",
    "begin;",
  ];
  for (const p of PRODUCTS) {
    if (!published[p]) continue;
    const risk = withProductionAdditions(published[p]);
    lines.push(`update workspace_config_overrides set draft = jsonb_set(published, '{risk}', ${q(JSON.stringify(risk))}::jsonb), updated_at = now()`,
      `  where scope_type = 'platform' and scope_ref = 'ai_fair_use' and config_path = ${q(fairUsePath(p))} and draft is not distinct from published;`);
  }
  lines.push(`insert into workspace_config_overrides (scope_type, scope_ref, config_path, draft) values ('platform', 'ai_modes', ${q(modePath("scholar"))}, ${q(JSON.stringify(resolveModeDoc(PILOT_MODE_DOC)))}::jsonb)`,
    "  on conflict (scope_type, scope_ref, config_path) do nothing;",
    "commit;");
  writeFileSync(out, lines.join("\n") + "\n");
  console.log(`wrote ${out}`);
}

if (process.argv.includes("--emit-sql")) { const i = process.argv.indexOf("--emit-sql"); emitSql(process.argv[i + 1], process.argv[i + 2]); }
else if (process.argv.includes("--staging")) staging().catch(e => { console.error(e); process.exit(1); });
else console.log("Use --staging [--publish] or --emit-sql <in> <out>.");
