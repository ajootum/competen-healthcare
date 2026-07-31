import { fetchCmoSuite, daysLeft, STATUS_TONE } from "@/lib/competency/cmo-suite";
import { cmoGuard, Head, Card, Kpi, Donut, Bars, Pill, Provision, Foot } from "../_cmo-ui";

export const dynamic = "force-dynamic";

// CMO-010 Competency Assignment Centre — assign, track and govern competency requirements across roles/teams/units.
/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS_COLORS: Record<string, string> = { assigned: "#3b82f6", in_progress: "#f59e0b", completed: "#22c55e", overdue: "#ef4444", exempt: "#94a3b8" };
const fmtD = (t: string | null) => { if (!t) return "—"; try { return new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); } catch { return "—"; } };

export default async function AssignmentsPage() {
  const { admin, isSuper, hid } = await cmoGuard();
  const d = await fetchCmoSuite(admin, hid, isSuper);
  const head = <Head code="CMO-010 · Competency Office" title="Competency Assignment Centre" sub="Assign, track and govern competency requirements for individuals, roles, teams, departments and the enterprise — rule-based and campaign-driven." />;
  if (!d.provisioned) return <div className="max-w-[1400px] space-y-4">{head}<Provision module="the Assignment Centre" part="part 1" /></div>;

  const asg = d.assignments.map((a: any) => ({ ...a, dueIn: daysLeft(a.due_date) }));
  const STATUSES = ["assigned", "in_progress", "completed", "overdue", "exempt"];
  const byStatus = STATUSES.map(s => ({ status: s, n: asg.filter((a: any) => a.status === s).length })).filter(x => x.n > 0);
  const byMethod = ["role_based", "campaign", "rule", "manual"].map(m => ({ label: m.replace(/_/g, " "), n: asg.filter((a: any) => a.method === m).length })).filter(x => x.n > 0);
  const byTarget = ["individual", "role", "team", "department", "enterprise"].map(t => ({ label: t, n: asg.filter((a: any) => a.target_type === t).length })).filter(x => x.n > 0);
  const overdue = asg.filter((a: any) => a.status === "overdue");

  return (
    <div className="max-w-[1400px] space-y-4">
      {head}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Assignments" value={asg.length} sub="active" />
        <Kpi label="In Progress" value={asg.filter((a: any) => a.status === "in_progress").length} sub="underway" tone="text-[var(--cmp-text-warning)]" />
        <Kpi label="Completed" value={asg.filter((a: any) => a.status === "completed").length} sub="attained" tone="text-[var(--cmp-text-success)]" />
        <Kpi label="Overdue" value={overdue.length} sub="past due" tone={overdue.length ? "text-[var(--cmp-text-error)]" : undefined} />
        <Kpi label="Completion" value={`${asg.length ? Math.round((asg.filter((a: any) => a.status === "completed").length / asg.length) * 100) : 0}%`} sub="rate" />
        <Kpi label="Campaigns" value={new Set(asg.map((a: any) => a.campaign).filter(Boolean)).size} sub="active" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="By Status">
          <div className="flex items-center gap-3">
            <Donut segs={byStatus.map(s => ({ n: s.n, color: STATUS_COLORS[s.status] }))} total={asg.length} centre={asg.length} sub="assignments" size={100} />
            <div className="flex-1 space-y-1 text-[11px]">{byStatus.map(s => <div key={s.status} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: STATUS_COLORS[s.status] }} /><span className="text-gray-600 flex-1 capitalize">{s.status.replace(/_/g, " ")}</span><span className="font-semibold text-gray-900">{s.n}</span></div>)}</div>
          </div>
        </Card>
        <Card title="By Assignment Method"><Bars rows={byMethod} /></Card>
        <Card title="By Target"><Bars rows={byTarget} /></Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card title="Overdue Assignments" right={<span className="text-[11px] text-gray-400">{overdue.length}</span>}>
          {overdue.length ? <div className="space-y-1.5">{overdue.slice(0, 8).map((a: any) => (
            <div key={a.id} className="flex items-center gap-2 text-[12px]"><span className="text-gray-800 flex-1 truncate">{a.competency}</span><span className="text-gray-500 w-24 truncate">{a.target_label}</span><Pill text={a.dueIn != null ? `${-a.dueIn}d over` : "overdue"} tone="rose" /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-4 text-center">No overdue assignments. ✅</p>}
        </Card>
        <Card title="Assignment Register" className="xl:col-span-2">
          <div className="space-y-1">
            <div className="flex items-center text-[10px] text-gray-400 uppercase tracking-wide px-1"><span className="flex-1">Competency</span><span className="w-28">Target</span><span className="w-24">Method</span><span className="w-28">Campaign</span><span className="w-16">Due</span><span className="w-20 text-right">Status</span></div>
            {asg.slice(0, 12).map((a: any) => (
              <div key={a.id} className="flex items-center px-1 py-1 text-[12px] border-b border-gray-50"><span className="flex-1 text-gray-800 truncate">{a.competency}</span><span className="w-28 text-gray-500 truncate">{a.target_label}</span><span className="w-24 text-gray-400 text-[11px] capitalize">{a.method.replace(/_/g, " ")}</span><span className="w-28 text-gray-400 text-[11px] truncate">{a.campaign ?? "—"}</span><span className="w-16 text-gray-500">{fmtD(a.due_date)}</span><span className="w-20 text-right"><Pill text={a.status} tone={STATUS_TONE[a.status]} /></span></div>
            ))}
          </div>
        </Card>
      </div>

      <Foot>CMO-010 — competency assignment over cmo_assignments. Status/method/target mix, overdue tracking and campaigns are real; the bulk-assignment manager, rules engine and cross-workspace synchronisation are the next phase.</Foot>
    </div>
  );
}
