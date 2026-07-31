import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadSimDelivery } from "@/lib/delivery/simulation-practice";

// CDP-005 — Clinical Simulation & Practice delivery (operator view). Practice participation + coverage by
// scenario type + follow-up. Real over cdp_sim_sessions (147). Super-admin, platform-wide. Learners log
// practice at /dashboard/simulation/practice.

export const dynamic = "force-dynamic";

export default async function SimDeliveryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadSimDelivery(admin, null, true);

  return (
    <div className="max-w-4xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-005 · Clinical Simulation & Practice</p>
          <h1 className="text-xl font-bold text-gray-900">Simulation Delivery</h1>
          <p className="text-gray-400 text-sm mt-0.5">Deliberate-practice participation and coverage — with structured debriefs and reinforcement follow-up.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Simulation practice isn&apos;t provisioned — apply migration 147 (<code className="text-[11px]">cdp_sim_sessions</code>).</p></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: "Practice sessions", value: q.kpis.sessions, tone: "text-gray-900" },
              { label: "Learners", value: q.kpis.learners, tone: "text-gray-900" },
              { label: "Flagged for practice", value: q.kpis.needsPractice, tone: "text-[var(--cmp-text-warning)]" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Coverage by scenario type</p></div>
              {q.types.length === 0 ? (
                <p className="text-xs text-gray-400 px-4 py-8 text-center">No practice sessions yet.</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {q.types.map(t => (
                    <div key={t.type} className="flex items-center gap-3 px-4 py-2.5">
                      <span className="text-sm text-gray-800 capitalize flex-1">{t.type.replace(/_/g, " ")}</span>
                      <span className="text-[11px] text-gray-400 shrink-0">{t.sessions}</span>
                      {t.needs > 0 && <span className="text-[9px] font-bold uppercase tracking-wide text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5 shrink-0">{t.needs} to practise</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Recent sessions</p></div>
              {q.recent.length === 0 ? (
                <p className="text-xs text-gray-400 px-4 py-8 text-center">—</p>
              ) : (
                <div className="divide-y divide-gray-50">
                  {q.recent.map((r, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-4 py-2.5">
                      <span className="text-sm text-gray-800 truncate flex-1">{r.scenario_name ?? "Practice session"}</span>
                      <span className={`text-[8px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${r.outcome === "needs_practice" ? "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]" : "text-teal-700 bg-teal-50 border-teal-100"}`}>{r.outcome === "needs_practice" ? "Practice" : "Done"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
