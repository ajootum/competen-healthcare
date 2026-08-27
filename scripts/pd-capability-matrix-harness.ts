/**
 * CPR-PD-014 BUILD 2 -- THE CAPABILITY MATRIX, AS IT ACTUALLY EXISTS IN THE DATABASE.
 *
 * Build 2's exit gate: "direct URL/API tests prove that hidden UI controls cannot be invoked without
 * the required capability." This is the half of that gate a harness can hold honestly -- that the
 * grants behind those controls are the ones the design intended, in the database, not in a file.
 *
 * ⚠ WHY IT IS DB-BACKED AND NOT A SOURCE SCAN. pd-nav-harness already proves the CODE asks for the
 * right strings (5c) and that a migration creates them (6a). Neither can tell you whether the migration
 * was ever applied -- and the failure that matters here is silent in exactly that gap: a capability
 * catalogued but granted to nobody refuses everyone for ever, with an ordinary 403, while every source
 * pin stays green. This estate has paid for that class twice (migrations 303 and 305, healed by 307).
 *
 * ⚠ AND MAKER-CHECKER IS ASSERTED IN BOTH DIRECTIONS. A separation of duties has two failure modes and
 * only one of them looks like a problem: the Director holding the approval (no separation), and NOBODY
 * holding it (a deadlock dressed as a control). Section 3 tests both.
 *
 *   npx --yes tsx scripts/pd-capability-matrix-harness.ts
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { PD_NAV } from "../src/app/super-admin/_components/pd-nav";

loadEnvConfig(process.cwd());
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Supabase env not set"); process.exit(1); }
const admin = createClient(url, key, { auth: { persistSession: false } });

let pass = 0;
const fails: string[] = [];
const ok = (label: string, cond: boolean, detail = "") => {
  if (cond) { pass++; console.log(`  PASS  ${label}`); }
  else { fails.push(label); console.log(`  FAIL  ${label}${detail ? ` -- ${detail}` : ""}`); }
};

const DIRECTOR = "practice_product_director";

/** The acts a Director performs. Withheld ones are asserted separately, in section 3. */
const DIRECTOR_ACTIONS = [
  "hq.practice.provision.execute",
  "hq.practice.flags.manage",
  "hq.practice.release.activate",
  "hq.practice.release.rollback",
  "hq.practice.export.execute",
  "hq.practice.configuration.manage",
];

/** The checker half. PD-014 build 2 asks for maker-checker on high-risk change. */
const WITHHELD_FROM_DIRECTOR = ["hq.practice.change.approve", "hq.practice.risk.accept"];

/**
 * ⚠ REVOKED ON PURPOSE, AND THIS HARNESS WAS STILL DEMANDING IT -- 2026-08-27.
 *
 * 2b and 4a were RED on `hq.practice.export.execute` against a database that is CORRECT. Migration 347
 * (CPR-PD-013 s9, finding 13) revoked that grant deliberately: it is enforced by nothing -- no route
 * gates on it, no screen references it -- and 347's own reasoning is that an access review reading the
 * position as holding authority to export data, when it does not, is "wrong in the direction of
 * overstating". It closed effective_to rather than deleting the row, so the history survives.
 *
 * 347 also states what it deliberately did NOT do: the CODE stays, because CPR-PD-010 s19 specifies an
 * export capability by name and only the enforcement is missing. So the capability is legitimately
 * catalogued-and-ungranted, which is exactly the state 2b and 4a were written to forbid.
 *
 * !! THIS IS THE "NEVER PIN A STATE YOU ARE TRYING TO CHANGE" SHAPE. Finishing the governance work turned
 * two assertions red, and the temptation is to read red as a defect and regrant. The rule is not weakened
 * here -- the exception is NAMED, and REVOKED_CONTROL below asserts each entry really is ungranted, so if
 * 347 is ever reversed (its own note says regranting is one UPDATE away) this list goes stale LOUDLY
 * instead of quietly excusing a capability that is once again held.
 */
const REVOKED_BY_DESIGN = ["hq.practice.export.execute"];

