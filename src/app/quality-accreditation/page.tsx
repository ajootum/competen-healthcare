import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadQualityDashboard } from "@/lib/quality-accreditation-data";

export const dynamic = "force-dynamic";

// Quality & Accreditation Dashboard (QAS-001).
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

export default async function QualityDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin", "assessor"].includes(r))) redirect("/dashboard");
  const isSuper = roles.includes("super_admin");
  const hid = profile?.hospital_id ?? null;

  const d = await loadQualityDashboard(admin, hid, isSuper);
  const { audits, findings, capa, improvements, standards, indicators, accreditationReadiness, complianceScore, riskItems } = d;

  // Recent audits for the audit schedule widget.
  let recentAudits: any[] = [];
  try {
    const q = admin.from("audits").select("title, audit_type, status, compliance_pct, conducted_at").order("created_at", { ascending: false }).limit(6);
    const { data } = await (isSuper ? q : q.eq("hospital_id", hid ?? "00000000-0000-0000-0000-000000000000"));
    recentAudits = data ?? [];
  } catch { /* pre-migration */ }
  const { data: notifs } = await admin.from("notifications").select("title, created_at").eq("user_id", user.id).order("created_at", { ascending: false }).limit(5);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Quality &amp; Accreditation</h1>
        <p className="text-sm text-gray-500 mt-1">Clinical quality, accreditation readiness, audit and improvement · {profile?.full_name}</p>
      </div>

      {/* Quality KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi n={complianceScore != null ? `${complianceScore}%` : "—"} label="Compliance score" tone={complianceScore != null ? pct(complianceScore) : undefined} sub="mean audit compliance" href="/quality-accreditation/audits" />
        <Kpi n={accreditationReadiness != null ? `${accreditationReadiness}%` : "—"} label="Accreditation readiness" tone={accreditationReadiness != null ? pct(accreditationReadiness) : undefined} href="/quality-accreditation/standards" />
        <Kpi n={findings.open} label="Open audit findings" tone={findings.critical ? "text-red-600" : findings.open ? "text-amber-600" : undefined} sub={`${findings.critical} critical`} href="/quality-accreditation/audits" />
        <Kpi n={capa.open} label="Open improvement actions" tone={capa.overdue ? "text-red-600" : undefined} sub={`${capa.overdue} overdue`} href="/quality-accreditation/improvements" />
        <Kpi n={audits.total} label="Audits" sub={`${audits.completed} completed · ${audits.planned + audits.inProgress} in progress`} href="/quality-accreditation/audits" />
        <Kpi n={improvements.active} label="Improvement projects" sub={`${improvements.total} total`} href="/quality-accreditation/improvements" />
        <Kpi n={standards} label="Quality standards" sub={`${indicators} indicators`} href="/quality-accreditation/standards" />
        <Kpi n={riskItems} label="Risk items" tone={riskItems ? "text-red-600" : undefined} sub="open high-priority actions" href="/quality-accreditation/risk" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Audit schedule / recent */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Audit activity</h3>
          {recentAudits.length === 0 && <p className="text-sm text-gray-400">No audits recorded yet.</p>}
          <div className="divide-y">
            {recentAudits.map((a: any, i: number) => (
              <div key={i} className="py-2 flex items-center gap-2 text-sm">
                <span className="text-gray-800 truncate">{a.title ?? a.audit_type}</span>
                <span className="text-xs text-gray-400">{(a.audit_type ?? "").replace(/_/g, " ")}</span>
                {a.compliance_pct != null && <span className={`ml-auto text-xs font-medium ${pct(a.compliance_pct)}`}>{a.compliance_pct}%</span>}
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${a.status === "completed" ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"}`}>{a.status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Improvement plan status */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Improvement plan status</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Open actions</span><b className="tabular-nums">{capa.open}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Overdue</span><b className={`tabular-nums ${capa.overdue ? "text-red-600" : ""}`}>{capa.overdue}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">High priority</span><b className={`tabular-nums ${capa.critical ? "text-orange-600" : ""}`}>{capa.critical}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Active projects</span><b className="tabular-nums">{improvements.active}</b></div>
          </div>
          <p className="text-xs text-gray-400 mt-3"><Link href="/quality-accreditation/improvements" className="text-teal-600 hover:underline">Manage improvement plans →</Link></p>
        </div>

        {/* Risk summary */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Risk summary</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex justify-between"><span className="text-gray-500">Critical findings</span><b className={`tabular-nums ${findings.critical ? "text-red-600" : ""}`}>{findings.critical}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">High-priority actions</span><b className={`tabular-nums ${capa.critical ? "text-orange-600" : ""}`}>{capa.critical}</b></div>
            <div className="flex justify-between"><span className="text-gray-500">Overdue actions</span><b className={`tabular-nums ${capa.overdue ? "text-red-600" : ""}`}>{capa.overdue}</b></div>
          </div>
          <p className="text-xs text-gray-400 mt-3">Derived from critical audit findings and corrective actions.</p>
        </div>

        {/* Quick actions */}
        <div className={card}>
          <h3 className="font-semibold text-gray-900 mb-3">Quick actions</h3>
          <div className="grid grid-cols-2 gap-2 text-sm">
            {[["📋 Audit centre", "/quality-accreditation/audits"], ["🛠️ Improvement plans", "/quality-accreditation/improvements"], ["🎯 Standards", "/quality-accreditation/standards"], ["🩹 Run a clinical audit", "/assessor/quality"], ["📈 Accreditation report", "/admin/accreditation"], ["🛡️ Quality workspace", "/admin/quality"]].map(([label, href]) => (
              <Link key={href} href={href} className="border border-gray-200 rounded-lg px-3 py-2 text-gray-700 hover:border-teal-300 hover:text-teal-700 transition-colors">{label}</Link>
            ))}
          </div>
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

        {/* AI Quality Intelligence — later phase */}
        <div className={`${card} border-dashed`}>
          <h3 className="font-semibold text-gray-900 mb-1">AI Quality Intelligence</h3>
          <p className="text-sm text-gray-400">Quality AI (risk prediction, root-cause and accreditation-readiness recommendations) arrives in a later QAS phase. The audit, findings and compliance data it reasons over is already live above.</p>
        </div>
      </div>
    </div>
  );
}
