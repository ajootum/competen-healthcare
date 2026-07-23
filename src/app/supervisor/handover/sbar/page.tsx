import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadHandoverContext, autoSBAR } from "@/lib/operations/handover";
import HandoverNav from "../HandoverNav";
import SbarEditor from "./SbarEditor";

export const dynamic = "force-dynamic";

// SBAR Builder (SSW-HC-007) — the clinical documentation engine. Auto-builds Situation/
// Background/Assessment/Recommendation from live operational data (op_patients has no
// PHI, so the draft states operational facts only), lets the supervisor edit + share,
// and persists versioned via the handover API. Left: patient picker; centre: editor;
// right: patient summary + data sources + quality.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const RISK_BADGE: Record<string, string> = { "High Risk": "bg-rose-50 text-rose-700", "At Risk": "bg-amber-50 text-amber-700", "Stable": "bg-emerald-50 text-emerald-700" };

function Kpi({ label, value, sub }: { label: string; value: any; sub?: string }) {
  return <div className={`${card} p-3`}><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p><p className="text-xl font-bold tabular-nums mt-0.5 text-gray-900">{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function SBARBuilder({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
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
  const header = (<><div className="flex items-center gap-2"><span className="text-xl">📝</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">SBAR Builder</h1><p className="text-sm text-gray-500">Automatically build structured handover from patient data.</p></div></div><HandoverNav /></>);
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Operational data not provisioned</p></div></div>;

  const shared = d.rows.filter((r: any) => r.sbarStatus === "shared").length;
  const edited = d.rows.filter((r: any) => r.sbarEdited).length;
  const selected = (selId ? d.rows.find((r: any) => r.patientId === selId) : null) ?? d.rows[0] ?? null;
  const auto = selected ? autoSBAR(selected) : null;

  return (
    <div className="space-y-4">
      {header}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Patients" value={d.rows.length} sub="In scope" />
        <Kpi label="Auto-Populated" value={d.rows.length - edited} sub="Operational draft" />
        <Kpi label="Edited" value={edited} sub="Clinician-refined" />
        <Kpi label="Shared" value={shared} sub="To incoming shift" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4">
        {/* Patient picker */}
        <div className={`${card} p-4 xl:col-span-1`}>
          <h3 className="text-xs font-bold text-gray-900 mb-2 uppercase">Select Patient</h3>
          <div className="space-y-1 max-h-[520px] overflow-y-auto">{d.rows.map((p: any) => (
            <Link key={p.patientId} href={`/supervisor/handover/sbar?patient=${p.patientId}`} className={`block rounded-lg border p-2 text-xs ${selected?.patientId === p.patientId ? "border-emerald-400 bg-emerald-50/40" : "border-gray-100 hover:border-emerald-200"}`}>
              <div className="flex items-center justify-between"><span className="font-semibold text-gray-800">{p.bed ? `Bed ${p.bed}` : p.label}</span><span className="text-gray-500">PEWS {p.pews ?? "—"}</span></div>
              <div className="flex items-center justify-between mt-0.5"><span className="text-gray-500 truncate">{p.label}</span><span className={`text-[9px] px-1 rounded ${RISK_BADGE[p.risk]}`}>{p.risk}</span></div>
            </Link>
          ))}</div>
        </div>

        {/* Editor */}
        <div className={`${card} p-5 xl:col-span-2`}>
          {!selected ? <p className="text-sm text-gray-400 py-8 text-center">No patients in scope.</p> : (<>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">SBAR Editor · {selected.bed ? `Bed ${selected.bed}` : selected.label}</h3><span className="text-[10px] text-gray-400">{selected.sbarEdited ? "Edited" : "Auto-draft"} · {selected.sbarStatus}</span></div>
            <SbarEditor patientId={selected.patientId} patientLabel={selected.label} current={selected.sbar} auto={auto!} />
          </>)}
        </div>

        {/* Summary + sources */}
        <div className="space-y-4 xl:col-span-1">
          {selected && <div className={`${card} p-4`}><h3 className="text-xs font-bold text-gray-900 mb-2 uppercase">Patient Summary</h3><p className="text-sm font-bold text-gray-900">{selected.label}</p><p className="text-[11px] text-gray-500 capitalize">{selected.bed ? `Bed ${selected.bed} · ` : ""}Acuity {selected.acuity} · {selected.status.replace(/_/g, " ")}</p><div className="grid grid-cols-2 gap-2 mt-2 text-xs"><div className="rounded border border-gray-100 p-1.5"><p className="text-[9px] text-gray-400 uppercase">PEWS</p><p className="font-bold">{selected.pews ?? "—"}</p></div><div className="rounded border border-gray-100 p-1.5"><p className="text-[9px] text-gray-400 uppercase">Risk</p><p className="font-bold">{selected.risk}</p></div><div className="rounded border border-gray-100 p-1.5"><p className="text-[9px] text-gray-400 uppercase">Tasks</p><p className="font-bold">{selected.openTasks}</p></div><div className="rounded border border-gray-100 p-1.5"><p className="text-[9px] text-gray-400 uppercase">Escalations</p><p className="font-bold">{selected.escalations}</p></div></div></div>}
          <div className={`${card} p-4`}><h3 className="text-xs font-bold text-gray-900 mb-2 uppercase">Data Sources</h3><div className="space-y-1 text-[11px]">{[["Observations / PEWS", "Live"], ["Tasks & Plans", "Live"], ["Escalations", "Live"], ["Safety Alerts", "Live"], ["Medications / Labs", "Not in operational store"]].map(([l, s]) => (<div key={l} className="flex items-center justify-between"><span className="text-gray-600">{l}</span><span className={s === "Live" ? "text-emerald-600" : "text-gray-400"}>{s === "Live" ? "● Live" : "—"}</span></div>))}</div></div>
        </div>
      </div>
      <p className="text-[11px] text-gray-400 pb-4">The SBAR Builder (SSW-HC-007) auto-generates the handover narrative from live operational fields (PEWS, acuity, tasks, escalations, alerts) — op_patients holds no PHI, so the draft states operational facts and prompts the clinician for clinical background rather than fabricating demographics or diagnoses. Edits are versioned via the audited handover API and shareable to the <Link href="/supervisor/handover/incoming" className="text-emerald-700 hover:underline">Incoming Shift</Link> &amp; <Link href="/supervisor/handover/board" className="text-emerald-700 hover:underline">Board</Link>. Medication/lab feeds aren&apos;t in the operational store (honest). <Link href="/supervisor/handover" className="text-emerald-700 hover:underline">← Handover Centre</Link></p>
    </div>
  );
}
