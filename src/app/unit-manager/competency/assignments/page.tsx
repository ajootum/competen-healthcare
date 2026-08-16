import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import CompetencyTabs from "../CompetencyTabs";
import { loadDeliveredAssignments } from "@/lib/operations/competency-centre";
import { cardClass } from "@/components/ui/primitives";
import { estateRolesOf } from "@/lib/roles";

// Competency Management → Delivered Assignments (UMG-CM). The competency assignments the CDP delivery engine
// landed on this unit — materialised from standing assignment rules (COMP-018) and learning campaigns (CDP-008)
// by the delivery orchestrator. This is the "consume" end of author → govern → deliver → consume, at unit level.
// Real over cmo_assignments (114). No migration.
export const dynamic = "force-dynamic";
/* eslint-disable @typescript-eslint/no-explicit-any */

const METHOD_LABEL: Record<string, string> = { rule: "Rule", campaign: "Campaign", role_based: "Role-based", manual: "Manual" };
const STATUS_CLS: Record<string, string> = { completed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", in_progress: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", assigned: "bg-gray-100 text-gray-500", overdue: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", exempt: "bg-gray-50 text-gray-400" };

export default async function DeliveredAssignmentsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some(r => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d = await loadDeliveredAssignments(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));
  const card = cardClass;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Delivered Assignments</h1>
        <p className="text-sm text-gray-500 mt-1">Competency assignments the delivery engine landed on your unit — materialised from standing rules and campaigns. The consume end of the delivery loop.</p>
      </div>
      <CompetencyTabs />

      {!d.provisioned ? (
        <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6 text-sm text-amber-800">Assignment delivery isn&apos;t provisioned for this unit yet.</div>
      ) : d.kpis.total === 0 ? (
        <div className={card}><p className="text-sm text-gray-400">No competency assignments have been delivered to this unit yet. The delivery orchestrator materialises these from active assignment rules and launched campaigns.</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Delivered", value: d.kpis.total, tone: "text-gray-900" },
              { label: "Completed", value: `${d.kpis.completionPct ?? 0}%`, tone: "text-[var(--cmp-text-success)]", sub: `${d.kpis.completed} of ${d.kpis.total}` },
              { label: "Open", value: d.kpis.open, tone: "text-gray-900" },
              { label: "Overdue", value: d.kpis.overdue, tone: d.kpis.overdue ? "text-[var(--cmp-text-error)]" : "text-gray-900" },
            ].map(k => (
              <div key={k.label} className={card}><div className={`text-2xl font-bold tabular-nums ${k.tone}`}>{k.value}</div><div className="text-xs text-gray-500 mt-1 font-medium">{k.label}</div>{k.sub && <div className="text-[10px] text-gray-400">{k.sub}</div>}</div>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={card}>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">By source</h3>
              <div className="space-y-2">{d.byMethod.map((m: any) => (<div key={m.label} className="flex items-center justify-between text-sm"><span className="text-gray-600">{METHOD_LABEL[m.label] ?? m.label}</span><span className="tabular-nums text-gray-900 font-medium">{m.n}</span></div>))}</div>
            </div>
            <div className={card}>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">By status</h3>
              <div className="space-y-2">{d.byStatus.map((s: any) => (<div key={s.label} className="flex items-center justify-between text-sm"><span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${STATUS_CLS[s.label] ?? "bg-gray-100 text-gray-500"}`}>{s.label.replace(/_/g, " ")}</span><span className="tabular-nums text-gray-900 font-medium">{s.n}</span></div>))}</div>
            </div>
            <div className={card}>
              <h3 className="font-semibold text-gray-900 text-sm mb-3">Top competencies</h3>
              <div className="space-y-2">{d.topCompetencies.map((t: any) => (<div key={t.label} className="flex items-center justify-between text-sm gap-2"><span className="text-gray-600 truncate" title={t.label}>{t.label}</span><span className="tabular-nums text-gray-900 font-medium shrink-0">{t.n}</span></div>))}</div>
            </div>
          </div>

          <div className={card}>
            <h3 className="font-semibold text-gray-900 text-sm mb-3">All deliveries</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] text-gray-400 border-b border-gray-100"><th className="py-2 pr-3 font-medium">Competency</th><th className="py-2 px-3 font-medium">Target</th><th className="py-2 px-3 font-medium">Source</th><th className="py-2 px-3 font-medium">Due</th><th className="py-2 pl-3 font-medium">Status</th></tr></thead>
                <tbody>
                  {d.rows.slice(0, 100).map((rw: any) => (
                    <tr key={rw.id} className="border-b border-gray-50">
                      <td className="py-2 pr-3 text-gray-800 truncate max-w-[220px]" title={rw.competency}>{rw.competency}</td>
                      <td className="py-2 px-3 text-gray-500 truncate max-w-[140px]">{rw.target_label ?? "All staff"}</td>
                      <td className="py-2 px-3 text-gray-500">{METHOD_LABEL[rw.method] ?? rw.method}</td>
                      <td className="py-2 px-3 text-gray-500 tabular-nums">{rw.due_date ?? "—"}</td>
                      <td className="py-2 pl-3"><span className={`text-[10px] font-bold uppercase tracking-wide rounded px-1.5 py-0.5 ${rw.isOverdue ? STATUS_CLS.overdue : STATUS_CLS[rw.status] ?? "bg-gray-100 text-gray-500"}`}>{rw.isOverdue ? "overdue" : rw.status.replace(/_/g, " ")}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.rows.length > 100 && <p className="text-[11px] text-gray-400 pt-2">Showing 100 of {d.rows.length}.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
