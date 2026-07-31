import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadReinforcementQueue } from "@/lib/delivery/reinforcement";
import ReinforcementGenerator from "./ReinforcementGenerator";

// CDP-004 — Reinforcement coverage (operator view). Spaced-repetition reach across the workforce + a control
// to generate cards from achieved competency decisions. The learner review loop lives at /dashboard/reinforcement.

export const dynamic = "force-dynamic";

export default async function ReinforcementAdminPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const q = await loadReinforcementQueue(admin, null, true);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-004 · Microlearning & Reinforcement</p>
          <h1 className="text-xl font-bold text-gray-900">Reinforcement</h1>
          <p className="text-gray-400 text-sm mt-0.5">Spaced-repetition retrieval practice (SM-2) that keeps achieved competencies from decaying.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Reinforcement isn&apos;t provisioned — apply migration 143 (<code className="text-[11px]">cdp_reinforcement_cards</code>).</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            {[
              { label: "Review cards", value: q.kpis.total, tone: "text-gray-900" },
              { label: "Due today", value: q.kpis.due, tone: "text-violet-600" },
              { label: "Mastered", value: q.kpis.mastered, tone: "text-[var(--cmp-text-success)]" },
              { label: "Learners covered", value: q.kpis.learners, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">Generate reinforcement</h2>
                <p className="text-[11px] text-gray-400">Creates one review card per learner + achieved competency (from competency decisions). Idempotent — existing cards are left alone. Learners review due cards at <code className="text-[10px]">/dashboard/reinforcement</code>.</p>
              </div>
              <ReinforcementGenerator />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">Coverage by competency · {q.subjects.length} subject{q.subjects.length === 1 ? "" : "s"}</p></div>
            {q.subjects.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-8 text-center">No cards yet. Generate from achievements to start reinforcing retained competencies.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.subjects.map(s => (
                  <div key={s.subject} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="text-sm font-medium text-gray-800 truncate flex-1">{s.subject}</span>
                    <span className="text-[11px] text-gray-400 shrink-0">{s.cards} card{s.cards === 1 ? "" : "s"}</span>
                    {s.due > 0 && <span className="text-[9px] font-bold uppercase tracking-wide text-violet-700 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5 shrink-0">{s.due} due</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
