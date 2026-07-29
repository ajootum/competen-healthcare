import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { listAdaptiveExams } from "@/lib/delivery/adaptive";
import AdaptiveExam from "./AdaptiveExam";

// CDP-003 — adaptive exams (learner). A computerised adaptive test: it picks each next question for your
// current ability and stops as soon as it's measured you precisely enough. Real over cst_adaptive_exams (136)
// + a question bank + cdp_adaptive_sessions (146).

export const dynamic = "force-dynamic";

export default async function AdaptivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: prof } = await admin.from("profiles").select("hospital_id").eq("id", user.id).maybeSingle();
  const q = await listAdaptiveExams(admin, user.id, prof?.hospital_id ?? null);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <p className="text-[11px] font-semibold text-violet-600 uppercase tracking-widest mb-0.5">Adaptive Learning</p>
        <h1 className="text-xl font-bold text-gray-900">Adaptive Exams</h1>
        <p className="text-gray-400 text-sm mt-0.5">Fewer questions, sharper measurement — the test adapts to your answers as you go.</p>
      </div>
      {!q.provisioned ? (
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-4"><p className="text-[13px] text-amber-900">Adaptive exams aren&apos;t provisioned yet (migrations 136 + 146).</p></div>
      ) : (
        <AdaptiveExam exams={q.exams} />
      )}
    </div>
  );
}
