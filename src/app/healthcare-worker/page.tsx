import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMyShift, loadWardContext } from "@/lib/hww/my-shift";
import {
  card, label, titleCase, fmtTime, fmtDateLong, fmtWhen,
  AcuityChip, RiskChip, PrioChip, EwsBadge, StatCard, SectionCard, Empty, ewsColor,
} from "@/lib/hww/kit";

// Ward Dashboard (HWW-WARD-001 §4.1) — the bedside nurse's landing picture:
// my current shift, my patient assignment ranked by clinical signal, the
// ward context around me (census, acuity mix, occupancy, who is on duty),
// my open tasks and every active alert on my patients. Server-rendered over
// the same loadMyShift engine the /api/operations/my-shift route serves.
// Real op_* data only — nothing here is fabricated.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function WardDashboard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();

  const data = await loadMyShift(admin, user.id);
  const ward = await loadWardContext(admin, data.shift);
  const { shift, patients, tasks, observations, safetyAlerts, escalations } = data;

  const latestEws = (pid: string) => {
    const w = observations.filter((o: any) => o.patient_id === pid && o.ews_score != null);
    if (!w.length) return null;
    return w.sort((a: any, b: any) => new Date(b.recorded_at ?? b.created_at ?? 0).getTime() - new Date(a.recorded_at ?? a.created_at ?? 0).getTime())[0].ews_score as number;
  };
  const dueObs = (pid: string) => observations.filter((o: any) => o.patient_id === pid && (o.status === "due" || o.status === "overdue")).length;
  const patientAlerts = (pid: string) => safetyAlerts.filter((a: any) => a.patient_id === pid).length;

  const obsDue = observations.filter((o: any) => o.status === "due").length;
  const obsOverdue = observations.filter((o: any) => o.status === "overdue").length;
  const urgentTasks = tasks.filter((t: any) => t.priority === "urgent").length;
  const highAcuity = patients.filter((a: any) => ["high", "critical"].includes(a.op_patients.acuity_level)).length;
  const onDuty = !!shift && (shift.duty_status === "on_duty" || shift.status === "active");

  // Severity-ranked alert feed from real signals (safety alerts, escalations,
  // critical acuity, overdue observations) — same composition as HWW-012.
  const alertItems: { sev: "high" | "med" | "low"; label: string; note?: string | null; when?: string | null }[] = [
    ...safetyAlerts.map((a: any) => ({ sev: (a.severity === "high" ? "high" : a.severity === "medium" ? "med" : "low") as any, label: `${titleCase(a.category)} — ${a.op_patients?.label ?? "patient"}`, note: a.note, when: a.created_at })),
    ...escalations.map((e: any) => ({ sev: (e.level >= 4 ? "high" : e.level >= 2 ? "med" : "low") as any, label: `Escalation L${e.level} — ${e.op_patients?.label ?? ""}`, note: e.summary, when: e.created_at })),
    ...patients.filter((a: any) => a.op_patients.acuity_level === "critical").map((a: any) => ({ sev: "high" as any, label: `${a.op_patients.label} — Critical acuity`, note: a.op_patients.op_beds?.label ?? null, when: null })),
    ...observations.filter((o: any) => o.status === "overdue").map((o: any) => ({ sev: "med" as any, label: `Observation overdue — ${o.op_patients?.label ?? ""}`, note: titleCase(o.observation_type), when: o.due_at })),
  ];
  const sevRank = { high: 0, med: 1, low: 2 };
  alertItems.sort((a, b) => sevRank[a.sev] - sevRank[b.sev]);

  const shiftName = shift?.shift_type ? titleCase(shift.shift_type) + (/(shift|call)/i.test(shift.shift_type) ? "" : " Shift") : null;

  return (
    <div className="space-y-5">
      {/* Header + shift context */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ward Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">Your shift, your patients and the ward around you — live operational data.</p>
        </div>
        {shift ? (
          <div className="flex items-center gap-3 bg-white border border-gray-200 rounded-xl px-4 py-2.5">
            <span className="text-lg">🗓️</span>
            <div className="leading-tight">
              <p className="text-sm font-semibold text-gray-800">{fmtDateLong(shift.shift_date)}</p>
              <p className="text-xs text-gray-500">
                {shiftName ?? "Shift"}{shift.starts_at ? ` · ${fmtTime(shift.starts_at)} – ${fmtTime(shift.ends_at)}` : ""}
                {shift.unit || shift.department ? ` · ${shift.unit ?? shift.department}` : ""}
              </p>
            </div>
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${onDuty ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>{onDuty ? "On Duty" : "Off Duty"}</span>
          </div>
        ) : (
          <Link href="/dashboard/shift" className="text-sm text-emerald-700 hover:underline self-center">Interactive shift view →</Link>
        )}
      </div>

      {!shift && (
        <div className={card}>
          <p className="font-semibold text-gray-800">You are not currently deployed on an active shift.</p>
          <p className="text-sm text-gray-500 mt-1">When your supervisor rosters you onto a shift in the Shift Operations Centre, your unit, supervisor and ward context appear here. Any patients or tasks already assigned to you are shown below.</p>
        </div>
      )}

      {/* KPI row — my own operational load */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard icon="🧑‍⚕️" title="My Patients" value={patients.length}
          sub={highAcuity > 0 ? <span className="text-orange-600 font-medium">{highAcuity} high/critical acuity</span> : "No high-acuity patients"} />
        <StatCard icon="✅" title="Open Tasks" value={tasks.length}
          sub={urgentTasks > 0 ? <span className="text-red-600 font-medium">{urgentTasks} urgent</span> : "None urgent"} />
        <StatCard icon="📈" title="Observations" value={obsDue + obsOverdue} tone={obsOverdue > 0 ? "text-orange-600" : undefined}
          sub={obsOverdue > 0 ? <span className="text-red-600 font-medium">{obsOverdue} overdue</span> : `${obsDue} due`} />
        <StatCard icon="🛡️" title="Active Alerts" value={safetyAlerts.length + escalations.length} tone={safetyAlerts.length + escalations.length > 0 ? "text-red-600" : undefined}
          sub={`${safetyAlerts.length} safety · ${escalations.length} escalations`} />
      </div>

      {/* Ward context — the unit around me (real census/beds/staffing) */}
      {ward && (
        <div className={card}>
          <div className="flex items-center gap-2 mb-3"><span className="text-lg">🏥</span><span className={label}>Ward Context — {shift?.unit ?? shift?.department ?? "My Unit"}</span></div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{ward.census}</p>
              <p className="text-xs text-gray-500">patients on the ward{ward.isolation > 0 ? ` · ${ward.isolation} in isolation` : ""}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-1">Acuity mix</p>
              <div className="flex flex-wrap gap-1">
                {(["critical", "high", "moderate", "stable"] as const).filter(k => ward.acuity[k] > 0).map(k => (
                  <span key={k} className="inline-flex items-center gap-1 text-[11px]"><AcuityChip level={k} /><span className="tabular-nums text-gray-600">{ward.acuity[k]}</span></span>
                ))}
                {Object.values(ward.acuity).every(v => v === 0) && <span className="text-xs text-gray-400">No admitted patients recorded</span>}
              </div>
            </div>
            <div>
              {ward.beds ? (
                <>
                  <p className="text-xl font-bold text-gray-900 tabular-nums">{ward.beds.occupied}<span className="text-sm text-gray-400 font-normal">/{ward.beds.total}</span></p>
                  <p className="text-xs text-gray-500">beds occupied</p>
                </>
              ) : <p className="text-xs text-gray-400">Bed register is department-level for this shift.</p>}
            </div>
            <div>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{ward.onDuty}<span className="text-sm text-gray-400 font-normal">/{ward.staff.length}</span></p>
              <p className="text-xs text-gray-500">staff on duty · {ward.staff.filter(x => x.role === "nurse").length} nurses{shift?.supervisor ? ` · supervisor ${shift.supervisor}` : ""}</p>
            </div>
          </div>
        </div>
      )}

      {/* My patients */}
      <SectionCard icon="👥" title="My Patient Assignment" count={patients.length}
        right={<Link href="/dashboard/shift" className="text-xs text-emerald-700 hover:underline">Record care →</Link>}>
        {patients.length === 0 ? (
          <Empty>No patients assigned. Your coordinator allocates patients in the Clinical Operations Centre.</Empty>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-1.5 pr-2 font-medium">Patient</th>
                  <th className="py-1.5 px-1 font-medium">Bed</th>
                  <th className="py-1.5 px-1 font-medium">Acuity</th>
                  <th className="py-1.5 px-1 font-medium">PEWS</th>
                  <th className="py-1.5 px-1 font-medium">Risk</th>
                  <th className="py-1.5 px-1 font-medium">Obs</th>
                  <th className="py-1.5 pl-1 font-medium">Flags</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((a: any) => {
                  const p = a.op_patients; const ews = latestEws(p.id); const due = dueObs(p.id); const al = patientAlerts(p.id);
                  return (
                    <tr key={p.id} className="border-b border-gray-50">
                      <td className="py-2 pr-2">
                        <span className="font-medium text-gray-800">{p.label}</span>
                        {a.assignment_type === "primary" && <span className="ml-1.5 text-[9px] text-emerald-600 uppercase">primary</span>}
                      </td>
                      <td className="py-2 px-1 text-gray-500">{p.op_beds?.label ?? "—"}</td>
                      <td className="py-2 px-1"><AcuityChip level={p.acuity_level} /></td>
                      <td className={`py-2 px-1 tabular-nums ${ewsColor(ews)}`}><EwsBadge score={ews} /></td>
                      <td className="py-2 px-1"><RiskChip level={p.risk_level} /></td>
                      <td className="py-2 px-1 text-xs">{due > 0 ? <span className="text-orange-600 font-medium">{due} due</span> : <span className="text-gray-300">—</span>}</td>
                      <td className="py-2 pl-1">
                        {p.isolation_status !== "none" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 mr-1">{titleCase(p.isolation_status)}</span>}
                        {al > 0 ? <span className="text-red-500" title={`${al} active safety alert${al === 1 ? "" : "s"}`}>●</span> : (p.isolation_status === "none" ? <span className="text-gray-300">—</span> : null)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="text-[10px] text-gray-400 mt-2">Age &amp; diagnosis live in the clinical record, not the operational roster. Use the interactive shift view to record observations, request assistance or report incidents.</p>
          </div>
        )}
      </SectionCard>

      {/* Alerts + tasks */}
      <div className="grid lg:grid-cols-2 gap-5">
        <SectionCard icon="⚠️" title="Priority Alerts" count={alertItems.length}>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {alertItems.length === 0 && <Empty>No active alerts for your patients.</Empty>}
            {alertItems.slice(0, 14).map((a, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className={`mt-1 w-2 h-2 rounded-full shrink-0 ${a.sev === "high" ? "bg-red-500" : a.sev === "med" ? "bg-amber-500" : "bg-gray-300"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-gray-700 leading-tight">{a.label}</p>
                  {a.note && <p className="text-[11px] text-gray-400 truncate">{a.note}</p>}
                </div>
                {a.when && <span className="text-[10px] text-gray-400 shrink-0">{fmtWhen(a.when)}</span>}
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard icon="✅" title="My Open Tasks" count={tasks.length}
          right={<Link href="/dashboard/shift" className="text-xs text-emerald-700 hover:underline">Work tasks →</Link>}>
          <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
            {tasks.length === 0 && <Empty>No open tasks. Tasks arrive from your supervisor, care plans and ward routines.</Empty>}
            {tasks.slice(0, 10).map((t: any) => (
              <div key={t.id} className="py-2 flex items-start gap-2 text-sm">
                <span className="text-xs text-gray-500 tabular-nums w-11 shrink-0 mt-0.5">{t.due_at ? fmtTime(t.due_at) : "--:--"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-800 leading-tight">{t.description}</p>
                  <p className="text-[11px] text-gray-400">{t.op_patients?.label ? `${t.op_patients.label} · ` : ""}{titleCase(t.status)}</p>
                </div>
                <PrioChip p={t.priority} />
              </div>
            ))}
          </div>
        </SectionCard>
      </div>

      <p className="text-center text-[11px] text-gray-400 pt-1">
        All data is live from the operational spine (shifts, assignments, observations, tasks, alerts). Assessment, medication, concerns and handover modules come online as they are built — muted entries in the sidebar are not yet live.
      </p>
    </div>
  );
}
