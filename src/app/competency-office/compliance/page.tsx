import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadComplianceCentre } from "@/lib/compliance-centre";
import ComplianceTabs from "./ComplianceTabs";

export const dynamic = "force-dynamic";

// Compliance Centre — Compliance Dashboard (CMO-002 §5). The enterprise command centre for
// competency-related compliance over the live spine (competency_decisions + professional_credentials
// + framework domains). Real: overall compliance, mandatory completion, expiring (30d), named
// high-risk staff (hard-stop: expired mandatory / critical failure), credential validity, compliance
// by domain, heatmap by unit, expiring individuals, AI insights and activity. Honest next-phase:
// accreditation standards mapping, exceptions, remediation plans, regulatory rule packs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}

export default async function ComplianceDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadComplianceCentre(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  // Merge expiring competencies + credentials into one prioritised list.
  const expiringAll = [
    ...d.expiringPeople.map((p: any) => ({ name: p.name, requirement: p.competency, kind: "Competency", days: p.days })),
    ...d.credentials.expiringPeople.map((c: any) => ({ name: c.name, requirement: c.credential, kind: "Credential", days: c.days })),
  ].filter(x => x.days != null).sort((a, b) => (a.days ?? 999) - (b.days ?? 999)).slice(0, 8);

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900">Compliance Centre</h1><p className="text-sm text-gray-500">Where are we non-compliant, why, who is affected and what action is required — by when.</p></div>
        <span className="text-xs bg-white border border-gray-200 rounded-lg px-3 py-2 text-gray-400">☰ Filters</span>
      </div>
      <ComplianceTabs />
    </>
  );
  if (!d.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Coming online</p><p className="text-sm text-amber-800 mt-1">Competency compliance activates once competency decisions are recorded for this tenant.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI row (§5) */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Overall Compliance" value={`${d.overallCompliance}%`} tone={pctTone(d.overallCompliance)} sub="validated & current" href="/competency-office/compliance" />
        <Kpi icon="✔️" tint="bg-teal-50" label="Mandatory Competencies" value={`${d.mandatory.completion}%`} tone={pctTone(d.mandatory.completion)} sub={`${d.mandatory.complete} complete · ${d.mandatory.overdue} overdue`} href="/competency-office/compliance/mandatory" />
        <Kpi icon="📅" tint="bg-amber-50" label="Expiring in 30 Days" value={d.expiring.d30 + d.credentials.expiring} tone={d.expiring.d30 + d.credentials.expiring ? "text-amber-600" : "text-gray-400"} sub={`${d.expiring.d30} comp · ${d.credentials.expiring} cred`} href="/competency-office/compliance/credentials" />
        <Kpi icon="⚠️" tint="bg-rose-50" label="High-Risk Staff" value={d.highRiskStaff.length} tone={d.highRiskStaff.length ? "text-rose-600" : "text-gray-400"} sub="hard-stop gaps" href="/competency-office/compliance" />
        <Kpi icon="🏅" tint="bg-sky-50" label="Accreditation" value={d.accreditation.provisioned ? d.accreditation.standards : "—"} tone="text-gray-900" sub={d.accreditation.provisioned ? `${d.accreditation.frameworks} standards frameworks` : "standards mapping next-phase"} href="/competency-office/compliance/accreditation" />
        <Kpi icon="📄" tint="bg-violet-50" label="Open Exceptions" value="—" tone="text-gray-300" sub="exception store next-phase" href="/competency-office/compliance/exceptions" />
      </div>

      {/* Heatmap + domain + high-risk staff */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance Heatmap <span className="text-[10px] font-normal text-gray-400">by unit</span></h3>
          {d.heatmap.length === 0 ? <p className="text-sm text-gray-400">No unit compliance data yet.</p> : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{d.heatmap.slice(0, 9).map((u: any) => (
              <div key={u.id} className={`rounded-lg p-2.5 text-white ${cellTone(u.pct)}`}><p className="text-[10px] font-medium truncate opacity-90">{u.name}</p><p className="text-lg font-bold tabular-nums">{u.pct}%</p></div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance by Domain</h3>
          {d.domains.length === 0 ? <p className="text-sm text-gray-400">Domain mapping needed.</p> : (
            <div className="space-y-2">{d.domains.slice(0, 6).map((dom: any) => (
              <div key={dom.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{dom.name}</span><span className={`tabular-nums font-semibold ${pctTone(dom.pct)}`}>{dom.pct}%</span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(dom.pct)}`} style={{ width: `${dom.pct}%` }} /></div></div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">High-Risk Staff <span className="text-[10px] font-normal text-gray-400">hard-stop</span></h3>
          {d.highRiskStaff.length === 0 ? <p className="text-sm text-gray-400">No hard-stop compliance gaps. 🎉</p> : (
            <div className="space-y-1.5">{d.highRiskStaff.slice(0, 6).map((s: any) => (
              <div key={s.id} className="flex items-center justify-between gap-2 text-xs"><div className="flex items-center gap-2 min-w-0"><span className="w-6 h-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px] font-bold shrink-0">{(s.name?.[0] ?? "?").toUpperCase()}</span><div className="min-w-0"><p className="text-gray-800 truncate">{s.name}</p><p className="text-[10px] text-gray-400">{s.reason}</p></div></div><span className="text-rose-600 font-semibold tabular-nums shrink-0">{s.score}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Expiring compliance + credentials + AI */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Expiring Compliance</h3><Link href="/competency-office/compliance/credentials" className="text-[11px] text-teal-600 hover:underline">All →</Link></div>
          {expiringAll.length === 0 ? <p className="text-sm text-gray-400">Nothing expiring in 30 days.</p> : (
            <div className="space-y-2">{expiringAll.map((x: any, i: number) => (
              <div key={i} className="flex items-center justify-between gap-2"><div className="min-w-0"><p className="text-xs font-medium text-gray-800 truncate">{x.name}</p><p className="text-[10px] text-gray-400 truncate">{x.kind}: {x.requirement}</p></div><span className={`text-[10px] font-medium shrink-0 ${x.days <= 7 ? "text-rose-600" : x.days <= 14 ? "text-amber-600" : "text-gray-500"}`}>{x.days}d</span></div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Credential Validity</h3>
          {!d.credentials.provisioned ? <p className="text-sm text-gray-400">Credential register not provisioned.</p> : d.credentials.total === 0 ? <p className="text-sm text-gray-400">No credentials on record.</p> : (
            <>
              <div className="grid grid-cols-3 gap-2 text-center mb-3">
                <div className="rounded-lg bg-emerald-50 py-2"><p className="text-lg font-bold text-emerald-700 tabular-nums">{d.credentials.valid}</p><p className="text-[10px] text-emerald-600">Valid</p></div>
                <div className="rounded-lg bg-amber-50 py-2"><p className="text-lg font-bold text-amber-700 tabular-nums">{d.credentials.expiring}</p><p className="text-[10px] text-amber-600">Expiring</p></div>
                <div className="rounded-lg bg-rose-50 py-2"><p className="text-lg font-bold text-rose-700 tabular-nums">{d.credentials.expired}</p><p className="text-[10px] text-rose-600">Expired</p></div>
              </div>
              <Link href="/admin/credentials" className="text-[11px] text-teal-600 hover:underline">Open credential register →</Link>
            </>
          )}
        </div>

        <div className={`${card} p-5 bg-gradient-to-br from-teal-50/40 to-white`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">✨ AI Compliance Insights <span className="text-[10px] font-normal text-gray-400">explainable</span></h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority compliance actions.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Compliance domains + remediation + activity */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5 xl:col-span-1`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance Domains</h3>
          <div className="grid grid-cols-1 gap-1.5">
            {[["🎓 Professional Credentials", "/admin/credentials"], ["📝 Assessment Compliance", "/competency-office/assessments"], ["📖 Learning Compliance", "/admin/curricula"], ["🗂️ Framework Compliance", "/competency-office/frameworks"], ["📈 Analytics & Reports", "/competency-office/analytics"]].map(([label, href]) => (
              <Link key={href} href={href} className="flex items-center justify-between border border-gray-200 rounded-lg px-3 py-2 text-xs text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors"><span>{label}</span><span className="text-gray-300">→</span></Link>
            ))}
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Remediation Plans</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-6 text-center"><p className="text-3xl mb-1 opacity-40">🛠️</p><p className="text-sm text-gray-500">Closed-loop remediation plans (owner, milestones, effectiveness review) need a remediation store.</p><p className="text-[11px] text-gray-400 mt-1">Honest next-phase (CMO-002 §14).</p></div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Activity Feed</h3>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400">No recent compliance activity.</p> : (
            <div className="divide-y divide-gray-50">{d.activity.slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "—"}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Compliance Centre (CMO-002 §5) over the live compliance spine (competency_decisions + professional_credentials + framework domains). Real: overall compliance, mandatory completion, expiring competencies &amp; credentials, named high-risk staff (hard-stop: expired mandatory / critical failure), credential validity, compliance heatmap &amp; by-domain, and rule-based explainable AI insights. Honest next-phase: accreditation standards mapping, exceptions, remediation plans and regulatory rule packs — each needs its own store. Source: competency compliance services; calculated {todayLabel()}; weighted compliance v1.</p>
    </div>
  );
}
