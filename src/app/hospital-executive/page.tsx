import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadExecutiveDashboard } from "@/lib/executive-data";

export const dynamic = "force-dynamic";

// Hospital Executive Dashboard (HEX-001) — the 30-second enterprise view.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const tone = (n: number | null) => (n == null ? "text-gray-300" : n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");
const barCls = (n: number) => (n >= 85 ? "bg-green-500" : n >= 60 ? "bg-amber-500" : "bg-red-500");
const sevCls: Record<string, string> = {
  high: "bg-red-50 border-red-200 text-red-700",
  medium: "bg-amber-50 border-amber-200 text-amber-700",
  low: "bg-gray-50 border-gray-200 text-gray-500",
};
const statusCls: Record<string, string> = {
  active: "bg-teal-100 text-teal-700", measuring: "bg-blue-100 text-blue-700", planning: "bg-indigo-100 text-indigo-700",
  completed: "bg-green-100 text-green-700", closed: "bg-gray-100 text-gray-500",
};

function Kpi({ n, label, tone: t, sub, href }: { n: any; label: string; tone?: string; sub?: string; href?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${t ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

export default async function ExecutiveDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadExecutiveDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const { hr, quality, scorecard, readinessIndex, risk, riskTotal, riskHigh, initiatives, initiativeStats } = d;
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Hospital Executive</h1>
        <p className="text-sm text-gray-500 mt-1">Enterprise oversight — workforce, competency, quality, risk &amp; strategy in one lens · {profile?.full_name}</p>
      </div>

      {/* Executive KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <Kpi n={readinessIndex == null ? "—" : `${readinessIndex}%`} label="Organisational readiness" tone={tone(readinessIndex)} sub="composite index" href="/hospital-executive/scorecard" />
        <Kpi n={hr.headcount.total} label="Total workforce" sub={`${hr.headcount.nurse} clinical`} href="/human-resources" />
        <Kpi n={quality.accreditationReadiness == null ? "—" : `${quality.accreditationReadiness}%`} label="Quality compliance" tone={tone(quality.accreditationReadiness)} sub={`${quality.audits.completed} audits`} href="/quality-accreditation" />
        <Kpi n={riskHigh} label="High-severity risks" tone={riskHigh ? "text-red-600" : "text-gray-900"} sub={`${riskTotal} open items`} href="/hospital-executive/risk" />
        <Kpi n={hr.positions.vacant} label="Vacancies" tone={hr.positions.vacant ? "text-amber-600" : "text-gray-900"} sub={`${d.fillRate}% established filled`} href="/human-resources/planning" />
        <Kpi n={initiativeStats.active} label="Open initiatives" sub={`${initiativeStats.total} total`} href="/hospital-executive/strategy" />
      </div>

      <div className="grid lg:grid-cols-2 gap-5">
        {/* Hospital performance scorecard + readiness index */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Hospital performance scorecard</h3>
            {readinessIndex != null && <span className={`text-2xl font-bold tabular-nums ${tone(readinessIndex)}`}>{readinessIndex}%</span>}
          </div>
          <div className="space-y-3">
            {scorecard.map((s) => (
              <Link key={s.name} href={s.href} className="block group">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-700 group-hover:text-teal-700">{s.name}</span>
                  <span className={`font-medium ${tone(s.score)}`}>{s.score == null ? "—" : `${s.score}%`}</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full ${s.score == null ? "bg-gray-200" : barCls(s.score)}`} style={{ width: `${s.score ?? 0}%` }} />
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">{s.detail}</p>
              </Link>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3">Composite of the domains that have live data. Rows marked “—” have no records yet.</p>
        </div>

        {/* Risk heat map */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Enterprise risk heat map</h3>
            <Link href="/hospital-executive/risk" className="text-xs text-teal-600 hover:underline">Full register →</Link>
          </div>
          <div className="space-y-2">
            {risk.map((r) => (
              <Link key={r.label} href={r.href} className={`flex items-center justify-between gap-3 border rounded-lg px-3 py-2 text-sm transition-colors ${r.count ? sevCls[r.severity] : "bg-gray-50 border-gray-200 text-gray-400"}`}>
                <span className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide">{r.count ? r.severity : "clear"}</span>
                  <span className={r.count ? "" : "text-gray-400"}>{r.label}</span>
                </span>
                <span className="text-base font-bold tabular-nums">{r.count}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Workforce readiness index */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Workforce readiness</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Establishment fill</span><b className={`tabular-nums ${tone(hr.positions.establishment ? d.fillRate : null)}`}>{hr.positions.establishment ? `${d.fillRate}%` : "—"}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Competency currency</span><b className={`tabular-nums ${tone(hr.competency.total ? hr.competency.coverage : null)}`}>{hr.competency.total ? `${hr.competency.coverage}%` : "—"}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Learning compliance</span><b className={`tabular-nums ${tone(hr.learning.total ? hr.learning.compliance : null)}`}>{hr.learning.total ? `${hr.learning.compliance}%` : "—"}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">In onboarding</span><b className="tabular-nums">{hr.employment.orientation + hr.employment.probation}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">New starters (30d)</span><b className="tabular-nums text-teal-700">{hr.employment.newStarters}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Established posts</span><b className="tabular-nums">{hr.positions.establishment}</b></div>
          </div>
          <Link href="/human-resources" className="mt-3 inline-block text-xs text-teal-600 hover:underline">Open Human Resources →</Link>
        </div>

        {/* Strategic initiative tracker */}
        <div className={card}>
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Strategic initiatives</h3>
            <Link href="/hospital-executive/strategy" className="text-xs text-teal-600 hover:underline">Strategy Centre →</Link>
          </div>
          {initiatives.length === 0 && <p className="text-sm text-gray-400">No improvement initiatives logged yet. Start one in the Quality &amp; Accreditation workspace.</p>}
          <div className="space-y-1.5">
            {initiatives.slice(0, 5).map((i, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate flex-1">{i.title}</span>
                <span className={`shrink-0 text-[10px] px-2 py-0.5 rounded-full ${statusCls[i.status] ?? "bg-gray-100 text-gray-500"}`}>{i.status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Financial summary — honest: no finance source connected */}
        <div className={`${card} border-dashed`}>
          <h3 className="font-semibold text-gray-900 mb-1">Financial intelligence</h3>
          <span className="inline-block text-[10px] font-semibold uppercase tracking-wider text-gray-400 bg-gray-50 border border-gray-200 rounded-full px-2.5 py-1 mb-2">Connect a finance system</span>
          <p className="text-sm text-gray-400">Competen holds no financial ledgers, so revenue, cost and margin analytics activate when a finance/ERP system is integrated. Workforce establishment and vacancy — the people-cost drivers already on platform — are live in Workforce readiness above.</p>
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
          {[["🧠 Executive Command Center", "/admin/executive"], ["📊 Performance scorecard", "/hospital-executive/scorecard"], ["⚠️ Enterprise risk", "/hospital-executive/risk"], ["🎯 Strategy Centre", "/hospital-executive/strategy"], ["👥 Human Resources", "/human-resources"], ["🎯 Quality & Accreditation", "/quality-accreditation"], ["🏛️ Competency Office", "/competency-office"], ["📄 Reports", "/hospital-executive/reports"]].map(([label, href]) => (
            <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
          ))}
        </div>
      </div>

      {/* AI executive insights — later phase */}
      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">AI Executive Advisor</h3>
        <p className="text-sm text-gray-400">Board-narrative generation, scenario modelling and strategic recommendations arrive in a later HEX phase. The readiness, quality, risk and initiative signals it reasons over are already live above.</p>
      </div>
    </div>
  );
}
