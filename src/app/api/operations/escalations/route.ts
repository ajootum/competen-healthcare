import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest, assertProfileScope } from "@/lib/api-auth";
import { notify } from "@/lib/notify";

// Operational Escalations (COE Escalation domain — 5 levels).
/* eslint-disable @typescript-eslint/no-explicit-any */

const SEV_BY_LEVEL = ["routine", "routine", "urgent", "high", "emergency", "critical"];

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const admin = c.admin as any;
  let q = admin.from("op_escalations")
    .select("*, op_patients!patient_id(label), profiles!raised_by(full_name)")
    .neq("status", "resolved").neq("status", "cancelled").order("level", { ascending: false }).order("created_at", { ascending: false }).limit(200);
  if (!isSuper(c)) q = q.eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000");
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ escalations: data ?? [] });
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  // Any authenticated clinician may RAISE an escalation (frontline safety);
  // managing the queue (GET/PATCH) stays coordinator-only.
  const b = await req.json().catch(() => ({}));
  if (!b.summary?.trim()) return badRequest("summary required");
  const level = Number(b.level);
  if (!Number.isInteger(level) || level < 1 || level > 5) return badRequest("level must be 1–5");
  const admin = c.admin as any;
  const hospitalId = isSuper(c) ? (b.hospital_id ?? c.hospitalId) : c.hospitalId;
  if (b.patient_id) {
    const { data: p } = await admin.from("op_patients").select("hospital_id").eq("id", b.patient_id).maybeSingle();
    if (!p) return NextResponse.json({ error: "Patient not found" }, { status: 404 });
    if (!isSuper(c) && p.hospital_id !== c.hospitalId) return forbidden("Patient out of scope");
  }
  // A named responder must be in the caller's hospital (we notify them below).
  if (b.assigned_responder) {
    const scope = await assertProfileScope(c, b.assigned_responder);
    if (scope) return scope;
  }

  const deadline = new Date();
  deadline.setMinutes(deadline.getMinutes() + (level >= 4 ? 15 : level === 3 ? 60 : 240));
  const { data, error } = await admin.from("op_escalations").insert({
    hospital_id: hospitalId, unit_id: b.unit_id ?? null, patient_id: b.patient_id ?? null, shift_id: b.shift_id ?? null,
    escalation_type: b.escalation_type || "clinical", level, severity: SEV_BY_LEVEL[level],
    summary: b.summary.trim(), raised_by: c.userId, assigned_responder: b.assigned_responder ?? null,
    response_deadline: deadline.toISOString(), status: "open",
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await admin.from("audit_log").insert({ actor_id: c.userId, action: "raise_escalation", entity_type: "op_escalation", entity_id: data.id, hospital_id: hospitalId, new_value: { level, type: b.escalation_type } });
  if (b.assigned_responder) await notify([b.assigned_responder], { type: "op_escalation", title: `Escalation (Level ${level})`, body: b.summary.trim(), href: "/admin/operations" });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: row } = await admin.from("op_escalations").select("hospital_id").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const b = await req.json().catch(() => ({}));

  // Escalations Workspace decision actions (UMW-EA-002) — audited. Backward-compatible:
  // the legacy { status } path below still works for the supervisor console.
  if (b.action) {
    const upd: any = {};
    if (b.action === "acknowledge") upd.status = "acknowledged";
    else if (b.action === "assign") upd.assigned_responder = b.assign_to ?? c.userId;
    else if (b.action === "escalate") {
      const { data: cur } = await admin.from("op_escalations").select("level").eq("id", id).maybeSingle();
      const lvl = Math.min(5, (cur?.level ?? 1) + 1);
      upd.level = lvl; upd.severity = SEV_BY_LEVEL[lvl];
      const dl = new Date(); dl.setMinutes(dl.getMinutes() + (lvl >= 4 ? 15 : lvl === 3 ? 60 : 240)); upd.response_deadline = dl.toISOString();
    } else if (b.action === "resolve" || b.action === "close") {
      upd.status = "resolved"; upd.resolution = b.resolution?.trim() || null; upd.resolved_at = new Date().toISOString();
    } else return badRequest("unknown action");
    const { data, error } = await admin.from("op_escalations").update(upd).eq("id", id).select().maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: `escalation_${b.action}`, entity_type: "op_escalation", entity_id: id, hospital_id: row.hospital_id, new_value: upd });
    return NextResponse.json(data ?? { ok: true });
  }

  if (!["acknowledged", "resolved", "cancelled"].includes(b.status)) return badRequest("valid status required");
  const update: any = { status: b.status };
  if (b.status === "resolved") { update.resolution = b.resolution?.trim() || null; update.resolved_at = new Date().toISOString(); }
  const { data, error } = await admin.from("op_escalations").update(update).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
