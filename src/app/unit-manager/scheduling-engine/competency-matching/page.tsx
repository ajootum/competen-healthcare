import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCompetencyMatching } from "@/lib/operations/competency-matching";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import SchedulingTabs from "../SchedulingTabs";

export const dynamic = "force-dynamic";

// Competency Matching Engine (WSE-001D) — matches workforce capability to demand. Staff
// competency currency (current/expiring/expired/none from competency_decisions), roster
// match score, unvalidated/high-risk assignments with recommended competency-current
// replacements, role coverage and skill mix. Currency is roster-independent (always real);
// match analysis needs a generated roster. Passport specialty/preceptor depth next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const SUBTABS = ["Overview", "Competency Rules", "Role Profiles", "Skill Mix", "Matching Results", "Competency Gaps", "Recommendations", "Overrides", "Audit & History", "Settings"];
const STATUS_COLOR: Record<string, string> = { Current: "#22c55e", Expiring: "#f59e0b", Expired: "#ef4444", None: "#9ca3af" };
const STATUS_BADGE: Record<string, string> = { Current: "bg-emerald-50 text-emerald-700", Expiring: "bg-amber-50 text-amber-700", Expired: "bg-rose-50 text-rose-700", None: "bg-gray-100 text-gray-500" };

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function CompetencyMatching() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadCompetencyMatching(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎯</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Competency Matching</h1><p className="text-sm text-gray-500">Match workforce capability to clinical demand before roster publication.</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <SchedulingTabs />
      <div className="flex gap-1 overflow-x-auto -mt-1">
        {SUBTABS.map((t, i) => <span key={t} className={`shrink-0 text-[11px] px-2.5 py-1.5 rounded-full font-medium ${i === 0 ? "bg-emerald-50 text-emerald-700" : "text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p></div></div>;

  const k = d.kpis; const m = d.match;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Competency match" value={k.matchScore != null ? `${k.matchScore}%` : "—"} sub={k.matchScore != null ? "Roster assignments" : "No roster"} icon="🎯" tone={k.matchScore != null && k.matchScore >= 90 ? "text-emerald-600" : k.matchScore != null ? "text-amber-600" : undefined} />
        <Kpi label="Staff current" value={k.currentPct != null ? `${k.currentPct}%` : "—"} sub={`${k.staffTotal} clinical staff`} icon="✅" tone={k.currentPct != null && k.currentPct >= 90 ? "text-emerald-600" : undefined} />
        <Kpi label="Expired certs" value={k.expiredCerts} sub="Block assignment" icon="⛔" tone={k.expiredCerts ? "text-rose-600" : "text-emerald-600"} />
        <Kpi label="Expiring ≤30d" value={k.expiringCerts} sub="Reassess soon" icon="⏰" tone={k.expiringCerts ? "text-amber-600" : undefined} />
        <Kpi label="High-risk assignments" value={m?.unvalidatedCount ?? "—"} sub="Unvalidated" icon="🔺" tone={m?.unvalidatedCount ? "text-rose-600" : undefined} />
        <Kpi label="No record" value={k.noneCount} sub="Passport incomplete" icon="📋" tone={k.noneCount ? "text-amber-600" : undefined} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Matching results / high-risk */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Matching results {m && <span className="text-[10px] text-gray-400 font-normal">roster week {d.weekStart} · {m.rosterStatus}</span>}</h3>
          {!m ? (
            <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-3xl mb-1">🎯</p><p className="text-sm font-semibold text-gray-700">No roster to match</p><p className="text-[11px] text-gray-400 mt-1">Generate a roster in the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> — competency matching validates every assignment. The staff-currency overview below is live regardless.</p></div>
          ) : m.highRisk.length === 0 ? (
            <div className="text-center py-6"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">All {m.assigned} assignments competency-validated</p><p className="text-xs text-gray-400 mt-1">{m.matchScore}% competency match on the current roster.</p></div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Unit</th><th className="py-2 pr-3 font-medium">Role</th><th className="py-2 pr-3 font-medium">Shift</th><th className="py-2 pr-3 font-medium">Assigned (unvalidated)</th><th className="py-2 font-medium">Recommended replacement</th></tr></thead>
              <tbody>{m.highRisk.map((h: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-2 pr-3 text-gray-700">{h.unit}</td><td className="py-2 pr-3 text-gray-600">{h.role}</td><td className="py-2 pr-3 text-gray-500">{h.date.slice(5)} {h.shift}</td><td className="py-2 pr-3 text-rose-600">{h.staff} ⚠</td><td className="py-2">{h.replacement ? <span className="text-emerald-700">→ {h.replacement}</span> : <span className="text-gray-400">No current-competency alternative</span>}</td></tr>))}</tbody>
            </table><p className="text-[10px] text-gray-400 mt-2">Replacements suggest a competency-current clinician of the same role who isn&apos;t already on that shift. Applying a swap or authorising an override is done in the roster (next-phase inline).</p></div>
          )}
        </div>

        {/* Skill mix */}
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Skill mix (competency currency)</h3>
          {d.skillMix.length === 0 ? <p className="text-sm text-gray-400">No staff.</p> : (
            <>
              <div className="flex h-3 rounded-full overflow-hidden mb-3">{d.skillMix.map((x: any) => <div key={x.label} style={{ width: `${(x.n / k.staffTotal) * 100}%`, background: STATUS_COLOR[x.label] }} title={`${x.label}: ${x.n}`} />)}</div>
              <div className="space-y-1">{d.skillMix.map((x: any) => (<div key={x.label} className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-sm" style={{ background: STATUS_COLOR[x.label] }} /><span className="text-gray-600 flex-1">{x.label}</span><b>{x.n}</b><span className="text-gray-400">({Math.round((x.n / k.staffTotal) * 100)}%)</span></div>))}</div>
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Role coverage */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Role coverage</h3>
          {d.roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No staff.</p> : <div className="space-y-2">{d.roleCoverage.map((r: any) => (<div key={r.role} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700">{r.label}</span><span className="text-gray-500">{r.current}/{r.total} current{r.pct != null ? ` · ${r.pct}%` : ""}</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(r.pct ?? 0) >= 90 ? "bg-emerald-500" : (r.pct ?? 0) >= 70 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${r.pct ?? 0}%` }} /></div></div>))}</div>}
        </div>

        {/* Expiring / expired */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Certifications needing action</h3>
          {d.expiringStaff.length === 0 && d.expiredStaff.length === 0 ? <p className="text-sm text-gray-400">No expiring or expired competencies. 🎉</p> : (
            <div className="space-y-1.5">
              {d.expiredStaff.map((s: any) => (<div key={s.id} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{s.name}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE.Expired}`}>Expired</span></div>))}
              {d.expiringStaff.map((s: any) => (<div key={s.id} className="flex items-center justify-between text-xs"><span className="text-gray-700 truncate">{s.name}</span><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_BADGE.Expiring}`}>Expiring</span></div>))}
            </div>
          )}
        </div>

        {/* AI insights */}
        <div className={`${card} p-5 bg-gradient-to-br from-emerald-50/40 to-white`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI competency insights</h3>
          {d.insights.length === 0 ? <p className="text-sm text-gray-400">No insights.</p> : <div className="space-y-2">{d.insights.map((x: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className="text-sm shrink-0">{x.icon}</span><p className="text-xs text-gray-700 flex-1">{x.text}</p></div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Competency Matching Engine (WSE-001D) computes each clinician&apos;s competency currency from competency_decisions (current / expiring ≤30d / expired / none), then validates every roster assignment — flagging unvalidated (high-risk) assignments and recommending competency-current replacements of the same role. The currency overview, skill mix and role coverage are live regardless of a roster; the match score feeds the <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">Scheduling Engine</Link> and <Link href="/unit-manager/scheduling-engine/constraints" className="text-emerald-700 hover:underline">Constraint Engine</Link>. No clinician is scheduled into a role without required competencies unless an authorised override is recorded. Competency Passport specialty/preceptor/orientation depth and per-competency gap matrices are honest next-phase. <Link href="/unit-manager/scheduling-engine" className="text-emerald-700 hover:underline">← Scheduling Engine</Link></p>
    </div>
  );
}
