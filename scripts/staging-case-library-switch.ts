/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * THE OWNER'S STAGING CASE-LIBRARY SWITCH -- the case_library platform flag (src/lib/cases/policy.ts), STAGING ONLY.
 *
 *   npx tsx scripts/staging-case-library-switch.ts --status            read only: the flag, and the harness fixture cases
 *   npx tsx scripts/staging-case-library-switch.ts --on                switch the case library ON for a staging test
 *   npx tsx scripts/staging-case-library-switch.ts --off               switch it back OFF (the default state)
 *   npx tsx scripts/staging-case-library-switch.ts --retire-fixtures   retire every ACTIVE CASE-HARNESS-* case (a case
 *                                                                      kept published for a combined run)
 *
 * ⚠ FOR THE OWNER TO RUN, NOT AN AGENT. The flag is the case library's gate (CLAUDE.md lifecycle state 3): with it OFF,
 * nothing that starts case work runs. Nothing in the application can switch it, and this script is not reachable from
 * the application: it is run by hand, against staging only.
 * ⚠ STAGING ONLY. It refuses unless STAGING_SUPABASE_URL is a confirmed non-production project (production-guard).
 * ⚠ ALWAYS SWITCH IT BACK OFF after the test, and retire any kept fixture case. --status says which state it is in.
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { CASE_LIBRARY_FLAG } from "../src/lib/cases/policy";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--on") ? "on" : process.argv.includes("--off") ? "off" : process.argv.includes("--retire-fixtures") ? "retire" : "status";

async function fixtures() {
  const { data, error } = await admin.from("case_library_case").select("id, code, status").like("code", "CASE-HARNESS-%").order("code");
  if (error) return { error: error.message, rows: [] as any[] };
  const rows = [];
  for (const c of data ?? []) {
    const { data: v } = await admin.from("case_library_version").select("id, state").eq("case_id", c.id).eq("state", "published").limit(1);
    const deliverable = v?.[0] ? (await admin.rpc("case_library_deliverable", { p_version: v[0].id })).data === true : false;
    rows.push({ ...c, publishedVersion: v?.[0]?.id ?? null, deliverable });
  }
  return { error: null, rows };
}

async function main() {
  const read = async () => (await admin.from("practice_platform_flags").select("flag, enabled, note").eq("flag", CASE_LIBRARY_FLAG).maybeSingle());
  const before = await read();
  if (before.error) { console.error(`The flag could not be read: ${before.error.message}`); process.exit(1); }
  console.log(`staging ${verdict.ok ? verdict.ref : ""}: case_library is ${before.data?.enabled ? "ON" : "OFF"}${before.data?.note ? ` (${before.data.note})` : " (no row: off)"}`);
  if (mode === "on" || mode === "off") {
    const note = mode === "on"
      ? `ON for a staging case-library test, by the owner, ${new Date().toISOString()}. Switch OFF after: --off.`
      : `OFF (the default), by the owner, ${new Date().toISOString()}.`;
    const w = await admin.from("practice_platform_flags").upsert({ flag: CASE_LIBRARY_FLAG, enabled: mode === "on", note });
    if (w.error) { console.error(`The flag could not be written: ${w.error.message}`); process.exit(1); }
    const after = await read();
    console.log(`now: case_library is ${after.data?.enabled ? "ON" : "OFF"}`);
  }
  if (mode === "retire") {
    const f = await fixtures();
    if (f.error) { console.error(`The fixture cases could not be read: ${f.error}`); process.exit(1); }
    for (const c of f.rows.filter(r => r.status === "active")) {
      const r = await admin.rpc("case_library_retire", { p_case: c.id });
      console.log(`${r.error ? "COULD NOT RETIRE" : "retired"} ${c.code}${r.error ? `: ${r.error.message}` : ""}`);
    }
  }
  const f = await fixtures();
  if (f.error) { console.log(`fixture cases: could not be read (${f.error})`); return; }
  console.log(`fixture cases (CASE-HARNESS-*): ${f.rows.length ? "" : "none"}`);
  for (const c of f.rows) console.log(`  ${c.code}  ${c.status}${c.publishedVersion ? `  published version ${c.publishedVersion}  ${c.deliverable ? "DELIVERABLE" : "not deliverable"}` : ""}`);
}
main().catch(e => { console.error(e); process.exit(1); });
