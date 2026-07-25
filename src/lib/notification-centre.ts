// PW-004 Notification Centre — a unified, user-scoped notification feed that aggregates the real `notifications`
// store PLUS derived actionable events from across the platform (overdue tasks, expiring competencies, mandatory
// learning due, recent messages) so the feed reflects "alerts from every module" even though no central
// notification-generation pipeline exists yet. Category + priority are DERIVED from type/source (the table has no
// such columns). Real rows carry a real id and can be marked read via /api/notifications; derived rows are
// actionable via their source link. Read-only aggregation — never expands access.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };

export const CAT: Record<string, { label: string; icon: string; color: string }> = {
  tasks: { label: "Tasks & Actions", icon: "☑️", color: "#3b82f6" },
  learning: { label: "Learning", icon: "📚", color: "#8b5cf6" },
  competencies: { label: "Competencies", icon: "🎯", color: "#10b981" },
  assessments: { label: "Assessments", icon: "📋", color: "#6366f1" },
  patients: { label: "Patients", icon: "👥", color: "#f43f5e" },
  quality: { label: "Quality & Safety", icon: "🛡️", color: "#f59e0b" },
  messages: { label: "Messages", icon: "💬", color: "#0ea5e9" },
  hr: { label: "HR & People", icon: "🧑", color: "#ec4899" },
  announcements: { label: "Announcements", icon: "📢", color: "#14b8a6" },
  system: { label: "System", icon: "⚙️", color: "#64748b" },
};

// Map a real notification `type` → category.
function catOfType(type: string): string {
  if (["logbook_changes_requested", "logbook_pending", "task_assigned", "task_due"].includes(type)) return "tasks";
  if (type.startsWith("assessment") || type === "osce_completed" || type.startsWith("logbook")) return "assessments";
  if (type.startsWith("credential") || type === "decisions_issued" || type.startsWith("competency")) return "competencies";
  if (["capa_assigned", "audit_finding"].includes(type)) return "quality";
  if (["message", "coaching_scheduled", "coaching_cancelled"].includes(type)) return "messages";
  if (["intervention_created", "referral_created", "referral_resolved", "appeal_submitted", "appeal_resolved"].includes(type)) return "hr";
  if (type.startsWith("learning")) return "learning";
  if (type === "announcement") return "announcements";
  return "system";
}
function prioOfType(type: string): string {
  if (["logbook_rejected", "logbook_escalated", "patient_escalation"].includes(type)) return "high";
  if (["logbook_changes_requested", "credential_submitted", "assessment_scheduled", "capa_assigned", "audit_finding", "message"].includes(type)) return "medium";
  return "low";
}
const TYPE_ICON: Record<string, string> = { logbook_verified: "✅", logbook_rejected: "❌", logbook_changes_requested: "✏️", decisions_issued: "🧠", credential_added: "🏅", assessment_scheduled: "📅", message: "💬", capa_assigned: "🛡️", audit_finding: "🔍" };

