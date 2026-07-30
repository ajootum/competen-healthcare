/* eslint-disable @typescript-eslint/no-explicit-any */
// CMO-006 — Competency Program Management. The office's program PORTFOLIO: each competency-building effort (a
// "program") is the set of its deployments in cmo_assignments (across every method — rule / campaign / manual).
// Per program it derives the deployment lifecycle (assigned → in_progress → completed / overdue), completion,
// overdue pressure and a health status; the portfolio rolls these into active / at-risk counts and a health
// distribution. Distinct from CMO-011 (campaign compliance) and CMO-007 (role coverage) — this is the delivery
// lifecycle across ALL assignment methods. Real over cmo_assignments (114). Hospital-scoped. No migration.

type Admin = any;
const NONE = "00000000-0000-0000-0000-000000000000";
const DONE = ["completed", "exempt"];
const scoped = (q: any, hid: string | null, isSuper: boolean) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
const health = (completion: number, overdue: number) => (overdue > 0 ? "At risk" : completion >= 80 ? "Healthy" : "Monitor");
const healthTone = (h: string) => ({ Healthy: "emerald", Monitor: "amber", "At risk": "rose" } as Record<string, string>)[h] ?? "slate";

const todayISO = () => new Date().toISOString().slice(0, 10);

export async function loadProgramManagement(admin: Admin, hid: string | null, isSuper: boolean) {
  const res = await scoped(admin.from("cmo_assignments").select("competency, target_label, method, status, due_date, created_at").limit(20000), hid, isSuper);
  if (res.error) return { provisioned: false as const };
  const rows = (res.data ?? []) as any[];
  if (!rows.length) return { provisioned: true as const, empty: true, kpis: emptyKpis(), programs: [], atRisk: [], healthDist: [] };

  const today = todayISO();
  const byComp = new Map<string, any[]>();
  for (const a of rows) { const k = a.competency ?? "—"; if (!byComp.has(k)) byComp.set(k, []); byComp.get(k)!.push(a); }

  const programs = [...byComp.entries()].map(([competency, asgs]) => {
    const total = asgs.length;
    const completed = asgs.filter(a => DONE.includes(a.status)).length;
    const inProgress = asgs.filter(a => a.status === "in_progress").length;
    const overdue = asgs.filter(a => a.status === "overdue" || (a.due_date && a.due_date < today && !DONE.includes(a.status))).length;
    const completion = total ? Math.round((completed / total) * 100) : 0;
    const targets = [...new Set(asgs.map(a => a.target_label).filter(Boolean))];
    const methods = [...new Set(asgs.map(a => a.method).filter(Boolean))];
    const due = asgs.map(a => a.due_date).filter(Boolean).sort()[0] ?? null;
    const h = health(completion, overdue);
    return { competency, deployments: total, completed, inProgress, overdue, completion, targets, methods, due, health: h, tone: healthTone(h) };
  }).sort((a, b) => (a.health === "At risk" ? -1 : b.health === "At risk" ? 1 : 0) || a.completion - b.completion);

  const active = programs.filter(p => p.completion < 100);
  const atRisk = programs.filter(p => p.health === "At risk");
  const healthDist = ["Healthy", "Monitor", "At risk"].map(h => ({ label: h, n: programs.filter(p => p.health === h).length })).filter(x => x.n > 0);
  const avgCompletion = programs.length ? Math.round(programs.reduce((a, p) => a + p.completion, 0) / programs.length) : 0;

  return {
    provisioned: true as const, empty: false,
    kpis: {
      programs: programs.length,
      active: active.length,
      atRisk: atRisk.length,
      avgCompletion,
      deployments: rows.length,
      overdue: programs.reduce((a, p) => a + p.overdue, 0),
    },
    programs: programs.slice(0, 60),
    atRisk: atRisk.slice(0, 8),
    healthDist,
  };
}

function emptyKpis() { return { programs: 0, active: 0, atRisk: 0, avgCompletion: 0, deployments: 0, overdue: 0 }; }