async function main() {
  console.log("\nCPR-PD-014 build 2 -- the capability matrix in the database\n");

  const { data: caps, error: capErr } = await admin
    .from("hq_capability").select("code, space").eq("space", "practice");
  if (capErr) { console.error("hq_capability unreadable:", capErr.message); process.exit(1); }
  const catalogue = new Set((caps ?? []).map((c: { code: string }) => c.code));

  const { data: grants, error: grantErr } = await admin
    .from("hq_position_capability")
    .select("position_code, capability_code, effective_to");
  if (grantErr) { console.error("hq_position_capability unreadable:", grantErr.message); process.exit(1); }
  const live = (grants ?? []).filter((g: { effective_to: string | null }) => g.effective_to === null);
  const heldBy = (position: string) =>
    new Set(live.filter((g: { position_code: string }) => g.position_code === position)
      .map((g: { capability_code: string }) => g.capability_code));

  // ── 1. THE CATALOGUE EXISTS ──────────────────────────────────────────────────────────────────
  console.log("1. the catalogue");
  const navCaps = [...new Set(PD_NAV.flatMap(g => g.items).map(i => i.capability))];
  const missingViews = navCaps.filter(c => !catalogue.has(c));
  ok("1a every module's view capability exists in hq_capability",
    missingViews.length === 0, missingViews.join(", "));

  const missingActions = [...DIRECTOR_ACTIONS, ...WITHHELD_FROM_DIRECTOR].filter(c => !catalogue.has(c));
  ok("1b every privileged action capability exists in hq_capability",
    missingActions.length === 0, missingActions.join(", "));

  ok("1-control the catalogue read returned a real practice space",
    catalogue.size >= 18, `${catalogue.size} practice capabilities`);

  // ── 2. THE DIRECTOR CAN ACTUALLY OPEN AND OPERATE THE WORKSPACE ──────────────────────────────
  console.log("\n2. what the Director holds");
  const director = heldBy(DIRECTOR);

  const unheldViews = navCaps.filter(c => !director.has(c));
  ok("2a the Director holds the view capability for all twelve modules",
    unheldViews.length === 0, `not granted: ${unheldViews.join(", ")}`);

  const unheldActions = DIRECTOR_ACTIONS.filter(c => !director.has(c) && !REVOKED_BY_DESIGN.includes(c));
  ok("2b the Director holds every act the position is for, bar those revoked by record",
    unheldActions.length === 0, `not granted: ${unheldActions.join(", ")}`);

  // ⚠ THE EXCEPTION LIST'S OWN CONTROL. Without this, REVOKED_BY_DESIGN silently excuses a capability
  // that has since been regranted, and 2b/4a stop covering it for ever. An entry here must be genuinely
  // ungranted -- if it is held again, the record is stale and that is the thing to say out loud.
  const wronglyExcused = REVOKED_BY_DESIGN.filter(c => director.has(c));
  ok("2b-control every REVOKED_BY_DESIGN entry really is ungranted",
    wronglyExcused.length === 0,
    wronglyExcused.length
      ? `held again -- migration 347 has been reversed for: ${wronglyExcused.join(", ")}. Remove it from REVOKED_BY_DESIGN.`
      : `${REVOKED_BY_DESIGN.length} recorded revocation(s), all still revoked`);

  // ⚠ THE POINT OF THE WHOLE ARC, STATED AS A TEST. Before build 2 the Director held three
  // capabilities and every privileged route refused them. If this number collapses back toward three,
  // the workspace has been quietly closed again.
  ok("2-control the Director's grant is a real set, not an empty read",
    director.size >= 18, `${director.size} live grants`);

  // ── 3. MAKER-CHECKER, IN BOTH DIRECTIONS ─────────────────────────────────────────────────────
  console.log("\n3. maker-checker");

  const alsoHeld = WITHHELD_FROM_DIRECTOR.filter(c => director.has(c));
  ok("3a the Director does NOT hold the approval half of its own changes",
    alsoHeld.length === 0,
    `separation broken -- Director also holds: ${alsoHeld.join(", ")}`);

  /**
   * ⚠ AND SOMEBODY MUST HOLD IT. A separation where the checker capability is granted to nobody is not
   * a control, it is a deadlock: every high-risk change is proposed and none can ever be approved, and
   * the only way through is an owner using break-glass -- which is the thing this matrix exists to stop
   * being routine.
   */
  for (const cap of WITHHELD_FROM_DIRECTOR) {
    const holders = [...new Set(live
      .filter((g: { capability_code: string }) => g.capability_code === cap)
      .map((g: { position_code: string }) => g.position_code))];
    ok(`3b ${cap} is held by a position other than the Director`,
      holders.length > 0 && holders.some(h => h !== DIRECTOR),
      holders.length ? `held by: ${holders.join(", ")}` : "held by NOBODY -- approvals would deadlock");
  }

  // ── 4. NO CAPABILITY IS UNREACHABLE ──────────────────────────────────────────────────────────
  console.log("\n4. nothing catalogued is unreachable");

  /**
   * ⚠ THE BACKFILL CLASS, ASSERTED. A capability the product ASKS FOR but no position HOLDS refuses
   * everyone except an owner, permanently, with an ordinary 403 -- and the sidebar hides the module, so
   * there is not even an empty page to notice. Every practice capability the code names must be granted
   * to at least one position.
   */
  const asked = [...navCaps, ...DIRECTOR_ACTIONS, ...WITHHELD_FROM_DIRECTOR];
  const grantedToSomeone = new Set(live.map((g: { capability_code: string }) => g.capability_code));
  const ungranted = asked.filter(c => !grantedToSomeone.has(c) && !REVOKED_BY_DESIGN.includes(c));
  ok("4a every capability the product asks for is granted to at least one position, bar those revoked by record",
    ungranted.length === 0, `granted to nobody: ${ungranted.join(", ")}`);

  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) { for (const f of fails) console.log(`  - ${f}`); process.exit(1); }
  console.log("\n⚠ This proves the GRANTS. PD-014's other half -- that a signed-in caller without the");
  console.log("  capability is actually refused by the route -- needs a session this process does not");
  console.log("  have, and remains the owner's walk-through with the Director account.\n");
}

main().catch(e => { console.error(e); process.exit(1); });
