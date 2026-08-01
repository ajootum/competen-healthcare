import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { loadMdt, MDT_SERVICES, MEETING_TYPES, DECISION_CATEGORIES } from "@/lib/operations/mdt";
import { MeetingControls, AttendanceRow, ActionControls, ReferralControls, DecisionCapture } from "./MdtActions";
import { cardClass } from "@/components/ui/primitives";
import { KpiTileBare as Kpi } from "../_kit";

// Multidisciplinary Team (MDT) Coordination (SSW-CCR-005, migration 160).
//
// The last genuinely unbacked SSW module — every other supervisor surface is a lens over stores that already
// existed, so this one sat in the sidebar as a muted "soon" entry rather than a fabricated page.
//
// Honesty rules this page holds to:
//   - Attendance is a status on an INVITATION. A meeting with no invitation list reports "not recorded",
//     never 0% — a missing record is an unknown, not an absence.
//   - Quorum is measured against that meeting's REQUIRED participants, and is null when none were marked.
//   - The AI case summary field is persisted but nothing generates it yet; meetings without one say so.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

const card = cardClass;
const titleCase = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ").replace(/\b\w/g, ch => ch.toUpperCase());
const when = (t: string | null) => t ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const serviceLabel = (k: string) => MDT_SERVICES.find(s => s.key === k)?.label ?? titleCase(k);
const typeLabel = (k: string) => MEETING_TYPES.find(t => t.key === k)?.label ?? titleCase(k);

const STATUS_TONE: Record<string, string> = {
  scheduled: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", in_progress: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]",
  completed: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", cancelled: "bg-gray-100 text-gray-500",
  no_quorum: "bg-[var(--cmp-surface-warning)] text-orange-700",
};
const PRI_TONE: Record<string, string> = {
  immediate: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", urgent: "bg-[var(--cmp-surface-warning)] text-orange-700",
  this_week: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", routine: "bg-gray-100 text-gray-600",
};
const ATT_TONE: Record<string, string> = {
  attended: "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]", delegated: "bg-teal-100 text-teal-700",
  confirmed: "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]", invited: "bg-gray-100 text-gray-500",
  apologies: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", absent: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]",
};

