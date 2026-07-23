import { NextResponse } from "next/server";
import { getCaller, isResponse, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { gatherRosterInputs, computeRoster, mondayOf } from "@/lib/operations/roster-solver";

// AI Scheduling Engine roster API (WSE-001B) over op_rosters / op_roster_assignments.
// POST generates a draft roster by running the greedy solver over real establishment
// demand + available staff (persists roster + per-slot assignments, audited). PATCH
// publishes (blocked below safe coverage unless an override reason is recorded, per
// business rules) or archives. DELETE removes a draft. Unit-Manager tier (hospital_admin
// / super_admin). 409 hint until migration 080 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const SAFE_COVERAGE = 80;
const isManager = (c: any) => isSuper(c) || (c.roles ?? []).includes("hospital_admin");
const migrationGate = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 080 to enable roster generation" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isManager(c)) return forbidden("Unit Manager access required");
  const b = await req.json().catch(() => ({}));
  const weekStart = /^\d{4}-\d{2}-\d{2}$/.test(b.week_start) ? b.week_start : mondayOf();
  const admin = c.admin as any;

  const inputs = await gatherRosterInputs(admin, c.hospitalId ?? null, isSuper(c));
  if (!inputs || inputs.units.length === 0) return NextResponse.json({ error: "No establishment demand / staff pool to schedule" }, { status: 422 });
  const plan = computeRoster(inputs.units, inputs.pool, inputs.validSet, weekStart, inputs.deptIdByName);

  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();
  // Replace any prior draft for this week
  try { await admin.from("op_rosters").delete().eq("hospital_id", c.hospitalId ?? NONE).eq("week_start", weekStart).eq("status", "draft"); } catch { /* fail-soft */ }

  const { data: roster, error } = await admin.from("op_rosters").insert({
    hospital_id: c.hospitalId ?? (isSuper(c) ? null : NONE), week_start: weekStart, status: "draft",
    coverage_score: plan.scores.coverage, competency_score: plan.scores.competency, fairness_score: plan.scores.fairness,
    est_cost: plan.scores.estCost, slots_total: plan.slotsTotal, slots_filled: plan.slotsFilled,
    generated_by: c.userId, generated_by_name: me?.full_name ?? null,
  }).select("id").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  const rows = plan.assignments.map((a: any) => ({ ...a, roster_id: roster.id, hospital_id: c.hospitalId ?? null }));
  // Insert in chunks to stay well within limits
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e2 } = await admin.from("op_roster_assignments").insert(rows.slice(i, i + 500));
    if (e2) return migrationGate(e2) ?? NextResponse.json({ error: e2.message }, { status: 500 });
  }

  await admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "generate_roster", entity_type: "op_roster", entity_id: roster.id, entity_name: `Week ${weekStart}`, hospital_id: c.hospitalId ?? null, new_value: { coverage: plan.scores.coverage, filled: plan.slotsFilled, total: plan.slotsTotal } });
  return NextResponse.json({ id: roster.id, week_start: weekStart, ...plan.scores, slots_total: plan.slotsTotal, slots_filled: plan.slotsFilled }, { status: 201 });
}

export async function PATCH(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isManager(c)) return forbidden("Unit Manager access required");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const b = await req.json().catch(() => ({}));
  const admin = c.admin as any;
  const { data: roster } = await admin.from("op_rosters").select("hospital_id, coverage_score, status").eq("id", id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Roster not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  const { data: me } = await admin.from("profiles").select("full_name").eq("id", c.userId).single();

  if (b.action === "publish") {
    if ((roster.coverage_score ?? 0) < SAFE_COVERAGE && !String(b.override_reason ?? "").trim()) {
      return NextResponse.json({ error: `Coverage ${roster.coverage_score ?? 0}% is below the safe threshold (${SAFE_COVERAGE}%). Provide override_reason to publish.`, requires_override: true }, { status: 422 });
    }
    const { error } = await admin.from("op_rosters").update({ status: "published", published_by: c.userId, published_by_name: me?.full_name ?? null, published_at: new Date().toISOString(), notes: b.override_reason?.trim() || null }).eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "publish_roster", entity_type: "op_roster", entity_id: id, hospital_id: roster.hospital_id ?? null, new_value: { override: !!b.override_reason } });
    return NextResponse.json({ ok: true, status: "published" });
  }
  if (b.action === "archive") {
    await admin.from("op_rosters").update({ status: "archived" }).eq("id", id);
    await admin.from("audit_log").insert({ actor_id: c.userId, action: "archive_roster", entity_type: "op_roster", entity_id: id, hospital_id: roster.hospital_id ?? null });
    return NextResponse.json({ ok: true, status: "archived" });
  }
  return badRequest("unknown action");
}

export async function DELETE(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isManager(c)) return forbidden("Unit Manager access required");
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return badRequest("id required");
  const admin = c.admin as any;
  const { data: roster } = await admin.from("op_rosters").select("hospital_id, status").eq("id", id).maybeSingle();
  if (!roster) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isSuper(c) && roster.hospital_id !== c.hospitalId) return forbidden("Out of scope");
  if (roster.status === "published") return forbidden("Cannot delete a published roster — archive it instead");
  const { error } = await admin.from("op_rosters").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
