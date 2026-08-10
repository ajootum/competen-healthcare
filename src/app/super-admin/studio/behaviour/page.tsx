import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadBehaviour } from "@/lib/studio/behaviour";
import BehaviourManager from "./BehaviourManager";
import { requireHqCapability } from "@/lib/hq/context";

// CST-040 — Professional Behaviour Assessment Studio. Behaviour-indicator designer across the professional
// domains (cst_behaviour_assessments + cst_behaviour_indicators, migration 134). Each indicator is an
// observable behaviour with positive/negative anchors and an optional critical flag (BARS by default).

export const dynamic = "force-dynamic";

export default async function BehaviourPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  await requireHqCapability("hq.learning.studio.view");

  const bh = await loadBehaviour(admin, profile?.hospital_id ?? null, true);

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-rose-500 uppercase tracking-widest mb-0.5">CST-040 · Professional Behaviour</p>
          <h1 className="text-xl font-bold text-gray-900">Behaviour Assessment Studio</h1>
          <p className="text-gray-400 text-sm mt-0.5">Design observable behaviour indicators across professionalism, communication, teamwork, leadership and ethics.</p>
        </div>
        <Link href="/super-admin/studio/assessment" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2">← Assessment</Link>
      </div>

      {!bh.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Run migration 134 (<code className="text-[11px]">cst_behaviour_assessments</code>) to enable the Behaviour designer.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Assessments", value: bh.kpis.total, tone: "text-gray-900" },
              { label: "Active", value: bh.kpis.active, tone: "text-teal-600" },
              { label: "Draft", value: bh.kpis.draft, tone: "text-gray-500" },
              { label: "Indicators", value: bh.kpis.indicators, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <BehaviourManager assessments={bh.assessments} />

          <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-teal-900">
              <span className="font-bold">Design here, observe elsewhere.</span> This authors the behaviour instrument — observable indicators, anchors and critical behaviours. Live observation capture, multi-source behaviour ratings and the development/coaching report are the next-phase runtime; the behaviour indicators are also available to the 360° designer.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
