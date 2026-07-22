import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceIntelligence } from "@/lib/super-admin/ai-workforce";

export const dynamic = "force-dynamic";

// Workforce Intelligence (AIP-001.3) — deploy a safe, capable workforce. Real
// skill-gap coverage, roster coverage risk, an operational shift-load indicator,
// training backlog and a prioritised workforce risk centre. Honest states where
// roster publishing / succession mapping aren't modelled.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const PRI_TONE: Record<string, string> = { High: "bg-rose-50 text-rose-700", Medium: "bg-amber-50 text-amber-700", Low: "bg-gray-100 text-gray-600" };

export default async function WorkforceIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadWorkforceIntelligence(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Open Skill Gaps", value: dash(k.openSkillGaps), icon: "🎯", iconBg: "bg-rose-50", tone: (k.openSkillGaps ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Coverage", value: pct(k.coveragePct), icon: "🛡️", iconBg: "bg-green-50", tone: k.coveragePct != null && k.coveragePct < 80 ? "text-amber-600" : "text-green-600" },
    { label: "Awaiting Validation", value: dash(k.awaitingValidation), icon: "📋", iconBg: "bg-amber-50", tone: (k.awaitingValidation ?? 0) > 0 ? "text-amber-600" : undefined },
    { label: "At-Risk Scores", value: dash(k.atRisk), icon: "⚠️", iconBg: "bg-orange-50" },
    { label: "Staff", value: dash(k.staff), icon: "👥", iconBg: "bg-violet-50" },
    { label: "Upcoming Shifts", value: dash(k.upcomingShifts), icon: "📅", iconBg: "bg-sky-50" },
    { label: "Unstaffed Shifts", value: dash(k.unstaffedShifts), icon: "🕳️", iconBg: "bg-rose-50", tone: (k.unstaffedShifts ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Training Needs", value: dash(k.trainingNeeds), icon: "📚", iconBg: "bg-teal-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">Workforce Intelligence</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Workforce Intelligence</h1>
        <p className="text-sm text-gray-500">Optimise workforce capability, coverage and development — safe, capable staffing.</p>
      </div>

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Skill-gap analysis */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Skill-Gap Analysis <span className="text-[10px] text-gray-400">validated coverage by domain</span></h2>
            <Link href="/super-admin/ckp/competency" className="text-xs text-teal-700 hover:underline">Competency Centre →</Link>
          </div>
          <div className="flex items-center gap-4 mb-4">
            <div className="text-center">
              <p className="text-3xl font-bold text-gray-900 tabular-nums">{pct(k.coveragePct)}</p>
              <p className="text-[10px] text-gray-500">validated coverage</p>
            </div>
            <div className="flex-1 text-xs text-gray-500">
              <p><span className="font-semibold text-gray-800 tabular-nums">{d.coverage.validated}</span> of <span className="tabular-nums">{d.coverage.total}</span> competencies have a validated passing score.</p>
              <p className="mt-1"><span className="tabular-nums">{d.coverage.anyScored}</span> scored at least once · <span className="tabular-nums text-rose-600">{dash(k.openSkillGaps)}</span> with no validated coverage.</p>
            </div>
          </div>
          {d.domainGaps.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{d.coverage.total ? "All domains fully covered." : "No competency data yet."}</p> : (
            <div className="space-y-2">
              {d.domainGaps.map((g: any) => (
                <div key={g.name}>
                  <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600 truncate">{g.name}</span><span className="tabular-nums text-gray-400 shrink-0 ml-2">{g.covered}/{g.total} · {g.coverage}%</span></div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full rounded-full ${g.coverage < 50 ? "bg-rose-500" : g.coverage < 80 ? "bg-amber-500" : "bg-teal-500"}`} style={{ width: `${g.coverage}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Workforce risk centre */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Workforce Risk Centre</h2>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No workforce risks detected.</p> : (
            <div className="space-y-2">
              {d.risks.map((r: any) => (
                <Link key={r.title} href={r.href} className="block rounded-lg border border-gray-100 p-2.5 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800 leading-tight">{r.title}</span>
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${PRI_TONE[r.priority]}`}>{r.priority}</span>
                  </div>
                  <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{r.reason}</p>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Roster intelligence */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Roster Intelligence</h2>
          {!d.roster.ready ? <p className="text-sm text-gray-400 py-6 text-center">Roster data not available.</p> : (
            <>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[["Total", d.roster.total], ["Upcoming", d.roster.upcoming], ["Unstaffed", d.roster.unstaffed]].map(([l, n]: any) => (
                  <div key={l} className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-lg font-bold tabular-nums ${l === "Unstaffed" && n > 0 ? "text-rose-600" : "text-gray-900"}`}>{n.toLocaleString()}</p><p className="text-[9px] text-gray-500">{l} shifts</p></div>
                ))}
              </div>
              <div className="space-y-1">
                {Object.entries(d.roster.status).slice(0, 5).map(([s, n]: any) => (
                  <div key={s} className="flex items-center justify-between text-xs"><span className="text-gray-500 capitalize">{s.replace(/_/g, " ")}</span><span className="tabular-nums text-gray-400">{n}</span></div>
                ))}
              </div>
            </>
          )}
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">AI never publishes a roster autonomously — recommendations require human authorisation.</p>
        </div>

        {/* Burnout & fatigue */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Burnout &amp; Fatigue</h2>
          <div className="text-center py-2">
            <p className={`text-4xl font-bold tabular-nums ${d.roster.highLoadStaff > 0 ? "text-amber-600" : "text-gray-900"}`}>{d.roster.ready ? d.roster.highLoadStaff : "—"}</p>
            <p className="text-xs text-gray-500 mt-1">staff on ≥{d.roster.fatigueThreshold} shifts in 14 days</p>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50">An operational load indicator derived from shift assignments — not a medical judgement. Presented for supervisor review; excessive consecutive shifts, incomplete breaks and redeployment refine this signal as those fields are wired.</p>
        </div>

        {/* Capabilities */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Capabilities</h2>
          <div className="space-y-1.5">
            {d.capabilities.map((c: any) => (
              <div key={c.name} className="flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-violet-400 mt-1.5 shrink-0" />
                <div className="min-w-0"><p className="text-sm font-medium text-gray-800 leading-tight">{c.name}</p><p className="text-[10px] text-gray-500 leading-tight">{c.desc}</p></div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">{dash(d.succession.positions)} positions tracked · succession readiness &amp; critical-role vacancies land as role-successor mapping is modelled.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Intelligence computes real coverage from validated competency scores, roster coverage risk from upcoming shifts with no assigned staff, and an operational shift-load indicator — all fail-soft. Skill gaps, coverage and the risk centre are live; roster publishing stays human-authorised, and succession readiness / critical-role vacancies are honest “—” until role-successor mapping is modelled.</p>
    </div>
  );
}
