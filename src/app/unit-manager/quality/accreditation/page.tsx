import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadAccreditationCenter } from "@/lib/super-admin/gov-accreditation";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, Donut, Rag, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Accreditation Readiness (UMG-QS-005) — reuses the Regulatory & Accreditation Center loader
// (loadAccreditationCenter / GOV-001.6): per-framework readiness computed from REAL self-assessments
// (gov_standard_assessments) against the EQOS standards catalogue, plus the surveys/inspections calendar and
// the regulatory obligations calendar. This is the enterprise accreditation programme (frameworks like JCI /
// SafeCare are org-level); the fuller assessment + evidence repository live in the accreditation workspace.
/* eslint-disable @typescript-eslint/no-explicit-any */
const pctTone = (p: number | null) => (p == null ? "text-gray-300" : p >= 85 ? "text-emerald-600" : p >= 70 ? "text-amber-600" : "text-rose-600");
const barTone = (p: number) => (p >= 85 ? "#10b981" : p >= 70 ? "#f59e0b" : "#ef4444");

export default async function AccreditationReadiness() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadAccreditationCenter(admin).catch(() => null) as any;

  const header = (
    <>
      <QHeader code="UMG-QS-005" title="Accreditation Readiness" subtitle="Framework readiness, surveys and the regulatory calendar · enterprise programme" />
      <QualityTabs />
    </>
  );

  if (!d || !d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Accreditation self-assessments not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 061 (gov_standard_assessments) and record framework self-assessments to compute readiness.</p></div></div>;

  const k = d.kpis;
  const assessedTotal = (k.met ?? 0) + (k.partially ?? 0) + (k.notMet ?? 0);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🏅" tint="bg-teal-50" label="Overall Readiness" value={k.overall != null ? `${k.overall}%` : "—"} tone={pctTone(k.overall)} sub="self-assessment" />
        <Kpi icon="✅" tint="bg-emerald-50" label="Met" value={k.met ?? 0} tone="text-emerald-600" sub="standards" />
        <Kpi icon="🟡" tint="bg-amber-50" label="Partially Met" value={k.partially ?? 0} tone="text-amber-600" sub="standards" />
        <Kpi icon="🔴" tint="bg-rose-50" label="Not Met" value={k.notMet ?? 0} tone={k.notMet ? "text-rose-600" : "text-gray-400"} sub="standards" />
        <Kpi icon="📄" tint="bg-sky-50" label="Evidence Gaps" value={k.evidenceGaps ?? 0} tone={k.evidenceGaps ? "text-amber-600" : "text-gray-400"} sub="no evidence" />
        <Kpi icon="📋" tint="bg-indigo-50" label="Open Actions" value={d.openActions ?? 0} sub="CAPA" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Overall Readiness</h3>
          <div className="flex items-center gap-4">
            <Donut pct={k.overall ?? 0} color="#14b8a6" center={k.overall != null ? `${k.overall}%` : "—"} sub="ready" />
            <div className="text-[11px] text-gray-600 space-y-1.5 min-w-0">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500" /><span className="text-gray-500">Met</span><b className="ml-auto tabular-nums text-gray-700">{k.met ?? 0}</b></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-amber-400" /><span className="text-gray-500">Partially met</span><b className="ml-auto tabular-nums text-gray-700">{k.partially ?? 0}</b></div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-rose-500" /><span className="text-gray-500">Not met</span><b className="ml-auto tabular-nums text-gray-700">{k.notMet ?? 0}</b></div>
              <div className="border-t border-gray-100 pt-1.5 flex items-center gap-1.5"><span className="text-gray-500">Not assessed</span><b className="ml-auto tabular-nums text-gray-500">{k.notAssessed ?? 0}</b></div>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Readiness = met (1) + partially-met (0.5) over {assessedTotal} assessed standards.</p>
        </div>

        <div className={`${qcard} p-5 xl:col-span-2`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Framework Readiness</h3>
          {d.perFramework.length ? <div className="space-y-3">{d.perFramework.map((f: any) => (
            <div key={f.id}>
              <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-700 font-medium">{f.code} <span className="text-gray-400 font-normal">{f.name}</span></span><b className={`tabular-nums ${pctTone(f.readiness)}`}>{f.readiness != null ? `${f.readiness}%` : "—"}</b></div>
              <div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${f.readiness ?? 0}%`, background: barTone(f.readiness ?? 0) }} /></div>
              <p className="text-[10px] text-gray-400 mt-0.5">{f.assessed}/{f.known} assessed · {f.met} met · {f.partially} partial · {f.notMet} not met</p>
            </div>
          ))}</div> : <p className="text-sm text-gray-400 py-8 text-center">No frameworks assessed yet.</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Upcoming Surveys</h3>
          {d.surveysReady && d.surveys.upcoming.length ? <div className="space-y-2">{d.surveys.upcoming.map((s: any) => (
            <div key={s.id} className="flex items-start gap-2 text-xs"><span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${s.dueSoon ? "bg-amber-400" : "bg-sky-400"}`} /><div className="min-w-0"><p className="text-gray-800 truncate">{s.title}</p><p className="text-[10px] text-gray-400">{s.fw ?? "—"} · {s.type} · {s.date ?? "unscheduled"}</p></div></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No upcoming surveys.{d.surveysReady ? "" : " (survey store not provisioned)"}</p>}
          {d.surveys.completed > 0 && <div className="mt-3 pt-2 border-t border-gray-100 flex gap-2 text-[10px]"><Rag tone="green" label={`${d.surveys.outcomes.passed} passed`} /><Rag tone="amber" label={`${d.surveys.outcomes.conditions} conditions`} /><Rag tone="red" label={`${d.surveys.outcomes.failed} failed`} /></div>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Regulatory Calendar</h3>
          {d.calendar.length ? <div className="space-y-2">{d.calendar.map((c: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs"><div className="min-w-0"><p className="text-gray-700 truncate">{c.title}</p><p className="text-[10px] text-gray-400 capitalize">{c.domain}</p></div><span className={`text-[10px] font-medium shrink-0 ${c.overdue ? "text-rose-600" : c.dueSoon ? "text-amber-600" : "text-gray-400"}`}>{c.date}</span></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No regulatory obligations due.</p>}
        </div>

        <div className={`${qcard} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Recent Assessments</h3>
          {d.recent.length ? <div className="space-y-1.5">{d.recent.map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between gap-2 text-xs py-0.5"><div className="min-w-0"><p className="text-gray-700 truncate">{r.fw} {r.ref}</p><p className="text-[10px] text-gray-400 truncate">{r.title ?? ""}</p></div><Rag tone={r.status === "met" ? "green" : r.status === "partially_met" ? "amber" : r.status === "not_met" ? "red" : "gray"} label={r.status.replace(/_/g, " ")} /></div>
          ))}</div> : <p className="text-sm text-gray-400 py-6 text-center">No assessments recorded.</p>}
        </div>
      </div>

      <div className="flex items-center gap-3"><CrossLink href="/quality-accreditation">Open the full accreditation workspace</CrossLink></div>

      <NextPhase>Accreditation Readiness (UMG-QS-005) reuses the Regulatory &amp; Accreditation Center: per-framework readiness computed from real self-assessments (gov_standard_assessments, migration 061) against the EQOS standards catalogue, the surveys/inspections register (gov_surveys) and the regulatory-obligations calendar. Accreditation frameworks (JCI, SafeCare, MOH) are an enterprise programme, so this is enterprise-scoped. Recording self-assessments and managing the evidence repository happen in the accreditation workspace. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
