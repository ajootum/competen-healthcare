import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftCommandCentre } from "@/lib/hww/command-centre";
import { buildShiftCard } from "@/lib/hww/my-shift";
import { cnciTone } from "@/lib/hww/cnci";
import { card, label, titleCase, fmtTime, fmtWhen, AcuityChip, Chip, StatCard, SectionCard, Empty, PrioChip, ewsColor } from "@/lib/hww/kit";

// Shift Dashboard — the Shift Command Centre (HWW-ARCH-002 S5): greeting +
// shift context, six operational KPIs, the CNCI-ranked My Patients table
// (acuity, workload, priority index, next due, trend, reassessment prompts),
// today's REAL timeline (shift window, ward rounds, due clusters), the
// deterministic AI shift briefing, safety alerts, due queues, tasks and
// this-shift performance. Every number is a live operational record.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const TREND = { up: { icon: "↗", cls: "text-[var(--cmp-text-critical)]" }, down: { icon: "↘", cls: "text-[var(--cmp-text-success)]" }, flat: { icon: "→", cls: "text-gray-400" } } as const;
const TL_DOT: Record<string, string> = { shift: "bg-[var(--cmp-color-success)]", round: "bg-indigo-400", due: "bg-[var(--cmp-color-warning)]", handover: "bg-purple-400" };

