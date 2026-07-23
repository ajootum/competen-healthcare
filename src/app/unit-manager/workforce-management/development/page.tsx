import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadWorkforceReadiness } from "@/lib/operations/workforce-readiness";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../../UnitFilters";
import DevTabs from "./DevTabs";

export const dynamic = "force-dynamic";

// Live Overview (UMW-WFM-007 §8) — operational summary of workforce readiness. Real over the
// Competency system (competency currency, role coverage, credential expiry). The unit readiness
// score is competency-weighted; mandatory-learning / orientation / supervision dimensions need
// dedicated stores → honest next-phase. Every widget carries a footnote.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const BAND: Record<string, { tone: string; ring: string }> = { "Ready": { tone: "text-emerald-600", ring: "#10b981" }, "Mostly ready": { tone: "text-emerald-600", ring: "#34d399" }, "At risk": { tone: "text-amber-600", ring: "#f59e0b" }, "High risk": { tone: "text-orange-600", ring: "#f97316" }, "Critical": { tone: "text-rose-600", ring: "#e11d48" }, "—": { tone: "text-gray-400", ring: "#e5e7eb" } };
const SEV: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", moderate: "bg-sky-50 text-sky-700" };

function Kpi({ label, value, sub, tone, foot }: { label: string; value: any; sub?: string; tone?: string; foot?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{foot && <span className="text-[9px] text-gray-300">{foot}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function DevelopmentOverview() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");

  const [d, departments] = await Promise.all([
    loadWorkforceReadiness(admin, profile?.hospital_id ?? null, isSuper) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🎓</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Workforce Development &amp; Readiness</h1><p className="text-sm text-gray-500">Is the workforce competent, credentialed, current and developmentally supported to deliver safely?</p></div></div>
        <UnitFilters departments={departments} />
      </div>
      <DevTabs />
    </>
  );

  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">Readiness activates once operational staff + competency records exist.</p></div></div>;

  const b = BAND[d.band] ?? BAND["—"];
  const k = d.kpis;
  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Unit readiness score */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-1">Unit readiness score <span className="text-[9px] text-gray-300">¹</span></h3>
          <div className="flex items-center gap-4 mt-2">
            <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: d.score != null ? `conic-gradient(${b.ring} ${d.score}%, #f1f5f9 0)` : "#f1f5f9" }} /><div className="absolute inset-[18%] rounded-full bg-white flex flex-col items-center justify-center"><span className={`text-2xl font-bold ${b.tone}`}>{d.score ?? "—"}</span><span className="text-[9px] text-gray-400">/ 100</span></div></div>
            <div><p className={`text-sm font-bold ${b.tone}`}>{d.band}</p><p className="text-[11px] text-gray-500 mt-0.5">{k.fullyDeployable} of {k.total} fully deployable</p><p className="text-[10px] text-gray-400 mt-1">Competency-weighted; learning/orientation/supervision dimensions next-phase (§32.2). Never replaces a hard safety constraint.</p></div>
          </div>
        </div>

        {/* KPI cards */}
        <div className="xl:col-span-2 grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Kpi label="Fully deployable" value={k.fullyDeployable} sub={`${k.renewalDue} renewal due`} tone="text-emerald-600" foot="²" />
          <Kpi label="Requiring supervision" value={k.requiringSupervision} sub="Expired / no validation" tone={k.requiringSupervision ? "text-amber-600" : "text-emerald-600"} foot="³" />
          <Kpi label="Critical competency gaps" value={k.criticalGaps} sub={`${d.noCoverage.length} uncovered · ${d.singleDep.length} single-dep`} tone={k.criticalGaps ? "text-rose-600" : "text-emerald-600"} foot="⁴" />
          <Kpi label="Mandatory learning" value="—" sub="Needs learning store" tone="text-gray-300" foot="⁵" />
          <Kpi label="Credentials expiring" value={k.credentialsExpiring} sub={k.credentialsExpired ? `${k.credentialsExpired} expired` : "≤30 days"} tone={k.credentialsExpired ? "text-rose-600" : k.credentialsExpiring ? "text-amber-600" : "text-emerald-600"} foot="⁶" />
          <Kpi label="No competency record" value={k.noRecord} sub="Validate — missing ≠ incompetent" tone={k.noRecord ? "text-amber-600" : undefined} foot="⁴" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {/* Readiness risk panel */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Readiness risk panel <span className="text-[9px] text-gray-300">⁹</span></h3>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No readiness risks — the workforce is ready. 🎉</p> : <div className="space-y-2">{d.risks.slice(0, 6).map((r: any, i: number) => (<div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-gray-800">{r.title}</p><span className={`text-[9px] px-1.5 py-0.5 rounded ${SEV[r.severity]}`}>{r.severity}</span></div><p className="text-[11px] text-gray-500 mt-0.5">{r.detail}</p><p className="text-[10px] text-gray-400 mt-0.5">→ {r.action}</p></div>))}</div>}
        </div>

        {/* Competency coverage by role */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Competency coverage by role <span className="text-[9px] text-gray-300">⁴</span></h3>
          {d.roleCoverage.length === 0 ? <p className="text-sm text-gray-400">No competency data.</p> : <div className="space-y-2">{d.roleCoverage.map((r: any) => (<div key={r.role} className="flex items-center gap-3 text-xs"><span className="text-gray-700 w-28 truncate">{r.label}</span><div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${(r.pct ?? 0) >= 90 ? "bg-emerald-500" : (r.pct ?? 0) >= 60 ? "bg-amber-400" : "bg-rose-400"}`} style={{ width: `${r.pct ?? 0}%` }} /></div><span className="text-gray-600 w-16 text-right">{r.current}/{r.total}{r.pct != null ? ` · ${r.pct}%` : ""}</span></div>))}</div>}
          <Link href="/unit-manager/workforce-management/development/coverage" className="mt-3 inline-block text-[11px] font-semibold text-emerald-700 hover:underline">Competency coverage →</Link>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workforce Development &amp; Readiness (UMW-WFM-007 §8) is real over the Competency system (competency_decisions) — competency currency, role coverage and credential expiry. Footnotes: ¹ readiness rules · ² Competency Passport + credential status · ³ supervision/competency status · ⁴ unit competency matrix · ⁵ learning service (next-phase) · ⁶ credentialing service · ⁹ readiness-risk engine. Mandatory learning, orientation, supervision plans, development plans and succession need dedicated stores → honest next-phase. <Link href="/unit-manager/workforce-management" className="text-emerald-700 hover:underline">← Workforce Overview</Link></p>
    </div>
  );
}
