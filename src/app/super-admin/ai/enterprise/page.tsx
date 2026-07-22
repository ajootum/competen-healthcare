import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEnterpriseIntelligence } from "@/lib/super-admin/ai-enterprise";

export const dynamic = "force-dynamic";

// Enterprise Intelligence (AIP-001.4) — strategic, quality, financial & executive
// insight. A live enterprise scorecard (real dimensions only, honest "—" for the
// rest), quality/accreditation intelligence, financial utilisation and an
// auto-generated executive briefing rule-derived from live signals.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const pct = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);
const scoreTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 90 ? "text-green-600" : n >= 75 ? "text-teal-600" : n >= 50 ? "text-amber-600" : "text-rose-600");

export default async function EnterpriseIntelligence() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadEnterpriseIntelligence(admin);
  const sc = d.scorecard;
  const q = d.quality;

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ai" className="hover:text-teal-700">AI &amp; Intelligence</Link><span>/</span><span className="text-gray-600">Enterprise Intelligence</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Enterprise Intelligence</h1>
        <p className="text-sm text-gray-500">Strategic, quality, financial and operational insight for executives and platform administrators.</p>
      </div>

      {/* Enterprise scorecard */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 text-[15px]">Enterprise Scorecard</h2>
          <span className="text-[10px] text-gray-400">{sc.computedCount}/8 dimensions measured</span>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-5">
          <div className="text-center shrink-0">
            <p className={`text-5xl font-bold tabular-nums ${scoreTone(sc.overall)}`}>{pct(sc.overall)}</p>
            <p className="text-xs text-gray-500 mt-1">Overall Enterprise Score</p>
            <p className="text-[10px] text-gray-400">mean of measured dimensions</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 flex-1 w-full">
            {sc.dims.map((dim: any) => (
              <div key={dim.key} className="rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${scoreTone(dim.value)}`}>{pct(dim.value)}</p>
                <p className="text-[9px] text-gray-500 mt-1 leading-tight">{dim.label}</p>
              </div>
            ))}
          </div>
        </div>
        <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Dimensions are filled only from defensible direct metrics (competency scores, audit compliance, CAPA closure, incident resolution, subscription activation). Patient Safety % and any dimension without a clean signal show an honest “—” rather than a fabricated score.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Executive briefing */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Executive Briefing <span className="text-[10px] text-gray-400">auto-generated · live signals</span></h2>
            <Link href="/super-admin/reports" className="text-xs text-teal-700 hover:underline">Report templates →</Link>
          </div>
          <ul className="space-y-2">
            {d.briefing.map((b: string, i: number) => (
              <li key={i} className="text-sm text-gray-700 flex items-start gap-2"><span className="text-teal-500 shrink-0 mt-0.5">▸</span><span>{b}</span></li>
            ))}
          </ul>
        </div>

        {/* Financial intelligence */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Financial Intelligence</h2>
          <div className="text-center py-1">
            <p className={`text-3xl font-bold tabular-nums ${scoreTone(d.financial.health)}`}>{pct(d.financial.health)}</p>
            <p className="text-[10px] text-gray-500">subscription activation</p>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-lg border border-gray-100 p-2.5 text-center"><p className="text-lg font-bold text-gray-900 tabular-nums">{dash(d.financial.active)}</p><p className="text-[9px] text-gray-500">Active</p></div>
            <div className="rounded-lg border border-gray-100 p-2.5 text-center"><p className="text-lg font-bold text-gray-900 tabular-nums">{dash(d.financial.subscriptions)}</p><p className="text-[9px] text-gray-500">Total subs</p></div>
          </div>
          <Link href="/super-admin/platform-ops/licensing" className="block text-center text-xs text-teal-700 hover:underline mt-3">Licensing →</Link>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Quality & safety intelligence */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Quality &amp; Safety Intelligence</h2>
            <Link href="/super-admin/governance/committees" className="text-xs text-teal-700 hover:underline">Governance →</Link>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              ["Audits", q.audits, "text-gray-900"],
              ["Avg Compliance", q.avgCompliance == null ? "—" : `${q.avgCompliance}%`, "text-gray-900"],
              ["Fully Met", q.fullyMet, "text-green-600"],
              ["Open CAPA", q.openCapa, q.openCapa > 0 ? "text-amber-600" : "text-gray-900"],
              ["High-Priority CAPA", q.openCapaHigh, q.openCapaHigh > 0 ? "text-rose-600" : "text-gray-900"],
              ["Safety Alerts", q.safetyAlerts, (q.safetyAlerts ?? 0) > 0 ? "text-rose-600" : "text-gray-900"],
            ].map(([l, v, tone]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-3 text-center">
                <p className={`text-xl font-bold tabular-nums ${tone}`}>{typeof v === "number" ? v.toLocaleString() : v}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{l}</p>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Accreditation readiness = share of audits with zero unmet items; compliance = CAPA closure rate. Live from the audit &amp; corrective-action records.</p>
        </div>

        {/* Enterprise structure */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Enterprise Structure</h2>
          <div className="space-y-2">
            {[
              ["Enterprises", d.structure.enterprises, "/super-admin/enterprise"],
              ["Organisations", d.structure.organisations, "/super-admin/enterprise/organisations"],
              ["Facilities", d.structure.facilities, "/super-admin/enterprise/facilities"],
              ["Users", d.structure.users, "/super-admin/enterprise/people"],
            ].map(([l, n, href]: any) => (
              <Link key={l} href={href} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
                <span className="text-sm text-gray-700">{l}</span><span className="text-sm font-bold text-gray-900 tabular-nums">{dash(n)}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>

      {/* Capabilities */}
      <div className={`${card} p-5`}>
        <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Capabilities</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {d.capabilities.map((c: any) => (
            <Link key={c.name} href={c.href} className="rounded-lg border border-gray-100 p-3 hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
              <p className="text-sm font-medium text-gray-800 leading-tight">{c.name}</p>
              <p className="text-[10px] text-gray-500 leading-tight mt-0.5">{c.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Enterprise Intelligence turns live platform data into executive insight. The scorecard, quality intelligence and financial utilisation are computed from real records (competency_scores, audits, capa_actions, plat_subscriptions, op_escalations); the executive briefing is rule-derived from those same signals. Decisions follow the human-in-the-loop workflow — insight → classify → recommend → review → decide → assign → monitor. Benchmarking context and scenario modelling deepen as cross-facility comparators are wired.</p>
    </div>
  );
}
