import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDataProtection } from "@/lib/super-admin/sys-data";
import RecoveryConsole from "./RecoveryConsole";
import { requireHqCapability } from "@/lib/hq/context";
import { RPO_TARGET_MINUTES, RTO_TARGET_MINUTES, formatObjective } from "@/lib/super-admin/recovery-objectives";

export const dynamic = "force-dynamic";

// Data Protection & Recovery (SYS-001.5) — resilience posture and the documented
// recovery-event trail (DR tests, restores, backup verifications, privacy
// requests; migration 063) with RPO/RTO. Backups are Supabase-managed and
// encryption/keys are provider-managed — surfaced as honest facts, not
// fabricated metrics (SYS-002 AC-02).
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const dash = (n: number | null | undefined) => (n == null ? "—" : n.toLocaleString());
const relTime = (iso?: string | null) => { if (!iso) return "never"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const readyTone = (n: number | null) => (n == null ? "text-gray-500" : n >= 90 ? "text-[var(--cmp-text-success)]" : n >= 60 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-error)]");
const OUT_TONE: Record<string, string> = { passed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", partial: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", failed: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", pending: "bg-gray-100 text-gray-600" };
const KIND_LABEL: Record<string, string> = { dr_test: "DR test", restore_request: "Restore", backup_verification: "Backup verify", privacy_request: "Privacy", retention_review: "Retention" };

export default async function DataProtectionRecovery() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.platform.system.view");

  const d = await loadDataProtection(admin);
  const k = d.kpis;

  const kpiCards = [
    { label: "Database", value: k.dbHealthy ? "Healthy" : "Degraded", icon: "🗄️", iconBg: k.dbHealthy ? "bg-[var(--cmp-surface-success)]" : "bg-[var(--cmp-surface-error)]", tone: k.dbHealthy ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]" },
    { label: "DR Readiness", value: k.drReadiness == null ? "—" : `${k.drReadiness}%`, icon: "🛟", iconBg: "bg-violet-50", tone: readyTone(k.drReadiness) },
    { label: "DR Tests", value: dash(k.drTests), icon: "🧪", iconBg: "bg-[var(--cmp-surface-information)]" },
    { label: "Restore Requests", value: dash(k.restoreRequests), icon: "♻️", iconBg: "bg-teal-50" },
    { label: "Open Restores", value: dash(k.openRestores), icon: "⏳", iconBg: "bg-[var(--cmp-surface-warning)]", tone: (k.openRestores ?? 0) > 0 ? "text-[var(--cmp-text-warning)]" : undefined },
    { label: "Data Events (30d)", value: dash(k.dataEvents30), icon: "📊", iconBg: "bg-gray-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Link href="/super-admin/system" className="hover:text-teal-700">System &amp; Security</Link><span>/</span><span className="text-gray-600">Data Protection &amp; Recovery</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Data Protection &amp; Recovery</h1>
        <p className="text-sm text-gray-500">Encryption, backups, disaster recovery, retention and privacy — resilience evidence.</p>
      </div>

      {!d.ready && (
        <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Recovery event log not enabled.</span> Run <code className="font-mono text-[12px] bg-[var(--cmp-surface-warning)] px-1 rounded">supabase/migrations/063-system-recovery-events.sql</code> to log DR tests and recovery requests. Database health and the data-protection posture below are live regardless.
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

      {/* Real recovery-event actions */}
      <RecoveryConsole openEvents={d.pickers.openEvents} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recovery event log */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recovery Event Log</h2>
            <span className="text-[10px] text-gray-500">{d.drStats.passed}/{d.drStats.completed} DR tests passed</span>
          </div>
          {d.recent.length === 0 ? <p className="text-sm text-gray-500 py-6 text-center">{d.ready ? "No recovery events logged yet — start above." : "Activates with migration 063."}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-2 font-semibold">Event</th><th className="px-3 py-2 font-semibold">Type</th><th className="px-3 py-2 font-semibold">Scope</th><th className="px-3 py-2 font-semibold text-right">RTO</th><th className="px-3 py-2 font-semibold text-right">Status</th><th className="px-3 py-2 font-semibold text-right">Outcome</th>
                </tr></thead>
                <tbody>
                  {d.recent.map((e: any) => (
                    <tr key={e.id} className="border-b border-gray-50">
                      <td className="px-3 py-2 text-gray-800">{e.title}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{KIND_LABEL[e.kind] ?? e.kind}</td>
                      <td className="px-3 py-2 text-gray-500 text-[12px]">{e.scope ?? "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-[12px] text-gray-500">{e.rto != null ? `${e.rto}m` : "—"}</td>
                      <td className="px-3 py-2 text-right text-[11px] text-gray-500 capitalize">{String(e.status).replace(/_/g, " ")}</td>
                      <td className="px-3 py-2 text-right"><span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${OUT_TONE[e.outcome] ?? "bg-gray-100 text-gray-600"}`}>{e.outcome}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* RPO / RTO */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">RPO / RTO <span className="text-[10px] text-gray-500">latest DR test</span></h2>
          {/* ⚠ THE TARGET FALLS BACK TO THE COMMITTED OBJECTIVE, THE ACTUAL NEVER DOES. A target is
              policy and is known before any test runs (owner decision 2026-08-19); an actual is a
              measurement and is honestly absent until a rehearsal has produced one. Showing an em dash
              in the target slot read as "nobody has decided", which stopped being true. */}
          <div className="grid grid-cols-2 gap-3">
            {[["RPO", d.rpo, RPO_TARGET_MINUTES], ["RTO", d.rto, RTO_TARGET_MINUTES]].map(([l, o, committed]: any) => (
              <div key={l} className="rounded-lg border border-gray-100 p-3 text-center">
                <p className="text-2xl font-bold text-gray-900 tabular-nums">{o.actual != null ? `${o.actual}m` : "—"}</p>
                <p className="text-[10px] text-gray-500">{l} actual</p>
                <p className="text-[9px] text-gray-500 mt-1">
                  target {formatObjective(o.target ?? committed)}
                  {o.target == null && <span className="ml-1 text-gray-500">(committed)</span>}
                </p>
              </div>
            ))}
          </div>
          {d.rpo.actual == null && d.rto.actual == null && (
            // Not a warning styled as an error: it is a true statement about where this product is.
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--cmp-text-warning)]">
              No restore has been rehearsed, so these targets are objectives rather than demonstrated
              capabilities. Until one runs, backup conformance is a claim about the platform provider,
              not about this product&apos;s recoverability.
            </p>
          )}
          <div className="mt-3 pt-2 border-t border-gray-50 space-y-1 text-xs">
            <div className="flex justify-between"><span className="text-gray-500">Last DR test</span><span className="text-gray-700">{relTime(d.drStats.last?.completed_at ?? d.drStats.last?.created_at)}</span></div>
            <div className="flex justify-between"><span className="text-gray-500">Last backup verify</span><span className="text-gray-700">{relTime(d.drStats.lastBackupVerify?.completed_at ?? d.drStats.lastBackupVerify?.created_at)}</span></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Data-protection posture */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Data Protection Posture</h2>
          <div className="space-y-1.5">
            {d.posture.map((p: any) => (
              <div key={p.label} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <span className="text-xs text-gray-700">{p.label}</span>
                <span className={`text-[10px] font-medium text-right ${p.on === true ? "text-[var(--cmp-text-success)]" : p.on === false ? "text-rose-500" : "text-gray-500"}`}>{p.value}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-500 mt-3">Documented facts — encryption and backups are provider-managed; key rotation, secrets vault and retention have no surface yet, shown honestly.</p>
        </div>

        {/* Data access events */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Data Access &amp; Export <span className="text-[10px] text-gray-500">30d</span></h2>
            <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">Audit →</Link>
          </div>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div className="rounded-lg border border-gray-100 p-2.5 text-center"><p className="text-xl font-bold text-gray-900 tabular-nums">{dash(d.dataAccess.events30)}</p><p className="text-[9px] text-gray-500">data events</p></div>
            <div className="rounded-lg border border-gray-100 p-2.5 text-center"><p className={`text-xl font-bold tabular-nums ${d.dataAccess.deletions30 > 0 ? "text-[var(--cmp-text-error)]" : "text-gray-900"}`}>{dash(d.dataAccess.deletions30)}</p><p className="text-[9px] text-gray-500">deletions</p></div>
          </div>
          {d.dataAccess.recent.length > 0 && (
            <div className="space-y-1 pt-2 border-t border-gray-50">
              {d.dataAccess.recent.map((a: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-[11px]"><span className="text-gray-600 truncate">{a.entity || (a.action ?? "").replace(/_/g, " ")}</span><span className="text-gray-500 shrink-0 ml-2">{relTime(a.at)}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Privacy & retention obligations */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Privacy &amp; Retention</h2>
            <Link href="/super-admin/governance/compliance" className="text-xs text-teal-700 hover:underline">Obligations →</Link>
          </div>
          {d.obligations.total === 0 ? <p className="text-sm text-gray-500 py-4 text-center">No data-privacy obligations registered.</p> : (
            <div className="space-y-2">
              {Object.entries(d.obligations.byDomain).map(([domain, n]: any) => (
                <div key={domain} className="flex items-center justify-between text-xs"><span className="text-gray-600 capitalize">{String(domain).replace(/_/g, " ")}</span><span className="tabular-nums text-gray-500">{n}</span></div>
              ))}
              {d.obligations.nonCompliant > 0 && <p className="text-[11px] text-[var(--cmp-text-error)] pt-2 border-t border-gray-50">{d.obligations.nonCompliant} non-compliant / at-risk</p>}
            </div>
          )}
          <p className="text-[10px] text-gray-500 mt-3">Data-privacy, documentation and cybersecurity obligations from the compliance register (Governance module 3).</p>
        </div>
      </div>

      <p className="text-[11px] text-gray-500 pb-4">Data Protection &amp; Recovery keeps the resilience evidence trail — DR exercises, restore and privacy requests, backup verifications with RPO/RTO targets vs actuals — alongside live database health, the data-access/export/deletion audit slice and the data-privacy obligations. Backups and encryption are provider-managed (Supabase/Postgres) and surfaced as honest facts; key rotation, a secrets vault and retention scheduling have no surface yet and are shown as such rather than fabricated (SYS-002 AC-02).</p>
    </div>
  );
}
