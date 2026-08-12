/**
 * ONE-OFF BACKFILL: staff bookings left waiting for their own confirmation.
 *
 * scheduling.ts entered every non-walk-in as REQUESTED until 2026-08-12, so a booking made by a member of
 * staff sat waiting for a member of staff to confirm it. That path now writes CONFIRMED (owner: "it should
 * be booked and not need human intervention to confirm"). This moves the rows already stranded.
 *
 * ⚠⚠ WHAT IT DELIBERATELY WILL NOT TOUCH -- each of these is a REQUESTED that MEANS something:
 *
 *   1. PATIENT-FACING REQUESTS. booking-rules.ts stamps `applied_rule_id` on everything it writes and
 *      keeps REQUESTED for `confirmation_mode: conditional` and the DNA require_approval rule. Those are
 *      bookings a human is genuinely meant to weigh. Confirming them would approve, in bulk and silently,
 *      exactly the decisions the practice asked to make by hand. Only rows with a NULL rule id qualify.
 *   2. ANYTHING ALREADY IN THE PAST. A retrospective confirmation is meaningless -- a past appointment
 *      needs an OUTCOME, not a confirmation, and moving it to CONFIRMED would only relabel one unrecorded
 *      state as another while making the attendance figure look tidier than the record actually is.
 *   3. ANY STATUS BUT REQUESTED. Cancelled stays cancelled.
 *
 * It also writes one audit event per row. A bulk status change with no trail is not something a clinical
 * schedule should be able to have happen to it.
 *
 *   npx --yes tsx scripts/backfill-staff-booking-confirm.ts          # dry run, changes nothing
 *   npx --yes tsx scripts/backfill-staff-booking-confirm.ts --apply
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { audit } from "../src/lib/practice/audit";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2];
}

const APPLY = process.argv.includes("--apply");
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const nowIso = new Date().toISOString();
  console.log(`\nSTAFF BOOKING CONFIRMATION BACKFILL  ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`now = ${nowIso}\n`);

  const { data: rows, error } = await admin.from("practice_appointment")
    .select("id, workspace_id, patient_name, scheduled_at, appointment_type, created_by, applied_rule_id")
    .eq("status", "REQUESTED")
    .gt("scheduled_at", nowIso)
    .is("applied_rule_id", null)      // exclusion 1: never a patient-facing request
    .not("created_by", "is", null)    // and it must have been made BY somebody
    .order("scheduled_at");

  // ⚠ A FAILED READ IS NOT AN EMPTY BACKFILL. Exiting non-zero rather than reporting "nothing to do".
  if (error) { console.error(`could not read appointments: ${error.message}`); process.exit(1); }
  if (!rows?.length) { console.log("Nothing to backfill.\n"); return; }

  const { data: ws } = await admin.from("practice_workspace").select("id, name");
  const wsName = Object.fromEntries((ws ?? []).map(w => [w.id, w.name]));

  console.log(`${rows.length} appointment(s) qualify:\n`);
  for (const r of rows)
    console.log(`  ${r.scheduled_at.slice(0, 16).replace("T", " ")}  ${(wsName[r.workspace_id] ?? "?").padEnd(10)} ${(r.appointment_type ?? "-").padEnd(20)} ${r.patient_name ?? "(unnamed)"}`);

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing was written. Re-run with --apply to confirm these ${rows.length}.\n`);
    return;
  }

  let changed = 0;
  const failed: string[] = [];
  for (const r of rows) {
    // Re-asserting status in the WHERE clause: if anything moved this row between the read above and
    // now, the update matches nothing rather than overwriting whatever it became.
    const { data: upd, error: uErr } = await admin.from("practice_appointment")
      .update({ status: "CONFIRMED" })
      .eq("id", r.id).eq("status", "REQUESTED")
      .select("id");
    if (uErr) { failed.push(`${r.id}: ${uErr.message}`); continue; }
    if (!upd?.length) { failed.push(`${r.id}: no longer REQUESTED, left alone`); continue; }

    changed++;
    await audit(admin, {
      workspaceId: r.workspace_id,
      actorId: r.created_by,
      eventType: "practice.appointment_status_changed",
      payload: {
        appointmentId: r.id, from: "REQUESTED", to: "CONFIRMED",
        reason: "backfill: staff bookings confirm themselves as of 2026-08-12",
        backfill: "backfill-staff-booking-confirm",
      },
      correlationId: "backfill-staff-confirm",
      source: "script",
    });
  }

  console.log(`\n${changed} confirmed.`);
  if (failed.length) {
    console.log(`${failed.length} not changed:`);
    for (const f of failed) console.log(`  ${f}`);
  }

  const { count: leftover } = await admin.from("practice_appointment")
    .select("*", { count: "exact", head: true })
    .eq("status", "REQUESTED").gt("scheduled_at", nowIso).is("applied_rule_id", null);
  console.log(`Future in-house REQUESTED remaining: ${leftover ?? "unknown"}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
