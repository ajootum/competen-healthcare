import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext, JBI_DOMAINS } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";
import JbiAudit from "./JbiAudit";

export const dynamic = "force-dynamic";

// JBI Handover Audit Engine (SSW-HC-008) — evidence-based audit of bedside handovers.
// Score a patient handover against the 8 JBI domains (persisted to op_handover_audits),
// and read the resulting compliance analytics: KPIs, recent audits, per-domain
// performance. Real from recorded audits; honest empty states before any exist.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const CLS_BADGE: Record<string, string> = { Excellent: "bg-emerald-50 text-emerald-700", Good: "bg-green-50 text-green-700", Fair: "bg-amber-50 text-amber-700", "Needs Improvement": "bg-rose-50 text-rose-700" };
const stamp = (iso?: string | null) => (iso ? `${iso.slice(11, 16)}` : "—");

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function JBIAuditEngine({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const selId = typeof sp.patient === "string" ? sp.patient : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadHandoverContext(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const header = (<><div className="flex items-center gap-2"><span className="text-xl">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">JBI Handover Audit Engine</h1><p className="text-sm text-gray-500">Audit bedside handovers using the JBI Handover Checklist.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const audits = d.audits;
  const today = new Date().toISOString().slice(0, 10);
  const todays = audits.filter((a: any) => (a.created_at ?? "").slice(0, 10) === today);
  const compliance = audits.length ? Math.round(audits.reduce((s: number, a: any) => s + (a.compliance_pct ?? 0), 0) / audits.length) : null;
  const highQ = audits.filter((a: any) => (a.compliance_pct ?? 0) >= 85).length;
  const needsImp = audits.filter((a: any) => (a.compliance_pct ?? 0) < 70).length;
  const patLabel = (pid: string) => d.rows.find((r: any) => r.patientId === pid)?.label ?? "—";
  // Per-domain average
  const domainPerf = JBI_DOMAINS.map(dom => { const vals = audits.map((a: any) => a.checklist?.[dom.key]).filter((x: any) => x != null); const avg = vals.length ? Math.round((vals.reduce((s: number, x: number) => s + x, 0) / vals.length / 5) * 100) : null; return { label: dom.label, avg }; });
  const selected = (selId ? d.rows.find((r: any) => r.patientId === selId) : null) ?? d.rows[0] ?? null;

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Audits Today" value={todays.length} sub={`${audits.length} total`} />
        <Kpi label="Compliance Rate" value={compliance != null ? `${compliance}%` : "—"} sub={compliance != null ? "Average" : "No audits yet"} tone={compliance != null && compliance >= 85 ? "text-emerald-600" : undefined} />
        <Kpi label="High Quality" value={highQ} sub="≥ 85%" tone="text-emerald-600" />
        <Kpi label="Needs Improvement" value={needsImp} sub="< 70%" tone={needsImp ? "text-rose-600" : undefined} />
        <Kpi label="Patients" value={d.rows.length} sub="Auditable" />
        <Kpi label="Domains" value={JBI_DOMAINS.length} sub="JBI checklist" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* New audit */}
        <div className={`${card} p-5 xl:col-span-2`}>
          {!selected ? <p className="text-sm text-gray-400 py-8 text-center">No patients to audit.</p> : (
            <>
              <div className="flex items-center gap-2 mb-3 flex-wrap">{d.rows.slice(0, 8).map((p: any) => <Link key={p.patientId} href={`/supervisor/handover/jbi?patient=${p.patientId}`} className={`text-[10px] px-2 py-1 rounded-full ${selected.patientId === p.patientId ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{p.bed ? `Bed ${p.bed}` : p.label}</Link>)}</div>
              <JbiAudit patientId={selected.patientId} patientLabel={selected.bed ? `Bed ${selected.bed} · ${selected.label}` : selected.label} />
            </>
          )}
        </div>

        {/* Domain performance */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Checklist Domain Performance</h3>
          {audits.length === 0 ? <p className="text-sm text-gray-400">No audits recorded yet. Complete an audit to see domain trends.</p> : <div className="space-y-2">{domainPerf.map(x => (<div key={x.label} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{x.label}</span><span className="text-gray-400">{x.avg != null ? `${x.avg}%` : "—"}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(x.avg ?? 0) >= 85 ? "bg-emerald-500" : (x.avg ?? 0) >= 70 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${x.avg ?? 0}%` }} /></div></div>))}</div>}
        </div>
      </div>

      {/* Recent audits */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Recent Handover Audits</h3>
        {audits.length === 0 ? <div className="text-center py-8"><p className="text-3xl mb-2">🛡️</p><p className="text-sm font-semibold text-gray-700">No audits recorded yet</p><p className="text-xs text-gray-400 mt-1">Score a bedside handover above to start building compliance analytics.</p></div> : (
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Time</th><th className="py-2 pr-3 font-medium">Patient</th><th className="py-2 pr-3 font-medium">Auditor</th><th className="py-2 pr-3 font-medium">Score</th><th className="py-2 pr-3 font-medium">Compliance</th><th className="py-2 font-medium">Status</th></tr></thead>
            <tbody>{audits.slice(0, 10).map((a: any) => (<tr key={a.id} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-500">{stamp(a.created_at)}</td><td className="py-2 pr-3 text-gray-800">{patLabel(a.patient_id)}</td><td className="py-2 pr-3 text-gray-600">{a.auditor_name ?? "—"}</td><td className="py-2 pr-3 text-gray-600">{a.total_score}/{a.max_score}</td><td className="py-2 pr-3 font-semibold">{a.compliance_pct}%</td><td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] ${CLS_BADGE[a.classification] ?? "bg-gray-100 text-gray-600"}`}>{a.classification}</span></td></tr>))}</tbody></table></div>
        )}
      </div>
      <p className="text-[11px] text-gray-400 pb-4">The JBI Handover Audit Engine (SSW-HC-008) scores bedside handovers against the 8 JBI domains and persists each audit to op_handover_audits (audited), feeding the compliance KPIs, domain performance and <Link href="/supervisor/handover/reports" className="text-emerald-700 hover:underline">Reports</Link>. All metrics are real from recorded audits — honest empty states show until the first audit is completed. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
