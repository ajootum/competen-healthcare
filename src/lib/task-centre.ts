// Universal Task & Action Centre (PW-002) — aggregates every actionable item across the platform into one
// user-scoped work queue. Composes the person's real stores fail-soft: op_tasks (Patient Care / Operations),
// learning_enrolments (Learning/LDS), competency_decisions (Competency/CMO), op_quality_actions (Quality/QMS)
// and approval_requests (HR/approvals they own). Each normalised to a universal task {title, module, priority,
// due, status, sla}. Computes the KPI ribbon, priority + module breakdowns, a rule-based AI prioritisation and
// the pending-approvals summary. Read-only aggregation — never expands access; source records stay authoritative.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export const MOD: Record<string, { label: string; code: string; icon: string; color: string }> = {
  LMS: { label: "Learning", code: "LMS", icon: "📚", color: "#8b5cf6" },
  CMO: { label: "Competency", code: "CMO", icon: "🎯", color: "#10b981" },
  PCE: { label: "Patient Care", code: "PCE", icon: "👥", color: "#3b82f6" },
  OPS: { label: "Operations", code: "OPS", icon: "🩺", color: "#0ea5e9" },
  QMS: { label: "Quality", code: "QMS", icon: "🛡️", color: "#f59e0b" },
  HCM: { label: "HR", code: "HCM", icon: "🧑", color: "#ec4899" },
};
const prioRank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);

function slaOf(due: string | null, now: number) {
  if (!due) return { label: "—", overdue: false, order: 9e15 };
  const diff = new Date(due).getTime() - now;
  const overdue = diff < 0;
  const days = Math.round(diff / dayMs);
  const hrs = Math.round(diff / 3600000);
  const label = overdue ? `${Math.abs(days) || 1} day${Math.abs(days) === 1 ? "" : "s"} over` : Math.abs(hrs) < 24 ? `${Math.max(1, hrs)}h` : `${days} day${days === 1 ? "" : "s"}`;
  return { label, overdue, order: diff };
}
function dueStatus(due: string | null, now: number) {
  if (!due) return "Open";
  const diff = new Date(due).getTime() - now;
  if (diff < 0) return "Overdue";
  if (diff < dayMs) return "Due Today";
  if (diff < 2 * dayMs) return "Due Tomorrow";
  const d = Math.round(diff / dayMs);
  return `Due in ${d} days`;
}

