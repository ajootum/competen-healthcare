import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernanceApprovals } from "@/lib/cgr/approvals";
import { Kpi } from "../_kit";

// CGR-003 — Competency Approval & Governance Workflow Engine. The governance-scoped approval workspace over the
// real approval stores: pending pipeline, turnaround & SLA, escalation, reviewer workload and a decision-audit
// timeline. Deciding cross-links to the platform approvals console + the Office review board. Super-admin.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const fmtDate = (iso: string) => (iso ? iso.slice(0, 10) : "—");

function Card({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-bold text-gray-800">{title}</p>
        {right}
      </div>
      {children}
    </div>
  );
}

export default async function GovernanceApprovalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles = (profile?.roles?.length ? profile.roles : [profile?.role]) as (string | null)[];
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const d = await loadGovernanceApprovals(admin) as any;
  const k = d.kpis;
  const pipeMax = Math.max(1, d.pipeline.pending, d.pipeline.approved, d.pipeline.rejected);

  return (
    <div className="max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-emerald-600 uppercase tracking-widest mb-0.5">CGR-003 · Competency Governance</p>
          <h1 className="text-xl font-bold text-gray-900">Approval &amp; Governance Workflow</h1>
          <p className="text-gray-400 text-sm mt-0.5">Who has authority to approve, what governance steps are complete, and where approvals are stuck — the controlled pathway from draft to approved deployment.</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href="/super-admin/platform-ops/approvals" className="text-xs font-semibold text-emerald-700 hover:text-emerald-800 border border-emerald-200 bg-emerald-50 rounded-lg px-3 py-2">Decide in console →</Link>
          <Link href="/super-admin/cgr" className="text-xs font-semibold text-gray-500 hover:text-emerald-700 border border-gray-200 rounded-lg px-3 py-2">← CGR</Link>
        </div>
      </div>

      {!d.provisioned ? (
        <div className="bg-white border border-gray-200 rounded-xl p-8 text-center"><p className="text-sm text-gray-400">The approval engine has no governance requests yet. Once frameworks/competencies are submitted for review — via <Link href="/competency-office/review-board" className="text-emerald-600 hover:underline">the review board</Link> or the platform console — the pipeline, turnaround and decision audit compute here.</p></div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Pending" value={k.pending} sub="awaiting decision" tone={k.pending ? "text-amber-600" : "text-gray-900"} />
            <Kpi label="Avg turnaround" value={k.avgTurnaround == null ? "—" : `${k.avgTurnaround}d`} sub="submit → decided" />
            <Kpi label="Within SLA" value={k.slaPct == null ? "—" : `${k.slaPct}%`} sub={`${k.sla}-day target`} tone={k.slaPct == null ? "text-gray-900" : k.slaPct >= 80 ? "text-emerald-600" : "text-amber-600"} />
            <Kpi label="Overdue" value={k.overdue} sub={`pending > ${k.sla}d`} tone={k.overdue ? "text-rose-600" : "text-gray-900"} />
            <Kpi label="Approved" value={k.approved} sub="governance-scoped" tone="text-emerald-600" />
            <Kpi label="Rejected" value={k.rejected} sub="did not meet reqs" tone={k.rejected ? "text-rose-600" : "text-gray-900"} />
          </div>

          {/* Pipeline funnel */}
          <div className="bg-white rounded-xl border border-gray-100 p-4">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Approval pipeline</p>
            <div className="space-y-2">
              {[
                { label: "Pending review", value: d.pipeline.pending, tone: "bg-amber-400" },
                { label: "Approved", value: d.pipeline.approved, tone: "bg-emerald-500" },
                { label: "Rejected", value: d.pipeline.rejected, tone: "bg-rose-500" },
              ].map((s) => (
                <div key={s.label} className="flex items-center gap-3">
                  <span className="text-[11px] text-gray-500 w-28 shrink-0">{s.label}</span>
                  <div className="flex-1 h-4 rounded bg-gray-50 overflow-hidden"><div className={`h-full ${s.tone} rounded`} style={{ width: `${(s.value / pipeMax) * 100}%` }} /></div>
                  <span className="text-[12px] font-bold text-gray-700 tabular-nums w-8 text-right">{s.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* Approval workspace — pending queue */}
            <div className="lg:col-span-2">
              <Card title="Approval Workspace" right={<span className="text-[10px] text-gray-400">oldest first · {d.queueTotal} pending</span>}>
                {d.queue.length === 0 ? (
                  <div className="p-6 text-center"><p className="text-sm text-emerald-600 font-medium">No governance approvals pending — the queue is clear.</p></div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[620px]">
                      <thead><tr className="text-[9px] font-bold text-gray-400 uppercase tracking-wide">
                        <th className="text-left py-2 pl-4 pr-2">Item</th>
                        <th className="text-left py-2 px-2">Workflow</th>
                        <th className="text-left py-2 px-2">Requested by</th>
                        <th className="text-left py-2 px-2">Stage</th>
                        <th className="text-right py-2 pr-4 pl-2">Age</th>
                      </tr></thead>
                      <tbody>
                        {d.queue.map((q: any) => (
                          <tr key={`${q.source}-${q.id}`} className="border-t border-gray-50">
                            <td className="py-2 pl-4 pr-2">
                              <p className="text-[12px] font-medium text-gray-800 leading-tight">{q.entityName}</p>
                              <p className="text-[10px] text-gray-400">{q.entityType}</p>
                            </td>
                            <td className="py-2 px-2 text-[11px] text-gray-600"><span className="mr-1">{q.icon}</span>{q.workflow}</td>
                            <td className="py-2 px-2 text-[11px] text-gray-500">{q.requestedBy}</td>
                            <td className="py-2 px-2"><span className="text-[10px] text-gray-500 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{q.step}</span></td>
                            <td className="py-2 pr-4 pl-2 text-right"><span className={`text-[11px] font-semibold tabular-nums ${q.ageDays > k.sla ? "text-rose-600" : "text-gray-500"}`}>{q.ageDays}d{q.ageDays > k.sla && " ⚠"}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {/* Reviewer workload */}
            <Card title="Reviewer Workload" right={<span className="text-[10px] text-gray-400">{k.decisions} decisions</span>}>
              {d.reviewers.length === 0 ? (
                <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No recorded decisions yet.</p></div>
              ) : (
                <div className="p-3 space-y-1.5">
                  {d.reviewers.map((r: any) => (
                    <div key={r.name} className="flex items-center justify-between gap-2 border border-gray-50 rounded-lg px-2.5 py-1.5">
                      <span className="text-[12px] text-gray-700 truncate">{r.name}</span>
                      <span className="text-[10px] text-gray-400 shrink-0"><span className="text-emerald-600 font-semibold">{r.approved}</span> ✓ · <span className="text-rose-600 font-semibold">{r.rejected}</span> ✕ · {r.total}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Governance timeline */}
          <Card title="Governance Timeline" right={<span className="text-[10px] text-gray-400">recent decision audit</span>}>
            {d.timeline.length === 0 ? (
              <div className="p-6 text-center"><p className="text-[12px] text-gray-400">No decisions recorded yet — the per-step audit will appear here as reviewers act.</p></div>
            ) : (
              <div className="p-3 space-y-1">
                {d.timeline.map((t: any, i: number) => (
                  <div key={i} className="flex items-start gap-2.5 px-2 py-1.5">
                    <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${t.decision === "approved" ? "bg-emerald-500" : "bg-rose-500"}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-gray-700 leading-tight">
                        <span className={`font-semibold ${t.decision === "approved" ? "text-emerald-700" : "text-rose-700"}`}>{t.decision}</span>
                        {" "}<span className="text-gray-500">step {t.step} ·</span> <span className="font-medium">{t.entityName}</span> <span className="text-gray-400">({t.workflow})</span>
                      </p>
                      {t.note && <p className="text-[10px] text-gray-400 leading-snug">&ldquo;{t.note}&rdquo;</p>}
                    </div>
                    <div className="text-right shrink-0"><p className="text-[10px] text-gray-500">{t.actor}</p><p className="text-[9px] text-gray-300">{fmtDate(t.at)}</p></div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Governance workflows */}
          {d.byWorkflow.length > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 p-4">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-3">Governance workflows</p>
              <div className="flex flex-wrap gap-2">
                {d.byWorkflow.map((w: any) => (
                  <div key={w.key} className="flex items-center gap-2 border border-gray-100 rounded-lg px-3 py-1.5">
                    <span>{w.icon}</span>
                    <div><p className="text-[12px] font-semibold text-gray-700 leading-none">{w.name}</p><p className="text-[10px] text-gray-400 mt-0.5">{w.steps} step{w.steps === 1 ? "" : "s"}{w.pending > 0 && <span className="text-amber-600 font-semibold"> · {w.pending} pending</span>}</p></div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[11px] text-gray-400 leading-relaxed">Every figure is live: the pipeline and turnaround come from the approval-request store, the reviewer workload and timeline from the per-step decision audit, and content changes from change control. This is the governance <span className="font-medium">workspace</span> — deciding happens in <Link href="/super-admin/platform-ops/approvals" className="text-emerald-600 hover:underline">the approvals console</Link> and <Link href="/competency-office/review-board" className="text-emerald-600 hover:underline">the Office review board</Link>, where separation of creation and approval, appropriate authority and full audit are enforced. Per the CGR mandate, AI may recommend reviewers or summarise evidence but never approves.</p>
        </div>
      )}
    </div>
  );
}
