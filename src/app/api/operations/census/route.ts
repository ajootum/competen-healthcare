import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSupervisor, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";
import { notify } from "@/lib/notify";
import {
  loadAssignmentInbox, respondAssignment, initiateTransfer, routeTransfer,
  acceptTransfer, cancelTransfer, closeEpisode, loadUnassignedQueue,
} from "@/lib/hww/census";

import { currentTraceId } from "@/lib/trace";
// Census / Assignment State Engine API (HWW-WARD-002/003, migration 156).
//   GET ?inbox=1  → the caller's Assignment Inbox (self-scoped)
//   GET ?queue=1  → the unassigned queue + pending acceptances (staff tier)
//   POST actions:
//     respond_assignment {assignment_id, accept, reason?}   — the addressed nurse
//     initiate_transfer  {...}                              — current nurse or staff
//     route_transfer     {transfer_id, receiving_staff_id}  — supervisor
//     accept_transfer    {transfer_id}                      — the receiving nurse
//     cancel_transfer    {transfer_id, reason?}             — initiator or staff
//     close_episode      {patient_id, disposition}          — supervisor
// Every transition is audited; invalid transitions are rejected by the engine.
/* eslint-disable @typescript-eslint/no-explicit-any */

async function audit(c: any, action: string, entityType: string, id: string | null, hospitalId: string | null, extra?: any) {
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  await c.admin.from("audit_log").insert({ trace_id: await currentTraceId(),
    actor_id: c.userId, actor_name: me?.full_name ?? null, action,
    entity_type: entityType, entity_id: id, hospital_id: hospitalId, new_value: extra ?? null,
  }).then((r: any) => r, () => {});
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const url = new URL(req.url);
  if (url.searchParams.get("inbox")) return NextResponse.json(await loadAssignmentInbox(c.admin, c.userId));
  if (url.searchParams.get("queue")) {
    if (!isStaff(c)) return forbidden();
    return NextResponse.json(await loadUnassignedQueue(c.admin, c.hospitalId, isSuper(c)));
  }
  return badRequest("pass ?inbox=1 or ?queue=1");
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const admin = c.admin as any;

  if (action === "respond_assignment") {
    if (!b.assignment_id) return badRequest("assignment_id required");
    const r = await respondAssignment(admin, { assignmentId: b.assignment_id, userId: c.userId, accept: !!b.accept, reason: b.reason });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, b.accept ? "assignment_accepted" : "assignment_declined", "op_patient_assignment", r.assignment.id, r.assignment.hospital_id, { patient: r.patientLabel, reason: b.reason ?? null });
    if (r.assignerId && r.assignerId !== c.userId) {
      await notify([r.assignerId], {
        type: "op_assignment",
        title: b.accept ? `Assignment accepted — ${r.patientLabel}` : `Assignment declined — ${r.patientLabel}`,
        body: b.accept ? "The nurse has taken responsibility." : `Reason: ${String(b.reason).trim()}. The patient needs re-allocation.`,
        href: "/supervisor/team-assignments",
      });
    }
    return NextResponse.json({ ok: true, assignment: r.assignment });
  }

  if (action === "initiate_transfer") {
    if (!b.patient_id) return badRequest("patient_id required");
    // The current responsible nurse or the coordinator tier may initiate.
    if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");
    const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
    const r = await initiateTransfer(admin, {
      patientId: b.patient_id, transferType: b.transfer_type, reason: b.reason,
      toUnitId: b.to_unit_id, toBedId: b.to_bed_id, toRoom: b.to_room,
      destination: b.destination, receivingStaffId: b.receiving_staff_id, receivingClinician: b.receiving_clinician,
      transport: b.transport, effectiveAt: b.effective_at, shiftId: b.shift_id,
      actorId: c.userId, actorName: me?.full_name ?? null,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, "transfer_initiated", "op_patient_transfer", r.transfer.id, r.transfer.hospital_id, { patient: r.patientLabel, type: b.transfer_type });
    if (r.transfer.receiving_staff_id && r.transfer.receiving_staff_id !== c.userId) {
      await notify([r.transfer.receiving_staff_id], {
        type: "op_transfer", title: `Incoming transfer — ${r.patientLabel}`,
        body: `Accept responsibility to complete the transfer. Reason: ${r.transfer.reason}`,
        href: "/healthcare-worker/inbox",
      });
    }
    return NextResponse.json({ ok: true, transfer: r.transfer }, { status: 201 });
  }

  if (action === "route_transfer") {
    if (!isSupervisor(c)) return forbidden();
    if (!b.transfer_id || !b.receiving_staff_id) return badRequest("transfer_id and receiving_staff_id required");
    const r = await routeTransfer(admin, { transferId: b.transfer_id, receivingStaffId: b.receiving_staff_id });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, "transfer_routed", "op_patient_transfer", b.transfer_id, r.transfer.hospital_id, { receiving: b.receiving_staff_id });
    await notify([b.receiving_staff_id], { type: "op_transfer", title: "Incoming transfer awaiting your acceptance", body: "Open your Assignment Inbox to accept responsibility.", href: "/healthcare-worker/inbox" });
    return NextResponse.json({ ok: true, transfer: r.transfer });
  }

  if (action === "accept_transfer") {
    if (!b.transfer_id) return badRequest("transfer_id required");
    const r = await acceptTransfer(admin, { transferId: b.transfer_id, userId: c.userId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, "transfer_accepted", "op_patient_transfer", r.transfer.id, r.transfer.hospital_id, { patient: r.patientLabel });
    const tell = [r.fromStaffId, r.transfer.initiated_by].filter((x: any) => x && x !== c.userId) as string[];
    if (tell.length) await notify([...new Set(tell)], { type: "op_transfer", title: `Transfer accepted — ${r.patientLabel}`, body: "Responsibility has moved to the receiving nurse.", href: "/healthcare-worker/patients" });
    return NextResponse.json({ ok: true, transfer: r.transfer });
  }

  if (action === "cancel_transfer") {
    if (!b.transfer_id) return badRequest("transfer_id required");
    const { data: t } = await admin.from("op_patient_transfers").select("initiated_by, hospital_id").eq("id", b.transfer_id).maybeSingle();
    if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isStaff(c) && t.initiated_by !== c.userId) return forbidden("Only the initiator or a coordinator can cancel");
    const r = await cancelTransfer(admin, { transferId: b.transfer_id, reason: b.reason });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, "transfer_cancelled", "op_patient_transfer", b.transfer_id, t.hospital_id, { reason: b.reason ?? null });
    return NextResponse.json({ ok: true });
  }

  if (action === "close_episode") {
    if (!isSupervisor(c)) return forbidden("Episode closure is a supervisor action");
    if (!b.patient_id) return badRequest("patient_id required");
    if (!isSuper(c)) {
      const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
      if (p && p.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    }
    const r = await closeEpisode(admin, { patientId: b.patient_id, disposition: b.disposition, userId: c.userId });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    await audit(c, "episode_closed", "op_patient", b.patient_id, r.patient.hospital_id, { disposition: b.disposition });
    return NextResponse.json({ ok: true, patient: r.patient });
  }

  return badRequest("unknown action");
}
