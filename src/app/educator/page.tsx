import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

const SCORE_COLORS = ["#ef4444","#f97316","#eab308","#14b8a6","#0d9488","#3b82f6","#8b5cf6"];
const SCORE_LABELS = ["Training Required","Novice","Advanced Beginner","Competent","Competent+","Proficient","Expert"];

export default async function EducatorDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await createAdminClient().from("profiles").select("role, hospital_id, full_name").eq("id", user.id).single();
  if (!profile || !["educator","hospital_admin","super_admin"].includes(profile.role)) redirect("/dashboard");

  const admin = createAdminClient();

  const { data: hospitalNurses } = await admin
    .from("profiles")
    .select("id")
    .eq("hospital_id", profile.hospital_id ?? "")
    .eq("role", "nurse");

  const nurseIds = (hospitalNurses ?? []).map(n => n.id);

  const { data: pending } = nurseIds.length ? await admin
    .from("competency_scores")
    .select(`
      id, competency_id, cycle_id, nurse_id, score, label, is_passing, assessed_at,
      profiles!nurse_id(full_name),
      framework_competencies!competency_id(
        name,
        framework_domains(name, frameworks(name))
      )
    `)
    .eq("educator_validated", false)
    .in("nurse_id", nurseIds)
    .order("assessed_at") : { data: [] };

  const monthAgo = new Date(); monthAgo.setDate(monthAgo.getDate() - 30);
  const { data: recentValidated } = nurseIds.length ? await admin
    .from("competency_scores")
    .select(`
      id, competency_id, nurse_id, score, is_passing, assessed_at,
      profiles!nurse_id(full_name),
      framework_competencies!competency_id(name, framework_domains(name))
    `)
    .eq("educator_validated", true)
    .in("nurse_id", nurseIds)
    .gte("assessed_at", monthAgo.toISOString())
    .order("assessed_at", { ascending: false })
    .limit(20) : { data: [] };

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Educator Validation</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {(pending ?? []).length} score{(pending ?? []).length !== 1 ? "s" : ""} awaiting your review
        </p>
      </div>

      <div className="mb-8">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
          Awaiting Validation ({(pending ?? []).length})
        </h2>
        {(pending ?? []).length > 0 ? (
          <div className="flex flex-col gap-2">
            {(pending ?? []).map(cs => {
              const nurse = cs.profiles as unknown as { full_name: string } | null;
              const comp = cs.framework_competencies as unknown as {
                name: string;
                framework_domains: { name: string; frameworks: { name: string } | null } | null
              } | null;
              return (
                <div key={cs.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm"
                      style={{ backgroundColor: SCORE_COLORS[cs.score] ?? "#9ca3af" }}>
                      {cs.score}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-gray-900">{comp?.name}</p>
                      <p className="text-[10px] text-gray-400">
                        {comp?.framework_domains?.frameworks?.name} · {comp?.framework_domains?.name}
                      </p>
                      <p className="text-[10px] text-teal-600 mt-0.5">
                        {nurse?.full_name} · {SCORE_LABELS[cs.score] ?? "—"} · {new Date(cs.assessed_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cs.is_passing ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"}`}>
                      {cs.is_passing ? "Pass" : "Fail"}
                    </span>
                    <Link href={`/educator/validate/${cs.competency_id}?cycle=${cs.cycle_id}&nurse=${cs.nurse_id}`}
                      className="px-4 py-2 bg-teal-600 text-white text-xs font-semibold rounded-lg hover:bg-teal-700">
                      Review →
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-100 p-8 text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="text-gray-600 font-medium">All up to date</p>
            <p className="text-gray-400 text-sm mt-1">No assessments awaiting validation.</p>
          </div>
        )}
      </div>

      {(recentValidated ?? []).length > 0 && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Recently Validated</h2>
          <div className="flex flex-col gap-2">
            {(recentValidated ?? []).map(cs => {
              const nurse = cs.profiles as unknown as { full_name: string } | null;
              const comp = cs.framework_competencies as unknown as { name: string; framework_domains: { name: string } | null } | null;
              return (
                <div key={cs.id} className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-4">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                    style={{ backgroundColor: SCORE_COLORS[cs.score] ?? "#9ca3af" }}>{cs.score}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800">{comp?.name}</p>
                    <p className="text-[10px] text-gray-400">{nurse?.full_name} · {comp?.framework_domains?.name}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${cs.is_passing ? "bg-green-50 text-green-600" : "bg-red-50 text-red-500"}`}>
                      {cs.is_passing ? "Pass" : "Fail"}
                    </span>
                    <span className="text-[10px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded font-semibold">✓ Validated</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
