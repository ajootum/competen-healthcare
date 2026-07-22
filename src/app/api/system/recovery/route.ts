import { NextResponse } from "next/server";
import { getCaller, isResponse, forbidden, badRequest, isAdmin, isStaff, assertRowScope } from "@/lib/api-auth";

// Data protection & recovery events (SYS-001.5). POST logs an event (DR test,
// restore request, backup verification, privacy request, retention review);
// PATCH advances it (recording a non-pending outcome forces status completed);
// GET lists tenant-scoped. Audit-logged; 409 migration hint until 063 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const KINDS = ["dr_test", "restore_request", "backup_verification", "privacy_request", "retention_review"];
const STATUSES = ["planned", "in_progress", "completed", "failed", "approved", "rejected"];
const OUTCOMES = ["pending", "passed", "partial", "failed"];

const intOrNull = (v: any) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.round(n) : null; };
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 063 to enable recovery event logging" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();

  const b = await req.json();
  if (!String(b.title ?? "").trim()) return badRequest("title required");
  const kind = KINDS.includes(b.kind) ? b.kind : "dr_test";
  if ((kind === "restore_request" || kind === "privacy_request") && !String(b.reason ?? "").trim()) {
    return badRequest("reason required for restore and privacy requests");
  }

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("sys_recovery_events").insert({
    kind, title: String(b.title).trim(), scope: b.scope || null,
    rpo_target_min: intOrNull(b.rpo_target_min), rto_target_min: intOrNull(b.rto_target_min),
    reason: b.reason || null,
    hospital_id: c.hospitalId,
    requested_by: c.userId, requested_by_name: me?.full_name ?? null,
  }).select().single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `recovery_${kind}`, entity_type: "recovery_event", entity_id: data.id, entity_name: data.title });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isAdmin(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const scopeErr = await assertRowScope(c, "sys_recovery_events", id);
  if (scopeErr) return scopeErr;

  const b = await req.json();
  const update: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.outcome !== undefined) {
    if (!OUTCOMES.includes(b.outcome)) return badRequest("invalid outcome");
    update.outcome = b.outcome;
    if (b.outcome !== "pending") { update.status = "completed"; update.completed_at = new Date().toISOString(); }
  }
  if (b.rpo_actual_min !== undefined) update.rpo_actual_min = intOrNull(b.rpo_actual_min);
  if (b.rto_actual_min !== undefined) update.rto_actual_min = intOrNull(b.rto_actual_min);
  if (b.outcome_note !== undefined) update.outcome_note = b.outcome_note || null;
  if (Object.keys(update).length <= 1) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("sys_recovery_events").update(update).eq("id", id).select("id, title, status, outcome").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `recovery_${data.status}`, entity_type: "recovery_event", entity_id: data.id, entity_name: data.title, new_value: { status: data.status, outcome: data.outcome } });
  return NextResponse.json(data);
}

export async function GET() {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  let q = c.admin.from("sys_recovery_events").select("*").order("created_at", { ascending: false }).limit(500);
  if (c.hospitalId) q = q.or(`hospital_id.eq.${c.hospitalId},hospital_id.is.null`);
  const { data, error } = await q;
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
