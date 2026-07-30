import { cmoGuard, Head, Card, Kpi, Pill, Progress, Donut, Foot } from "../_cmo-ui";
import { loadProgramManagement } from "@/lib/competency/program-management";

// CMO-006 — Competency Program Management. The office's program portfolio: each competency-building program's
// deployment lifecycle, completion and health, over cmo_assignments. Hospital-scoped.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const compTone = (n: number) => (n >= 80 ? "text-emerald-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const HEALTH_COLOR: Record<string, string> = { Healthy: "#10b981", Monitor: "#f59e0b", "At risk": "#f43f5e" };

export default async function ProgramManagementPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await loadProgramManagement(admin, hid, isSuper) as any;

  const head = <Head code="CMO-006 · Program Management" title="Competency Program Management" sub="Design, launch, monitor and improve competency programs across the organisation — deployment lifecycle and program health." />;
  if (!d.provisioned) {
    return <div className="space-y-4">{head}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="text-sm text-amber-800">Programs aren&apos;t provisioned — apply migration <code className="font-mono">114</code> (<code className="font-mono">cmo_assignments</code>).</p></div></div>;
  }
  if (d.empty) {
    return <div className="space-y-4">{head}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="text-sm text-gray-400">No competency programs deployed yet. Once competencies are assigned (rules / campaigns / manual), the program portfolio populates here.</p></div></div>;
  }

  const k = d.kpis;
  return (
    <div className="space-y-4 max-w-[1400px]">
      {head}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Programs" value={k.programs} sub={`${k.active} active`} tone="text-teal-600" />
        <Kpi label="Deployments" value={k.deployments} sub="assignments" />
        <Kpi label="Avg completion" value={`${k.avgCompletion}%`} sub="across programs" tone={compTone(k.avgCompletion)} />
        <Kpi label="At-risk programs" value={k.atRisk} sub="overdue / stalled" tone={k.atRisk ? "text-rose-600" : "text-gray-900"} />
        <Kpi label="Overdue deployments" value={k.overdue} sub="past due date" tone={k.overdue ? "text-amber-600" : "text-gray-900"} />
        <Kpi label="Healthy" value={d.healthDist.find((h: any) => h.label === "Healthy")?.n ?? 0} sub="≥80% complete" tone="text-emerald-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Program portfolio" className="lg:col-span-2" right={<span className="text-[11px] text-gray-400">{d.programs.length} programs · at-risk first</span>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium">Program (competency)</th><th className="py-2 px-3 font-medium">Target</th><th className="py-2 px-3 font-medium text-right">Deploys</th><th className="py-2 px-3 font-medium w-36">Completion</th><th className="py-2 pl-3 font-medium">Health</th></tr></thead>
              <tbody className="divide-y divide-gray-50">
                {d.programs.map((p: any, i: number) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 text-gray-800 font-medium truncate max-w-[220px]" title={p.competency}>{p.competency}</td>
                    <td className="py-2 px-3 text-gray-500 truncate max-w-[120px]">{p.targets[0] ?? "—"}{p.targets.length > 1 ? ` +${p.targets.length - 1}` : ""}</td>
                    <td className="py-2 px-3 text-gray-500 tabular-nums text-right">{p.deployments}{p.overdue ? <span className="text-rose-500"> ({p.overdue})</span> : ""}</td>
                    <td className="py-2 px-3"><div className="flex items-center gap-2"><div className="flex-1"><Progress pct={p.completion} /></div><span className={`text-[11px] font-semibold tabular-nums w-9 text-right ${compTone(p.completion)}`}>{p.completion}%</span></div></td>
                    <td className="py-2 pl-3"><Pill text={p.health} tone={p.tone} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <div className="space-y-4">
          <Card title="Program health">
            <div className="flex items-center gap-3">
              <Donut segs={d.healthDist.map((h: any) => ({ n: h.n, color: HEALTH_COLOR[h.label] }))} total={k.programs} centre={k.programs} sub="programs" />
              <div className="space-y-1.5 flex-1 text-[12px]">
                {d.healthDist.map((h: any) => (
                  <div key={h.label} className="flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: HEALTH_COLOR[h.label] }} /><span className="text-gray-600 flex-1">{h.label}</span><span className="font-semibold text-gray-900 tabular-nums">{h.n}</span></div>
                ))}
              </div>
            </div>
          </Card>
          <Card title="At-risk programs" right={<span className="text-[11px] text-gray-400">{d.atRisk.length}</span>}>
            {d.atRisk.length === 0 ? <p className="text-sm text-gray-400 py-3 text-center">No programs at risk. 🎯</p> : (
              <div className="space-y-2">
                {d.atRisk.map((p: any, i: number) => (
                  <div key={i} className="flex items-center gap-2"><span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" /><span className="text-[13px] text-gray-800 flex-1 truncate">{p.competency}</span><span className="text-[10px] text-rose-500">{p.overdue} overdue</span></div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Foot>CMO-006 — a program is a competency-building effort viewed through its deployments in cmo_assignments (all methods: rule / campaign / manual); completion and health are derived live from deployment status. Distinct from Campaigns (compliance vs cohort) and Workforce Mapping (role coverage). A first-class program object with concept→design→approve lifecycle stages + owners + ROI needs a program store — next phase.</Foot>
    </div>
  );
}
