import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { ACCOUNT_STATUSES, EMPLOYMENT_TYPES, ASSIGNABLE_ROLES, rolesOf } from "@/lib/enterprise/people";

// People module (ENT-001 §5) — edit a person: position, employment, account
// status, line manager and role assignments. Super_admin only. Role changes are
// restricted to ASSIGNABLE_ROLES (never grants super_admin from here).
/* eslint-disable @typescript-eslint/no-explicit-any */

const clean = (v: any, max = 120) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isSuper(c)) return forbidden();
  const admin = c.admin as any;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const { data: row } = await admin.from("profiles").select("id, full_name, role, roles").eq("id", id).maybeSingle();
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = await req.json().catch(() => ({}));

  // Role add/remove (restricted set; keeps roles[] the source of truth).
  if (b.action === "add_role" || b.action === "remove_role") {
    if (!ASSIGNABLE_ROLES.includes(b.role)) return badRequest("role not assignable");
    const current = new Set(rolesOf(row));
    if (b.action === "add_role") current.add(b.role);
    else { if (current.size <= 1) return badRequest("a person must keep at least one role"); current.delete(b.role); }
    const roles = [...current];
    const { error } = await admin.from("profiles").update({ roles, role: roles[0] }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, action: b.action, entity_type: "profile", entity_id: id, entity_name: row.full_name });
    return NextResponse.json({ ok: true, roles });
  }

  const update: any = {};
  if (b.account_status !== undefined) { if (!ACCOUNT_STATUSES.includes(b.account_status)) return badRequest("invalid account status"); update.account_status = b.account_status; }
  if (b.employment_type !== undefined) update.employment_type = EMPLOYMENT_TYPES.includes(b.employment_type) ? b.employment_type : null;
  if (b.staff_number !== undefined) update.staff_number = clean(b.staff_number, 40);
  if (b.position_id !== undefined) {
    if (b.position_id === null || b.position_id === "") update.position_id = null;
    else { const { data: pos } = await admin.from("positions").select("id").eq("id", b.position_id).maybeSingle(); if (!pos) return badRequest("Position not found"); update.position_id = b.position_id; }
  }
  if (b.line_manager_id !== undefined) {
    if (b.line_manager_id === null || b.line_manager_id === "") update.line_manager_id = null;
    else { if (b.line_manager_id === id) return badRequest("a person cannot manage themselves"); const { data: m } = await admin.from("profiles").select("id").eq("id", b.line_manager_id).maybeSingle(); if (!m) return badRequest("Line manager not found"); update.line_manager_id = b.line_manager_id; }
  }
  if (!Object.keys(update).length) return badRequest("no valid fields");

  const { data, error } = await admin.from("profiles").update(update).eq("id", id).select("id, full_name, account_status").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const act = update.account_status ? `person_${update.account_status}` : "update_person";
  await admin.from("audit_log").insert({ actor_id: c.userId, action: act, entity_type: "profile", entity_id: id, entity_name: data.full_name });
  return NextResponse.json(data);
}
