// PW-009 Personal AI Copilot — the data hub around the streaming chat: real AI-usage KPIs (plat_ai_requests,
// actor-scoped), rule-based AI insights + AI-prioritised tasks (real op_tasks / competency / learning signals),
// recommendations and recent AI activity. The conversation itself streams via the existing /api/copilot route.
// Read-only aggregation. Usage/accuracy are the user's REAL AI-gateway history (0 for someone who hasn't used it
// yet — honest); "time saved" has no basis and is not invented.
/* eslint-disable @typescript-eslint/no-explicit-any */
const dayMs = 86400000;
const q = async (p: Promise<any>) => { try { const r = await p; return r?.error ? [] : (r?.data ?? []); } catch { return []; } };
const prioRank = (p: string) => (p === "high" ? 0 : p === "medium" ? 1 : 2);

export async function loadCopilotHub(admin: any, userId: string) {
  const now = Date.now();
  const since30 = new Date(now - 30 * dayMs).toISOString();

  // ── Real AI-gateway usage (actor-scoped) ──
  const reqs = await q(admin.from("plat_ai_requests").select("operation, status, created_at").eq("actor_id", userId).order("created_at", { ascending: false }).limit(300));
  const reqs30 = reqs.filter((r: any) => r.created_at >= since30);
  const okCount = reqs.filter((r: any) => r.status === "ok").length;
  const accuracy = reqs.length ? Math.round((okCount / reqs.length) * 100) : null;
  const opCount = new Map<string, number>();
  reqs.forEach((r: any) => opCount.set(r.operation ?? "chat", (opCount.get(r.operation ?? "chat") ?? 0) + 1));
  const recentOps = reqs.slice(0, 5).map((r: any) => ({ op: (r.operation ?? "chat").replace(/_/g, " "), at: r.created_at }));

  // ── AI-prioritised tasks (real op_tasks, ranked) ──
  const opTasks = await q(admin.from("op_tasks").select("id, description, priority, due_at, patient_id").eq("assigned_to", userId).not("status", "in", "(completed,cancelled)").limit(100));
  const tasks = opTasks.map((t: any) => {
    const prio = t.priority === "urgent" || t.priority === "high" ? "high" : t.priority === "low" ? "low" : "medium";
    const overdue = !!(t.due_at && new Date(t.due_at).getTime() < now);
    return { id: t.id, title: t.description, priority: prio, overdue, due: t.due_at, order: t.due_at ? new Date(t.due_at).getTime() - now : 9e15 };
  }).sort((a: any, b: any) => (b.overdue ? 1 : 0) - (a.overdue ? 1 : 0) || prioRank(a.priority) - prioRank(b.priority) || a.order - b.order).slice(0, 5);

  // ── Real signals for insights ──
  const overdueTasks = tasks.filter((t: any) => t.overdue).length;
  const dec = await q(admin.from("competency_decisions").select("competency_id, outcome, expiry_date, framework_competencies(name)").eq("nurse_id", userId).limit(1000));
  const expiring = dec.filter((d: any) => d.expiry_date && (new Date(d.expiry_date).getTime() - now) / dayMs <= 30);
  const remediation = dec.filter((d: any) => d.outcome === "requires_remediation");
  const enrol = await q(admin.from("learning_enrolments").select("course_id, status, mandatory, due_date").eq("user_id", userId).not("status", "in", "(completed,exempt)").limit(200));
  const learningDue = enrol.filter((e: any) => e.mandatory);
  const activeLearning = enrol.length;

  // ── Insights (rule-based, real) ──
  const insights: any[] = [];
  if (remediation.length) insights.push({ icon: "🎓", tone: "violet", title: "Learning gap detected", body: `${remediation.length} competenc${remediation.length === 1 ? "y needs" : "ies need"} remediation. Consider targeted learning.` });
  if (expiring.length) insights.push({ icon: "🛡️", tone: "amber", title: "Credential expiry", body: `${expiring.length} competenc${expiring.length === 1 ? "y" : "ies"} expiring within 30 days — plan renewal.` });
  if (overdueTasks) insights.push({ icon: "❗", tone: "rose", title: "High-priority tasks", body: `You have ${overdueTasks} overdue task${overdueTasks === 1 ? "" : "s"} needing attention.` });
  if (learningDue.length) insights.push({ icon: "📚", tone: "blue", title: "Mandatory learning", body: `${learningDue.length} mandatory course${learningDue.length === 1 ? "" : "s"} pending completion.` });
  if (!insights.length) insights.push({ icon: "✅", tone: "emerald", title: "All clear", body: "No urgent competency, task or learning flags right now." });

  // ── Recommendations (real: mandatory learning + newest knowledge) ──
  const recommended: any[] = [];
  const recCids = [...new Set(learningDue.map((e: any) => e.course_id).filter(Boolean))].slice(0, 2);
  if (recCids.length) (await q(admin.from("learning_courses").select("id, title").in("id", recCids))).forEach((c: any) => recommended.push({ title: c.title, kind: "Continue Learning", href: "/dashboard/learning", cta: "Continue" }));
  (await q(admin.from("knowledge_objects").select("id, title").neq("status", "retired").order("created_at", { ascending: false }).limit(2))).forEach((k: any) => recommended.push({ title: k.title, kind: "Review Knowledge", href: "/dashboard/knowledge", cta: "Review" }));

  // ── Governed knowledge count (KPI) ──
  let knowledgeCount = 0;
  try { const r = await admin.from("knowledge_objects").select("id", { count: "exact", head: true }).neq("status", "retired"); knowledgeCount = r?.count ?? 0; } catch { /* fail-soft */ }

  return {
    kpis: { usage30: reqs30.length, queries: reqs.length, accuracy, prioritised: tasks.length, learning: activeLearning, knowledge: knowledgeCount },
    tasks, insights, recommended, recentOps, byOperation: [...opCount.entries()].map(([op, n]) => ({ op, n })).sort((a, b) => b.n - a.n),
    hasUsage: reqs.length > 0,
  };
}
