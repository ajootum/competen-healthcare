import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";
import BoardActions from "./BoardActions";

export const dynamic = "force-dynamic";

// Patient Handover Board (SSW-HC-006) — the live, patient-centric board for shift-to-
// shift handover. Card view + detail panel (SBAR, tasks, alerts) from live op_* data +
// the handover store. Review + clarification run through the audited handover API.
// op_patients holds no PHI → cards show operational identifiers; SBAR is auto/edited.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };
const RISK_BAR: Record<string, string> = { "High Risk": "bg-rose-500", "At Risk": "bg-amber-500", "Stable": "bg-emerald-500" };
const FILTERS = ["All", "Pending", "Reviewed", "High Risk", "Escalation"];

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}
const SBAR_META: [string, string, string][] = [["S", "Situation", "bg-emerald-500"], ["B", "Background", "bg-violet-500"], ["A", "Assessment", "bg-amber-500"], ["R", "Recommendation", "bg-rose-500"]];

export default async function PatientHandoverBoard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" && FILTERS.includes(sp.filter) ? sp.filter : "All";
  const selId = typeof sp.patient === "string" ? sp.patient : undefined;
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
      <div className="flex items-center gap-2"><span className="text-xl">🗂️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Patient Handover Board</h1><p className="text-sm text-gray-500">Live overview of all patients and their handover status.</p></div></div>
      <HandoverNav />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const match = (r: any) => filter === "All" || (filter === "Pending" && !r.reviewed) || (filter === "Reviewed" && r.reviewed) || (filter === "High Risk" && r.risk === "High Risk") || (filter === "Escalation" && r.escalations > 0);
  const rows = d.rows.filter(match).sort((a: any, b: any) => { const o: Record<string, number> = { "High Risk": 0, "At Risk": 1, "Stable": 2 }; return (o[a.risk] - o[b.risk]) || ((b.pews ?? 0) - (a.pews ?? 0)); });
  const selected = (selId ? d.rows.find((r: any) => r.patientId === selId) : null) ?? rows[0] ?? d.rows[0] ?? null;
  const selTasks = selected ? d.tasks.filter((t: any) => t.patient_id === selected.patientId) : [];
  const selAlerts = selected ? d.alerts.filter((a: any) => a.patient_id === selected.patientId) : [];
  const counts = { all: d.rows.length, pending: d.rows.filter((r: any) => !r.reviewed).length, reviewed: d.rows.filter((r: any) => r.reviewed).length, high: d.rows.filter((r: any) => r.risk === "High Risk").length, esc: d.rows.filter((r: any) => r.escalations > 0).length };

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
        <Kpi label="All Patients" value={counts.all} />
        <Kpi label="Pending Review" value={counts.pending} tone={counts.pending ? "text-amber-600" : undefined} />
        <Kpi label="Reviewed" value={counts.reviewed} tone="text-emerald-600" />
        <Kpi label="High Risk" value={counts.high} tone={counts.high ? "text-rose-600" : undefined} />
        <Kpi label="Escalations" value={counts.esc} tone={counts.esc ? "text-violet-600" : undefined} />
      </div>

      <div className="flex gap-1 flex-wrap">
        {FILTERS.map(f => <Link key={f} href={`/supervisor/handover/board?filter=${f}${selId ? `&patient=${selId}` : ""}`} className={`text-[11px] px-2.5 py-1 rounded-full ${filter === f ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{f} {f === "All" ? `(${counts.all})` : f === "Pending" ? `(${counts.pending})` : f === "Reviewed" ? `(${counts.reviewed})` : f === "High Risk" ? `(${counts.high})` : `(${counts.esc})`}</Link>)}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Cards */}
        <div className="xl:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-3 content-start">
          {rows.length === 0 ? <div className={`${card} p-8 text-center sm:col-span-2`}><p className="text-sm text-gray-400">No patients match this filter.</p></div> : rows.slice(0, 12).map((p: any) => (
            <Link key={p.patientId} href={`/supervisor/handover/board?filter=${filter}&patient=${p.patientId}`} className={`${card} p-3.5 hover:border-emerald-300 transition-colors ${selected?.patientId === p.patientId ? "border-emerald-400 ring-1 ring-emerald-200" : ""}`}>
              <div className="flex items-start justify-between"><div><p className="text-sm font-bold text-gray-900">{p.bed ? `Bed ${p.bed}` : "Unassigned"}</p><p className="text-xs text-gray-600">{p.label}</p></div><div className="text-right"><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[p.risk]}`}>{p.risk}</span><p className="text-xs font-bold text-gray-900 mt-1">PEWS {p.pews ?? "—"}</p></div></div>
              <p className="text-[11px] text-gray-500 mt-1.5 capitalize">Acuity: {p.acuity} · {p.status.replace(/_/g, " ")}</p>
              <div className="flex items-center gap-3 mt-2 text-[10px] text-gray-400">
                <span title="Open tasks">🗒️ {p.openTasks}</span><span title="Escalations">⬆️ {p.escalations}</span><span title="Safety alerts">🚩 {p.alerts}</span>
                <span className="ml-auto">{p.reviewed ? <span className="text-emerald-600">✓ Reviewed</span> : <span className="text-amber-600">● Pending</span>}</span>
              </div>
              <div className="w-full h-1 rounded-full bg-gray-100 mt-2 overflow-hidden"><div className={`h-full ${RISK_BAR[p.risk]}`} style={{ width: p.risk === "High Risk" ? "100%" : p.risk === "At Risk" ? "60%" : "30%" }} /></div>
            </Link>
          ))}
          {rows.length > 12 && <p className="text-[10px] text-gray-400 sm:col-span-2">Showing 12 of {rows.length}.</p>}
        </div>

        {/* Detail panel */}
        <div className={`${card} p-5 xl:col-span-1`}>
          {!selected ? <div className="text-center py-8"><p className="text-2xl mb-2">🗂️</p><p className="text-sm text-gray-400">No patient selected.</p></div> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><h3 className="text-sm font-bold text-gray-900">{selected.bed ? `Bed ${selected.bed} · ` : ""}{selected.label}</h3><p className="text-[10px] text-gray-400 capitalize">Acuity {selected.acuity} · {selected.status.replace(/_/g, " ")}{selected.isolation !== "none" ? ` · Isolation ${selected.isolation}` : ""}</p></div><div className="text-right"><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[selected.risk]}`}>{selected.risk}</span><p className="text-sm font-bold text-gray-900 mt-0.5">PEWS {selected.pews ?? "—"}</p></div></div>
              <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">SBAR Summary {selected.sbarEdited ? <span className="text-emerald-600 normal-case">· edited</span> : <span className="text-gray-400 normal-case">· auto</span>}</p>
              <div className="space-y-1.5">{SBAR_META.map(([k, lbl, clr]) => (<div key={k} className="flex gap-2"><span className={`w-4 h-4 rounded ${clr} text-white text-[9px] font-bold flex items-center justify-center shrink-0 mt-0.5`}>{k}</span><div><p className="text-[10px] font-semibold text-gray-500">{lbl}</p><p className="text-[11px] text-gray-700">{(selected.sbar as any)[lbl.toLowerCase()]}</p></div></div>))}</div>

              <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">Tasks ({selTasks.length})</p>
              {selTasks.length === 0 ? <p className="text-[11px] text-gray-400">No open tasks.</p> : <div className="space-y-0.5">{selTasks.slice(0, 4).map((t: any) => <div key={t.id} className="text-[11px] text-gray-700 flex gap-1.5"><span className={t.priority === "urgent" ? "text-rose-500" : t.priority === "high" ? "text-amber-500" : "text-gray-300"}>●</span>{t.description}</div>)}</div>}

              <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">Alerts ({selAlerts.length})</p>
              {selAlerts.length === 0 ? <p className="text-[11px] text-gray-400">No active alerts.</p> : <div className="space-y-0.5">{selAlerts.slice(0, 3).map((a: any) => <div key={a.id} className="text-[11px] text-rose-600 flex gap-1.5"><span>🚩</span>{a.category ?? "Alert"}{a.message ? ` — ${a.message}` : ""}</div>)}</div>}

              <div className="mt-4 pt-3 border-t border-gray-100"><BoardActions patientId={selected.patientId} patientLabel={selected.label} reviewed={selected.reviewed} /></div>
              <p className="text-[10px] text-gray-400 mt-2">Review actions require migration 079. <Link href={`/supervisor/patient-card/${selected.patientId}`} className="text-emerald-700 hover:underline">Open patient card →</Link></p>
            </>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Patient Handover Board (SSW-HC-006) is the live patient-centric handover view over op_patients + latest PEWS observations + tasks + escalations + safety alerts, with SBAR from the handover store (auto-generated from operational fields, editable in the <Link href="/supervisor/handover/sbar" className="text-emerald-700 hover:underline">SBAR Builder</Link>). Cards show operational identifiers only (op_patients holds no PHI — no fabricated names/diagnoses). Review &amp; clarification are audited through the handover API. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
