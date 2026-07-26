// UMW-OPC-007 Operational Action Manager loader. The live action/task picture over op_tasks (+ profiles for owner
// names). Computes the KPI ribbon, the status donut (created→verified lifecycle), priority breakdown, actions by
// type, upcoming deadlines, the open worklist with per-item progress, owner workload with overdue counts, a 7-day
// created/completed trend and rule-based recommendations. Read-only manager lens; execution stays in the SSW.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchOpsCore, pct, nowMs } from "./ops-shared";

const PROGRESS: Record<string, number> = { created: 0, assigned: 20, accepted: 40, in_progress: 65, completed: 90, verified: 100, cancelled: 0 };
const PRIO_TONE: Record<string, string> = { urgent: "#f43f5e", high: "#f59e0b", normal: "#eab308", low: "#22c55e" };
const titleCase = (s: string) => String(s ?? "general").replace(/_/g, " ").replace(/\b\w/g, m => m.toUpperCase());

export async function loadActionCommand(admin: any, hid: string | null, isSuper: boolean, deptId: string | null) {
  const c = await fetchOpsCore(admin, hid, isSuper, deptId);
  if (!c.provisioned) return { provisioned: false as const };
  const { tasks } = c;
  const now = nowMs();
  const startToday = new Date(new Date(now).toISOString().slice(0, 10) + "T00:00:00Z").toISOString();

  // Owner names.
  const ownerIds = [...new Set(tasks.map(t => t.assigned_to).filter(Boolean))];
  const profRes = ownerIds.length ? await admin.from("profiles").select("id, full_name").in("id", ownerIds).then((r: any) => r, () => ({ data: [] })) : { data: [] };
  const nameById = new Map<string, string>((profRes.data ?? []).map((p: any) => [p.id, p.full_name]));

  const open = tasks.filter(t => !["completed", "verified", "cancelled"].includes(t.status));
  const overdue = open.filter(t => t.due_at && new Date(t.due_at).getTime() < now);
  const dueToday = open.filter(t => t.due_at && new Date(t.due_at).getTime() >= now && new Date(t.due_at).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10));
  const completedToday = tasks.filter(t => ["completed", "verified"].includes(t.status) && t.completed_at && t.completed_at >= startToday);
  const onTrack = open.length - overdue.length;

  const kpis = {
    total: tasks.length, open: open.length, overdue: overdue.length, dueToday: dueToday.length,
    completedToday: completedToday.length,
    onTrackPct: open.length ? pct(onTrack, open.length) : 100,
    atRiskPct: open.length ? pct(overdue.length, open.length) : 0,
    critical: open.filter(t => t.priority === "urgent").length,
  };

  // Status donut (lifecycle).
  const st = (s: string[]) => tasks.filter(t => s.includes(t.status)).length;
  const overview = [
    { label: "Not Started", n: st(["created"]), color: "#94a3b8" },
    { label: "In Progress", n: st(["assigned", "accepted", "in_progress"]), color: "#3b82f6" },
    { label: "Pending Review", n: st(["completed"]), color: "#f59e0b" },
    { label: "Completed", n: st(["verified"]), color: "#22c55e" },
    { label: "Cancelled", n: st(["cancelled"]), color: "#64748b" },
  ];

  // Priority breakdown (open).
  const pr = (p: string) => open.filter(t => t.priority === p).length;
  const priority = [
    { label: "Critical", n: pr("urgent"), color: PRIO_TONE.urgent },
    { label: "High", n: pr("high"), color: PRIO_TONE.high },
    { label: "Medium", n: pr("normal"), color: PRIO_TONE.normal },
    { label: "Low", n: pr("low"), color: PRIO_TONE.low },
  ];

  // By type (task_type).
  const byType = Object.entries(open.reduce((acc: Record<string, number>, t) => { const k = t.task_type ?? "general"; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {})).map(([k, n]) => ({ label: titleCase(k), n, pct: pct(n as number, open.length || 1) })).sort((a, b) => b.n - a.n).slice(0, 6);

  // Upcoming deadlines (next 24h).
  const deadlines = open.filter(t => t.due_at).sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()).slice(0, 6).map(t => ({ desc: t.description, due: t.due_at, priority: t.priority, owner: nameById.get(t.assigned_to) ?? "Unassigned", overdue: new Date(t.due_at).getTime() < now }));

  // Open worklist.
  const worklist = [...open].sort((a, b) => (b.priority === "urgent" ? 1 : 0) - (a.priority === "urgent" ? 1 : 0)).slice(0, 8).map(t => ({ desc: t.description, type: titleCase(t.task_type ?? "general"), priority: t.priority, status: t.status.replace(/_/g, " "), owner: nameById.get(t.assigned_to) ?? "—", due: t.due_at, overdue: t.due_at && new Date(t.due_at).getTime() < now, progress: PROGRESS[t.status] ?? 0 }));

  // Owner workload.
  const byOwner = new Map<string, { open: number; overdue: number }>();
  open.forEach(t => { const id = t.assigned_to ?? "unassigned"; const v = byOwner.get(id) ?? { open: 0, overdue: 0 }; v.open++; if (t.due_at && new Date(t.due_at).getTime() < now) v.overdue++; byOwner.set(id, v); });
  const ownerWorkload = [...byOwner.entries()].map(([id, v]) => ({ name: id === "unassigned" ? "Unassigned" : (nameById.get(id) ?? "Staff"), ...v })).sort((a, b) => b.open - a.open).slice(0, 6);

  // 7-day trend.
  const days: Record<string, { created: number; completed: number }> = {};
  for (let i = 6; i >= 0; i--) days[new Date(now - i * 86400000).toISOString().slice(0, 10)] = { created: 0, completed: 0 };
  tasks.forEach(t => { const cd = String(t.created_at).slice(0, 10); if (cd in days) days[cd].created++; if (t.completed_at) { const dd = String(t.completed_at).slice(0, 10); if (dd in days) days[dd].completed++; } });
  const trend = Object.entries(days).map(([d, v]) => ({ d: d.slice(5), ...v }));

  // Recommendations.
  const recs: string[] = [];
  if (overdue.length) recs.push(`${overdue.length} action${overdue.length === 1 ? "" : "s"} overdue — reprioritise or escalate.`);
  if (kpis.critical) recs.push(`${kpis.critical} critical action${kpis.critical === 1 ? "" : "s"} open — assign an owner and deadline.`);
  const unassigned = open.filter(t => !t.assigned_to).length;
  if (unassigned) recs.push(`${unassigned} action${unassigned === 1 ? "" : "s"} unassigned — allocate to an owner.`);
  if (!recs.length) recs.push("Action backlog healthy — all open items on track.");

  return { provisioned: true as const, hasData: tasks.length > 0, kpis, overview, priority, byType, deadlines, worklist, ownerWorkload, trend, recs, asOf: c.cur.period ?? null };
}
