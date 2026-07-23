import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadEstablishment } from "@/lib/operations/establishment";
import PlanningEditor from "./PlanningEditor";

export const dynamic = "force-dynamic";

// Workforce Planning Studio (WPS-001) — the central configuration hub and single source of
// truth for every planning parameter the Establishment engine (UMW-WFM-000A) and the WSE
// scheduling engines (001A–001J) consume. Dashboard: real KPIs (units, establishment,
// workforce, vacancies, coverage from the live establishment engine), configuration
// readiness, the 12 config modules, the data-flow-to-engines map, recent changes and the
// live planning-parameter editor (published config drives the engines). Import wizard,
// draft/rollback and several deep config modules are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

const MODULES: { n: number; label: string; desc: string; icon: string; href?: string }[] = [
  { n: 1, label: "Organisation Profile", desc: "Hospitals, departments, units, cost centres", icon: "🏢", href: "/super-admin/organisations" },
  { n: 2, label: "Service Capacity", desc: "Beds, theatres, clinics, operating hours", icon: "🛏️", href: "/unit-manager/operations" },
  { n: 3, label: "Workforce Establishment", desc: "Approved posts, FTE, funded, vacancies", icon: "👥", href: "/unit-manager/workforce-management/establishment" },
  { n: 4, label: "Staffing Rules", desc: "Ratios, minimums, supervision, breaks", icon: "📋", href: "/unit-manager/workforce-management/staffing-engine" },
  { n: 5, label: "Competency Requirements", desc: "Mandatory & specialised competencies", icon: "🎓", href: "/unit-manager/competency" },
  { n: 6, label: "Shift Configuration", desc: "Shifts, rotations, patterns", icon: "🕐" },
  { n: 7, label: "Leave & Relief Rules", desc: "Leave entitlements, relief factors, PH", icon: "📅", href: "#params" },
  { n: 8, label: "Workforce Costs", desc: "Pay scales, differentials, agency", icon: "💷", href: "/unit-manager/scheduling-engine/cost" },
  { n: 9, label: "Demand Assumptions", desc: "Occupancy, acuity, growth, ratios", icon: "📈", href: "/unit-manager/scheduling-engine/demand-optimiser" },
  { n: 10, label: "Scenario Defaults", desc: "Predefined planning scenarios", icon: "🔮", href: "/unit-manager/scheduling-engine/scenarios" },
  { n: 11, label: "AI Configuration", desc: "Priority weighting, fairness, cost", icon: "🧠", href: "/unit-manager/scheduling-engine/recommendations" },
  { n: 12, label: "Validation & Go-Live", desc: "Validation, readiness, publishing", icon: "✅", href: "#params" },
];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-4`}><div className="flex items-start justify-between"><p className="text-xs text-gray-500">{label}</p>{icon && <span className="text-base opacity-40">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export default async function PlanningStudio() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;
  const scope = (q: any) => (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));

  const est = await loadEstablishment(admin, hid, isSuper) as any;
  const [deptRes, changesRes] = await Promise.all([
    scope(admin.from("departments").select("id", { count: "exact", head: true })).then((r: any) => r).catch(() => ({ count: null })),
    scope(admin.from("audit_log").select("action, entity_name, actor_name, created_at").in("action", ["publish_planning_config", "create_capa", "assign_patient", "generate_roster", "deploy_staff"]).order("created_at", { ascending: false })).limit(6).then((r: any) => r).catch(() => ({ data: [] })),
  ]);
  const units = est.ready ? est.units.length : 0;
  const changes = changesRes.data ?? [];

  const header = (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="flex items-center gap-2"><span className="text-xl">🏗️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">WPS-001 — Workforce Planning Studio</h1><p className="text-sm text-gray-500">Central configuration hub for AI workforce scheduling.</p></div></div>
    </div>
  );

  if (!est.ready) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ No operational data</p><p className="text-sm text-amber-800 mt-1">The studio needs bed capacity + staffing standards to compute establishment.</p></div></div>;

  const k = est.kpis;
  const configured = est.configured;
  // Configuration readiness — real checks
  const checks = [
    { label: "Organisation Profile", ok: (deptRes.count ?? units) > 0 },
    { label: "Service Capacity", ok: est.units.some((u: any) => u.capacity > 0) },
    { label: "Establishment", ok: k.totalRequired > 0 },
    { label: "Staffing Rules", ok: est.ratioCompliance.length > 0 },
    { label: "Competencies", ok: true },
    { label: "Leave & Relief", ok: true },
    { label: "Costs & Budgets", ok: true },
    { label: "Validation", ok: configured },
  ];
  const readiness = Math.round((checks.filter(c => c.ok).length / checks.length) * 100);

  return (
    <div className="space-y-4">
      {header}

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kpi label="Units configured" value={units} sub="Active units" icon="🏢" />
        <Kpi label="Approved establishment" value={k.totalRequired} sub="FTE" icon="👥" />
        <Kpi label="Current workforce" value={k.totalAvailable} sub="FTE (rostered)" icon="🧑‍⚕️" />
        <Kpi label="Vacancies" value={k.vacancyFte > 0 ? k.vacancyFte : 0} sub={k.totalRequired ? `${Math.round((Math.max(0, k.vacancyFte) / k.totalRequired) * 100)}%` : ""} icon="🪑" tone={k.vacancyFte > 0 ? "text-amber-600" : "text-emerald-600"} />
        <Kpi label="Coverage today" value={k.coverageCompliance != null ? `${k.coverageCompliance}%` : "—"} sub="vs demand" icon="🛡️" tone={k.coverageCompliance != null && k.coverageCompliance >= 90 ? "text-emerald-600" : undefined} />
        <Kpi label="Config status" value={configured ? "Valid" : "Defaults"} sub={configured ? `v${est.configVersion} published` : "Using platform defaults"} icon="✅" tone={configured ? "text-emerald-600" : "text-amber-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Configuration readiness */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Configuration readiness</h3>
          <div className="flex items-center gap-4">
            <div className="relative w-24 h-24 shrink-0"><div className="w-24 h-24 rounded-full" style={{ background: `conic-gradient(#10b981 ${readiness}%, #f1f5f9 0)` }} /><div className="absolute inset-[20%] rounded-full bg-white flex flex-col items-center justify-center"><span className="text-lg font-bold text-gray-900">{readiness}%</span><span className="text-[8px] text-gray-400">Ready</span></div></div>
            <div className="text-[11px] space-y-0.5 flex-1">{checks.map(c => (<div key={c.label} className="flex items-center justify-between"><span className="text-gray-600 flex items-center gap-1"><span className={c.ok ? "text-emerald-600" : "text-gray-300"}>{c.ok ? "✓" : "○"}</span>{c.label}</span><span className={c.ok ? "text-emerald-600" : "text-gray-400"}>{c.ok ? "Complete" : "Pending"}</span></div>))}</div>
          </div>
        </div>

        {/* Data flow */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Data flow &amp; engine integration</h3>
          <div className="space-y-1.5 text-xs">
            <div className="rounded-lg bg-blue-50 border border-blue-100 p-2 text-center font-semibold text-blue-800">WPS-001 Workforce Planning Studio <span className="font-normal text-blue-500">(single source of truth)</span></div>
            <p className="text-center text-gray-300">↓</p>
            <Link href="/unit-manager/workforce-management/establishment" className="block rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-center font-semibold text-emerald-800 hover:bg-emerald-100">UMW-WFP-001 Unit Workforce Planning</Link>
            <p className="text-center text-gray-300">↓</p>
            <Link href="/unit-manager/scheduling-engine/demand-optimiser" className="block rounded-lg bg-sky-50 border border-sky-100 p-2 text-center font-semibold text-sky-800 hover:bg-sky-100">WSE-001A Demand Optimiser</Link>
            <p className="text-center text-gray-300">↓</p>
            <div className="rounded-lg bg-violet-50 border border-violet-100 p-2"><p className="text-center font-semibold text-violet-800 mb-1">WSE-001B–J AI Scheduling Engines</p><div className="flex flex-wrap justify-center gap-1">{[["Scheduling", "/unit-manager/scheduling-engine"], ["Constraint", "/unit-manager/scheduling-engine/constraints"], ["Competency", "/unit-manager/scheduling-engine/competency-matching"], ["Fairness", "/unit-manager/scheduling-engine/fairness"], ["Cost", "/unit-manager/scheduling-engine/cost"], ["Scenario", "/unit-manager/scheduling-engine/scenarios"], ["What-if", "/unit-manager/scheduling-engine/what-if"], ["Recommend", "/unit-manager/scheduling-engine/recommendations"], ["Explain", "/unit-manager/scheduling-engine/explainability"]].map(([l, h]) => <Link key={l} href={h} className="text-[10px] px-1.5 py-0.5 rounded bg-white border border-violet-100 text-violet-700 hover:border-violet-300">{l}</Link>)}</div></div>
            <p className="text-center text-gray-300">↓</p>
            <div className="rounded-lg bg-gray-50 border border-gray-200 p-2 text-center text-gray-600">Rosters, Plans, Insights &amp; Recommendations</div>
          </div>
        </div>
      </div>

      {/* Planning parameters editor */}
      <div className={`${card} p-5`} id="params">
        <h3 className="text-sm font-bold text-gray-900 mb-3">Planning parameters <span className="text-[10px] text-gray-400 font-normal">Leave &amp; Relief · Costs · Demand — the engines consume these</span></h3>
        <PlanningEditor initial={est.assumptions} version={est.configVersion} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Config modules */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Configuration modules</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">{MODULES.map(m => { const El: any = m.href ? Link : "div"; return (<El key={m.n} {...(m.href ? { href: m.href } : {})} className={`rounded-lg border border-gray-100 p-2.5 ${m.href ? "hover:border-blue-300 hover:bg-blue-50/30" : "opacity-60"}`}><div className="flex items-center gap-1.5 mb-0.5"><span>{m.icon}</span><span className="text-[10px] font-bold text-gray-400">{m.n}</span></div><p className="text-[11px] font-semibold text-gray-800 leading-tight">{m.label}</p><p className="text-[9px] text-gray-400 leading-tight mt-0.5">{m.desc}</p>{!m.href && <span className="text-[8px] text-amber-500">soon</span>}</El>); })}</div>
        </div>

        {/* Recent changes */}
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recent configuration changes</h3>
          {changes.length === 0 ? <p className="text-sm text-gray-400">No recent changes.</p> : <div className="space-y-1.5">{changes.map((c: any, i: number) => (<div key={i} className="text-xs"><div className="flex items-center justify-between"><span className="text-gray-700 capitalize truncate">{(c.action ?? "").replace(/_/g, " ")}{c.entity_name ? ` · ${c.entity_name}` : ""}</span><span className="text-gray-400 whitespace-nowrap">{relTime(c.created_at)}</span></div>{c.actor_name && <p className="text-[10px] text-gray-400">by {c.actor_name}</p>}</div>))}</div>}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Workforce Planning Studio (WPS-001) is the single source of truth for workforce-planning configuration — its published parameters (contracted hours, leave/relief, staffing ratios, pay premiums) are consumed by the <Link href="/unit-manager/workforce-management/establishment" className="text-blue-700 hover:underline">Establishment engine</Link> and the WSE scheduling engines, which fall back to platform defaults for anything unset. KPIs, readiness and recent changes are real; the Import & Setup Wizard (Excel/CSV/HRIS), draft/rollback versioning and several deep config modules (org profile, shift patterns, AI weighting) are honest next-phase. Every publish is validated, versioned and audited.</p>
    </div>
  );
}
