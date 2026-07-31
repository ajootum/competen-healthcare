// CROSS-WORKSPACE VERIFICATION SWEEP.
//
// Every other harness proves ONE module. This one proves the WORKSPACES ARE
// CONNECTED: it drives each nurse<->supervisor loop end to end through the
// SHIPPED functions on both sides, and asserts that what one workspace writes
// is what the other workspace actually reads. No logic is reimplemented here,
// so a drift on either side fails the sweep.
//
//   1. ASSIGNMENT   SSW publishPairs -> HWW loadAssignmentInbox (pending)
//                   -> respondAssignment(accept) -> HWW My Patients owns it,
//                      and the previous primary ends EXACTLY at acceptance
//   2. DECLINE      respondAssignment(decline) -> returns to the SSW queue
//   3. CONCERN      HWW raises op_concerns -> SSW loadConcernQueue -> supervisor
//                   resolves -> HWW loadMyConcerns reflects it
//   4. TRANSFER     HWW initiateTransfer -> SSW routeTransfer -> receiving
//                   nurse's inbox -> acceptTransfer -> ownership moves
//   5. ASSESSMENT   HWW recordAcuity/recordWorkload -> op_patients.acuity_level
//                   syncs -> SSW loadWorkloadIntelligence shows the SAME
//                   per-nurse load the HWW aggregate reports
//   6. ESCALATION   bedside escalation -> SSW loadEscalations
//   7. ATTENDANCE   clock event -> SSW loadShiftAttendance board
//   8. EVIDENCE     completed procedural task -> competency skill_log_entries
//
// Every row it writes is deleted afterwards.
//   npx --yes tsx scripts/xw-sweep-harness.ts
/* eslint-disable @typescript-eslint/no-explicit-any */

import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
loadEnvConfig(process.cwd());

