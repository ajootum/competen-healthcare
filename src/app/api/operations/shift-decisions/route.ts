import { NextResponse } from "next/server";
import { getCaller, isResponse, isSupervisor, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { DECISION_TYPES, DECISION_STATUSES } from "@/lib/operations/shift-records";

// Material operational decisions (SSW-002 §6.8 / §5.4 — accountable users record
// decisions). POST logs a decision; PATCH advances its status / records a review
// outcome. Supervisor tier, tenant-scoped, audit-logged; 409 hint until 066 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 066 to enable shift decisions" }, { status: 409 }) : null;
const clean = (v: any) => (typeof v === "string" && v.trim() ? v.trim() : null);

async function shiftInScope(c: any, shiftId: string) {
  const { data } = await c.admin.from("op_shifts").select("hospital_id").eq("id", shiftId).maybeSingle();
  if (!data) return { ok: false as const, res: NextResponse.json({ error: "Shift not found" }, { status: 404 }) };
  if (!isSuper(c) && data.hospital_id !== c.hospitalId) return { ok: false as const, res: forbidden("Shift out of scope") };
  return { ok: true as const, hospitalId: data.hospital_id };
}

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const shiftId = String(b.shift_id ?? "");
  if (!shiftId) return badRequest("shift_id required");
  if (!String(b.decision_summary ?? "").trim()) return badRequest("decision_summary required");
  const scope = await shiftInScope(c, shiftId);
  if (!scope.ok) return scope.res;
  const type = DECISION_TYPES.includes(b.decision_type) ? b.decision_type : "other";

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("shift_decisions").insert({
    shift_id: shiftId, hospital_id: scope.hospitalId ?? (isSuper(c) ? null : c.hospitalId ?? NONE),
    decision_type: type, decision_summary: String(b.decision_summary).trim(),
    decision_reason: clean(b.decision_reason), alternatives_considered: clean(b.alternatives_considered),
    decision_maker_user_id: c.userId, decision_maker_name: me?.full_name ?? null,
    authorised_by_name: clean(b.authorised_by_name), affected_entities: clean(b.affected_entities),
    expected_outcome: clean(b.expected_outcome),
  }).select("id, decision_type, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `shift_decision_${type}`, entity_type: "shift_decision", entity_id: data.id, entity_name: String(b.decision_summary).trim().slice(0, 80), hospital_id: scope.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSupervisor(c)) return forbidden();
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row, error: rowErr } = await c.admin.from("shift_decisions").select("id, hospital_id, decision_summary").eq("id", id).maybeSingle();
  if (rowErr) return migrationGate(rowErr) ?? NextResponse.json({ error: rowErr.message }, { status: 500 });
  if (!row) return NextResponse.json({ error: "Decision not found" }, { status: 404 });
  if (!isSuper(c) && row.hospital_id && row.hospital_id !== c.hospitalId) return forbidden("Out of scope");

  const b = await req.json().catch(() => ({}));
  const update: any = { updated_at: new Date().toISOString() };
  if (b.status !== undefined) { if (!DECISION_STATUSES.includes(b.status)) return badRequest("invalid status"); update.status = b.status; }
  if (b.review_outcome !== undefined) { update.review_outcome = clean(b.review_outcome); update.review_at = new Date().toISOString(); }
  if (Object.keys(update).length <= 1) return badRequest("no valid fields");

  const { data, error } = await c.admin.from("shift_decisions").update(update).eq("id", id).select("id, status").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, action: `shift_decision_${data.status}`, entity_type: "shift_decision", entity_id: data.id, entity_name: row.decision_summary?.slice(0, 80), hospital_id: row.hospital_id ?? null });
  return NextResponse.json(data);
}
