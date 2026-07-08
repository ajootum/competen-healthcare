import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

type NurseRow = { id: string; full_name: string; specialization: string | null };
type StudentRow = NurseRow & { enrolled: number; completed: number; avgProg: number; hours: number };

export default async function StudentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("hospital_id")
    .eq("id", user.id)
    .single();

  const hospitalId = profile?.hospital_id;

  const { data: nurses } = hospitalId
    ? await createAdminClient().from("profiles").select("id, full_name, specialization").eq("hospital_id", hospitalId).eq("role", "nurse")
    : { data: [] };

  const nurseIds = (nurses ?? []).map((n: NurseRow) => n.id);

  const [{ data: enrollments }, { data: cpd }] = await Promise.all([
    nurseIds.length
      ? supabase.from("course_enrollments")
          .select("user_id, course_id, completed_at, progress_pct")
          .in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; course_id: string; completed_at: string | null; progress_pct: number }[] }),
    nurseIds.length
      ? supabase.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; hours: number }[] }),
  ]);

  const rows = (nurses ?? []).map((n: NurseRow) => {
    const enrolled  = (enrollments ?? []).filter(e => e.user_id === n.id).length;
    const completed = (enrollments ?? []).filter(e => e.user_id === n.id && e.completed_at).length;
    const avgProg   = enrolled > 0
      ? Math.round((enrollments ?? []).filter(e => e.user_id === n.id).reduce((s, e) => s + (e.progress_pct ?? 0), 0) / enrolled)
      : 0;
    const hours = (cpd ?? []).filter(l => l.user_id === n.id).reduce((s, l) => s + Number(l.hours), 0);
    return { ...n, enrolled, completed, avgProg, hours };
  }).sort((a: StudentRow, b: StudentRow) => b.completed - a.completed);

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Student Progress</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {rows.length} nurse{rows.length !== 1 ? "s" : ""} in your hospital
        </p>
      </div>

      {!hospitalId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
          Link your account to a hospital to see student progress. Contact your hospital administrator.
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">📈</p>
          <p className="text-gray-500 text-sm">No nurses enrolled in courses yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurse</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Enrolled</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Completed</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Avg Progress</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CPD Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((n: StudentRow) => (
                <tr key={n.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {n.full_name[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{n.full_name}</p>
                        <p className="text-[10px] text-gray-400">{n.specialization ?? "General"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{n.enrolled}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-xs font-bold ${n.completed > 0 ? "text-green-600" : "text-gray-400"}`}>{n.completed}</span>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                      <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${n.avgProg >= 75 ? "bg-green-500" : n.avgProg >= 40 ? "bg-amber-400" : "bg-purple-400"}`}
                          style={{ width: `${n.avgProg}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-600">{n.avgProg}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-600">{n.hours.toFixed(0)}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
