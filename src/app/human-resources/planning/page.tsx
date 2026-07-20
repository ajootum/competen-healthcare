import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Workforce Planning (HRM-003) — establishment vs filled positions by department.
/* eslint-disable @typescript-eslint/no-explicit-any */

const NONE = "00000000-0000-0000-0000-000000000000";

export default async function WorkforcePlanningPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin"); const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? NONE));

  const { data: pos } = await scope(admin.from("positions").select("id, title, status, departments!department_id(name)").eq("status", "active").limit(3000));
  const positions = pos ?? [];
  const posIds = positions.map((p: any) => p.id);
  const filled = new Set<string>();
  if (posIds.length) {
    const { data: asg } = await admin.from("workforce_assignments").select("position_id").eq("status", "active").in("position_id", posIds).limit(5000);
    for (const a of asg ?? []) filled.add(a.position_id);
  }

  // Group by department.
  const byDept = new Map<string, { name: string; establishment: number; filled: number }>();
  for (const p of positions) {
    const name = (p.departments as any)?.name ?? "Unassigned";
    const g = byDept.get(name) ?? { name, establishment: 0, filled: 0 };
    g.establishment++;
    if (filled.has(p.id)) g.filled++;
    byDept.set(name, g);
  }
  const depts = [...byDept.values()].sort((a, b) => b.establishment - a.establishment);
  const totalEst = positions.length, totalFilled = filled.size;
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Workforce Planning</h1>
          <p className="text-sm text-gray-500 mt-1">Establishment vs filled positions by department.</p>
        </div>
        <Link href="/admin/positions" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Manage positions →</Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{totalEst}</div><div className="text-xs text-gray-500 mt-1">Established positions</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{totalFilled}</div><div className="text-xs text-gray-500 mt-1">Filled</div></div>
        <div className={card}><div className={`text-3xl font-bold tabular-nums ${totalEst - totalFilled ? "text-amber-600" : "text-gray-900"}`}>{totalEst - totalFilled}</div><div className="text-xs text-gray-500 mt-1">Vacant</div></div>
      </div>

      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">By department</h3>
        {depts.length === 0 && <p className="text-sm text-gray-400">No positions established yet. Create them in Position Management.</p>}
        <div className="space-y-3">
          {depts.map((dp) => {
            const rate = dp.establishment ? Math.round((dp.filled / dp.establishment) * 100) : 0;
            return (
              <div key={dp.name}>
                <div className="flex justify-between text-sm mb-1"><span className="text-gray-700">{dp.name}</span><span className="text-gray-500 tabular-nums">{dp.filled}/{dp.establishment} · {rate}%</span></div>
                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${rate >= 90 ? "bg-green-500" : rate >= 60 ? "bg-teal-500" : "bg-amber-500"}`} style={{ width: `${rate}%` }} /></div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
