import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadOpenIncidents, SEVERITY_LABEL } from "@/lib/hq/mos-incident";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  SupportHeader, Panel, SeverityBadge, AbsentList, Explain, Cite,
} from "../_components/support-ui";

// CPR-PD-009 §8 — COMMUNICATIONS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7).
//
// ⚠ THIS IS THE ONE SUBMODULE MIGRATION 318 DID NOT MAKE REAL, AND IT IS DELIBERATE. 318 built the five
// record types §1 names. An incident UPDATE is the sixth object — §8's own — and it is a different
// shape from all five: it has an audience, a channel, an author and a cadence to be late against, and
// the cadence is a configuration rather than a record. Building it alongside the five would have meant
// guessing the audience model, which is exactly the guessing that produced migration 317.
//
// ⚠ SO THIS PAGE COUNTS NOTHING. Every other page in the module now shows measured zeroes; this one
// shows no figure at all, because a zero here would be a claim that no update has been sent, and the
// truth is that no update CAN be recorded. The two look identical on a dashboard and are opposites.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const incidents = await loadOpenIncidents(admin);
  const major = (incidents ?? []).filter(i => i.severity === "sev1" || i.severity === "sev2");

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Communications"
        spec="CPR-PD-009 §8"
        purpose="What has been said about an incident, to whom, and what is due to be said next."
        readAt={new Date().toISOString()}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          There is no update record, so this page shows no figure — not a zero.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          Every other screen in this module now counts a real store and shows a measured zero. This one
          does not, because a zero would say &ldquo;no update has been sent&rdquo; when the truth is
          &ldquo;no update can be recorded&rdquo;. On a dashboard those look identical; as statements
          they are opposites, and only one of them is a reason to go and write an update.
        </p>
        <Explain summary="Why §8 was not built alongside the other five">
          Migration 318 built the five record types §1 enumerates. An incident update is §8&apos;s own
          object and a different shape: it carries an AUDIENCE and a CHANNEL, and the &ldquo;next update
          due&rdquo; §7 asks for needs a CADENCE, which is a configuration rather than a record.
          Guessing the audience model would have repeated the mistake migration 317 had to correct — a
          vocabulary invented from a sketch instead of taken from the specification that governs it.
          <Cite>mos_support_case, mos_problem, mos_escalation, mos_postmortem, mos_corrective_action — five, and no update table</Cite>
        </Explain>
      </div>

      <Panel title="What §8 needs before this page can show anything">
        <AbsentList items={[
          { label: "Incident update record", why: absenceSentence("sup.communications") },
          { label: "Communication cadence", why: "§7's \"next update due\" is a promise measured against a cadence. Nothing anywhere configures one, per severity or otherwise, so no update can be late." },
          { label: "Audience model", why: "§8 distinguishes who is told what. Practice owners, practitioners and internal staff are three audiences with three tolerances for detail, and none of them is expressible today." },
          { label: "Decision record", why: absenceSentence("sup.decisions") },
        ]} />
      </Panel>

      <Panel
        title="Incidents that would be generating updates"
        note="SEV-1 and SEV-2 open now. Shown so the absence above has a size, not to imply an update is owed — no rule says one is."
      >
        {incidents === null ? (
          <p className="text-[12px] leading-relaxed text-[var(--cmp-text-warning)]">
            ⚠ The incident store could not be read. That is not zero incidents.
          </p>
        ) : major.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-600">
            No SEV-1 or SEV-2 incident is open. ⚠ That is a measured zero about incidents and says
            nothing about communications — if an update had been sent, this page could not tell you.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-gray-100">
            {major.map(i => (
              <li key={i.incidentId} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/super-admin/pd/support/incident-360?id=${i.incidentId}`}
                  className="min-w-0 text-[12.5px] font-semibold text-gray-900 hover:text-teal-700">
                  {i.title}
                </Link>
                <SeverityBadge label={SEVERITY_LABEL[i.severity]} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Where the trail that DOES exist lives">
        <p className="text-[12px] leading-relaxed text-gray-700">
          §5 requires state transitions to carry an actor, a time and an audit, and they do — the
          incident timeline on{" "}
          <Link href="/super-admin/pd/support/incident-360" className="font-semibold text-teal-700 hover:underline">
            Incident 360
          </Link>{" "}
          is append-only and cannot be edited or deleted while the incident exists. That is an internal
          record of what CHANGED, which is a different thing from a record of what was SAID and to whom.
          Reading the first as the second is how a commander concludes the practices were told.
        </p>
      </Panel>
    </div>
  );
}
