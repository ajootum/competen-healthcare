import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";
import { AcceptButton, AnswerClarification } from "../HandoverActions";

export const dynamic = "force-dynamic";

// Incoming Shift (SSW-HC-005) — the incoming supervisor reviews and accepts every
// patient. Pending queue, review workspace (SBAR, tasks, alerts), the clarification
// Q&A channel to the outgoing supervisor, and per-patient Accept-Responsibility — all
// audited via the handover API. Outstanding risks stay visible after acceptance.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };
const SBAR_META: [string, string][] = [["Situation", "bg-emerald-500"], ["Background", "bg-violet-500"], ["Assessment", "bg-amber-500"], ["Recommendation", "bg-rose-500"]];

function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className={`text-xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function IncomingShift({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  let clarifications: any[] = [];
  try { const { data: cl } = await admin.from("op_handover_clarifications").select("*").order("created_at", { ascending: false }).limit(50); clarifications = cl ?? []; } catch { /* fail-soft before 079 */ }

  const header = (<><div className="flex items-center gap-2"><span className="text-xl">📥</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Incoming Shift</h1><p className="text-sm text-gray-500">Review and accept handover from the outgoing shift.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const rows = d.rows;
  const reviewed = rows.filter((r: any) => r.reviewed).length;
  const pendingQueue = rows.filter((r: any) => !r.reviewed);
  const pendingClar = clarifications.filter((c: any) => c.status === "pending").length;
  const selected = (selId ? rows.find((r: any) => r.patientId === selId) : null) ?? pendingQueue[0] ?? rows[0] ?? null;
  const selTasks = selected ? d.tasks.filter((t: any) => t.patient_id === selected.patientId) : [];
  const selClar = selected ? clarifications.filter((c: any) => c.patient_id === selected.patientId) : [];

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        <Kpi label="Pending" value={rows.length - reviewed} tone={rows.length - reviewed ? "text-amber-600" : undefined} />
        <Kpi label="Reviewed" value={reviewed} tone="text-emerald-600" sub={`${rows.length ? Math.round((reviewed / rows.length) * 100) : 0}%`} />
        <Kpi label="High Risk" value={d.kpis.critical} tone={d.kpis.critical ? "text-rose-600" : undefined} />
        <Kpi label="Escalations" value={d.escalations.length} tone={d.escalations.length ? "text-violet-600" : undefined} />
        <Kpi label="Questions" value={pendingClar} sub="Awaiting" tone={pendingClar ? "text-amber-600" : undefined} />
        <Kpi label="Tasks" value={d.tasks.length} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Queue */}
        <div className={`${card} p-4 xl:col-span-1`}>
          <h3 className="text-xs font-bold text-gray-900 mb-2 uppercase">Patient Queue ({pendingQueue.length} pending)</h3>
          <div className="space-y-1 max-h-[500px] overflow-y-auto">{rows.map((p: any) => (<Link key={p.patientId} href={`/supervisor/handover/incoming?patient=${p.patientId}`} className={`block rounded-lg border p-2 text-xs ${selected?.patientId === p.patientId ? "border-emerald-400 bg-emerald-50/40" : "border-gray-100 hover:border-emerald-200"}`}><div className="flex items-center justify-between"><span className="font-semibold text-gray-800">{p.bed ? `Bed ${p.bed}` : p.label}</span>{p.reviewed ? <span className="text-emerald-600">✓</span> : <span className="text-amber-500">●</span>}</div><div className="flex items-center justify-between mt-0.5"><span className="text-gray-500 truncate">{p.label}</span><span className={`text-[9px] px-1 rounded ${RISK_BADGE[p.risk]}`}>PEWS {p.pews ?? "—"}</span></div></Link>))}</div>
        </div>

        {/* Review workspace */}
        <div className={`${card} p-5 xl:col-span-2`}>
          {!selected ? <p className="text-sm text-gray-400 py-8 text-center">No patients in scope.</p> : (<>
            <div className="flex items-start justify-between mb-3"><div><h3 className="text-sm font-bold text-gray-900">{selected.bed ? `Bed ${selected.bed} · ` : ""}{selected.label}</h3><p className="text-[10px] text-gray-400 capitalize">Acuity {selected.acuity} · PEWS {selected.pews ?? "—"} · {selected.reviewed ? "Reviewed" : "Pending review"}</p></div><span className={`text-[10px] px-1.5 py-0.5 rounded ${RISK_BADGE[selected.risk]}`}>{selected.risk}</span></div>
            <div className="grid grid-cols-2 gap-2">{SBAR_META.map(([lbl, clr]) => (<div key={lbl} className="rounded-lg border border-gray-100 p-2"><div className="flex items-center gap-1.5 mb-0.5"><span className={`w-3.5 h-3.5 rounded ${clr} text-white text-[8px] font-bold flex items-center justify-center`}>{lbl[0]}</span><span className="text-[10px] font-semibold text-gray-500">{lbl}</span></div><p className="text-[11px] text-gray-700">{(selected.sbar as any)[lbl.toLowerCase()]}</p></div>))}</div>

            <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">Tasks to Acknowledge ({selTasks.length})</p>
            {selTasks.length === 0 ? <p className="text-[11px] text-gray-400">None.</p> : <div className="space-y-0.5">{selTasks.slice(0, 4).map((t: any) => <div key={t.id} className="text-[11px] text-gray-700 flex gap-1.5"><span className="text-gray-300">●</span>{t.description}</div>)}</div>}

            <p className="text-[10px] font-semibold text-gray-500 uppercase mt-3 mb-1">Clarifications ({selClar.length})</p>
            {selClar.length === 0 ? <p className="text-[11px] text-gray-400">No questions raised. Use the Board to ask the outgoing supervisor.</p> : <div className="space-y-1.5">{selClar.map((c: any) => (<div key={c.id} className="rounded-lg border border-gray-100 p-2"><p className="text-[11px] text-gray-700"><b>Q:</b> {c.question}</p>{c.answer ? <p className="text-[11px] text-emerald-700 mt-0.5"><b>A:</b> {c.answer}</p> : <div className="flex items-center justify-between mt-0.5"><span className="text-[10px] text-amber-600">Pending</span><AnswerClarification id={c.id} /></div>}</div>))}</div>}

            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center gap-2">
              <Link href={`/supervisor/handover/board?patient=${selected.patientId}`} className="text-xs font-semibold rounded-lg py-2 px-3 border border-gray-200 text-gray-600">Ask Clarification</Link>
              <AcceptButton patientId={selected.patientId} patientLabel={selected.label} accepted={selected.accepted} />
            </div>
            <p className="text-[10px] text-gray-400 mt-2">By accepting, you confirm you have reviewed the handover and accept accountability for this patient.</p>
          </>)}
        </div>
      </div>
      <p className="text-[11px] text-gray-400 pb-4">Incoming Shift (SSW-HC-005) requires review before acceptance, with a clarification Q&amp;A channel to the outgoing supervisor (op_handover_clarifications) and audited Accept-Responsibility. SBAR, tasks and alerts are inherited live; outstanding risks stay visible after acceptance. Finalise in <Link href="/supervisor/handover/acceptance" className="text-emerald-700 hover:underline">Acceptance &amp; Accountability</Link>. <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
