import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEnterpriseGovernance } from "@/lib/enterprise-governance-data";
import { card, tone, pctText, ScopeBanner, BenchmarkTable, Kpi } from "./_ui";

export const dynamic = "force-dynamic";

// Enterprise Governance Dashboard (EGV-001).
/* eslint-disable @typescript-eslint/no-explicit-any */

const alertTone: Record<string, string> = { red: "bg-red-50 border-red-200", amber: "bg-amber-50 border-amber-200", gray: "bg-gray-50 border-gray-200" };

export default async function EnterpriseGovernanceDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadEnterpriseGovernance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { enterpriseName, scopeMode, kpis, benchmark, standards, alerts, truncated } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Enterprise Governance</h1>
          <p className="text-sm text-gray-500 mt-1">Governance across {kpis.organisations} organisation{kpis.organisations !== 1 ? "s" : ""} · standards, benchmarking, regulatory &amp; strategy · {profile?.full_name}</p>
        </div>
        <ScopeBanner mode={scopeMode} name={enterpriseName} />
      </div>

      {/* Enterprise KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi n={kpis.organisations} label="Organisations" href="/enterprise-governance/tenants" />
        <Kpi n={kpis.facilities} label="Facilities" />
        <Kpi n={kpis.users} label="Workforce" sub="users on platform" />
        <Kpi n={pctText(kpis.avgCompetency)} label="Avg competency currency" toneCls={tone(kpis.avgCompetency)} href="/enterprise-governance/benchmarking" />
        <Kpi n={pctText(kpis.avgCompliance)} label="Avg quality compliance" toneCls={tone(kpis.avgCompliance)} href="/enterprise-governance/regulatory" />
        <Kpi n={pctText(kpis.standardsCompliance)} label="Standards published" toneCls={tone(kpis.standardsCompliance)} sub={`${standards.published}/${standards.total}`} href="/enterprise-governance/standards" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Multi-organisation performance comparison */}
        <div className={`${card} lg:col-span-2`}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Multi-organisation performance</h3>
            <Link href="/enterprise-governance/benchmarking" className="text-xs text-teal-600 hover:underline">Full benchmarking →</Link>
          </div>
          <BenchmarkTable rows={benchmark.slice(0, 8)} />
          {benchmark.length > 8 && <p className="text-[11px] text-gray-400 mt-2">Showing 8 of {benchmark.length} organisations by competency currency.</p>}
          {truncated && <p className="text-[11px] text-amber-600 mt-1">Figures are based on the most recent records and may be capped at this platform scale.</p>}
        </div>

        {/* Standards compliance overview */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Enterprise standards</h3>
          <div className="grid grid-cols-3 gap-3 text-center mb-3">
            <div><div className="text-2xl font-bold tabular-nums text-green-600">{standards.published}</div><div className="text-[11px] text-gray-500 mt-0.5">Published</div></div>
            <div><div className="text-2xl font-bold tabular-nums text-amber-600">{standards.draft}</div><div className="text-[11px] text-gray-500 mt-0.5">Draft</div></div>
            <div><div className="text-2xl font-bold tabular-nums text-gray-400">{standards.other}</div><div className="text-[11px] text-gray-500 mt-0.5">Other</div></div>
          </div>
          <p className="text-[11px] text-gray-400">Shared master competency standards inherited by every tenant. <Link href="/enterprise-governance/standards" className="text-teal-600 hover:underline">Govern standards →</Link></p>
        </div>

        {/* Strategic governance alerts */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Strategic governance alerts</h3>
          {alerts.length === 0 && <p className="text-sm text-green-700">✅ No governance exceptions across the enterprise.</p>}
          <div className="space-y-1.5 max-h-56 overflow-y-auto">
            {alerts.slice(0, 8).map((a, i) => (
              <div key={i} className={`flex items-center gap-2 text-sm border rounded-lg px-3 py-1.5 ${alertTone[a.tone] ?? "bg-gray-50 border-gray-200"}`}>
                <span>{a.icon}</span><span className="text-gray-700">{a.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* AI governance insights — later phase */}
        <div className={`${card} border-dashed`}>
          <h3 className="font-semibold text-gray-900 mb-1">AI governance insights</h3>
          <p className="text-sm text-gray-400">Cross-tenant anomaly detection, standards-drift analysis and board-narrative generation arrive in a later EGV phase. The benchmarking, standards and compliance signals it reasons over are already live above.</p>
        </div>

        {/* Notifications */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Notifications</h3>
          {(notifs ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing new.</p>}
          <div className="space-y-1.5">
            {(notifs ?? []).map((n: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm"><span className="text-gray-800 truncate">{n.title}</span><span className="ml-auto text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span></div>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className={card}>
        <h3 className="font-semibold text-gray-900 mb-3">Quick actions</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
          {[["📊 Benchmarking", "/enterprise-governance/benchmarking"], ["📐 Enterprise standards", "/enterprise-governance/standards"], ["🏢 Multi-tenant governance", "/enterprise-governance/tenants"], ["⚖️ Regulatory compliance", "/enterprise-governance/regulatory"], ["🏛️ Competency Office", "/competency-office"], ["🎯 Quality & Accreditation", "/quality-accreditation"], ["🗂️ Organisation admin", "/organisation-admin"], ["🛰️ Hospital Executive", "/hospital-executive"]].map(([label, href]) => (
            <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
          ))}
        </div>
      </div>
    </div>
  );
}
