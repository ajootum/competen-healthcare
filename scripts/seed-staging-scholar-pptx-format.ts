/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-SCHOLAR-UPLOAD-01 U1 -- STAGING ONLY: let Scholar students upload PowerPoint lectures (.pptx). Needs
 * migration 406 on the target (the bucket and the material CHECK allow the PowerPoint type).
 *
 *   npx tsx scripts/seed-staging-scholar-pptx-format.ts            scholar_upload_formats = pdf, docx, pptx, text
 *   npx tsx scripts/seed-staging-scholar-pptx-format.ts --verify   read only: what is set, and whether 406 is there
 *   npx tsx scripts/seed-staging-scholar-pptx-format.ts --remove   back to pdf, docx, text (the staging value before)
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project, and refuses to set
 * pptx where 406 is absent (the extraction_quality column is its marker). It goes through the GOVERNED path the
 * HQ screen uses -- setOverride then publishScope, each written to workspace_config_audit -- with the actor
 * recorded by NAME as this script: nobody is impersonated. publishScope publishes EVERY draft in the Individual
 * policy partition, so it refuses while any other Individual policy has an unpublished draft.
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

const ACTOR = { userId: null, name: "COMPETEN-SCHOLAR-UPLOAD-01 staging script (owner-run)" } as unknown as WceActor;
const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const PATH = policyPath("scholar_upload_formats");

async function state() {
  const row = (await admin.from("workspace_config_overrides").select("draft, published, updated_by_name, updated_at")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef).eq("config_path", PATH).maybeSingle()).data;
  const m406 = await admin.from("individual_scholar_material").select("extraction_quality").limit(0);
  return { scholarUploadFormats: row ?? null, migration406: !m406.error };
}

async function assertNoOtherDrafts() {
  const rows = (await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef)).data ?? [];
  const pending = rows.filter((r: any) => r.config_path !== PATH && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path);
  if (pending.length) throw new Error(`REFUSING: other Individual policies have unpublished drafts (${pending.join(", ")}). Publishing now would publish them too.`);
}

async function main() {
  console.log(`STAGING SCHOLAR PPTX FORMAT (${mode}) -- target ${verdict.ok ? verdict.ref : "?"}\n`);
  const before = await state();
  console.log("before:", JSON.stringify(before, null, 1));
  if (mode === "verify") return;
  if (mode === "set" && !before.migration406) throw new Error("REFUSING: migration 406 is not applied here, so a PowerPoint could not be saved.");
  await assertNoOtherDrafts();
  const enabled = mode === "remove" ? ["pdf", "docx", "text"] : ["pdf", "docx", "pptx", "text"];
  const set = await setOverride(admin, ACTOR, SCOPE, PATH, { enabled });
  if (!set.ok) throw new Error(`setOverride: ${set.error}`);
  const pub = await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy",
    note: mode === "remove" ? "COMPETEN-SCHOLAR-UPLOAD-01: PowerPoint upload turned off on staging" : "COMPETEN-SCHOLAR-UPLOAD-01: PowerPoint upload turned on on staging (406 applied)" });
  if (!pub.ok) throw new Error(`publishScope: ${pub.error}`);
  console.log(`published version ${pub.version_id}`);
  console.log("after:", JSON.stringify(await state(), null, 1));
}

main().then(() => process.exit(0), e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
