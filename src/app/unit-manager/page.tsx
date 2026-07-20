import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadUnitManagerDashboard } from "@/lib/operations/unit-manager-data";

export const dynamic = "force-dynamic";

// Unit Manager Dashboard (UMW-001 / UMG-001) — workforce readiness, competency
// compliance, staffing, learning, assessment and quality for the unit.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200 p-5";
const pct = (n: number) => (n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");

function Kpi({ n, label, tone, sub, href }: { n: any; label: string; tone?: string; sub?: string; href?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

function Bar({ segments }: { segments: { n: number; color: string; label: string }[] }) {
  const total = segments.reduce((s, x) => s + x.n, 0) || 1;
  return (
    <>
      <div className="flex h-5 rounded-md overflow-hidden border border-gray-200 mb-2">
        {segments.map((s, i) => s.n ? <div key={i} style={{ width: `${(s.n / total) * 100}%`, background: s.color }} title={`${s.label}: ${s.n}`} /> : null)}
      </div>
      <div className="flex flex-wrap gap-3 text-xs text-gray-500">
        {segments.map((s, i) => <span key={i}><span className="inline-block w-2.5 h-2.5 rounded-sm mr-1 align-middle" style={{ background: s.color }} />{s.label}: <b className="text-gray-800">{s.n}</b></span>)}
      </div>
    </>
  );
}

export default async function UnitManagerDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadUnitManagerDashboard(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  if (!d.ready) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Unit Dashboard</h1>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
          <p className="font-semibold text-amber-900">⚙️ Coming online</p>
          <p className="text-sm text-amber-800 mt-2">The Clinical Operations tables aren&apos;t provisioned yet. Competency, learning and quality metrics below still populate from your existing data.</p>
        </div>
      </div>
    );
  }

  const { ops, capability, quality, staffCount, assessment, learning } = d;
  const activeShiftIds = new Set(ops.shifts.filter((s: any) => s.status === "active").map((s: any) => s.id));
  const onDuty = ops.shiftStaff.filter((s: any) => activeShiftIds.has(s.shift_id) && ["on_duty", "confirmed", "assigned"].includes(s.status));
  const census = ops.patients.length;
  const roleMix = onDuty.reduce((m: Record<string, number>, s: any) => ({ ...m, [s.role]: (m[s.role] ?? 0) + 1 }), {});
  const ratio = census && onDuty.length ? (census / onDuty.length).toFixed(1) : "—";
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(6);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Unit Dashboard</h1>
        <p className="text-sm text-gray-500 mt-1">Operational &amp; workforce performance for your unit · {profile?.full_name}</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi n={`${capability.coverage}%`} label="Competency compliance" tone={pct(capability.coverage)} sub={`${capability.competent}/${capability.total} current`} href="/unit-manager/competency" />
        <Kpi n={`${learning.compliance}%`} label="Learning compliance" tone={pct(learning.compliance)} sub={`${learning.completed}/${learning.total} items`} href="/unit-manager/learning" />
        <Kpi n={quality.avgCompliance != null ? `${quality.avgCompliance}%` : "—"} label="Audit compliance" tone={quality.avgCompliance != null ? pct(quality.avgCompliance) : undefined} sub={`${quality.audits} audits`} href="/unit-manager/quality" />
        <Kpi n={staffCount} label="Unit workforce" sub={`${onDuty.length} on duty now`} href="/unit-manager/operations?section=shifts" />
        <Kpi n={capability.expiring} label="Competencies expiring (60d)" tone={capability.expiring ? "text-amber-600" : undefined} href="/unit-manager/competency" />
        <Kpi n={assessment.pendingValidations} label="Validations pending" tone={assessment.pendingValidations ? "text-amber-600" : undefined} href="/unit-manager/assessment" />
        <Kpi n={quality.openCapa} label="Open improvements" tone={quality.criticalCapa ? "text-red-600" : undefined} sub={`${quality.criticalCapa} high priority`} href="/unit-manager/quality" />
        <Kpi n={ops.escalations.length} label="Open escalations" tone={ops.escalations.some((e: any) => e.level >= 4) ? "text-red-600" : undefined} href="/unit-manager/operations?section=safety" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Workforce readiness */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Workforce readiness</h3>
          {capability.total === 0 && <p className="text-sm text-gray-400">No competency decisions recorded yet.</p>}
          {capability.total > 0 && <Bar segments={[
            { n: capability.competent, color: "#22c55e", label: "Current" },
            { n: capability.gaps, color: "#f59e0b", label: "Developing" },
            { n: capability.expired, color: "#ef4444", label: "Expired" },
          ]} />}
          <p className="text-xs text-gray-400 mt-3">{capability.coverage}% of {capability.total} competency records across the unit are current. <Link href="/unit-manager/competency" className="text-teal-600 hover:underline">Manage →</Link></p>
        </div>

        {/* Staffing overview */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Staffing overview</h3>
          {onDuty.length === 0 && <p className="text-sm text-gray-400">No staff deployed on an active shift.</p>}
          {onDuty.length > 0 && (
            <>
              <p className="text-sm text-gray-600 mb-2">{onDuty.length} on duty · <span className="font-medium">{ratio}</span> patients / staff · {census} patients</p>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(roleMix).map(([r, n]) => <span key={r} className="text-xs bg-teal-50 text-teal-700 border border-teal-100 rounded-full px-2.5 py-1">{r.replace(/_/g, " ")}: <b>{n as number}</b></span>)}
              </div>
            </>
          )}
        </div>

        {/* Learning compliance */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Learning compliance</h3>
          {learning.total === 0 && <p className="text-sm text-gray-400">No assigned learning items yet.</p>}
          {learning.total > 0 && <Bar segments={[
            { n: learning.completed, color: "#0d9488", label: "Completed" },
            { n: learning.total - learning.completed, color: "#e5e7eb", label: "Outstanding" },
          ]} />}
          <p className="text-xs text-gray-400 mt-3">{learning.compliance}% of {learning.total} assigned learning items completed.</p>
        </div>

        {/* Assessment status */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Assessment status</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Active cycles</span><b className="tabular-nums">{assessment.activeCycles}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Validations pending</span><b className={`tabular-nums ${assessment.pendingValidations ? "text-amber-600" : ""}`}>{assessment.pendingValidations}</b></div>
          </div>
          <p className="text-xs text-gray-400 mt-3"><Link href="/unit-manager/assessment" className="text-teal-600 hover:underline">Assessment oversight →</Link></p>
        </div>

        {/* Quality & improvement tracker */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quality &amp; improvement</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Avg audit compliance</span><b className={`tabular-nums ${quality.avgCompliance != null ? pct(quality.avgCompliance) : ""}`}>{quality.avgCompliance != null ? `${quality.avgCompliance}%` : "—"}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Audits</span><b className="tabular-nums">{quality.audits}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Open improvements</span><b className="tabular-nums">{quality.openCapa}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">High priority</span><b className={`tabular-nums ${quality.criticalCapa ? "text-red-600" : ""}`}>{quality.criticalCapa}</b></div>
          </div>
        </div>

        {/* Notifications */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Notifications</h3>
          {(notifs ?? []).length === 0 && <p className="text-sm text-gray-400">Nothing new.</p>}
          <div className="space-y-1.5">
            {(notifs ?? []).map((n: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate">{n.title}</span>
                <span className="ml-auto text-xs text-gray-400">{new Date(n.created_at).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Leadership Advisor — later phase */}
      <div className={`${card} border-dashed`}>
        <h3 className="font-semibold text-gray-900 mb-1">AI Leadership Advisor</h3>
        <p className="text-sm text-gray-400">Leadership AI (workforce-planning, capability-gap and quality recommendations) arrives in a later UMW phase. The metrics it will reason over — competency compliance, learning, staffing, quality — are already live above.</p>
      </div>
    </div>
  );
}
