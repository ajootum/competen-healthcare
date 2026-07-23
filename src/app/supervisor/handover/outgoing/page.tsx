import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";
import { CompleteButton } from "../HandoverActions";

export const dynamic = "force-dynamic";

// Outgoing Shift (SSW-HC-004) — the outgoing supervisor prepares and delivers handover.
// Workflow progress, KPIs, patient list with completion status, and a patient workspace
// (auto/edited SBAR, tasks, alerts) with per-patient Mark-Completed through the handover
// API. Live op_* data; SBAR operational-only (no PHI fabricated).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };
const STEPS = ["Review Patients", "Build Handover", "JBI Audit", "Summary & Sign-off"];
const SBAR_META: [string, string][] = [["Situation", "bg-emerald-500"], ["Background", "bg-violet-500"], ["Assessment", "bg-amber-500"], ["Recommendation", "bg-rose-500"]];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function OutgoingShift({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const header = (<><div className="flex items-center gap-2"><span className="text-xl">📤</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Outgoing Shift</h1><p className="text-sm text-gray-500">Prepare and deliver handover for the incoming shift.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const rows = d.rows;
  const done = (r: any) => ["completed", "reviewed", "accepted"].includes(r.itemStatus);
  const completedCount = rows.filter(done).length;
  const selected = (selId ? rows.find((r: any) => r.patientId === selId) : null) ?? rows[0] ?? null;
  const selTasks = selected ? d.tasks.filter((t: any) => t.patient_id === selected.patientId) : [];
  const stepIdx = completedCount === rows.length && rows.length ? 3 : completedCount ? 1 : 0;

  return (
    <div className="space-y-4">
      {header}
      {/* Workflow + progress */}
      <div className={`${card} p-4`}>
        <div className="flex items-center gap-2 flex-wrap mb-3">{STEPS.map((s, i) => (<div key={s} className="flex items-center gap-2"><span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${i <= stepIdx ? "bg-emerald-600 text-white" : "bg-gray-100 text-gray-400"}`}>{i + 1}</span><span className={`text-xs ${i <= stepIdx ? "text-gray-800 font-medium" : "text-gray-400"}`}>{s}</span>{i < STEPS.length - 1 && <span className="text-gray-300">→</span>}</div>))}</div>
        <div className="flex items-center gap-3"><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${rows.length ? (completedCount / rows.length) * 100 : 0}%` }} /></div><span className="text-xs font-bold text-gray-900">{rows.length ? Math.round((completedCount / rows.length) * 100) : 0}% <span className="font-normal text-gray-400">{completedCount}/{rows.length}</span></span></div>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Kpi label="Patients" value={rows.length} />
        <Kpi label="Completed" value={completedCount} tone="text-emerald-600" />
        <Kpi label="In Progress" value={rows.length - completedCount} tone={rows.length - completedCount ? "text-amber-600" : undefined} />
        <Kpi label="Critical" value={d.kpis.critical} tone={d.kpis.critical ? "text-rose-600" : undefined} />
        <Kpi label="Escalations" value={d.escalations.length} tone={d.escalations.length ? "text-violet-600" : undefined} />
        <Kpi label="Tasks" value={d.tasks.length} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Patient list */}
        <div className={`${card} p-4 xl:col-span-1`}>
          <h3 className="text-xs font-bold text-gray-900 mb-2 uppercase">Patient List ({rows.length})</h3>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">{rows.map((p: any) => (<Link key={p.patientId} href={`/supervisor/handover/outgoing?patient=${p.patientId}`} className={`block rounded-lg border p-2 text-xs ${selected?.patientId === p.patientId ? "border-emerald-400 bg-emerald-50/40" : "border-gray-100 hover:border-emerald-200"}`}><div className="flex items-center justify-between"><span className="font-semibold text-gray-800">{p.bed ? `Bed ${p.bed}` : p.label}</span>{done(p) ? <span className="text-emerald-600">✓</span> : <span className="text-amber-500">●</span>}</div><div className="flex items-center justify-between mt-0.5"><span className="text-gray-500 truncate">{p.label}</span><span className={`text-[9px] px-1 rounded ${RISK_BADGE[p.risk]}`}>PEWS {p.pews ?? "—"}</span></div></Link>))}</div>
        </div>

        {/* Workspace */}
        <div className={`${card} p-5 xl:col-span-2`}>
          {!selected ? <p className="text-sm text-gray-400 py-8 text-center">No patients in scope.</p> : (<>
            <div className="flex items-start justify-between mb-3"><div><h3 className="text-sm font-bold text-gray-900">{selected.bed ? `Bed ${selected.bed} · ` : ""}{selected.label}</h3><p className="text-[10px] text-gray-400 capitalize">Acuity {selected.acuity} · PEWS {selected.pews ?? "—"} · {selected.status.replace(/_/g, " ")}</p></div><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[selected.risk]}`}>{selected.risk}</span></div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">SBAR Handover {selected.sbarEdited ? <span className="text-emerald-600 normal-case">· edited</span> : <span className="text-gray-400 normal-case">· auto</span>}</p>
            <div className="grid grid-cols-2 gap-2">{SBAR_META.map(([lbl, clr]) => (<div key={lbl} className="rounded-lg border border-gray-100 p-2"><div className="flex items-center gap-1.5 mb-0.5"><span className={`w-3.5 h-3.5 rounded ${clr} text-white text-[8px] font-bold flex items-center justify-center`}>{lbl[0]}</span><span className="text-[10px] font-semibold text-gray-500">{lbl}</span></div><p className="text-[11px] text-gray-700">{(selected.sbar as any)[lbl.toLowerCase()]}</p></div>))}</div>
            <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">Tasks & Plans ({selTasks.length})</p>
            {selTasks.length === 0 ? <p className="text-[11px] text-gray-400">No outstanding tasks.</p> : <div className="space-y-0.5">{selTasks.slice(0, 4).map((t: any) => <div key={t.id} className="text-[11px] text-gray-700 flex gap-1.5"><span className={t.priority === "urgent" ? "text-rose-500" : "text-gray-300"}>●</span>{t.description}</div>)}</div>}
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2 flex-wrap">
              <Link href={`/supervisor/handover/sbar?patient=${selected.patientId}`} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">Edit SBAR</Link>
              <Link href={`/supervisor/handover/jbi?patient=${selected.patientId}`} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">JBI Audit</Link>
              <CompleteButton patientId={selected.patientId} patientLabel={selected.label} done={done(selected)} />
            </div>
          </>)}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 pb-4">Outgoing Shift (SSW-HC-004) walks the outgoing supervisor through Review → Build → JBI → Sign-off over live operational data. SBAR auto-populates from operational fields and is edited in the <Link href="/supervisor/handover/sbar" className="text-emerald-700 hover:underline">SBAR Builder</Link>; Mark-Completed and JBI are audited via the handover API. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
