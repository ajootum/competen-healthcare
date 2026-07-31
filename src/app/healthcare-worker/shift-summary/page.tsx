import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMyShiftSummary } from "@/lib/hww/shift-summary";
import { card, titleCase, fmtTime, fmtDateLong, StatCard, SectionCard } from "@/lib/hww/kit";

// Shift Summary (HWW-WARD-001 S4.12) — the nurse's end-of-shift picture: my
// operational contribution this shift (all actor-scoped real counts), the
// shift's computed quality metrics when the supervisor has run them, and
// handover readiness. The natural last stop before SBAR handover.

export const dynamic = "force-dynamic";

export default async function ShiftSummaryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const data = await loadMyShiftSummary(admin, user.id);
  const { shift, my } = data;
  const m = data.shiftMetrics;

  const rows: { icon: string; label: string; value: number; href: string; note?: string }[] = [
    { icon: "📈", label: "Observations recorded", value: my.observations, href: "/healthcare-worker/observations" },
    { icon: "💊", label: "Medications administered", value: my.medsAdministered, href: "/healthcare-worker/medications", note: my.medsDelayedOmitted ? `${my.medsDelayedOmitted} delayed/omitted` : undefined },
    { icon: "✅", label: "Tasks completed", value: my.tasksCompleted, href: "/healthcare-worker/tasks", note: data.tasksOpen ? `${data.tasksOpen} still open` : undefined },
    { icon: "🌡️", label: "Acuity assessments", value: my.acuityAssessments, href: "/healthcare-worker/acuity", note: my.significantChanges ? `${my.significantChanges} significant change${my.significantChanges === 1 ? "" : "s"}` : undefined },
    { icon: "⚖️", label: "Workload assessments", value: my.workloadAssessments, href: "/healthcare-worker/workload" },
    { icon: "🚩", label: "Concerns raised", value: my.concernsRaised, href: "/healthcare-worker/concerns", note: my.concernsResolved ? `${my.concernsResolved} resolved` : undefined },
    { icon: "⬆️", label: "Escalations raised", value: my.escalationsRaised, href: "/healthcare-worker/safety" },
    { icon: "🛡️", label: "Incidents reported", value: my.incidentsReported, href: "/healthcare-worker/safety" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Summary</h1>
          <p className="text-sm text-gray-500 mt-1">Your shift in numbers — every count is a real operational record you created.</p>
        </div>
        {shift && (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
            <span className="text-lg">🗓️</span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-gray-800">{fmtDateLong(shift.shift_date)}</p>
              <p className="text-xs text-gray-500">{titleCase(shift.shift_type)}{shift.starts_at ? ` · ${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}` : ""}{shift.unit ? ` · ${shift.unit}` : ""}</p>
            </div>
          </div>
        )}
      </div>

      {!shift && (
        <div className={card}>
          <p className="text-sm text-gray-500">Not currently deployed on a shift — showing your activity over the last 12 hours.</p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🧑‍⚕️" title="My Patients" value={data.patients.length} sub="active assignment" />
        <StatCard icon="🤝" title="SBAR Ready" value={`${data.sbarReady}/${data.patients.length}`}
          tone={data.patients.length > 0 && data.sbarReady < data.patients.length ? "text-[var(--cmp-text-warning)]" : undefined}
          sub={<Link href="/healthcare-worker/handover" className="text-emerald-700 hover:underline">prepare handover →</Link>} />
        <StatCard icon="✅" title="Open Tasks" value={data.tasksOpen} tone={data.tasksOpen > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub="to close or hand over" />
        <StatCard icon="🕐" title="Window" value={fmtTime(data.since)} sub={shift ? "since shift start" : "last 12 hours"} />
      </div>

      <SectionCard icon="📋" title="My Operational Contribution">
        <div className="grid sm:grid-cols-2 gap-x-8">
          {rows.map(r => (
            <Link key={r.label} href={r.href} className="flex items-center gap-3 py-2.5 border-b border-gray-50 hover:bg-gray-50/60 -mx-2 px-2 rounded-lg transition-colors">
              <span className="text-lg w-6 text-center">{r.icon}</span>
              <span className="text-sm text-gray-700 flex-1">{r.label}</span>
              {r.note && <span className="text-[11px] text-gray-400">{r.note}</span>}
              <span className="text-lg font-bold tabular-nums text-gray-900">{r.value}</span>
            </Link>
          ))}
        </div>
      </SectionCard>

      {m && (
        <div className={card}>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Shift quality metrics (computed by your supervisor)</p>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            {m.observation_compliance_pct != null && <span>Obs compliance: <span className="font-bold tabular-nums">{m.observation_compliance_pct}%</span></span>}
            {m.task_completion_pct != null && <span>Task completion: <span className="font-bold tabular-nums">{m.task_completion_pct}%</span></span>}
            {m.bed_occupancy_pct != null && <span>Occupancy: <span className="font-bold tabular-nums">{m.bed_occupancy_pct}%</span></span>}
            {m.high_acuity_count != null && <span>High acuity: <span className="font-bold tabular-nums">{m.high_acuity_count}</span></span>}
            {m.incident_count != null && <span>Incidents: <span className="font-bold tabular-nums">{m.incident_count}</span></span>}
            {m.overall_score != null && <span>Overall: <span className="font-bold tabular-nums">{m.overall_score}</span></span>}
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        End-of-shift flow: close or hand over open tasks → prepare SBAR per patient → transfer responsibility → done. Your contribution counts feed shift metrics and, as the evidence bridge lands, your competency record.
      </p>
    </div>
  );
}
