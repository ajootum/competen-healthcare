import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadOrgAdminDashboard } from "@/lib/org-admin-data";

export const dynamic = "force-dynamic";

// Users (ADM-005) — the organisation's user directory.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const titleCase = (s: string) => s.split(/[_\s]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");
const appRoleLabel = (p: any) => {
  const rs: string[] = (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
  if (rs.includes("super_admin")) return "Super Admin";
  if (rs.includes("hospital_admin")) return "Admin";
  if (rs.includes("educator")) return "Educator";
  if (rs.includes("assessor")) return "Assessor";
  if (rs.includes("nurse")) return "Healthcare worker";
  return rs[0] ? titleCase(rs[0]) : "—";
};

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadOrgAdminDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { summary, profiles, facilities, users } = d;
  const facName = new Map<string, string>(facilities.map((f) => [f.id, f.name ?? "—"]));
  const rows = profiles.slice(0, 500);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-sm text-gray-500 mt-1">{summary.users} accounts in {summary.orgName} · {users.assignedOrgRoles} with an org role assigned.</p>
        </div>
        <Link href="/admin/invite" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Invite users →</Link>
      </div>

      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Name</th><th className="pr-3">Email</th><th className="pr-3">Workspace role</th><th className="pr-3">Org role</th><th className="pr-3">Facility</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No users found.</td></tr>}
              {rows.map((p: any) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="py-2.5 pr-3 font-medium text-gray-800">{p.full_name ?? "—"}</td>
                  <td className="pr-3 text-gray-500">{p.email ?? "—"}</td>
                  <td className="pr-3 text-gray-600">{appRoleLabel(p)}</td>
                  <td className="pr-3">{p.org_role ? <span className="text-[10px] bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2 py-0.5">{titleCase(p.org_role)}</span> : <span className="text-xs text-amber-500">unassigned</span>}</td>
                  <td className="pr-3 text-gray-500">{p.hospital_id ? (facName.get(p.hospital_id) ?? "—") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {profiles.length > rows.length && <p className="text-[11px] text-gray-400">Showing the first {rows.length} of {profiles.length} users. Full user management — invitations, role assignment, status — lives in the <Link href="/admin/nurses" className="text-teal-600 hover:underline">worker roster</Link> and <Link href="/admin/invite" className="text-teal-600 hover:underline">invite</Link> surfaces.</p>}
    </div>
  );
}
