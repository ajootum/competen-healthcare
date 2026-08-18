/**
 * CPR-CORE-MOS-001 PHASE 1 ACCEPTANCE.
 *
 * The owner's four conditions, proved rather than asserted:
 *
 *   A1  the mos_subject_type vocabulary matches the agreed subject model
 *   A2  every live Practice resolves to a canonical subject deterministically
 *   A3  the parent/context chain resolves correctly for the live estate
 *   A4  renaming, archiving or otherwise changing a Practice in its SOURCE record is immediately
 *       reflected through the subject view with no synchronization job
 *
 * plus the guardrail issued with them:
 *
 *   G1  the subject layer stays IDENTITY-ONLY and does not become a shadow source of truth for
 *       Practice metadata, entitlements, governance state, incidents or commercial state
 *
 * ⚠ A4 IS THE ONE THAT CANNOT BE PROVED BY READING. Every other pin here inspects state; A4 is a claim
 * about what happens when the source changes, so it MUTATES a fixture workspace and re-reads. It never
 * touches a real practice: the fixture is created under the estate's fixture-owner prefix, is deleted in
 * a finally block, and is registered with cleanupOnKill so a killed run does not leave it behind — which
 * is the failure that seeded estate-hygiene-harness in the first place.
 *
 *   npx --yes tsx scripts/mos-phase1-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { FIXTURE_OWNER_PREFIX, cleanupOnKill } from "./_cleanup";
import {
  SUBJECT_TYPES, SINGLETON_TYPES, SUBJECT_COLUMNS,
  loadSubjects, loadSubjectTypes, resolveSubject, subjectChain, practiceSubject,
} from "../src/lib/hq/mos-subject";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false } }) as any;

let pass = 0;
const failures: string[] = [];
const ok = (id: string, cond: boolean, msg: string) => {
  if (cond) { pass++; console.log(`  PASS  ${id}  ${msg}`); }
  else { failures.push(`${id}  ${msg}`); console.log(`  FAIL  ${id}  ${msg}`); }
};

// ⚠ HEX ONLY. A first version ended this uuid with "mos1" to make it identifiable in a table listing,
// which is not hex and which Postgres rejected — so the fixture never got created and A4 reported the
// reflection property UNPROVEN rather than passing. The trailing 312 names the migration instead.
const FIXTURE_OWNER = `${FIXTURE_OWNER_PREFIX}0000-4000-8000-000000000312`;
let fixtureId: string | null = null;

async function dropFixture() {
  if (!fixtureId) return;
  await admin.from("practice_workspace").delete().eq("id", fixtureId);
  fixtureId = null;
}
cleanupOnKill(dropFixture);

async function main() {
  console.log("\nCPR-CORE-MOS-001 PHASE 1 ACCEPTANCE\n");

  // ── is the migration applied at all? ──────────────────────────────────────
  // ⚠ A DISTINCT ANSWER, NOT A PILE OF FAILURES. An un-applied migration would fail every pin below for
  // the same reason, and a wall of red says "phase 1 is broken" when it means "phase 1 is not deployed".
  const vocab = await loadSubjectTypes(admin);
  if (vocab === null) {
    console.log("  ---- MIGRATION 312 IS NOT APPLIED ----");
    console.log("  mos_subject_type could not be read, so none of the four acceptance conditions can be");
    console.log("  evaluated. This is a deployment state, not a failure of the model.\n");
    console.log("NOT READY  0 passed, 0 failed, 5 conditions unevaluated\n");
    process.exit(2);
  }

  // ── A1 · the vocabulary matches the agreed model ──────────────────────────
  const codes = vocab.map(v => v.code).sort();
  ok("A1a", JSON.stringify(codes) === JSON.stringify([...SUBJECT_TYPES].sort()),
    `the vocabulary is exactly the eight agreed subject types — [${codes.join(", ")}]`);

  const singles = vocab.filter(v => v.singleton).map(v => v.code).sort();
  ok("A1b", JSON.stringify(singles) === JSON.stringify([...SINGLETON_TYPES].sort()),
    `platform and product are the only singletons — [${singles.join(", ")}]`);

  ok("A1c", vocab.every(v => v.description.trim().length > 10),
    "every subject type carries a description, so a later table cannot key against an unexplained code");

  // ── A2 · every live Practice resolves deterministically ───────────────────
  const wsRes = await admin.from("practice_workspace").select("id, name, status");
  const workspaces = (wsRes.error ? [] : wsRes.data) as { id: string; name: string; status: string }[];
  ok("A2a", !wsRes.error && workspaces.length > 0,
    `control: ${workspaces.length} live workspaces were read — A2 and A3 are vacuous over an empty estate`);

  const subjects = await loadSubjects(admin);
  const practiceSubjects = (subjects ?? []).filter(s => s.subjectType === "practice");
  ok("A2b", practiceSubjects.length === workspaces.length,
    `every live Practice has a subject — ${workspaces.length} workspaces, ${practiceSubjects.length} practice subjects`);

  const ids = practiceSubjects.map(s => s.subjectId);
  ok("A2c", new Set(ids).size === ids.length,
    "no Practice resolves to two subjects — subject identity is deterministic, not merely present");

  const resolvedEach = await Promise.all(workspaces.map(w => practiceSubject(admin, w.id)));
  const mismatched = workspaces.filter((w, i) => resolvedEach[i]?.label !== w.name);
  ok("A2d", resolvedEach.every(Boolean) && mismatched.length === 0,
    `each workspace resolves by its own id to a subject labelled with its own name${mismatched.length ? " — mismatched: " + mismatched.map(w => w.name).join(", ") : ""}`);

  // ── A3 · the parent chain resolves for the live estate ────────────────────
  const chains = await Promise.all(workspaces.map(w => subjectChain(admin, "practice", w.id)));
  ok("A3a", chains.every(c => c !== null && c.length === 3),
    `every Practice resolves a three-link chain — practice, market, product (${chains.map(c => c?.length ?? 0).join(", ")})`);

  const shapes = chains.map(c => c?.map(s => s.subjectType).join(" > "));
  ok("A3b", shapes.every(s => s === "practice > market > product"),
    `every chain has the agreed shape — [${[...new Set(shapes)].join(" | ")}]`);

  const roots = chains.map(c => c?.[c.length - 1]);
  ok("A3c", roots.every(r => r?.parentType === "platform"),
    "every chain terminates at the product, whose parent is the platform root");

  const marketsUsed = [...new Set(chains.map(c => c?.[1]?.subjectId).filter(Boolean))];
  const marketSubjects = (subjects ?? []).filter(s => s.subjectType === "market").map(s => s.subjectId);
  ok("A3d", marketsUsed.every(m => marketSubjects.includes(m as string)),
    `every market a Practice names exists as a market subject — [${marketsUsed.join(", ")}]`);

  // ── A4 · a source change is reflected with no synchronization job ─────────
  try {
    const created = await admin.from("practice_workspace").insert({
      name: "MOS phase 1 acceptance fixture",
      owner_person_id: FIXTURE_OWNER,
      country: "ZZ",
      timezone: "UTC",
    }).select("id").limit(1);

    if (created.error || !created.data?.[0]?.id) {
      ok("A4", false, `could not create the fixture workspace, so the reflection property is UNPROVEN — ${String(created.error?.message ?? "no id returned").slice(0, 90)}`);
    } else {
      fixtureId = created.data[0].id as string;

      const onCreate = await practiceSubject(admin, fixtureId);
      ok("A4a", onCreate?.label === "MOS phase 1 acceptance fixture",
        "a Practice created a moment ago is already a subject — no job ran between the insert and this read");

      const RENAMED = "MOS phase 1 acceptance fixture (renamed)";
      await admin.from("practice_workspace").update({ name: RENAMED }).eq("id", fixtureId);
      const onRename = await practiceSubject(admin, fixtureId);
      ok("A4b", onRename?.label === RENAMED,
        "⚠ a RENAME in the source record is reflected on the next read — the property the view exists to guarantee");

      await admin.from("practice_workspace").update({ country: "YY" }).eq("id", fixtureId);
      const onRescope = await subjectChain(admin, "practice", fixtureId);
      ok("A4c", onRescope?.[1]?.subjectId === "YY",
        "a change of market re-parents the subject immediately — the CHAIN is derived too, not only the label");

      await dropFixture();
      const afterDelete = await resolveSubject(admin, "practice", created.data[0].id as string);
      ok("A4d", afterDelete === null,
        "a removed Practice stops being a subject at once — there is no copy left holding it open");
    }
  } finally {
    await dropFixture();
  }

  const leftover = await admin.from("practice_workspace").select("id").eq("owner_person_id", FIXTURE_OWNER);
  ok("A4e", !leftover.error && (leftover.data ?? []).length === 0,
    "control: the fixture left nothing behind in the estate");

  // ── G1 · the subject layer stays identity-only ────────────────────────────
  // ⚠ THE FIRST VERSION OF THIS PIN WAS TAUTOLOGICAL: it compared SUBJECT_COLUMNS against an object
  // literal written on the line above it, so it asserted that a constant equals itself and would have
  // passed however wide the subject layer grew. What it must check is the shape the RESOLVER hands a
  // caller, since that is what a consumer would be tempted to read a Practice's state from.
  const sample = (subjects ?? [])[0];
  const resolverKeys = sample ? Object.keys(sample).sort() : [];
  ok("G1a", JSON.stringify(resolverKeys) === JSON.stringify(["label", "parentId", "parentType", "subjectId", "subjectType"]),
    `the resolver hands a caller exactly five identity fields and nothing else — [${resolverKeys.join(", ")}]`);

  const raw = await admin.from("mos_subject").select("*").limit(1);
  const actualCols = raw.error || !raw.data?.[0] ? [] : Object.keys(raw.data[0]).sort();
  ok("G1b", JSON.stringify(actualCols) === JSON.stringify([...SUBJECT_COLUMNS].sort()),
    `⚠ and the DATABASE agrees — select * returns only those five, so the layer cannot have widened without this failing — [${actualCols.join(", ")}]`);

  const FORBIDDEN = ["status", "plan", "entitlement", "incident", "risk", "subscription", "capability", "owner_person"];
  const leaked = actualCols.filter(c => FORBIDDEN.some(f => c.includes(f)));
  ok("G1c", leaked.length === 0,
    `no metadata, entitlement, governance, incident or commercial field has appeared on the subject${leaked.length ? " — leaked: " + leaked.join(", ") : ""}`);

  const resolverSrc = readFileSync("src/lib/hq/mos-subject.ts", "utf8");
  const otherReads = [...resolverSrc.matchAll(/\.from\("([a-z_]+)"\)/g)].map(m => m[1])
    .filter(t => t !== "mos_subject" && t !== "mos_subject_type");
  ok("G1d", otherReads.length === 0,
    `the resolver reads NOTHING but the subject registry and its vocabulary${otherReads.length ? " — also reads: " + otherReads.join(", ") : ""}`);

  console.log(`\n${failures.length === 0 ? "ALL GREEN" : "RED"}  ${pass} passed, ${failures.length} failed\n`);
  if (failures.length) { failures.forEach(f => console.log("  " + f)); process.exit(1); }
}

main().catch(async e => {
  await dropFixture();
  console.error("\nHARNESS CRASHED (the fixture was removed):", e);
  process.exit(1);
});
