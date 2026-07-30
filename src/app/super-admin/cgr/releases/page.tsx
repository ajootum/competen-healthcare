import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceReleases } from "@/lib/cgr/releases";

// CGR-018 — Competency Governance Deployment, Release & Migration Management. The release pipeline (channel +
// status), migration jobs and rollback tracking over the real config release/migration stores. Authoring/
// execution cross-link to Studio Package Manager. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CHANNEL_META: Record<string, string> = {
  dev: "text-gray-500 bg-gray-50 border-gray-200", qa: "text-indigo-700 bg-indigo-50 border-indigo-100",
  uat: "text-blue-700 bg-blue-50 border-blue-100", pilot: "text-amber-700 bg-amber-50 border-amber-100",
  production: "text-emerald-700 bg-emerald-50 border-emerald-100",
};
const STATUS_META: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-200", validated: "text-blue-700 bg-blue-50 border-blue-100",
  approved: "text-blue-700 bg-blue-50 border-blue-100", scheduled: "text-amber-700 bg-amber-50 border-amber-100",
  published: "text-emerald-700 bg-emerald-50 border-emerald-100", activated: "text-emerald-700 bg-emerald-50 border-emerald-100",
  rolled_back: "text-rose-700 bg-rose-50 border-rose-100", failed: "text-rose-700 bg-rose-50 border-rose-100",
};
const LIFECYCLE = ["Approved change", "Release planning", "Migration prep", "Deployment", "Verification", "Adoption", "Closure"];
const cap = (s: string) => (s || "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const fmt = (iso: string) => (iso ? String(iso).slice(0, 10) : "—");

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3.5">
      <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide leading-tight">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export default async function GovernanceReleasesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceReleases(admin) as any;
  const k = d.kpis;
  const chanMax = Math.max(1, ...d.channels.map((c: any) => c.count));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-018 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Deployment, Release &amp; Migration</h1>
          <p className="text-gray-400 text-sm mt-0.5">How approved governance changes move from validation into live operation — controlled release, traceable deployment, minimal disruption and reversible rollback.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/studio/packages" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Package manager →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No governance releases or migration jobs yet. Releases are built in the <Link href="/super-admin/studio/packages" className="text-emerald-600 hover:underline">Package Manager</Link>; once they exist, the deployment pipeline and rollback tracking compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Releases" value={k.releases} sub="governance releases" />
            <Kpi label="Live" value={k.live} sub="activated / published" tone={k.live ? "text-emerald-600" : "text-gray-900"} />
            <Kpi label="Release success" value={k.successRate == null ? "—" : `${k.successRate}%`} sub="of terminal releases" tone={k.successRate == null ? "text-gray-900" : k.successRate >= 90 ? "text-emerald-600" : "text-amber-600"} />
            <Kpi label="Migration jobs" value={k.jobs} sub="export / import / rollback" />
            <Kpi label="Rollbacks" value={k.rolledBack} sub="reversed" tone={k.rolledBack ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Failed" value={k.failed} sub="releases + jobs" tone={k.failed ? "text-rose-600" : "text-gray-900"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Release pipeline by channel */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Pipeline by channel (§5.3)</p>
              {d.channels.length === 0 ? (
                <p className="text-[12px] text-gray-400">No releases yet.</p>
              ) : (
                <div className="space-y-2">
                  {d.channels.map((c: any) => (
                    <div key={c.channel} className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 w-20 text-center shrink-0 ${CHANNEL_META[c.channel] ?? CHANNEL_META.dev}`}>{cap(c.channel)}</span>
                      <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className="h-full bg-emerald-500 rounded" style={{ width: `${(c.count / chanMax) * 100}%` }} /></div>
                      <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{c.count}</span>
                    </div>
                  ))}
                  <p className="text-[10px] text-gray-400 pt-1">Staged rollout: dev → qa → uat → pilot → production.</p>
                </div>
              )}
            </div>

            {/* Migration jobs */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold text-gray-500 uppercase tracking-widest">Migration jobs (§7 / §11)</p>
                <span className="text-[10px] text-gray-400">accuracy {k.migAccuracy == null ? "—" : `${k.migAccuracy}%`}</span>
              </div>
              <div className="grid grid-cols-3 gap-2 mb-3">
                {(["export", "import", "rollback"] as const).map((t) => (
                  <div key={t} className="border border-gray-100 rounded-lg p-2 text-center">
                    <p className={`text-lg font-bold tabular-nums ${t === "rollback" && d.jobByType[t] ? "text-amber-600" : "text-gray-900"}`}>{d.jobByType[t]}</p>
                    <p className="text-[10px] text-gray-500 capitalize">{t}</p>
                  </div>
                ))}
              </div>
              {d.jobList.length > 0 ? (
                <div className="divide-y divide-gray-50 max-h-[160px] overflow-y-auto">
                  {d.jobList.map((j: any, i: number) => (
                    <div key={i} className="flex items-center justify-between gap-2 py-1.5">
                      <span className="text-[11px] text-gray-600 capitalize">{j.type} <span className="text-gray-400">· {j.objects} obj · {j.by}</span></span>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-[9px] text-gray-300 tabular-nums">{fmt(j.at)}</span>
                        <span className={`text-[9px] font-bold border rounded px-1.5 py-0.5 ${STATUS_META[j.status] ?? STATUS_META.draft}`}>{cap(j.status)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <p className="text-[12px] text-gray-400">No migration jobs recorded.</p>}
            </div>
          </div>

          {/* Releases */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100"><p className="text-sm font-bold text-gray-800">Governance releases</p></div>
            {d.relList.length === 0 ? (
              <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No releases defined.</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                    <th className="text-left py-2 pl-4 pr-2">Release</th>
                    <th className="text-left py-2 px-2">Channel</th>
                    <th className="text-left py-2 px-2">Rollout</th>
                    <th className="text-center py-2 px-2">Objects</th>
                    <th className="text-left py-2 px-2">Created</th>
                    <th className="text-left py-2 pr-4 pl-2">Status</th>
                  </tr></thead>
                  <tbody>
                    {d.relList.map((r: any) => (
                      <tr key={r.key} className="border-t border-gray-50">
                        <td className="py-2 pl-4 pr-2"><p className="text-[12px] font-medium text-gray-800">{r.name}</p><p className="text-[10px] text-gray-400 font-mono">{r.key}</p></td>
                        <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${CHANNEL_META[r.channel] ?? CHANNEL_META.dev}`}>{cap(r.channel)}</span></td>
                        <td className="py-2 px-2 text-[11px] text-gray-500 capitalize">{r.rollout}</td>
                        <td className="py-2 px-2 text-center text-[12px] text-gray-600 tabular-nums">{r.objects}</td>
                        <td className="py-2 px-2 text-[10px] text-gray-400 tabular-nums">{fmt(r.at)}</td>
                        <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${STATUS_META[r.status] ?? STATUS_META.draft}`}>{cap(r.status)}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Deployment lifecycle reference */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Deployment lifecycle <span className="font-normal normal-case text-gray-300">(§6)</span></p>
            <div className="flex items-center flex-wrap gap-1">
              {LIFECYCLE.map((s, i) => (
                <div key={s} className="flex items-center">
                  <span className="text-[11px] font-medium text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">{s}</span>
                  {i < LIFECYCLE.length - 1 && <span className="text-gray-300 mx-0.5">→</span>}
                </div>
              ))}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is real — the release pipeline, channels and rollout strategies from the configuration release store, and export/import/rollback jobs with their status from the migration store. Building releases, executing migrations and rollback live in the <Link href="/super-admin/studio/packages" className="text-emerald-600 hover:underline">Package Manager</Link>; approved changes flow in from <Link href="/super-admin/cgr/change-control" className="text-emerald-600 hover:underline">Change Control</Link> after passing <Link href="/super-admin/cgr/testing" className="text-emerald-600 hover:underline">validation</Link>. Backward compatibility (§8) preserves previous competency records, assessments and governance decisions. Per the CGR mandate, AI may predict deployment risk but never deploys independently.</p>
        </div>
      )}
    </div>
  );
}
