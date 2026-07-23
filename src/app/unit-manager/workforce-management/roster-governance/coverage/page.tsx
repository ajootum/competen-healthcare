import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadRosterCoverage } from "@/lib/operations/roster-governance";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../../UnitFilters";
import RosterGovTabs from "../RosterGovTabs";

export const dynamic = "force-dynamic";

// Coverage & Safety Validation (UMW-WFM-004 §10) — per-shift safe-staffing validation
// outcome + a coverage heat map over the current-week roster (op_roster_assignments). A shift
// is critical when it has no staff or a required supervisor post is unfilled. Real.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const OUT: Record<string, { bg: string; badge: string; label: string }> = {
  safe: { bg: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700", label: "Safe" },
  warning: { bg: "bg-amber-400", badge: "bg-amber-50 text-amber-700", label: "Warning" },
  gap: { bg: "bg-orange-500", badge: "bg-orange-50 text-orange-700", label: "Gap" },
  critical: { bg: "bg-rose-500", badge: "bg-rose-50 text-rose-700", label: "Critical" },
};
const fmtD = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });

function Kpi({ label, value, tone }: { label: string; value: any; tone?: string }) {
  return <div className={`${card} p-4`}><p className="text-xs text-gray-500">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p></div>;
}

export default async function CoverageSafety() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadRosterCoverage(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">📋</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Roster Governance · Coverage &amp; Safety</h1><p className="text-sm text-gray-500">Does rostered staffing meet the minimum safe requirement for every shift?</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <RosterGovTabs />
    </>
  );

  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Roster store not provisioned</p></div></div>;
  if (!d.hasRoster) return <div className="space-y-4">{header}<div className="bg-white border border-gray-200 rounded-xl p-6"><p className="font-semibold text-gray-800">No roster for the current week</p><p className="text-sm text-gray-500 mt-1">Generate one in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Safe shifts" value={d.counts.safe} tone="text-emerald-600" />
        <Kpi label="Warnings" value={d.counts.warning} tone={d.counts.warning ? "text-amber-600" : undefined} />
        <Kpi label="Gaps" value={d.counts.gap} tone={d.counts.gap ? "text-orange-600" : undefined} />
        <Kpi label="Critical" value={d.counts.critical} tone={d.counts.critical ? "text-rose-600" : "text-emerald-600"} />
      </div>

      {/* Coverage heat map */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Coverage heat map <span className="text-[10px] text-gray-400 font-normal">unit × shift · dates across</span></h3>
        <div className="overflow-x-auto"><table className="text-xs border-separate" style={{ borderSpacing: "3px" }}>
          <thead><tr><th className="text-left text-gray-400 font-medium pr-2">Unit / shift</th>{d.days.map((day: string) => <th key={day} className="text-gray-400 font-medium px-1 whitespace-nowrap">{fmtD(day)}</th>)}</tr></thead>
          <tbody>{d.units.flatMap((unit: string) => ["day", "night"].map(shift => (
            <tr key={`${unit}|${shift}`}>
              <td className="text-gray-600 pr-2 whitespace-nowrap">{unit} <span className="text-gray-300">{shift === "day" ? "☀️" : "🌑"}</span></td>
              {d.days.map((day: string) => { const c = d.cell(unit, day, shift); return <td key={day} className="p-0"><div className={`w-8 h-7 rounded flex items-center justify-center text-[9px] text-white font-semibold ${c ? OUT[c.outcome].bg : "bg-gray-100"}`} title={c ? `${c.filled}/${c.posts} · ${OUT[c.outcome].label}` : "no demand"}>{c ? `${c.filled}/${c.posts}` : ""}</div></td>; })}
            </tr>
          )))}</tbody>
        </table></div>
        <div className="flex items-center gap-3 mt-3 flex-wrap">{Object.entries(OUT).map(([k, v]) => (<span key={k} className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className={`w-2.5 h-2.5 rounded ${v.bg}`} />{v.label}</span>))}</div>
      </div>

      {/* Shifts needing action */}
      <div className={`${card} p-5`}>
        <h3 className="text-sm font-bold text-gray-900 mb-3">Shifts needing action <span className="text-[10px] text-gray-400 font-normal">critical & gap first</span></h3>
        {d.shifts.filter((s: any) => s.outcome !== "safe").length === 0 ? <p className="text-sm text-gray-400">Every shift meets minimum safe staffing. 🎉</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs">
            <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium text-right">Filled</th><th className="py-2 pr-3 font-medium text-right">Gap</th><th className="py-2 pr-3 font-medium">Supervisor</th><th className="py-2 font-medium">Outcome</th></tr></thead>
            <tbody>{d.shifts.filter((s: any) => s.outcome !== "safe").sort((a: any, b: any) => (a.outcome === "critical" ? 0 : 1) - (b.outcome === "critical" ? 0 : 1) || b.gap - a.gap).map((s: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{s.unit}</td><td className="py-2 pr-3 text-gray-600 whitespace-nowrap">{fmtD(s.date)}</td><td className="py-2 pr-3 text-gray-500 capitalize">{s.shift}</td><td className="py-2 pr-3 text-right text-gray-600">{s.filled}/{s.posts}</td><td className={`py-2 pr-3 text-right ${s.gap ? "text-rose-600 font-semibold" : "text-gray-400"}`}>{s.gap || "—"}</td><td className="py-2 pr-3">{!s.supPost ? <span className="text-gray-300">n/a</span> : s.supFilled ? <span className="text-emerald-600">✓</span> : <span className="text-rose-600 font-semibold">missing</span>}</td><td className="py-2"><span className={`text-[9px] px-1.5 py-0.5 rounded ${OUT[s.outcome].badge}`}>{OUT[s.outcome].label}</span></td></tr>))}</tbody>
          </table></div>
        )}
        <p className="text-[10px] text-gray-400 mt-2">Hard-blocking conditions (§10.6): staffing below minimum, no eligible supervisor, missing critical competency. The candidate-resolution panel (eligible staff ranked for an uncovered shift) reuses the Scheduling Engine solver → resolve in <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link>.</p>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Coverage &amp; Safety Validation (UMW-WFM-004 §10) evaluates each shift over op_roster_assignments — required vs assigned, supervisor presence and competency gaps — into safe / warning / gap / critical outcomes. Demand-source detail (occupancy/acuity/theatre) is owned by Demand Planning. <Link href="/unit-manager/workforce-management/roster-governance" className="text-emerald-700 hover:underline">← Governance Overview</Link></p>
    </div>
  );
}