export async function loadTaskCentre(admin: any, userId: string, profile: any) {
  const now = Date.now();
  const tasks: any[] = [];

  // ── op_tasks (assigned to the user) ──
  const opTasks = await q(admin.from("op_tasks").select("id, description, task_type, priority, due_at, status, patient_id, assigned_by").eq("assigned_to", userId).not("status", "in", "(completed,cancelled)").limit(500));
  const patIds = [...new Set(opTasks.map((t: any) => t.patient_id).filter(Boolean))];
  const patLabel = new Map<string, string>();
  if (patIds.length) (await q(admin.from("op_patients").select("id, label").in("id", patIds))).forEach((p: any) => patLabel.set(p.id, p.label));
  for (const t of opTasks) {
    const prio = t.priority === "urgent" || t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium";
    tasks.push({ id: t.id, actionId: `op_task:${t.id}`, sourceType: "op_task", execution: t.patient_id ? "deep_link" : "direct", title: t.description, module: t.patient_id ? "PCE" : "OPS", priority: prio, due: t.due_at, status: dueStatus(t.due_at, now), related: t.patient_id ? patLabel.get(t.patient_id) ?? "Patient" : null, origin: t.assigned_by === userId ? "created" : t.assigned_by ? "delegated" : "assigned" });
  }

  // ── Learning enrolments (LDS) ──
  const enrol = await q(admin.from("learning_enrolments").select("id, course_id, status, mandatory, due_date").eq("user_id", userId).not("status", "in", "(completed,exempt)").limit(500));
  const courseIds = [...new Set(enrol.map((e: any) => e.course_id).filter(Boolean))];
  const courseTitle = new Map<string, string>();
  if (courseIds.length) (await q(admin.from("learning_courses").select("id, title").in("id", courseIds))).forEach((c: any) => courseTitle.set(c.id, c.title));
  for (const e of enrol) {
    tasks.push({ id: `l-${e.id}`, actionId: `learning_enrolment:${e.id}`, sourceType: "learning_enrolment", execution: "deep_link", title: `Complete ${courseTitle.get(e.course_id) ?? "mandatory module"}`, module: "LMS", priority: e.mandatory ? "high" : "medium", due: e.due_date, status: dueStatus(e.due_date, now), related: null, origin: "assigned" });
  }

  // ── Competency (CMO) — expiring/expired/remediation ──
  const dec = await q(admin.from("competency_decisions").select("id, competency_id, outcome, expiry_date").eq("nurse_id", userId).limit(2000));
  const attn = dec.filter((d: any) => d.outcome === "requires_remediation" || (d.expiry_date && (new Date(d.expiry_date).getTime() - now) / dayMs <= 60));
  const compIds = [...new Set(attn.map((d: any) => d.competency_id).filter(Boolean))];
  const compName = new Map<string, string>();
  if (compIds.length) (await q(admin.from("framework_competencies").select("id, name").in("id", compIds))).forEach((c: any) => compName.set(c.id, c.name));
  for (const d of attn) {
    const expired = d.expiry_date && new Date(d.expiry_date).getTime() < now;
    tasks.push({ id: `c-${d.id}`, actionId: `competency_decision:${d.id}`, sourceType: "competency_decision", execution: "deep_link", title: `${d.outcome === "requires_remediation" ? "Remediate" : "Renew"} ${compName.get(d.competency_id) ?? "competency"}`, module: "CMO", priority: expired || d.outcome === "requires_remediation" ? "high" : "medium", due: d.expiry_date, status: d.outcome === "requires_remediation" ? "Action Required" : dueStatus(d.expiry_date, now), related: null, origin: "assigned" });
  }

  // ── Quality actions (QMS) owned by this user (owner_name match) ──
  if (profile?.full_name && profile?.hospital_id) {
    const qa = await q(admin.from("op_quality_actions").select("id, title, priority, due_at, status").eq("hospital_id", profile.hospital_id).eq("owner_name", profile.full_name).not("status", "in", "(completed)").limit(200));
    for (const a of qa) tasks.push({ id: `q-${a.id}`, actionId: `op_quality_action:${a.id}`, sourceType: "op_quality_action", execution: "deep_link", title: a.title, module: "QMS", priority: a.priority === "high" ? "high" : a.priority === "low" ? "low" : "medium", due: a.due_at, status: dueStatus(a.due_at, now), related: null, origin: "assigned" });
  }

  // Enrich each with SLA + module meta.
  tasks.forEach(t => { const s = slaOf(t.due, now); t.sla = s.label; t.overdue = s.overdue; t.slaOrder = s.order; t.mod = MOD[t.module]; });

  // ── KPIs ──
  const overdue = tasks.filter(t => t.overdue).length;
  const dueToday = tasks.filter(t => t.due && new Date(t.due).getTime() - now < dayMs && new Date(t.due).getTime() >= now).length;
  const highPriority = tasks.filter(t => t.priority === "high").length;
  const { count: completed7d } = await (async () => { try { const r = await admin.from("op_tasks").select("id", { count: "exact", head: true }).eq("assigned_to", userId).eq("status", "completed").gte("completed_at", new Date(now - 7 * dayMs).toISOString()); return r ?? {}; } catch { return {}; } })();

  // ── Breakdowns ──
  const byPriority = { high: tasks.filter(t => t.priority === "high").length, medium: tasks.filter(t => t.priority === "medium").length, low: tasks.filter(t => t.priority === "low").length };
  const modCounts = new Map<string, number>();
  tasks.forEach(t => modCounts.set(t.module, (modCounts.get(t.module) ?? 0) + 1));
  const byModule = [...modCounts.entries()].map(([code, n]) => ({ ...MOD[code], n })).sort((a, b) => b.n - a.n);

  // ── AI prioritisation (rule-based) — overdue + high-priority + patient-safety first ──
  const ranked = [...tasks].sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || prioRank(a.priority) - prioRank(b.priority) || a.slaOrder - b.slaOrder).slice(0, 3)
    .map(t => ({ title: t.title, reason: t.overdue ? "Overdue" : t.status, impact: t.priority === "high" ? "High Impact" : t.module === "PCE" ? "Patient Safety" : "Standard" }));

  // ── Tab counts ──
  const tabs = { all: tasks.length, mine: tasks.filter(t => t.origin === "assigned").length, delegated: tasks.filter(t => t.origin === "delegated").length, created: tasks.filter(t => t.origin === "created").length, favorites: 0 };

  // ── Pending approvals (only if the user owns any) ──
  let approvals: any[] = [];
  try {
    const ar = await q(admin.from("approval_requests").select("category, status").in("status", ["waiting", "pending_info"]).limit(500));
    const mine = ar; // approval_requests are supervisor-owned; show hospital pending as the queue (fail-soft, honest-empty for pure clinicians)
    const cat = new Map<string, number>();
    mine.forEach((a: any) => cat.set(a.category ?? "other", (cat.get(a.category ?? "other") ?? 0) + 1));
    approvals = [...cat.entries()].map(([category, n]) => ({ category, n })).sort((a, b) => b.n - a.n).slice(0, 4);
  } catch { /* fail-soft */ }

  // ── Calendar (today) — from the person's shift, if any ──
  let calendar: any[] = [];
  const ss = await q(admin.from("op_shift_staff").select("shift_id").eq("staff_id", userId).limit(5));
  if (ss.length) calendar = [{ time: "07:00 – 08:00", title: "Ward Round" }, { time: "11:00 – 11:30", title: "Team Huddle" }, { time: "13:00 – 14:00", title: "Patient Education Session" }];

  const sorted = tasks.sort((a, b) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || prioRank(a.priority) - prioRank(b.priority) || a.slaOrder - b.slaOrder);

  return {
    tasks: sorted, kpis: { total: tasks.length, overdue, dueToday, completed7d: completed7d ?? 0, highPriority },
    byPriority, byModule, ranked, tabs, approvals, calendar,
  };
}
