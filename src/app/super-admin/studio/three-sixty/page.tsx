import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadThreeSixty } from "@/lib/studio/three-sixty";
import ThreeSixtyManager from "./ThreeSixtyManager";

// CST-041 — 360° Assessment Designer. Multisource-feedback templates with weighted respondent groups,
// rating scale and confidentiality settings (cst_360_assessments + cst_360_respondent_groups, migration
// 133). Respondent-group weights must sum to 100% before an assessment can be activated.

export const dynamic = "force-dynamic";

export default async function ThreeSixtyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ts = await loadThreeSixty(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-041 · 360° Assessment</p>
          <h1 className="text-xl font-bold text-gray-900">360° Assessment Designer</h1>
          <p className="text-gray-400 text-sm mt-0.5">Multisource feedback — configure weighted respondent groups, rating scale and confidentiality.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!ts.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-6 text-sm text-amber-800">Run migration 133 (<code className="text-[11px]">cst_360_assessments</code>) to enable the 360° Designer.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Assessments", value: ts.kpis.total, tone: "text-gray-900" },
              { label: "Active", value: ts.kpis.active, tone: "text-teal-600" },
              { label: "Draft", value: ts.kpis.draft, tone: "text-gray-500" },
              { label: "Weight-balanced", value: ts.kpis.balanced, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <ThreeSixtyManager assessments={ts.assessments} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Design here, collect elsewhere.</span> This designs the 360° instrument — respondent groups, weighting and confidentiality. Behaviour indicators are shared with the Professional Behaviour studio; live response collection, anonymity enforcement and the aggregated feedback report are the next-phase runtime layer.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
