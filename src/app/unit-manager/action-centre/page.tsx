import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveActionCentre, loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitCommandTabs from "../UnitCommandTabs";
import UnitFilters from "../UnitFilters";

export const dynamic = "force-dynamic";

// Executive Action Centre (UMW-003 §3) — a single management work queue aggregating
// the real operational + quality + competency stores (escalations, incidents, CAPA/
// improvement actions, competency validations). Channels with no backing store yet
// (leave, staffing requests, budget, policy approvals, executive messages) are shown
// as honest empty channels rather than fabricated rows.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-500" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
// Drill-down target per channel.
const HREF: Record<string, string> = { "Escalation": "/supervisor/quality-safety", "Incident Review": "/supervisor/quality-safety", "Improvement Action": "/supervisor/quality-safety", "Competency Approval": "/unit-manager/assessment" };

function Tile({ n, label, sub, tone }: { n: any; label: string; sub?: string; tone?: string }) {
  return <div className={`${card} p-3.5`}><p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</p><p className="text-[11px] text-gray-600 mt-0.5">{label}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function ExecutiveActionCentre({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadExecutiveActionCentre(admin, profile?.hospital_id ?? null, isSuper, dept),
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Unit Command</h1><p className="text-sm text-gray-500">Approvals, escalations and actions requiring your attention.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <UnitCommandTabs />

      <div className="flex items-center gap-2"><span className="w-5 h-5 rounded bg-teal-600 text-white text-[11px] font-bold flex items-center justify-center">3</span><h2 className="text-sm font-bold text-gray-900">Executive Action Centre</h2><span className="text-[11px] text-gray-400">Approvals, escalations and actions requiring your attention</span></div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
        <Tile n={d.counts.total} label="Total Items" sub="All items" />
        <Tile n={d.counts.high} label="High Priority" sub="Require attention" tone={d.counts.high ? "text-rose-600" : "text-gray-900"} />
        <Tile n={d.counts.dueToday} label="Due Today" tone={d.counts.dueToday ? "text-amber-600" : "text-gray-900"} />
        <Tile n={d.counts.overdue} label="Overdue" sub="Past due" tone={d.counts.overdue ? "text-rose-600" : "text-gray-900"} />
        <Tile n={d.counts.pending} label="Pending" sub="Awaiting review" />
      </div>

      {/* Work queue */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Management Work Queue</h3>
        {d.items.length === 0 ? <p className="text-sm text-gray-400">Nothing in the queue — no open escalations, incidents, improvement actions or pending validations.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Type</th><th className="py-2 pr-3 font-medium">Item</th><th className="py-2 pr-3 font-medium">Details</th><th className="py-2 pr-3 font-medium">Requested By</th><th className="py-2 pr-3 font-medium">When</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Action</th></tr></thead>
              <tbody>
                {d.items.slice(0, 25).map((it: any) => (
                  <tr key={it.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                    <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PRI[it.priority]}`}>{it.priority}</span></td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{it.channel}</td>
                    <td className="py-2 pr-3 text-gray-800 font-medium max-w-[160px] truncate">{it.item}</td>
                    <td className="py-2 pr-3 text-gray-500 max-w-[200px] truncate">{it.details}</td>
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{it.by}</td>
                    <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{relTime(it.at)}</td>
                    <td className="py-2 pr-3"><span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 text-[10px] capitalize">{it.status}</span></td>
                    <td className="py-2"><Link href={HREF[it.channel] ?? "#"} className="text-teal-700 hover:underline">Review →</Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
            {d.items.length > 25 && <p className="text-[10px] text-gray-400 mt-2">Showing 25 of {d.items.length} items.</p>}
          </div>
        )}
      </div>

      {/* Honest channels */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-2">Additional Channels</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {d.honestChannels.map((c: string) => (
            <div key={c} className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3"><p className="text-xs font-medium text-gray-600">{c}</p><p className="text-[10px] text-gray-400">No backing store</p></div>
          ))}
        </div>
        <p className="text-[11px] text-gray-400 mt-3">Leave, staffing-request, budget-request, policy-approval and executive-message channels need their own stores (HR / finance / governance integrations) and are shown as honest empty channels rather than fabricated. One-click approval wiring per channel is the next step; today each real item drills down to its source workspace.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Executive Action Centre (UMW-003 §3) unifies the manager&apos;s work queue from the live operational, quality and competency stores — escalations, incidents, improvement/CAPA actions and pending competency validations are all real, with priority, ownership and timestamps. <Link href="/unit-manager" className="text-teal-700 hover:underline">← Unit Dashboard</Link></p>
    </div>
  );
}
