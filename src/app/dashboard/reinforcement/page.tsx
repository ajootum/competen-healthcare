import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { learnerReinforcement } from "@/lib/delivery/reinforcement";
import ReinforcementReview from "./ReinforcementReview";

// CDP-004 — learner reinforcement. Spaced-repetition review of achieved competencies so they're retained.
// The cards are generated (from your competency decisions) by the delivery platform; here you review the ones
// due today. Real over cdp_reinforcement_cards (143).

export const dynamic = "force-dynamic";

export default async function ReinforcementPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const r = await learnerReinforcement(admin, user.id);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <p className="text-[11px] font-semibold text-teal-600 uppercase tracking-widest mb-0.5">Microlearning · Reinforcement</p>
        <h1 className="text-xl font-bold text-gray-900">Keep it sharp</h1>
        <p className="text-gray-400 text-sm mt-0.5">Short daily retrieval practice on competencies you&apos;ve achieved — spaced so they stick.</p>
      </div>

      {!r.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4"><p className="text-[13px] text-amber-900">Reinforcement isn&apos;t provisioned yet (migration 143). Once the delivery platform generates your cards, they&apos;ll appear here.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-teal-600">{r.stats.dueNow}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5">Due today</p></div>
            <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-gray-900">{r.stats.total}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5">Total cards</p></div>
            <div className="bg-white rounded-xl border border-gray-100 p-3.5"><p className="text-xl font-bold text-[var(--cmp-text-success)]">{r.stats.mastered}</p><p className="text-[10px] text-gray-400 font-medium mt-0.5">Mastered</p></div>
          </div>
          <ReinforcementReview initial={r.due.map(c => ({ id: c.id, subject: c.subject, prompt: c.prompt }))} />
        </>
      )}
    </div>
  );
}
