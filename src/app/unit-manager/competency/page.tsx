import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitCapability } from "@/lib/operations/unit-manager-data";

export const dynamic = "force-dynamic";

// Competency Management (UMG-004) — the unit's workforce competency coverage and
// per-clinician readiness, so the manager can target gaps and expiries.
/* eslint-disable @typescript-eslint/no-explicit-any */

const bar = (n: number) => (n >= 85 ? "bg-green-500" : n >= 60 ? "bg-amber-500" : "bg-red-500");

export default async function UnitCompetencyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const { ready, summary, perNurse } = await loadUnitCapability(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = "bg-white rounded-xl border border-gray-200 p-5";

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Competency Management</h1>
        <p className="text-sm text-gray-500 mt-1">Workforce competency coverage and per-clinician readiness across your unit.</p>
      </div>

      {!ready && <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 text-sm text-amber-800">Competency data isn&apos;t available yet.</div>}

      {ready && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{summary.coverage}%</div><div className="text-xs text-gray-500 mt-1">Coverage ({summary.competent}/{summary.total})</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-amber-600">{summary.expiring}</div><div className="text-xs text-gray-500 mt-1">Expiring within 60 days</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-red-600">{summary.expired}</div><div className="text-xs text-gray-500 mt-1">Expired</div></div>
            <div className={card}><div className="text-3xl font-bold tabular-nums text-orange-600">{summary.gaps}</div><div className="text-xs text-gray-500 mt-1">Developing / not yet competent</div></div>
          </div>

          <div className={card}>
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Clinician readiness ({perNurse.length})</h3>
              <Link href="/admin/workforce" className="text-xs text-teal-600 hover:underline">Full workforce report →</Link>
            </div>
            {perNurse.length === 0 && <p className="text-sm text-gray-400">No competency records for this unit yet.</p>}
            <div className="divide-y">
              {perNurse.slice(0, 60).map((n: any, i: number) => (
                <div key={i} className="py-2.5 flex items-center gap-3">
                  <span className="text-sm text-gray-800 w-44 truncate">{n.name}</span>
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-xs">
                    <div className={`h-full ${bar(n.coverage)}`} style={{ width: `${n.coverage}%` }} />
                  </div>
                  <span className="text-xs tabular-nums w-10 text-right text-gray-600">{n.coverage}%</span>
                  <span className="text-xs text-gray-400 ml-auto">{n.competent} current{n.expired ? ` · ${n.expired} expired` : ""}{n.gaps ? ` · ${n.gaps} developing` : ""}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