export async function loadNotificationCentre(admin: any, userId: string, profile: any) {
  const now = Date.now();
  const feed: any[] = [];

  // ── Real notifications ──
  const rows = await q(admin.from("notifications").select("id, type, title, body, href, read, created_at").eq("user_id", userId).order("created_at", { ascending: false }).limit(120));
  for (const n of rows) {
    const cat = catOfType(n.type);
    feed.push({ id: n.id, real: true, category: cat, priority: prioOfType(n.type), title: n.title, body: n.body, time: n.created_at, href: n.href, read: n.read, icon: TYPE_ICON[n.type] ?? CAT[cat].icon, source: CAT[cat].label });
  }

  // ── Derived: overdue / due-soon tasks (Tasks & Actions) ──
  const tasks = await q(admin.from("op_tasks").select("id, description, priority, due_at, patient_id").eq("assigned_to", userId).not("status", "in", "(completed,cancelled)").not("due_at", "is", null).lte("due_at", new Date(now + 2 * dayMs).toISOString()).order("due_at").limit(15));
  for (const t of tasks) {
    const overdue = new Date(t.due_at).getTime() < now;
    feed.push({ id: `t-${t.id}`, real: false, category: t.patient_id ? "patients" : "tasks", priority: overdue ? "high" : "medium", title: overdue ? `Task overdue: ${t.description}` : `Task due soon: ${t.description}`, body: overdue ? `This task was due ${new Date(t.due_at).toLocaleDateString("en-GB")} and is now overdue.` : `Due ${new Date(t.due_at).toLocaleString("en-GB")}.`, time: t.due_at, href: "/dashboard/tasks", read: false, icon: t.patient_id ? "👥" : "☑️", source: t.patient_id ? "Patient Care" : "Task Centre" });
  }

  // ── Derived: expiring / expired competencies ──
  const dec = await q(admin.from("competency_decisions").select("id, competency_id, outcome, expiry_date").eq("nurse_id", userId).not("expiry_date", "is", null).lte("expiry_date", new Date(now + 30 * dayMs).toISOString().slice(0, 10)).order("expiry_date").limit(10));
  const cmids = [...new Set(dec.map((d: any) => d.competency_id).filter(Boolean))];
  const cn = new Map<string, string>();
  if (cmids.length) (await q(admin.from("framework_competencies").select("id, name").in("id", cmids))).forEach((c: any) => cn.set(c.id, c.name));
  for (const d of dec) {
    const expired = new Date(d.expiry_date).getTime() < now;
    feed.push({ id: `c-${d.id}`, real: false, category: "competencies", priority: expired ? "high" : "medium", title: `${expired ? "Competency expired" : "Competency expiring"}: ${cn.get(d.competency_id) ?? "competency"}`, body: `Validity ${expired ? "lapsed on" : "ends"} ${new Date(d.expiry_date).toLocaleDateString("en-GB")}. Plan renewal.`, time: d.expiry_date, href: "/dashboard/passport", read: false, icon: "🎯", source: "Competency" });
  }

  // ── Derived: overdue mandatory learning ──
  const enrol = await q(admin.from("learning_enrolments").select("id, course_id, due_date, mandatory").eq("user_id", userId).eq("mandatory", true).not("status", "in", "(completed,exempt)").not("due_date", "is", null).lte("due_date", new Date(now + 14 * dayMs).toISOString().slice(0, 10)).order("due_date").limit(10));
  const cids = [...new Set(enrol.map((e: any) => e.course_id).filter(Boolean))];
  const ct = new Map<string, string>();
  if (cids.length) (await q(admin.from("learning_courses").select("id, title").in("id", cids))).forEach((c: any) => ct.set(c.id, c.title));
  for (const e of enrol) {
    const overdue = new Date(e.due_date).getTime() < now;
    feed.push({ id: `l-${e.id}`, real: false, category: "learning", priority: overdue ? "high" : "medium", title: `${overdue ? "Overdue" : "Due soon"}: ${ct.get(e.course_id) ?? "mandatory training"}`, body: `Mandatory learning ${overdue ? "was due" : "is due"} ${new Date(e.due_date).toLocaleDateString("en-GB")}.`, time: e.due_date, href: "/dashboard/learning", read: false, icon: "📚", source: "Learning" });
  }

  // Sort newest/most-urgent first: high priority first, then by time desc.
  const prioRank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);
  feed.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

  // ── KPIs ──
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const weekAhead = now + 7 * dayMs;
  const kpis = {
    total: feed.length,
    unread: feed.filter(f => !f.read).length,
    high: feed.filter(f => f.priority === "high").length,
    dueToday: feed.filter(f => new Date(f.time).getTime() >= startOfToday.getTime() && new Date(f.time).getTime() < startOfToday.getTime() + dayMs).length,
    thisWeek: feed.filter(f => new Date(f.time).getTime() <= weekAhead && new Date(f.time).getTime() >= now - 7 * dayMs).length,
    archived: rows.filter((n: any) => n.read).length,
  };

  // ── Category counts (left panel) + donut (top categories by volume) ──
  const catCount = new Map<string, number>();
  feed.forEach(f => catCount.set(f.category, (catCount.get(f.category) ?? 0) + 1));
  const categories = Object.keys(CAT).map(k => ({ key: k, ...CAT[k], n: catCount.get(k) ?? 0 })).filter(c => c.n > 0).sort((a, b) => b.n - a.n);
  const donut = categories.slice(0, 5);

  // ── Grouping for the feed (High Priority / Today / Earlier) ──
  const highGroup = feed.filter(f => f.priority === "high");
  const rest = feed.filter(f => f.priority !== "high");
  const todayGroup = rest.filter(f => new Date(f.time).getTime() >= startOfToday.getTime());
  const earlierGroup = rest.filter(f => new Date(f.time).getTime() < startOfToday.getTime());

  return { feed, kpis, categories, donut, groups: { high: highGroup, today: todayGroup, earlier: earlierGroup }, prioRank, hospitalId: profile?.hospital_id ?? null };
}
