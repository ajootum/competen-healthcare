// Approvals Workspace (UMW-EA-001) loader. Reads the real approval_requests store
// (migration 077) — KPIs, the smart queue, category counts, the selected review
// panel, AI risk monitor and recently-completed decisions. Empty-safe: no rows →
// honest empty states (the store populates as requests are submitted; nothing is
// fabricated). Tenant-scoped; fail-soft pre-migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
export const APPROVAL_CATEGORIES = ["personnel", "staffing", "clinical", "competency", "education", "equipment", "policy", "finance", "operations", "it", "governance"];
const cap = (s?: string) => (s ? s[0].toUpperCase() + s.slice(1) : "—");
const PRANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const OPEN_STATUS = ["waiting", "pending_info", "returned", "delegated", "escalated"];

export async function loadApprovals(admin: any, hid: string | null, isSuper: boolean, dept?: string, selectedId?: string) {
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const probe = await admin.from("approval_requests").select("id").limit(1);
  if (probe.error && /does not exist|schema cache/i.test(probe.error.message ?? "")) return { provisioned: false as const };

  let q = scope(admin.from("approval_requests").select("*, profiles!requester_id(full_name)").order("submitted_at", { ascending: false }).limit(500));
  if (dept) q = q.eq("department_id", dept);
  const { data } = await q;
  const rows = (data ?? []).map((r: any) => ({ ...r, requester: r.requester_name ?? r.profiles?.full_name ?? "—" }));

  const now = new Date(); const nowIso = now.toISOString(); const today = nowIso.slice(0, 10);
  const open = rows.filter((r: any) => OPEN_STATUS.includes(r.status));
  const decided = rows.filter((r: any) => ["approved", "rejected"].includes(r.status));
  const overdue = open.filter((r: any) => r.due_at && r.due_at < nowIso);
  const waitHrs = open.map((r: any) => (now.getTime() - new Date(r.submitted_at).getTime()) / 3600000);

  const kpis = {
    pending: open.length,
    dueToday: open.filter((r: any) => r.due_at && r.due_at.slice(0, 10) === today).length,
    highPriority: open.filter((r: any) => ["critical", "high"].includes(r.priority)).length,
    overdue: overdue.length,
    avgWaitingHrs: waitHrs.length ? Math.round(waitHrs.reduce((a: number, b: number) => a + b, 0) / waitHrs.length) : null,
    completedToday: decided.filter((r: any) => r.decided_at && r.decided_at.slice(0, 10) === today).length,
    health: open.length ? Math.max(0, Math.round(100 - (overdue.length / open.length) * 40 - (open.filter((r: any) => ["critical", "high"].includes(r.priority)).length / open.length) * 20)) : 100,
  };

  const queue = [...open].sort((a: any, b: any) => (PRANK[a.priority] - PRANK[b.priority]) || (a.due_at && b.due_at ? (a.due_at < b.due_at ? -1 : 1) : 0));
  const categories = APPROVAL_CATEGORIES.map(c => ({ key: c, label: cap(c), n: open.filter((r: any) => r.category === c).length }));
  const archived = decided.length;

  const selected = (selectedId ? rows.find((r: any) => r.id === selectedId) : null) ?? queue[0] ?? null;
  const recentlyCompleted = [...decided].sort((a: any, b: any) => ((b.decided_at ?? "") > (a.decided_at ?? "") ? 1 : -1)).slice(0, 6);

  // AI risk monitor — rule-based over the live store.
  const aiRisk: { tone: string; title: string; sub: string; n?: number }[] = [];
  const staffingReqs = open.filter((r: any) => ["staffing", "personnel"].includes(r.category)).length;
  if (staffingReqs) aiRisk.push({ tone: "amber", title: "Elevated staffing/overtime requests", sub: "Review coverage pattern", n: staffingReqs });
  if (overdue.length) aiRisk.push({ tone: "red", title: "Overdue approvals", sub: "Action required", n: overdue.length });
  const compReqs = open.filter((r: any) => r.category === "competency").length;
  if (compReqs) aiRisk.push({ tone: "blue", title: "Competency validations pending", sub: "May block roster readiness", n: compReqs });
  const finReqs = open.filter((r: any) => r.category === "finance").length;
  if (finReqs) aiRisk.push({ tone: "blue", title: "Finance/procurement approvals", sub: "Budget threshold review", n: finReqs });

  return { provisioned: true as const, total: rows.length, kpis, queue, categories, archived, selected, recentlyCompleted, aiRisk };
}
