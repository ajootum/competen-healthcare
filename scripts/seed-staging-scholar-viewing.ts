/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-SCHOLAR-01 -- STAGING VIEWING CONFIGURATION for the S2-S4 respiratory slice (needs 384, 387 and the S1 seed).
 *
 *   npx tsx scripts/seed-staging-scholar-viewing.ts            set (idempotent)
 *   npx tsx scripts/seed-staging-scholar-viewing.ts --verify   read only: what is set
 *   npx tsx scripts/seed-staging-scholar-viewing.ts --remove   undo exactly this: allowlist back to empty, programme removed
 *
 * Owner GO (2026-10-23, relayed by the coordinating session): "Staging viewing config: GO ... set these
 * persistently on STAGING only: (a) the Scholar allowlist = CF-FOUND + NUR-RESP, (b) one programme row
 * 'Nursing (Uganda), diploma' using those two ... reversible staging configuration, not privilege grants.
 * Professional's allowlist stays empty, and nothing goes to production."
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project.
 *
 * (a) goes through the GOVERNED configuration path the HQ screen uses -- setOverride then publishScope
 *     (src/lib/config/workspace-config-write.ts), each written to workspace_config_audit -- with the same
 *     check the HQ route makes: every id must be a shared, active, published catalogue. The actor is
 *     recorded by NAME as this agent session, with no profile id: nobody is impersonated.
 *     ⚠ publishScope publishes EVERY draft in the Individual policy partition, so this refuses to run while
 *     any other Individual policy has an unpublished draft -- it never publishes someone else's change.
 * (b) is configuration rows in individual_scholar_programme / _programme_framework (migration 387).
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { POLICY_SCOPE, policyPath } from "../src/lib/individual/policy";
import { publishScope, setOverride, type WceActor } from "../src/lib/config/workspace-config-write";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--verify") ? "verify" : "set";

const ACTOR = { userId: null, name: "COMPETEN-SCHOLAR-01 agent session (owner staging viewing GO, 2026-10-23)" } as unknown as WceActor;
const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const PATH = policyPath("scholar_catalogues");
const PROGRAMME = { code: "nursing-ug-diploma", label: "Nursing (Uganda), diploma", profession: "Nursing", country: "UG", level: "Diploma", is_active: true };

async function state() {
  const allow = (await admin.from("workspace_config_overrides").select("draft, published, updated_by_name, updated_at")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef).eq("config_path", PATH).maybeSingle()).data;
  const prof = (await admin.from("workspace_config_overrides").select("published")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef).eq("config_path", policyPath("professional_catalogues")).maybeSingle()).data;
  const prog = (await admin.from("individual_scholar_programme").select("*").eq("code", PROGRAMME.code).maybeSingle()).data;
  const fw = (await admin.from("individual_scholar_programme_framework").select("framework_id, layer, sort_order").eq("programme_code", PROGRAMME.code).order("sort_order")).data ?? [];
  return { scholarAllowlist: allow, professionalAllowlist: prof?.published ?? null, programme: prog, programmeFrameworks: fw };
}

async function main() {
  console.log(`STAGING SCHOLAR VIEWING CONFIG (${mode}) -- target ${verdict.ok ? verdict.ref : "?"}\n`);
  console.log("before:", JSON.stringify(await state(), null, 1));
  if (mode === "verify") return;

  if (mode === "remove") {
    await admin.from("individual_scholar_programme").delete().eq("code", PROGRAMME.code);
    await assertNoOtherDrafts();
    await setOverride(admin, ACTOR, SCOPE, PATH, { ids: [] });
    await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy", note: "COMPETEN-SCHOLAR-01: staging viewing configuration removed" });
    console.log("after:", JSON.stringify(await state(), null, 1));
    return;
  }

  const seed = (await admin.from("frameworks").select("id, code").is("hospital_id", null).eq("is_active", true).eq("pub_status", "published").in("code", ["CF-FOUND", "NUR-RESP"])).data ?? [];
  const cf = seed.find((f: any) => f.code === "CF-FOUND"), nr = seed.find((f: any) => f.code === "NUR-RESP");
  if (!cf || !nr) throw new Error("REFUSING: CF-FOUND and NUR-RESP are not both shared, active and published here.");

  // (a) the Scholar allowlist, through the governed path.
  await assertNoOtherDrafts();
  const set = await setOverride(admin, ACTOR, SCOPE, PATH, { ids: [cf.id, nr.id] });
  if (!set.ok) throw new Error(`setOverride: ${set.error}`);
  const pub = await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy", note: "COMPETEN-SCHOLAR-01: staging viewing configuration -- Scholar allowlist CF-FOUND + NUR-RESP" });
  if (!pub.ok) throw new Error(`publishScope: ${pub.error}`);
  console.log(`published version ${pub.version_id} (${pub.modules} policies in the partition)`);

  // (b) the programme, as rows.
  const p = await admin.from("individual_scholar_programme").upsert(PROGRAMME, { onConflict: "code" });
  if (p.error) throw new Error(`programme: ${p.error.message}`);
  const f = await admin.from("individual_scholar_programme_framework").upsert([
    { programme_code: PROGRAMME.code, framework_id: cf.id, layer: "foundational", sort_order: 0 },
    { programme_code: PROGRAMME.code, framework_id: nr.id, layer: "profession", sort_order: 1 },
  ], { onConflict: "programme_code,framework_id" });
  if (f.error) throw new Error(`programme frameworks: ${f.error.message}`);
  console.log("after:", JSON.stringify(await state(), null, 1));
}

/** publishScope publishes the whole partition: refuse while any OTHER Individual policy has an unpublished draft. */
async function assertNoOtherDrafts() {
  const rows = (await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef)).data ?? [];
  const pending = rows.filter((r: any) => r.config_path !== PATH && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path);
  if (pending.length) throw new Error(`REFUSING: other Individual policies have unpublished drafts (${pending.join(", ")}). Publishing now would publish them too.`);
}

main().then(() => process.exit(0), e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
