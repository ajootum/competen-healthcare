import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { loadMySafety } from "@/lib/hww/safety";
import { titleCase, fmtWhen, StatCard, SectionCard, Empty, Chip } from "@/lib/hww/kit";
import RaiseSafety from "./RaiseSafety";

// Safety & Escalation Centre (HWW-WARD-001 S4.9 / HWW-SAF-001) — the nurse's
// safety lens: active alerts and open escalations on my patients or raised by
// me (with response deadlines and breach flags), my incident reports (7d),
// and the frontline raise actions. The 5-step escalation pathway starts here;
// queue management stays with the coordinator tier.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const SEV_TONE: Record<string, string> = {
  low: "bg-gray-100 text-gray-500", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700",
  routine: "bg-gray-100 text-gray-500", urgent: "bg-amber-100 text-amber-700", emergency: "bg-red-100 text-red-700", critical: "bg-red-100 text-red-700",
};
const ESC_STATUS: Record<string, string> = { open: "bg-red-100 text-red-700", acknowledged: "bg-blue-100 text-blue-700" };

export default async function SafetyPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMySafety(admin, user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Safety &amp; Escalation</h1>
        <p className="text-sm text-gray-500 mt-1">Everything safety-related on your patients — and one tap to escalate, alert or report. Frontline reporting is a safety right.</p>
      </div>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🛡️" title="Active Alerts" value={data.kpis.activeAlerts} tone={data.kpis.activeAlerts > 0 ? "text-red-600" : undefined} sub="on my patients / raised by me" />
        <StatCard icon="⬆️" title="Open Escalations" value={data.kpis.openEscalations} tone={data.kpis.openEscalations > 0 ? "text-orange-600" : undefined} sub="awaiting acknowledgement" />
        <StatCard icon="⏰" title="Deadline Breached" value={data.kpis.breachedDeadlines} tone={data.kpis.breachedDeadlines > 0 ? "text-red-600" : undefined} sub="response overdue — chase now" />
        <StatCard icon="🚩" title="My Incident Reports" value={data.kpis.myIncidents7d} sub="last 7 days" />
      </div>

      <RaiseSafety patients={data.patients} />

      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="⬆️" title="Escalations" count={data.escalations.length}>
          <div className="divide-y divide-gray-100">
            {data.escalations.length === 0 && <Empty>No open escalations in your scope. Raising one alerts your coordinator with a response deadline.</Empty>}
            {data.escalations.map((e: any) => (
              <div key={e.id} className={`py-2.5 ${e.deadline_passed ? "bg-red-50/40 -mx-2 px-2 rounded-lg" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-gray-800">L{e.level}</span>
                  <Chip tone={SEV_TONE[e.severity] ?? SEV_TONE.routine}>{titleCase(e.severity)}</Chip>
                  <Chip tone={ESC_STATUS[e.status] ?? "bg-gray-100 text-gray-500"}>{titleCase(e.status)}</Chip>
                  {e.deadline_passed && <Chip tone="bg-red-100 text-red-700">Deadline breached</Chip>}
                  <span className="text-xs text-gray-400 ml-auto">{e.op_patients?.label ?? ""} · {fmtWhen(e.created_at)}</span>
                </div>
                <p className="text-sm text-gray-600 mt-1">{e.summary}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Raised by {e.profiles?.full_name ?? "—"}{e.response_deadline ? ` · respond by ${fmtWhen(e.response_deadline)}` : ""}{titleCase(e.escalation_type ?? "")}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon="🛡️" title="Active Safety Alerts" count={data.alerts.length}>
          <div className="divide-y divide-gray-100">
            {data.alerts.length === 0 && <Empty>No active alerts in your scope.</Empty>}
            {data.alerts.map((a: any) => (
              <div key={a.id} className="py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-gray-800">{titleCase(a.category)}</span>
                  <Chip tone={SEV_TONE[a.severity] ?? SEV_TONE.low}>{titleCase(a.severity)}</Chip>
                  <span className="text-xs text-gray-400 ml-auto">{a.op_patients?.label ?? "—"} · {fmtWhen(a.created_at)}</span>
                </div>
                {a.note && <p className="text-sm text-gray-600 mt-0.5">{a.note}</p>}
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <SectionCard icon="🚩" title="My Incident Reports (7 days)" count={data.incidents.length}>
        <div className="divide-y divide-gray-50">
          {data.incidents.length === 0 && <Empty>None reported this week. Incidents and near-misses feed the quality &amp; learning loop — report freely, it is never a blame record.</Empty>}
          {data.incidents.map((i: any) => (
            <div key={i.id} className="py-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="text-xs text-gray-400 tabular-nums w-24 shrink-0">{fmtWhen(i.created_at)}</span>
              <span className="text-gray-800">{titleCase(i.incident_type)}</span>
              {i.near_miss && <Chip tone="bg-purple-100 text-purple-700">Near miss</Chip>}
              <Chip tone={SEV_TONE[i.severity] ?? SEV_TONE.low}>{titleCase(i.severity)}</Chip>
              <Chip tone={i.status === "closed" ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700"}>{titleCase(i.status ?? "open")}</Chip>
              <span className="text-xs text-gray-500 flex-1 min-w-0 truncate">{i.description}</span>
              <span className="text-xs text-gray-400">{i.op_patients?.label ?? ""}</span>
            </div>
          ))}
        </div>
      </SectionCard>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Escalation pathway: you → team leader → shift supervisor → medical team → rapid response. Queue management and resolution live with your coordinator; you always see the state of what you raised.
      </p>
    </div>
  );
}
