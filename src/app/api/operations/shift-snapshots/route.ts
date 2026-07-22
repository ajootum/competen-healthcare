import { NextResponse } from "next/server";
import { getCaller, isResponse, isStaff, isSuper, forbidden, badRequest } from "@/lib/api-auth";
import { loadShiftCommand } from "@/lib/operations/shift-command";
import { SNAPSHOT_KINDS } from "@/lib/operations/shift-closure";

// Shift snapshots (SSW-002 §18). POST captures an immutable point-in-time snapshot
// of the caller's active shift — the engine computes the metrics server-side from
// live op_* data. Supervisor tier, tenant-scoped, audit-logged; 409 until 067 runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const migrationGate = (e: any) =>
  /does not exist|schema cache/i.test(String(e?.message ?? "")) ? NextResponse.json({ error: "Run migration 067 to enable shift snapshots" }, { status: 409 }) : null;

export async function POST(req: Request) {
  const c = await getCaller();
  if (isResponse(c)) return c;
  if (!isStaff(c)) return forbidden();
  const b = await req.json().catch(() => ({}));
  const kind = SNAPSHOT_KINDS.includes(b.kind) ? b.kind : "closure";

  // Compute the snapshot from live data for the caller's active shift.
  const sc: any = await loadShiftCommand(c.admin, c.hospitalId ?? null, isSuper(c));
  if (!sc.ready || !sc.shiftId) return badRequest("no active shift to snapshot");

  const now = Date.now();
  const o = sc.overview;
  const openTasks = sc.tasks.length;
  const overdueTasks = sc.tasks.filter((t: any) => t.due_at && new Date(t.due_at).getTime() < now).length;
  const doneRes = await c.admin.from("op_tasks").select("id", { count: "exact", head: true })
    .eq("hospital_id", c.hospitalId ?? "00000000-0000-0000-0000-000000000000").in("status", ["completed", "verified"]);
  const completedTasks = doneRes.error ? null : (doneRes.count ?? 0);

  const metrics = {
    occPct: o.occPct, handoverStatus: o.handoverStatus, handoverPct: o.handoverPct,
    admissionsPending: o.admissionsPending, transfers: o.transfers, discharges: o.discharges,
    ratioCompliance: sc.ratioCompliance,
  };
  const { data: me } = await c.admin.from("profiles").select("full_name").eq("id", c.userId).single();
  const { data, error } = await c.admin.from("shift_snapshots").insert({
    shift_id: sc.shiftId, hospital_id: c.hospitalId ?? null, kind,
    census: sc.patientBoard.length, occupied_beds: o.occupied, total_beds: o.totalBeds,
    present_staff: o.present, rostered_staff: o.rostered,
    open_alerts: o.incidents, active_escalations: o.escalations,
    open_tasks: openTasks, overdue_tasks: overdueTasks, completed_tasks: completedTasks,
    high_risk_patients: o.critical, metrics,
    captured_by: c.userId, captured_by_name: me?.full_name ?? null,
  }).select("id, kind, captured_at").single();
  if (error) return migrationGate(error) ?? NextResponse.json({ error: error.message }, { status: 500 });

  await c.admin.from("audit_log").insert({ actor_id: c.userId, actor_name: me?.full_name ?? null, action: `snapshot_${kind}`, entity_type: "shift_snapshot", entity_id: data.id, hospital_id: c.hospitalId ?? null });
  return NextResponse.json(data, { status: 201 });
}
