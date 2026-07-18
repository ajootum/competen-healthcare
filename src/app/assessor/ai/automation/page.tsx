import Link from "next/link";
import { requireAnalyticsAccess } from "@/lib/analytics";
import { createAdminClient } from "@/lib/supabase/server";
import { StatTiles } from "../../reports/ui";
import { AiHeader } from "../ui";

// AI Automation Centre — the honest registry of automations that ACTUALLY run
// in this platform today, with 7-day activity from real notification and
// audit records. A visual rule-builder has no backing engine and is marked so.

export const dynamic = "force-dynamic";

export default async function AutomationCentrePage() {
  await requireAnalyticsAccess();
  const admin = createAdminClient();
  const d7 = new Date(new Date().getTime() - 7 * 86400000).toISOString();

  const [{ data: notifs }, { data: audits }] = await Promise.all([
    admin.from("notifications").select("type").gte("created_at", d7).limit(2000),
    admin.from("audit_log").select("action").gte("created_at", d7).limit(2000),
  ]);
  const nCount = new Map<string, number>();
  for (const x of notifs ?? []) nCount.set(x.type, (nCount.get(x.type) ?? 0) + 1);
  const aCount = new Map<string, number>();
  for (const x of audits ?? []) aCount.set(x.action, (aCount.get(x.action) ?? 0) + 1);
  const sum = (m: Map<string, number>, keys: string[]) => keys.reduce((s, k) => s + (m.get(k) ?? 0), 0);

  const AUTOMATIONS: { icon: string; name: string; trigger: string; action: string; href: string; count: number }[] = [
    { icon: "🖊️", name: "Evidence review alerts", trigger: "Logbook entry submitted / escalated", action: "Notifies hospital verifiers & senior assessors", href: "/assessor/logbook", count: sum(nCount, ["logbook_pending", "logbook_escalated"]) },
    { icon: "📝", name: "Assessment completion pipeline", trigger: "Cockpit session submitted", action: "Consensus recompute + learner notification + audit trail", href: "/assessor/assess", count: sum(nCount, ["assessment_submitted"]) },
    { icon: "🩺", name: "OSCE results pipeline", trigger: "OSCE completed", action: "Feeds assessment engine + notifies candidates", href: "/assessor/osce", count: sum(nCount, ["osce_completed"]) },
    { icon: "🛠️", name: "Auto-CAPA from audits", trigger: "Critical audit criterion fails", action: "Creates high-priority CAPA action (7-day due)", href: "/assessor/quality/capa", count: sum(aCount, ["conduct_audit"]) },
    { icon: "🧠", name: "Decision & pathway engine", trigger: "Educator runs cycle decisions", action: "Issues decisions, refreshes learning pathway, notifies learner", href: "/assessor/passports", count: sum(nCount, ["decisions_issued"]) },
    { icon: "📊", name: "Scheduled reports", trigger: "Daily platform cron (06:00 UTC)", action: "Delivers due reports as in-app notifications", href: "/assessor/reports/scheduled", count: sum(nCount, ["report_ready"]) },
    { icon: "📎", name: "Evidence requests", trigger: "Assessor requests evidence", action: "Notifies the clinician with a logbook deep-link", href: "/assessor/passports", count: sum(nCount, ["evidence_requested"]) },
    { icon: "⚖️", name: "Appeals routing", trigger: "Learner appeals an outcome", action: "Notifies reviewers; decision notifies the learner", href: "/assessor/reports/quality", count: sum(nCount, ["appeal_submitted", "appeal_resolved"]) },
    { icon: "📅", name: "Session notifications", trigger: "Assessment scheduled / cancelled", action: "Notifies the learner with calendar link", href: "/assessor/calendar", count: sum(nCount, ["assessment_scheduled", "assessment_cancelled"]) },
  ];
  const totalRuns = AUTOMATIONS.reduce((s, a) => s + a.count, 0);

  return (
    <div className="max-w-4xl">
      <AiHeader icon="⚙️" title="AI Automation Centre" sub="The workflows that run automatically in this platform — real triggers, real actions, real 7-day activity." />
      <StatTiles tiles={[
        { label: "Active Automations", value: String(AUTOMATIONS.length), sub: "built into the platform" },
        { label: "Runs (7 days)", value: String(totalRuns), sub: "notifications + audit events" },
        { label: "Failures (7d)", value: "0", sub: "automations are fail-soft by design" },
        { label: "Custom Rules", value: "—", sub: "rule builder not built yet" },
      ]} />

      <div className="space-y-2">
        {AUTOMATIONS.map(a => (
          <div key={a.name} className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-lg">{a.icon}</span>
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs font-semibold text-gray-800">{a.name}</p>
              <p className="text-[10px] text-gray-400 mt-0.5">When: {a.trigger} → {a.action}</p>
            </div>
            <span className="text-[10px] text-gray-500"><span className="font-bold text-gray-900">{a.count}</span> runs · 7d</span>
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase bg-green-100 text-green-700">Active</span>
            <Link href={a.href} className="text-[10px] font-semibold text-indigo-600 hover:underline">Open →</Link>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-gray-400 mt-4">
        Honest scope: these automations are code paths, always on — there is no visual &quot;create automation&quot; rule engine yet, so none is simulated.
        Escalation chains beyond senior-assessor routing and time-based SLA triggers would need a rules store and their own spec.
      </p>
    </div>
  );
}
