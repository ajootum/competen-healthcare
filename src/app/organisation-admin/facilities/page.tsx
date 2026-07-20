import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Facilities (ADM-003) — the organisation's hospitals / sites.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";

export default async function FacilitiesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { summary, facilities } = d;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Facilities</h1>
        <p className="text-sm text-gray-500 mt-1">{summary.facilities} facilit{summary.facilities !== 1 ? "ies" : "y"} in {summary.orgName} · departments and headcount per site.</p>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Facility</th><th className="pr-3">Location</th><th className="pr-3">Tier</th><th className="pr-3 text-right">Departments</th><th className="pr-3 text-right">Users</th></tr></thead>
            <tbody>
              {facilities.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No facilities found.</td></tr>}
              {facilities.map((f) => (
                <tr key={f.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{f.name ?? "Unnamed facility"}</td>
                  <td className="pr-3 text-gray-500">{[f.city, f.country].filter(Boolean).join(", ") || "—"}</td>
                  <td className="pr-3">{f.tier ? <span className="text-[10px] bg-gray-100 text-gray-600 rounded-full px-2 py-0.5">{f.tier}</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="pr-3 text-right tabular-nums text-gray-600">{f.depts}</td>
                  <td className="pr-3 text-right tabular-nums text-gray-600">{f.users}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {summary.usersUnattached > 0 && <p className="text-[11px] text-amber-600">{summary.usersUnattached} user{summary.usersUnattached !== 1 ? "s are" : " is"} not mapped to a listed facility (no facility set, or a facility beyond the displayed set), so the per-facility user counts sum to less than the total.</p>}
      <p className="text-[11px] text-gray-400">Facilities and their organisation membership are provisioned in the Platform Super Admin workspace. Departments within each facility are managed under <Link href="/admin/departments" className="text-teal-600 hover:underline">Departments</Link>.</p>
    </div>
  );
}