let pass = 0, fail = 0;
const results: { loop: string; ok: boolean; label: string }[] = [];
let loop = "setup";
const check = (ok: boolean, label: string, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  results.push({ loop, ok, label });
  if (ok) pass++; else fail++;
};
const head = (name: string) => { loop = name; console.log(`\n── ${name} ${"─".repeat(Math.max(0, 62 - name.length))}`); };

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error("Missing Supabase env."); process.exit(1); }
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const census = await import("../src/lib/hww/census");
  const engine = await import("../src/lib/hww/assignment-engine");
  const concerns = await import("../src/lib/hww/concerns");
  const assessments = await import("../src/lib/hww/assessments");
  const evidence = await import("../src/lib/hww/evidence");
  const patients = await import("../src/lib/hww/patients");
  const { loadWorkloadIntelligence } = await import("../src/lib/operations/workload-intelligence");
  const { loadEscalations } = await import("../src/lib/operations/escalations-workspace");
  const { loadShiftAttendance } = await import("../src/lib/operations/shift-attendance");

  // A hospital with enough real staff to play nurse A, nurse B and supervisor.
  const { data: hosps } = await admin.from("hospitals").select("id, name").limit(40);
  let hid: string | null = null, people: any[] = [];
  for (const h of (hosps ?? []) as any[]) {
    const { data: p } = await admin.from("profiles").select("id, full_name").eq("hospital_id", h.id).limit(6);
    if ((p ?? []).length >= 3) { hid = h.id; people = p as any[]; break; }
  }
  if (!hid) { console.error("No hospital has 3+ profiles to test against."); process.exit(1); }
  const [nurseA, nurseB, supervisor] = people;
  console.log(`Hospital ${hid}\n  nurse A     ${nurseA.full_name}\n  nurse B     ${nurseB.full_name}\n  supervisor  ${supervisor.full_name}`);

  const now = Date.now();
  const cleanup: { table: string; ids: string[] }[] = [];
  const track = (table: string, ids: string[]) => { if (ids.length) cleanup.push({ table, ids }); };
  const ins = async (table: string, rows: any[]) => {
    const { data, error } = await admin.from(table).insert(rows).select("id");
    if (error) throw new Error(`${table}: ${error.message}`);
    const ids = (data ?? []).map((r: any) => r.id);
    track(table, ids);
    return ids;
  };
  // Rows the SHIPPED code creates on our behalf still have to be cleaned up.
  const adopt = async (table: string, filter: (q: any) => any) => {
    const { data } = await filter(admin.from(table).select("id"));
    track(table, (data ?? []).map((r: any) => r.id));
  };

  try {
    // ── Fixtures: a shift and two patients ───────────────────────────────────
    const [shiftId] = await ins("op_shifts", [{
      hospital_id: hid, shift_type: "day", shift_date: new Date(now).toISOString().slice(0, 10), status: "active",
      starts_at: new Date(now - 3 * 3.6e6).toISOString(), ends_at: new Date(now + 5 * 3.6e6).toISOString(),
      supervisor_id: supervisor.id,
    }]);
    const [patient1, patient2] = await ins("op_patients", [
      { hospital_id: hid, label: "XW-SWEEP-1", operational_status: "admitted", acuity_level: "stable" },
      { hospital_id: hid, label: "XW-SWEEP-2", operational_status: "admitted", acuity_level: "stable" },
    ]);

    // ═══ 1. ASSIGNMENT: supervisor offers -> nurse inbox -> accept ═══════════
    head("1. ASSIGNMENT  supervisor offer -> nurse inbox -> accept");
    // Nurse A already holds patient 1 (the incumbent whose accountability must
    // survive right up to the moment nurse B accepts).
    const [incumbent] = await ins("op_patient_assignments", [{
      hospital_id: hid, patient_id: patient1, staff_id: nurseA.id,
      assignment_type: "primary", status: "active", started_at: new Date(now - 2 * 3.6e6).toISOString(),
    }]);

    const published = await engine.publishPairs(admin, [{ patient_id: patient1, staff_id: nurseB.id, override_reason: "cross-workspace sweep" }], { id: supervisor.id, name: supervisor.full_name });
    await adopt("op_patient_assignments", (q: any) => q.eq("patient_id", patient1).eq("staff_id", nurseB.id));
    check(published[0]?.ok === true, "SSW publishPairs creates an offer", published[0]?.error ?? "ok");
    const offerId = published[0]?.assignment_id;

    let inbox = await census.loadAssignmentInbox(admin, nurseB.id);
    check(inbox.pendingAssignments.some((a: any) => a.id === offerId), "the offer lands in the HWW Assignment Inbox of the RIGHT nurse",
      `${inbox.pendingAssignments.length} pending`);
    const inboxA = await census.loadAssignmentInbox(admin, nurseA.id);
    check(!inboxA.pendingAssignments.some((a: any) => a.id === offerId), "the offer does NOT appear in another nurse's inbox");

    let mine = await patients.loadMyPatientWorkspace(admin, nurseB.id, now);
    const holds = (w: any, pid: string) => (w.patients ?? []).some((a: any) => a.op_patients?.id === pid);
    check(!holds(mine, patient1), "a PENDING offer is not yet in My Patients (no responsibility)");
    const { data: incBefore } = await admin.from("op_patient_assignments").select("status, ended_at").eq("id", incumbent).maybeSingle();
    check(incBefore?.status === "active" && !incBefore?.ended_at, "the previous nurse stays accountable through the pending window", `${incBefore?.status}`);

    const acceptedAt = Date.now();
    const acc: any = await census.respondAssignment(admin, { assignmentId: offerId!, userId: nurseB.id, accept: true });
    check(acc.ok === true, "the nurse accepts", acc.ok ? "" : acc.error);

    const { data: incAfter } = await admin.from("op_patient_assignments").select("status, ended_at").eq("id", incumbent).maybeSingle();
    check(incAfter?.status === "ended" && !!incAfter?.ended_at, "the previous active primary ends on acceptance", `${incAfter?.status}`);
    const endedDrift = incAfter?.ended_at ? Math.abs(new Date(incAfter.ended_at).getTime() - acceptedAt) : Infinity;
    check(endedDrift < 60_000, "it ends AT acceptance, not earlier (WARD-003 rule)", `${Math.round(endedDrift / 1000)}s from the accept call`);

    mine = await patients.loadMyPatientWorkspace(admin, nurseB.id, Date.now());
    check(holds(mine, patient1), "the patient is now in the accepting nurse's My Patients");
    const mineA = await patients.loadMyPatientWorkspace(admin, nurseA.id, Date.now());
    check(!holds(mineA, patient1), "and has left the previous nurse's My Patients");
    inbox = await census.loadAssignmentInbox(admin, nurseB.id);
    check(!inbox.pendingAssignments.some((a: any) => a.id === offerId), "the accepted offer clears from the inbox");

    // ═══ 2. DECLINE: goes back to the supervisor ════════════════════════════
    head("2. DECLINE  offer -> nurse declines -> back to the SSW queue");
    const pub2 = await engine.publishPairs(admin, [{ patient_id: patient2, staff_id: nurseA.id, override_reason: "cross-workspace sweep" }], { id: supervisor.id, name: supervisor.full_name });
    await adopt("op_patient_assignments", (q: any) => q.eq("patient_id", patient2));
    const offer2 = pub2[0]?.assignment_id;
    const noReason: any = await census.respondAssignment(admin, { assignmentId: offer2!, userId: nurseA.id, accept: false });
    check(noReason.ok === false && noReason.status === 400, "declining without a reason is rejected", noReason.error ?? "");
    const wrongNurse: any = await census.respondAssignment(admin, { assignmentId: offer2!, userId: nurseB.id, accept: true });
    check(wrongNurse.ok === false && wrongNurse.status === 403, "another nurse cannot accept someone else's offer", wrongNurse.error ?? "");
    const dec: any = await census.respondAssignment(admin, { assignmentId: offer2!, userId: nurseA.id, accept: false, reason: "At capacity" });
    check(dec.ok === true, "the nurse declines with a reason");
    const q1 = await census.loadUnassignedQueue(admin, hid, false);
    const inQueue = (q1.unassigned ?? []).some((p: any) => p.id === patient2);
    check(inQueue, "the declined patient reappears on the SSW census queue as unassigned");
    const declines = await census.loadAssignmentInbox(admin, nurseA.id);
    check(declines.recentDeclines.some((r: any) => r.id === offer2), "the nurse sees their own decline in recent activity");

    // ═══ 3. CONCERN: bedside -> supervisor queue -> resolution ══════════════
    head("3. CONCERN  nurse raises -> SSW queue -> resolved -> nurse sees it");
    const [concernId] = await ins("op_concerns", [{
      hospital_id: hid, patient_id: patient1, shift_id: shiftId,
      category: "clinical_deterioration", priority: "urgent",
      description: "XW sweep: rising respiratory rate, requesting review",
      raised_by: nurseB.id, raised_by_name: nurseB.full_name, status: "open",
    }]);
    const queue = await concerns.loadConcernQueue(admin, hid, false);
    const inSsw = (queue.concerns ?? []).find((c: any) => c.id === concernId);
    check(!!inSsw, "the nurse's concern reaches the supervisor queue", `${(queue.concerns ?? []).length} open`);
    check(inSsw?.priority === "urgent", "priority is carried through unchanged");
    check(concerns.isOverdue({ priority: "urgent", raised_at: new Date(now - 5 * 3.6e6).toISOString(), status: "open" }, now),
      "an old urgent concern is flagged overdue by the SHARED rule");
    const { error: resErr } = await admin.from("op_concerns").update({ status: "resolved", resolved_at: new Date().toISOString(), resolution_notes: "Reviewed on the round" }).eq("id", concernId);
    check(!resErr, "the supervisor can resolve the concern", resErr?.message ?? "");
    const mineC = await concerns.loadMyConcerns(admin, nurseB.id);
    const backAtBedside = (mineC.raised ?? []).find((c: any) => c.id === concernId);
    check(backAtBedside?.status === "resolved", "the supervisor's resolution is visible back at the bedside", `${backAtBedside?.status}`);
    const queue2 = await concerns.loadConcernQueue(admin, hid, false);
    check(!(queue2.concerns ?? []).some((c: any) => c.id === concernId), "and the resolved concern leaves the open supervisor queue");

    // ═══ 4. TRANSFER: initiate -> supervisor routes -> accept ═══════════════
    head("4. TRANSFER  nurse initiates -> supervisor routes -> nurse accepts");
    const badXfer: any = await census.initiateTransfer(admin, { patientId: patient1, transferType: "internal", reason: "", actorId: nurseB.id });
    check(badXfer.ok === false && badXfer.status === 400, "a transfer with no reason is rejected", badXfer.error ?? "");
    const xfer: any = await census.initiateTransfer(admin, {
      patientId: patient1, transferType: "internal", reason: "XW sweep: needs closer observation",
      toRoom: "Bay 3", actorId: nurseB.id, actorName: nurseB.full_name, shiftId,
    });
    check(xfer.ok === true, "the nurse initiates a transfer", xfer.ok ? "" : xfer.error);
    if (xfer.ok) track("op_patient_transfers", [xfer.transfer.id]);
    check(xfer.ok && xfer.transfer.status === "pending", "with no receiving nurse it is PENDING, awaiting the supervisor", xfer.ok ? xfer.transfer.status : "");
    const { data: pAfterInit } = await admin.from("op_patients").select("operational_status").eq("id", patient1).maybeSingle();
    check(pAfterInit?.operational_status === "transfer_pending", "the census reflects the pending move immediately");

    const routed: any = await census.routeTransfer(admin, { transferId: xfer.transfer.id, receivingStaffId: nurseA.id });
    check(routed.ok === true && routed.transfer.status === "awaiting_acceptance", "the supervisor routes it to a receiving nurse");
    const inboxRx = await census.loadAssignmentInbox(admin, nurseA.id);
    check(inboxRx.incomingTransfers.some((t: any) => t.id === xfer.transfer.id), "it appears in the RECEIVING nurse's inbox");
    const inboxTx = await census.loadAssignmentInbox(admin, nurseB.id);
    check(inboxTx.outgoingTransfers.some((t: any) => t.id === xfer.transfer.id), "and as an outgoing transfer for the sending nurse");
    const wrongAccept: any = await census.acceptTransfer(admin, { transferId: xfer.transfer.id, userId: nurseB.id });
    check(wrongAccept.ok === false, "a nurse the transfer was not routed to cannot accept it", wrongAccept.error ?? "");
    const accX: any = await census.acceptTransfer(admin, { transferId: xfer.transfer.id, userId: nurseA.id });
    check(accX.ok === true, "the receiving nurse accepts", accX.ok ? "" : accX.error);
    await adopt("op_patient_assignments", (q: any) => q.eq("patient_id", patient1).eq("staff_id", nurseA.id));
    const mineRx = await patients.loadMyPatientWorkspace(admin, nurseA.id, Date.now());
    check(holds(mineRx, patient1), "ownership moves to the receiving nurse on acceptance");
    const mineTx = await patients.loadMyPatientWorkspace(admin, nurseB.id, Date.now());
    check(!holds(mineTx, patient1), "and leaves the sending nurse");

    // ═══ 5. ASSESSMENT: bedside instrument -> supervisor workload lens ══════
    head("5. ASSESSMENT  bedside instrument -> census sync -> SSW workload lens");
    const acuity: any = await assessments.recordAcuity(admin, {
      patientId: patient1, framework: "pews", payload: { total: 7, category3: false },
      assessedBy: nurseA.id, assessedByName: nurseA.full_name, shiftId,
    });
    check(acuity.ok === true, "the nurse records a PEWS acuity assessment", acuity.ok ? `score ${acuity.assessment.score}` : acuity.error);
    if (acuity.ok) track("op_acuity_assessments", [acuity.assessment.id]);
    const { data: pAcuity } = await admin.from("op_patients").select("acuity_level").eq("id", patient1).maybeSingle();
    check(pAcuity?.acuity_level === acuity.assessment.level,
      "the operational census acuity_level syncs from the instrument LEVEL", `${pAcuity?.acuity_level} from PEWS ${acuity.assessment.score}`);

    const workload: any = await assessments.recordWorkload(admin, {
      patientId: patient1, framework: "ward12",
      payload: { clinical_stability: 2, observation_frequency: 3, respiratory: 3, neurological: 1, circulation: 2, mobility_adl: 2, nutrition: 1, medication_complexity: 2, devices_wounds: 1, ipc_isolation: 0, communication_family: 1, coordination: 1 },
      assessedBy: nurseA.id, assessedByName: nurseA.full_name, shiftId,
    });
    check(workload.ok === true, "the nurse records a Ward-12 workload assessment", workload.ok ? `${workload.assessment.percentage}%` : workload.error);
    if (workload.ok) track("op_workload_assessments", [workload.assessment.id]);

    const agg = await assessments.nurseWorkloadAggregate(admin, nurseA.id);
    const wi: any = await loadWorkloadIntelligence(admin, hid, false, Date.now());
    check(wi.provisioned && !wi.empty, "the SSW workload lens has data");
    const sswNurse = (wi.nurses ?? []).find((n: any) => n.id === nurseA.id);
    check(!!sswNurse, "the nurse appears on the supervisor's per-nurse load board");
    check(sswNurse != null && Math.abs(sswNurse.load - agg.total) < 0.05,
      "SSW per-nurse load == the HWW aggregate the nurse sees (same rule, both sides)",
      `SSW ${sswNurse?.load} vs HWW ${agg.total}`);
    const sswPatient = (wi.patients ?? []).find((p: any) => p.id === patient1);
    check(sswPatient?.workloadPct === workload.assessment.percentage, "the measured percentage reaches the supervisor unchanged",
      `${sswPatient?.workloadPct}%`);
    check(sswPatient?.acuityScore === acuity.assessment.score, "and so does the acuity score", `${sswPatient?.acuityScore}`);
    check((wi.patients ?? []).some((p: any) => p.id === patient2 && !p.assessed),
      "an unassessed patient is marked unmeasured, never silently zeroed");

    // ═══ 6. ESCALATION: bedside -> supervisor escalation centre ═════════════
    head("6. ESCALATION  bedside raise -> SSW Escalation Centre");
    const [escId] = await ins("op_escalations", [{
      hospital_id: hid, patient_id: patient1, shift_id: shiftId,
      escalation_type: "clinical", level: 2, severity: "high", status: "open",
      summary: "XW sweep: PEWS 7, medical review requested", raised_by: nurseA.id,
    }]);
    const esc: any = await loadEscalations(admin, hid, false);
    const onBoard = (esc.board ?? []).find((e: any) => e.id === escId);
    check(!!onBoard, "the bedside escalation reaches the SSW Escalation Centre", `${(esc.board ?? []).length} on the board`);
    check(esc.kpis?.open >= 1, "and is counted in the open KPI", `${esc.kpis?.open}`);
    await admin.from("op_escalations").update({ status: "resolved", resolved_at: new Date().toISOString() }).eq("id", escId);
    const esc2: any = await loadEscalations(admin, hid, false);
    check(!(esc2.board ?? []).some((e: any) => e.id === escId), "resolving it clears the open board");

    // ═══ 7. ATTENDANCE: clock event -> supervisor board ═════════════════════
    head("7. ATTENDANCE  clock event -> SSW attendance board");
    await ins("op_shift_staff", [
      { shift_id: shiftId, staff_id: nurseA.id, role: "nurse", status: "on_duty" },
      { shift_id: shiftId, staff_id: nurseB.id, role: "nurse", status: "assigned" },
    ]);
    await ins("op_attendance_events", [{
      hospital_id: hid, shift_id: shiftId, staff_id: nurseA.id,
      event_type: "check_in", event_at: new Date(now - 2.8 * 3.6e6).toISOString(), check_in_method: "badge",
    }]);
    const att: any = await loadShiftAttendance(admin, hid, false, Date.now());
    check(att.provisioned && !att.empty && att.shift?.id === shiftId, "the supervisor board picks up the active shift");
    check(att.roster.find((r: any) => r.staffId === nurseA.id)?.state === "on_duty", "the clocked-in nurse reads on_duty");
    check(att.roster.find((r: any) => r.staffId === nurseB.id)?.state === "not_recorded", "the nurse with no clock record reads not_recorded, not absent");

    // ═══ 8. EVIDENCE: completed task -> competency skill log ════════════════
    head("8. EVIDENCE  completed procedural task -> competency evidence");
    const [taskId] = await ins("op_tasks", [{
      hospital_id: hid, patient_id: patient1, shift_id: shiftId, assigned_to: nurseA.id,
      task_type: "procedure", description: "XW sweep: peripheral cannulation",
      priority: "normal", status: "completed", completed_at: new Date().toISOString(),
    }]);
    const { data: taskRow } = await admin.from("op_tasks").select("*").eq("id", taskId).maybeSingle();
    const bridged = await evidence.evidenceFromTask(admin, taskRow);
    check(bridged.created === true, "a completed procedural task creates competency evidence", bridged.reason ?? bridged.id);
    if (bridged.id) track("skill_log_entries", [bridged.id]);
    const again = await evidence.evidenceFromTask(admin, taskRow);
    check(again.created === false && /already bridged/.test(again.reason ?? ""), "the bridge is idempotent — no duplicate evidence", again.reason ?? "");
    const { data: logRow } = await admin.from("skill_log_entries").select("nurse_id, status, supervision_level").eq("id", bridged.id!).maybeSingle();
    check(logRow?.nurse_id === nurseA.id, "the evidence is attributed to the performer, not the supervisor");
    check(logRow?.status === "pending", "and lands PENDING verification rather than self-certified", `${logRow?.status}`);
    const nonProcedural = await evidence.evidenceFromTask(admin, { ...taskRow, id: `${taskId}-x`, task_type: "observation" });
    check(nonProcedural.created === false, "a non-procedural task creates no evidence", nonProcedural.reason ?? "");
  } finally {
    head("cleanup");
    const order = ["skill_log_entries", "op_tasks", "op_attendance_events", "op_shift_staff", "op_escalations",
      "op_workload_assessments", "op_acuity_assessments", "op_concerns", "op_patient_transfers",
      "op_patient_assignments", "op_patients", "op_shifts"];
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
      if (ids.length) await admin.from(table).delete().in("id", ids);
    }
    let leftover = 0;
    for (const table of order) {
      const ids = [...new Set(cleanup.filter(c => c.table === table).flatMap(c => c.ids))];
      if (!ids.length) continue;
      const { data } = await admin.from(table).select("id").in("id", ids);
      leftover += (data ?? []).length;
    }
    check(leftover === 0, "every row the sweep wrote is cleaned up",
      leftover ? `${leftover} left` : `${cleanup.reduce((n, c) => n + c.ids.length, 0)} removed`);
  }

  console.log("\n── loop summary ────────────────────────────────────────────────");
  for (const name of [...new Set(results.map(r => r.loop))]) {
    const rs = results.filter(r => r.loop === name);
    const bad = rs.filter(r => !r.ok);
    console.log(`${bad.length ? "BROKEN " : "CLOSED "} ${name}  ${rs.length - bad.length}/${rs.length}${bad.length ? ` — ${bad.map(b => b.label).join("; ")}` : ""}`);
  }
  console.log(`\n${pass}/${pass + fail} checks passed.`);
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
