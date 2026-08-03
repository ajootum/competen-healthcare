import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";

// CPR-V2-001 V3 Practice Command Centre -- the default authorised landing (SHELL-001 s8).
//
// EVERY NUMBER ON THIS PAGE IS A REAL QUERY AGAINST THE CALLER'S OWN WORKSPACE, and the widgets whose
// engines have not shipped SAY WHICH PHASE BRINGS THEM instead of rendering fake zeros dressed as
// activity. CPR-V2-001 V3 specifies Today's Activity, Patient Actions, Practice Metrics, Intelligence and
// Recent Activity; today the truthful subset is workspace status, entitlement, locations, team and the
// audit trail -- which is real recent activity, because provisioning and onboarding wrote it.

/* eslint-disable @typescript-eslint/no-explicit-any */

export const dynamic = "force-dynamic";

export default async function PracticeHome() {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  const { ctx } = shell;
  const admin = createAdminClient();

  const todayIso = new Date().toISOString().slice(0, 10);
  const [{ count: locations }, { count: members }, { data: entitlement }, { data: events }, { data: todaysAppointments }, { count: waiting }, { data: openEncounters }] = await Promise.all([
    admin.from("practice_location").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("active", true),
    admin.from("practice_membership").select("*", { count: "exact", head: true }).eq("workspace_id", ctx.workspaceId).eq("status", "active"),
    admin.from("practice_entitlement").select("plan_code, status, ends_at").eq("workspace_id", ctx.workspaceId).in("status", ["active", "trial"]).limit(1).maybeSingle(),
    admin.from("practice_audit_event").select("event_type, occurred_at").eq("workspace_id", ctx.workspaceId).order("occurred_at", { ascending: false }).limit(8),
    admin.from("practice_appointment").select("id, patient_name, scheduled_at, appointment_type, status")
      .eq("workspace_id", ctx.workspaceId).gte("scheduled_at", `${todayIso}T00:00:00.000Z`).lte("scheduled_at", `${todayIso}T23:59:59.999Z`)
      .order("scheduled_at").limit(10),
    admin.from("practice_queue_entry").select("*", { count: "exact", head: true })
      .eq("workspace_id", ctx.workspaceId).in("status", ["WAITING", "READY", "IN_CONSULTATION", "PAUSED"]),
    // Open and completed-but-unsigned encounters: the work in front of the practitioner right now.
    // COMPLETED is included deliberately -- an unsigned record is unfinished business, not history.
    admin.from("practice_encounter").select("id, patient_id, status, reason_for_visit, started_at")
      .eq("workspace_id", ctx.workspaceId).in("status", ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"])
      .order("started_at", { ascending: false }).limit(8),
  ]);

  const encRows = (openEncounters ?? []) as any[];
  const encPatientIds = [...new Set(encRows.map(e => e.patient_id))];
  const { data: encPatients } = encPatientIds.length
    ? await admin.from("practice_patient").select("id, display_name").in("id", encPatientIds)
    : { data: [] };
  const encName = new Map(((encPatients ?? []) as any[]).map(p => [p.id, p.display_name]));

  // Request-time is the CORRECT time here: this is a force-dynamic server component, rendered once per
  // request, and "days left on the trial" is a fact about now. The impure-render rule exists for client
  // components that re-render; a per-request server render is exactly the place a clock read belongs.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const trialDaysLeft = entitlement?.ends_at
    ? Math.max(0, Math.ceil((new Date(entitlement.ends_at).getTime() - now) / 86400000))
    : null;

  const metrics = [
    { label: "Practice locations", value: String(locations ?? 0) },
    { label: "Team members", value: String(members ?? 0) },
    { label: "Plan", value: entitlement?.status === "trial" ? `Trial${trialDaysLeft !== null ? ` · ${trialDaysLeft}d left` : ""}` : (entitlement?.plan_code ?? "—") },
    { label: "Workspace", value: ctx.workspaceStatus },
  ];

  // The clinical widgets still to come, named honestly by the phase that ships them (CPR-BUILD-000).
  // Entries leave this list as their phase ships: today's appointments went with Phase 1, patient
  // actions with Phase 2, and open encounters with Phase 3 -- each now renders below from real rows.
  const upcoming = [
    { title: "Follow-ups due", phase: "Phase 4 — Continuity" },
    { title: "Practice intelligence", phase: "Phase 5 — Case memory" },
  ];

  return (
    <div className="max-w-5xl">
      <h1 className="text-xl font-bold text-gray-900">Practice Command Centre</h1>
      <p className="mt-1 text-[13px] text-gray-500">
        Your workspace is provisioned and active. The clinical workspaces light up here phase by phase.
      </p>

      {/* Practice metrics -- real counts from this workspace's rows */}
      <div className="mt-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map(m => (
          <div key={m.label} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{m.label}</p>
            <p className="mt-1 text-lg font-bold text-gray-900">{m.value}</p>
          </div>
        ))}
      </div>

      {/* Today's activity (CPR-V2-001 V3) -- live from practice_appointment since Phase 1 */}
      <section className="mt-5 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-bold text-gray-900">Today&apos;s appointments</h2>
          <Link href="/practice/calendar" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">Open calendar →</Link>
        </div>
        {((todaysAppointments ?? []) as any[]).length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">Nothing booked today. Book from the calendar.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {((todaysAppointments ?? []) as any[]).map(a => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="font-mono text-gray-500">{new Date(a.scheduled_at).toISOString().slice(11, 16)}</span>
                <span className="font-semibold text-gray-800">{a.patient_name}</span>
                <span className="text-gray-400">{String(a.appointment_type).replace(/_/g, " ")}</span>
                <span className="ml-auto text-gray-500">{a.status}</span>
              </li>
            ))}
          </ul>
        )}
        {(waiting ?? 0) > 0 && (
          <p className="mt-2 text-[11px] font-semibold text-[var(--cmp-text-warning)]">
            {waiting} in the waiting queue right now.
          </p>
        )}
      </section>

      {/* Open encounters (CPR-V2-001 V3 "Patient Actions") -- live from practice_encounter since Phase 3 */}
      <section className="mt-4 rounded-xl border border-gray-200 bg-white p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-bold text-gray-900">Encounters needing you</h2>
          <Link href="/practice/encounters" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">All encounters →</Link>
        </div>
        {encRows.length === 0 ? (
          <p className="mt-2 text-[12px] text-gray-400">
            Nothing open or awaiting signature. Start one from a patient record or a checked-in appointment.
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1">
            {encRows.map(e => (
              <li key={e.id} className="flex items-center gap-2 text-[12px]">
                <Link href={`/practice/encounters/${e.id}`} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  {encName.get(e.patient_id) ?? "Unknown patient"}
                </Link>
                {e.reason_for_visit && <span className="text-gray-500 truncate">{e.reason_for_visit}</span>}
                <span className="ml-auto font-mono text-gray-400">{String(e.started_at).slice(0, 10)}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${e.status === "COMPLETED" ? "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]" : "bg-gray-100 text-gray-600"}`}>
                  {e.status === "COMPLETED" ? "UNSIGNED" : e.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-5 grid lg:grid-cols-2 gap-4">
        {/* Recent activity -- the audit trail is real from the first provisioning event */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Recent activity</h2>
          {((events ?? []) as any[]).length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-400">No activity recorded yet.</p>
          ) : (
            <ul className="mt-2 flex flex-col gap-1.5">
              {((events ?? []) as any[]).map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="text-gray-700 font-mono truncate">{e.event_type}</span>
                  <span className="text-gray-400 shrink-0" suppressHydrationWarning>
                    {new Date(e.occurred_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* What arrives next -- honest, phase-labelled, not disabled buttons pretending to be features */}
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <h2 className="text-[13px] font-bold text-gray-900">Arriving on this dashboard</h2>
          <p className="mt-1 text-[11px] text-gray-400">
            These CPR-V2-001 widgets render only when their engines ship. Nothing here fakes a zero.
          </p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {upcoming.map(u => (
              <li key={u.title} className="flex items-baseline justify-between gap-3 text-[12px]">
                <span className="text-gray-700">{u.title}</span>
                <span className="text-gray-400 shrink-0">{u.phase}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
