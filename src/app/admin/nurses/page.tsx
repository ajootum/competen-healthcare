import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const CPD_TARGET = 30;

export default async function NursesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("hospital_id")
    .eq("id", user.id)
    .single();

  const hospitalId = profile?.hospital_id ?? "";

  const { data: nurses } = await supabase
    .from("profiles")
    .select("id, full_name, email, specialization, created_at")
    .eq("hospital_id", hospitalId)
    .eq("role", "nurse")
    .order("full_name");

  const nurseIds = nurses?.map(n => n.id) ?? [];

  const [{ data: nurseComps }, { data: cpdLogs }, { data: enrollments }] = await Promise.all([
    nurseIds.length > 0
      ? supabase.from("nurse_competencies").select("user_id, status, expiry_date").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; status: string; expiry_date: string | null }[] }),
    nurseIds.length > 0
      ? supabase.from("cpd_logs").select("user_id, hours").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; hours: number }[] }),
    nurseIds.length > 0
      ? supabase.from("course_enrollments").select("user_id, completed_at").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; completed_at: string | null }[] }),
  ]);

  const today   = new Date();
  const in60    = new Date(today.getTime() + 60 * 24 * 60 * 60 * 1000);

  const rows = (nurses ?? []).map(nurse => {
    const nc       = (nurseComps ?? []).filter(c => c.user_id === nurse.id);
    const cpd      = (cpdLogs ?? []).filter(l => l.user_id === nurse.id).reduce((s, l) => s + Number(l.hours), 0);
    const done     = (enrollments ?? []).filter(e => e.user_id === nurse.id && e.completed_at).length;
    const expiring = nc.filter(c => {
      if (!c.expiry_date) return false;
      const d = new Date(c.expiry_date);
      return d >= today && d <= in60;
    }).length;
    return {
      ...nurse,
      totalComps:     nc.length,
      competentComps: nc.filter(c => c.status === "competent").length,
      expiredComps:   nc.filter(c => c.status === "expired").length,
      expiringComps:  expiring,
      cpdHours:       cpd,
      coursesCompleted: done,
    };
  });

  const onTrack    = rows.filter(n => n.cpdHours >= CPD_TARGET).length;
  const atRisk     = rows.filter(n => n.cpdHours < 10).length;
  const withExpiring = rows.filter(n => n.expiringComps > 0).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Nurse Roster</h1>
          <p className="text-gray-400 text-sm mt-0.5">{nurses?.length ?? 0} nurses linked to your hospital</p>
        </div>
        <a href="/admin/invite"
          className="flex items-center gap-2 text-xs bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors font-medium">
          ➕ Invite Nurse
        </a>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Total Nurses",     value: nurses?.length ?? 0, color: "text-teal-600",  icon: "👩‍⚕️" },
          { label: "On CPD Target",    value: onTrack,             color: "text-green-600", icon: "✅" },
          { label: "At Risk (<10h)",   value: atRisk,              color: "text-red-500",   icon: "⚠️" },
          { label: "Certs Expiring",   value: withExpiring,        color: "text-amber-500", icon: "📋" },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-4 border border-gray-100">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide">{s.label}</p>
              <span className="text-base">{s.icon}</span>
            </div>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 text-sm">All Nurses</h2>
        </div>

        {rows.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <p className="text-3xl mb-3">👩‍⚕️</p>
            <p className="text-sm font-medium">No nurses linked yet</p>
            <p className="text-xs mt-1">Share your hospital ID so nurses can link their accounts.</p>
            <a href="/admin/invite" className="mt-4 inline-block text-sm text-teal-600 hover:underline">Invite a nurse →</a>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurse</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Ward</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">CPD Hours</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Competencies</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Courses</th>
                  <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(nurse => {
                  const pct = Math.min(Math.round((nurse.cpdHours / CPD_TARGET) * 100), 100);
                  const status = nurse.cpdHours >= CPD_TARGET ? { label: "On Target",    cls: "bg-green-100 text-green-700" }
                    : nurse.cpdHours >= 15                    ? { label: "In Progress",  cls: "bg-blue-100 text-blue-700" }
                    : nurse.cpdHours > 0                      ? { label: "Behind",       cls: "bg-amber-100 text-amber-700" }
                    : { label: "Not Started", cls: "bg-red-100 text-red-600" };
                  return (
                    <tr key={nurse.id} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {nurse.full_name[0]}
                          </div>
                          <div>
                            <p className="font-medium text-gray-900 text-sm">{nurse.full_name}</p>
                            {nurse.expiringComps > 0 && (
                              <p className="text-[10px] text-amber-600">⚠️ {nurse.expiringComps} cert{nurse.expiringComps > 1 ? "s" : ""} expiring soon</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-500">{nurse.specialization ?? "General"}</td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : pct >= 50 ? "bg-blue-400" : "bg-amber-400"}`}
                              style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-gray-700 font-medium">{nurse.cpdHours.toFixed(0)}h</span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-0.5">{pct}% of {CPD_TARGET}h target</p>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-xs text-gray-700">{nurse.competentComps}/{nurse.totalComps} competent</span>
                        {nurse.expiredComps > 0 && (
                          <p className="text-[10px] text-red-500">{nurse.expiredComps} expired</p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-700">{nurse.coursesCompleted} completed</td>
                      <td className="px-4 py-3.5">
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded ${status.cls}`}>{status.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
