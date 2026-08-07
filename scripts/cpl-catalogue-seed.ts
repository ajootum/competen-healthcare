/**
 * Seed CPR-CPL-001's catalogue into the PLATFORM parameter library.
 *
 *   npx --yes tsx scripts/cpl-catalogue-seed.ts            # report only  (DEFAULT)
 *   npx --yes tsx scripts/cpl-catalogue-seed.ts --apply    # write
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ THIS SCRIPT'S OUTPUT IS THE ONLY RECORD THAT THE CATALOGUE WAS SEEDED. READ THAT SENTENCE TWICE.
 *
 * ensurePlatformCatalogue writes NO practice audit entry, and its own header says why: authoring the
 * platform library is not a practice act, provisioning.audit is keyed on a workspace, and naming some
 * arbitrary practice to satisfy the column would put a false record in the one trail that must not
 * carry one. That decision was taken deliberately -- and it means there is no `practice.parameter.*`
 * event anywhere to reconstruct this run from.
 *
 * So this script NAMES EVERY CODE IT INSERTED and every code it found already there. That listing is
 * the record. If the output is not kept, nothing else in the system knows when these 37 definitions
 * and 5 packs arrived or which run put them there. A platform-level audit trail -- its own table, with
 * no workspace column -- is its own piece of work.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ IDEMPOTENT, AND NOT BY CHECKING A FLAG. ensurePlatformCatalogue reads the platform tier, inserts
 * only the codes missing from it, and NEVER upserts -- the platform unique indexes are PARTIAL and
 * cannot be `on conflict` targets, which is the shape that produced two silent write failures here. A
 * second run creates nothing and says `0 created` rather than reporting the same figure twice.
 *
 * ⚠ AND IT NEVER UPDATES A DEFINITION THAT ALREADY EXISTS. Re-running this after editing the catalogue
 * does NOT push the edit: rewriting a live definition in place would retrospectively change the unit
 * and plausibility window every historical measurement was recorded against, which is the silent
 * rewriting LCP s3 forbids. Changing a shipped definition is a versioned edit, not a re-seed.
 *
 * ⚠ AND IT INSTALLS NOTHING. Authoring the library and installing a pack into a practice are two acts
 * (CPL s2 "inactive until selected by a practitioner", s24 "activation can be performed from the
 * Patient Workspace"). Nothing here touches practice_parameter_activation, and both the dry run and the
 * apply print the activation count so a reader can see it did not move.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { ensurePlatformCatalogue } from "../src/lib/practice/parameters";
import {
  CATALOGUE_DEFINITIONS, CATALOGUE_PACKS, CATALOGUE_REFUSALS, CODE_PATTERN, validate,
  toPlatformDefinitions, toPlatformPacks,
} from "./cpl-catalogue";

loadEnvConfig(process.cwd());

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

const apply = process.argv.includes("--apply");

type Row = { code: string; workspace_id: string | null };

async function main() {
  console.log(`\nCPR-CPL-001 catalogue seed -- ${apply ? "APPLY REQUESTED" : "DRY RUN"}\n`);

  // ── 1. The catalogue checks out before anything reads the database ──────────────────────────────
  const problems = CATALOGUE_DEFINITIONS.flatMap(validate);
  const seen = new Set<string>();
  for (const d of CATALOGUE_DEFINITIONS) {
    if (seen.has(d.code)) problems.push(`${d.code}: named twice in the catalogue`);
    seen.add(d.code);
  }
  const packSeen = new Set<string>();
  for (const p of CATALOGUE_PACKS) {
    if (!CODE_PATTERN.test(p.code)) problems.push(`pack ${p.code}: code does not match migration 246 s3's pattern`);
    if (packSeen.has(p.code)) problems.push(`pack ${p.code}: named twice`);
    packSeen.add(p.code);
    if (p.items.length === 0) problems.push(`pack ${p.code}: no items -- installPack refuses an empty pack`);
  }
  if (problems.length > 0) {
    console.error("  the catalogue does not satisfy migration 246, so nothing was read or written:");
    for (const p of problems) console.error(`    ${p}`);
    process.exit(1);
  }
  console.log(`  ${CATALOGUE_DEFINITIONS.length} definitions and ${CATALOGUE_PACKS.length} packs check out against`);
  console.log(`  LCP s6's vocabularies and migration 246's constraints.\n`);

  // ── 2. What is in the platform library now ──────────────────────────────────────────────────────
  const [defRes, packRes, actRes] = await Promise.all([
    admin.from("practice_parameter_definition").select("code, workspace_id").is("workspace_id", null),
    admin.from("practice_parameter_pack").select("code, workspace_id").is("workspace_id", null),
    admin.from("practice_parameter_activation").select("id"),
  ]);
  // ⚠ A FAILED READ IS NOT AN EMPTY LIBRARY. Reporting "37 to create" against a library that could not
  // be read would be a confident plan built on nothing.
  if (defRes.error || defRes.data == null) {
    console.error(`  the platform library could not be read, so nothing was done: ${defRes.error?.message ?? "no rows and no error"}`);
    process.exit(1);
  }
  if (packRes.error || packRes.data == null) {
    console.error(`  the platform pack list could not be read, so nothing was done: ${packRes.error?.message ?? "no rows and no error"}`);
    process.exit(1);
  }

  const haveDefs = new Set((defRes.data as Row[]).map(r => r.code));
  const havePacks = new Set((packRes.data as Row[]).map(r => r.code));
  const missingDefs = CATALOGUE_DEFINITIONS.filter(d => !haveDefs.has(d.code));
  const missingPacks = CATALOGUE_PACKS.filter(p => !havePacks.has(p.code));

  console.log(`  BEFORE  platform definitions ${haveDefs.size} · platform packs ${havePacks.size} · activations ${actRes.error ? "unreadable" : (actRes.data ?? []).length}`);
  console.log(`  TO DO   ${missingDefs.length} definitions · ${missingPacks.length} packs\n`);

  // ── 3. Every pack item has to name a definition that will exist ─────────────────────────────────
  const willExist = new Set([...haveDefs, ...CATALOGUE_DEFINITIONS.map(d => d.code)]);
  let danglers = 0;
  for (const p of CATALOGUE_PACKS)
    for (const item of p.items)
      if (!willExist.has(item)) { danglers++; console.log(`  DANGLING  pack ${p.code} names ${item}, which no definition supplies`); }
  if (danglers > 0) { console.error(`\n  ${danglers} pack items name a parameter that does not exist. Nothing written.`); process.exit(1); }

  for (const p of CATALOGUE_PACKS) {
    const reused = p.items.filter(i => haveDefs.has(i) && !CATALOGUE_DEFINITIONS.some(d => d.code === i));
    console.log(`  pack  ${p.code.padEnd(36)} ${String(p.items.length).padStart(2)} items${reused.length ? `  (reuses core: ${reused.join(", ")})` : ""}`);
  }
  console.log("");
  for (const d of missingDefs)
    console.log(`  ${apply ? "WOULD" : "would"} create  ${d.code.padEnd(34)} ${d.category}/${d.data_type}${d.canonical_unit ? ` ${d.canonical_unit}` : ""}  ${d.status}${d.scale_unstated ? "  [scale unstated]" : ""}`);

  console.log(`\n  ${CATALOGUE_REFUSALS.length} things this catalogue deliberately does not author:`);
  for (const r of CATALOGUE_REFUSALS) console.log(`    - ${r.label}`);

  if (!apply) {
    console.log("\n  DRY RUN. Nothing was written. Pass --apply to seed the platform library.\n");
    return;
  }

  // ── 4. The write ────────────────────────────────────────────────────────────────────────────────
  //
  // ⚠ ONE CALL, INTO THE ENGINE. Every insert rule -- the partial-index avoidance, the version
  // snapshot, the never-discarded error -- lives in ensurePlatformCatalogue and NOT here. A second copy
  // of those rules in scripts/ is the shape this codebase has already been bitten by twice.
  const result = await ensurePlatformCatalogue(admin, toPlatformDefinitions(), toPlatformPacks());
  if (!result.ok) {
    console.error(`\n  FAILED -- ${result.code}: ${result.message}`);
    console.error("  Nothing further was attempted, and no parameter was activated in any practice.\n");
    process.exitCode = 1;
    return;
  }

  const r = result.data;
  console.log("\n  WRITTEN.");
  // ⚠ THE LISTING IS THE RECORD. There is no practice audit entry for a platform write -- see the
  // header, and ensurePlatformCatalogue's own comment. If this output is not kept, nothing in the
  // system can say which run created these rows.
  console.log(`\n  definitions created (${r.definitionsCreated}):`);
  for (const code of r.createdDefinitions) console.log(`    + ${code}`);
  if (r.definitionsCreated === 0) console.log("    (none -- all 37 were already in the platform library)");
  console.log(`\n  packs created (${r.packsCreated}):`);
  for (const code of r.createdPacks) console.log(`    + ${code}`);
  if (r.packsCreated === 0) console.log("    (none -- all 5 were already in the platform library)");
  console.log(`\n  pack items created: ${r.itemsCreated}${r.itemsExisting ? ` (${r.itemsExisting} already present)` : ""}`);

  // ── 5. Counts after, read back rather than inferred ─────────────────────────────────────────────
  //
  // ⚠ READ BACK, NOT COMPUTED FROM THE RETURN VALUE. "before + created" is what the code believes; this
  // is what the database contains. They differ exactly when something went wrong quietly.
  const [afterDefs, afterPacks, afterItems, afterActs] = await Promise.all([
    admin.from("practice_parameter_definition").select("id").is("workspace_id", null),
    admin.from("practice_parameter_pack").select("id").is("workspace_id", null),
    admin.from("practice_parameter_pack_item").select("id"),
    admin.from("practice_parameter_activation").select("id"),
  ]);
  const n = (x: { data: unknown[] | null; error: unknown }) => x.error ? "unreadable" : String((x.data ?? []).length);
  console.log(`\n  AFTER   platform definitions ${n(afterDefs)} · platform packs ${n(afterPacks)} · pack items ${n(afterItems)} · activations ${n(afterActs)}`);

  // ⚠ THE ACTIVATION COUNT IS PRINTED SO A READER CAN SEE IT DID NOT MOVE. CPL s2: a pack is inactive
  // until a practitioner selects it. Seeding the library installs nothing into any practice.
  console.log("  No parameter was activated in any practice. Installing a pack remains a practitioner's act (CPL s24).\n");
}

main().catch(e => { console.error(e); process.exit(1); });
