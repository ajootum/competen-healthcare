import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// CAPM-000 — Competency Performance Management Platform. The PERFORMANCE layer: it measures competency's impact on
// outcomes and consolidates performance across individual / team / org / executive levels, consuming the real
// stores the rest of Competen produces. This hub maps the 10 CAPM engines to real surfaces and is honest about
// each: Live (a dedicated engine built here), Linked (an existing surface already owns it — cross-linked, not
// duplicated), Partial (data real, a fuller build needs more) or Planned. No migration — a view over performance
// infrastructure that already exists. Counts are live.

export const dynamic = "force-dynamic";

type Status = "real" | "linked" | "partial" | "gap";
type Mod = { code: string; icon: string; label: string; desc: string; href?: string; status: Status };

const BADGE: Record<Status, { text: string; cls: string }> = {
  real: { text: "Live", cls: "text-teal-700 bg-teal-50 border-teal-100" },
  linked: { text: "Linked", cls: "text-blue-600 bg-blue-50 border-blue-100" },
  partial: { text: "Partial", cls: "text-amber-600 bg-amber-50 border-amber-100" },
  gap: { text: "Planned", cls: "text-gray-400 bg-gray-50 border-gray-100" },
};

function EngineCard({ m }: { m: Mod }) {
  const b = BADGE[m.status];
  const inner = (
    <>
      <div className="flex items-center gap-2.5 mb-1.5">
        <span className="text-xl shrink-0">{m.icon}</span>
        <div className="min-w-0">
          <p className="text-[9px] font-bold text-gray-300 tracking-widest">{m.code}</p>
          <p className={`font-bold text-sm leading-tight ${m.status === "gap" ? "text-gray-500" : "text-gray-900 group-hover:text-sky-700"}`}>{m.label}</p>
        </div>
        <span className={`ml-auto shrink-0 text-[8px] font-bold uppercase tracking-wide border px-1.5 py-0.5 rounded ${b.cls}`}>{b.text}</span>
      </div>
      <p className="text-[11px] text-gray-400 leading-relaxed">{m.desc}</p>
    </>
  );
  const base = "bg-white rounded-xl border border-gray-100 p-4 block";
  return m.href
    ? <Link href={m.href} className={`${base} hover:border-sky-200 hover:shadow-sm transition-all group`}>{inner}</Link>
    : <div className={`${base} opacity-80`}>{inner}</div>;
}

function Layer({ title, mods }: { title: string; mods: Mod[] }) {
  return (
    <>
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{title}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 mb-7">{mods.map(m => <EngineCard key={m.code} m={m} />)}</div>
    </>
  );
}

