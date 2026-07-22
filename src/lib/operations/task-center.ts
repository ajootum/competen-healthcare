// Task Center (SSW-001) loader — the Shift Supervisor's operational execution
// hub over the live clinical-task domain (op_tasks). Tenant-scoped, fail-soft.
// The op_tasks lifecycle is created|assigned|accepted|in_progress|completed|
// verified|cancelled; the mockup's "Waiting"/"Blocked" and the "Declined"/
// "Reassigned" assignment states have no backing status, and there is no
// historical per-shift snapshot — those render as honest states rather than
// fabricated. Priority maps: urgent→Critical, high→High, normal→Medium, low→Low.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const DAY = 86400000;
const NOT_STARTED = new Set(["created", "assigned"]);
const IN_PROGRESS = new Set(["accepted", "in_progress"]);
const DONE = new Set(["completed", "verified"]);
const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

// task_type → operational category (keyword-bucketed; op_tasks.task_type is free text).
const CATEGORY_RULES: [RegExp, string][] = [
  [/medication|vital|observation|round|wound|assess|care|clinical|iv|dressing|drug|infusion/i, "Patient Care"],
  [/lab|sample|specimen|imaging|scan|pharmacy|equipment|supply|blood/i, "Clinical Support"],
  [/document|discharge|admin|report|handover|sign|audit|form/i, "Administrative"],
  [/transport|clean|catering|maintenance|porter|linen|meal/i, "Non-Clinical"],
];
const categorize = (t: string) => { for (const [re, label] of CATEGORY_RULES) if (re.test(t)) return label; return "Other"; };
const PRIO_LABEL: Record<string, string> = { urgent: "Critical", high: "High", normal: "Medium", low: "Low" };

