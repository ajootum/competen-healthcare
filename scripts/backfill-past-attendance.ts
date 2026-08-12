/**
 * ONE-OFF BACKFILL: past appointments the desk never closed off, marked as attended.
 *
 * The owner, 2026-08-12, having been shown four elapsed appointments still sitting at REQUESTED: "mark
 * the four past appointments as attended." They are the practitioner; whether those patients turned up is
 * a fact they hold and the record does not.
 *
 * ⚠⚠ WHAT THIS WRITES, AND THE ONE THING IT REFUSES TO WRITE.
 *
 * It sets status to COMPLETED. It does NOT create an encounter. An encounter is a CLINICAL CONSULTATION
 * RECORD in a patient's chart -- it carries a pathway, a start time and everything later hung off it --
 * and manufacturing one to satisfy a metric would put a consultation nobody conducted into four patients'
 * histories. Attendance is a fact about a person arriving; a consultation record is a claim about
 * clinical work. The owner asked for the first.
 *
 * So after this runs, those four are ATTENDED and still absent from the SEEN list, which is encounters
 * and only encounters (CP-BOOKED-SEEN-001 s10). Both statements are true at once and the product says
 * both.
 *
 * ⚠ AND IT DOES NOT WALK THE STATE MACHINE. REQUESTED -> CONFIRMED -> ARRIVED -> COMPLETED would be the
 * live-desk route, but the ARRIVED rung inserts a practice_arrival and a practice_queue_entry stamped
 * NOW. For an appointment on 8 August that records the patient arriving today, and drops four people who
 * have long since gone home into the waiting queue. A retrospective correction is not a re-enactment: the
 * status moves, the audit event says why, and nothing invents a timestamp it does not know.
 *
 *   npx --yes tsx scripts/backfill-past-attendance.ts          # dry run
 *   npx --yes tsx scripts/backfill-past-attendance.ts --apply
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
  console.log(`\nPAST ATTENDANCE BACKFILL  ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`now = ${nowIso}\n`);

  const { data: rows, error } = await admin.from("practice_appointment")
    .select("id, workspace_id, patient_name, scheduled_at, status, created_by")
    .eq("status", "REQUESTED")
    .lt("scheduled_at", nowIso)
    .order("scheduled_at");
  if (error) { console.error(`could not read appointments: ${error.message}`); process.exit(1); }
  if (!rows?.length) { console.log("Nothing to backfill.\n"); return; }

  // ⚠ AN APPOINTMENT THAT ALREADY HAS A CONSULTATION IS ALREADY ATTENDED. Marking it would change
  // nothing and muddy the audit trail with a correction that corrected nothing.
  const { data: encs } = await admin.from("practice_encounter")
    .select("appointment_id").in("appointment_id", rows.map(r => r.id));
  const documented = new Set(((encs ?? []) as { appointment_id: string | null }[])
    .map(e => e.appointment_id).filter(Boolean));
  const targets = rows.filter(r => !documented.has(r.id));

  const { data: ws } = await admin.from("practice_workspace").select("id, name");
  const wsName = Object.fromEntries((ws ?? []).map(w => [w.id, w.name]));

  console.log(`${targets.length} past appointment(s) will be marked COMPLETED (attended):\n`);
  for (const r of targets)
    console.log(`  ${r.scheduled_at.slice(0, 16).replace("T", " ")}  ${(wsName[r.workspace_id] ?? "?").padEnd(10)} ${r.patient_name ?? "(unnamed)"}`);
  if (documented.size)
    console.log(`\n  (${documented.size} skipped: a consultation already records the attendance.)`);

  if (!APPLY) {
    console.log(`\nDRY RUN -- nothing was written.\n`);
    return;
  }

  let changed = 0;
  const failed: string[] = [];
  for (const r of targets) {
    const { data: upd, error: uErr } = await admin.from("practice_appointment")
      .update({ status: "COMPLETED", updated_at: nowIso })
      .eq("id", r.id).eq("status", "REQUESTED")   // unchanged-since-read guard
      .select("id");
    if (uErr) { failed.push(`${r.id}: ${uErr.message}`); continue; }
    if (!upd?.length) { failed.push(`${r.id}: moved since the read, left alone`); continue; }

    changed++;
    // ⚠ THE TRAIL SAYS THIS WAS RETROSPECTIVE AND NOT OBSERVED AT THE DESK. Somebody auditing this
    // record later must be able to tell a correction from a check-in.
    await audit(admin, {
      workspaceId: r.workspace_id,
      actorId: r.created_by,
      eventType: "practice.appointment_status_changed",
      payload: {
        appointmentId: r.id, from: "REQUESTED", to: "COMPLETED",
        reason: "retrospective attendance correction, recorded by the practice owner on 2026-08-12",
        observedAtDesk: false,
        encounterCreated: false,
        backfill: "backfill-past-attendance",
      },
      correlationId: "backfill-past-attendance",
      source: "script",
    });
  }

  console.log(`\n${changed} marked attended.`);
  if (failed.length) {
    console.log(`${failed.length} not changed:`);
    for (const f of failed) console.log(`  ${f}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
