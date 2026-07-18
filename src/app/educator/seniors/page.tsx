import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import SeniorToggle from "./SeniorToggle";

// Senior Assessors (Evidence Validation Centre escalation model): educators
// assign which assessors handle escalated evidence. Changes are audit-logged
// and the assessor is notified.

export default async function SeniorAssessorsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const admin = createAdminClient();
  const { data: me } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = me?.roles?.length ? me.roles : [me?.role].filter(Boolean) as string[];
  if (!roles.some(r => ["educator", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { data } = await admin.from("profiles")
    .select("id, full_name, role, roles, is_senior_assessor, avatar_url")
    .eq("hospital_id", me?.hospital_id ?? "")
    .order("full_name").limit(200);
  const assessors = (data ?? []).filter(p => {
    const r: string[] = p.roles?.length ? p.roles : [p.role].filter(Boolean);
    return r.some(x => ["assessor", "educator"].includes(x));
  });
  const seniors = assessors.filter(a => a.is_senior_assessor);

  return (
    <div className="max-w-3xl">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">Senior Assessors</h1>
        <p className="text-gray-400 text-sm mt-0.5">
          Escalated evidence can only be decided by senior assessors. {seniors.length} of {assessors.length} assessor{assessors.length === 1 ? "" : "s"} currently senior.
        </p>
      </div>

      {seniors.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4 text-xs text-amber-800">
          ⚠️ No senior assessors yet — escalated evidence will wait until you appoint at least one
          (hospital admins can also decide escalations).
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {assessors.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-gray-400">No assessors linked to your hospital yet.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {assessors.map(a => (
              <div key={a.id} className="px-5 py-3 flex items-center gap-3">
                {a.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- avatar from storage
                  <img src={a.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                ) : (
                  <span className="w-9 h-9 rounded-full bg-purple-100 text-purple-700 text-xs font-bold flex items-center justify-center shrink-0">
                    {a.full_name?.[0] ?? "?"}
                  </span>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">
                    {a.full_name}{a.is_senior_assessor && <span className="ml-2 text-[9px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded align-middle">⭐ SENIOR</span>}
                  </p>
                  <p className="text-[10px] text-gray-400 capitalize">{(a.roles?.length ? a.roles : [a.role]).join(", ").replace(/_/g, " ")}</p>
                </div>
                <SeniorToggle userId={a.id} senior={!!a.is_senior_assessor} />
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-300 mt-4">
        Assignments are audit-logged and the assessor is notified. Hospital admins always count as seniors for escalations.
      </p>
    </div>
  );
}
