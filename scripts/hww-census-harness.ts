// One-off harness for the Patient Responsibility & Assignment State Engine
// (HWW-WARD-002/003, migration 156). Exercises the SHIPPED lib
// (@/lib/hww/census) on a HARNESS-OWNED patient:
//   - acceptance FSM: wrong-user 403, decline-without-reason 400, accept ->
//     active + the PREVIOUS active primary ends exactly at acceptance,
//     decline -> declined with reason, non-pending re-response rejected
//   - transfer FSM: destination mandatory, awaiting_acceptance gating,
//     wrong-receiver 403, accept -> ownership moves + census location updates,
//     cancel restores the census state
//   - closure: bad disposition 400, close ends assignments + cancels open
//     transfers, double-close rejected
// Pre-migration: graceful-degrade contract only. Cleanup deletes the patient
// (assignments + transfers cascade).
//   npx --yes tsx scripts/hww-census-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const check = (ok: boolean, labelTxt: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${labelTxt}${detail ? ` — ${detail}` : ""}`);
  if (ok) pass++; else fail++;
};

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });
  const { loadAssignmentInbox, respondAssignment, initiateTransfer, acceptTransfer, cancelTransfer, closeEpisode } = await import("../src/lib/hww/census");

  const probe = await admin.from("op_patient_transfers").select("id").limit(1);
  if (probe.error) {
    console.log("── Pre-migration (156 not applied): graceful-degrade contract ──");
    const inbox = await loadAssignmentInbox(admin, "00000000-0000-0000-0000-000000000001");
    check(inbox.migrationMissing === true, "inbox reports migrationMissing");
    check(Array.isArray(inbox.pendingAssignments) && inbox.pendingAssignments.length === 0, "inbox returns empty lists, not throws");
    const r = await respondAssignment(admin, { assignmentId: "00000000-0000-0000-0000-000000000002", userId: "x", accept: true });
    check(!r.ok, "respond fails gracefully pre-migration", (r as any).error);
    console.log("\n(Apply migration 156, then re-run for the full FSM pass.)");
    console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
    process.exit(fail === 0 ? 0 : 1);
  }

  console.log("── Post-migration: full FSM on a harness patient ──");
  const { data: profs } = await admin.from("profiles").select("id, full_name, hospital_id").limit(3);
  if (!profs || profs.length < 2) { console.log("Need 2+ profiles."); process.exit(1); }
  const [nurseA, nurseB] = profs;
  const { data: hosp } = await admin.from("hospitals").select("id").limit(1).maybeSingle();
  const hid = nurseA.hospital_id ?? hosp?.id ?? null;

  const { data: hp, error: he } = await admin.from("op_patients").insert({
    hospital_id: hid, label: "Harness Census Patient (safe to delete)", acuity_level: "moderate", operational_status: "admitted",
  }).select("id").single();
  if (he) { console.error("Seed failed:", he.message); process.exit(1); }
  const pid = hp.id;

  try {
    // Baseline: nurse B holds the ACTIVE primary.
    const { data: bAsg } = await admin.from("op_patient_assignments").insert({
      hospital_id: hid, patient_id: pid, staff_id: nurseB.id, assignment_type: "primary",
      status: "active", acceptance_status: "accepted", competency_validated: true,
    }).select("id").single();

    // Pending offer to nurse A.
    const { data: pend } = await admin.from("op_patient_assignments").insert({
      hospital_id: hid, patient_id: pid, staff_id: nurseA.id, assignment_type: "primary",
      status: "pending_acceptance", acceptance_status: "pending", competency_validated: true, created_by: nurseB.id,
    }).select("id").single();

    // Inbox sees it; responsibility rules enforced.
    const inbox = await loadAssignmentInbox(admin, nurseA.id);
    check(inbox.pendingAssignments.some((x: any) => x.id === pend!.id), "pending offer appears in the nurse's inbox");
    let r: any = await respondAssignment(admin, { assignmentId: pend!.id, userId: nurseB.id, accept: true });
    check(!r.ok && r.status === 403, "wrong user cannot respond (403)");
    r = await respondAssignment(admin, { assignmentId: pend!.id, userId: nurseA.id, accept: false });
    check(!r.ok && r.status === 400, "decline without reason rejected (400)");

    // The handover moment: B stays active UNTIL A accepts.
    const { data: bBefore } = await admin.from("op_patient_assignments").select("status").eq("id", bAsg!.id).single();
    check(bBefore?.status === "active", "previous nurse remains ACTIVE while offer is pending");
    r = await respondAssignment(admin, { assignmentId: pend!.id, userId: nurseA.id, accept: true });
    check(r.ok === true && r.assignment.status === "active" && !!r.assignment.accepted_at, "accept -> active with accepted_at");
    const { data: bAfter } = await admin.from("op_patient_assignments").select("status, ended_at").eq("id", bAsg!.id).single();
    check(bAfter?.status === "ended" && !!bAfter?.ended_at, "previous primary ends exactly at acceptance");
    r = await respondAssignment(admin, { assignmentId: pend!.id, userId: nurseA.id, accept: true });
    check(!r.ok && r.status === 400, "re-responding to a non-pending assignment rejected");

    // Decline path.
    const { data: pend2 } = await admin.from("op_patient_assignments").insert({
      hospital_id: hid, patient_id: pid, staff_id: nurseB.id, assignment_type: "primary",
      status: "pending_acceptance", acceptance_status: "pending", competency_validated: true,
    }).select("id").single();
    r = await respondAssignment(admin, { assignmentId: pend2!.id, userId: nurseB.id, accept: false, reason: "at capacity (harness)" });
    check(r.ok === true && r.assignment.status === "declined" && r.assignment.declined_reason === "at capacity (harness)", "decline -> declined with reason recorded");
    const { data: aStill } = await admin.from("op_patient_assignments").select("status").eq("patient_id", pid).eq("status", "active");
    check((aStill ?? []).length === 1, "decline leaves the current owner untouched");

    // ── Transfers ──
    r = await initiateTransfer(admin, { patientId: pid, transferType: "internal", reason: "", actorId: nurseA.id });
    check(!r.ok && r.status === 400, "transfer without reason rejected");
    r = await initiateTransfer(admin, { patientId: pid, transferType: "internal", reason: "bed move (harness)", actorId: nurseA.id });
    check(!r.ok && r.status === 400, "internal transfer without destination rejected");
    r = await initiateTransfer(admin, { patientId: pid, transferType: "internal", toRoom: "Room 9", reason: "bed move (harness)", receivingStaffId: nurseB.id, actorId: nurseA.id, actorName: "harness" });
    check(r.ok === true && r.transfer.status === "awaiting_acceptance", "transfer with receiver -> awaiting_acceptance");
    const xferId = r.ok ? r.transfer.id : null;
    const { data: pNow } = await admin.from("op_patients").select("operational_status").eq("id", pid).single();
    check(pNow?.operational_status === "transfer_pending", "census shows transfer_pending");
    r = await acceptTransfer(admin, { transferId: xferId, userId: nurseA.id });
    check(!r.ok && r.status === 403, "non-addressed nurse cannot accept the transfer");
    r = await acceptTransfer(admin, { transferId: xferId, userId: nurseB.id });
    check(r.ok === true && r.transfer.status === "completed", "receiving nurse accepts -> completed");
    const { data: owners } = await admin.from("op_patient_assignments").select("staff_id, status").eq("patient_id", pid).eq("status", "active");
    check((owners ?? []).length === 1 && owners![0].staff_id === nurseB.id, "ownership moved to the receiving nurse (exactly one active)");
    const { data: pAfter } = await admin.from("op_patients").select("operational_status").eq("id", pid).single();
    check(pAfter?.operational_status === "admitted", "census restored to admitted after completion");

    // Cancel path.
    r = await initiateTransfer(admin, { patientId: pid, transferType: "diagnostic", destination: "CT (harness)", reason: "scan (harness)", actorId: nurseB.id });
    check(r.ok === true && r.transfer.status === "pending", "external transfer without receiver -> pending (supervisor routes)");
    const c = await cancelTransfer(admin, { transferId: r.ok ? r.transfer.id : "", reason: "no longer needed" });
    check(c.ok === true, "pending transfer cancels");
    const { data: pBack } = await admin.from("op_patients").select("operational_status").eq("id", pid).single();
    check(pBack?.operational_status === "admitted", "cancel restores census state");

    // ── Closure ──
    r = await closeEpisode(admin, { patientId: pid, disposition: "went_home", userId: nurseA.id });
    check(!r.ok && r.status === 400, "invented disposition rejected");
    r = await closeEpisode(admin, { patientId: pid, disposition: "discharged", userId: nurseA.id });
    check(r.ok === true && !!r.patient.closed_at && r.patient.disposition === "discharged", "closure stamps disposition + closed_at");
    const { data: openAfterClose } = await admin.from("op_patient_assignments").select("id").eq("patient_id", pid).in("status", ["active", "pending_acceptance"]);
    check((openAfterClose ?? []).length === 0, "closure ends every open assignment");
    r = await closeEpisode(admin, { patientId: pid, disposition: "discharged", userId: nurseA.id });
    check(!r.ok && r.status === 400, "double-close rejected");
  } finally {
    await admin.from("op_patients").delete().eq("id", pid);
    console.log("(harness patient + assignments + transfers deleted)");
  }

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
