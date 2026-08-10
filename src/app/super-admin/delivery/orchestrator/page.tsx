import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadDeliveryQueue } from "@/lib/delivery/orchestrator";
import OrchestratorRunner from "./OrchestratorRunner";
import { requireHqCapability } from "@/lib/hq/context";

// CDP-001 — Delivery Orchestrator surface. The delivery queue over active assignment rules: which competency
// is pending delivery to which population, and a Run control that materialises pending deliveries (+ emits
// events). A daily cron (delivery_orchestration) does the same automatically. Real over cmo_assignment_rules
// (125) + cmo_assignments (114) + domain_events (102). Super-admin, platform-wide.

export const dynamic = "force-dynamic";

const PRIORITY: Record<string, string> = {
  high: "text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border-[var(--cmp-color-error)]",
  medium: "text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)]",
  low: "text-gray-500 bg-gray-50 border-gray-100",
};

export default async function OrchestratorPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  await requireHqCapability("hq.learning.delivery.view");

  const q = await loadDeliveryQueue(admin, null, true);

  return (
    <div className="max-w-5xl">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-[11px] font-semibold text-violet-500 uppercase tracking-widest mb-0.5">CDP-001 · Delivery Orchestrator</p>
          <h1 className="text-xl font-bold text-gray-900">Delivery Orchestrator</h1>
          <p className="text-gray-400 text-sm mt-0.5">The event→schedule→deliver loop — evaluates active assignment rules and materialises pending competency deliveries.</p>
        </div>
        <Link href="/super-admin/delivery" className="text-xs font-semibold text-gray-500 hover:text-violet-700 border border-gray-200 rounded-lg px-3 py-2 shrink-0">← Delivery</Link>
      </div>

      {!q.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-4">
          <p className="text-[13px] text-amber-900">Assignment rules aren&apos;t provisioned yet — apply migration 125 (<code className="text-[11px]">cmo_assignment_rules</code>) and author rules in the Competency Office to enable orchestration.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-5">
            {[
              { label: "Active rules", value: q.kpis.activeRules, tone: "text-gray-900" },
              { label: "Pending delivery", value: q.kpis.pending, tone: "text-violet-600" },
              { label: "Delivered", value: q.kpis.delivered, tone: "text-teal-600" },
              { label: "Overdue", value: q.kpis.overdue, tone: "text-[var(--cmp-text-error)]" },
              { label: "Staff reach", value: q.kpis.reach, tone: "text-gray-900" },
            ].map(k => (
              <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-3.5">
                <p className={`text-xl font-bold ${k.tone}`}>{k.value}</p>
                <p className="text-[10px] text-gray-400 font-medium mt-0.5">{k.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 p-4 mb-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold text-gray-900 text-sm">Run orchestration</h2>
                <p className="text-[11px] text-gray-400">Materialises every active rule that has never been delivered into a target-based assignment, emitting a competency.assigned event each. Idempotent — already-delivered rules are skipped. Runs daily via cron.</p>
              </div>
              <OrchestratorRunner pending={q.kpis.pending} />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">{q.rows.length} active rule{q.rows.length === 1 ? "" : "s"} · pending shown first</p></div>
            {q.rows.length === 0 ? (
              <p className="text-xs text-gray-400 px-4 py-8 text-center">No active assignment rules. Author rules in the Competency Office to drive delivery.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {q.rows.map(r => (
                  <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                    <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 w-20 text-center ${r.delivered ? "text-teal-700 bg-teal-50 border-teal-100" : "text-violet-700 bg-violet-50 border-violet-100"}`}>{r.delivered ? "Delivered" : "Pending"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{r.competency}</p>
                      <p className="text-[11px] text-gray-400">{r.target} · {r.population} in population · due in {r.dueDays}d</p>
                    </div>
                    <span className={`text-[9px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 shrink-0 ${PRIORITY[r.priority] ?? PRIORITY.low}`}>{r.priority}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-violet-50 border border-violet-100 rounded-xl p-4 mt-4">
            <p className="text-[11px] text-violet-900">
              <span className="font-bold">This closes the delivery loop.</span> Rules (COMP-018) defined the population + competency; the orchestrator now evaluates them and pushes deliveries into <code className="text-[10px]">cmo_assignments</code>, emitting <code className="text-[10px]">competency.assigned</code> to the <code className="text-[10px]">domain_events</code> outbox — run on demand here or daily by the <code className="text-[10px]">delivery_orchestration</code> cron. Reacting to arbitrary inbound events (expiry/failure → auto-remediation) and per-learner delivery queues are the next layers.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
