import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export default async function AssessorNursesPage() {
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
    ? await supabase
        .from("profiles")
        .select("id, full_name, specialization, created_at, email")
        .eq("hospital_id", hospitalId)
        .eq("role", "nurse")
        .order("full_name")
    : { data: [] };

  const nurseIds = nurses?.map(n => n.id) ?? [];

  const [{ data: comps }, { data: cpd }] = await Promise.all([
    nurseIds.length
      ? supabase.from("nurse_competencies").select("user_id, status").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; status: string }[] }),
    nurseIds.length
      ? supabase.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; hours: number }[] }),
  ]);

  const rows = (nurses ?? []).map(n => {
    const nc = (comps ?? []).filter(c => c.user_id === n.id);
    const hours = (cpd ?? []).filter(l => l.user_id === n.id).reduce((s, l) => s + Number(l.hours), 0);
    return { ...n, competent: nc.filter(c => c.status === "competent").length, total: nc.length, hours };
  });

  return (
    <div className="max-w-4xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Nurses to Assess</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {rows.length} nurse{rows.length !== 1 ? "s" : ""} in your hospital
        </p>
      </div>

      {!hospitalId ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">
          Your assessor account is not linked to a hospital yet. Ask your hospital administrator to link you, or update your profile.
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">👩‍⚕️</p>
          <p className="text-gray-500 text-sm">No nurses in your hospital yet.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurse</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Specialization</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Competencies</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CPD Hours</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(nurse => (
                <tr key={nurse.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {nurse.full_name[0]}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{nurse.full_name}</p>
                        <p className="text-[10px] text-gray-400">{nurse.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">{nurse.specialization ?? "General"}</td>
                  <td className="px-4 py-3.5 text-xs text-gray-700">
                    {nurse.competent}/{nurse.total} competent
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-700">{nurse.hours.toFixed(0)}h</td>
                  <td className="px-4 py-3.5 text-right">
                    <Link href={`/dashboard/audit`}
                      className="text-xs text-indigo-600 border border-indigo-200 px-3 py-1 rounded-lg hover:bg-indigo-50 transition-colors">
                      Assess →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