export async function loadTaskCenter(admin: any, hid: string | null, isSuper: boolean) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const now = Date.now();
  const nowIso = new Date().toISOString();
  const soonIso = new Date(now + 2 * 3600 * 1000).toISOString();

  const [taskRes, unitRes, staffRes] = await Promise.all([
    scope(admin.from("op_tasks").select("id, task_type, description, priority, status, due_at, unit_id, assigned_to, created_at, completed_at, op_patients!patient_id(label), profiles!assigned_to(full_name)")).order("created_at", { ascending: false }).limit(3000),
    admin.from("units").select("id, name").limit(2000),
    scope(admin.from("profiles").select("id, full_name, role")).limit(2000),
  ]);

  const ready = !taskRes.error;
  const tasks = (ready ? taskRes.data ?? [] : []) as any[];
  const unitName = new Map<string, string>((unitRes.error ? [] : unitRes.data ?? []).map((u: any) => [u.id, u.name]));

  const open = tasks.filter(t => !DONE.has(t.status) && t.status !== "cancelled");
  const done = tasks.filter(t => DONE.has(t.status));
  const overdue = open.filter(t => t.due_at && t.due_at < nowIso);
  const critical = open.filter(t => t.priority === "urgent");
  const highPrio = open.filter(t => t.priority === "high");
  const awaitingAccept = tasks.filter(t => NOT_STARTED.has(t.status));

  // Avg completion time (minutes) from completed tasks with both timestamps.
  const completionMins = done.filter(t => t.completed_at && t.created_at).map(t => (new Date(t.completed_at).getTime() - new Date(t.created_at).getTime()) / 60000).filter(m => m >= 0);
  const avgCompletionMin = mean(completionMins);

  // ── Module 1: Dashboard ─────────────────────────────────────────────────────
  const byPriority = (["urgent", "high", "normal", "low"] as const).map(p => ({ key: p, label: PRIO_LABEL[p], n: tasks.filter(t => t.priority === p).length }));
  const unitCounts: Record<string, number> = {};
  for (const t of tasks) { const n = t.unit_id ? (unitName.get(t.unit_id) ?? "Unit") : "Unassigned"; unitCounts[n] = (unitCounts[n] ?? 0) + 1; }
  const byUnit = Object.entries(unitCounts).map(([unit, n]) => ({ unit, n })).sort((a, b) => b.n - a.n).slice(0, 8);

  // ── Module 2: Assignment & Coordination ─────────────────────────────────────
  const unassigned = tasks.filter(t => !t.assigned_to && t.status !== "cancelled" && !DONE.has(t.status));
  const assignmentStates = {
    unassigned: unassigned.length,
    assigned: tasks.filter(t => t.assigned_to && NOT_STARTED.has(t.status)).length,
    accepted: tasks.filter(t => IN_PROGRESS.has(t.status)).length,
    declined: null as number | null,   // no 'declined' status — honest
    reassigned: null as number | null,  // no assignment history — honest
  };
  const workloadMap = new Map<string, { name: string; n: number }>();
  for (const t of open) if (t.assigned_to) { const g = workloadMap.get(t.assigned_to) ?? { name: t.profiles?.full_name ?? "Staff", n: 0 }; g.n++; workloadMap.set(t.assigned_to, g); }
  const teamWorkload = [...workloadMap.values()].sort((a, b) => b.n - a.n).slice(0, 8);
  const maxLoad = Math.max(1, ...teamWorkload.map(w => w.n));
  // AI assignment recommendations: least-loaded staff for each unassigned task.
  const staff = (staffRes.error ? [] : staffRes.data ?? []) as any[];
  const loadById = new Map<string, number>([...workloadMap.entries()].map(([id, g]) => [id, g.n]));
  const clinicalStaff = staff.filter(s => ["assessor", "educator", "nurse", "hospital_admin"].includes(s.role) || (s.role ?? "").length);
  const leastLoaded = () => clinicalStaff.map(s => ({ s, load: loadById.get(s.id) ?? 0 })).sort((a, b) => a.load - b.load)[0]?.s ?? null;
  const recommendations = unassigned.slice(0, 3).map(t => { const s = leastLoaded(); return { task: t.description, bed: t.op_patients?.label ?? null, staff: s?.full_name ?? null, staffId: s?.id ?? null }; });

  // ── Module 3: Execution & Monitoring ────────────────────────────────────────
  const statusOverview = [
    { label: "Not Started", n: tasks.filter(t => NOT_STARTED.has(t.status)).length, tone: "text-gray-500" },
    { label: "In Progress", n: tasks.filter(t => IN_PROGRESS.has(t.status)).length, tone: "text-blue-600" },
    { label: "Completed", n: done.length, tone: "text-green-600" },
    { label: "Cancelled", n: tasks.filter(t => t.status === "cancelled").length, tone: "text-gray-400" },
  ];
  // SLA over tasks that carry a due_at.
  const withSla = tasks.filter(t => t.due_at);
  const slaBreached = withSla.filter(t => (DONE.has(t.status) ? t.completed_at && t.completed_at > t.due_at : t.due_at < nowIso)).length;
  const slaAtRisk = open.filter(t => t.due_at && t.due_at >= nowIso && t.due_at <= soonIso).length;
  const slaOnTrack = withSla.length - slaBreached;
  const slaCompliance = withSla.length ? Math.round((slaOnTrack / withSla.length) * 100) : null;
  const recentUpdates = tasks.slice(0, 6).map(t => ({ desc: t.description, status: t.status, assignee: t.profiles?.full_name, at: t.completed_at ?? t.created_at }));

  // ── Module 4: Escalations & Exceptions ──────────────────────────────────────
  const criticalDelays = overdue.filter(t => t.priority === "urgent").length;
  const escalatedTasks = overdue.slice().sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime()).slice(0, 6)
    .map(t => ({ desc: t.description, bed: t.op_patients?.label ?? null, overdueMin: Math.round((now - new Date(t.due_at).getTime()) / 60000), type: t.task_type }));
  const overdueByCategory: Record<string, number> = {};
  for (const t of overdue) { const cat = categorize(t.task_type ?? ""); overdueByCategory[cat] = (overdueByCategory[cat] ?? 0) + 1; }

  // ── Module 5: Intelligence & Performance ────────────────────────────────────
  const completionRate = tasks.length ? Math.round((done.length / tasks.length) * 100) : null;
  const tasksPerStaff = teamWorkload.length ? +(open.length / teamWorkload.length).toFixed(1) : null;
  const byCategory: Record<string, number> = {};
  for (const t of tasks) { const cat = categorize(t.task_type ?? ""); byCategory[cat] = (byCategory[cat] ?? 0) + 1; }
  const categories = Object.entries(byCategory).map(([label, n]) => ({ label, n, pct: Math.round((n / Math.max(1, tasks.length)) * 100) })).sort((a, b) => b.n - a.n);
  // Overdue trend — 7 days of tasks that became overdue (created & due in the day, not completed on time). Derived, honest label.
  const trend: { day: string; n: number }[] = [];
  const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  for (let i = 6; i >= 0; i--) {
    const t0 = midnight.getTime() - i * DAY, t1 = t0 + DAY;
    const n = tasks.filter(t => t.due_at && new Date(t.due_at).getTime() >= t0 && new Date(t.due_at).getTime() < t1 && (DONE.has(t.status) ? t.completed_at && t.completed_at > t.due_at : t.due_at < nowIso)).length;
    trend.push({ day: new Date(t0).toLocaleDateString([], { month: "short", day: "numeric" }), n });
  }
  const trendMax = Math.max(1, ...trend.map(t => t.n));
  // Bottlenecks: task_type of overdue tasks.
  const bottleneckMap: Record<string, number> = {};
  for (const t of overdue) { const key = t.task_type || "general"; bottleneckMap[key] = (bottleneckMap[key] ?? 0) + 1; }
  const bottlenecks = Object.entries(bottleneckMap).map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n).slice(0, 5);

  // Shift score = mean of completion rate, SLA compliance, inverse overdue load.
  const factors: number[] = [];
  if (completionRate != null) factors.push(completionRate);
  if (slaCompliance != null) factors.push(slaCompliance);
  factors.push(overdue.length === 0 ? 100 : Math.max(0, 100 - overdue.length * 8));
  const shiftScore = mean(factors);

  return {
    ready,
    kpis: {
      total: tasks.length, completed: done.length, completedPct: tasks.length ? Math.round((done.length / tasks.length) * 100) : null,
      overdue: overdue.length, critical: critical.length, highPriority: highPrio.length,
      awaitingAccept: awaitingAccept.length, escalated: overdue.length, avgCompletionMin,
    },
    byPriority, byUnit,
    assignment: { states: assignmentStates, unassigned: unassigned.slice(0, 6).map(t => ({ id: t.id, desc: t.description, bed: t.op_patients?.label ?? null, priority: t.priority, unit: t.unit_id ? (unitName.get(t.unit_id) ?? "Unit") : null })), teamWorkload, maxLoad, recommendations },
    execution: { statusOverview, statusTotal: tasks.length, sla: { compliance: slaCompliance, onTrack: slaOnTrack, atRisk: slaAtRisk, breached: slaBreached, total: withSla.length }, recentUpdates },
    escalations: { overdue: overdue.length, criticalDelays, escalatedTasks, byCategory: overdueByCategory },
    intelligence: { completionRate, avgCompletionMin, tasksPerStaff, overdue: overdue.length, slaCompliance, shiftScore, categories, trend, trendMax, bottlenecks },
    pickers: {
      staff: staff.slice(0, 500).map(s => ({ id: s.id, label: `${s.full_name ?? s.id}${s.role ? ` (${s.role})` : ""}` })),
      openTasks: open.slice(0, 300).map(t => ({ id: t.id, label: `${t.description?.slice(0, 60)} (${t.status})`, status: t.status })),
    },
    generatedAt: new Date().toISOString(),
  };
}
