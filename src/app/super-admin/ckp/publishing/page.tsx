import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadPublishing } from "@/lib/super-admin/ckp-publishing";
import GovernanceConsole from "./GovernanceConsole";

export const dynamic = "force-dynamic";

// Knowledge Publishing & Governance (CKP-001.5) — move knowledge safely into
// production. Publishing pipeline, review/approval queues, version control,
// governance committees and audit trail. Live from pub_status + change_requests
// + content_approvals + governance; honest where a stage isn't tracked.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)} min ago`; if (s < 86400) return `${Math.floor(s / 3600)} hr ago`; return `${Math.floor(s / 86400)} d ago`; };
const STAGE_BADGE: Record<string, string> = { "In Review": "bg-amber-50 text-amber-700", Approved: "bg-blue-50 text-blue-700", Published: "bg-green-50 text-green-700", Rejected: "bg-rose-50 text-rose-700" };

export default async function PublishingGovernance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const p = await loadPublishing(admin);
  const k = p.kpis;
  const vc = p.versionControl;

  const kpiCards = [
    { label: "In Review", value: fmt(k.inReview), icon: "👀", iconBg: "bg-amber-50", tone: k.inReview ? "text-amber-600" : undefined },
    { label: "Pending Approvals", value: fmt(k.pendingApprovals), icon: "✅", iconBg: "bg-blue-50", tone: k.pendingApprovals ? "text-blue-600" : undefined },
    { label: "Published", value: fmt(k.published), icon: "🚀", iconBg: "bg-green-50", tone: "text-green-600" },
    { label: "Published (30d)", value: k.publishedThisMonth == null ? "—" : fmt(k.publishedThisMonth), icon: "📈", iconBg: "bg-teal-50", muted: k.publishedThisMonth == null },
    { label: "Archived", value: fmt(k.archived), icon: "🗄️", iconBg: "bg-gray-50", tone: "text-gray-400" },
    { label: "Governance Committees", value: fmt(k.committees), icon: "⚖️", iconBg: "bg-violet-50" },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/ckp" className="hover:text-teal-700">Clinical Knowledge Platform</Link><span>/</span><span className="text-gray-600">Knowledge Publishing &amp; Governance</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Knowledge Publishing &amp; Governance</h1>
        <p className="text-sm text-gray-500">Govern the workflow, approvals and publishing of every knowledge asset.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {kpiCards.map(c => (
          <div key={c.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{c.label}</span>
              <span className={`w-7 h-7 rounded-lg ${c.iconBg} flex items-center justify-center text-sm shrink-0`}>{c.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(c as any).muted ? "text-gray-400" : (c as any).tone ?? "text-gray-900"}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Real in-place governance console — lifecycle, review decisions, KO status, engine */}
      <GovernanceConsole frameworks={p.pickers.frameworks} knowledgeObjects={p.pickers.knowledgeObjects} pendingReviews={p.pickers.pendingReviews} />

      {/* Publishing pipeline */}
      <div className={`${card} p-5`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 text-[15px]">Publishing Pipeline</h2>
          <Link href="/super-admin/platform-ops/approvals" className="text-xs text-teal-700 hover:underline">Approval queue →</Link>
        </div>
        <div className="flex items-center justify-between gap-1">
          {p.pipeline.map((s: any, i: number) => (
            <div key={s.stage} className="flex items-center gap-1 flex-1">
              <div className="flex flex-col items-center gap-1 flex-1">
                <span className="w-11 h-11 rounded-full bg-gray-50 border border-gray-200 flex items-center justify-center text-lg">{s.icon}</span>
                <span className="text-xl font-bold text-gray-900 tabular-nums">{fmt(s.count)}</span>
                <span className="text-[10px] text-gray-500 text-center leading-tight">{s.stage}</span>
              </div>
              {i < p.pipeline.length - 1 && <span className="text-gray-300 shrink-0">→</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Recent submissions */}
        <div className={`${card} p-5 lg:col-span-2`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Recent Submissions</h2>
            <span className="text-[10px] text-gray-400">from change requests</span>
          </div>
          {p.submissions.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">No submissions in review. New change requests appear here.</p> : (
            <div className="divide-y divide-gray-50">
              {p.submissions.map((s: any, i: number) => (
                <div key={i} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1"><p className="text-sm text-gray-800 truncate">{s.title}</p><p className="text-[10px] text-gray-400 capitalize">{s.type}{s.kind ? ` · ${s.kind}` : ""}{s.by ? ` · ${s.by}` : ""}</p></div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${STAGE_BADGE[s.stage] ?? "bg-gray-100 text-gray-600"}`}>{s.stage}</span>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums w-16 text-right">{relTime(s.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Version control */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Version Control</h2>
          <div className="space-y-2">
            {[["Major Versions", vc.major], ["Minor Versions", vc.minor], ["Revisions", vc.revisions], ["Total Change Requests", vc.total]].map(([l, n]) => (
              <div key={l as string} className="flex items-center justify-between text-sm py-1 border-b border-gray-50 last:border-0"><span className="text-gray-600">{l}</span><span className="text-gray-800 font-medium tabular-nums">{fmt(n as number)}</span></div>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-3">Version counts come from change requests by kind. Electronic signatures and release notes activate with the full publishing workflow.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Review queue */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Review Queue</h2>
          <div className="grid grid-cols-2 gap-2">
            {[["Open", p.reviewQueue.open, "text-amber-600"], ["Approved", p.reviewQueue.approved, "text-green-600"], ["Rejected", p.reviewQueue.rejected, "text-rose-600"], ["Implemented", p.reviewQueue.implemented, "text-blue-600"]].map(([l, n, t]) => (
              <div key={l as string} className="rounded-lg border border-gray-100 p-3 text-center"><p className={`text-xl font-bold tabular-nums ${(n as number) ? (t as string) : "text-gray-900"}`}>{fmt(n as number)}</p><p className="text-[10px] text-gray-500">{l}</p></div>
            ))}
          </div>
        </div>

        {/* Governance committees */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Governance Committees <span className="text-[10px] text-gray-400">{p.memberCount} members</span></h2>
            <Link href="/super-admin/governance/committees" className="text-xs text-teal-700 hover:underline">Manage →</Link>
          </div>
          {p.committees.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No governance committees configured.</p> : (
            <div className="space-y-1.5">
              {p.committees.slice(0, 6).map((c: any, i: number) => (
                <div key={i} className="flex items-center justify-between text-sm"><span className="flex items-center gap-2 min-w-0"><span className="text-gray-700 truncate">{c.name}</span>{c.level && <span className="text-[10px] text-gray-400">{c.level}</span>}</span><span className={`text-[10px] shrink-0 ${c.active ? "text-green-600" : "text-gray-400"}`}>{c.active ? "active" : "inactive"}</span></div>
              ))}
            </div>
          )}
        </div>

        {/* Audit trail */}
        <div className={`${card} p-5`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900 text-[15px]">Audit Trail</h2>
            <Link href="/super-admin/audit" className="text-xs text-teal-700 hover:underline">View all →</Link>
          </div>
          {!p.auditReady || p.audit.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">{p.auditReady ? "No recorded knowledge actions." : "Audit unavailable."}</p> : (
            <div className="space-y-2 max-h-56 overflow-y-auto">
              {p.audit.slice(0, 7).map((a: any, i: number) => (
                <div key={i} className="flex items-start gap-2.5"><span className="text-sm mt-0.5">{a.icon}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm text-gray-800 truncate">{a.title}</p><p className="text-[10px] text-gray-400 truncate capitalize">{a.detail}</p></div>
                  <span className="text-[10px] text-gray-400 shrink-0 tabular-nums">{relTime(a.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Knowledge moves safely into production here — draft → review → clinical/educational review → governance → publish → retire, with version control, approvals and an immutable audit trail. The pipeline, review queue and audit are live; electronic signatures, publishing schedules and rollback land with the full release-management workflow.</p>
    </div>
  );
}