function MeetingCard({ m, capture }: { m: any; capture?: boolean }) {
  return (
    <div className="border border-gray-100 rounded-lg p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900">{m.title}</p>
          <p className="text-[11px] text-gray-500">
            {typeLabel(m.meeting_type)} · {when(m.scheduled_at)}
            {m.location ? ` · ${m.location}` : ""}
            {m.duration_min ? ` · ${m.duration_min} min` : ""}
          </p>
          <p className="text-[11px] text-gray-500">
            {m.patientLabel ? <>Patient <span className="text-gray-700">{m.patientLabel}</span>{m.bed ? ` · bed ${m.bed}` : ""}</> : "No single patient"}
            {m.unit ? ` · ${m.unit}` : ""}
            {m.chair ? ` · chaired by ${m.chair}` : ""}
          </p>
        </div>
        <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 shrink-0 ${STATUS_TONE[m.status] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(m.status)}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2">
        <span className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">
          {m.invited === 0 ? "Attendance not recorded" : `${m.attended}/${m.invited} attended`}
        </span>
        {m.quorum.met !== null && (
          <span className={`text-[10px] rounded px-1.5 py-0.5 border ${m.quorum.met ? "bg-[var(--cmp-surface-success)] border-[var(--cmp-color-success)] text-[var(--cmp-text-success)]" : "bg-[var(--cmp-surface-warning)] border-[var(--cmp-color-warning)] text-orange-700"}`}>
            Quorum {m.quorum.present}/{m.quorum.required} required
          </span>
        )}
        {m.decisions.length > 0 && <span className="text-[10px] text-gray-600 bg-gray-50 border border-gray-100 rounded px-1.5 py-0.5">{m.decisions.length} decision{m.decisions.length === 1 ? "" : "s"}</span>}
        {m.openActions > 0 && <span className="text-[10px] text-[var(--cmp-text-warning)] bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded px-1.5 py-0.5">{m.openActions} open action{m.openActions === 1 ? "" : "s"}</span>}
        {m.overdueActions > 0 && <span className="text-[10px] text-[var(--cmp-text-critical)] bg-[var(--cmp-surface-critical)] border border-[var(--cmp-color-critical)] rounded px-1.5 py-0.5">{m.overdueActions} overdue</span>}
        {m.signedOff > 0 && <span className="text-[10px] text-teal-700 bg-teal-50 border border-teal-100 rounded px-1.5 py-0.5">{m.signedOff} signed off</span>}
      </div>

      {m.participants.length > 0 && (
        <div className="mt-2 space-y-1">
          {m.participants.map((p: any) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-50 pt-1">
              <span className="text-[11px] text-gray-700">
                {serviceLabel(p.service)}
                {p.profiles?.full_name || p.participant_name ? <span className="text-gray-400"> · {p.profiles?.full_name ?? p.participant_name}</span> : null}
                {p.required && <span className="ml-1 text-[9px] text-gray-400 uppercase tracking-wider">required</span>}
                {p.delegated_to && <span className="ml-1 text-[10px] text-teal-600">→ {p.delegated_to}</span>}
                {p.signed_off && <span className="ml-1 text-[10px] text-teal-700">✓ signed</span>}
              </span>
              <span className="flex items-center gap-1.5">
                <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${ATT_TONE[p.attendance] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(p.attendance)}</span>
                {["scheduled", "in_progress"].includes(m.status) && <AttendanceRow participant={p} />}
              </span>
            </div>
          ))}
        </div>
      )}

      {m.decisions.length > 0 && (
        <ul className="mt-2 space-y-1">
          {m.decisions.map((d: any) => (
            <li key={d.id} className="border-t border-gray-50 pt-1">
              <p className="text-[11px] text-gray-800">
                <span className="text-[9px] uppercase tracking-wider text-gray-400 mr-1">{titleCase(d.category)}</span>
                {d.decision}
              </p>
              {d.rationale && <p className="text-[10px] text-gray-500">{d.rationale}</p>}
            </li>
          ))}
        </ul>
      )}

      {m.status === "completed" && !m.summary && !m.ai_summary && (
        <p className="text-[10px] text-gray-400 mt-2">No summary was recorded for this meeting. Nothing is generated in its place.</p>
      )}
      {m.summary && <p className="text-[11px] text-gray-600 mt-2 border-t border-gray-50 pt-1">{m.summary}</p>}

      <MeetingControls meeting={m} />
      {capture && ["scheduled", "in_progress"].includes(m.status) && (
        <DecisionCapture meetingId={m.id} categories={DECISION_CATEGORIES} />
      )}
    </div>
  );
}

