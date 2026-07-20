import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Staff Records (HRM-004) — the unit workforce with role, employment status and
// competency coverage.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";
const PASSING = ["competent", "competent_with_conditions", "provisionally_competent"];
const bar = (n: number) => (n >= 85 ? "bg-green-500" : n >= 60 ? "bg-amber-500" : "bg-red-500");
const empBadge: Record<string, string> = { orientation: "bg-blue-100 text-blue-700", probation: "bg-amber-100 text-amber-700", confirmed: "bg-green-100 text-green-700" };

export default async function StaffRecordsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin"); const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));
  const today = new Date().toISOString().slice(0, 10);

  const { data: staff } = await scope(admin.from("profiles").select("id, full_name, role, roles").order("full_name").limit(2000));
  const rows = staff ?? [];

  // Employment status (latest active per person).
  const empByStaff = new Map<string, string>();
  try {
    const { data: er } = await scope(admin.from("employment_records").select("nurse_id, status, end_date, start_date").order("start_date", { ascending: false }).limit(4000));
    for (const e of er ?? []) { if (!e.end_date && !empByStaff.has(e.nurse_id)) empByStaff.set(e.nurse_id, e.status); }
  } catch { /* ignore */ }

  // Competency coverage per staff (latest decision per competency).
  const covByStaff = new Map<string, { total: number; current: number }>();
  try {
    const { data: decs } = await scope(admin.from("competency_decisions").select("nurse_id, competency_id, outcome, expiry_date, created_at").order("created_at", { ascending: false }).limit(20000));
    const seen = new Set<string>();
    for (const d of decs ?? []) {
      const k = `${d.nurse_id}:${d.competency_id}`; if (seen.has(k)) continue; seen.add(k);
      const c = covByStaff.get(d.nurse_id) ?? { total: 0, current: 0 };
      c.total++;
      if (PASSING.includes(d.outcome) && (!d.expiry_date || d.expiry_date >= today)) c.current++;
      covByStaff.set(d.nurse_id, c);
    }
  } catch { /* ignore */ }

  const roleLabel = (p: any) => {
    const rs: string[] = (p.roles?.length ? p.roles : [p.role]).filter(Boolean);
    if (rs.includes("educator")) return "Educator";
    if (rs.includes("assessor")) return "Assessor";
    if (rs.includes("hospital_admin") || rs.includes("super_admin")) return "Admin";
    return "Healthcare worker";
  };
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Staff Records</h1>
          <p className="text-sm text-gray-500 mt-1">{rows.length} staff · role, employment status and competency coverage.</p>
        </div>
        <Link href="/admin/invite" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Invite workers →</Link>
      </div>
      <div className={card}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Name</th><th className="pr-3">Role</th><th className="pr-3">Employment</th><th className="pr-3 w-40">Competency</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No staff records.</td></tr>}
              {rows.map((p: any) => {
                const emp = empByStaff.get(p.id);
                const cov = covByStaff.get(p.id);
                const coverage = cov && cov.total ? Math.round((cov.current / cov.total) * 100) : null;
                return (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-2.5 pr-3 font-medium text-gray-800">{p.full_name}</td>
                    <td className="pr-3 text-gray-500">{roleLabel(p)}</td>
                    <td className="pr-3">{emp ? <span className={`text-[10px] px-2 py-0.5 rounded-full ${empBadge[emp] ?? "bg-gray-100 text-gray-500"}`}>{emp}</span> : <span className="text-xs text-gray-300">—</span>}</td>
                    <td className="pr-3">
                      {coverage == null ? <span className="text-xs text-gray-300">no records</span> : (
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${bar(coverage)}`} style={{ width: `${coverage}%` }} /></div>
                          <span className="text-xs tabular-nums text-gray-600 w-9 text-right">{coverage}%</span>
                        </div>
                      )}
                    </td>
                    <td className="text-right text-xs text-gray-400">{cov ? `${cov.current}/${cov.total}` : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
