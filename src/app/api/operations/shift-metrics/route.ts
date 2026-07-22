import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadShiftCommand } from "@/lib/operations/shift-command";
import { computeShiftMetrics } from "@/lib/operations/shift-metrics";

// Persisted shift metrics (SSW-002 §19). POST computes the shift's KPIs
// server-side (the engine derives them from live op_* data) and upserts one row
// per shift, enabling cross-shift trend analytics. Supervisor tier, tenant-scoped,
// audit-logged; 409 until 068 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 068 to enable persisted shift metrics" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();

  const sc: any = await loadShiftCommand(c.admin, c.hospitalId ?? null, isSuper(c));
  const m = await computeShiftMetrics(c.admin, sc, c.hospitalId ?? null, isSuper(c));
  if (!m.ready) return badRequest("no active shift to compute metrics for");

  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("shift_metrics").upsert({
    shift_id: m.shiftId, hospital_id: c.hospitalId ?? null, ...m.kpis, metrics: m.kpis,
    computed_by: c.userId, computed_by_name: me?.full_name ?? null, updated_at: new Date().toISOString(),
  }, { onConflict: "shift_id" }).select("id, overall_score").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: "compute_shift_metrics", entity_type: "shift_metrics", entity_id: data.id, hospital_id: c.hospitalId ?? null, new_value: { overall_score: data.overall_score } });
  return NextResponse.json(data, { status: 201 });
}
