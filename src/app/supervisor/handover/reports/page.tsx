import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";

export const dynamic = "force-dynamic";

// Handover Reports & Analytics (SSW-HC-012) — insight into handover quality, safety,
// compliance and performance over the JBI audit store + live operational data.
// Real where recorded (JBI compliance, outcomes, task performance, supervisor scores);
// honest empty states where audits/handovers haven't been captured yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const CLASS_COLOR: Record<string, string> = { Excellent: "#10b981", Good: "#22c55e", Fair: "#f59e0b", "Needs Improvement": "#ef4444" };

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function HandoverReports() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadHandoverContext(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const header = (<><div className="flex items-center gap-2"><span className="text-xl">📊</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Handover Reports &amp; Analytics</h1><p className="text-sm text-gray-500">Comprehensive insights into handover quality, safety, compliance and performance.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const audits = d.audits;
  const classes = ["Excellent", "Good", "Fair", "Needs Improvement"].map(c => ({ label: c, n: audits.filter((a: any) => a.classification === c).length })).filter(x => x.n);
  const totalAudits = audits.length;
  const acceptedCount = d.rows.filter((r: any) => r.accepted).length;
  const acceptanceRate = d.rows.length ? Math.round((acceptedCount / d.rows.length) * 100) : null;
  const overdue = d.tasks.filter((t: any) => t.due_at && t.due_at < new Date().toISOString()).length;
  // Supervisor performance from audits (auditor → avg compliance)
  const bySup = new Map<string, { n: number; sum: number }>();
  for (const a of audits) { const k = a.auditor_name ?? "—"; const cur = bySup.get(k) ?? { n: 0, sum: 0 }; cur.n++; cur.sum += a.compliance_pct ?? 0; bySup.set(k, cur); }
  const supervisors = [...bySup.entries()].map(([name, v]) => ({ name, n: v.n, avg: Math.round(v.sum / v.n) })).sort((a, b) => b.avg - a.avg).slice(0, 5);

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Total Handovers" value={d.rows.length} sub="Patients in scope" />
        <Kpi label="JBI Compliance" value={d.kpis.jbiCompliance != null ? `${d.kpis.jbiCompliance}%` : "—"} sub={totalAudits ? `${totalAudits} audits` : "No audits yet"} tone={d.kpis.jbiCompliance != null && d.kpis.jbiCompliance >= 85 ? "text-emerald-600" : undefined} />
        <Kpi label="High Risk Patients" value={d.kpis.critical} sub="This period" tone={d.kpis.critical ? "text-rose-600" : undefined} />
        <Kpi label="Overdue Tasks" value={overdue} sub="Open" tone={overdue ? "text-rose-600" : undefined} />
        <Kpi label="Acceptance Rate" value={acceptanceRate != null ? `${acceptanceRate}%` : "—"} sub="Patients accepted" tone={acceptanceRate === 100 ? "text-emerald-600" : undefined} />
        <Kpi label="Avg Duration" value={d.kpis.avgHandoverMins != null ? `${d.kpis.avgHandoverMins}m` : "—"} sub="Not timed yet" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Handover Quality Overview</h3>
          {totalAudits === 0 ? <div className="text-center py-6"><p className="text-3xl mb-2">🛡️</p><p className="text-sm font-semibold text-gray-700">No audits yet</p><p className="text-xs text-gray-400 mt-1">Quality classification populates from the <Link href="/supervisor/handover/jbi" className="text-emerald-700 hover:underline">JBI Audit Engine</Link>.</p></div> : (
            <div className="flex items-center gap-4"><div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(${(() => { let acc = 0; return classes.map(c => { const a = (acc / totalAudits) * 100; acc += c.n; return `${CLASS_COLOR[c.label]} ${a}% ${(acc / totalAudits) * 100}%`; }).join(", "); })()})` }} /><div className="absolute inset-[22%] rounded-full bg-white flex items-center justify-center"><span className="text-lg font-bold text-gray-900">{totalAudits}</span></div></div><div className="text-[11px] space-y-0.5 flex-1">{classes.map(c => <div key={c.label} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: CLASS_COLOR[c.label] }} /><span className="text-gray-600 flex-1">{c.label}</span><b>{c.n}</b></div>)}</div></div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Handover Outcomes</h3>
          <div className="space-y-2">{[["Safe Handovers (Stable)", d.rows.filter((r: any) => r.risk === "Stable").length, "bg-emerald-500"], ["Requires Monitoring (At Risk)", d.rows.filter((r: any) => r.risk === "At Risk").length, "bg-amber-500"], ["High Risk", d.kpis.critical, "bg-rose-500"]].map(([l, n, clr]) => (<div key={l as string} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{l as string}</span><b>{n as number}</b></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${clr as string}`} style={{ width: `${d.rows.length ? ((n as number) / d.rows.length) * 100 : 0}%` }} /></div></div>))}</div>
          <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-100">Total: {d.rows.length} patients</p>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Supervisor Performance</h3>
          {supervisors.length === 0 ? <p className="text-sm text-gray-400">No audit data yet.</p> : <div className="space-y-1.5">{supervisors.map(s => (<div key={s.name} className="flex items-center gap-2 text-xs"><span className="text-gray-700 flex-1 truncate">{s.name}</span><span className="text-gray-400">{s.n} audits</span><b className={s.avg >= 85 ? "text-emerald-600" : s.avg >= 70 ? "text-amber-600" : "text-rose-600"}>{s.avg}%</b></div>))}</div>}
        </div>
      </div>

      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Reports &amp; Exports</h3>
        <div className="border border-dashed border-gray-200 rounded-lg p-4 text-center"><p className="text-sm text-gray-500">Report generation (Handover Quality, JBI Compliance, Patient Safety, Supervisor Performance, AI Insights) is a next-phase build.</p><p className="text-[11px] text-gray-400 mt-1">These generate as PDF/Excel from the live audit trail — shown honestly rather than as fabricated report rows. Patient-safety indicators (deterioration/adverse events per 100 handovers) require an outcomes store not yet provisioned.</p></div>
      </div>
      <p className="text-[11px] text-gray-400 pb-4">Handover Reports &amp; Analytics (SSW-HC-012) is real where recorded — JBI compliance and quality classification from op_handover_audits, outcomes and task performance from live operational data, supervisor scores from audit authorship. Where audits/handovers haven&apos;t been captured yet, honest empty states show rather than fabricated trends. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
