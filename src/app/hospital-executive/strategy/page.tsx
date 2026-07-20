import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveDashboard } from "@/lib/executive-data";

export const dynamic = "force-dynamic";

// Strategy Centre (HEX-006) — improvement objectives tracked as the
// organisation's strategic initiatives.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const statusCls: Record<string, string> = {
  active: "bg-teal-100 text-teal-700", measuring: "bg-blue-100 text-blue-700", planning: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-500",
};
const ACTIVE = ["active", "measuring", "planning"];

export default async function StrategyCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadExecutiveDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { initiatives, initiativeStats } = d;
  const active = initiatives.filter(i => ACTIVE.includes(i.status));
  const done = initiatives.filter(i => ["completed", "closed"].includes(i.status));
  const other = initiatives.filter(i => !ACTIVE.includes(i.status) && !["completed", "closed"].includes(i.status));

  const section = (title: string, list: typeof initiatives) => list.length > 0 && (
    <div className={card}>
      <h3 className="font-semibold text-gray-900 mb-3">{title} <span className="text-gray-400 font-normal">· {list.length}</span></h3>
      <div className="divide-y divide-gray-100">
        {list.map((i, idx) => (
          <div key={idx} className="flex items-center gap-3 py-2.5">
            {i.code && <span className="shrink-0 text-[10px] font-mono text-gray-400 w-16 truncate">{i.code}</span>}
            <span className="text-sm text-gray-800 flex-1 truncate">{i.title}</span>
            {i.target_date && <span className="shrink-0 text-xs text-gray-400 tabular-nums hidden md:inline">due {new Date(i.target_date).toLocaleDateString()}</span>}
            <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${statusCls[i.status] ?? "bg-gray-100 text-gray-500"}`}>{i.status.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Strategy Centre</h1>
          <p className="text-sm text-gray-500 mt-1">Strategic initiatives tracked as organisational improvement objectives.</p>
        </div>
        <Link href="/quality-accreditation/improvements" className="shrink-0 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-4 py-2">Manage initiatives →</Link>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className={card}><div className="text-3xl font-bold tabular-nums text-gray-900">{initiativeStats.total}</div><div className="text-xs text-gray-500 mt-1">Total initiatives</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-teal-700">{initiativeStats.active}</div><div className="text-xs text-gray-500 mt-1">Open</div></div>
        <div className={card}><div className="text-3xl font-bold tabular-nums text-green-600">{initiativeStats.completed}</div><div className="text-xs text-gray-500 mt-1">Completed</div></div>
      </div>
      {initiativeStats.total > initiatives.length && (
        <p className="text-[11px] text-gray-400">Showing the {initiatives.length} most recent of {initiativeStats.total} initiatives. Counts above reflect all initiatives.</p>
      )}

      {initiatives.length === 0 && (
        <div className={card}>
          <p className="text-sm text-gray-400">No strategic initiatives logged yet. Improvement objectives created in the Quality &amp; Accreditation workspace appear here automatically.</p>
        </div>
      )}
      {section("In progress", active)}
      {section("Other", other)}
      {section("Completed", done)}
    </div>
  );
}
