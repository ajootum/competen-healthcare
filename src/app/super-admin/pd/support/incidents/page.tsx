import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdSupport } from "@/lib/hq/pd-support";
import { SEVERITY_LABEL, STATUS_LABEL } from "@/lib/hq/mos-incident";
import {
  SupportHeader, Panel, Stat, SeverityBadge, StatusChip, ReadFailures, AbsentList, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §5 — INCIDENT MANAGEMENT.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ EVERY INCIDENT HERE IS REAL, AND THE PAGE STILL CANNOT DO HALF OF WHAT s5 ASKS. The model records a
// state, a severity, an owner and a subject; it does not record an UPDATE, so "update overdue" cannot
// fire, and it does not record recovery EVIDENCE, so s5's rule that "Resolved must not mean a deployment
// finished" cannot be enforced by anything but a person remembering it. Both are named on the page.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const s = await loadPdSupport(admin);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Incident Management"
        spec="CPR-PD-009 §5"
        purpose="The incident estate: severity, lifecycle, ownership and coordination."
        readAt={s.readAt}
      />

      <ReadFailures problems={s.problems} />

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Open incidents" f={s.posture.openIncidents} />
        <Stat label="SEV-1 and SEV-2" f={s.posture.major} tone="warn" />
        <Stat label="Without an owner" f={s.posture.unowned} tone="warn" />
        <Stat label="Oldest open" f={s.posture.oldestHours} unit="h" />
      </div>

      <Panel
        title="Open incidents"
        note="Most severe first, then oldest first — §9's ranked order. An incident past RESOLVED is not listed."
      >
        {!s.readable ? (
          <p className="text-[12px] leading-relaxed text-gray-600">
            The incident store could not be read. ⚠ That is not an empty estate — it is an unanswered
            question, and the two are different facts.
          </p>
        ) : s.incidents.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-600">
            No incident is open. The store answered and holds none in a non-terminal state — a measured
            empty estate rather than an unreadable one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  <th className="py-1.5 pr-3">Incident</th>
                  <th className="py-1.5 pr-3">Severity</th>
                  <th className="py-1.5 pr-3">State</th>
                  <th className="py-1.5 pr-3">Subject</th>
                  <th className="py-1.5 pr-3">Journey</th>
                  <th className="py-1.5 pr-3">Owner</th>
                  <th className="py-1.5">Started</th>
                </tr>
              </thead>
              <tbody>
                {s.incidents.map(i => (
                  <tr key={i.incidentId} className="border-b border-gray-100 last:border-0">
                    <td className="py-2 pr-3">
                      <Link href={`/super-admin/pd/support/incident-360?id=${i.incidentId}`}
                        className="font-semibold text-gray-900 hover:text-teal-700">
                        {i.title}
                      </Link>
                      {i.detection === "health_rule" && (
                        <span className="mt-0.5 block text-[10.5px] text-gray-500">raised by a health rule</span>
                      )}
                    </td>
                    <td className="py-2 pr-3"><SeverityBadge label={SEVERITY_LABEL[i.severity]} /></td>
                    <td className="py-2 pr-3"><StatusChip label={STATUS_LABEL[i.status]} /></td>
                    <td className="py-2 pr-3 text-gray-700">{i.subjectLabel ?? i.subjectType}</td>
                    <td className="py-2 pr-3 text-gray-700">{i.journeyName ?? <span className="text-gray-400">none named</span>}</td>
                    <td className={`py-2 pr-3 ${i.ownerName ? "text-gray-700" : "font-semibold text-[var(--cmp-text-warning)]"}`}>
                      {i.ownerName ?? "unowned"}
                    </td>
                    <td className="py-2 font-mono text-[10.5px] text-gray-500">
                      {new Date(i.startedAt).toISOString().replace("T", " ").slice(0, 16)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Explain summary="Why the subject and the journey are never free text">
          An incident references the canonical subject vocabulary and the eight critical journeys by
          foreign key, so it cannot name a scope or blame a journey that does not exist. That is what
          lets an incident be aggregated with health evidence at all — the alternative is text that
          agrees with the rest of the estate only by luck.
          <Cite>mos_incident.subject_type references mos_subject_type; mos_incident.journey_key references mos_journey</Cite>
        </Explain>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="What §5 requires that this model cannot yet enforce">
          <ul className="flex flex-col gap-2 text-[11.5px] leading-relaxed text-gray-700">
            <li>
              <span className="font-semibold text-gray-900">Recovery evidence before RESOLVED.</span> §5
              says resolved must not mean a deployment finished, and asks for critical-journey
              verification. Nothing on an incident records which journey was re-verified or when, so this
              rule is currently kept by a person remembering it rather than by the model.
            </li>
            <li>
              <span className="font-semibold text-gray-900">Update cadence.</span> No incident update
              record exists, so there is no last-update time and §3&apos;s &ldquo;update overdue&rdquo;
              trigger has nothing to measure against.
            </li>
            <li>
              <span className="font-semibold text-gray-900">Closure rules by severity.</span> §5 says
              closure cannot silently bypass a required postmortem. With neither a postmortem record nor
              a rule saying which incidents need one, nothing can be bypassed or enforced.
            </li>
            <li>
              <span className="font-semibold text-gray-900">Severity change with reason.</span> The trail
              carries from_severity, to_severity and a reason, so this one is ready — it needs the write
              path, not the schema.
            </li>
          </ul>
        </Panel>

        <Panel title="Record types this module still needs">
          <AbsentList items={s.missing} />
        </Panel>
      </div>
    </div>
  );
}
