import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadIntegrationHealth } from "@/lib/cgr/integration";

// CGR-013 — Competency Governance Interoperability & Integration. The event-driven integration health monitor
// over the real governance event bus (domain_events): processing success, retry/dead-letter backlog, event flow
// by type + platform, and traceability. Config/workspace-links cross-link to CMO. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const STATUS_META: Record<string, { label: string; tone: string }> = {
  processed: { label: "Processed", tone: "bg-emerald-500" },
  pending: { label: "Pending", tone: "bg-amber-400" },
  failed: { label: "Failed", tone: "bg-rose-500" },
  dead_letter: { label: "Dead-letter", tone: "bg-rose-700" },
};
const fmt = (iso: string) => (iso ? iso.slice(0, 16).replace("T", " ") : "—");

// Stated internal-integration architecture (§5) — reference, not computed.
const INTERNAL = [
  { key: "CST", name: "Competency Studio", exchange: "Competency definitions, domains, roles, metadata" },
  { key: "CAP", name: "Asset Platform", exchange: "Learning resources, evidence assets, documents" },
  { key: "CDP", name: "Delivery Platform", exchange: "Approved requirements, completion status" },
  { key: "COMP", name: "Competency Workflow", exchange: "Assessment requirements, status, validation" },
  { key: "CMO", name: "Competency Office", exchange: "Programs, workforce requirements, implementation" },
];

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function IntegrationHealthPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadIntegrationHealth(admin) as any;
  const k = d.kpis;
  const typeMax = Math.max(1, ...d.types.map((x: any) => x.count));
  const platMax = Math.max(1, ...d.platforms.map((x: any) => x.count));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-013 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Interoperability &amp; Integration</h1>
          <p className="text-gray-400 text-sm mt-0.5">How governance information moves between systems with accuracy, security and accountability — the event-driven integration health over the governance event bus.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/integration" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Workspace links →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400 mb-4">No domain events on the bus yet. As governed changes fire (competency approved, regulatory change detected, risk identified → §10), the event-driven integration health builds here. The stated internal integration architecture is below.</p>
          <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 text-left max-w-4xl mx-auto">
            {INTERNAL.map((p) => (
              <div key={p.key} className="border border-gray-100 rounded-lg p-2.5">
                <p className="text-[11px] font-bold text-gray-700">{p.key}</p>
                <p className="text-[10px] text-gray-400 leading-snug">{p.exchange}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Governance events" value={k.total} sub="on the bus" />
            <Kpi label="Processing success" value={k.successRate == null ? "—" : `${k.successRate}%`} sub="of terminal events" tone={k.successRate == null ? "text-gray-900" : k.successRate >= 95 ? "text-emerald-600" : k.successRate >= 80 ? "text-amber-600" : "text-rose-600"} />
            <Kpi label="Last 7 days" value={k.last7} sub="recent throughput" />
            <Kpi label="Pending" value={k.pending} sub="awaiting dispatch" tone={k.pending ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Failed" value={k.failed} sub="need retry" tone={k.failed ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Dead-letter" value={k.deadLetter} sub="exhausted retries" tone={k.deadLetter ? "text-rose-700" : "text-gray-900"} />
          </div>

          {/* Processing health */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Event processing health</p>
              <div className="flex h-4 rounded overflow-hidden bg-gray-100 mb-2.5">
                {(["processed", "pending", "failed", "dead_letter"] as const).map((s) => {
                  const w = k.total ? (d.byStatus[s] / k.total) * 100 : 0;
                  return w > 0 ? <div key={s} className={STATUS_META[s].tone} style={{ width: `${w}%` }} title={`${STATUS_META[s].label}: ${d.byStatus[s]}`} /> : null;
                })}
              </div>
              <div className="flex flex-wrap gap-x-5 gap-y-1">
                {(["processed", "pending", "failed", "dead_letter"] as const).map((s) => (
                  <div key={s} className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${STATUS_META[s].tone}`} />
                    <span className="text-[11px] text-gray-600">{STATUS_META[s].label}</span>
                    <span className="text-[11px] font-bold text-gray-900 tabular-nums">{d.byStatus[s]}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Reliability &amp; traceability</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Retry backlog</span><span className={`text-[13px] font-bold tabular-nums ${k.retryBacklog ? "text-amber-600" : "text-gray-700"}`}>{k.retryBacklog}</span></div>
                <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Trace-ID coverage</span><span className="text-[13px] font-bold text-gray-700 tabular-nums">{k.tracePct}%</span></div>
                <div className="flex items-center justify-between"><span className="text-[11px] text-gray-500">Version (idempotency)</span><span className="text-[13px] font-bold text-gray-700 tabular-nums">{k.versionPct}%</span></div>
                <p className="text-[10px] text-gray-400 pt-1">At-least-once + idempotent-by-(subject, version) — §4.1 data integrity.</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Data flows by platform */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Data flows by platform (§5)</p>
              <div className="space-y-1.5">
                {d.platforms.map((p: any) => (
                  <div key={p.platform} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 w-32 shrink-0 truncate">{p.platform}</span>
                    <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(p.count / platMax) * 100}%` }} /></div>
                    <span className="text-[11px] font-bold text-gray-600 tabular-nums w-8 text-right">{p.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Event flow by type */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Event flow by type (§10)</p>
              <div className="space-y-1.5">
                {d.types.map((t: any) => (
                  <div key={t.type} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-600 flex-1 min-w-0 truncate font-mono">{t.type}</span>
                    <div className="w-24 h-2.5 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-indigo-400 rounded" style={{ width: `${(t.count / typeMax) * 100}%` }} /></div>
                    <span className="text-[11px] font-bold text-gray-600 tabular-nums w-8 text-right">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Failing events */}
          {d.failing.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Events needing attention</p>
                <p className="text-[10px] text-gray-400">failed &amp; dead-letter · <Link href="/super-admin/platform-ops/monitoring" className="text-emerald-600 hover:underline">monitoring →</Link></p>
              </div>
              <div className="divide-y divide-gray-50">
                {d.failing.map((f: any, i: number) => (
                  <div key={i} className="flex items-center justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="text-[12px] text-gray-700 font-mono truncate">{f.type}</p>
                      <p className="text-[10px] text-gray-400">{f.subject}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[10px] text-gray-400 tabular-nums">{f.attempts} attempts</span>
                      <span className={`text-[10px] font-bold rounded px-1.5 py-0.5 ${f.status === "dead_letter" ? "text-rose-700 bg-rose-50 border border-rose-100" : "text-rose-600 bg-rose-50 border border-rose-100"}`}>{STATUS_META[f.status]?.label ?? f.status}</span>
                      <span className="text-[9px] text-gray-300 tabular-nums">{fmt(f.at)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the governance event bus (domain_events) with at-least-once, idempotent delivery. Processing health, retry/dead-letter backlog and traceability come straight from the event log; the platform mapping groups event families onto the internal platforms (CST/CAP/CDP/COMP/CMO). Endpoint configuration and workspace links are owned by the <Link href="/competency-office/integration" className="text-emerald-600 hover:underline">Cross-Workspace Integration</Link> surface, and dispatch monitoring by <Link href="/super-admin/platform-ops/monitoring" className="text-emerald-600 hover:underline">Platform Monitoring</Link>. Per the CGR mandate, AI receives approved governance data only and cannot autonomously approve, override or modify records.</p>
        </div>
      )}
    </div>
  );
}