export default async function MdtPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient();
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some(r => ["assessor", "hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");

  const d: any = await loadMdt(admin, profile?.hospital_id ?? null, roles.includes("super_admin"));

  if (!d.provisioned) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold text-gray-900">MDT Coordination</h1>
        <div className={card}>
          <p className="text-sm text-gray-600">
            The MDT stores are not provisioned on this database, so there is nothing to show. Apply migration{" "}
            <code className="text-[11px] bg-gray-50 px-1 rounded">160-mdt-coordination.sql</code> to enable multidisciplinary
            coordination. No figures are estimated in its place.
          </p>
        </div>
      </div>
    );
  }

  const k = d.kpis;
  const empty = d.counts.meetings === 0 && d.counts.referrals === 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">MDT Coordination</h1>
          <p className="text-sm text-gray-500 mt-0.5">Multidisciplinary review, decisions and the actions arising from them.</p>
        </div>
        <Link href="/supervisor/escalations" className="text-sm font-medium text-teal-700 hover:underline">Escalation Centre →</Link>
      </div>

      {empty && (
        <div className={card}>
          <p className="text-sm text-gray-600">
            No MDT referrals or meetings have been recorded yet. The register fills as clinicians flag patients
            needing multidisciplinary input — nurses can raise a referral from the bedside, and supervisors
            schedule the meeting from the Complex Case Register below.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <Kpi label="Meetings today" value={k.todayMeetings} sub={`${k.todayCompleted} completed`} />
        <Kpi label="Awaiting review" value={k.awaitingReview} tone={k.awaitingOverdue ? "text-[var(--cmp-text-critical)]" : undefined}
          sub={k.awaitingOverdue ? `${k.awaitingOverdue} past target` : "complex case register"} />
        <Kpi label="Open actions" value={k.openActions} tone={k.overdueActions ? "text-[var(--cmp-text-warning)]" : undefined}
          sub={k.overdueActions ? `${k.overdueActions} overdue` : "none overdue"} />
        <Kpi label="Action completion" value={k.completionRate == null ? "—" : `${k.completionRate}%`}
          tone={k.completionRate != null && k.completionRate < 70 ? "text-[var(--cmp-text-warning)]" : undefined}
          sub={k.completionRate == null ? "no actions raised" : "of actions raised"} />
        <Kpi label="Attendance" value={k.attendanceRate == null ? "—" : `${k.attendanceRate}%`}
          sub={k.attendanceRate == null ? "not recorded" : "of invitations"} />
        <Kpi label="Family meetings" value={k.familyMeetings} sub="scheduled or in progress" />
        <Kpi label="Escalated cases" value={k.escalatedCases} tone={k.escalatedCases ? "text-[var(--cmp-text-warning)]" : undefined}
          sub="highly complex / immediate" />
      </div>

      {d.signals.length > 0 && (
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-2">Coordination Signals</h2>
          <ul className="space-y-1.5">
            {d.signals.map((s: any, i: number) => (
              <li key={i} className="flex items-start gap-2">
                <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${s.severity === "high" ? "bg-[var(--cmp-color-critical)]" : "bg-[var(--cmp-color-warning)]"}`} />
                <span className="text-sm text-gray-700">{s.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Complex Case Register ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-1">Complex Case Register <span className="text-gray-400 font-normal">· patients awaiting MDT review</span></h2>
        <p className="text-[11px] text-gray-400 mb-3">Ordered by priority, then by how long each has waited. Targets: immediate 4h, urgent 24h, this week 7d, routine 14d.</p>
        {d.awaiting.length === 0 ? (
          <p className="text-sm text-gray-500">No patients are awaiting MDT review.</p>
        ) : (
          <ul className="space-y-3">
            {d.awaiting.map((r: any) => (
              <li key={r.id} className="border-b border-gray-50 last:border-0 pb-3 last:pb-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-900">
                      <span className="font-medium">{r.op_patients?.label ?? "Patient"}</span>
                      {r.op_patients?.op_beds?.label ? <span className="text-gray-400"> · bed {r.op_patients.op_beds.label}</span> : null}
                      {r.complexity !== "standard" && <span className="ml-1.5 text-[10px] font-semibold bg-[var(--cmp-surface-warning)] text-orange-700 rounded px-1">{titleCase(r.complexity)}</span>}
                    </p>
                    <p className="text-[11px] text-gray-600">{r.reason}</p>
                    <p className="text-[10px] text-gray-400">
                      Raised {when(r.raised_at)}
                      {r.raiser?.full_name || r.raised_by_name ? ` by ${r.raiser?.full_name ?? r.raised_by_name}` : ""}
                      {r.waitingHours != null ? ` · waiting ${r.waitingHours}h` : ""}
                    </p>
                    {(r.services_requested ?? []).length > 0 && (
                      <p className="text-[10px] text-gray-500 mt-0.5">Requested: {r.services_requested.map((s: string) => serviceLabel(s)).join(", ")}</p>
                    )}
                  </div>
                  <span className="flex items-center gap-1.5 shrink-0">
                    {r.overdue && <span className="text-[10px] font-semibold bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] rounded px-1.5 py-0.5">Overdue</span>}
                    <span className={`text-[10px] font-semibold rounded px-1.5 py-0.5 ${PRI_TONE[r.priority] ?? "bg-gray-100 text-gray-600"}`}>{titleCase(r.priority)}</span>
                  </span>
                </div>
                <div className="mt-1.5"><ReferralControls referral={r} meetingTypes={MEETING_TYPES} /></div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Today's meetings ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Today&apos;s MDT Meetings</h2>
          {d.today.length === 0 ? (
            <p className="text-sm text-gray-500">No MDT meetings are scheduled for today.</p>
          ) : (
            <div className="space-y-3">{d.today.map((m: any) => <MeetingCard key={m.id} m={m} capture />)}</div>
          )}
        </div>

        {/* ── Action tracker ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-1">MDT Action Tracker</h2>
          <p className="text-[11px] text-gray-400 mb-3">Overdue first, then by due date. Actions with no due date sort last.</p>
          {d.openActions.length === 0 ? (
            <p className="text-sm text-gray-500">No open MDT actions.</p>
          ) : (
            <ul className="space-y-2">
              {d.openActions.map((a: any) => (
                <li key={a.id} className="border-b border-gray-50 last:border-0 pb-2 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-900">{a.action}</p>
                      <p className="text-[10px] text-gray-400">
                        {a.patientLabel ? `${a.patientLabel} · ` : ""}
                        {a.ownerName ? `${a.ownerName}` : "unassigned"}
                        {a.service ? ` · ${serviceLabel(a.service)}` : ""}
                        {a.due_at ? ` · due ${when(a.due_at)}` : " · no due date"}
                      </p>
                      {a.outcome_note && <p className="text-[10px] text-gray-500">{a.outcome_note}</p>}
                    </div>
                    <span className="flex items-center gap-1 shrink-0">
                      {a.overdue && <span className="text-[10px] font-semibold bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)] rounded px-1.5 py-0.5">Overdue</span>}
                      <span className="text-[10px] font-semibold bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">{titleCase(a.status)}</span>
                    </span>
                  </div>
                  <div className="mt-1"><ActionControls action={a} /></div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* ── Upcoming + family conferences ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Upcoming Meetings</h2>
          {d.upcoming.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing scheduled ahead.</p>
          ) : (
            <div className="space-y-3">{d.upcoming.map((m: any) => <MeetingCard key={m.id} m={m} />)}</div>
          )}
        </div>

        {/* ── Attendance by service ── */}
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-1">Attendance by Service</h2>
          <p className="text-[11px] text-gray-400 mb-3">Across meetings that recorded an invitation list. Services never invited do not appear.</p>
          {d.byService.length === 0 ? (
            <p className="text-sm text-gray-500">No participant invitations have been recorded, so attendance cannot be reported.</p>
          ) : (
            <ul className="space-y-2">
              {d.byService.map((s: any) => (
                <li key={s.service}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-gray-700">{s.label}</span>
                    <span className="text-gray-500 tabular-nums">{s.attended}/{s.invited} · {s.rate}%</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${(s.rate ?? 0) >= 80 ? "bg-teal-500" : (s.rate ?? 0) >= 50 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-critical)]"}`}
                      style={{ width: `${s.rate ?? 0}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {d.themes.length > 0 && (
            <>
              <h3 className="text-xs font-bold text-gray-900 mt-4 mb-2">Recurring Decision Themes</h3>
              <div className="flex flex-wrap gap-1.5">
                {d.themes.map((t: any) => (
                  <span key={t.category} className="text-[11px] text-gray-600 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1">
                    {titleCase(t.category)} <span className="font-semibold tabular-nums">{t.n}</span>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {d.recent.length > 0 && (
        <div className={card}>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Recently Completed</h2>
          <div className="grid md:grid-cols-2 gap-3">{d.recent.map((m: any) => <MeetingCard key={m.id} m={m} />)}</div>
        </div>
      )}

      {/* ── What this module does not do ── */}
      <div className={card}>
        <h2 className="text-sm font-bold text-gray-900 mb-2">Not generated by this module</h2>
        <ul className="space-y-1.5 text-[11px] text-gray-600">
          <li>
            <span className="font-medium text-gray-700">AI case summaries.</span> The spec calls for a generated
            patient summary presented at the meeting. The field is persisted and displayed when populated, but
            nothing writes it yet — meetings without one say so rather than showing invented text.
          </li>
          <li>
            <span className="font-medium text-gray-700">Discharge-readiness prediction.</span> Needs a modelled
            length-of-stay signal; <code className="bg-gray-50 px-1 rounded">op_patients</code> has no admission
            timestamp, so no prediction is offered.
          </li>
          <li>
            <span className="font-medium text-gray-700">Participant recommendation.</span> Services shown are the
            ones a clinician requested on the referral or a supervisor invited — never suggested by the system.
          </li>
        </ul>
      </div>

      <p className="text-[11px] text-gray-400 pb-4">
        MDT Coordination (SSW-CCR-005) covers the complex case register, meeting scheduling, participant and
        attendance management with digital sign-off, decision capture and the action tracker; family conferences
        are the same object with a <code className="bg-gray-50 px-1 rounded">family_conference</code> type.
        Attendance is a status on an invitation, so a meeting that recorded no invitation list reports
        &quot;not recorded&quot; rather than 0% — a missing record is an unknown, not an absence.
      </p>
    </div>
  );
}
