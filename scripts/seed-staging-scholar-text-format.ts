/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * COMPETEN-SCHOLAR-UPLOAD Stage 2 -- STAGING ONLY: let Scholar students upload plain text (a .txt file, or text
 * pasted into the page). Needs migration 405 on the target.
 *
 *   npx tsx scripts/seed-staging-scholar-text-format.ts            set scholar_upload_formats = pdf, docx, text
 *   npx tsx scripts/seed-staging-scholar-text-format.ts --verify   read only: what is set, and whether 405 is there
 *   npx tsx scripts/seed-staging-scholar-text-format.ts --remove   back to the default (pdf, docx)
 *
 * STAGING ONLY: it refuses unless STAGING_SUPABASE_URL is a confirmed non-production project. Run it only where 405
 * is applied (verified read-only on staging 2026-10-24: the material CHECK and the bucket both allow text/plain).
 *
 * It goes through the GOVERNED configuration path the HQ screen uses -- setOverride then publishScope
 * (src/lib/config/workspace-config-write.ts), each written to workspace_config_audit -- with the actor recorded
 * by NAME as this script, no profile id: nobody is impersonated. publishScope publishes EVERY draft in the
 * Individual policy partition, so it refuses while any other Individual policy has an unpublished draft.
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

const ACTOR = { userId: null, name: "COMPETEN-SCHOLAR-UPLOAD Stage 2 staging script (owner-run)" } as unknown as WceActor;
const SCOPE = { scopeType: POLICY_SCOPE.scopeType, scopeRef: POLICY_SCOPE.scopeRef };
const PATH = policyPath("scholar_upload_formats");

async function state() {
  const row = (await admin.from("workspace_config_overrides").select("draft, published, updated_by_name, updated_at")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef).eq("config_path", PATH).maybeSingle()).data;
  return { scholarUploadFormats: row ?? null };
}

async function assertNoOtherDrafts() {
  const rows = (await admin.from("workspace_config_overrides").select("config_path, draft, published")
    .eq("scope_type", SCOPE.scopeType).eq("scope_ref", SCOPE.scopeRef)).data ?? [];
  const pending = rows.filter((r: any) => r.config_path !== PATH && JSON.stringify(r.draft) !== JSON.stringify(r.published)).map((r: any) => r.config_path);
  if (pending.length) throw new Error(`REFUSING: other Individual policies have unpublished drafts (${pending.join(", ")}). Publishing now would publish them too.`);
}

async function main() {
  console.log(`STAGING SCHOLAR TEXT FORMAT (${mode}) -- target ${verdict.ok ? verdict.ref : "?"}\n`);
  console.log("before:", JSON.stringify(await state(), null, 1));
  if (mode === "verify") return;
  await assertNoOtherDrafts();
  if (mode === "remove") {
    await resetOverride(admin, ACTOR, SCOPE, PATH);
    await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy", note: "COMPETEN-SCHOLAR-UPLOAD: plain text upload turned off on staging (default)" });
  } else {
    const set = await setOverride(admin, ACTOR, SCOPE, PATH, { enabled: ["pdf", "docx", "text"] });
    if (!set.ok) throw new Error(`setOverride: ${set.error}`);
    const pub = await publishScope(admin, ACTOR, SCOPE, { label: "Competen Individual policy", note: "COMPETEN-SCHOLAR-UPLOAD: plain text upload turned on on staging (405 applied)" });
    if (!pub.ok) throw new Error(`publishScope: ${pub.error}`);
    console.log(`published version ${pub.version_id}`);
  }
  console.log("after:", JSON.stringify(await state(), null, 1));
}

main().then(() => process.exit(0), e => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
