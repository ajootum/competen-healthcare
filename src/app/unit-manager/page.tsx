import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitManagerDashboard } from "@/lib/operations/unit-manager-data";
import { filterOpsByDept, loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitCommandTabs from "./UnitCommandTabs";
import UnitFilters from "./UnitFilters";

export const dynamic = "force-dynamic";

// Unit Dashboard (UMW-001) — the Unit Command landing: unit header + four KPI
// groups (Operational, Workforce, Competency, Quality) + readiness/shift/quality
// panels, aggregated live from the shared operational, competency, learning and
// quality stores. Budget, improvement-project targets and performance trends have
// no backing store and are shown as honest states.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const pct = (n: number) => (n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");

function Kpi({ n, label, tone, sub, href }: { n: any; label: string; tone?: string; sub?: string; href?: string }) {
  const inner = (
    <div className={`bg-white rounded-lg border border-gray-200 p-3 ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{label}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Bar({ segments }: { segments: { n: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <>
      <div className="flex h-4 rounded-md overflow-hidden border border-gray-100 mb-2">{segments.map((s, i) => s.n ? <div key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} /> : null)}</div>
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">{segments.map((s, i) => <span key={i}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: s.color }} />{s.label}: <b className="text-gray-800">{s.n}</b></span>)}</div>
    </>
  );
}

const Group = ({ title, icon, children }: any) => (
  <div className={card}><div className="flex items-center gap-1.5 mb-3"><span>{icon}</span><h3 className="text-xs font-bold text-gray-700 uppercase tracking-wide">{title}</h3></div><div className="grid grid-cols-3 gap-2">{children}</div></div>
);

export default async function UnitManagerDashboard({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadUnitManagerDashboard(admin, profile?.hospital_id ?? null, isSuper),
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const { capability, quality, staffCount, assessment, learning } = d as any;
  const ops = filterOpsByDept((d as any).ops, dept);

  // Header + operations derivations from the live ops backbone.
  const beds = ops?.beds ?? [];
  const occupied = beds.filter((b: any) => b.status === "occupied").length;
  const occPct = beds.length ? Math.round((occupied / beds.length) * 100) : 0;
  const activeShift = (ops?.shifts ?? []).find((s: any) => s.status === "active") ?? (ops?.shifts ?? []).find((s: any) => s.status === "planned") ?? null;
  const activeIds = new Set((ops?.shifts ?? []).filter((s: any) => s.status === "active").map((s: any) => s.id));
  const onDuty = (ops?.shiftStaff ?? []).filter((s: any) => activeIds.has(s.shift_id) && ["on_duty", "confirmed", "assigned"].includes(s.status));
  const patients = ops?.patients ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const admissionsToday = patients.filter((p: any) => (p.created_at ?? "").slice(0, 10) === today).length;
  const dischargePending = patients.filter((p: any) => p.operational_status === "discharge_pending").length;
  const transferPending = patients.filter((p: any) => p.operational_status === "transfer_pending").length;
  const nurses = onDuty.filter((s: any) => ["nurse", "charge"].includes(s.role)).length;
  const ratio = nurses ? `1:${(patients.length / nurses).toFixed(1)}` : "—";
  const escalations = ops?.escalations ?? [];
  const highEsc = escalations.some((e: any) => e.level >= 4);

  // Derived Unit Health Score = mean of the available compliance signals (honest: labelled derived).
  const health = [capability?.coverage, learning?.compliance, quality?.avgCompliance].filter((x: any) => x != null) as number[];
  const healthScore = health.length ? Math.round(health.reduce((a, b) => a + b, 0) / health.length) : null;
  const status = highEsc ? { label: "Escalation", tone: "text-rose-600", dot: "bg-rose-500" } : escalations.length ? { label: "Attention", tone: "text-amber-600", dot: "bg-amber-500" } : { label: "Stable", tone: "text-green-600", dot: "bg-green-500" };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Unit Command</h1><p className="text-sm text-gray-500">Operational overview and performance for your unit.</p></div>
        <UnitFilters departments={departments} />
      </div>
      <UnitCommandTabs />

      {/* Unit header card */}
      <div className={`${card} flex flex-wrap items-center gap-x-8 gap-y-3`}>
        <div><p className="text-[10px] text-gray-400 uppercase">Unit</p><p className="text-sm font-bold text-gray-900">{activeShift?.departments?.name ?? "Unit overview"}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Occupancy</p><p className="text-sm font-bold text-gray-900">{occupied} / {beds.length} <span className={occPct >= 90 ? "text-rose-600" : "text-gray-400"}>{beds.length ? `${occPct}%` : ""}</span></p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Current Shift</p><p className="text-sm font-bold text-gray-900 capitalize">{activeShift?.shift_type?.replace(/_/g, " ") ?? "—"}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Shift Supervisor</p><p className="text-sm font-bold text-gray-900">{activeShift?.profiles?.full_name ?? "—"}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Unit Health</p><p className={`text-sm font-bold ${healthScore != null ? pct(healthScore) : "text-gray-400"}`}>{healthScore != null ? `${healthScore}%` : "—"}</p></div>
        <div><p className="text-[10px] text-gray-400 uppercase">Status</p><p className={`text-sm font-bold flex items-center gap-1.5 ${status.tone}`}><span className={`w-2 h-2 rounded-full ${status.dot}`} />{status.label}</p></div>
      </div>

      {!d.ready && <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">Clinical Operations tables aren&apos;t provisioned yet — operational KPIs show —; competency, learning and quality still populate from existing data.</div>}

      {/* 4 KPI groups */}
      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
        <Group title="Operational" icon="🏥">
          <Kpi n={admissionsToday} label="Admissions Today" />
          <Kpi n={dischargePending} label="Discharges Pending" />
          <Kpi n={transferPending} label="Transfers Pending" />
          <Kpi n={patients.length} label="Current Census" />
          <Kpi n={occPct ? `${occPct}%` : "—"} label="Occupancy" tone={occPct >= 90 ? "text-rose-600" : undefined} />
          <Kpi n={escalations.length} label="Escalations" tone={highEsc ? "text-rose-600" : undefined} href="/unit-manager/operations-centre" />
        </Group>
        <Group title="Workforce" icon="👥">
          <Kpi n={onDuty.length} label="Staff on Duty" />
          <Kpi n={ratio} label="Nurse Ratio" />
          <Kpi n={staffCount} label="Unit Workforce" />
          <Kpi n="—" label="Vacancies" sub="HR feed" />
          <Kpi n="—" label="Overtime hrs" sub="rostering" />
          <Kpi n="—" label="Roster coverage" sub="soon" />
        </Group>
        <Group title="Competency" icon="🪪">
          <Kpi n={`${capability?.coverage ?? 0}%`} label="Compliance" tone={pct(capability?.coverage ?? 0)} href="/unit-manager/competency" />
          <Kpi n={learning?.compliance ?? 0} label="Learning %" tone={pct(learning?.compliance ?? 0)} href="/unit-manager/learning" />
          <Kpi n={assessment?.activeCycles ?? 0} label="Active Cycles" />
          <Kpi n={capability?.expiring ?? 0} label="Expiring 60d" tone={capability?.expiring ? "text-amber-600" : undefined} />
          <Kpi n={assessment?.pendingValidations ?? 0} label="Validations" tone={assessment?.pendingValidations ? "text-amber-600" : undefined} href="/unit-manager/assessment" />
          <Kpi n={capability?.gaps ?? 0} label="Dev. Gaps" tone={capability?.gaps ? "text-amber-600" : undefined} />
        </Group>
        <Group title="Quality" icon="🛡️">
          <Kpi n={quality?.openCapa ?? 0} label="Open Improvements" tone={quality?.criticalCapa ? "text-rose-600" : undefined} href="/unit-manager/quality" />
          <Kpi n={quality?.criticalCapa ?? 0} label="High Priority" tone={quality?.criticalCapa ? "text-rose-600" : undefined} />
          <Kpi n={quality?.avgCompliance != null ? `${quality.avgCompliance}%` : "—"} label="Audit Compliance" tone={quality?.avgCompliance != null ? pct(quality.avgCompliance) : undefined} />
          <Kpi n={quality?.audits ?? 0} label="Audits" />
          <Kpi n={escalations.length} label="Escalations" tone={highEsc ? "text-rose-600" : undefined} />
          <Kpi n="—" label="Safety Score" sub="derived soon" />
        </Group>
      </div>

      {/* Panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">Workforce Readiness</h3>
          {(!capability || capability.total === 0) ? <p className="text-sm text-gray-400">No competency decisions recorded yet.</p> : (
            <Bar segments={[{ n: capability.competent, color: "#22c55e", label: "Current" }, { n: capability.gaps, color: "#f59e0b", label: "Developing" }, { n: capability.expired, color: "#ef4444", label: "Expired" }]} />
          )}
          <p className="text-[11px] text-gray-400 mt-3">{capability?.coverage ?? 0}% of {capability?.total ?? 0} competency records current. <Link href="/unit-manager/competency" className="text-teal-600 hover:underline">Manage →</Link></p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3 text-sm">Current Shift Summary</h3>
          <div className="grid grid-cols-3 gap-2 text-center">
            {[["Patients", patients.length], ["On Duty", onDuty.length], ["Admissions", admissionsToday], ["Discharges", dischargePending], ["Escalations", escalations.length], ["Supervisor", activeShift?.profiles?.full_name ? "✓" : "—"]].map(([l, v]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-2"><p className="text-lg font-bold text-gray-900 tabular-nums">{v}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-3"><Link href="/unit-manager/shift-intelligence" className="text-teal-600 hover:underline">Shift Intelligence →</Link></p>
        </div>

        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-1 text-sm">AI Unit Intelligence</h3>
          <div className="space-y-1.5 mt-2">
            {[capability?.expiring ? { t: `${capability.expiring} competencies expiring within 60 days`, tone: "amber" } : null,
              highEsc ? { t: "High-level escalation open — review immediately", tone: "red" } : null,
              occPct >= 90 ? { t: `High occupancy (${occPct}%) — bed availability risk`, tone: "amber" } : null,
              (quality?.criticalCapa ?? 0) > 0 ? { t: `${quality.criticalCapa} high-priority improvement action(s) open`, tone: "amber" } : null,
            ].filter(Boolean).slice(0, 4).map((x: any, i: number) => (
              <div key={i} className="flex items-start gap-2"><span className={`mt-1 w-1.5 h-1.5 rounded-full ${x.tone === "red" ? "bg-rose-500" : "bg-amber-500"}`} /><p className="text-xs text-gray-600">{x.t}</p></div>
            ))}
            {![capability?.expiring, highEsc, occPct >= 90, quality?.criticalCapa].some(Boolean) && <p className="text-sm text-gray-400">No priority risks flagged.</p>}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Rule-based over live unit signals; ML recommendations arrive with the AI &amp; Intelligence section.</p>
        </div>
      </div>

      {/* Honest-state strip */}
      <div className={`${card} border-dashed`}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[["Budget & Resources", "Finance integration"], ["Improvement Projects", "Uses quality CAPA; project targets need a store"], ["Performance Trends (30d)", "Needs daily history capture"]].map(([t, s]) => (
            <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{s} — honest state, arrives in a later UMW phase.</p></div>
          ))}
        </div>
      </div>
    </div>
  );
}
