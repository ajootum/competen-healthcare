// Shared core fetch + helpers for the UMW-OPC Operational Command modules (OPC-002..011). One parallel read of the
// live operational stores (op_beds / op_patients / op_shifts+op_shift_staff / op_escalations / op_safety_alerts /
// op_tasks / op_flow_blockers / op_equipment / op_resources / op_ops_snapshots / op_movement_events), fail-soft per
// table, returned raw for each module loader to shape into its lens. Read-only manager view; live execution stays in
// the SSW. Every module is a different projection over this same real data — no duplicated fetch logic.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
export const nowMs = () => Date.now();
export const dayMs = 86400000;

// op_patients.acuity_level (stable|moderate|high|critical) → severity band.
export function acuityBand(a: any): "high" | "medium" | "low" | "stable" {
  const s = String(a ?? "").toLowerCase();
  if (/high|critical/.test(s)) return "high";
  if (/mod/.test(s)) return "medium";
  if (/low/.test(s)) return "low";
  return "stable";
}
export const sev = (s: any): "high" | "medium" | "low" => {
  const t = String(s ?? "").toLowerCase();
  if (/high|critical|emergency/.test(t)) return "high";
  if (/med|urgent|moderate/.test(t)) return "medium";
  return "low";
};

const soft = (p: any) => p.then((r: any) => r, () => ({ data: [], error: null }));

export type OpsCore = Awaited<ReturnType<typeof fetchOpsCore>>;

export async function fetchOpsCore(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const dept = (q: any) => (deptId ? q.eq("department_id", deptId) : q);
  const since7 = new Date(nowMs() - 7 * dayMs).toISOString();
  const today = new Date(nowMs()).toISOString().slice(0, 10);
  const startToday = new Date(new Date(nowMs()).toISOString().slice(0, 10) + "T00:00:00Z").toISOString();

  const [bedRes, patRes, shiftRes, escRes, safRes, taskRes, blkRes, eqRes, resRes, snapRes, moveRes] = await Promise.all([
    soft(dept(scope(admin.from("op_beds").select("id, label, status, bed_type, department_id"))).limit(500)),
    soft(dept(scope(admin.from("op_patients").select("id, label, acuity_level, risk_level, dependency_level, isolation_status, operational_status, bed_id, department_id, created_at"))).limit(1000)),
    soft(scope(admin.from("op_shifts").select("id, shift_type, status, shift_date, department_id")).gte("shift_date", new Date(nowMs() - dayMs).toISOString().slice(0, 10)).limit(50)),
    soft(scope(admin.from("op_escalations").select("id, summary, severity, level, status, escalation_type, response_deadline, created_at, resolved_at")).gte("created_at", since7).order("created_at", { ascending: false }).limit(60)),
    soft(scope(admin.from("op_safety_alerts").select("id, category, severity, note, active, created_at, resolved_at")).gte("created_at", since7).order("created_at", { ascending: false }).limit(100)),
    soft(scope(admin.from("op_tasks").select("id, description, task_type, priority, status, due_at, assigned_to, created_at, completed_at")).gte("created_at", since7).limit(1000)),
    soft(scope(admin.from("op_flow_blockers").select("id, category, detail, status, created_at")).eq("status", "open").limit(100)),
    soft(scope(admin.from("op_equipment").select("id, name, category, status")).limit(200)),
    soft(scope(admin.from("op_resources").select("id, name, category, total, available, demand")).limit(50)),
    soft(scope(admin.from("op_ops_snapshots").select("*")).order("period", { ascending: true }).limit(120)),
    soft(scope(admin.from("op_movement_events").select("id, event_type, detail, created_at")).gte("created_at", startToday).order("created_at", { ascending: false }).limit(30)),
  ]);

  if (bedRes.error && missing(bedRes.error)) return { provisioned: false as const };

  const beds = (bedRes.data ?? []) as any[];
  const patients = (patRes.data ?? []) as any[];
  const shifts = (shiftRes.data ?? []) as any[];
  const escalations = (escRes.data ?? []) as any[];
  const safety = (safRes.data ?? []) as any[];
  const tasks = (taskRes.data ?? []) as any[];
  const blockers = (blkRes.data ?? []) as any[];
  const equipment = (eqRes.data ?? []) as any[];
  const resources = (resRes.data ?? []) as any[];
  const snaps = (snapRes.data ?? []) as any[];
  const movements = (moveRes.data ?? []) as any[];

  // Staff on duty today via op_shift_staff → today's shift ids (op_shift_staff has NO hospital_id — must be
  // constrained through the shift ids, never wrapped in the hospital scope()).
  const todayShiftIds = shifts.filter(s => s.shift_date === today || s.status === "active").map(s => s.id);
  const anyShiftIds = shifts.map(s => s.id);
  const staffIds = (todayShiftIds.length ? todayShiftIds : anyShiftIds);
  let staff: any[] = [];
  if (staffIds.length) staff = ((await soft(admin.from("op_shift_staff").select("staff_id, role, status, shift_id").in("shift_id", staffIds))).data ?? []);

  const daily = snaps.filter(s => s.period_type === "day");
  const cur = daily[daily.length - 1] ?? {};
  const prev = daily[daily.length - 2] ?? {};

  return {
    provisioned: true as const,
    beds, patients, shifts, staff, escalations, safety, tasks, blockers, equipment, resources, snaps, daily, movements,
    cur, prev,
    hasData: beds.length + patients.length > 0,
  };
}

// vs-yesterday delta from two daily-snapshot values — returns null when either is missing (never fabricated).
export function delta(curV: any, prevV: any): { txt: string; up: boolean } | null {
  if (curV == null || prevV == null || prevV === 0) return null;
  const d = Math.round(((curV - prevV) / Math.abs(prevV)) * 100);
  if (!isFinite(d) || d === 0) return null;
  return { txt: `${Math.abs(d)}% vs yesterday`, up: d > 0 };
}
