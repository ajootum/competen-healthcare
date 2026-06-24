import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function CompetenciesPage() {
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
    .select("id")
    .eq("hospital_id", hospitalId)
    .eq("role", "nurse");

  const nurseIds = nurses?.map(n => n.id) ?? [];
  const totalNurses = nurseIds.length;

  const [{ data: competencies }, { data: nurseComps }] = await Promise.all([
    supabase.from("competencies").select("id, name, category, expiry_months").order("category, name"),
    nurseIds.length > 0
      ? supabase.from("nurse_competencies").select("user_id, competency_id, status").in("user_id", nurseIds)
      : Promise.resolve({ data: [] as { user_id: string; competency_id: string; status: string }[] }),
  ]);

  const stats = (competencies ?? []).map(comp => {
    const entries = (nurseComps ?? []).filter(nc => nc.competency_id === comp.id);
    const competent   = entries.filter(e => e.status === "competent").length;
    const in_progress = entries.filter(e => e.status === "in_progress").length;
    const expired     = entries.filter(e => e.status === "expired").length;
    const pending     = entries.filter(e => e.status === "pending").length;
    const compliance  = totalNurses > 0 ? Math.round((competent / totalNurses) * 100) : 0;
    return { ...comp, competent, in_progress, expired, pending, total: entries.length, compliance };
  });

  const categories = [...new Set(stats.map(c => c.category))].sort();

  const overallCompliance = stats.length > 0
    ? Math.round(stats.reduce((s, c) => s + c.compliance, 0) / stats.length)
    : 0;

  const totalExpired   = stats.reduce((s, c) => s + c.expired, 0);
  const totalPending   = stats.reduce((s, c) => s + c.pending, 0);
  const fullyCompliant = stats.filter(c => c.compliance === 100).length;

  return (
    <div className="max-w-5xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Competency Matrix</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          {competencies?.length ?? 0} competencies · {totalNurses} nurses
        </p>
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: "Overall Compliance", value: `${overallCompliance}%`, color: overallCompliance >= 75 ? "text-green-600" : overallCompliance >= 50 ? "text-amber-500" : "text-red-500", icon: "📊" },
          { label: "Fully Compliant",    value: fullyCompliant,          color: "text-green-600",  icon: "✅" },
          { label: "Expired Records",    value: totalExpired,            color: "text-red-500",    icon: "🚨" },
          { label: "Pending Records",    value: totalPending,            color: "text-gray-500",   icon: "⏳" },
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

      {/* Per-category tables */}
      {categories.map(cat => {
        const catStats = stats.filter(c => c.category === cat);
        const catCompliance = catStats.length > 0
          ? Math.round(catStats.reduce((s, c) => s + c.compliance, 0) / catStats.length) : 0;

        return (
          <div key={cat} className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{cat}</h2>
              <span className={`text-xs font-bold ${catCompliance >= 75 ? "text-green-600" : catCompliance >= 50 ? "text-amber-600" : "text-red-500"}`}>
                {catCompliance}% category avg
              </span>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/50">
                    <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Competency</th>
                    <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Renewal</th>
                    <th className="text-center px-4 py-3 text-[10px] font-semibold text-green-400 uppercase tracking-wide">Competent</th>
                    <th className="text-center px-4 py-3 text-[10px] font-semibold text-blue-400 uppercase tracking-wide">In Progress</th>
                    <th className="text-center px-4 py-3 text-[10px] font-semibold text-red-400 uppercase tracking-wide">Expired</th>
                    <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Compliance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {catStats.map(comp => (
                    <tr key={comp.id} className="hover:bg-gray-50/40">
                      <td className="px-5 py-3 font-medium text-gray-900">{comp.name}</td>
                      <td className="px-4 py-3 text-center text-xs text-gray-400">{comp.expiry_months}mo</td>
                      <td className="px-4 py-3 text-center">
                        {comp.competent > 0
                          ? <span className="text-xs font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded">{comp.competent}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {comp.in_progress > 0
                          ? <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded">{comp.in_progress}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {comp.expired > 0
                          ? <span className="text-xs font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded">{comp.expired}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${comp.compliance >= 75 ? "bg-green-500" : comp.compliance >= 50 ? "bg-amber-400" : "bg-red-400"}`}
                              style={{ width: `${comp.compliance}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold ${comp.compliance >= 75 ? "text-green-600" : comp.compliance >= 50 ? "text-amber-600" : "text-red-500"}`}>
                            {comp.compliance}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
