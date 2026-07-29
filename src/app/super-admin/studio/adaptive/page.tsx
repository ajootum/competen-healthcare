import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAdaptiveExams } from "@/lib/studio/adaptive";
import AdaptiveManager from "./AdaptiveManager";

// CST-036 — Adaptive Examination Designer. Adaptive exam blueprints over a question-bank item pool
// (cst_adaptive_exams, migration 136): length, starting difficulty, mastery threshold and standard-error
// stopping rule. The blueprint's pool adequacy is checked against the bank's real item count. The
// adaptive delivery engine (real-time item selection) is the runtime layer that consumes these blueprints.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AdaptivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const ad = await loadAdaptiveExams(admin, profile?.hospital_id ?? null, true);
  const { data: bankData } = await admin.from("question_banks").select("id, name").eq("is_active", true).order("name").limit(400);
  const bankOptions = ((bankData ?? []) as any[]).map(b => ({ id: b.id, label: b.name }));

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-036 · Adaptive Examination</p>
          <h1 className="text-xl font-bold text-gray-900">Adaptive Exam Designer</h1>
          <p className="text-gray-400 text-sm mt-0.5">Blueprint adaptive exams — item pool, length, difficulty progression and mastery stopping rules.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!ad.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-6 text-sm text-amber-800">Run migration 136 (<code className="text-[11px]">cst_adaptive_exams</code>) to enable the Adaptive designer.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Adaptive exams", value: ad.kpis.total, tone: "text-gray-900" },
              { label: "Published", value: ad.kpis.active, tone: "text-teal-600" },
              { label: "Draft", value: ad.kpis.draft, tone: "text-gray-500" },
              { label: "Pool warnings", value: ad.kpis.poolWarnings, tone: ad.kpis.poolWarnings > 0 ? "text-amber-600" : "text-gray-300" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <AdaptiveManager exams={ad.exams} bankOptions={bankOptions} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Blueprint here, deliver at runtime.</span> This configures the adaptive exam — item pool, length bounds, starting difficulty, pass threshold and the standard-error stopping rule. Pool adequacy is checked against the bank&apos;s real item count. Real-time adaptive item selection, ability estimation and secure delivery are the next-phase runtime engine; item statistics come from the <Link href="/super-admin/studio/psychometrics" className="underline">Psychometrics studio</Link>.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