export default async function PerformancePlatformPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const c = (q: PromiseLike<{ count: number | null }>) => Promise.resolve(q).then(r => r.count ?? 0).catch(() => 0);
  const [decisions, snapshots, incidents, actions, kpis, departments] = await Promise.all([
    c(admin.from("competency_decisions").select("id", { count: "exact", head: true })),
    c(admin.from("op_ops_snapshots").select("id", { count: "exact", head: true })),
    c(admin.from("op_incidents").select("id", { count: "exact", head: true })),
    c(admin.from("op_quality_actions").select("id", { count: "exact", head: true })),
    c(admin.from("pa_kpis").select("id", { count: "exact", head: true })),
    c(admin.from("departments").select("id", { count: "exact", head: true })),
  ]);
  const STATS = [
    { label: "Competency decisions", value: decisions, icon: "⚖️" },
    { label: "Performance snapshots", value: snapshots, icon: "📸" },
    { label: "Outcome incidents", value: incidents, icon: "🚨" },
    { label: "Improvement actions", value: actions, icon: "🛠️" },
    { label: "Tracked KPIs", value: kpis, icon: "🎯" },
    { label: "Departments", value: departments, icon: "🏬" },
  ];

  const METRICS: Mod[] = [
    { code: "CAPM-001", icon: "📐", label: "Performance Metrics Engine", desc: "Standardised competency-performance KPIs. The metadata-driven balanced-scorecard engine (pa_* metrics) is live in the Performance workspace; competency-specific KPIs are the next layer.", href: "/unit-manager/performance/scorecard", status: "linked" },
    { code: "CAPM-005", icon: "🔗", label: "Competency-to-Outcome Correlation", desc: "The analytical core — does higher competency go with better outcomes? Pearson correlation of per-department competency coverage against real safety outcomes (observation compliance, escalation rate), honest about ecological/small-N.", href: "/super-admin/performance/correlation", status: "real" },
  ];
  const INTEL: Mod[] = [
    { code: "CAPM-002", icon: "🧑‍⚕️", label: "Individual Performance Intelligence", desc: "A 360° per-worker performance profile fusing competency, assessment, learning and outcomes. Per-nurse pieces exist (COMP-012, passport); the fused profile is the gap.", href: "/competency-office/analytics", status: "partial" },
    { code: "CAPM-003", icon: "👥", label: "Team & Department Analytics", desc: "Team/department competency performance & readiness. Owned by the Unit Manager Performance workspace (workforce analytics).", href: "/unit-manager/performance/workforce", status: "linked" },
    { code: "CAPM-004", icon: "🏛️", label: "Organizational Capability", desc: "Enterprise capability & readiness. The Hospital Executive workspace owns the executive capability view — cross-linked.", href: "/hospital-executive", status: "linked" },
  ];
  const IMPROVE: Mod[] = [
    { code: "CAPM-006", icon: "📊", label: "Benchmarking & Maturity", desc: "Compare competency maturity across units/departments/hospitals. Seeded comparators exist in PA trends; real computed cross-unit benchmarking is the gap.", href: "/unit-manager/performance/trends", status: "partial" },
    { code: "CAPM-007", icon: "🛠️", label: "Performance Improvement Planner", desc: "Turn performance gaps into improvement plans. Owned by the CAPA centre (op_quality_actions) + PA improvement projects + remediation — cross-linked.", href: "/unit-manager/capa", status: "linked" },
    { code: "CAPM-009", icon: "🔮", label: "Workforce Capability Forecasting", desc: "Forecast future capability, shortages and succession readiness. Predictive surfaces exist (PA-007, workforce intelligence); a real forecast model is the next layer.", href: "/unit-manager/performance/predictive", status: "linked" },
  ];
  const EXEC: Mod[] = [
    { code: "CAPM-008", icon: "🛰️", label: "Executive Performance Intelligence", desc: "Strategic executive performance visibility & board reporting. The Hospital Executive workspace owns this outright — cross-linked.", href: "/hospital-executive/performance", status: "linked" },
    { code: "CAPM-010", icon: "🤖", label: "AI Performance Intelligence", desc: "A live copilot grounded in the balanced scorecard + the competency-to-outcome correlation — predicts, recommends and explains over real performance signals via the governed AI gateway. Treats correlation as directional, never causal.", href: "/super-admin/performance/ai", status: "real" },
  ];

  const all = [...METRICS, ...INTEL, ...IMPROVE, ...EXEC];
  const nReal = all.filter(m => m.status === "real").length;
  const nLinked = all.filter(m => m.status === "linked").length;
  const nPartial = all.filter(m => m.status === "partial").length;
  const nGap = all.filter(m => m.status === "gap").length;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-sky-500 uppercase tracking-widest mb-0.5">CAPM-000 · Competency Performance Management</p>
          <h1 className="text-xl font-bold text-gray-900">Competency Performance</h1>
          <p className="text-gray-400 text-sm mt-0.5">The performance layer — does validated competency demonstrably improve outcomes? Studio authors, Delivery runs, Assurance verifies, and Performance measures the impact.</p>
        </div>
        <Link href="/super-admin" className="text-xs font-semibold text-gray-500 hover:text-sky-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Mission Control</Link>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-5">
        {STATS.map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
            <div className="flex items-center justify-between mb-1"><span className="text-sm">{s.icon}</span><p className="text-lg font-bold text-gray-900">{s.value}</p></div>
            <p className="text-[10px] text-gray-400 font-medium leading-tight">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-5 text-[11px]">
        {nReal > 0 && <span className="font-semibold text-teal-700 bg-teal-50 border border-teal-100 rounded-lg px-2.5 py-1">{nReal} live</span>}
        {nLinked > 0 && <span className="font-semibold text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1">{nLinked} linked (existing surface)</span>}
        {nPartial > 0 && <span className="font-semibold text-amber-600 bg-amber-50 border border-amber-100 rounded-lg px-2.5 py-1">{nPartial} partial</span>}
        {nGap > 0 && <span className="font-semibold text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{nGap} planned</span>}
      </div>

      <Layer title="Metrics & Correlation · CAPM-001/005" mods={METRICS} />
      <Layer title="Performance Intelligence · CAPM-002/003/004" mods={INTEL} />
      <Layer title="Benchmarking, Improvement & Forecast · CAPM-006/007/009" mods={IMPROVE} />
      <Layer title="Executive & AI · CAPM-008/010" mods={EXEC} />

      <div className="bg-sky-50 border border-sky-100 rounded-xl p-4">
        <p className="text-[11px] text-sky-900">
          <span className="font-bold">One performance layer over the whole competency system.</span> CAPM doesn&apos;t re-collect data — it measures whether the competency machinery is paying off. Individual, team, organisational and executive performance are already owned by the Performance workspace and the Hospital Executive workspace (cross-linked, not duplicated); the genuinely-new engine — <span className="font-semibold">competency-to-outcome correlation</span> — is what this platform adds on top of the real competency, outcome and operational stores.
        </p>
      </div>
    </div>
  );
}
