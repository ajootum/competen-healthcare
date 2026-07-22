import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadComplianceManagement } from "@/lib/super-admin/gov-compliance";
import ComplianceCenter from "./ComplianceCenter";

export const dynamic = "force-dynamic";

// Compliance Management (GOV-001.3) — the obligations register (gov_obligations,
// migration 059) with real in-place actions, an honestly-DERIVED multi-domain
// compliance view from existing signals, the compliance calendar and the
// evidence picture. Fail-soft: an honest banner until the migration runs.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const STATUS_BADGE: Record<string, string> = { compliant: "bg-green-50 text-green-700", at_risk: "bg-amber-50 text-amber-700", non_compliant: "bg-rose-50 text-rose-700", not_assessed: "bg-gray-100 text-gray-500", waived: "bg-violet-50 text-violet-700" };
const RISK_BADGE: Record<string, string> = { low: "bg-gray-100 text-gray-600", medium: "bg-amber-50 text-amber-700", high: "bg-orange-50 text-orange-700", critical: "bg-rose-50 text-rose-700" };

export default async function ComplianceManagement() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadComplianceManagement(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Total Obligations", value: dash(k.total), icon: "📋", iconBg: "bg-blue-50" },
    { label: "Compliant", value: dash(k.compliant), icon: "✅", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "At Risk", value: dash(k.atRisk), icon: "⚠️", iconBg: "bg-amber-50", tone: (k.atRisk ?? 0) > 0 ? "text-amber-600" : undefined },
    { label: "Non-Compliant", value: dash(k.nonCompliant), icon: "🛑", iconBg: "bg-rose-50", tone: (k.nonCompliant ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Not Assessed", value: dash(k.notAssessed), icon: "❔", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "Expiring (30d)", value: dash(k.expiringSoon), icon: "🕓", iconBg: "bg-orange-50", tone: (k.expiringSoon ?? 0) > 0 ? "text-orange-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/governance" className="hover:text-teal-700">Governance &amp; Compliance</Link><span>/</span><span className="text-gray-600">Compliance Management</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Compliance Management</h1>
        <p className="text-sm text-gray-500">Track compliance obligations, evidence and status across all domains.</p>
      </div>

      {!d.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Obligations register not enabled.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/migrations/059-governance-obligations.sql</code> to activate it. The derived domain compliance below is live regardless.
        </div>
      )}

      {/* KPI ribbon */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-place register actions */}
      <ComplianceCenter frameworks={d.pickers.frameworks} obligations={d.pickers.obligations} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Obligations register */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Obligations Register</h2>
            <span className="text-[10px] text-gray-400">{dash(d.waived)} waived · {dash(d.expired)} expired</span>
          </div>
          {d.register.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{d.ready ? "No obligations registered yet — add the first one above." : "Activates with migration 059."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Obligation</th><th className="px-3 py-2 font-semibold">Authority</th><th className="px-3 py-2 font-semibold">Domain</th><th className="px-3 py-2 font-semibold">Scope</th><th className="px-3 py-2 font-semibold text-right">Expiry</th><th className="px-3 py-2 font-semibold text-right">Risk</th><th className="px-3 py-2 font-semibold text-right">Status</th>
                </tr></thead>
                <tbody>
                  {d.register.map((o: any) => (
                    <tr key={o.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{o.title}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{o.authority ?? "—"}</td>
                      <td className="px-3 py-2 text-gray-500 capitalize text-[12px]">{String(o.domain).replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{o.scope}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-gray-500">{o.expiry ?? "—"}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${RISK_BADGE[o.risk] ?? "bg-gray-100 text-gray-600"}`}>{o.risk}</span></td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_BADGE[o.status] ?? "bg-gray-100 text-gray-600"}`}>{String(o.status).replace(/_/g, " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Compliance calendar */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Compliance Calendar</h2>
          {d.calendar.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No dated obligations or policy reviews.</p> : (
            <div className="space-y-2">
              {d.calendar.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${c.overdue ? "bg-rose-50 text-rose-700" : c.dueSoon ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{c.date}</span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-700 truncate">{c.title}</p><p className="text-[9px] text-gray-400 capitalize">{c.kind}</p></div>
                  {c.overdue && <span className="text-[9px] font-semibold text-rose-600 shrink-0">OVERDUE</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Derived domain compliance */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-1">Compliance by Domain <span className="text-[10px] text-gray-400">derived from live signals</span></h2>
          <p className="text-[11px] text-gray-400 mb-3">Computed directly from operational records — independent of the register.</p>
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {d.derivedDomains.map((dom: any) => (
              <div key={dom.label}>
                <div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{dom.label}</span><span className={`tabular-nums ${dom.value == null ? "text-gray-300" : "text-gray-700"}`}>{dom.value == null ? "n/a" : `${dom.value}%`}</span></div>
                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">{dom.value != null && <div className={`h-full rounded-full ${dom.value >= 80 ? "bg-green-500" : dom.value >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${dom.value}%` }} />}</div>
              </div>
            ))}
          </div>
          {d.byDomain.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">Registered obligations by domain</p>
              <div className="flex flex-wrap gap-1.5">
                {d.byDomain.map((b: any) => <span key={b.domain} className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5 capitalize">{String(b.domain).replace(/_/g, " ")} · {b.n}</span>)}
              </div>
            </div>
          )}
        </div>

        {/* Evidence repository */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Evidence Repository</h2>
          <div className="text-center py-2">
            <p className="text-3xl font-bold text-gray-900 tabular-nums">{dash(d.evidence.total)}</p>
            <p className="text-[10px] text-gray-500">evidence files (clinical store)</p>
          </div>
          <div className="space-y-1 mt-2">
            {Object.entries(d.evidence.kinds).map(([kind, n]: any) => (
              <div key={kind} className="flex items-center justify-between text-xs"><span className="text-gray-500 capitalize">{String(kind).replace(/_/g, " ")}</span><span className="tabular-nums text-gray-400">{n}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3 pt-2 border-t border-gray-50">Today’s evidence store holds clinical files (logbook/credential documents). Attaching evidence directly to obligations and CAPAs — GRC evidence — lands with the evidence-linkage phase.</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Compliance Management keeps the obligations register (real rows, audit-logged status changes, waivers require justification) alongside a derived multi-domain compliance view computed from live operational records — clinical audits, training pathway items, validated competency coverage and policy currency. The calendar merges obligation expiries with policy reviews. Automated reminders and GRC evidence attachments arrive with the notification wiring and evidence-linkage phases.</p>
    </div>
  );
}
