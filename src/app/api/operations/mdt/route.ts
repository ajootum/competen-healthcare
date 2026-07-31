import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { validateMeeting, validateReferral, MDT_SERVICES, OPEN_ACTION_STATUSES } from "@/lib/operations/mdt";

// MDT Coordination write path (SSW-CCR-005, migration 160).
//
// Scoping: RAISING a referral is open to any authenticated clinician — the nurse at the bedside is usually
// the one who spots a patient needing multidisciplinary input, exactly as with escalations and concerns.
// Everything else (scheduling, attendance, decisions, actions) is the supervisor's coordination job.
//
// The subject's hospital is taken from the PATIENT/MEETING row, never from the caller, so a super_admin
// acting on a tenant's data writes into that tenant, not an unscoped row.
/* eslint-disable @typescript-eslint/no-explicit-any */

const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const notProvisioned = () => NextResponse.json({ error: "Apply migration 160 to enable MDT coordination." }, { status: 503 });

export async function GET(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden("MDT coordination is for shift supervisors and managers");
  const admin = c.admin as any;
  const meetingId = new URL(req.url).searchParams.get("meeting");

  if (meetingId) {
    const { data: m, error } = await admin.from("op_mdt_meetings").select("*").eq("id", meetingId).maybeSingle();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
    if (!m) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
    if (!isSuper(c) && m.hospital_id !== c.hospitalId) return forbidden();
    const [p, d, a] = await Promise.all([
      admin.from("op_mdt_participants").select("*, profiles!staff_id(full_name)").eq("meeting_id", meetingId),
      admin.from("op_mdt_decisions").select("*").eq("meeting_id", meetingId).order("decided_at", { ascending: false }),
      admin.from("op_mdt_actions").select("*, owner:profiles!owner_id(full_name)").eq("meeting_id", meetingId).order("due_at", { ascending: true }),
    ]);
    return NextResponse.json({ meeting: m, participants: p.data ?? [], decisions: d.data ?? [], actions: a.data ?? [] });
  }

  let q = admin.from("op_mdt_meetings").select("*, op_patients!patient_id(label)").order("scheduled_at", { ascending: true }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meetings: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? "");

  // ── refer: any authenticated clinician may flag a patient for MDT review ──
  if (action === "refer") {
    const errs = validateReferral(b);
    if (errs.length) return badRequest(errs.join("; "));
    const { data: p } = await admin.from("op_patients").select("id, hospital_id, unit_id, department_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden();
    const { data, error } = await admin.from("op_mdt_referrals").insert({
      hospital_id: p.hospital_id, patient_id: p.id, unit_id: p.unit_id ?? null, department_id: p.department_id ?? null,
      reason: String(b.reason).trim(),
      complexity: b.complexity ?? "standard", priority: b.priority ?? "routine",
      services_requested: Array.isArray(b.services_requested)
        ? b.services_requested.filter((s: string) => MDT_SERVICES.some(x => x.key === s)) : null,
      raised_by: c.userId, raised_by_name: b.raised_by_name ?? null,
    }).select().single();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: c.userId, action: "mdt_refer", entity_type: "op_mdt_referral", entity_id: data.id,
      hospital_id: p.hospital_id, new_value: { patient_id: p.id, priority: data.priority, complexity: data.complexity },
    });
    return NextResponse.json({ referral: data }, { status: 201 });
  }

  // Everything below coordinates the meeting itself.
  if (!isSupervisor(c)) return forbidden("Only shift supervisors and managers coordinate MDT meetings");

  if (action === "schedule") {
    const errs = validateMeeting(b);
    if (errs.length) return badRequest(errs.join("; "));
    // The meeting inherits the PATIENT's hospital when there is one; otherwise the caller's own.
    let hospitalId = c.hospitalId ?? null, unitId = b.unit_id ?? null, deptId = b.department_id ?? null;
    if (b.patient_id) {
      const { data: p } = await admin.from("op_patients").select("hospital_id, unit_id, department_id").eq("id", b.patient_id).maybeSingle();
      if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
      if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden();
      hospitalId = p.hospital_id; unitId = unitId ?? p.unit_id; deptId = deptId ?? p.department_id;
    }
    const { data, error } = await admin.from("op_mdt_meetings").insert({
      hospital_id: hospitalId, unit_id: unitId, department_id: deptId,
      patient_id: b.patient_id ?? null, shift_id: b.shift_id ?? null,
      title: String(b.title).trim(), meeting_type: b.meeting_type ?? "ward_mdt",
      scheduled_at: new Date(b.scheduled_at).toISOString(),
      duration_min: Number.isFinite(Number(b.duration_min)) ? Number(b.duration_min) : null,
      location: String(b.location ?? "").trim() || null,
      virtual_link: String(b.virtual_link ?? "").trim() || null,
      agenda: String(b.agenda ?? "").trim() || null,
      chaired_by: b.chaired_by ?? c.userId, chaired_by_name: b.chaired_by_name ?? null,
      created_by: c.userId,
    }).select().single();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });

    // Invitations, if the scheduler picked services up front.
    const invites = Array.isArray(b.participants) ? b.participants : [];
    if (invites.length) {
      const rows = invites
        .filter((p: any) => MDT_SERVICES.some(s => s.key === p.service))
        .map((p: any) => ({
          meeting_id: data.id, service: p.service, staff_id: p.staff_id ?? null,
          participant_name: String(p.participant_name ?? "").trim() || null,
          role_at_meeting: String(p.role_at_meeting ?? "").trim() || null,
          required: p.required !== false,
        }));
      if (rows.length) await admin.from("op_mdt_participants").insert(rows);
    }
    // A referral that prompted this meeting moves to scheduled.
    if (b.referral_id) {
      await admin.from("op_mdt_referrals").update({ status: "scheduled", meeting_id: data.id })
        .eq("id", b.referral_id).eq("status", "awaiting_review");
    }
    await admin.from("audit_log").insert({
      actor_id: c.userId, action: "mdt_schedule", entity_type: "op_mdt_meeting", entity_id: data.id,
      hospital_id: hospitalId, new_value: { meeting_type: data.meeting_type, scheduled_at: data.scheduled_at, invited: invites.length },
    });
    return NextResponse.json({ meeting: data }, { status: 201 });
  }

  if (action === "invite") {
    if (!b.meeting_id || !b.service) return badRequest("meeting_id and service are required");
    if (!MDT_SERVICES.some(s => s.key === b.service)) return badRequest(`service must be one of: ${MDT_SERVICES.map(s => s.key).join(", ")}`);
    const gate = await meetingGate(admin, c, b.meeting_id);
    if (gate) return gate;
    const { data, error } = await admin.from("op_mdt_participants").insert({
      meeting_id: b.meeting_id, service: b.service, staff_id: b.staff_id ?? null,
      participant_name: String(b.participant_name ?? "").trim() || null,
      role_at_meeting: String(b.role_at_meeting ?? "").trim() || null,
      required: b.required !== false,
    }).select().single();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ participant: data }, { status: 201 });
  }

  if (action === "decide") {
    if (!b.meeting_id || !String(b.decision ?? "").trim()) return badRequest("meeting_id and decision are required");
    const gate = await meetingGate(admin, c, b.meeting_id);
    if (gate) return gate;
    const { data: m } = await admin.from("op_mdt_meetings").select("patient_id, hospital_id").eq("id", b.meeting_id).maybeSingle();
    const { data, error } = await admin.from("op_mdt_decisions").insert({
      meeting_id: b.meeting_id, patient_id: b.patient_id ?? m?.patient_id ?? null,
      category: b.category ?? "care_plan",
      decision: String(b.decision).trim(), rationale: String(b.rationale ?? "").trim() || null,
      decided_by: c.userId, decided_by_name: b.decided_by_name ?? null,
    }).select().single();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: c.userId, action: "mdt_decision", entity_type: "op_mdt_decision", entity_id: data.id,
      hospital_id: m?.hospital_id ?? null, new_value: { category: data.category, meeting_id: b.meeting_id },
    });
    return NextResponse.json({ decision: data }, { status: 201 });
  }

  if (action === "assign_action") {
    if (!b.meeting_id || !String(b.action_text ?? "").trim()) return badRequest("meeting_id and action_text are required");
    const gate = await meetingGate(admin, c, b.meeting_id);
    if (gate) return gate;
    const { data: m } = await admin.from("op_mdt_meetings").select("patient_id, hospital_id").eq("id", b.meeting_id).maybeSingle();
    const { data, error } = await admin.from("op_mdt_actions").insert({
      meeting_id: b.meeting_id, decision_id: b.decision_id ?? null,
      patient_id: b.patient_id ?? m?.patient_id ?? null,
      action: String(b.action_text).trim(), service: b.service ?? null,
      owner_id: b.owner_id ?? null, owner_name: String(b.owner_name ?? "").trim() || null,
      due_at: b.due_at ? new Date(b.due_at).toISOString() : null,
      priority: ["low", "normal", "high", "urgent"].includes(b.priority) ? b.priority : "normal",
      task_id: b.task_id ?? null,
    }).select().single();
    if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ mdtAction: data }, { status: 201 });
  }

  return badRequest("action must be one of: refer, schedule, invite, decide, assign_action");
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden("MDT coordination is for shift supervisors and managers");
  const admin = c.admin as any;
  const b = await req.json().catch(() => ({}));
  const action = String(b?.action ?? "");
  const now = new Date().toISOString();

  if (action === "attendance") {
    if (!b.participant_id || !b.attendance) return badRequest("participant_id and attendance are required");
    const valid = ["invited", "confirmed", "attended", "apologies", "absent", "delegated"];
    if (!valid.includes(b.attendance)) return badRequest(`attendance must be one of: ${valid.join(", ")}`);
    if (b.attendance === "delegated" && !String(b.delegated_to ?? "").trim()) return badRequest("delegated_to is required when delegating");
    const { data: p } = await admin.from("op_mdt_participants").select("meeting_id").eq("id", b.participant_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    const gate = await meetingGate(admin, c, p.meeting_id);
    if (gate) return gate;
    const { data, error } = await admin.from("op_mdt_participants").update({
      attendance: b.attendance, responded_at: now,
      delegated_to: b.attendance === "delegated" ? String(b.delegated_to).trim() : null,
    }).eq("id", b.participant_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ participant: data });
  }

  if (action === "sign_off") {
    if (!b.participant_id) return badRequest("participant_id is required");
    const { data: p } = await admin.from("op_mdt_participants").select("meeting_id, staff_id, attendance").eq("id", b.participant_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Participant not found" }, { status: 404 });
    const gate = await meetingGate(admin, c, p.meeting_id);
    if (gate) return gate;
    // A digital sign-off attests to what was agreed — only someone recorded as present can give one.
    if (!["attended", "delegated"].includes(p.attendance)) return badRequest("Only a participant recorded as present can sign off");
    if (p.staff_id && p.staff_id !== c.userId) return forbidden("A sign-off can only be given by the participant themselves");
    const { data, error } = await admin.from("op_mdt_participants")
      .update({ signed_off: true, signed_off_at: now }).eq("id", b.participant_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({
      actor_id: c.userId, action: "mdt_sign_off", entity_type: "op_mdt_participant", entity_id: b.participant_id,
      hospital_id: c.hospitalId ?? null, new_value: { meeting_id: p.meeting_id },
    });
    return NextResponse.json({ participant: data });
  }

  if (action === "meeting_status") {
    const valid = ["scheduled", "in_progress", "completed", "cancelled", "no_quorum"];
    if (!b.meeting_id || !valid.includes(b.status)) return badRequest(`meeting_id and status (${valid.join(", ")}) are required`);
    if (b.status === "cancelled" && !String(b.cancel_reason ?? "").trim()) return badRequest("cancel_reason is required when cancelling");
    const gate = await meetingGate(admin, c, b.meeting_id);
    if (gate) return gate;
    const patch: any = { status: b.status };
    if (b.status === "in_progress") patch.started_at = now;
    if (b.status === "completed") { patch.completed_at = now; patch.summary = String(b.summary ?? "").trim() || null; }
    if (b.status === "cancelled") patch.cancel_reason = String(b.cancel_reason).trim();
    const { data, error } = await admin.from("op_mdt_meetings").update(patch).eq("id", b.meeting_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // Completing the meeting closes the referrals it was convened for.
    if (b.status === "completed") {
      await admin.from("op_mdt_referrals").update({ status: "reviewed", reviewed_at: now })
        .eq("meeting_id", b.meeting_id).in("status", ["awaiting_review", "scheduled"]);
    }
    await admin.from("audit_log").insert({
      actor_id: c.userId, action: "mdt_meeting_status", entity_type: "op_mdt_meeting", entity_id: b.meeting_id,
      hospital_id: data.hospital_id ?? null, new_value: { status: b.status },
    });
    return NextResponse.json({ meeting: data });
  }

  if (action === "action_status") {
    const valid = ["open", "in_progress", "completed", "blocked", "cancelled", "escalated"];
    if (!b.action_id || !valid.includes(b.status)) return badRequest(`action_id and status (${valid.join(", ")}) are required`);
    const { data: a } = await admin.from("op_mdt_actions").select("meeting_id, status").eq("id", b.action_id).maybeSingle();
    if (!a) return NextResponse.json({ error: "Action not found" }, { status: 404 });
    const gate = await meetingGate(admin, c, a.meeting_id);
    if (gate) return gate;
    if (!OPEN_ACTION_STATUSES.includes(a.status) && a.status !== b.status) {
      return badRequest(`Action is ${a.status} — closed actions cannot be re-opened`);
    }
    const patch: any = { status: b.status, outcome_note: String(b.outcome_note ?? "").trim() || null };
    if (b.status === "completed") { patch.completed_at = now; patch.completed_by = c.userId; }
    if (b.status === "escalated") patch.escalated_at = now;
    const { data, error } = await admin.from("op_mdt_actions").update(patch).eq("id", b.action_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ mdtAction: data });
  }

  if (action === "referral_status") {
    const valid = ["awaiting_review", "scheduled", "reviewed", "deferred", "withdrawn"];
    if (!b.referral_id || !valid.includes(b.status)) return badRequest(`referral_id and status (${valid.join(", ")}) are required`);
    const { data: r } = await admin.from("op_mdt_referrals").select("hospital_id").eq("id", b.referral_id).maybeSingle();
    if (!r) return NextResponse.json({ error: "Referral not found" }, { status: 404 });
    if (!isSuper(c) && r.hospital_id !== c.hospitalId) return forbidden();
    const patch: any = { status: b.status, outcome_note: String(b.outcome_note ?? "").trim() || null };
    if (b.status === "reviewed") patch.reviewed_at = now;
    const { data, error } = await admin.from("op_mdt_referrals").update(patch).eq("id", b.referral_id).select().single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ referral: data });
  }

  return badRequest("action must be one of: attendance, sign_off, meeting_status, action_status, referral_status");
}

// Meeting exists + belongs to the caller's tenant. Returns a response to send, or null to proceed.
async function meetingGate(admin: any, c: any, meetingId: string): Promise<NextResponse | null> {
  const { data, error } = await admin.from("op_mdt_meetings").select("id, hospital_id").eq("id", meetingId).maybeSingle();
  if (error) return missing(error) ? notProvisioned() : NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return forbidden();
  return null;
}
