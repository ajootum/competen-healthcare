import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import QualityTabs from "../QualityTabs";
import { qcard, QHeader, Kpi, NextPhase, CrossLink } from "../widgets";

export const dynamic = "force-dynamic";

// Mortality & Morbidity (UMG-QS-009). A structured M&M review programme (case registration, review meetings,
// learning points, action tracking) needs its own store, which is honestly next-phase. In the meantime this
// surfaces the REAL M&M candidate pool from the incident register (op_incidents) — sentinel events and
// critical-severity incidents, the cases an M&M panel would review — so the module is useful today without
// fabricating a review workflow. Fail-soft.
/* eslint-disable @typescript-eslint/no-explicit-any */
const NONE = "00000000-0000-0000-0000-000000000000";
const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));
const TYPE_LABEL: Record<string, string> = { medication: "Medication", falls: "Falls", equipment: "Equipment", pressure_injury: "Pressure Injury", infection: "Infection / HAI", behaviour: "Behaviour", documentation: "Documentation", sentinel: "Sentinel", other: "Other" };

export default async function MortalityMorbidity() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  // Real M&M candidate pool — sentinel events + critical-severity incidents.
  const res = await scope(admin.from("op_incidents")
    .select("id, incident_type, severity, status, description, corrective_action, created_at, op_patients!patient_id(label)")
    .or("severity.eq.critical,incident_type.eq.sentinel"))
    .order("created_at", { ascending: false }).limit(200);
  const provisioned = !(res.error && missing(res.error));
  const cases = (res.error ? [] : res.data ?? []) as any[];
  const open = cases.filter(c => c.status !== "closed");
  const sentinel = cases.filter(c => c.incident_type === "sentinel");
  const reviewed = cases.filter(c => c.corrective_action);
  const pendingReview = open.filter(c => !c.corrective_action);

  const header = (
    <>
      <QHeader code="UMG-QS-009" title="Mortality & Morbidity" subtitle="Sentinel and critical-incident review candidates" />
      <QualityTabs />
    </>
  );

  return (
    <div className="space-y-4">
      {header}

      <div className="bg-sky-50 border border-sky-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-sky-900">Next-phase module — surfacing the live candidate pool now</p>
        <p className="text-xs text-sky-700 mt-0.5">The structured M&amp;M review programme (case registration, review-meeting minutes, learning points and action tracking) needs its own store and is honestly next-phase. Meanwhile, the cases an M&amp;M panel would review — sentinel events and critical-severity incidents from the incident register — are shown below, real.</p>
      </div>

      {!provisioned ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Incident register not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration 073 (op_incidents) to surface the M&amp;M candidate pool.</p></div>
      ) : (<>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Kpi icon="🕯️" tint="bg-rose-50" label="Sentinel Events" value={sentinel.length} tone={sentinel.length ? "text-rose-600" : "text-gray-400"} sub="all-time" />
          <Kpi icon="❗" tint="bg-orange-50" label="Critical Incidents" value={cases.length} sub="review candidates" />
          <Kpi icon="⏳" tint="bg-amber-50" label="Pending Review" value={pendingReview.length} tone={pendingReview.length ? "text-amber-600" : "text-gray-400"} sub="no action recorded" />
          <Kpi icon="✅" tint="bg-emerald-50" label="With Learning/Action" value={reviewed.length} sub="corrective action" />
        </div>

        <div className={`${qcard} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Review Candidates <span className="text-[10px] text-gray-400 font-normal">sentinel &amp; critical incidents</span></h3><CrossLink href="/supervisor/quality-safety">Incident register</CrossLink></div>
          {cases.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400 border-b border-gray-100"><th className="py-1.5 font-medium">Type</th><th className="py-1.5 font-medium">Description</th><th className="py-1.5 font-medium">Patient</th><th className="py-1.5 font-medium">Status</th><th className="py-1.5 font-medium">Review</th><th className="py-1.5 font-medium text-right">Date</th></tr></thead>
                <tbody>{cases.slice(0, 20).map((c: any) => (
                  <tr key={c.id} className="border-b border-gray-50">
                    <td className="py-2 whitespace-nowrap">{c.incident_type === "sentinel" ? <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 bg-rose-100 text-rose-700">Sentinel</span> : <span className="text-gray-700">{TYPE_LABEL[c.incident_type] ?? c.incident_type}</span>}</td>
                    <td className="py-2 text-gray-600 max-w-[240px] truncate" title={c.description}>{c.description}</td>
                    <td className="py-2 text-gray-500">{c.op_patients?.label ?? "—"}</td>
                    <td className="py-2 text-gray-500 capitalize">{(c.status ?? "").replace("_", " ")}</td>
                    <td className="py-2">{c.corrective_action ? <span className="text-[10px] text-emerald-600">✓ actioned</span> : <span className="text-[10px] text-amber-500">pending</span>}</td>
                    <td className="py-2 text-right text-gray-400 tabular-nums">{(c.created_at ?? "").slice(0, 10)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-gray-400 py-8 text-center">No sentinel or critical incidents on record. 🎉</p>}
        </div>
      </>)}

      <NextPhase>Mortality &amp; Morbidity (UMG-QS-009). The structured M&amp;M review programme (case registration, review-meeting minutes, learning points and action tracking) needs its own store and is honestly next-phase. Shown now, real: the M&amp;M candidate pool from the incident register (op_incidents) — sentinel events and critical-severity incidents, with their review/action status. Gate hospital_admin/super_admin.</NextPhase>
    </div>
  );
}
