// Task Centre loader (HWW-WARD-001 S4.7 / HWW-TSK-001) — the nurse's own task
// lens over op_tasks. Clock-derived fields (overdue, day window) are computed
// here so pages stay render-pure.
/* eslint-disable @typescript-eslint/no-explicit-any */

const RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1, low: 0 };

export async function loadMyTaskCentre(admin: any, userId: string, now = Date.now()) {
  const dayBack = new Date(now - 24 * 3.6e6).toISOString();
  const [openRes, doneRes] = await Promise.all([
    admin.from("op_tasks").select("*, op_patients!patient_id(label)")
      .eq("assigned_to", userId).not("status", "in", "(completed,verified,cancelled)")
      .order("due_at", { ascending: true }).limit(200),
    admin.from("op_tasks").select("*, op_patients!patient_id(label)")
      .eq("assigned_to", userId).in("status", ["completed", "verified"]).gte("completed_at", dayBack)
      .order("completed_at", { ascending: false }).limit(50),
  ]);
  const open = (openRes.data ?? [])
    .map((t: any) => ({ ...t, past_due: !!(t.due_at && +new Date(t.due_at) < now) }))
    .sort((a: any, b: any) => (RANK[b.priority] ?? 1) - (RANK[a.priority] ?? 1) || +new Date(a.due_at ?? 8.64e15) - +new Date(b.due_at ?? 8.64e15));
  const done = doneRes.data ?? [];
  return {
    open,
    done,
    overdue: open.filter((t: any) => t.past_due).length,
    urgent: open.filter((t: any) => t.priority === "urgent").length,
    wardRound: open.filter((t: any) => t.task_type === "ward_round_action").length,
  };
}
