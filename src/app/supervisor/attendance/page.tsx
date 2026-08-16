import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadShiftAttendance } from "@/lib/operations/shift-attendance";
import { cardClass } from "@/components/ui/primitives";
import { KpiTileBare as Kpi } from "../_kit";
import { formatDateTime } from "@/lib/datetime";
import { estateRolesOf } from "@/lib/roles";

// Shift Attendance & Fatigue (SSW-WFM-001 / WFM-003) — the supervisor's lens
// over attendance for the shift they are actually running.
//
// The attendance stores (op_attendance_events / _exceptions, op_leave_records,
// op_replacement_requests, op_roster_actuals) are live and fully surfaced in the
// Unit Manager Workspace as a MONTHLY managerial view. Nothing read them
// shift-scoped, so a supervisor could not see who had actually clocked in for
// the shift in front of them. No new store — a new lens.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = cardClass;
const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const time = (t: string | null) => t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—";

// Attendance state -> how it reads on the board. "not_recorded" is deliberately
// neutral-but-visible: it means no clocking record exists, NOT that the person
// is absent.
const STATE: Record<string, { label: string; tone: string }> = {
  no_show:            { label: "No show",       tone: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" },
  absent:             { label: "Absent",        tone: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" },
  late:               { label: "Late",          tone: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" },
  not_recorded:       { label: "Not recorded",  tone: "bg-gray-100 text-gray-500" },
  on_duty_unverified: { label: "On duty (unverified)", tone: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" },
  on_duty:            { label: "On duty",       tone: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" },
  departed:           { label: "Departed",      tone: "bg-teal-50 text-teal-700" },
};
const SEV: Record<string, string> = {
  critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700",
  moderate: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", low: "bg-gray-100 text-gray-600",
  informational: "bg-gray-100 text-gray-500",
};
const PRIORITY: Record<string, string> = {
  critical: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", high: "bg-[var(--cmp-surface-warning)] text-orange-700",
  normal: "bg-gray-100 text-gray-600", low: "bg-gray-100 text-gray-500",
};

export default async function ShiftAttendancePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  const d: any = await loadShiftAttendance(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  if (!d.provisioned) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Shift Attendance & Fatigue</h1>
        <div className={card}>
          <p className="text-sm text-gray-600">The attendance store (<code className="text-[11px] bg-gray-50 px-1 rounded">op_attendance_events</code>) is not provisioned on this database, so there is nothing to show. No figures are estimated in its place.</p>
        </div>
      </div>
    );
  }
  if (d.empty) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">Shift Attendance & Fatigue</h1>
        <div className={card}>
          <p className="text-sm text-gray-600">No shift has been recorded in the last 7 days, so there is no roster to check attendance against.</p>
          <Link href="/supervisor/shift-activation" className="mt-3 inline-block text-sm font-medium text-teal-700 hover:underline">Plan &amp; activate a shift →</Link>
        </div>
      </div>
    );
  }

  const k = d.kpis;
  const s = d.shift;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Shift Attendance &amp; Fatigue</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {titleCase(s.type)} shift · {s.date}{s.unit ? ` · ${s.unit}` : ""} ·{" "}
            <span className={s.status === "active" ? "text-[var(--cmp-text-success)] font-medium" : "text-gray-500"}>{titleCase(s.status)}</span>
            {s.startsAt ? ` · ${time(s.startsAt)}–${time(s.endsAt)}` : ""}
          </p>
        </div>
        <Link href="/supervisor/workforce-operations" className="text-sm font-medium text-teal-700 hover:underline">Staffing allocation →</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Rostered" value={k.rostered} sub="staff on this shift" />
        <Kpi label="Clock-in verified" value={`${k.verification}%`} tone={k.verification >= 90 ? "text-[var(--cmp-text-success)]" : k.verification >= 70 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-critical)]"} sub={`${k.verified} of ${k.rostered}`} />
        <Kpi label="Late" value={k.late} tone={k.late ? "text-[var(--cmp-text-warning)]" : undefined} />
        <Kpi label="Absent" value={k.absent} tone={k.absent ? "text-[var(--cmp-text-error)]" : undefined} />
        <Kpi label="No show" value={k.noShow} tone={k.noShow ? "text-[var(--cmp-text-critical)]" : undefined} />
        <Kpi label="Uncovered" value={k.uncovered} tone={k.uncovered ? "text-[var(--cmp-text-critical)]" : undefined} sub="posts awaiting cover" />
        <Kpi label="Fatigue flags" value={k.fatigueFlagged} tone={k.fatigueFlagged ? "text-[var(--cmp-text-warning)]" : undefined} sub="on this shift" />
      </div>

      {k.notRecorded > 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <p className="text-sm text-gray-700">
            <span className="font-semibold">{k.notRecorded}</span> rostered {k.notRecorded === 1 ? "person has" : "people have"} no clock-in record for this shift.
            That is an unknown, not an absence — they may be on duty without having clocked in. The verification figure above counts only recorded check-ins.
          </p>
        </div>
      )}

      {/* ── Roster board ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-3">Roster Board <span className="text-gray-400 font-normal">· expected staff vs the attendance record</span></h2>
        {d.roster.length === 0 ? (
          <p className="text-sm text-gray-500">No staff are rostered onto this shift.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left border-b border-gray-100">
                <th className={`${label} pb-2`}>Staff</th>
                <th className={`${label} pb-2`}>Role</th>
                <th className={`${label} pb-2`}>State</th>
                <th className={`${label} pb-2`}>Clock in</th>
                <th className={`${label} pb-2`}>Clock out</th>
                <th className={`${label} pb-2`}>Method</th>
                <th className={`${label} pb-2`}>Notes</th>
              </tr></thead>
              <tbody>
                {d.roster.map((r: any) => (
                  <tr key={r.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2 text-gray-900 font-medium">{r.name}</td>
                    <td className="py-2 text-gray-500 text-xs">{titleCase(r.role)}</td>
                    <td className="py-2">
                      <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${STATE[r.state]?.tone ?? "bg-gray-100 text-gray-600"}`}>{STATE[r.state]?.label ?? titleCase(r.state)}</span>
                    </td>
                    <td className="py-2 text-gray-600 tabular-nums text-xs">
                      {time(r.checkInAt)}
                      {r.minutesLate ? <span className="text-[var(--cmp-text-warning)] ml-1">+{r.minutesLate}m</span> : null}
                    </td>
                    <td className="py-2 text-gray-600 tabular-nums text-xs">{time(r.checkOutAt)}</td>
                    <td className="py-2 text-gray-400 text-xs">{r.checkInMethod ? titleCase(r.checkInMethod) : "—"}</td>
                    <td className="py-2 text-gray-500 text-xs">
                      {r.absenceType ? <span className="text-[var(--cmp-text-error)]">{titleCase(r.absenceType)}</span> : null}
                      {r.replacementRequired ? <span className="ml-1 text-[10px] bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] rounded px-1">cover needed</span> : null}
                      {r.exceptions > 0 ? <span className="ml-1 text-[10px] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] rounded px-1">{r.exceptions} exception{r.exceptions === 1 ? "" : "s"}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── Fatigue exposure ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-1">Fatigue Exposure <span className="text-gray-400 font-normal">· trailing 7 days</span></h2>
          <p className="text-[11px] text-gray-400 mb-3">
            Computed from ROSTERED shifts, against the same thresholds the roster-governance rules use:
            {" "}{d.thresholds.consecutiveDays}+ consecutive days, {d.thresholds.weekHours}h+ per week, under {d.thresholds.restHours}h between shifts.
            This is exposure, not a judgement about any individual.
          </p>
          {d.fatigue.length === 0 ? (
            <p className="text-sm text-gray-500">No staff cross a fatigue threshold this week.</p>
          ) : (
            <ul className="space-y-2">
              {d.fatigue.slice(0, 10).map((f: any) => (
                <li key={f.staffId} className="flex items-start gap-2">
                  <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${f.onShift ? "bg-[var(--cmp-color-warning)]" : "bg-gray-300"}`} />
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">
                      {f.name}
                      {f.onShift && <span className="ml-1.5 text-[10px] font-semibold bg-[var(--cmp-surface-warning)] text-orange-700 rounded px-1">on this shift</span>}
                    </p>
                    <p className="text-[11px] text-gray-500">{f.flags.join(" · ")}</p>
                    <p className="text-[10px] text-gray-400">
                      {f.shifts} shifts over {f.days} days
                      {f.hours != null ? ` · ${f.hours}h rostered${f.hoursPartial ? " (some shifts have no start/end time recorded)" : ""}` : " · hours not recorded on these shifts"}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Open attendance exceptions ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">
            Open Attendance Exceptions
            {k.criticalExceptions > 0 && <span className="ml-2 text-[10px] font-semibold bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] rounded px-1.5 py-0.5">{k.criticalExceptions} critical/high</span>}
          </h2>
          {d.exceptions.length === 0 ? (
            <p className="text-sm text-gray-500">No unresolved attendance exceptions.</p>
          ) : (
            <ul className="space-y-2">
              {d.exceptions.map((e: any) => (
                <li key={e.id} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start gap-2">
                    <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${SEV[e.severity] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(e.severity)}</span>
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">{titleCase(e.category)}{e.staff_name ? ` · ${e.staff_name}` : ""}</p>
                      {e.rule_breached && <p className="text-[11px] text-gray-500">{e.rule_breached}</p>}
                      {e.operational_impact && <p className="text-[11px] text-gray-500">{e.operational_impact}</p>}
                      <p className="text-[10px] text-gray-400">{titleCase(e.status)} · detected {formatDateTime(e.detected_at)}</p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* ── Cover / replacement pipeline ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Cover Requests <span className="text-gray-400 font-normal">· posts not yet filled</span></h2>
          {d.replacements.length === 0 ? (
            <p className="text-sm text-gray-500">No open replacement or redeployment requests.</p>
          ) : (
            <ul className="space-y-2">
              {d.replacements.map((r: any) => (
                <li key={r.id} className="flex items-start gap-2 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${PRIORITY[r.priority] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(r.priority)}</span>
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">
                      {r.quantity > 1 ? `${r.quantity} × ` : ""}{titleCase(r.role) || "Staff"}
                      {r.is_redeployment && <span className="ml-1.5 text-[10px] bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)] rounded px-1">redeployment</span>}
                    </p>
                    {r.reason && <p className="text-[11px] text-gray-500">{r.reason}</p>}
                    <p className="text-[10px] text-gray-400">
                      {titleCase(r.status)}
                      {r.selected_staff_name ? ` · offered to ${r.selected_staff_name}` : ""}
                      {r.offer_expires_at ? ` · offer expires ${formatDateTime(r.offer_expires_at)}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── Absence & leave affecting the shift ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Absence &amp; Leave <span className="text-gray-400 font-normal">· recorded around this shift</span></h2>
          {d.leave.length === 0 ? (
            <p className="text-sm text-gray-500">No absence or leave records touch this shift.</p>
          ) : (
            <ul className="space-y-2">
              {d.leave.slice(0, 12).map((l: any) => (
                <li key={l.id} className="flex items-start justify-between gap-2 border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">{l.staff_name ?? "Staff"} · <span className="text-gray-500">{titleCase(l.absence_type)}</span></p>
                    <p className="text-[10px] text-gray-400">
                      {l.absence_date}
                      {l.expected_return ? ` · expected back ${l.expected_return}` : ""}
                      {l.replacement_required ? " · replacement required" : ""}
                    </p>
                    {l.operational_impact && <p className="text-[11px] text-gray-500">{l.operational_impact}</p>}
                  </div>
                  <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${l.leave_approval_status === "approved" ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]" : l.leave_approval_status === "rejected" ? "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]" : "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>{titleCase(l.leave_approval_status)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* ── Planned vs actual ── */}
      {d.variance && (
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-1">Planned vs Actual <span className="text-gray-400 font-normal">· confirmed roster actuals, last 7 days</span></h2>
          <p className="text-[11px] text-gray-400 mb-3">From <code className="text-[10px] bg-gray-50 px-1 rounded">op_roster_actuals</code> — only shifts a manager has confirmed appear here, so this trails live attendance above.</p>
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <p className={`text-2xl font-bold tabular-nums ${d.variance.adherence >= 90 ? "text-[var(--cmp-text-success)]" : d.variance.adherence >= 75 ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-critical)]"}`}>{d.variance.adherence}%</p>
              <p className="text-xs text-gray-500">attended as rostered</p>
              <p className="text-[10px] text-gray-400">{d.variance.attended} of {d.variance.total} confirmed</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {d.variance.byStatus.map((b: any) => (
                <span key={b.status} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">
                  {titleCase(b.status)} <span className="font-semibold tabular-nums">{b.n}</span>
                </span>
              ))}
              {d.variance.byStatus.length === 0 && <span className="text-sm text-gray-500">No variances recorded.</span>}
            </div>
          </div>
        </div>
      )}

      <p className="text-[11px] text-gray-400 pb-4">
        Shift Attendance &amp; Fatigue (SSW-WFM-001 / WFM-003) reads the live attendance record — clock events, exceptions,
        leave, cover requests and confirmed roster actuals — scoped to the shift you are running. The Unit Manager Workspace
        owns the monthly view of the same stores; this is the operational one. Fatigue is derived from rostered shifts, so
        where a shift has no start/end time recorded it counts toward consecutive days but not toward hours, and says so.
      </p>
    </div>
  );
}
