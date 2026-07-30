import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, isAssignedToPatient } from "@/lib/api-auth";
import { notify } from "@/lib/notify";
import { emitConcernRaised } from "@/lib/orchestration/producers";
import {
  validateConcern, loadMyConcerns, loadConcernQueue,
  ROUTE_DESTINATIONS, ACTIVE_CONCERN_STATUSES, TASK_PRIORITY_BY_CONCERN,
} from "@/lib/hww/concerns";

// Nurse Concerns API (HWW-ADD-001 / ADD-001B, migration 152).
//   GET  ?mine=1 → the nurse's own lens; otherwise the supervisor queue (staff tier).
//   POST → raise a concern (the bedside nurse's act: assigned-to-patient or staff).
//   PATCH → action-dispatched lifecycle: status transitions, CCE routing,
//           acknowledgement, ward-round actions (optionally spawned as real op_tasks).
// Tenancy: a concern belongs to the PATIENT's hospital (subject-scoped). Every
// mutation is audit-logged. 409 migration hint until 152 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 152 to enable Nurse Concerns" }, { status: 409 }) : null;

async function audit(c: any, action: string, id: string | null, hospitalId: string | null, extra?: any) {
  await c.admin.from("audit_log").insert({
    actor_id: c.userId, action, entity_type: "op_concern", entity_id: id,
    hospital_id: hospitalId, new_value: extra ?? null,
  }).then((r: any) => r, () => {});
}

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const mine = new URL(req.url).searchParams.get("mine");
  if (mine) return NextResponse.json(await loadMyConcerns(c.admin, c.userId));
  if (!isStaff(c)) return forbidden();
  return NextResponse.json(await loadConcernQueue(c.admin, c.hospitalId, isSuper(c)));
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const errs = validateConcern(b);
  if (errs.length) return badRequest(errs.join("; "));
  const admin = c.admin as any;

  // Subject = the patient: existence, tenant scope, frontline assignment rule.
  const { data: p } = await admin.from("op_patients").select("id, label, hospital_id, department_id, unit_id").eq("id", b.patient_id).maybeSingle();
  if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
  if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  if (!isStaff(c) && !(await isAssignedToPatient(c, b.patient_id))) return forbidden("Not your patient");

  // The shift context when raised: caller's current active shift (if deployed).
  const { data: dep } = await admin.from("op_shift_staff")
    .select("shift_id, op_shifts!shift_id(id, status, supervisor_id)")
    .eq("staff_id", c.userId).limit(20);
  const activeShift = (dep ?? []).map((d: any) => d.op_shifts).find((s: any) => s?.status === "active") ?? null;

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await admin.from("op_concerns").insert({
    hospital_id: p.hospital_id, department_id: p.department_id ?? null, unit_id: p.unit_id ?? null,
    patient_id: p.id, shift_id: b.shift_id ?? activeShift?.id ?? null,
    category: b.category, priority: b.priority, description: String(b.description).trim(),
    raised_by: c.userId, raised_by_name: me?.full_name ?? null,
    ward_round: !!b.ward_round, ss_review: !!b.ss_review, status: "open",
  }).select("id, category, priority").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await audit(c, "concern_raised", data.id, p.hospital_id, { category: b.category, priority: b.priority, ward_round: !!b.ward_round, ss_review: !!b.ss_review });
  // HWW-OPS-001 catalogue event (fail-soft).
  await emitConcernRaised(admin, { id: data.id, hospital_id: p.hospital_id, patient_id: p.id, category: b.category, priority: b.priority, ward_round: !!b.ward_round, ss_review: !!b.ss_review }, c.userId);

  // Push to the SSW: supervisor attention or high priority notifies the
  // caller's active-shift supervisor (real notification, only when one exists).
  const supervisorId = activeShift?.supervisor_id ?? null;
  if (supervisorId && supervisorId !== c.userId && (b.ss_review || ["immediate", "urgent"].includes(b.priority))) {
    await notify([supervisorId], {
      type: "op_concern",
      title: `${b.priority === "immediate" ? "⛔ Immediate" : b.priority === "urgent" ? "⚠️ Urgent" : "Nurse"} concern — ${p.label}`,
      body: String(b.description).trim().slice(0, 160),
      href: "/supervisor/concerns",
    });
  }

  return NextResponse.json({ ok: true, concern: data }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const b = await req.json().catch(() => ({}));
  const action = String(b.action ?? "");
  const admin = c.admin as any;

  // ── Ward-round action completion (owner or staff) ──
  if (action === "action_status") {
    if (!b.id || !["open", "in_progress", "completed", "cancelled"].includes(b.status)) return badRequest("id and valid status required");
    const { data: row, error: e0 } = await admin.from("op_concern_actions").select("id, owner_id, hospital_id, concern_id, task_id").eq("id", b.id).maybeSingle();
    if (e0) return migrationGate(e0) ?? NextResponse.json({ error: e0.message }, { status: 500 });
    if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!isStaff(c) && row.owner_id !== c.userId) return forbidden("Not your action");
    if (isStaff(c) && !isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
    const patch: any = { status: b.status };
    if (b.status === "completed") patch.completed_at = new Date().toISOString();
    const { error } = await admin.from("op_concern_actions").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c, `concern_action_${b.status}`, row.concern_id, row.hospital_id, { action_id: b.id });
    return NextResponse.json({ ok: true });
  }

  // ── Everything else operates on a concern ──
  if (!b.id) return badRequest("id required");
  const { data: concern, error: e1 } = await admin.from("op_concerns")
    .select("id, hospital_id, patient_id, shift_id, raised_by, status, priority, category").eq("id", b.id).maybeSingle();
  if (e1) return migrationGate(e1) ?? NextResponse.json({ error: e1.message }, { status: 500 });
  if (!concern) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && concern.hospital_id && concern.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  // Frontline writers: the raiser, or a nurse assigned to the patient. Staff tier always.
  const frontlineOk = concern.raised_by === c.userId || (await isAssignedToPatient(c, concern.patient_id));

  if (action === "status") {
    if (!["open", "in_progress", "resolved", "carried_forward"].includes(b.status)) return badRequest("valid status required");
    if (!isStaff(c) && !frontlineOk) return forbidden("Not your concern");
    const patch: any = { status: b.status };
    if (b.status === "resolved") {
      patch.resolution_notes = String(b.resolution_notes ?? "").trim() || null;
      patch.resolved_by = c.userId;
      patch.resolved_at = new Date().toISOString();
    }
    if (b.status === "carried_forward") {
      // Carry across handover: remember the shift it left, detach from it.
      patch.carried_from_shift_id = concern.shift_id ?? null;
      patch.shift_id = b.new_shift_id ?? null;
    }
    const { error } = await admin.from("op_concerns").update(patch).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c, `concern_${b.status}`, b.id, concern.hospital_id, b.status === "resolved" ? { notes: patch.resolution_notes } : null);
    return NextResponse.json({ ok: true });
  }

  if (action === "route") {
    // CCE routing decision (ADD-001B) — a coordination act, staff tier.
    if (!isStaff(c)) return forbidden();
    if (!ROUTE_DESTINATIONS.includes(b.routed_to)) return badRequest(`routed_to must be one of: ${ROUTE_DESTINATIONS.join(", ")}`);
    const { error } = await admin.from("op_concerns").update({
      routed_to: b.routed_to, routed_by: c.userId, routed_at: new Date().toISOString(),
      acknowledged_by: null, acknowledged_at: null,   // a re-route resets acknowledgement
    }).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // ADD-001B RoutingDecision HISTORY (migration 158): every routing decision
    // is retained; the concern row keeps only the current destination. Fail-soft
    // pre-158.
    {
      const { data: me2 } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
      await admin.from("op_concern_routings").insert({
        hospital_id: concern.hospital_id, concern_id: b.id, routed_to: b.routed_to,
        routed_by: c.userId, routed_by_name: me2?.full_name ?? null,
      }).then((x: any) => x, () => {});
    }
    await audit(c, "concern_routed", b.id, concern.hospital_id, { routed_to: b.routed_to });
    return NextResponse.json({ ok: true });
  }

  if (action === "acknowledge") {
    if (!isStaff(c)) return forbidden();
    const { error } = await admin.from("op_concerns").update({ acknowledged_by: c.userId, acknowledged_at: new Date().toISOString() }).eq("id", b.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await audit(c, "concern_acknowledged", b.id, concern.hospital_id);
    return NextResponse.json({ ok: true });
  }

  if (action === "add_action") {
    // Ward Round Action (ADD-001 workflow step 5) — a review decision, staff tier.
    if (!isStaff(c)) return forbidden();
    if (!String(b.text ?? "").trim()) return badRequest("text required");
    if (!ACTIVE_CONCERN_STATUSES.includes(concern.status)) return badRequest("Concern is not active");
    const ownerId = b.owner_id ?? concern.raised_by ?? null;
    let ownerName: string | null = null;
    if (ownerId) {
      const { data: o } = await admin.from("profiles").select("full_name, hospital_id").eq("id", ownerId).maybeSingle();
      if (!o) return badRequest("owner not found");
      if (!isSuper(c) && o.hospital_id && o.hospital_id !== c.hospitalId) return forbidden("Owner out of scope");
      ownerName = o.full_name ?? null;
    }

    // Optionally spawn the action as a REAL op_task so it lands in the nurse's
    // live task list (assigned back to the HWW, per the ADD-001 workflow).
    let taskId: string | null = null;
    if (b.spawn_task && ownerId) {
      const { data: t, error: te } = await admin.from("op_tasks").insert({
        hospital_id: concern.hospital_id, patient_id: concern.patient_id, shift_id: concern.shift_id ?? null,
        task_type: "ward_round_action", description: String(b.text).trim(),
        assigned_to: ownerId, assigned_by: c.userId,
        priority: TASK_PRIORITY_BY_CONCERN[concern.priority] ?? "normal",
        due_at: b.due_at ?? null, status: "assigned",
      }).select("id").single();
      if (te) return NextResponse.json({ error: `Task spawn failed: ${te.message}` }, { status: 500 });
      taskId = t.id;
    }

    const { data: act, error } = await admin.from("op_concern_actions").insert({
      hospital_id: concern.hospital_id, concern_id: concern.id,
      action: String(b.text).trim(), owner_id: ownerId, owner_name: ownerName,
      due_at: b.due_at ?? null, status: "open", task_id: taskId, created_by: c.userId,
    }).select("id").single();
    if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

    // Concern moves to in_progress once the round has produced an action.
    if (concern.status === "open") await admin.from("op_concerns").update({ status: "in_progress" }).eq("id", concern.id);
    await audit(c, "concern_action_added", concern.id, concern.hospital_id, { action_id: act.id, task_spawned: !!taskId });
    if (ownerId && ownerId !== c.userId) {
      await notify([ownerId], { type: "op_concern", title: "Ward round action assigned to you", body: String(b.text).trim().slice(0, 160), href: "/healthcare-worker/concerns" });
    }
    return NextResponse.json({ ok: true, action_id: act.id, task_id: taskId }, { status: 201 });
  }

  return badRequest("unknown action");
}
