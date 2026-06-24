import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

const ROLE_BADGE: Record<string, string> = {
  nurse:          "bg-teal-100 text-teal-700",
  assessor:       "bg-indigo-100 text-indigo-700",
  educator:       "bg-purple-100 text-purple-700",
  hospital_admin: "bg-amber-100 text-amber-700",
  super_admin:    "bg-rose-100 text-rose-700",
};

const ROLE_LABELS: Record<string, string> = {
  nurse:          "Nurse",
  assessor:       "Assessor",
  educator:       "Educator",
  hospital_admin: "Hospital Admin",
  super_admin:    "Super Admin",
};

export default async function AllUsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profiles } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, specialization, hospital_id, created_at")
    .order("created_at", { ascending: false });

  const { data: hospitals } = await supabase
    .from("hospitals")
    .select("id, name");

  const hospitalMap = Object.fromEntries((hospitals ?? []).map(h => [h.id, h.name]));

  const roleCounts = (profiles ?? []).reduce((acc, p) => {
    acc[p.role] = (acc[p.role] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">All Users</h1>
        <p className="text-gray-400 text-sm mt-0.5">{profiles?.length ?? 0} users registered on the platform</p>
      </div>

      {/* Role summary */}
      <div className="flex flex-wrap gap-2 mb-6">
        {Object.entries(ROLE_LABELS).map(([role, label]) => (
          <div key={role} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold ${ROLE_BADGE[role]}`}>
            <span>{label}</span>
            <span className="font-bold">({roleCounts[role] ?? 0})</span>
          </div>
        ))}
      </div>

      {!profiles?.length ? (
        <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
          <p className="text-3xl mb-3">👥</p>
          <p className="text-gray-500 text-sm">No users found. Check RLS policies for super_admin access.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">User</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Role</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Hospital</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Specialization</th>
                <th className="text-right px-5 py-3 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Joined</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {profiles.map(p => (
                <tr key={p.id} className="hover:bg-gray-50/40">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${ROLE_BADGE[p.role]?.replace("text-", "bg-").replace("-100", "-500") ?? "bg-gray-400"}`}>
                        {p.full_name?.[0] ?? "?"}
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{p.full_name}</p>
                        <p className="text-[10px] text-gray-400">{p.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${ROLE_BADGE[p.role] ?? "bg-gray-100 text-gray-600"}`}>
                      {ROLE_LABELS[p.role] ?? p.role}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">
                    {p.hospital_id ? (hospitalMap[p.hospital_id] ?? "Linked") : "—"}
                  </td>
                  <td className="px-4 py-3.5 text-xs text-gray-500">{p.specialization ?? "—"}</td>
                  <td className="px-5 py-3.5 text-right text-xs text-gray-400">
                    {new Date(p.created_at).toLocaleDateString()}
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
