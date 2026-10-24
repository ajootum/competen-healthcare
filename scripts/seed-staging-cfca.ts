/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * CFCA STAGING MIRROR -- the clinical reference structure of production (domains, practices, clinical
 * practice units, blueprints, competencies: the CKCM spine, migration 011) reproduced on STAGING from a
 * COMMITTED export, by the same ids, so a catalogue built on staging references what production holds.
 *
 *   npx tsx scripts/seed-staging-cfca.ts                       create or update (idempotent, by id)
 *   npx tsx scripts/seed-staging-cfca.ts --verify              read only: what of the export is on staging
 *   npx tsx scripts/seed-staging-cfca.ts --remove              delete exactly the exported ids
 *   ... --file <path>                                          another export (default supabase/reference/cfca-export.json)
 *
 * The export is made by supabase/reference/cfca-export.sql, run by the owner in the production SQL editor
 * under a GO. This script never connects to production: it refuses unless STAGING_SUPABASE_URL is a
 * confirmed non-production project.
 *
 * ⚠ NON-PERSONAL ONLY. Every key of every exported row is checked against the allowlist below before
 * anything is written. A key outside it (an owner, a creator, any person column) stops the run.
 *
 * ⚠ PRESERVED, NOT EXPOSED. Frameworks keep the publication status production gave them. Nothing here
 * touches the Individual allowlists, so no mirrored framework is offered to Scholar or Professional.
 *
 * ⚠ NOT CLINICALLY APPROVED BY BEING HERE. A mirrored record is a copy of the reference structure, not a
 * clinical review of it. Controlled catalogues carry their own content status (migration 394).
 */
import { readFileSync, existsSync } from "node:fs";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { judgeTarget } from "./production-guard";
import { SECTIONS, checkExport, rowsFor } from "./cfca-export";

loadEnvConfig(process.cwd());
const url = process.env.STAGING_SUPABASE_URL ?? "", key = process.env.STAGING_SERVICE_ROLE_KEY ?? "";
const verdict = judgeTarget(url);
if (!verdict.ok || !key) { console.error(`REFUSING: STAGING_SUPABASE_URL is not a confirmed non-production project (${verdict.ok ? "no key" : verdict.reason}).`); process.exit(1); }
const admin: any = createClient(url, key, { auth: { persistSession: false } });
const mode = process.argv.includes("--remove") ? "remove" : process.argv.includes("--verify") ? "verify" : "create";
const fileArg = process.argv.indexOf("--file");
const FILE = fileArg > -1 ? process.argv[fileArg + 1] : "supabase/reference/cfca-export.json";

async function main() {
  if (!existsSync(FILE)) { console.error(`No export at ${FILE}. The owner produces it with supabase/reference/cfca-export.sql (production, read-only, under a GO).`); process.exit(1); }
  const doc = JSON.parse(readFileSync(FILE, "utf8"));
  const bad = checkExport(doc);
  if (bad.length) { console.error(`REFUSING: the export is not safe to mirror:\n  ${bad.slice(0, 20).join("\n  ")}`); process.exit(1); }
  console.log(`CFCA mirror -- ${mode} -- target ${(verdict as any).ref} -- export of ${doc.exported_at}, ${doc.hospital_owned_practices} hospital-owned practice(s) not exported`);

  if (mode === "remove") {
    for (const s of [...SECTIONS].reverse()) {
      const ids = doc[s.key].map((r: any) => r.id);
      if (ids.length) { const r = await admin.from(s.table).delete().in("id", ids); console.log(`  ${s.table}: ${r.error ? `FAILED ${r.error.message}` : `removed up to ${ids.length}`}`); }
    }
    return;
  }

  let differs = 0;
  // A parent framework outside the export is kept when the target already holds that very id.
  const parents = [...new Set(doc.frameworks.map((f: any) => f.parent_framework_id).filter(Boolean))] as string[];
  const onTarget = new Set<string>(parents.length ? ((await admin.from("frameworks").select("id").in("id", parents)).data ?? []).map((r: any) => r.id) : []);
  for (const s of SECTIONS) {
    const { rows, cleared } = rowsFor(doc, s.key, onTarget);
    if (!rows.length) { console.log(`  ${s.table}: nothing exported`); continue; }
    if (mode === "create") {
      const r = await admin.from(s.table).upsert(rows, { onConflict: "id" });
      if (r.error) { console.error(`  ${s.table}: FAILED ${r.error.message}`); process.exit(1); }
    }
    const { data, error } = await admin.from(s.table).select(s.cols.join(", ")).in("id", rows.map(r => r.id));
    if (error) { console.error(`  ${s.table}: unreadable ${error.message}`); process.exit(1); }
    const have = new Map((data ?? []).map((r: any) => [r.id, r]));
    const same = rows.filter(r => { const h: any = have.get(r.id); return h && s.cols.every(c => String(h[c] ?? "") === String(r[c] ?? "")); }).length;
    differs += rows.length - same;
    console.log(`  ${s.table}: ${have.size}/${rows.length} present, ${same} identical${cleared.length ? `, ${cleared.length} link(s) outside the export cleared` : ""}`);
  }
  // Same name or code, different id: a staging record that is NOT the production one. Reported, never merged.
  const fwNames = doc.frameworks.map((f: any) => f.name);
  const twins = fwNames.length ? (await admin.from("frameworks").select("id, name").is("hospital_id", null).in("name", fwNames)).data ?? [] : [];
  const exported = new Set(doc.frameworks.map((f: any) => f.id));
  const clash = twins.filter((t: any) => !exported.has(t.id));
  if (clash.length) console.log(`  NOTE  ${clash.length} staging framework(s) share a name with an exported one but are different records: ${clash.map((c: any) => c.name).join(", ")}`);
  console.log(differs ? `\n${differs} exported row(s) differ on staging` : "\nstaging holds the export exactly");
  process.exit(mode === "verify" && differs ? 1 : 0);
}

if (process.argv[1]?.endsWith("seed-staging-cfca.ts")) main().catch(e => { console.error(e); process.exit(1); });
