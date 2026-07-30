// Patient Responsibility & Assignment State Engine (HWW-WARD-002/003,
// migration 156). THE RULE: responsibility changes ONLY on explicit acceptance
// by the receiving healthcare worker — until then the current assigned worker
// (or the supervisor, for unassigned patients) remains accountable.
//   Assignment: SSW assigns -> pending_acceptance (NOT in My Patients, not
//   responsible) -> nurse accepts -> active (any other active primary ends at
//   THIS moment, never earlier) | declines -> declined (back to SSW).
//   Transfer: initiated (destination mandatory) -> awaiting receiving
//   acceptance -> accepted = ownership changes + internal moves update the
//   census location -> completed. Cancellation never deletes.
//   Closure: disposition + timestamps archive the episode; nothing is deleted.
// Every transition is validated (invalid ones are rejected, per the FSM spec)
// and audited by the route. Engine shared by routes, pages and harnesses.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const TRANSFER_TYPES = ["internal", "icu", "hdu", "theatre", "recovery", "other_ward", "other_hospital", "diagnostic", "other"] as const;
export const DISPOSITIONS = ["discharged", "transferred", "deceased", "left_ama", "absconded", "admission_error"] as const;
const IN_WARD = ["admitted", "transfer_pending", "discharge_pending"];

type Res<T = Record<string, never>> = ({ ok: true } & T) | { ok: false; status: number; error: string };
const err = (status: number, error: string) => ({ ok: false as const, status, error });
const migrationMissingErr = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// ── The nurse's Assignment Inbox ────────────────────────────────────────────
export async function loadAssignmentInbox(admin: any, userId: string) {
  const soft = (p: Promise<any>) => p.then((r: any) => r, () => ({ data: [], error: null }));
  const [pendRes, xferRes, recentRes, outXferRes] = await Promise.all([
    soft(admin.from("op_patient_assignments")
      .select("id, patient_id, assignment_type, started_at, created_by, op_patients!patient_id(id, label, acuity_level, isolation_status, diagnosis, op_beds!bed_id(label)), assigner:profiles!created_by(full_name)")
      .eq("staff_id", userId).eq("status", "pending_acceptance").order("started_at", { ascending: true }).limit(50)),
    soft(admin.from("op_patient_transfers")
      .select("*, op_patients!patient_id(id, label, acuity_level, op_beds!bed_id(label)), from_nurse:profiles!from_staff_id(full_name)")
      .eq("receiving_staff_id", userId).eq("status", "awaiting_acceptance").order("created_at", { ascending: true }).limit(50)),
    soft(admin.from("op_patient_assignments")
      .select("id, status, declined_reason, responded_at, op_patients!patient_id(label)")
      .eq("staff_id", userId).in("status", ["declined"]).order("responded_at", { ascending: false }).limit(10)),
    soft(admin.from("op_patient_transfers")
      .select("*, op_patients!patient_id(label), receiver:profiles!receiving_staff_id(full_name)")
      .eq("from_staff_id", userId).in("status", ["pending", "awaiting_acceptance"]).order("created_at", { ascending: false }).limit(20)),
  ]);
  const migrationMissing = migrationMissingErr(pendRes.error) || migrationMissingErr(xferRes.error);
  return {
    migrationMissing,
    pendingAssignments: pendRes.data ?? [],
    incomingTransfers: xferRes.data ?? [],
    recentDeclines: recentRes.data ?? [],
    outgoingTransfers: outXferRes.data ?? [],
  };
}

