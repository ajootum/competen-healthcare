import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadGovernance, REVIEW_LABEL } from "@/lib/config/governance";
import { loadRegistry } from "@/lib/config/registry";
import GovernanceConsole from "./GovernanceConsole";
import { StatWide as Stat } from "../_kit";

export const dynamic = "force-dynamic";

// Configuration Governance & Release Management (WCE-004) — the governed change pathway. Governance dashboard
// (§7 — summary, risk distribution, review workload, health indicators) + change-request lifecycle (create →
// review → approve → publish → verify → rollback) with risk/reviews derived from the WCE-002 registry.
// Release packaging, test gates, change freezes and progressive rollout are honest next-phase.
/* eslint-disable @typescript-eslint/no-explicit-any */
const card = "bg-white rounded-xl border border-gray-200";
const relTime = (iso?: string | null) => { if (!iso) return ""; const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return "just now"; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

export default async function ConfigurationGovernance() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");

  const [gov, reg] = await Promise.all([loadGovernance(admin), loadRegistry(admin)]);
  const objectKeys = (reg.provisioned ? reg.objects : []).filter((o: any) => ["NAVIGATION_SECTION", "MODULE", "WIDGET"].includes(o.object_type)).map((o: any) => ({ key: o.object_key, name: o.display_name }));

  const header = (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400"><Link href="/super-admin/platform-ops" className="hover:text-teal-700">Platform Operations</Link><span>/</span><span className="text-gray-600">Configuration Governance</span></div>
      <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Configuration Governance &amp; Release <span className="text-sm font-medium text-gray-400">WCE-004</span></h1>
      <p className="text-sm text-gray-500">The governed pathway from draft to production — risk classification, review routing, approval, release and rollback. Risk &amp; reviews derive from the registry (WCE-002).</p>
    </div>
  );

  if (!gov.provisioned) return (
    <div data-wide className="space-y-4">{header}
      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] px-4 py-3 text-sm text-amber-800"><span className="font-semibold">Not provisioned.</span> Run <code className="font-mono text-[12px] bg-[var(--cmp-surface-warning)] px-1 rounded">migration 093-config-governance.sql</code> to enable the governance workflow.</div>
    </div>
  );

  const s = gov.stats;

  return (
    <div data-wide className="space-y-4">
      {header}

      {/* Governance dashboard (§7.1) */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Stat label="Open Requests" value={s.openChangeRequests} />
        <Stat label="Awaiting Review" value={s.awaitingReview} tone={s.awaitingReview ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} />
        <Stat label="Approved · Awaiting Release" value={s.approvedAwaitingRelease} tone={s.approvedAwaitingRelease ? "text-[var(--cmp-text-information)]" : "text-gray-400"} />
        <Stat label="Published" value={s.published} tone="text-[var(--cmp-text-success)]" />
        <Stat label="High / Critical" value={s.highRisk} tone={s.highRisk ? "text-[var(--cmp-text-error)]" : "text-gray-400"} />
        <Stat label="Emergency (open)" value={s.emergency} tone={s.emergency ? "text-[var(--cmp-text-error)]" : "text-gray-400"} />
        <Stat label="Rolled Back" value={s.rolledBack} tone={s.rolledBack ? "text-[var(--cmp-text-warning)]" : "text-gray-400"} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Risk distribution (§7.2) */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Risk Distribution <span className="text-[10px] text-gray-400 font-normal">open changes</span></h2>
          <div className="space-y-2">
            {([["Low", s.byRisk.low, "#10b981"], ["Moderate", s.byRisk.moderate, "#f59e0b"], ["High", s.byRisk.high, "#f97316"], ["Critical", s.byRisk.critical, "#ef4444"]] as any[]).map(([l, n, c]) => {
              const total = s.byRisk.low + s.byRisk.moderate + s.byRisk.high + s.byRisk.critical || 1;
              return <div key={l}><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{l}</span><b className="tabular-nums text-gray-800">{n}</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(n / total) * 100}%`, background: c }} /></div></div>;
            })}
          </div>
        </div>

        {/* Review workload (§7.3) */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Review Workload</h2>
          {s.reviewWorkload.length === 0 ? <p className="text-sm text-gray-400 py-4">No reviews pending.</p> : (
            <div className="space-y-1.5">{s.reviewWorkload.map((w: any) => <div key={w.type} className="flex items-center justify-between text-xs"><span className="text-gray-600">{REVIEW_LABEL[w.type] ?? w.type}</span><b className="tabular-nums text-[var(--cmp-text-warning)]">{w.n}</b></div>)}</div>
          )}
          <div className="mt-3 pt-2 border-t border-gray-100 text-[11px] text-gray-500 space-y-1"><div className="flex justify-between"><span>Rollback rate</span><b className="tabular-nums">{s.rollbackRate}%</b></div><div className="flex justify-between"><span>Emergency-change rate</span><b className="tabular-nums">{s.emergencyRate}%</b></div></div>
        </div>

        {/* Recent governance activity */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Recent Governance Activity</h2>
          {gov.auditRecent.length === 0 ? <p className="text-sm text-gray-400 py-4">No governance activity yet.</p> : (
            <div className="space-y-1.5">{gov.auditRecent.map((a: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-xs"><span className="px-1.5 py-0.5 rounded font-semibold bg-teal-50 text-teal-700">{a.action.replace(/_/g, " ")}</span><span className="text-gray-600 truncate flex-1 font-mono text-[10px]">{a.cr_ref ?? "—"}</span><span className="text-gray-400 shrink-0">{a.actor_name ?? "—"} · {relTime(a.created_at)}</span></div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Change-request lifecycle (§8) */}
      <GovernanceConsole list={gov.list} objectKeys={objectKeys} />

      {/* Honest next-phase */}
      <div className={`${card} border-dashed p-5`}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Roadmap — next-phase governance capabilities</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {[
            ["Test & validation gates (§19)", "Test plans, evidence attachment and blocking gates before approval."],
            ["Release planning & packaging (§22, §25)", "Group approved changes into signed, versioned release packages."],
            ["Progressive rollout & hypercare (§27, §29)", "Sandbox→pilot→facility→tenant rollout with monitoring."],
            ["Configuration calendar & freezes (§23–24)", "Release scheduling, change-freeze windows and conflict detection."],
            ["Structured safety/security/AI reviews (§15–18)", "Per-domain review checklists with digital confirmation."],
            ["Impact analysis & observability (§12, §45)", "Downstream dependency impact + PMS-000 release-health evidence."],
          ].map(([t, x]) => <div key={t}><p className="text-xs font-semibold text-gray-600">{t}</p><p className="text-[10px] text-gray-400">{x}</p></div>)}
        </div>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">WCE-004 MVP: every governed configuration change is a formal change request whose risk level and required reviews are DERIVED from the WCE-002 registry (an object’s safety classification drives review routing — §11/§13/§43), moving through submit → review → approve → publish → verify → rollback with separation-of-duties (the requester cannot approve a high/critical change) and review-completeness enforced server-side, and every action audited immutably (migration 093). Release packaging/signing, test gates, change-freeze calendar, progressive rollout, hypercare and the structured per-domain review checklists are honest next-phase. Super-admin gated.</p>
    </div>
  );
}
