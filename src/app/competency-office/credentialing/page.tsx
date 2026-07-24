import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadCredentialManagement } from "@/lib/credential-management";
import CredentialTabs from "./CredentialTabs";

export const dynamic = "force-dynamic";

// Credential Management — Credential Dashboard (CMO-003 §5). The enterprise system of record for
// professional credentials over the live professional_credentials store. Real: overall credential
// compliance, valid/expiring/expired/pending/restricted, compliance by credential type, named
// upcoming expiries, the staff register preview, risk alerts, activity and explainable AI insights.
// Honest next-phase: verification-queue workflow, privileges & scope, renewal cases, exceptions and
// issuer integrations — each needs its own store; the register cross-links to /admin/credentials.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const pctTone = (n: number) => (n >= 90 ? "text-emerald-600" : n >= 75 ? "text-amber-600" : "text-rose-600");
const cellTone = (n: number) => (n >= 90 ? "bg-emerald-500" : n >= 80 ? "bg-amber-400" : n >= 70 ? "bg-orange-400" : "bg-rose-500");
const STATUS_TONE: Record<string, string> = { Valid: "bg-emerald-50 text-emerald-700", Expiring: "bg-amber-50 text-amber-700", Expired: "bg-rose-50 text-rose-700", Rejected: "bg-rose-50 text-rose-700", Revoked: "bg-rose-50 text-rose-700", "Pending Verification": "bg-sky-50 text-sky-700", Submitted: "bg-sky-50 text-sky-700", Restricted: "bg-amber-50 text-amber-700", Suspended: "bg-rose-50 text-rose-700", Archived: "bg-gray-100 text-gray-500" };
const todayLabel = () => new Date().toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });

function Kpi({ icon, tint, label, value, sub, tone, href }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string; href: string }) {
  return (
    <Link href={href} className={`${card} p-4 hover:border-teal-300 transition-colors block`}>
      <div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div>
      <div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </Link>
  );
}