// ── Assignment acceptance / decline (WARD-003 Assigned -> Accepted|Declined) ─
export async function respondAssignment(admin: any, input: { assignmentId: string; userId: string; accept: boolean; reason?: string | null }): Promise<Res<{ assignment: any; patientLabel: string; assignerId: string | null }>> {
  const { data: a, error } = await admin.from("op_patient_assignments")
    .select("id, patient_id, staff_id, status, assignment_type, created_by, hospital_id, op_patients!patient_id(label)")
    .eq("id", input.assignmentId).maybeSingle();
  if (error) return err(migrationMissingErr(error) ? 503 : 500, migrationMissingErr(error) ? "Apply migration 156 to enable the assignment state engine." : error.message);
  if (!a) return err(404, "Assignment not found");
  if (a.staff_id !== input.userId) return err(403, "This assignment is not addressed to you");
  if (a.status !== "pending_acceptance") return err(400, `Assignment is ${a.status} — only pending assignments can be responded to`);
  if (!input.accept && !String(input.reason ?? "").trim()) return err(400, "A reason is required when declining (it returns to your supervisor)");

  const now = new Date().toISOString();
  if (input.accept) {
    // Responsibility transfers NOW: any other active primary for this patient
    // ends at acceptance (never earlier — the previous nurse stayed
    // accountable throughout the pending window).
    if (a.assignment_type === "primary") {
      await admin.from("op_patient_assignments").update({ status: "ended", ended_at: now })
        .eq("patient_id", a.patient_id).eq("assignment_type", "primary").eq("status", "active");
    }
    const { data: upd, error: ue } = await admin.from("op_patient_assignments")
      .update({ status: "active", acceptance_status: "accepted", accepted_at: now, responded_at: now })
      .eq("id", a.id).select().single();
    if (ue) return err(500, ue.message);
    return { ok: true, assignment: upd, patientLabel: a.op_patients?.label ?? "patient", assignerId: a.created_by ?? null };
  }
  const { data: upd, error: ue } = await admin.from("op_patient_assignments")
    .update({ status: "declined", acceptance_status: "declined", declined_reason: String(input.reason).trim(), responded_at: now })
    .eq("id", a.id).select().single();
  if (ue) return err(500, ue.message);
  return { ok: true, assignment: upd, patientLabel: a.op_patients?.label ?? "patient", assignerId: a.created_by ?? null };
}

// ── Transfer engine (WARD-002 / WARD-003 transfer rules) ────────────────────
export async function initiateTransfer(admin: any, input: {
  patientId: string; transferType: string; reason: string;
  toUnitId?: string | null; toBedId?: string | null; toRoom?: string | null;
  destination?: string | null; receivingStaffId?: string | null; receivingClinician?: string | null;
  transport?: string | null; effectiveAt?: string | null; shiftId?: string | null;
  actorId: string; actorName?: string | null;
}): Promise<Res<{ transfer: any; patientLabel: string }>> {
  if (!TRANSFER_TYPES.includes(input.transferType as any)) return err(400, `transfer_type must be one of: ${TRANSFER_TYPES.join(", ")}`);
  if (!String(input.reason ?? "").trim()) return err(400, "reason is required (destination and reason are mandatory)");
  const internal = input.transferType === "internal";
  if (internal && !input.toUnitId && !input.toBedId && !String(input.toRoom ?? "").trim()) return err(400, "Internal transfers need a destination room, bed or unit");
  if (!internal && !String(input.destination ?? "").trim()) return err(400, "External transfers need a destination description");

  const { data: p } = await admin.from("op_patients").select("id, label, hospital_id, unit_id, bed_id, closed_at").eq("id", input.patientId).maybeSingle();
  if (!p) return err(404, "Patient not found");
  if (p.closed_at) return err(400, "Episode is closed");

  const { data: cur } = await admin.from("op_patient_assignments").select("staff_id")
    .eq("patient_id", p.id).eq("assignment_type", "primary").eq("status", "active").limit(1).maybeSingle();

  const { data, error } = await admin.from("op_patient_transfers").insert({
    hospital_id: p.hospital_id, patient_id: p.id, shift_id: input.shiftId ?? null,
    transfer_type: input.transferType,
    from_unit_id: p.unit_id ?? null, from_bed_id: p.bed_id ?? null, from_staff_id: cur?.staff_id ?? null,
    to_unit_id: input.toUnitId ?? null, to_bed_id: input.toBedId ?? null, to_room: String(input.toRoom ?? "").trim() || null,
    destination: String(input.destination ?? "").trim() || null,
    receiving_staff_id: input.receivingStaffId ?? null, receiving_clinician: String(input.receivingClinician ?? "").trim() || null,
    transport: String(input.transport ?? "").trim() || null, reason: String(input.reason).trim(),
    effective_at: input.effectiveAt ?? null,
    status: input.receivingStaffId ? "awaiting_acceptance" : "pending",
    initiated_by: input.actorId, initiated_by_name: input.actorName ?? null,
  }).select().single();
  if (error) return err(migrationMissingErr(error) ? 503 : 500, migrationMissingErr(error) ? "Apply migration 156 to enable transfers." : error.message);

  // The census reflects the pending move.
  await admin.from("op_patients").update({ operational_status: "transfer_pending" }).eq("id", p.id).eq("operational_status", "admitted");
  return { ok: true, transfer: data, patientLabel: p.label };
}

