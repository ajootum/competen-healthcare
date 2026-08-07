/**
 * Seed CPR-CPL-001's catalogue into the PLATFORM parameter library.
 *
 *   npx --yes tsx scripts/cpl-catalogue-seed.ts            # report only  (DEFAULT)
 *   npx --yes tsx scripts/cpl-catalogue-seed.ts --apply    # write
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * ⚠ --apply CURRENTLY REFUSES, AND THE REFUSAL IS THE POINT OF THIS FILE.
 *
 * The catalogue belongs at LCP s4's top tier: `workspace_id IS NULL`, the platform library every
 * practice reads and none owns. migration 246 s1 and s3 build that tier -- two partial unique indexes,
 * a read filter of `workspace_id is null or workspace_id = $me`, a pack table with the same nullable
 * column. What migration 246 does NOT come with is a way to write it:
 *
 *   createDefinition   writes workspace_id: ctx.workspaceId, unconditionally
 *   createPack         writes workspace_id: ctx.workspaceId, unconditionally
 *   setPackItem        refuses any pack whose workspace_id is not ctx.workspaceId, in as many words
 *   ensureCoreLibrary  writes workspace_id: null -- and takes no argument, and inserts CORE_LIBRARY
 *
 * ensureCoreLibrary is the ONLY platform writer in the codebase and it is hard-coded to LCP s5's
 * sixteen core parameters. For PACKS there is no platform writer at all: the table has the tier and
 * nothing fills it, which is exactly why the Clinical Parameters page shows zero packs today.
 *
 * So a seeder assembled out of the shipped functions can only author this catalogue INSIDE ONE
 * TENANT -- and a catalogue inside one tenant is not a catalogue. No second practice can see it,
 * installPack would refuse it to everyone else, and CPL s24's "platform master" would be a row owned by
 * whichever practice happened to run this script. Writing the platform rows directly from here instead
 * would put a second copy of the engine's insert rules in scripts/, which is the shape this codebase
 * has already been bitten by twice (the partial-index upsert trap, and unit tables that disagree).
 *
 * ⚠ THE FIX IS ONE FUNCTION AND IT BELONGS IN parameters.ts, NOT HERE. See ENGINE_GAPS.platform_scope
 * in cpl-catalogue.ts. When `ensurePlatformCatalogue` exists, applyPlatform() below becomes a call to
 * it and this refusal is deleted.
 *
 * ⚠ WHAT THIS SCRIPT DOES DO, and it is not nothing: it validates every catalogue row against the
 * engine's own vocabularies and migration 246's own constraints, reads the live platform library, and
 * reports the exact diff -- so the moment the writer exists, what it will write is already known and
 * already checked. It is idempotent by construction: it computes a diff, so running it twice reports
 * the same diff and a second run after a successful apply reports nothing to do.
 *
 * ⚠ AND IT INSTALLS NOTHING. Authoring the library and installing a pack into a practice are two acts
 * (CPL s2, s24). This script never touches practice_parameter_activation, and the harness asserts the
 * activation count is unchanged after the whole catalogue has been pushed through the real engine.
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  CATALOGUE_DEFINITIONS, CATALOGUE_PACKS, CATALOGUE_REFUSALS, ENGINE_GAPS, CODE_PATTERN, validate,
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

  // ── 4. The refusal ──────────────────────────────────────────────────────────────────────────────
  if (!apply) {
    console.log("\n  DRY RUN. Nothing was written. Pass --apply to see why that is currently refused.\n");
    return;
  }

  const blocker = ENGINE_GAPS.find(g => g.key === "platform_scope")!;
  console.error(`\n  REFUSED -- ${blocker.label}\n`);
  console.error(`  ${blocker.detail.replace(/(.{100}\S*)\s/g, "$1\n  ")}\n`);
  console.error(`  WOULD REQUIRE\n  ${blocker.wouldRequire.replace(/(.{100}\S*)\s/g, "$1\n  ")}\n`);
  console.error(`  ${ENGINE_GAPS.length - 1} further fields this catalogue authors have no route through the engine either:`);
  for (const g of ENGINE_GAPS) if (g.key !== "platform_scope") console.error(`    - ${g.label}`);
  console.error("\n  Nothing was written, and no parameter was activated in any practice.\n");
  // ⚠ exitCode, NOT exit(). process.exit() tears the loop down while the Supabase client still holds
  // open handles, and libuv aborts with an assertion AFTER the refusal has printed -- which makes a
  // deliberate, well-explained refusal look like a crash.
  process.exitCode = 1;
}

main().catch(e => { console.error(e); process.exit(1); });
