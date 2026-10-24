/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * UPLOAD LIMITS (owner GO 2026-10-24) -- STAGING ONLY: raise scholar_upload_max_mb, the per-file limit a Scholar
 * student may upload, from its default (10 MB) to 25 MB. Needs migration 413 on the target (the material CHECK and
 * the bucket at 25 MB).
 *
 *   npx tsx scripts/seed-staging-scholar-upload-25mb.ts            scholar_upload_max_mb = 25
 *   npx tsx scripts/seed-staging-scholar-upload-25mb.ts --verify   read only: what is set, and the bucket limit
 *   npx tsx scripts/seed-staging-scholar-upload-25mb.ts --remove   back to the default (10 MB)
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project, and refuses to raise
 * the limit where the bucket is not at 25 MB (413 absent). It goes through the GOVERNED path the HQ screen uses --
 * setOverride (or resetOverride) then publishScope, each written to workspace_config_audit -- with the actor
 * recorded by NAME as this script: nobody is impersonated. publishScope publishes EVERY draft in the Individual
 * policy partition, so it refuses while any other Individual policy has an unpublished draft.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { POLICY_SCOPE, policyPath } from "../src/lib/individual/policy";
import { publishScope, resetOverride, setOverride, type WceActor } from "../src/lib/config/workspace-config-write";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--verify") ? "verify" : "set";

const ACTOR = { userId: null, name: "Scholar upload limits staging script (owner-run)" } as unknown as WceActor;
const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const PATH = policyPath("scholar_upload_max_mb");
const TARGET_MB = 25;

async function state() {
  const row = (await admin.from("workspace_config_overrides").select("draft, published, updated_by_name, updated_at")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef).eq("config_path", PATH).maybeSingle()).data;
  const bucket = (await admin.storage.getBucket("individual-scholar-materials")).data;
  return { scholarUploadMaxMb: row ?? "default (10 MB)", bucketFileSizeLimit: bucket?.file_size_limit ?? null };
}

async function assertNoOtherDrafts() {
  const rows = (await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef)).data ?? [];
  const pending = rows.filter((r: any) => r.config_path !== PATH && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path);
  if (pending.length) throw new Error(`REFUSING: other Individual policies have unpublished drafts (${pending.join(", ")}). Publishing now would publish them too.`);
}

async function main() {
  console.log(`STAGING SCHOLAR UPLOAD 25 MB (${mode}) -- target ${verdict.ok ? verdict.ref : "?"}\n`);
  const before = await state();
  console.log("before:", JSON.stringify(before, null, 1));
  if (mode === "verify") return;
  if (mode === "set" && Number(before.bucketFileSizeLimit) < TARGET_MB * 1024 * 1024)
    throw new Error("REFUSING: the bucket is not at 25 MB here (migration 413 not applied), so a larger file could not be stored.");
  await assertNoOtherDrafts();
  if (mode === "remove") await resetOverride(admin, ACTOR, SCOPE, PATH);
  else { const set = await setOverride(admin, ACTOR, SCOPE, PATH, { value: TARGET_MB }); if (!set.ok) throw new Error(`setOverride: ${set.error}`); }
  const pub = await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy",
    note: mode === "remove" ? "Scholar upload limit back to the default (10 MB) on staging" : "Scholar upload limit raised to 25 MB on staging (413 applied)" });
  if (!pub.ok) throw new Error(`publishScope: ${pub.error}`);
  console.log(`published version ${pub.version_id}`);
  console.log("after:", JSON.stringify(await state(), null, 1));
}

main().then(() => process.exit(0), e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
