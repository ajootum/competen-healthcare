import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadChangeControl } from "@/lib/cgr/change-control";
import { Kpi } from "../_kit";

// CGR-004 — Competency Change Control & Lifecycle Management. Change log + impact assessment + version/lifecycle
// over the real stores. Change authoring cross-links to the review board / lifecycle management. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_META: Record<string, string> = {
  major: "text-rose-700 bg-rose-50 border-rose-100",
  minor: "text-amber-700 bg-amber-50 border-amber-100",
  revision: "text-blue-700 bg-blue-50 border-blue-100",
};
const CR_STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "text-amber-700 bg-amber-50 border-amber-100" },
  approved: { label: "Approved", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  implemented: { label: "Implemented", cls: "text-emerald-700 bg-emerald-50 border-emerald-100" },
  rejected: { label: "Rejected", cls: "text-rose-700 bg-rose-50 border-rose-100" },
};
const PUB_META: Record<string, { label: string; dot: string }> = {
  draft: { label: "Draft", dot: "bg-gray-300" },
  in_review: { label: "In review", dot: "bg-amber-400" },
  approved: { label: "Approved", dot: "bg-emerald-400" },
  published: { label: "Published", dot: "bg-emerald-600" },
  archived: { label: "Archived", dot: "bg-gray-400" },
};

