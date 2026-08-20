import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadStandardSettings } from "@/lib/studio/standard-setting";
import StandardSettingManager from "./StandardSettingManager";
import { requireHqCapability } from "@/lib/hq/context";

// CST-044 — Assessment Standard Setting Studio. Defensible cut-score studies (Angoff family): record
// per-item judge ratings, compute the recommended cut, and see its real pass-rate impact against the
// linked bank's attempts (migration 132).

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function StandardSettingPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const ss = await loadStandardSettings(admin, profile?.hospital_id ?? null, true);
  const { data: bankData } = await admin.from("question_banks").select("id, name").eq("is_active", true).order("name").limit(400);
  const bankOptions = ((bankData ?? []) as any[]).map(b => ({ id: b.id, label: b.name }));

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-044 · Standard Setting</p>
          <h1 className="text-xl font-bold text-gray-900">Standard-Setting Studio</h1>
          <p className="text-gray-500 text-sm mt-0.5">Defensible cut scores — record judge ratings, compute the standard, and see its real pass-rate impact.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!ss.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 132 (<code className="text-[11px]">cst_standard_settings</code>) to enable Standard Setting.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Studies", value: ss.kpis.total, tone: "text-gray-900" },
              { label: "In progress", value: ss.kpis.active, tone: "text-[var(--cmp-text-warning)]" },
              { label: "Approved", value: ss.kpis.approved, tone: "text-teal-600" },
              { label: "Draft", value: ss.kpis.draft, tone: "text-gray-500" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-500 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <StandardSettingManager studies={ss.studies} bankOptions={bankOptions} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">How the cut is computed.</span> For the Angoff family, each judge rates the probability a minimally-competent candidate answers each item correctly (0–1). The recommended cut = mean of the per-item means × 100. Linking a question bank derives the real pass-rate impact from its attempts. Ebel / Bookmark / Borderline methods are recorded with the same rating capture; method-specific calculators are next-phase.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
