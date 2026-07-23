import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "./HandoverNav";

export const dynamic = "force-dynamic";

// Handover Centre Dashboard (SSW-HC-002) — the end-to-end shift-handover command
// surface. Live KPIs, overall progress, the handover workflow, JBI compliance, top
// tasks, a rule-based AI shift summary and a mini patient board — all from live op_*
// data + the handover store (079). op_patients holds no PHI, so clinical narrative is
// honestly derived/operational; JBI compliance and handover timing are honest states
// until audits/handovers are recorded.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_DOT: Record<string, string> = { "High Risk": "bg-rose-500", "At Risk": "bg-amber-500", "Stable": "bg-emerald-500" };
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

const WORKFLOW = [
  ["Prepare Outgoing Handover", "Review auto-compiled data, edit SBAR and patient summaries."],
  ["Conduct Handover", "Face-to-face bedside handover using SBAR and the patient board."],
  ["JBI Audit Checklist", "Complete the audit checklist for each patient handover."],
  ["Accept Responsibility", "Incoming shift reviews and accepts accountability."],
  ["Complete & Record", "Handover recorded with time, signatures and audit score."],
];

export default async function HandoverCentreDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadHandoverContext(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🔄</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Handover Centre</h1><p className="text-sm text-gray-500">Structured, evidence-based shift handover — SBAR, JBI audit, accountability and AI assistance.</p></div></div>
        <div className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white">Ward: All</span>
          <span className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white">Shift: Current</span>
        </div>
      </div>
      <HandoverNav />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p><p className="text-sm text-amber-800 mt-1">The clinical-operations stores (op_*) aren&apos;t available for this tenant yet. Run the operational migrations to activate the Handover Centre.</p></div></div>;

  const k = d.kpis;
  const board = [...d.rows].sort((a: any, b: any) => { const o: Record<string, number> = { "High Risk": 0, "At Risk": 1, "Stable": 2 }; return (o[a.risk] - o[b.risk]) || ((b.pews ?? 0) - (a.pews ?? 0)); }).slice(0, 6);
  const topTasks = [...d.tasks].sort((a: any, b: any) => ((a.due_at ?? "9") < (b.due_at ?? "9") ? -1 : 1)).slice(0, 5);
  const shiftRisk = k.critical >= 3 || k.escalations >= 3 ? "High" : k.critical >= 1 || k.escalations >= 1 ? "Medium" : "Low";
  const overdueTasks = d.tasks.filter((t: any) => t.due_at && t.due_at < new Date().toISOString()).length;
  const aiBullets = [
    k.critical ? `${k.critical} patient${k.critical === 1 ? "" : "s"} at high risk — prioritise for overnight monitoring.` : "No high-risk patients flagged this shift.",
    k.escalations ? `${k.escalations} active escalation${k.escalations === 1 ? "" : "s"} to hand over.` : "No active escalations.",
    overdueTasks ? `${overdueTasks} task${overdueTasks === 1 ? "" : "s"} overdue — resolve before transfer.` : "No overdue tasks.",
    `${k.pending} of ${k.patients} patient handover${k.patients === 1 ? "" : "s"} still pending.`,
  ];

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Kpi label="Patients" value={k.patients} sub="Total in scope" icon="🧑‍🤝‍🧑" />
        <Kpi label="Handed Over" value={k.completed} sub={`${k.progress}% complete`} tone="text-emerald-600" icon="✅" />
        <Kpi label="Pending" value={k.pending} sub="Remaining" tone={k.pending ? "text-amber-600" : undefined} icon="⏳" />
        <Kpi label="Critical Patients" value={k.critical} sub="High risk" tone={k.critical ? "text-rose-600" : undefined} icon="⚠️" />
        <Kpi label="Escalations" value={k.escalations} sub="Active" tone={k.escalations ? "text-violet-600" : undefined} icon="⬆️" />
        <Kpi label="Outstanding Tasks" value={k.tasks} sub="Open" icon="🗒️" />
        <Kpi label="Overdue Tasks" value={overdueTasks} sub="Past due" tone={overdueTasks ? "text-rose-600" : undefined} icon="⏰" />
        <Kpi label="JBI Compliance" value={k.jbiCompliance != null ? `${k.jbiCompliance}%` : "—"} sub={k.jbiCompliance != null ? "Avg audit" : "No audits yet"} tone={k.jbiCompliance != null && k.jbiCompliance >= 85 ? "text-emerald-600" : undefined} icon="🛡️" />
        <Kpi label="Avg Handover" value={k.avgHandoverMins != null ? `${k.avgHandoverMins}m` : "—"} sub="Not timed yet" icon="⏱️" />
        <Kpi label="Shift Risk" value={shiftRisk} sub="Derived" tone={shiftRisk === "High" ? "text-rose-600" : shiftRisk === "Medium" ? "text-amber-600" : "text-emerald-600"} icon="📊" />
      </div>

      {/* Progress */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-2"><h3 className="text-sm font-bold text-gray-900">Overall Shift Handover Progress</h3><span className="text-sm font-bold text-gray-900">{k.progress}% <span className="text-xs text-gray-400 font-normal">{k.completed} of {k.patients} patients</span></span></div>
        <div className="w-full h-3 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${k.progress}%` }} /></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Workflow */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Handover Workflow</h3>
          <div className="space-y-3">{WORKFLOW.map(([t, sub], i) => (<div key={i} className="flex gap-2.5"><div className="w-6 h-6 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 flex items-center justify-center text-[11px] font-bold shrink-0">{i + 1}</div><div><p className="text-xs font-semibold text-gray-800">{t}</p><p className="text-[11px] text-gray-500">{sub}</p></div></div>))}</div>
        </div>

        {/* JBI compliance */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">JBI Handover Compliance</h3>
          {k.jbiCompliance == null ? (
            <div className="text-center py-6"><p className="text-3xl mb-2">🛡️</p><p className="text-sm font-semibold text-gray-700">No audits recorded yet</p><p className="text-xs text-gray-400 mt-1">Compliance populates from the <Link href="/supervisor/handover/jbi" className="text-emerald-700 hover:underline">JBI Audit Engine</Link> as bedside handovers are audited.</p></div>
          ) : (
            <div className="flex items-center gap-4"><div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(#10b981 ${k.jbiCompliance}%, #f1f5f9 0)` }} /><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{k.jbiCompliance}%</span><span className="text-[8px] text-gray-400">Compliance</span></div></div><div className="text-xs text-gray-500"><p>Average across <b className="text-gray-800">{d.audits.length}</b> audit{d.audits.length === 1 ? "" : "s"}.</p><Link href="/supervisor/handover/jbi" className="text-emerald-700 hover:underline text-[11px]">Go to JBI Audit →</Link></div></div>
          )}
        </div>

        {/* Top tasks */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Handover Tasks</h3><Link href="/supervisor/handover/tasks" className="text-[11px] text-emerald-700 hover:underline">View all →</Link></div>
          {topTasks.length === 0 ? <p className="text-sm text-gray-400">No outstanding tasks. 🎉</p> : (
            <div className="space-y-1.5">{topTasks.map((t: any) => (<div key={t.id} className="flex items-center gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.priority === "urgent" ? "bg-rose-500" : t.priority === "high" ? "bg-amber-500" : "bg-gray-300"}`} /><span className="text-gray-700 flex-1 truncate">{t.description}</span><span className="text-gray-400 truncate max-w-[80px]">{t.op_patients?.label ?? "—"}</span></div>))}</div>
          )}
        </div>
      </div>

      {/* AI summary + mini board */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-2 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5"><span>🤖</span>AI Handover Assistant — Shift Summary</h3><Link href="/supervisor/handover/ai" className="text-[11px] text-emerald-700 hover:underline">View AI insights →</Link></div>
          <ul className="space-y-1.5 mb-3">{aiBullets.map((b, i) => <li key={i} className="text-xs text-gray-700 flex gap-2"><span className="text-emerald-500">•</span>{b}</li>)}</ul>
          <div className="grid grid-cols-3 gap-3 pt-3 border-t border-gray-100">
            <div><p className="text-[10px] text-gray-500 uppercase">Shift Risk Score</p><p className={`text-lg font-bold ${shiftRisk === "High" ? "text-rose-600" : shiftRisk === "Medium" ? "text-amber-600" : "text-emerald-600"}`}>{shiftRisk}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Handover Quality</p><p className="text-lg font-bold text-gray-900">{k.jbiCompliance != null ? `${k.jbiCompliance}%` : "—"}</p></div>
            <div><p className="text-[10px] text-gray-500 uppercase">Patients Pending</p><p className="text-lg font-bold text-gray-900">{k.pending}</p></div>
          </div>
          <p className="text-[10px] text-gray-400 mt-2">AI insights are decision support only and do not replace clinical judgement. Derived from live operational data.</p>
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Patient Handover Board</h3><Link href="/supervisor/handover/board" className="text-[11px] text-emerald-700 hover:underline">View all →</Link></div>
          {board.length === 0 ? <p className="text-sm text-gray-400">No patients in scope.</p> : (
            <div className="space-y-2">{board.map((p: any) => (
              <Link key={p.patientId} href="/supervisor/handover/board" className="block rounded-lg border border-gray-100 p-2.5 hover:border-emerald-200 hover:bg-emerald-50/30">
                <div className="flex items-center justify-between"><span className="text-xs font-semibold text-gray-800">{p.bed ? `Bed ${p.bed} · ` : ""}{p.label}</span><span className="text-xs font-bold text-gray-900">PEWS {p.pews ?? "—"}</span></div>
                <div className="flex items-center justify-between mt-1"><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[p.risk]}`}>{p.risk}</span><span className="flex items-center gap-2 text-[10px] text-gray-400"><span>🗒️ {p.openTasks}</span><span>⬆️ {p.escalations}</span><span className={`w-1.5 h-1.5 rounded-full ${RISK_DOT[p.risk]}`} /></span></div>
              </Link>
            ))}</div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link href="/supervisor/handover/outgoing" className="text-xs font-semibold rounded-lg py-2.5 px-4 bg-emerald-600 text-white">Start Outgoing Handover →</Link>
        <Link href="/supervisor/handover/incoming" className="text-xs font-semibold rounded-lg py-2.5 px-4 border border-emerald-300 text-emerald-700">Review Incoming Handover</Link>
        <Link href="/supervisor/handover/reports" className="text-xs font-semibold rounded-lg py-2.5 px-4 border border-gray-200 text-gray-600">Handover Reports</Link>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Handover Centre (SSW-HC-002) is the Shift Supervisor&apos;s end-to-end handover workflow over live operational data (patients, PEWS observations, tasks, escalations, safety alerts) and the handover store (op_handovers/items/audits, migration 079). SBAR is auto-generated from real operational fields and editable; JBI compliance and handover timing are honest states until audits and sign-offs are recorded — op_patients holds no PHI, so no demographics or diagnoses are fabricated. Modules: <Link href="/supervisor/handover/board" className="text-emerald-700 hover:underline">Board</Link>, <Link href="/supervisor/handover/sbar" className="text-emerald-700 hover:underline">SBAR</Link>, <Link href="/supervisor/handover/jbi" className="text-emerald-700 hover:underline">JBI</Link>, <Link href="/supervisor/handover/tasks" className="text-emerald-700 hover:underline">Tasks</Link>, <Link href="/supervisor/handover/acceptance" className="text-emerald-700 hover:underline">Acceptance</Link>, <Link href="/supervisor/handover/ai" className="text-emerald-700 hover:underline">AI</Link>, <Link href="/supervisor/handover/reports" className="text-emerald-700 hover:underline">Reports</Link>.</p>
    </div>
  );
}