// Route a pending transfer to a receiving nurse (supervisor act).
export async function routeTransfer(admin: any, input: { transferId: string; receivingStaffId: string }): Promise<Res<{ transfer: any }>> {
  const { data: t } = await admin.from("op_patient_transfers").select("id, status").eq("id", input.transferId).maybeSingle();
  if (!t) return err(404, "Transfer not found");
  if (!["pending", "awaiting_acceptance"].includes(t.status)) return err(400, `Transfer is ${t.status}`);
  const { data, error } = await admin.from("op_patient_transfers")
    .update({ receiving_staff_id: input.receivingStaffId, status: "awaiting_acceptance" })
    .eq("id", input.transferId).select().single();
  if (error) return err(500, error.message);
  return { ok: true, transfer: data };
}

export async function acceptTransfer(admin: any, input: { transferId: string; userId: string }): Promise<Res<{ transfer: any; patientLabel: string; fromStaffId: string | null }>> {
  const { data: t, error } = await admin.from("op_patient_transfers")
    .select("*, op_patients!patient_id(id, label, hospital_id)").eq("id", input.transferId).maybeSingle();
  if (error) return err(migrationMissingErr(error) ? 503 : 500, migrationMissingErr(error) ? "Apply migration 156 to enable transfers." : error.message);
  if (!t) return err(404, "Transfer not found");
  if (t.status !== "awaiting_acceptance") return err(400, `Transfer is ${t.status} — only awaiting-acceptance transfers can be accepted`);
  if (t.receiving_staff_id !== input.userId) return err(403, "This transfer is not addressed to you");

  const now = new Date().toISOString();
  // Ownership changes NOW: end every active assignment, create the receiver's
  // ACTIVE assignment (transfer acceptance IS the explicit acceptance).
  await admin.from("op_patient_assignments").update({ status: "ended", ended_at: now })
    .eq("patient_id", t.patient_id).in("status", ["active", "pending_acceptance"]);
  const { error: ae } = await admin.from("op_patient_assignments").insert({
    hospital_id: t.op_patients?.hospital_id ?? t.hospital_id, patient_id: t.patient_id, staff_id: input.userId,
    assignment_type: "primary", competency_validated: true, status: "active",
    acceptance_status: "accepted", accepted_at: now, responded_at: now, created_by: t.initiated_by ?? null,
  });
  if (ae) return err(500, `Transfer accepted but the new assignment failed: ${ae.message}`);

  // Internal moves update the census location; bed occupancy stays with the
  // bed-management tools (honest: not double-managed here).
  const patch: any = { operational_status: "admitted" };
  if (t.to_unit_id) patch.unit_id = t.to_unit_id;
  if (t.to_bed_id) patch.bed_id = t.to_bed_id;
  await admin.from("op_patients").update(patch).eq("id", t.patient_id);

  const { data: upd, error: ue } = await admin.from("op_patient_transfers")
    .update({ status: "completed", accepted_at: now, completed_at: now, handover_complete: true })
    .eq("id", t.id).select().single();
  if (ue) return err(500, ue.message);
  return { ok: true, transfer: upd, patientLabel: t.op_patients?.label ?? "patient", fromStaffId: t.from_staff_id ?? null };
}