export default async function CredentialDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "educator", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadCredentialManagement(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const k = d.kpis;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div><h1 className="text-2xl font-bold text-gray-900">Credential Management</h1><p className="text-sm text-gray-500">The system of record for licences, certifications, privileges and verification — one authoritative credential status.</p></div>
        <Link href="/admin/credentials" className="text-xs bg-teal-600 text-white rounded-lg px-3 py-2 hover:bg-teal-700 transition-colors">+ Add / manage credentials</Link>
      </div>
      <CredentialTabs />
    </>
  );
  if (!d.provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Credential register not provisioned</p><p className="text-sm text-amber-800 mt-1">The professional_credentials store isn&apos;t available for this tenant yet.</p></div></div>;

  return (
    <div className="space-y-4">
      {header}

      {/* KPI cards (§5.2) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi icon="🛡️" tint="bg-emerald-50" label="Credential Compliance" value={`${k.compliance}%`} tone={pctTone(k.compliance)} sub={`${k.valid + k.expiring}/${k.total} valid`} href="/competency-office/credentialing" />
        <Kpi icon="✅" tint="bg-teal-50" label="Valid Credentials" value={k.valid} sub="active & verified" href="/competency-office/credentialing/register" />
        <Kpi icon="📅" tint="bg-amber-50" label="Expiring in 30 Days" value={k.expiring} tone={k.expiring ? "text-amber-600" : "text-gray-400"} sub="start renewal" href="/competency-office/credentialing/renewals" />
        <Kpi icon="⛔" tint="bg-rose-50" label="Expired / Invalid" value={k.expired} tone={k.expired ? "text-rose-600" : "text-gray-400"} sub="deployment impact" href="/competency-office/credentialing/register" />
        <Kpi icon="🔎" tint="bg-sky-50" label="Verification Pending" value={k.pending} tone={k.pending ? "text-sky-600" : "text-gray-400"} sub="awaiting check" href="/competency-office/credentialing/verification" />
        <Kpi icon="🚫" tint="bg-orange-50" label="Restricted / Suspended" value={k.restricted} tone={k.restricted ? "text-rose-600" : "text-gray-400"} sub="deployment limited" href="/competency-office/credentialing/privileges" />
        <Kpi icon="⚖️" tint="bg-violet-50" label="Privileges Due Review" value="—" tone="text-gray-300" sub="privilege store next-phase" href="/competency-office/credentialing/privileges" />
        <Kpi icon="📞" tint="bg-gray-50" label="Verification SLA" value={`${k.verifiedPct}%`} tone={pctTone(k.verifiedPct)} sub="verified (proxy)" href="/competency-office/credentialing/verification" />
      </div>

      {/* Compliance by type + risk alerts + AI */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Compliance by Credential Type</h3>
          {d.complianceByType.length === 0 ? <p className="text-sm text-gray-400">No credentials on record.</p> : (
            <div className="space-y-2">{d.complianceByType.map((t: any) => (
              <div key={t.name} className="text-xs"><div className="flex items-center justify-between mb-0.5"><span className="text-gray-700 truncate">{t.name}</span><span className={`tabular-nums font-semibold ${pctTone(t.pct)}`}>{t.pct}% <span className="text-gray-400 font-normal">({t.ok}/{t.total})</span></span></div><div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${cellTone(t.pct)}`} style={{ width: `${t.pct}%` }} /></div></div>
            ))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">By type (reliable); by-unit heatmap needs active assignment mapping — next-phase.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Credential Risk Alerts</h3>
          {d.risks.length === 0 ? <p className="text-sm text-gray-400">No credential risks. 🎉</p> : (
            <div className="space-y-2">{d.risks.slice(0, 4).map((r: any, i: number) => (
              <div key={i} className={`rounded-lg border p-2.5 ${r.severity === "high" ? "border-rose-100 bg-rose-50/40" : "border-amber-100 bg-amber-50/40"}`}>
                <div className="flex items-start gap-2"><span className="text-sm">{r.severity === "high" ? "⛔" : "⚠️"}</span><div className="min-w-0"><p className="text-xs font-semibold text-gray-800">{r.label}</p><p className="text-[11px] text-gray-500">{r.detail}</p></div></div>
              </div>
            ))}</div>
          )}
        </div>

        <div className={`${card} p-5 bg-gradient-to-br from-teal-50/40 to-white`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3 flex items-center gap-2">✨ AI Credential Insights <span className="text-[10px] font-normal text-gray-400">explainable</span></h3>
          {d.ai.length === 0 ? <p className="text-sm text-gray-400">No priority credential actions.</p> : (
            <div className="space-y-2">{d.ai.slice(0, 4).map((a: any, i: number) => (
              <div key={i} className="rounded-lg border border-gray-100 p-2.5"><div className="flex items-start justify-between gap-2"><p className="text-xs text-gray-800 flex-1">{a.text}</p><span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${a.priority === "high" ? "bg-rose-50 text-rose-700" : a.priority === "medium" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-500"}`}>{a.priority}</span></div><p className="text-[10px] text-gray-400 mt-1">Why: {a.why}</p></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Upcoming expiries + staff register */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Upcoming Expiries</h3><Link href="/competency-office/credentialing/renewals" className="text-[11px] text-teal-600 hover:underline">Renewal queue →</Link></div>
          {d.upcomingExpiries.length === 0 ? <p className="text-sm text-gray-400">Nothing expiring in 90 days.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Staff</th><th className="py-1.5 font-medium">Credential</th><th className="py-1.5 font-medium">Issuer</th><th className="py-1.5 font-medium text-right">Days</th></tr></thead>
              <tbody>{d.upcomingExpiries.map((e: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{e.name}</td><td className="py-1.5 text-gray-600 truncate max-w-[10rem]">{e.credential}</td><td className="py-1.5 text-gray-500 truncate max-w-[8rem]">{e.issuer}</td><td className={`py-1.5 text-right font-medium tabular-nums ${e.days <= 7 ? "text-rose-600" : e.days <= 30 ? "text-amber-600" : "text-gray-500"}`}>{e.days}d</td></tr>))}</tbody>
            </table></div>
          )}
        </div>

        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3"><h3 className="font-semibold text-gray-900 text-sm">Staff Credential Register</h3><Link href="/admin/credentials" className="text-[11px] text-teal-600 hover:underline">Full register →</Link></div>
          {d.register.length === 0 ? <p className="text-sm text-gray-400">No credentials on record.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-xs"><thead><tr className="text-[10px] uppercase tracking-wide text-gray-400 text-left border-b border-gray-100"><th className="py-1.5 font-medium">Staff</th><th className="py-1.5 font-medium">Credential</th><th className="py-1.5 font-medium text-right">Status</th></tr></thead>
              <tbody>{d.register.map((r: any, i: number) => (<tr key={i} className="border-b border-gray-50"><td className="py-1.5 text-gray-700">{r.name}{r.role && <span className="text-gray-400"> · {r.role}</span>}</td><td className="py-1.5 text-gray-600 truncate max-w-[10rem]">{r.credential}</td><td className="py-1.5 text-right"><span className={`text-[9px] px-1.5 py-0.5 rounded ${STATUS_TONE[r.status] ?? "bg-gray-100 text-gray-600"}`}>{r.status}</span></td></tr>))}</tbody>
            </table></div>
          )}
        </div>
      </div>

      {/* Renewal pipeline + issuer + activity (honest where store-less) */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Renewal Pipeline</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🔁</p><p className="text-xs text-gray-500">The staged renewal workflow (not-started → staff action → verification → approval → completed) needs a renewal-case store.</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase (§10). Expiring counts are live above.</p></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-2">Issuer / Regulator Status</h3>
          <div className="border border-dashed border-gray-200 rounded-lg p-5 text-center"><p className="text-2xl mb-1 opacity-40">🔌</p><p className="text-xs text-gray-500">Primary-source verification integrations (council/regulator APIs) with connection health.</p><p className="text-[10px] text-gray-400 mt-1">Honest next-phase (§19). Manual verification is tracked via the register.</p></div>
        </div>
        <div className={`${card} p-5`}>
          <h3 className="font-semibold text-gray-900 text-sm mb-3">Activity Feed</h3>
          {d.activity.length === 0 ? <p className="text-sm text-gray-400">No recent credential activity.</p> : (
            <div className="divide-y divide-gray-50">{d.activity.slice(0, 8).map((a: any) => (
              <div key={a.id} className="flex items-center justify-between gap-2 py-1.5 text-xs"><span className="text-gray-700 truncate">{(a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-400 shrink-0">{a.actor?.full_name ?? "—"}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Credential Management (CMO-003 §5) over professional_credentials. Real: overall credential compliance, valid/expiring/expired/pending/restricted, compliance by type, named upcoming expiries, staff register, risk alerts, activity and rule-based explainable AI insights (recommendation only — AI cannot grant privileges, §23). Honest next-phase: verification-queue workflow, privileges &amp; scope, renewal cases, exceptions/temporary authorisations and issuer integrations — each needs its own store (§14). Credential CRUD + verification are actioned in the <Link href="/admin/credentials" className="text-teal-700 hover:underline">credential register</Link>. Source: credential records; calculated {todayLabel()}; status rules v1.</p>
    </div>
  );
}
