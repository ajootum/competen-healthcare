import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadApprovals } from "@/lib/operations/approvals";
import { loadUnitDepartments } from "@/lib/operations/unit-command";
import UnitFilters from "../UnitFilters";
import ApprovalActions, { NewApprovalButton } from "./ApprovalActions";

export const dynamic = "force-dynamic";

// Approvals Workspace (UMW-EA-001) — the Unit Manager's decision-governance centre:
// unified approval inbox, AI-assisted recommendations, operational context and a
// complete audit trail. Reads the real approval_requests store; empty-safe (honest
// empty states until requests are submitted — nothing fabricated). Decisions run
// through the audited approvals API. Analytics/SLA/Calendar deep tabs are next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const PRI: Record<string, string> = { critical: "bg-rose-50 text-rose-700", high: "bg-amber-50 text-amber-700", medium: "bg-blue-50 text-blue-700", low: "bg-gray-100 text-gray-500" };
const IMPACT: Record<string, string> = { high: "text-rose-600", medium: "text-amber-600", low: "text-gray-500" };
const REC_TONE: Record<string, string> = { approve: "text-green-600", review: "text-amber-600", reject: "text-rose-600", escalate: "text-rose-600", request_info: "text-blue-600" };
const STATUS_LABEL: Record<string, string> = { waiting: "Waiting", pending_info: "Pending Info", returned: "Returned", delegated: "Delegated", escalated: "Escalated", approved: "Approved", rejected: "Rejected" };
const DOT: Record<string, string> = { red: "bg-rose-500", amber: "bg-amber-500", blue: "bg-blue-500" };
const relTime = (iso?: string | null) => { if (!iso) return "—"; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const slaPercent = (submittedAt: string, slaHours: number) => Math.min(100, Math.round(((Date.now() - new Date(submittedAt).getTime()) / ((slaHours || 24) * 3600000)) * 100));
const TABS = ["Approval Dashboard", "Approval Queue", "Approval Categories", "Decision History", "Approval Analytics", "SLA Monitor", "Approval Calendar"];

function Kpi({ label, value, sub, tone, icon }: { label: string; value: any; sub?: string; tone?: string; icon?: string }) {
  return <div className={`${card} p-3.5`}><div className="flex items-start justify-between"><p className="text-[10px] text-gray-500 uppercase tracking-wide">{label}</p>{icon && <span className="text-sm opacity-50">{icon}</span>}</div><p className={`text-2xl font-bold tabular-nums mt-0.5 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[10px] text-gray-400">{sub}</p>}</div>;
}

export default async function ApprovalsWorkspace({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const dept = typeof sp.dept === "string" ? sp.dept : undefined;
  const selId = typeof sp.id === "string" ? sp.id : undefined;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const isSuper = roles.includes("super_admin");
  const [d, departments] = await Promise.all([
    loadApprovals(admin, profile?.hospital_id ?? null, isSuper, dept, selId) as Promise<any>,
    loadUnitDepartments(admin, profile?.hospital_id ?? null, isSuper),
  ]);
  const provisioned = d.provisioned;

  const header = (
    <>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2"><span className="text-xl">🛡️</span><div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">Approvals</h1><p className="text-sm text-gray-500">Manage approvals and requests that require your decision.</p></div></div>
        <div className="flex items-center gap-2 relative"><UnitFilters departments={departments} /><NewApprovalButton provisioned={provisioned} /></div>
      </div>
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {TABS.map((t, i) => <span key={t} className={`shrink-0 text-xs px-3 py-2 border-b-2 -mb-px font-medium ${i === 0 ? "border-teal-600 text-teal-700" : "border-transparent text-gray-300"}`} title={i === 0 ? "" : "Next phase"}>{t}</span>)}
      </div>
    </>
  );

  if (!provisioned) return <div className="space-y-4">{header}<div className="bg-amber-50 border border-amber-200 rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Approvals store not provisioned</p><p className="text-sm text-amber-800 mt-1">Run <code className="font-mono bg-amber-100 px-1 rounded">migration 077-approval-requests.sql</code> to enable the Approvals workspace.</p></div></div>;

  const k = d.kpis; const sel = d.selected;
  const slaBar = sel ? slaPercent(sel.submitted_at, sel.sla_hours) : 0;

  return (
    <div className="space-y-4">
      {header}

      {/* 7 KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-3">
        <Kpi label="Pending Approvals" value={k.pending} sub="All open items" icon="📥" />
        <Kpi label="Due Today" value={k.dueToday} sub="Needs attention" tone={k.dueToday ? "text-amber-600" : undefined} icon="📅" />
        <Kpi label="High Priority" value={k.highPriority} sub="Critical attention" tone={k.highPriority ? "text-rose-600" : undefined} icon="⚠" />
        <Kpi label="Overdue" value={k.overdue} sub="Past due" tone={k.overdue ? "text-rose-600" : undefined} icon="⏰" />
        <Kpi label="Avg Waiting Time" value={k.avgWaitingHrs != null ? `${k.avgWaitingHrs}h` : "—"} sub="Open requests" icon="⏳" />
        <Kpi label="Completed Today" value={k.completedToday} sub="Approved / rejected" tone="text-green-600" icon="✅" />
        <Kpi label="Approval Health" value={`${k.health}%`} sub={k.health >= 80 ? "Good" : k.health >= 60 ? "Watch" : "At risk"} tone={k.health >= 80 ? "text-green-600" : k.health >= 60 ? "text-amber-600" : "text-rose-600"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Smart approval queue */}
        <div className={`${card} p-5 xl:col-span-2`}>
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-bold text-gray-900">Smart Approval Queue</h3><div className="flex gap-1">{["All", "High Priority", "Due Today", "Overdue"].map((f, i) => <span key={f} className={`text-[10px] px-2 py-0.5 rounded-full ${i === 0 ? "bg-teal-600 text-white" : "bg-gray-100 text-gray-500"}`}>{f}</span>)}</div></div>
          {d.queue.length === 0 ? (
            <div className="text-center py-8"><p className="text-3xl mb-2">✅</p><p className="text-sm font-semibold text-gray-700">No pending approvals</p><p className="text-xs text-gray-400 mt-1">The queue is clear. It populates as approval requests are submitted — use “+ New Request” to raise one.</p></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-gray-400 text-left border-b border-gray-100"><th className="py-2 pr-3 font-medium">Priority</th><th className="py-2 pr-3 font-medium">Category</th><th className="py-2 pr-3 font-medium">Request</th><th className="py-2 pr-3 font-medium">Requester</th><th className="py-2 pr-3 font-medium">Submitted</th><th className="py-2 pr-3 font-medium">Impact</th><th className="py-2 pr-3 font-medium">AI</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Action</th></tr></thead>
                <tbody>
                  {d.queue.slice(0, 8).map((r: any) => (
                    <tr key={r.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${sel?.id === r.id ? "bg-teal-50/40" : ""}`}>
                      <td className="py-2 pr-3"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${PRI[r.priority]}`}>{r.priority}</span></td>
                      <td className="py-2 pr-3 text-gray-600 capitalize">{r.category}</td>
                      <td className="py-2 pr-3 text-gray-800 font-medium max-w-[150px] truncate">{r.title}</td>
                      <td className="py-2 pr-3 text-gray-600 truncate max-w-[90px]">{r.requester}</td>
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">{relTime(r.submitted_at)}</td>
                      <td className={`py-2 pr-3 ${IMPACT[r.impact]}`}>{r.impact}</td>
                      <td className={`py-2 pr-3 capitalize ${REC_TONE[r.ai_recommendation] ?? "text-gray-400"}`}>{r.ai_recommendation ?? "—"}{r.ai_confidence ? ` ${r.ai_confidence}%` : ""}</td>
                      <td className="py-2 pr-3"><span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px]">{STATUS_LABEL[r.status] ?? r.status}</span></td>
                      <td className="py-2"><Link href={`/unit-manager/approvals?id=${r.id}${dept ? `&dept=${dept}` : ""}`} className="text-teal-700 hover:underline">Review</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="text-[10px] text-gray-400 mt-2">Showing {Math.min(8, d.queue.length)} of {d.queue.length}, ranked by priority + SLA. AI recommendation is rule-based over the request context.</p>
            </div>
          )}
        </div>

        {/* Review panel */}
        <div className={`${card} p-5 xl:col-span-1`}>
          {!sel ? <div className="text-center py-8"><p className="text-2xl mb-2">🗂️</p><p className="text-sm text-gray-400">Select a request to review.</p></div> : (
            <>
              <div className="flex items-start justify-between mb-2"><div><p className="text-[10px] text-gray-400 uppercase">{sel.category} · {STATUS_LABEL[sel.status]}</p><h3 className="text-sm font-bold text-gray-900">{sel.title}</h3><p className="text-[10px] text-gray-400">{sel.requester}{sel.requester_role ? ` · ${sel.requester_role}` : ""} · {relTime(sel.submitted_at)}</p></div><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold h-fit ${PRI[sel.priority]}`}>{sel.priority}</span></div>
              {sel.reason && <div className="mt-2"><p className="text-[10px] font-semibold text-gray-500 uppercase">Reason</p><p className="text-xs text-gray-700">{sel.reason}</p></div>}
              {sel.details && <div className="mt-2"><p className="text-[10px] font-semibold text-gray-500 uppercase">Supporting Detail</p><p className="text-xs text-gray-600">{sel.details}</p></div>}
              <div className="mt-3 rounded-lg bg-violet-50/50 border border-violet-100 p-2.5">
                <p className="text-[10px] font-bold text-violet-700 uppercase">AI Recommendation</p>
                <p className={`text-sm font-bold capitalize ${REC_TONE[sel.ai_recommendation] ?? "text-gray-600"}`}>{sel.ai_recommendation ?? "—"}{sel.ai_confidence ? ` · ${sel.ai_confidence}% confidence` : ""}</p>
                {sel.ai_reasoning && <p className="text-[11px] text-gray-600 mt-0.5">{sel.ai_reasoning}</p>}
              </div>
              <div className="mt-3"><p className="text-[10px] font-semibold text-gray-500 uppercase mb-1">SLA — {sel.sla_hours}h target</p><div className="h-2 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${slaBar >= 100 ? "bg-rose-500" : slaBar >= 75 ? "bg-amber-500" : "bg-green-500"}`} style={{ width: `${slaBar}%` }} /></div><p className="text-[10px] text-gray-400 mt-0.5">{slaBar >= 100 ? "Overdue" : `${100 - slaBar}% of SLA remaining`}</p></div>
              {["approved", "rejected"].includes(sel.status) ? (
                <div className="mt-3 rounded-lg bg-gray-50 p-2.5"><p className="text-xs text-gray-600">Decided <b className="capitalize">{sel.status}</b> by {sel.decided_by_name ?? "—"} · {relTime(sel.decided_at)}</p>{sel.decision_note && <p className="text-[11px] text-gray-500 mt-0.5">“{sel.decision_note}”</p>}</div>
              ) : (
                <div className="mt-3"><ApprovalActions selectedId={sel.id} /></div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Categories · AI risk · recently completed */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Approval Categories</h3>
          <div className="space-y-1">
            {d.categories.map((c: any) => (
              <div key={c.key} className="flex items-center justify-between text-xs py-0.5"><span className="text-gray-600">{c.label}</span><b className={c.n ? "text-gray-800" : "text-gray-300"}>{c.n}</b></div>
            ))}
            <div className="flex items-center justify-between text-xs py-0.5 border-t border-gray-50 mt-1 pt-1"><span className="text-gray-400">Archived (decided)</span><b className="text-gray-400">{d.archived}</b></div>
          </div>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-1.5"><span>✨</span>AI Risk Monitor</h3>
          {d.aiRisk.length === 0 ? <p className="text-sm text-gray-400">No approval risks flagged.</p> : (
            <div className="space-y-2">{d.aiRisk.map((a: any, i: number) => (<div key={i} className="flex items-start gap-2"><span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${DOT[a.tone] ?? "bg-gray-300"}`} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold text-gray-800">{a.title}{a.n != null ? ` (${a.n})` : ""}</p><p className="text-[10px] text-gray-500">{a.sub}</p></div></div>))}</div>
          )}
          <p className="text-[10px] text-gray-400 mt-2">Rule-based over the live queue.</p>
        </div>

        <div className={`${card} p-5`}>
          <h3 className="text-sm font-bold text-gray-900 mb-3">Recently Completed</h3>
          {d.recentlyCompleted.length === 0 ? <p className="text-sm text-gray-400">No decisions recorded yet.</p> : (
            <div className="space-y-1.5">{d.recentlyCompleted.map((r: any) => (<div key={r.id} className="flex items-center gap-2 text-xs"><span className={r.status === "approved" ? "text-green-600" : "text-rose-600"}>{r.status === "approved" ? "✓" : "✕"}</span><span className="text-gray-700 flex-1 truncate">{r.title}</span><span className={`capitalize ${r.status === "approved" ? "text-green-600" : "text-rose-600"}`}>{r.status}</span><span className="text-gray-400">{relTime(r.decided_at)}</span></div>))}</div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">The Approvals Workspace (UMW-EA-001) is the Unit Manager&apos;s decision-governance centre — a unified inbox of approval requests (overtime, leave, staffing, equipment, policy, competency, finance…) with AI-assisted recommendations, SLA tracking and a fully audited decision workflow (approve / approve-with-conditions / reject / return / delegate / request-info). It reads the real approval_requests store and shows honest empty states until requests are submitted — nothing is fabricated. AI recommendations are rule-based; the deep Analytics / SLA / Calendar / document-management tabs are next-phase. Every decision is written to the audit log. <Link href="/unit-manager/action-centre" className="text-teal-700 hover:underline">← Executive Actions</Link></p>
    </div>
  );
}