export default async function ChangeControlPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadChangeControl(admin) as any;
  const k = d.kpis;
  const lifeMax = Math.max(1, ...d.lifecycle.map((l: any) => l.count));
  const impactMax = Math.max(1, ...d.impacts.map((i: any) => i.blastRadius));

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-004 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Change Control &amp; Lifecycle</h1>
          <p className="text-gray-400 text-sm mt-0.5">What changed, why, who is affected, and how it&apos;s safely implemented — controlled change with impact assessment and version integrity.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/competency-office/lifecycle-state" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Lifecycle →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">No change requests or frameworks yet — change control, impact and version history compute once competencies exist and changes are raised.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Change requests" value={k.totalChanges} sub="controlled changes" />
            <Kpi label="Open" value={k.open} sub="in flight" tone={k.open ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Through workflow" value={k.throughWorkflowPct == null ? "—" : `${k.throughWorkflowPct}%`} sub="approved/implemented" tone={k.throughWorkflowPct != null && k.throughWorkflowPct >= 60 ? "text-emerald-600" : "text-gray-900"} />
            <Kpi label="Impact-assessed" value={k.withImpactPct == null ? "—" : `${k.withImpactPct}%`} sub="have an impact record" />
            <Kpi label="Frameworks versioned" value={`${k.versioned}/${k.frameworks}`} sub="semantic version set" />
            <Kpi label="Overdue reviews" value={k.overdueReviews} sub="past review date" tone={k.overdueReviews ? "text-rose-600" : "text-gray-900"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Change log */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Change Log</p>
                <p className="text-[10px] text-gray-400">controlled-change register · recent</p>
              </div>
              {d.changeLog.length === 0 ? (
                <div className="p-6 text-center"><p className="text-sm text-gray-400">No change requests raised yet. <Link href="/competency-office/review-board" className="text-emerald-600 hover:underline">Raise a change →</Link></p></div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                      <th className="text-left py-2 pl-4 pr-2">Change</th>
                      <th className="text-left py-2 px-2">Kind</th>
                      <th className="text-left py-2 px-2">Impact</th>
                      <th className="text-left py-2 px-2">Effective</th>
                      <th className="text-left py-2 pr-4 pl-2">Status</th>
                    </tr></thead>
                    <tbody>
                      {d.changeLog.map((c: any) => (
                        <tr key={c.id} className="border-t border-gray-50">
                          <td className="py-2 pl-4 pr-2">
                            <p className="text-[12px] font-medium text-gray-800 leading-tight">{c.name}</p>
                            <p className="text-[10px] text-gray-400 line-clamp-1">{c.entityType}{c.rationale ? ` · ${c.rationale}` : ""}</p>
                          </td>
                          <td className="py-2 px-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 capitalize ${KIND_META[c.kind] ?? KIND_META.revision}`}>{c.kind}</span></td>
                          <td className="py-2 px-2">{c.hasImpact ? <span className="text-[10px] text-emerald-600 font-semibold">assessed</span> : <span className="text-[10px] text-gray-300">—</span>}</td>
                          <td className="py-2 px-2 text-[11px] text-gray-500 tabular-nums">{c.effectiveDate ?? "—"}</td>
                          <td className="py-2 pr-4 pl-2"><span className={`text-[10px] font-bold border rounded px-1.5 py-0.5 ${(CR_STATUS_META[c.status] ?? CR_STATUS_META.open).cls}`}>{(CR_STATUS_META[c.status] ?? CR_STATUS_META.open).label}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Status + kind breakdown */}
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Change breakdown</p>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">By status</p>
              <div className="space-y-1 mb-3">
                {[["open", "bg-amber-400"], ["approved", "bg-emerald-500"], ["implemented", "bg-emerald-600"], ["rejected", "bg-rose-500"]].map(([s, tone]) => (
                  <div key={s} className="flex items-center gap-2">
                    <span className="text-[11px] text-gray-500 w-24 shrink-0 capitalize">{s}</span>
                    <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${tone} rounded`} style={{ width: `${(d.byStatus[s as string] / Math.max(1, k.totalChanges)) * 100}%` }} /></div>
                    <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{d.byStatus[s as string]}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase mb-1.5">By kind</p>
              <div className="flex gap-2">
                {["major", "minor", "revision"].map((kd) => (
                  <div key={kd} className="flex-1 border border-gray-100 rounded-lg p-2 text-center">
                    <p className="text-lg font-bold text-gray-800 tabular-nums">{d.byKind[kd]}</p>
                    <p className="text-[10px] text-gray-400 capitalize">{kd}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Impact assessment */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-bold text-gray-800">Impact Assessment — change blast radius</p>
              <p className="text-[10px] text-gray-400">frameworks with open changes first · <Link href="/super-admin/studio/dependencies" className="text-emerald-600 hover:underline">dependency graph →</Link></p>
            </div>
            {d.impacts.length === 0 ? (
              <div className="p-6 text-center"><p className="text-sm text-gray-400">No frameworks to assess yet.</p></div>
            ) : (
              <div className="p-3 space-y-2">
                {d.impacts.map((im: any) => (
                  <div key={im.id} className="border border-gray-50 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-[13px] font-semibold text-gray-800 truncate">{im.name}</p>
                        {im.hasOpenChange && <span className="text-[9px] font-bold text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5 shrink-0">open change</span>}
                      </div>
                      <span className="text-[11px] text-gray-400 shrink-0"><span className="font-bold text-gray-700 tabular-nums">{im.blastRadius}</span> objects affected{im.edges > 0 && ` · ${im.edges} edges`}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${(im.blastRadius / impactMax) * 100}%` }} /></div>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {im.affected.map((a: any) => <span key={a.label} className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{a.label} <span className="font-semibold text-gray-700">{a.count}</span></span>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Version & lifecycle */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Framework lifecycle</p>
              <div className="space-y-1.5">
                {d.lifecycle.map((l: any) => (
                  <div key={l.status} className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${(PUB_META[l.status] ?? PUB_META.draft).dot}`} />
                    <span className="text-[11px] text-gray-500 w-20 shrink-0">{(PUB_META[l.status] ?? PUB_META.draft).label}</span>
                    <div className="flex-1 h-2.5 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${(PUB_META[l.status] ?? PUB_META.draft).dot} rounded`} style={{ width: `${(l.count / lifeMax) * 100}%` }} /></div>
                    <span className="text-[11px] font-bold text-gray-600 tabular-nums w-6 text-right">{l.count}</span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-gray-400 mt-2.5">{k.retired} archived (retired). Per-worker competency lifecycle → <Link href="/competency-office/lifecycle-state" className="text-emerald-600 hover:underline">state machine</Link>.</p>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-800">Version Integrity</p>
                <p className="text-[10px] text-gray-400">overdue reviews first</p>
              </div>
              {d.versions.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No frameworks to version.</p></div>
              ) : (
                <div className="max-h-[260px] overflow-y-auto">
                  <table className="w-full">
                    <tbody>
                      {d.versions.map((v: any) => (
                        <tr key={v.id} className="border-t border-gray-50 first:border-t-0">
                          <td className="py-2 pl-4 pr-2 text-[12px] font-medium text-gray-800">{v.name}</td>
                          <td className="py-2 px-2"><span className="text-[11px] font-mono text-gray-500">v{v.version}</span></td>
                          <td className="py-2 px-2"><span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className={`w-1.5 h-1.5 rounded-full ${(PUB_META[v.pubStatus] ?? PUB_META.draft).dot}`} />{(PUB_META[v.pubStatus] ?? PUB_META.draft).label}</span></td>
                          <td className="py-2 pr-4 pl-2 text-right text-[10px] tabular-nums">{v.reviewDate ? <span className={v.reviewOverdue ? "text-rose-600 font-semibold" : "text-gray-400"}>{v.reviewDate}{v.reviewOverdue && " ⚠"}</span> : <span className="text-gray-300">no review</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is live: the change log is the controlled-change register (change_requests), impact is computed by walking the real governed hierarchy + dependency graph, and version integrity comes from the framework semantic versions + lifecycle status. This is the change-control <span className="font-medium">workspace</span> — raising and approving changes happens in <Link href="/competency-office/review-board" className="text-emerald-600 hover:underline">the review board</Link> and <Link href="/competency-office/lifecycle-state" className="text-emerald-600 hover:underline">lifecycle management</Link>, where controlled change, version integrity and safe transition are enforced. Per the CGR mandate, AI may summarise impacts but never retires competencies or approves changes.</p>
        </div>
      )}
    </div>
  );
}
