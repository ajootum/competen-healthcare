import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadApprovalOps } from "@/lib/platform/approvals";
import ApprovalQueue from "./ApprovalQueue";

export const dynamic = "force-dynamic";

// Workflow & Approvals console (PCS-000 §10 / POS-001D) — a configurable approval
// engine. Unifies the code-defined workflow catalogue's requests with existing
// content change_requests into one actionable queue. Fail-soft pre-migration.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";
const fmt = (n: number) => n.toLocaleString();
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default async function ApprovalsConsole() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const { queue, byWorkflow, recentDecisions, summary: s } = await loadApprovalOps(admin);

  const kpis = [
    { label: "Pending", value: fmt(s.pending), icon: "⏳", iconBg: "bg-amber-50", sub: `${s.approvals} engine · ${s.contentChanges} content`, tone: s.pending ? "text-amber-600" : "text-gray-900" },
    { label: "Workflows", value: fmt(s.workflows), icon: "🔀", iconBg: "bg-violet-50", sub: "approval types" },
    { label: "Approved (24h)", value: s.ready ? fmt(s.approved24h) : "—", icon: "✅", iconBg: "bg-green-50", sub: "engine decisions", muted: !s.ready },
    { label: "Rejected (24h)", value: s.ready ? fmt(s.rejected24h) : "—", icon: "⛔", iconBg: "bg-rose-50", sub: "engine decisions", tone: s.rejected24h ? "text-rose-600" : undefined, muted: !s.ready },
  ];

  return (
    <div data-wide className="space-y-4">
      <div>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Workflow &amp; Approvals</span>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Workflow &amp; Approvals</h1>
        <p className="text-sm text-gray-500">A configurable, multi-step approval engine across every platform workflow.</p>
      </div>

      {!s.ready && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span className="font-semibold">Engine not enabled.</span> Run <code className="font-mono text-[12px] bg-amber-100 px-1 rounded">supabase/RUN-ME-057-approval-engine.sql</code> to submit and decide approvals. Existing content change-requests still appear in the queue below.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <div key={k.label} className={`${card} p-4`}>
            <div className="flex items-start justify-between">
              <span className="text-[11px] font-semibold text-gray-500 leading-tight">{k.label}</span>
              <span className={`w-7 h-7 rounded-lg ${k.iconBg} flex items-center justify-center text-sm shrink-0`}>{k.icon}</span>
            </div>
            <p className={`text-2xl font-bold mt-1.5 tabular-nums ${(k as any).muted ? "text-gray-400" : (k as any).tone ?? "text-gray-900"}`}>{k.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{k.sub}</p>
          </div>
        ))}
      </div>

      <ApprovalQueue queue={queue} workflows={byWorkflow} canAct={s.ready} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Workflow catalogue */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Workflow Catalogue</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {byWorkflow.map((w: any) => (
              <div key={w.key} className="flex items-center gap-2.5 rounded-lg border border-gray-100 p-3">
                <span className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center text-sm shrink-0">{w.icon}</span>
                <div className="min-w-0 flex-1"><p className="text-sm font-medium text-gray-800 truncate">{w.name}</p><p className="text-[10px] text-gray-400">{w.steps} step{w.steps === 1 ? "" : "s"}</p></div>
                {w.pending > 0 && <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">{w.pending}</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Recent decisions */}
        <div className={`${card} p-5`}>
          <h2 className="font-semibold text-gray-900 text-[15px] mb-3">Recent Decisions</h2>
          {!s.ready || recentDecisions.length === 0 ? <p className="text-sm text-gray-400 py-6 text-center">{s.ready ? "No decisions yet." : "Enable the engine to record decisions."}</p> : (
            <div className="space-y-2">
              {recentDecisions.map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-2.5 text-sm">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${d.status === "approved" ? "bg-green-500" : "bg-rose-500"}`} />
                  <span className="text-gray-800 truncate">{d.entityName ?? d.workflow}</span>
                  <span className="text-[10px] text-gray-400">{d.workflow}</span>
                  <span className={`text-xs ml-auto capitalize ${d.status === "approved" ? "text-green-600" : "text-rose-600"}`}>{d.status}</span>
                  <span className="text-[10px] text-gray-400 shrink-0">{relTime(d.at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">Workflow definitions (types and ordered steps) live in application code; requests and per-step decisions are persisted and audited. The queue unifies engine requests with existing content change-requests so one console approves everything. Delegated/parallel approvers and SLA timers are the next layer.</p>
    </div>
  );
}
