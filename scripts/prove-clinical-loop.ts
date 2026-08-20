/**
 * CPR-IAM-001 §14.1 launch control `clinical` — prove the clinical loop closes end to end.
 *
 * ────────────────────────────────────────────────────────────────────────────────────────────────────
 * Launch Readiness gates public signup on six automatic controls, and one of them was failing:
 *
 *     "The clinical loop closed end to end (a signed encounter exists)"
 *       → no signed encounter exists in any workspace
 *
 * That is the only one of the four outstanding controls that a script can honestly close. The other
 * three are attested by a person BY DESIGN — operations.ts says so in as many words ("attested by a
 * human, never by this page"), and a script that flipped them would be forging the attestation the
 * control exists to collect.
 *
 * ⚠ IT DRIVES THE PRODUCT'S OWN ENGINES, NOT SQL. registerPatient → launchEncounter →
 * transitionEncounter(ACTIVE → COMPLETED → SIGNED). Inserting a row with status SIGNED would satisfy
 * the query and prove nothing: what the control is really asking is whether a practitioner can get a
 * patient from the door to a signed record through the guards, the version checks and the audit trail.
 * Every refusal on the way is a real finding.
 *
 * ⚠ STAGING ONLY, AND THE PRODUCTION PREDICATE SAYS SO. This writes a patient and a clinical encounter.
 * They are synthetic, in the synthetic practice, and they must never be in production — a fabricated
 * patient in a real clinical record is the worst artefact this repository could produce.
 *
 *   npx tsx scripts/prove-clinical-loop.ts
 *   npx tsx scripts/prove-clinical-loop.ts --check    (read-only: does the control pass yet?)
 */
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { resolveWorkspaceContext } from "../src/lib/practice/access";
import { registerPatient } from "../src/lib/practice/patients";
import { launchEncounter, transitionEncounter } from "../src/lib/practice/encounters";
import { judgeTarget } from "./production-guard";

loadEnvConfig(process.cwd());

const CHECK_ONLY = process.argv.includes("--check");
const url = process.env.STAGING_SUPABASE_URL ?? null;
const key = process.env.STAGING_SERVICE_ROLE_KEY ?? null;

function die(msg: string): never { console.error(`\n[refused] ${msg}\n`); process.exit(1); }

