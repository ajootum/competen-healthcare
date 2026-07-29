import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { learnerPractice } from "@/lib/delivery/simulation-practice";
import PracticeLog from "./PracticeLog";

// CDP-005 — deliberate practice + debrief (learner). Log a simulation practice run with a structured debrief;
// "needs more practice" seeds a reinforcement card. Real over cdp_sim_sessions (147) + simulation_scenarios.

export const dynamic = "force-dynamic";

export default async function PracticePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("hospital_id").eq("id", user.id).maybeSingle();
  const hid = prof?.hospital_id ?? null;
  const [hist, scenRes] = await Promise.all([
    learnerPractice(admin, user.id),
    admin.from("simulation_scenarios").select("id, name, scenario_type").eq("status", "published").or(`hospital_id.eq.${hid ?? "00000000-0000-0000-0000-000000000000"},hospital_id.is.null`).order("name").limit(300),
  ]);
  const scenarios = (scenRes.data ?? []) as { id: string; name: string; scenario_type: string | null }[];

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-teal-600 uppercase tracking-widest mb-0.5">Simulation · Deliberate Practice</p>
          <h1 className="text-xl font-bold text-gray-900">Practice & Debrief</h1>
          <p className="text-gray-400 text-sm mt-0.5">Rehearse a scenario, then capture a quick debrief — what went well, what to work on, and a plan.</p>
        </div>
        <Link href="/dashboard/simulation" className="text-xs font-semibold text-gray-500 hover:text-teal-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Simulation</Link>
      </div>
      <PracticeLog scenarios={scenarios} initialHistory={hist.provisioned ? hist.sessions.map(s => ({ id: s.id, scenario_name: s.scenario_name, scenario_type: s.scenario_type, outcome: s.outcome, self_rating: s.self_rating, created_at: s.created_at })) : []} />
    </div>
  );
}
