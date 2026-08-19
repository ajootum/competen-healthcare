import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadOpenIncidents } from "@/lib/hq/mos-incident";
import { loadCases, loadEscalations } from "@/lib/hq/mos-support";
import { loadSubjects } from "@/lib/hq/mos-subject";
import {
  SupportHeader, Panel, EmptyOrUnreadable, Explain, Cite, ReadFailures,
} from "../_components/support-ui";

// CPR-PD-009 §10 — AFFECTED PRACTICES.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS IS DERIVED, AND IT SAYS SO. There is no "affected practice" record and §10 does not ask for
// one — a practice is affected because an incident names it as its subject or a case was raised from
// it. So the list is assembled at read time from those two facts. It is therefore a list of practices
// somebody RECORDED as affected, which is not the same as the practices that WERE affected, and the
// gap between the two is the whole reason this page carries the note it does.
//
// ⚠ AND §10 IS ABOUT PRACTICES, NOT PEOPLE. §1: "Do not treat individual clinical concerns or patient
// records as product support data", and §10 repeats it for affected scope. Nothing here reads a patient,
// a practitioner roster or an appointment. A practice is named — CPR-PLAT-OVERSIGHT-001 permits that of
// platform staff — and the row stops there.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const [incidents, cases, escalations, subjects] = await Promise.all([
    loadOpenIncidents(admin), loadCases(admin), loadEscalations(admin), loadSubjects(admin),
  ]);

  const problems: string[] = [];
  if (incidents === null) problems.push("mos_incident: could not be read, so incidents are missing from every row below.");
  if (cases === null) problems.push("mos_support_case: could not be read, so cases are missing from every row below.");
  if (subjects === null) problems.push("mos_subject: the subject registry could not be read, so practices are identified by id rather than by name.");
  // ⚠ THE FOURTH READ HAD NO NOTICE, AND ITS FAILURE RENDERED AS A CONFIDENT ZERO. Three loaders were
  // checked for null here and escalations was not, while `(escalations?.rows ?? []).length` fed a 22px
  // bold "Open escalations" figure. ReadResult is `{rows, truncated} | null`, so an unreadable
  // mos_escalation displayed 0 open escalations -- which PD-009 §23 forbids in as many words:
  // "Affected-scope Unknown is never displayed as zero."
  if (escalations === null) problems.push("mos_escalation: could not be read, so the open-escalation count is not known rather than zero.");

  // Practice id → label, resolved through the phase 1 registry so a renamed practice is renamed here.
  const label = new Map<string, string>();
  for (const s of subjects ?? []) if (s.subjectType === "practice") label.set(s.subjectId, s.label);

  type Row = { practiceId: string; incidents: string[]; caseCount: number; openCases: number };
  const byPractice = new Map<string, Row>();
  const row = (id: string) => {
    const existing = byPractice.get(id);
    if (existing) return existing;
    const fresh: Row = { practiceId: id, incidents: [], caseCount: 0, openCases: 0 };
    byPractice.set(id, fresh);
    return fresh;
  };

  for (const i of incidents ?? []) {
    if (i.subjectType === "practice" && i.subjectId) row(i.subjectId).incidents.push(i.incidentId);
  }
  for (const c of cases?.rows ?? []) {
    if (!c.practiceId) continue;
    const r = row(c.practiceId);
    r.caseCount += 1;
    if (c.isOpen) r.openCases += 1;
  }

  const rows = [...byPractice.values()]
    .sort((a, b) => (b.incidents.length - a.incidents.length) || (b.openCases - a.openCases));

  // ⚠ AN INCIDENT WHOSE SUBJECT IS THE PRODUCT AFFECTS EVERY PRACTICE AND APPEARS ON NO ROW HERE.
  // Counted and stated rather than silently excluded, because "no practice affected" would otherwise
  // be the reading of an estate-wide outage.
  const estateWide = (incidents ?? []).filter(i => i.subjectType !== "practice");
  // null, NOT 0, when the read failed -- the render below prints "Not known" for it. `?? []` collapses
  // "I could not look" and "there are none" into the same number, and this figure is read by somebody
  // deciding whether anything is escalated right now.
  const unscopedEscalations = escalations === null
    ? null
    : escalations.rows.filter(e => e.isOpen).length;

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Affected Practices"
        spec="CPR-PD-009 §10"
        purpose="Which practices are carrying an open incident or have reported a case, and how much."
        readAt={new Date().toISOString()}
      />

      <ReadFailures problems={problems} />

      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3.5">
        <p className="text-[12.5px] font-bold text-gray-900">
          This list is derived, not recorded.
        </p>
        <p className="mt-1 max-w-4xl text-[11.5px] leading-relaxed text-gray-700">
          A practice appears here because an incident names it as its subject, or because a case was
          raised from it. There is no &ldquo;affected practice&rdquo; record and §10 does not ask for
          one. So this is the set of practices somebody <em>recorded</em> as affected — which is not the
          set that <em>were</em> affected, and today nothing can record either, because no intake exists.
        </p>
        <Explain summary="What would close the gap between recorded and actual">
          Impact is countable from telemetry: the event store threads every failed attempt to a
          practice and a journey, and Incident 360 already counts practices touched from a correlation
          id. What is missing is the link in the other direction — a way to go from a practice to
          &ldquo;every incident that touched you&rdquo; without somebody having typed it. That needs the
          incident to be threaded to its events at declaration, which is a writer, not a query.
          <Cite>mos_incident.subject_id and mos_support_case.practice_id — both typed by somebody, neither observed</Cite>
        </Explain>
      </div>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Practices named</p>
          <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{rows.length}</p>
          <p className="mt-1 text-[11px] text-gray-500">by an open incident or a case</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Estate-wide incidents</p>
          <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{estateWide.length}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            ⚠ Scoped to the product or a market, so they affect every practice and appear on no row below.
          </p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Open escalations</p>
          {unscopedEscalations === null ? (
            <p className="mt-0.5 text-[15px] font-bold leading-none text-gray-400">Not known</p>
          ) : (
            <p className="mt-0.5 text-[22px] font-bold leading-none tabular-nums text-gray-900">{unscopedEscalations}</p>
          )}
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">
            {unscopedEscalations === null
              ? "The escalation register could not be read. That is not zero escalations."
              : "Escalations attach to an incident or a case, so their practice is whichever that names."}
          </p>
        </div>
      </div>

      <Panel title="Practices with something open" note="Most incidents first, then most open cases.">
        <EmptyOrUnreadable
          rows={incidents === null && cases === null ? null : rows}
          what="affected practice"
          caveat="No incident names a practice as its subject and no case carries a practice id."
        />
        {rows.length > 0 && (
          <ul className="mt-2 flex flex-col divide-y divide-gray-100">
            {rows.map(r => (
              <li key={r.practiceId} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-[12.5px] font-semibold text-gray-900">
                    {label.get(r.practiceId) ?? "Practice not in the subject registry"}
                  </p>
                  <p className="font-mono text-[10.5px] text-gray-400">{r.practiceId.slice(0, 8)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4">
                  <span className="text-[11.5px] text-gray-700">
                    <span className="font-bold tabular-nums text-gray-900">{r.incidents.length}</span> incident
                    {r.incidents.length === 1 ? "" : "s"}
                  </span>
                  <span className="text-[11.5px] text-gray-700">
                    <span className="font-bold tabular-nums text-gray-900">{r.openCases}</span> open case
                    {r.openCases === 1 ? "" : "s"}
                    {r.caseCount !== r.openCases && (
                      <span className="text-gray-500"> of {r.caseCount}</span>
                    )}
                  </span>
                  {r.incidents[0] && (
                    <Link href={`/super-admin/pd/support/incident-360?id=${r.incidents[0]}`}
                      className="text-[11.5px] font-semibold text-teal-700 hover:underline">
                      command →
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {estateWide.length > 0 && (
        <Panel title="Open incidents that affect everybody" note="Scoped above a single practice, so no practice row carries them.">
          <ul className="flex flex-col divide-y divide-gray-100">
            {estateWide.map(i => (
              <li key={i.incidentId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/super-admin/pd/support/incident-360?id=${i.incidentId}`}
                  className="min-w-0 text-[12.5px] font-semibold text-gray-900 hover:text-teal-700">
                  {i.title}
                </Link>
                <span className="shrink-0 text-[11.5px] text-gray-600">
                  {i.subjectLabel ?? i.subjectType}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="What this page will not show">
        <p className="text-[12px] leading-relaxed text-gray-700">
          No practitioner, no patient, no appointment and no clinical detail. §1 and §10 both rule it
          out, and a support surface is the most tempting place to break that rule — the fastest way to
          understand a booking failure is to look at the booking. A practice is named because platform
          oversight permits it; the row stops there, and the failing journey is read in{" "}
          <Link href="/super-admin/pd/health/workflows" className="font-semibold text-teal-700 hover:underline">
            Workflow Health
          </Link>{" "}
          where the evidence is journey-shaped rather than person-shaped.
        </p>
      </Panel>
    </div>
  );
}