export async function cancelTransfer(admin: any, input: { transferId: string; reason?: string | null }): Promise<Res<{ transfer: any }>> {
  const { data: t } = await admin.from("op_patient_transfers").select("id, status, patient_id").eq("id", input.transferId).maybeSingle();
  if (!t) return err(404, "Transfer not found");
  if (!["pending", "awaiting_acceptance"].includes(t.status)) return err(400, `Transfer is ${t.status} and cannot be cancelled`);
  const { data, error } = await admin.from("op_patient_transfers")
    .update({ status: "cancelled", cancelled_reason: String(input.reason ?? "").trim() || null }).eq("id", t.id).select().single();
  if (error) return err(500, error.message);
  await admin.from("op_patients").update({ operational_status: "admitted" }).eq("id", t.patient_id).eq("operational_status", "transfer_pending");
  return { ok: true, transfer: data };
}

// ── Episode closure (WARD-002: archive, never delete) ───────────────────────
export async function closeEpisode(admin: any, input: { patientId: string; disposition: string; userId: string }): Promise<Res<{ patient: any }>> {
  if (!DISPOSITIONS.includes(input.disposition as any)) return err(400, `disposition must be one of: ${DISPOSITIONS.join(", ")}`);
  const { data: p, error } = await admin.from("op_patients").select("id, label, closed_at").eq("id", input.patientId).maybeSingle();
  if (error) return err(migrationMissingErr(error) ? 503 : 500, migrationMissingErr(error) ? "Apply migration 156 to enable episode closure." : error.message);
  if (!p) return err(404, "Patient not found");
  if (p.closed_at) return err(400, "Episode already closed");

  const now = new Date().toISOString();
  await admin.from("op_patient_assignments").update({ status: "ended", ended_at: now })
    .eq("patient_id", p.id).in("status", ["active", "pending_acceptance"]);
  await admin.from("op_patient_transfers").update({ status: "cancelled", cancelled_reason: "episode closed" })
    .eq("patient_id", p.id).in("status", ["pending", "awaiting_acceptance"]);
  const { data: upd, error: ue } = await admin.from("op_patients")
    .update({ disposition: input.disposition, closed_at: now, closed_by: input.userId, operational_status: "discharged" })
    .eq("id", p.id).select().single();
  if (ue) return err(500, ue.message);
  return { ok: true, patient: upd };
}

// ── Unassigned queue (SSW lens) ─────────────────────────────────────────────
export async function loadUnassignedQueue(admin: any, hospitalId: string | null, isSuperUser: boolean) {
  let q = admin.from("op_patients").select("id, label, acuity_level, isolation_status, diagnosis, created_at, op_beds!bed_id(label), units!unit_id(name)")
    .in("operational_status", IN_WARD).is("closed_at", null).limit(200);
  if (!isSuperUser) q = q.eq("hospital_id", hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data: patients, error } = await q;
  if (error) return { migrationMissing: migrationMissingErr(error), unassigned: [], pendingAcceptance: [] };
  const ids = ((patients ?? []) as any[]).map(p => p.id);
  if (!ids.length) return { migrationMissing: false, unassigned: [], pendingAcceptance: [] };
  const { data: asg } = await admin.from("op_patient_assignments").select("patient_id, status, staff_id, profiles!staff_id(full_name)")
    .in("patient_id", ids).in("status", ["active", "pending_acceptance"]).eq("assignment_type", "primary").limit(500);
  const byPatient = new Map<string, any>();
  for (const a of (asg ?? []) as any[]) if (!byPatient.has(a.patient_id) || a.status === "active") byPatient.set(a.patient_id, a);
  return {
    migrationMissing: false,
    unassigned: (patients ?? []).filter((p: any) => !byPatient.has(p.id)),
    pendingAcceptance: (patients ?? []).filter((p: any) => byPatient.get(p.id)?.status === "pending_acceptance")
      .map((p: any) => ({ ...p, pending_with: byPatient.get(p.id)?.profiles?.full_name ?? null })),
  };
}
