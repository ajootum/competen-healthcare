import { loadAnalytics, requireAnalyticsAccess, avgScoreOf } from "@/lib/analytics";
import { ModuleHeader, StatTiles, PctChip, Card } from "../ui";

// Department Reports module — cross-department comparison from live records.
// Departments are clinician specialisations (no separate org chart exists).

export const dynamic = "force-dynamic";

export default async function DepartmentReportsPage() {
  const { admin, hospitalId } = await requireAnalyticsAccess();
  const ctx = await loadAnalytics(admin, hospitalId);

  const now = new Date().toISOString();
  const d30 = new Date(new Date().getTime() - 30 * 86400000).toISOString();
  const deptOf = new Map(ctx.nurses.map(n => [n.id, n.dept]));

  type Row = { dep: string; nurses: number; pass: number; total: number; a30: { score: number }[]; overdue: number; validated: number; decided: number };
  const rows = new Map<string, Row>();
  const rowFor = (dep: string) => {
    const r = rows.get(dep) ?? { dep, nurses: 0, pass: 0, total: 0, a30: [], overdue: 0, validated: 0, decided: 0 };
    rows.set(dep, r);
    return r;
  };
  for (const n of ctx.nurses) rowFor(n.dept).nurses++;
  for (const d of ctx.latest) {
    const r = rowFor(deptOf.get(d.nurse_id) ?? "General");
    r.total++;
    if (d.passing && !d.expired) r.pass++;
    r.decided++;
    if (d.validated) r.validated++;
  }
  for (const a of ctx.assess.filter(x => x.assessed_at >= d30)) {
    rowFor(deptOf.get(a.nurse_id) ?? "General").a30.push({ score: a.score });
  }
  for (const s of ctx.sched) {
    if (s.status === "scheduled" && s.scheduled_for < now) {
      rowFor(deptOf.get(s.nurse_id) ?? "General").overdue++;
    }
  }

  const table = [...rows.values()].sort((a, b) => b.nurses - a.nurses);
  const passPct = (r: Row) => r.total ? Math.round(r.pass / r.total * 100) : null;
  const best = [...table].filter(r => passPct(r) != null).sort((a, b) => (passPct(b) ?? 0) - (passPct(a) ?? 0))[0];
  const totalOverdue = table.reduce((s, r) => s + r.overdue, 0);

  return (
    <div className="max-w-4xl">
      <ModuleHeader icon="🏥" title="Department Reports" sub="Department comparison, compliance and training priorities — departments are clinician specialisations." />
      <StatTiles tiles={[
        { label: "Departments", value: String(table.length) },
        { label: "Best Performing", value: best ? `${passPct(best)}%` : "—", sub: best?.dep ?? "no decision data" },
        { label: "Overdue Sessions", value: String(totalOverdue), alert: totalOverdue > 0 },
        { label: "Learners", value: String(ctx.nurses.length) },
      ]} />

      <Card title="Department Comparison">
        {table.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-[8px] text-gray-400 uppercase tracking-wider">
                  <th className="pb-1.5">Department</th><th className="pb-1.5 text-center">Learners</th>
                  <th className="pb-1.5 text-center">Pass rate</th><th className="pb-1.5 text-center">Avg score 30d</th>
                  <th className="pb-1.5 text-center">Assessments 30d</th><th className="pb-1.5 text-center">Validated</th>
                  <th className="pb-1.5 text-center">Overdue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {table.map(r => (
                  <tr key={r.dep}>
                    <td className="py-1.5 text-gray-700">{r.dep}</td>
                    <td className="py-1.5 text-center text-gray-600">{r.nurses}</td>
                    <td className="py-1.5 text-center"><PctChip v={passPct(r)} /></td>
                    <td className="py-1.5 text-center text-gray-600">{avgScoreOf(r.a30) ?? "—"}</td>
                    <td className="py-1.5 text-center text-gray-600">{r.a30.length}</td>
                    <td className="py-1.5 text-center"><PctChip v={r.decided ? Math.round(r.validated / r.decided * 100) : null} /></td>
                    <td className="py-1.5 text-center">{r.overdue ? <span className="font-bold text-red-600">{r.overdue}</span> : <span className="text-gray-300">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-gray-400">No learners on record.</p>}
      </Card>

      <div className="mt-4">
        <Card title="Training Priorities" sub="departments below 80% pass — derived, not predicted">
          {table.filter(r => passPct(r) != null && passPct(r)! < 80).length ? (
            <ul className="space-y-1 text-[11px] text-gray-600">
              {table.filter(r => passPct(r) != null && passPct(r)! < 80).map(r => (
                <li key={r.dep} className="flex gap-1.5">
                  <span>🎯</span>{r.dep}: {passPct(r)}% pass — plan focused assessment and educator time here.
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-gray-400">No department is below the 80% pass threshold. ✅</p>}
        </Card>
      </div>
    </div>
  );
}
