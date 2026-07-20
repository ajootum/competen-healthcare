import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Organisation Structure (ADM-002) — organisation → facilities → departments.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function OrgStructurePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { summary, facilities, departments } = d;
  const deptsByHosp = new Map<string, any[]>();
  for (const dep of departments) { const a = deptsByHosp.get(dep.hospital_id) ?? []; a.push(dep); deptsByHosp.set(dep.hospital_id, a); }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Organisation Structure</h1>
          <p className="text-sm text-gray-500 mt-1">Organisation → facilities → departments.</p>
        </div>
        <Link href="/admin/departments" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Manage departments →</Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.facilities}</div><div className="text-xs text-gray-500 mt-1">Facilities</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.departments}</div><div className="text-xs text-gray-500 mt-1">Departments</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.users}</div><div className="text-xs text-gray-500 mt-1">Users</div></div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-4">
          <span className="text-lg">🏛️</span>
          <h3 className="font-semibold text-gray-900">{summary.orgName}</h3>
          <span className="text-xs text-gray-400">· {summary.facilities} facilit{summary.facilities !== 1 ? "ies" : "y"}</span>
        </div>
        {facilities.length === 0 && <p className="text-sm text-gray-400">No facilities configured.</p>}
        <div className="space-y-4">
          {facilities.map((f) => {
            const ds = deptsByHosp.get(f.id) ?? [];
            return (
              <div key={f.id} className="border-l-2 border-teal-100 pl-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-sm font-semibold text-gray-800">🏥 {f.name ?? "Unnamed facility"}</span>
                  <span className="text-xs text-gray-400">{[f.city, f.country].filter(Boolean).join(", ")}</span>
                  {f.tier && <span className="text-[10px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">{f.tier}</span>}
                  <span className="ml-auto text-xs text-gray-400 tabular-nums">{f.users} user{f.users !== 1 ? "s" : ""}</span>
                </div>
                {ds.length === 0 ? (
                  <p className="text-xs text-gray-300 ml-4">No departments</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 ml-4">
                    {ds.map((dep) => (
                      <span key={dep.id} className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-gray-600">
                        🏢 {dep.name}{dep.specialty ? <span className="text-gray-400"> · {dep.specialty}</span> : null}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {summary.usersUnattached > 0 && <p className="text-[11px] text-amber-600">{summary.usersUnattached} user{summary.usersUnattached !== 1 ? "s" : ""} not mapped to a listed facility — included in the Users total but not shown under any facility above.</p>}
    </div>
  );
}
