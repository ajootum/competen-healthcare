import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPdCpd } from "@/lib/operations/pd-cpd";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import LearningTabs from "../LearningTabs";

export const dynamic = "force-dynamic";

// Professional Development & CPD Management (LDS-003) — the Unit Manager's PD/CPD oversight over the
// unit's CPD ledger (cpd_logs) + expiring credentials. Design adapts the LDS-003 mockup for manager
// oversight (unit-wide, not a single learner). Real over live CPD data; honest states for the annual
// target, development-plan progress, goals, reflections and CPD-by-domain (no stores). Each learner's
// own CPD portfolio lives in their My CPD Log.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const METHOD_COLORS = ["#0ea5e9", "#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6"];

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href?: string }) {
  const inner = <div className={`${card} p-4 ${href ? "hover:border-emerald-300 transition-colors" : ""}`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function PdCpd() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadPdCpd(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Professional Development &amp; CPD</h1><p className="text-sm text-gray-500">Oversee the unit&apos;s CPD activity, points and validation. Each learner&apos;s own portfolio is in My CPD Log.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <LearningTabs />
    </>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ CPD ledger not available</p><p className="text-sm text-amber-800 mt-1">The CPD log store isn&apos;t provisioned for this tenant.</p></div></div>;

  const k = d.kpis;
  const mMax = Math.max(1, ...d.monthlyTrend);
  const methodTotal = d.byMethod.reduce((n: number, m: any) => n + m.points, 0) || 1;
  const donut = d.byMethod.length ? (() => { let acc = 0; const st: string[] = []; d.byMethod.forEach((m: any, i: number) => { const a = (acc / methodTotal) * 360, b = ((acc + m.points) / methodTotal) * 360; if (m.points) st.push(`${METHOD_COLORS[i % METHOD_COLORS.length]} ${a}deg ${b}deg`); acc += m.points; }); return `conic-gradient(${st.join(", ")})`; })() : "conic-gradient(#e5e7eb 0deg 360deg)";
  const cMax = Math.max(1, ...d.topContributors.map((c: any) => c.points));

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🏆" tint="bg-emerald-50" label="CPD Points (unit)" value={k.pointsEarned} sub="this year" />
        <Kpi icon="✅" tint="bg-teal-50" label="Approved Activities" value={k.approved} sub="validated" />
        <Kpi icon="🕐" tint="bg-amber-50" label="Awaiting Validation" value={k.awaiting} tone={k.awaiting ? "text-amber-600" : "text-gray-400"} sub="requires review" />
        <Kpi icon="👥" tint="bg-sky-50" label="Active CPD Learners" value={k.activeLearners} sub={`${k.avgPerStaff} avg pts`} />
        <Kpi icon="🎯" tint="bg-violet-50" label="Meeting Target" value={k.meetingTarget} tone={k.meetingTarget ? "text-emerald-600" : "text-gray-400"} sub={`≥${k.target} pts (default)`} />
        <Kpi icon="⚠️" tint="bg-rose-50" label="Expiring Certificates" value={d.expiringCerts} tone={d.expiringCerts ? "text-rose-600" : "text-gray-400"} sub="within 90 days" href="/competency-office/credentialing" />
      </div>

      {!d.hasData && <div className="bg-white border border-dashed border-gray-200 rounded-xl p-4 text-center text-sm text-gray-500">No CPD activity recorded this year yet — learners log CPD in their own CPD Log. Breakdowns populate as activity is recorded.</div>}

      {/* Delivery method + monthly + top contributors */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Learning by Delivery Method</h3>
          {d.byMethod.length === 0 ? <p className="text-sm text-gray-400">No CPD activity yet.</p> : (
            <div className="flex items-center gap-4">
              <div className="relative w-24 h-24 shrink-0 rounded-full" style={{ background: donut }}><div className="absolute inset-[22%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-base font-bold text-gray-900 tabular-nums">{k.pointsEarned}</span><span className="text-[8px] text-gray-400">points</span></div></div>
              <div className="flex-1 space-y-1 text-[11px]">{d.byMethod.map((m: any, i: number) => (<div key={m.name} className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: METHOD_COLORS[i % METHOD_COLORS.length] }} /><span className="text-gray-600 flex-1 truncate">{m.name}</span><b className="tabular-nums">{m.pct}%</b></div>))}</div>
            </div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Monthly CPD Points</h3>
          <div className="flex items-end justify-between gap-1 h-28">{d.monthlyTrend.map((v: number, i: number) => (<div key={i} className="flex-1 flex flex-col items-center justify-end gap-1"><div className="w-full bg-emerald-500 rounded-t" style={{ height: `${(v / mMax) * 100}%`, minHeight: v ? "2px" : "0" }} title={`${MONTHS[i]}: ${v}`} /><span className="text-[8px] text-gray-400">{MONTHS[i][0]}</span></div>))}</div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Top Contributors</h3>
          {d.topContributors.length === 0 ? <p className="text-sm text-gray-400">No CPD activity yet.</p> : (
            <div className="space-y-2">{d.topContributors.map((c: any) => (<div key={c.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{c.name}</span><span className="text-gray-500 tabular-nums">{+c.points.toFixed(1)}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${(c.points / cMax) * 100}%` }} /></div></div>))}</div>
          )}
        </div>
      </div>

      {/* Recent activities */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Recent CPD Activities</h3><Link href="/dashboard/cpd" className="text-[11px] text-emerald-600 hover:underline">My CPD Log →</Link></div>
        {d.recent.length === 0 ? <p className="text-sm text-gray-400">No CPD activities recorded this year.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-2 font-medium">Staff</th><th className="py-2 font-medium">Activity</th><th className="py-2 font-medium">Category</th><th className="py-2 font-medium">Date</th><th className="py-2 font-medium text-right">Points</th><th className="py-2 font-medium text-right">Validation</th></tr></thead>
            <tbody>{d.recent.map((a: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 text-gray-800">{a.name}</td><td className="py-2 text-gray-600 truncate max-w-[12rem]">{a.title}</td><td className="py-2 text-gray-500">{a.category}</td><td className="py-2 text-gray-500 tabular-nums">{a.date ?? "—"}</td><td className="py-2 text-right text-gray-700 tabular-nums">{+a.points.toFixed(1)}</td><td className="py-2 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${a.verified ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{a.verified ? "Validated" : "Pending"}</span></td></tr>))}</tbody>
          </table></div>
        )}
      </div>

      {/* Awaiting validation + honest dev-plan / goals */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Awaiting Validation</h3>
          {d.awaitingList.length === 0 ? <p className="text-sm text-gray-400">Nothing awaiting validation.</p> : (
            <div className="space-y-2">{d.awaitingList.map((a: any, i: number) => (<div key={i} className="flex items-center justify-between gap-2 text-xs"><div className="min-w-0"><p className="text-gray-800 truncate">{a.name}</p><p className="text-[10px] text-gray-400 truncate">{a.title}</p></div><span className="text-gray-500 shrink-0 tabular-nums">{+a.points.toFixed(1)} pts</span></div>))}</div>
          )}
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Development Plan Progress</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🎯</p><p className="text-xs text-gray-500">Version-controlled development plans (on-track / at-risk / overdue) need a development-plan store.</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase (LDS-003).</p></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Development Goals</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🏅</p><p className="text-xs text-gray-500">Development goals, reflections and CPD-by-competency-domain need their stores.</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase.</p></div>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Professional Development &amp; CPD (LDS-003) over the unit&apos;s CPD ledger (cpd_logs) + expiring credentials. Real: CPD points, approved / awaiting-validation, by-delivery-method, monthly trend, top contributors, recent activities and expiring certificates. Honest next-phase: the configurable annual CPD target (a default of {k.target} pts is shown), development-plan progress, development goals, reflections and CPD-by-competency-domain — each needs its store. Each learner records CPD in their own <Link href="/dashboard/cpd" className="text-emerald-700 hover:underline">CPD Log</Link>.</p>
    </div>
  );
}