if (!url || !key) die("STAGING_SUPABASE_URL and STAGING_SERVICE_ROLE_KEY must both be set.");
const verdict = judgeTarget(url);
if (!verdict.ok) {
  die(verdict.reason === "PRODUCTION"
    ? `STAGING_SUPABASE_URL points at PRODUCTION (${verdict.ref}). This script writes a patient and an encounter; neither belongs there.`
    : "STAGING_SUPABASE_URL does not identify a Supabase project, so this run cannot prove it is not production.");
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

/** The control's own query, copied from operations.ts so this reports what Launch Readiness reports. */
async function signedEncounterCount(): Promise<number | null> {
  const { count, error } = await admin.from("practice_encounter")
    .select("id", { head: true, count: "exact" }).in("status", ["SIGNED", "AMENDED"]);
  // ⚠ null count with no error is PostgREST's answer for a missing table — never read it as zero.
  if (error || count === null) return null;
  return count;
}

async function main() {
  console.log(`\n=== clinical loop, launch control "clinical" ===`);
  console.log(`target : ${url}  (${verdict.ref})\n`);

  const before = await signedEncounterCount();
  if (before === null) die("practice_encounter could not be read. That is not a zero, and nothing was written.");
  console.log(`signed or amended encounters now: ${before}`);
  if (CHECK_ONLY) {
    console.log(before > 0 ? "\ncontrol PASSES\n" : "\ncontrol FAILS — no signed encounter exists\n");
    process.exit(before > 0 ? 0 : 1);
  }
  if (before > 0) { console.log("\nthe control already passes; nothing to do.\n"); process.exit(0); }

  // The synthetic practitioner's own workspace — the same identity the smoke suite uses.
  const email = (process.env.SMOKE_PRACTITIONER_EMAIL ?? "").toLowerCase();
  if (!email) die("SMOKE_PRACTITIONER_EMAIL is not set.");
  let userId: string | null = null;
  for (let page = 1; page <= 10 && !userId; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    userId = (data?.users ?? []).find(u => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    if ((data?.users ?? []).length < 200) break;
  }
  if (!userId) die(`${email} does not exist on this project.`);

  const { data: memberships } = await admin.from("practice_membership")
    .select("workspace_id").eq("user_id", userId).limit(5);
  const workspaceId = (memberships ?? [])[0]?.workspace_id as string | undefined;
  if (!workspaceId) die("the synthetic practitioner holds no practice membership.");

  const ctxRes = await resolveWorkspaceContext(admin, userId, workspaceId);
  if (!ctxRes.ok) die("the workspace context could not be resolved for that practitioner.");
  const ctx = ctxRes.ctx;
  const base = { actorId: userId, correlationId: "prove-clinical-loop" };
  console.log(`practitioner: ${email}\nworkspace   : ${workspaceId}\n`);

  // ── 1. a patient ─────────────────────────────────────────────────────────────────────────────────
  // ⚠ THE PHONE IS NOT PADDING. registerPatient refused the first attempt with "a primary contact
  // (phone or email) is required (CPR-V2-005 minimum dataset)" — a real guard, fired because this
  // drives the engine rather than inserting a row. An invalid number would be the wrong fix; this is a
  // reserved test range, so it can never reach a real person.
  const reg = await registerPatient(admin, {
    workspaceId, displayName: "Loop Proof (synthetic)", sex: "female", birthDate: "1990-01-01",
    phone: "+15550100", ...base,
  } as any);
  if (!reg.ok) die(`registerPatient refused: ${reg.code} — ${reg.message}`);
  console.log(`  1. patient registered   ${reg.data.patientNumber}`);
  if (reg.data.incomplete.length)
    for (const i of reg.data.incomplete) console.log(`     ⚠ incomplete: ${i.step} — ${i.reason}`);

  // ── 2..5. the encounter, through every state the product defines ────────────────────────────────
  const enc = await launchEncounter(admin, {
    workspaceId, patientId: reg.data.id, pathway: "new_walk_in",
    reasonForVisit: "Launch control: proving the clinical loop closes", ...base,
  } as any);
  if (!enc.ok) die(`launchEncounter refused: ${enc.code} — ${enc.message}`);
  console.log(`  2. encounter launched   ${enc.data.id}`);

  for (const to of ["ACTIVE", "COMPLETED", "SIGNED"] as const) {
    const t = await transitionEncounter(admin, { workspaceId, encounterId: enc.data.id, to, ...base } as any);
    if (!t.ok) die(`transition to ${to} refused: ${(t as any).code} — ${(t as any).message}`);
    console.log(`  ${to === "ACTIVE" ? 3 : to === "COMPLETED" ? 4 : 5}. ${to.toLowerCase().padEnd(9)} ✓`);
  }

  // ── the control, re-read the way Launch Readiness reads it ──────────────────────────────────────
  const after = await signedEncounterCount();
  if (after === null) die("the re-read failed, so the control's state is unknown.");
  const { data: row } = await admin.from("practice_encounter")
    .select("status, signed_at, signed_by").eq("id", enc.data.id).maybeSingle();
  console.log(`\nsigned or amended encounters now: ${before} → ${after}`);
  console.log(`this encounter: status=${(row as any)?.status} signed_at=${String((row as any)?.signed_at).slice(0, 19)}`);
  console.log(after > 0
    ? `\nlaunch control "clinical" now PASSES — the loop closed end to end through the engines.\n`
    : `\n⚠ the control still fails, which means the write did not land where the control looks.\n`);
  process.exit(after > 0 ? 0 : 1);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
