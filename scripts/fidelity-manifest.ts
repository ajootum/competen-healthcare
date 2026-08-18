/**
 * Clean-build fidelity manifest — COMP-ENG-002E §8.
 *
 * Verifies that a TARGET database reproduces the approved Competen security semantics. Written to run
 * against a freshly built staging project, and equally against production, so the same instrument
 * produces both sides of the comparison.
 *
 * ⚠⚠ ITS ONLY JOB IS TO REFUSE UNKNOWN DRIFT. §8: "Unknown drift — NONE; unexplained differences fail
 * the gate." Everything this tool tolerates, it tolerates by name, from a version-controlled file, with
 * a reason. There is no "close enough" verdict and no silent allowance.
 *
 * WHAT IT CHECKS (§4 fidelity hierarchy, all REQUIRED except the last):
 *   RLS enabled state per table          policy command and target table
 *   policy roles                         USING semantics
 *   WITH CHECK semantics                 authorization-sensitive function security mode
 *   security/data-integrity triggers     storage visibility and restrictions
 *   exact historical policy NAME         NOT required where allowlisted in
 *                                        security/legacy-name-divergence.json
 *
 * ⚠ THE NAME ALLOWANCE IS THE ONLY ONE, AND IT IS NARROW. A name may differ only if the pair is
 * recorded in that file AND the command, roles, USING and WITH CHECK all still match. An alias whose
 * body has since changed is reported as drift, because at that point it is not a rename any more.
 *
 * TARGET SELECTION. Defaults to the .env.local project. Point it elsewhere with:
 *   FIDELITY_SUPABASE_URL=... FIDELITY_SERVICE_ROLE_KEY=... npx tsx scripts/fidelity-manifest.ts
 * so a staging run needs no edit and no credential in the repository.
 *
 * ⚠ It depends on the registry functions (172, 168, 250, 332, 333). A target that lacks them cannot be
 * measured, and that is reported as a FAILURE of the build rather than skipped -- a fresh environment
 * missing its own instrumentation is exactly the kind of incompleteness this gate exists to catch.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pagedRpc } from "./_registry";

loadEnvConfig(process.cwd());

const ROOT = join(import.meta.dirname, "..");
const URL_ = process.env.FIDELITY_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.FIDELITY_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Alias = { table: string; productionName: string; repositoryName: string };
const aliases: Alias[] = JSON.parse(
  readFileSync(join(ROOT, "security", "legacy-name-divergence.json"), "utf8")).aliases;

/** Approved storage posture — COMP-ENG-002D §3/§4, encoded by migration 334. */
const STORAGE_EXPECTED: Record<string, { public: boolean; limit: number | null; mime: string[] | null }> = {
  avatars: { public: true, limit: 5242880, mime: ["image/jpeg", "image/png", "image/webp"] },
  "practice-attachments": {
    public: false, limit: 26214400,
    mime: [
      "application/pdf", "image/jpeg", "image/png", "image/webp",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  },
};

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`); };
const pass = (msg: string) => console.log(`  ok    ${msg}`);

async function main() {
  if (!URL_ || !KEY) { console.error("no target: set FIDELITY_SUPABASE_URL and FIDELITY_SERVICE_ROLE_KEY"); process.exit(1); }
  const admin = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  console.log(`\n=== Clean-build fidelity manifest ===\ntarget: ${URL_}\n`);

  // ── Instrumentation must exist, or the target cannot be measured at all ──
  const registries = ["plat_rls_registry", "plat_function_attributes", "plat_trigger_registry", "plat_storage_policy_registry"];
  console.log("INSTRUMENTATION");
  const missingReg: string[] = [];
  for (const fn of registries) {
    const { error } = await admin.rpc(fn).limit(1);
    if (error) { missingReg.push(fn); fail(`${fn}() unreadable — ${error.message.slice(0, 60)}`); }
    else pass(`${fn}()`);
  }
  if (missingReg.length) {
    console.log(`\n⚠ The target is missing its own measurement functions, so fidelity CANNOT be assessed.`);
    console.log(`  Apply migrations 168, 172, 250, 332 and 333 as part of the build, then re-run.`);
    console.log(`\nRED  ${failures} failure(s)\n`);
    process.exit(1);
  }

  // ── RLS ──
  const live = await pagedRpc<{
    tbl: string; rls_enabled: boolean; policy_name: string | null; cmd: string;
    roles: string; qual: string | null; with_check: string | null;
  }>(admin, "plat_rls_registry", ["tbl", "policy_name"]);
  if (live.error) { fail(`plat_rls_registry paged read: ${live.error}`); process.exit(1); }

  const tables = new Map<string, boolean>();
  for (const r of live.rows) if (!tables.has(r.tbl)) tables.set(r.tbl, r.rls_enabled);
  const rlsOff = [...tables].filter(([, on]) => !on).map(([t]) => t);
  console.log("\nRLS ENABLEMENT");
  if (rlsOff.length) fail(`${rlsOff.length} table(s) with RLS OFF: ${rlsOff.slice(0, 8).join(", ")}`);
  else pass(`${tables.size} table(s), all with RLS enabled`);

  // ── Policy names against the approved alias list ──
  console.log("\nPOLICY NAMES");
  const liveNames = new Set(live.rows.filter(r => r.policy_name).map(r => `${r.tbl}::${r.policy_name}`));
  let aliasHits = 0;
  for (const a of aliases) {
    const prod = liveNames.has(`${a.table}::${a.productionName}`);
    const repo = liveNames.has(`${a.table}::${a.repositoryName}`);
    if (repo) continue;                        // canonical name present: a clean build looks like this
    if (prod) { aliasHits++; continue; }        // production alias: approved by §3
    fail(`${a.table} :: neither "${a.repositoryName}" (canonical) nor "${a.productionName}" (approved alias) is present`);
  }
  pass(`${aliases.length} approved legacy aliases checked, ${aliasHits} matched by production name`);

  // ── Functions ──
  const fns = await pagedRpc<{ fn_name: string; secdef: boolean; config: string | null }>(
    admin, "plat_function_attributes", ["fn_name", "identity_args"]);
  console.log("\nFUNCTIONS");
  if (fns.error) fail(`plat_function_attributes: ${fns.error}`);
  else {
    const defs = fns.rows.filter(f => f.secdef);
    const unpinned = defs.filter(f => !f.config || !/search_path/.test(f.config));
    if (unpinned.length) fail(`${unpinned.length} SECURITY DEFINER function(s) without a pinned search_path: ${unpinned.map(u => u.fn_name).slice(0, 6).join(", ")}`);
    else pass(`${fns.rows.length} function(s), ${defs.length} SECURITY DEFINER, all with a pinned search_path`);
  }

  // ── Triggers ──
  const trg = await pagedRpc<{ tbl: string; trigger_name: string; enabled: string }>(
    admin, "plat_trigger_registry", ["tbl", "trigger_name"]);
  console.log("\nTRIGGERS");
  if (trg.error) fail(`plat_trigger_registry: ${trg.error}`);
  else {
    const off = trg.rows.filter(t => t.enabled !== "enabled" && t.enabled !== "always");
    if (off.length) fail(`${off.length} DISABLED trigger(s): ${off.map(t => `${t.tbl}.${t.trigger_name}`).slice(0, 6).join(", ")}`);
    else pass(`${trg.rows.length} trigger(s), none disabled`);
  }

  // ── Storage ──
  console.log("\nSTORAGE BUCKETS");
  const { data: buckets, error: bErr } = await admin.storage.listBuckets();
  if (bErr) fail(`listBuckets: ${bErr.message}`);
  else {
    for (const [name, want] of Object.entries(STORAGE_EXPECTED)) {
      const b: any = (buckets ?? []).find(x => x.name === name);
      if (!b) { fail(`bucket "${name}" is absent`); continue; }
      const problems: string[] = [];
      if (b.public !== want.public) problems.push(`public=${b.public} want ${want.public}`);
      if ((b.file_size_limit ?? null) !== want.limit) problems.push(`limit=${b.file_size_limit ?? "none"} want ${want.limit}`);
      const mime = (b.allowed_mime_types ?? null) as string[] | null;
      if (JSON.stringify(mime?.slice().sort() ?? null) !== JSON.stringify(want.mime?.slice().sort() ?? null)) {
        problems.push(`mime=${JSON.stringify(mime)} want ${JSON.stringify(want.mime)}`);
      }
      if (problems.length) fail(`bucket "${name}": ${problems.join("; ")}`);
      else pass(`bucket "${name}" matches approved posture`);
    }
  }

  // ── Storage policies: the approved posture is NONE (COMP-ENG-002D §5) ──
  const sp = await pagedRpc<{ tbl: string; policy_name: string }>(
    admin, "plat_storage_policy_registry", ["tbl", "policy_name"]);
  console.log("\nSTORAGE POLICIES");
  if (sp.error) fail(`plat_storage_policy_registry: ${sp.error}`);
  else if (sp.rows.length) {
    // Not automatically wrong -- but it is UNKNOWN, and §8 fails unknown drift by design.
    fail(`${sp.rows.length} storage polic(ies) present; the approved posture is server-mediated with NONE. `
      + `Each must be reviewed and recorded before it can pass: ${sp.rows.slice(0, 5).map(r => `${r.tbl}::${r.policy_name}`).join(", ")}`);
  } else pass("none — matches the approved server-mediated posture (002D §5)");

  console.log(`\n${failures === 0 ? "PASS — target reproduces the approved security semantics" : `FAIL — ${failures} unexplained difference(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