export default async function ShiftCommandCentre() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("full_name").eq("id", user.id).single();

  const d = await loadShiftCommandCentre(admin, user.id);
  const shiftCard = buildShiftCard(d.shift ? { starts_at: d.shift.starts_at, ends_at: d.shift.ends_at, shift_type: d.shift.shift_type, units: { name: d.shift.unit }, departments: { name: d.shift.department } } : null);
  const firstName = (profile?.full_name ?? "").split(" ")[0] || "there";
  const onDuty = !!d.shift && (d.shift.duty_status === "on_duty" || d.shift.status === "active");
  const obsOverdueRows = d.observations.filter((o: any) => o.status === "overdue");
  const tasksTop = d.tasks.slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Greeting + shift context */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{d.greeting}, {firstName} 👋</h1>
          <p className="text-sm text-gray-500 mt-1">Here&apos;s your shift overview — CNCI drives the order; deal with the top of the table first.</p>
        </div>
        <div className="flex items-center gap-2">
          {d.shift && (
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${onDuty ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : "bg-gray-100 text-gray-500"}`}>{onDuty ? "In Progress" : "Off Duty"}</span>
          )}
          <Link href="/healthcare-worker/shift-summary" className="px-3.5 py-2 rounded-lg border border-[var(--cmp-color-critical)] text-[var(--cmp-text-critical)] text-sm font-medium hover:bg-[var(--cmp-surface-critical)]">⏻ End-of-shift →</Link>
        </div>
      </div>

      {!d.shift && (
        <div className={card}>
          <p className="font-semibold text-gray-800">You are not currently deployed on an active shift.</p>
          <p className="text-sm text-gray-500 mt-1">When your supervisor rosters you on, your full command centre appears here. Anything already assigned to you is shown below.</p>
        </div>
      )}

      {/* Six KPI tiles (mockup row) */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard icon="🧑‍⚕️" title="Assigned Patients" value={d.kpis.patients} sub={<Link href="/healthcare-worker/patients" className="text-emerald-700 hover:underline">View all patients →</Link>} />
        <StatCard icon="🔴" title="High Priority" value={d.kpis.highPriority} tone={d.kpis.highPriority > 0 ? "text-[var(--cmp-text-critical)]" : undefined} sub="CNCI high / critical" />
        <StatCard icon="💊" title="Medications Due" value={d.kpis.medsDueSoon} tone={d.meds.kpis.overdue > 0 ? "text-[var(--cmp-text-critical)]" : undefined} sub={d.meds.kpis.overdue ? `${d.meds.kpis.overdue} overdue` : "in the due window"} />
        <StatCard icon="📈" title="Obs Overdue" value={d.kpis.obsOverdue} tone={d.kpis.obsOverdue > 0 ? "text-[var(--cmp-text-warning)]" : undefined} sub={<Link href="/healthcare-worker/observations" className="text-emerald-700 hover:underline">view queue →</Link>} />
        <StatCard icon="🛡️" title="Safety Alerts" value={d.kpis.safetyAlerts} tone={d.kpis.safetyAlerts > 0 ? "text-[var(--cmp-text-critical)]" : undefined} sub="alerts + escalations" />
        <StatCard icon="🕐" title="Shift Time" value={shiftCard ? shiftCard.window : "—"} sub={shiftCard ? `${shiftCard.remaining} remaining` : "not deployed"} />
      </div>

      {/* CNCI-ranked My Patients table */}
      <SectionCard icon="👥" title="My Patients" count={d.rows.length}
        right={<Link href="/healthcare-worker/patients" className="text-xs text-emerald-700 hover:underline">View all →</Link>}>
        {d.rows.length === 0 ? (
          <Empty>No patients assigned. Your coordinator allocates patients in the Clinical Operations Centre.</Empty>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Patient</th>
                  <th className="py-1.5 px-1 font-medium">Acuity</th>
                  <th className="py-1.5 px-1 font-medium">Workload</th>
                  <th className="py-1.5 px-1 font-medium">CNCI (Priority)</th>
                  <th className="py-1.5 px-1 font-medium">PEWS</th>
                  <th className="py-1.5 px-1 font-medium">Next Due</th>
                  <th className="py-1.5 pl-1 font-medium">Trend</th>
                </tr>
              </thead>
              <tbody>
                {d.rows.map((r: any) => {
                  const p = r.patient;
                  const t = r.trend ? TREND[r.trend as keyof typeof TREND] : null;
                  return (
                    <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                      <td className="py-2 pr-2">
                        <Link href={`/healthcare-worker/patients/${p.id}`} className="font-medium text-gray-800 hover:text-emerald-700">
                          {p.op_beds?.label ? `${p.op_beds.label} · ` : ""}{p.label}
                        </Link>
                        {r.reassess.due && <span className="block text-[9px] text-[var(--cmp-text-warning)] font-semibold" title={r.reassess.reason ?? ""}>reassessment recommended</span>}
                      </td>
                      <td className="py-2 px-1"><AcuityChip level={p.acuity_level} />{r.acuityScore != null && <span className="ml-1 text-[10px] text-gray-400 tabular-nums">{r.acuityScore}/18</span>}</td>
                      <td className="py-2 px-1 tabular-nums text-gray-700">{r.workloadPct != null ? `${Number(r.workloadPct).toFixed(0)}%` : "—"}</td>
                      <td className="py-2 px-1">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-bold tabular-nums ${cnciTone(r.cnci.band)}`}>
                          {r.cnci.score}<span className="font-normal">{titleCase(r.cnci.band)}</span>
                        </span>
                      </td>
                      <td className={`py-2 px-1 font-semibold tabular-nums ${ewsColor(r.pews)}`}>{r.pews ?? "—"}</td>
                      <td className="py-2 px-1 text-xs">
                        {r.nextDue ? (
                          <span className={r.nextDue.overdue ? "text-[var(--cmp-text-critical)] font-semibold" : "text-gray-600"}>
                            {r.nextDue.overdue ? "OVERDUE — " : `${fmtTime(r.nextDue.at)} — `}{r.nextDue.label}
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                      <td className={`py-2 pl-1 text-base font-bold ${t?.cls ?? "text-gray-300"}`}>{t?.icon ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-2">CNCI — Composite Nursing Care Index: acuity + workload + safety risk + time-critical work + trend. ● Critical (80-100) · High (60-79) · Moderate (30-59) · Low (0-29). Hover a reassessment prompt for its reason.</p>
          </div>
        )}
      </SectionCard>

      {/* Timeline + briefing/alerts */}
      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="🕐" title="Today's Timeline">
          {d.timeline.length === 0 ? <Empty>No active shift — the timeline builds from your shift window, ward round schedule and due items.</Empty> : (
            <div className="space-y-0.5 max-h-96 overflow-y-auto">
              {d.timeline.map((e: any, i: number) => (
                <div key={i} className="flex items-start gap-3 py-1.5">
                  <span className="text-xs text-gray-500 tabular-nums w-11 shrink-0 mt-0.5">{e.time}</span>
                  <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${TL_DOT[e.kind] ?? "bg-gray-300"}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-800 leading-tight">{e.label}</p>
                    {e.detail && <p className="text-[11px] text-gray-400">{e.detail}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

        <div className="space-y-5">
          <div className={`${card} border-[var(--cmp-color-success)] bg-[var(--cmp-surface-success)]/30`}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">✨ Shift Briefing</h3>
              <span className="text-[10px] text-gray-400">derived live from your records</span>
            </div>
            <ul className="space-y-1.5">
              {d.briefing.map((b: string, i: number) => (
                <li key={i} className="flex items-start gap-2 text-sm text-gray-700"><span className="text-emerald-500 mt-0.5">●</span>{b}</li>
              ))}
            </ul>
            <Link href="/healthcare-worker/copilot" className="inline-block mt-3 text-xs font-medium text-emerald-700 hover:underline">View detailed insights (AI copilot) →</Link>
          </div>

          <SectionCard icon="🛡️" title="Recent Safety Alerts" count={d.safetyAlerts.length + d.escalations.length}
            right={<Link href="/healthcare-worker/safety" className="text-xs text-emerald-700 hover:underline">View all →</Link>}>
            <div className="space-y-2 max-h-44 overflow-y-auto">
              {d.safetyAlerts.length + d.escalations.length === 0 && <Empty>No active alerts on your patients.</Empty>}
              {[...d.safetyAlerts.map((a: any) => ({ sev: a.severity === "high" ? "high" : "med", text: `${titleCase(a.category)} — ${a.op_patients?.label ?? ""}`, when: a.created_at })),
                ...d.escalations.map((e: any) => ({ sev: e.level >= 4 ? "high" : "med", text: `Escalation L${e.level} — ${e.op_patients?.label ?? ""}`, when: e.created_at }))]
                .slice(0, 6).map((a: any, i: number) => (
                  <div key={i} className="flex items-start gap-2 text-sm">
                    <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.sev === "high" ? "bg-[var(--cmp-color-critical)]" : "bg-[var(--cmp-color-warning)]"}`} />
                    <span className="text-gray-700 flex-1 min-w-0 truncate">{a.text}</span>
                    <span className="text-[10px] text-gray-400 shrink-0">{fmtWhen(a.when)}</span>
                  </div>
                ))}
            </div>
          </SectionCard>
        </div>
      </div>

      {/* Due queues + tasks + performance */}
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5">
        <div className={card}>
          <div className="flex items-center justify-between mb-2"><span className={label}>Medications Due Soon</span><Link href="/healthcare-worker/medications" className="text-[10px] text-emerald-700 hover:underline">View all →</Link></div>
          {d.meds.queue.length === 0 ? <Empty>Nothing due.</Empty> : d.meds.queue.slice(0, 5).map((m: any) => (
            <p key={m.id} className="text-xs text-gray-600 py-1 flex items-center gap-2">
              <span className={`tabular-nums ${m.effective_status === "overdue" ? "text-[var(--cmp-text-critical)] font-semibold" : "text-gray-500"}`}>{fmtTime(m.scheduled_at)}</span>
              <span className="flex-1 min-w-0 truncate">{m.drug_name}{m.dose_display ? ` ${m.dose_display}` : ""}</span>
              <span className="text-gray-400">{m.op_patients?.label}</span>
              {m.high_risk && <span className="text-[var(--cmp-text-warning)] text-[9px] font-bold">HR</span>}
            </p>
          ))}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between mb-2"><span className={label}>Assessments Overdue</span><Link href="/healthcare-worker/observations" className="text-[10px] text-emerald-700 hover:underline">Go →</Link></div>
          {obsOverdueRows.length === 0 ? <Empty>None overdue.</Empty> : obsOverdueRows.slice(0, 5).map((o: any) => (
            <p key={o.id} className="text-xs text-gray-600 py-1 flex items-center gap-2">
              <span className="text-[var(--cmp-text-critical)] font-semibold">OVERDUE</span>
              <span className="flex-1 min-w-0 truncate">{o.op_patients?.label} — {titleCase(o.observation_type)}</span>
            </p>
          ))}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between mb-2"><span className={label}>Tasks Requiring Action</span><Link href="/healthcare-worker/tasks" className="text-[10px] text-emerald-700 hover:underline">Go to My Tasks →</Link></div>
          {tasksTop.length === 0 ? <Empty>No open tasks.</Empty> : tasksTop.map((t: any) => (
            <p key={t.id} className="text-xs text-gray-600 py-1 flex items-center gap-2">
              <span className="text-gray-500 tabular-nums">{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
              <span className="flex-1 min-w-0 truncate">{t.description}</span>
              <PrioChip p={t.priority} />
            </p>
          ))}
        </div>
        <div className={card}>
          <span className={label}>My Performance (This Shift)</span>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2">
            <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.performance.medOnTimePct != null ? `${d.performance.medOnTimePct}%` : "—"}</p><p className="text-[10px] text-gray-500">med admin on time ({d.performance.medsAdministered} given)</p></div>
            <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.performance.obsRecorded}</p><p className="text-[10px] text-gray-500">observations recorded</p></div>
            <div><p className="text-xl font-bold tabular-nums text-gray-900">{d.performance.tasksCompleted}</p><p className="text-[10px] text-gray-500">tasks completed</p></div>
            <div><p className={`text-xl font-bold tabular-nums ${d.performance.safetyEvents > 0 ? "text-[var(--cmp-text-warning)]" : "text-gray-900"}`}>{d.performance.safetyEvents}</p><p className="text-[10px] text-gray-500">safety events raised</p></div>
          </div>
        </div>
      </div>

      {/* Ward context strip */}
      {d.ward && (
        <div className={card}>
          <div className="flex flex-wrap items-center gap-x-8 gap-y-2 text-sm text-gray-600">
            <span className={label}>Ward Context</span>
            <span><span className="font-bold tabular-nums text-gray-900">{d.ward.census}</span> patients on the ward{d.ward.isolation > 0 ? ` · ${d.ward.isolation} isolation` : ""}</span>
            {d.ward.beds && <span><span className="font-bold tabular-nums text-gray-900">{d.ward.beds.occupied}/{d.ward.beds.total}</span> beds occupied</span>}
            <span><span className="font-bold tabular-nums text-gray-900">{d.ward.onDuty}/{d.ward.staff.length}</span> staff on duty</span>
            <span className="flex flex-wrap gap-1">
              {(["critical", "high", "moderate", "stable"] as const).filter(k => d.ward!.acuity[k] > 0).map(k => (
                <span key={k} className="inline-flex items-center gap-1"><Chip tone={{ critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700", moderate: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", stable: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" }[k]}>{k}</Chip><span className="tabular-nums text-xs">{d.ward!.acuity[k]}</span></span>
              ))}
            </span>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-gray-400 pt-1">
        Every number on this page is a live operational record — nothing is fabricated. The briefing is derived deterministically from your own data; the copilot adds reasoning on request.
      </p>
    </div>
  );
}
