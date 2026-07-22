import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadAccreditationCenter } from "@/lib/super-admin/gov-accreditation";
import AccreditationCenter from "./AccreditationCenter";

export const dynamic = "force-dynamic";

// Regulatory & Accreditation Center (GOV-001.6) — the final module of the
// Governance & Compliance platform. Per-standard readiness from real
// self-assessments (insert-only history, latest wins) against the EQOS
// framework catalogue; the regulatory calendar reads the obligations register;
// indicator attainment compares live measurements to targets. Honest banner
// until migration 061 runs; surveys/inspections have no store yet.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const readinessTone = (n: number | null) => (n == null ? "text-gray-300" : n >= 80 ? "text-green-600" : n >= 50 ? "text-amber-600" : "text-rose-600");
const STD_BADGE: Record<string, string> = { met: "bg-green-50 text-green-700", partially_met: "bg-amber-50 text-amber-700", not_met: "bg-rose-50 text-rose-700", not_assessed: "bg-gray-100 text-gray-500" };
const FW_BADGE: Record<string, string> = { accreditation: "bg-violet-50 text-violet-700", regulatory: "bg-blue-50 text-blue-700", professional: "bg-teal-50 text-teal-700", internal: "bg-gray-100 text-gray-600" };

export default async function RegulatoryAccreditationCenter() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadAccreditationCenter(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Overall Readiness", value: k.overall == null ? "—" : `${k.overall}%`, icon: "🏛️", iconBg: "bg-violet-50", tone: readinessTone(k.overall) },
    { label: "Standards Met", value: dash(k.met), icon: "✅", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Partially Met", value: dash(k.partially), icon: "🌓", iconBg: "bg-amber-50", tone: (k.partially ?? 0) > 0 ? "text-amber-600" : undefined },
    { label: "Not Met", value: dash(k.notMet), icon: "❌", iconBg: "bg-rose-50", tone: (k.notMet ?? 0) > 0 ? "text-rose-600" : undefined },
    { label: "Not Assessed", value: dash(k.notAssessed), icon: "❔", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "Evidence Gaps", value: dash(k.evidenceGaps), icon: "📎", iconBg: "bg-orange-50", tone: (k.evidenceGaps ?? 0) > 0 ? "text-orange-600" : undefined },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/governance" className="hover:text-teal-700">Governance &amp; Compliance</Link><span>/</span><span className="text-gray-600">Regulatory &amp; Accreditation Center</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Regulatory &amp; Accreditation Center</h1>
        <p className="text-sm text-gray-500">Prepare for, maintain and demonstrate compliance with regulatory and accreditation frameworks.</p>
      </div>

      {!d.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Self-assessments not enabled.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/migrations/061-governance-accreditation.sql</code> to activate per-standard readiness. The framework catalogue, calendar and indicators below are live regardless.
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

      {/* Real in-place readiness work */}
      <AccreditationCenter frameworks={d.pickers.frameworks} refsByFramework={d.pickers.refsByFramework} surveys={d.pickers.surveys} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Framework readiness */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Framework Readiness</h2>
          {d.perFramework.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No frameworks configured.</p> : (
            <div className="space-y-3">
              {d.perFramework.map((f: any) => (
                <div key={f.id}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="flex items-center gap-1.5 min-w-0"><span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${FW_BADGE[f.type] ?? "bg-gray-100 text-gray-600"}`}>{f.code}</span><span className="text-gray-600 truncate">{f.name}</span></span>
                    <span className={`tabular-nums shrink-0 ml-2 ${readinessTone(f.readiness)}`}>{f.readiness == null ? "n/a" : `${f.readiness}%`}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">{f.readiness != null && <div className={`h-full rounded-full ${f.readiness >= 80 ? "bg-green-500" : f.readiness >= 50 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${f.readiness}%` }} />}</div>
                  <p className="text-[9px] text-gray-400 mt-0.5 tabular-nums">{f.assessed}/{f.known} standards assessed{f.assessed ? ` · ${f.met} met · ${f.partially} partial · ${f.notMet} not met` : ""}</p>
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-3">Readiness = met 100% · partially 50% · not met 0%, over assessed standards.</p>
        </div>

        {/* Recent assessments */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Self-Assessment Trail</h2>
            <span className="text-[10px] text-gray-400">insert-only history · latest wins</span>
          </div>
          {d.recent.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{d.ready ? "No standards assessed yet — start above." : "Activates with migration 061."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Framework</th><th className="px-3 py-2 font-semibold">Standard</th><th className="px-3 py-2 font-semibold">Gap</th><th className="px-3 py-2 font-semibold text-center">Evidence</th><th className="px-3 py-2 font-semibold text-right">Status</th><th className="px-3 py-2 font-semibold text-right">When</th>
                </tr></thead>
                <tbody>
                  {d.recent.map((a: any, i: number) => (
                    <tr key={i} className="border-b border-gray-50">
                      <td className="px-3 py-2"><span className="text-[10px] font-bold text-gray-600">{a.fw}</span></td>
                      <td className="px-3 py-2 text-gray-800 tabular-nums">{a.ref}{a.title && <span className="text-[10px] text-gray-400 ml-1.5">{a.title}</span>}</td>
                      <td className="px-3 py-2 text-gray-500 text-[11px] truncate max-w-[220px]">{a.gap ?? "—"}</td>
                      <td className="px-3 py-2 text-center">{a.evidence ? "📎" : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STD_BADGE[a.status] ?? "bg-gray-100 text-gray-600"}`}>{String(a.status).replace(/_/g, " ")}</span></td>
                      <td className="px-3 py-2 text-right text-[11px] text-gray-400">{relTime(a.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Regulatory calendar */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Regulatory Calendar</h2>
            <Link href="/super-admin/governance/compliance" className="text-xs text-teal-700 hover:underline">Obligations →</Link>
          </div>
          {d.calendar.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No dated regulatory or licence obligations.</p> : (
            <div className="space-y-2">
              {d.calendar.map((c: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${c.overdue ? "bg-rose-50 text-rose-700" : c.dueSoon ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{c.date}</span>
                  <div className="min-w-0 flex-1"><p className="text-xs text-gray-700 truncate">{c.title}</p><p className="text-[9px] text-gray-400 capitalize">{c.domain}</p></div>
                  {c.overdue && <span className="text-[9px] font-semibold text-rose-600 shrink-0">OVERDUE</span>}
                </div>
              ))}
            </div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Regulatory and licence obligations from the register (module 3).</p>
        </div>

        {/* Indicator attainment */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Indicator Attainment</h2>
          <div className="text-center py-2">
            <p className={`text-3xl font-bold tabular-nums ${d.indicators.measured ? readinessTone(Math.round((d.indicators.attained / d.indicators.measured) * 100)) : "text-gray-300"}`}>
              {d.indicators.measured ? `${Math.round((d.indicators.attained / d.indicators.measured) * 100)}%` : "—"}
            </p>
            <p className="text-[10px] text-gray-500">{d.indicators.attained}/{d.indicators.measured} measured indicators on target</p>
          </div>
          <p className="text-[10px] text-gray-400 mt-2 pt-2 border-t border-gray-50">Latest EQOS indicator measurements vs their targets ({d.indicators.total} active indicators with targets; {d.indicators.total - d.indicators.measured} unmeasured).</p>
        </div>

        {/* Surveys & actions */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Upcoming Surveys</h2>
            <span className="text-[10px] text-gray-400">{d.surveys.completed} completed · {d.surveys.outcomes.passed}✓ {d.surveys.outcomes.conditions}◐ {d.surveys.outcomes.failed}✗</span>
          </div>
          {!d.surveysReady ? (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-2">Run <code className="font-mono text-[11px]">062-governance-surveys.sql</code> to enable survey management.</p>
          ) : d.surveys.upcoming.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No surveys scheduled — plan one above.</p> : (
            <div className="space-y-2 mb-2">
              {d.surveys.upcoming.map((s: any) => (
                <div key={s.id} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-2.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded shrink-0 tabular-nums ${s.dueSoon ? "bg-amber-50 text-amber-700" : "bg-gray-50 text-gray-500"}`}>{s.date ?? "TBD"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-gray-800 leading-tight truncate">{s.title}</p>
                    <p className="text-[9px] text-gray-400 capitalize">{String(s.type).replace(/_/g, " ")}{s.fw ? ` · ${s.fw}` : ""}{s.surveyor ? ` · ${s.surveyor}` : ""}</p>
                  </div>
                  <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 shrink-0 capitalize">{String(s.status).replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
          <Link href="/super-admin/governance/audit" className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 hover:border-teal-300 transition-colors">
            <div><p className="text-xs font-medium text-gray-800">Open accreditation actions</p><p className="text-[9px] text-gray-400">tracked in the CAPA workflow (module 5)</p></div>
            <span className="text-base font-bold text-gray-900 tabular-nums">{dash(d.openActions)}</span>
          </Link>
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Regulatory &amp; Accreditation Center completes the Governance &amp; Compliance platform. Readiness is computed from real per-standard self-assessments (insert-only history against the EQOS JCI/SafeCare/MOH/internal catalogue — gap notes required when standards aren’t fully met), the regulatory calendar reads the obligations register, indicator attainment compares live measurements to targets, and action plans flow through the CAPA workflow. Survey &amp; inspection management is live (schedule → prepare → conduct → outcome, migration 062); a structured evidence room remains the module’s honest gap.</p>
    </div>
  );
}
