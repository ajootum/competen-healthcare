import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export default async function AllHospitalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: hospitals } = await supabase
    .from("hospitals")
    .select("id, name, city, country, tier, created_at")
    .order("created_at", { ascending: false });

  const { data: profiles } = await supabase
    .from("profiles")
    .select("hospital_id, role");

  const rows = (hospitals ?? []).map(h => {
    const hp = (profiles ?? []).filter(p => p.hospital_id === h.id);
    return {
      ...h,
      nurses:    hp.filter(p => p.role === "nurse").length,
      assessors: hp.filter(p => p.role === "assessor").length,
      educators: hp.filter(p => p.role === "educator").length,
      admins:    hp.filter(p => p.role === "hospital_admin").length,
    };
  });

  const tierBadge: Record<string, string> = {
    free:         "bg-gray-100 text-gray-600",
    professional: "bg-blue-100 text-blue-700",
    enterprise:   "bg-purple-100 text-purple-700",
  };

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">All Hospitals</h1>
          <p className="text-gray-400 text-sm mt-0.5">{rows.length} hospital{rows.length !== 1 ? "s" : ""} registered</p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">🏥</p>
          <p className="text-gray-500 text-sm">No hospitals found. Check RLS policies — super_admin needs read access to hospitals table.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Hospital</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Location</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Plan</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Nurses</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Assessors</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Educators</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map(h => (
                <tr key={h.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <p className="font-medium text-gray-900">{h.name}</p>
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{h.id.slice(0, 8)}…</p>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">
                    {h.city ? `${h.city}, ` : ""}{h.country}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded capitalize ${tierBadge[h.tier] ?? "bg-gray-100 text-gray-600"}`}>
                      {h.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-700 font-medium">{h.nurses}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-700">{h.assessors}</td>
                  <td className="px-4 py-3.5 text-center text-xs text-gray-700">{h.educators}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-gray-400">
                    {new Date(h.created_at).toLocaleDateString()}
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
