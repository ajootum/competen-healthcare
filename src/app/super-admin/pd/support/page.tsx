import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdSupport, SUPPORT_SUBMODULES } from "@/lib/hq/pd-support";
import {
  SupportHeader, Panel, Stat, SeverityBadge, SubmoduleGrid,
  ReadFailures, AbsentList, Explain, Cite,
} from "./_components/support-ui";

// CPR-PD-009 §3 — SUPPORT & INCIDENTS, the overview.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does not
// constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation).
//
// ⚠ RESPONSE IS THIS MODULE'S JOB, DETECTION IS PRODUCT HEALTH'S, and the specification's prescriptive
// decision says so in its first paragraph. So this page does not compute a health verdict of its own —
// it links to the one Product Health already computes, because two surfaces answering "is the product
// healthy" from different reads is how they come to disagree.

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireHqCapability("hq.practice.support.view");
  const admin = await createAdminClient();
  const s = await loadPdSupport(admin);

  return (
    <div className="flex flex-col gap-4">
      <SupportHeader
        title="Support & Incidents"
        spec="CPR-PD-009 §3"
        purpose="What is failing for practitioners right now, who holds it, and what has been outstanding too long."
        readAt={s.readAt}
      />

      <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
        <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
          Incidents are real here. Cases, problems, postmortems, escalations and corrective actions have no record type yet.
        </p>
        <p className="mt-1.5 max-w-4xl text-[12px] leading-relaxed text-gray-800">
          The incident model is Practice-native and scoped to the canonical subjects and the eight
          critical journeys, so every figure about an incident below is counted rather than estimated.
          The other five objects §1 defines do not exist as tables — they are models to build, not
          queries somebody has not written yet, and this module says which is which rather than showing
          five zeroes.
        </p>
        <Explain summary="Why a zero would have been the wrong rendering">
          A zero is a measurement: it says somebody looked and found none. Every one of those five would
          have shown zero open cases, zero overdue actions, zero problems — and a Director reading a
          quiet panel would reasonably conclude the estate was quiet. It is not quiet; it is unrecorded.
          <Cite>mos_incident and mos_incident_open exist; no case, problem, postmortem, escalation or corrective-action table does</Cite>
        </Explain>
      </div>

      <ReadFailures problems={s.problems} />

      {/* ── §3's posture ───────────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Stat label="Open incidents" f={s.posture.openIncidents} />
        <Stat label="SEV-1 and SEV-2" f={s.posture.major} tone="warn" />
        <Stat label="Without an owner" f={s.posture.unowned} tone="warn" />
        <Stat label="Major, no commander" f={s.posture.noCommander} tone="warn" />
        <Stat label="Oldest open" f={s.posture.oldestHours} unit="h" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* ── §3's Needs Attention, restricted to triggers that can fire ─────────────────────── */}
        <Panel
          title="Needs attention (§3)"
          note="Only the triggers with a producer. The five that cannot fire are named below rather than left as an implied all-clear."
        >
          {s.attention.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              No open incident is missing a commander. ⚠ That is one trigger of six, and the other five
              have nothing to fire from — so this panel being empty says less than it appears to.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {s.attention.map(a => (
                <li key={a.incidentId} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <Link href={`/super-admin/pd/support/incident-360?id=${a.incidentId}`}
                      className="text-[12.5px] font-semibold text-gray-900 hover:text-teal-700">
                      {a.title}
                    </Link>
                    <SeverityBadge label={a.severityLabel} />
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{a.why}</p>
                  <p className="mt-0.5 font-mono text-[10.5px] text-gray-500">
                    since {new Date(a.startedAt).toISOString().replace("T", " ").slice(0, 16)} GMT
                  </p>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 border-t border-gray-100 pt-2">
            <p className="text-[11px] font-semibold text-gray-700">Triggers §3 asks for that cannot fire</p>
            <ul className="mt-1 flex flex-col gap-1">
              {s.triggersWithoutProducers.map(t => (
                <li key={t.trigger} className="text-[11.5px] leading-relaxed text-gray-600">
                  <span className="font-semibold text-gray-800">{t.trigger}</span> — {t.why}
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        {/* ── §5's lifecycle, as the estate sits in it ───────────────────────────────────────── */}
        <Panel
          title="Where the estate sits (§5)"
          note="The eight lifecycle states, in order. An incident past RESOLVED is not open and is not counted above."
        >
          <ul className="flex flex-col gap-1">
            {s.byStatus.map(b => (
              <li key={b.status} className="flex items-center gap-2.5">
                <span className="w-[104px] shrink-0 text-[11.5px] text-gray-700">{b.label}</span>
                <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                  <span className="block h-full rounded-full bg-teal-500"
                    style={{ width: s.incidents.length ? `${(b.n / Math.max(1, s.incidents.length)) * 100}%` : "0%" }} />
                </span>
                <span className="w-[24px] shrink-0 text-right text-[11.5px] tabular-nums text-gray-600">{b.n}</span>
              </li>
            ))}
          </ul>
          <Explain summary="Why RESOLVED, POST-INCIDENT and CLOSED all read zero here">
            This list counts OPEN incidents only, and §5 continues past recovery into the postmortem
            workflow and then to closure. An incident in one of those three has been recovered, so it is
            not part of the current posture — but it is not gone either, and Support Intelligence is
            where its resolution time would be counted once that page exists.
          </Explain>
        </Panel>
      </div>

      {/* ── the five record types that do not exist ────────────────────────────────────────────── */}
      <Panel
        title="Record types §1 defines that this schema does not have"
        note="Each is a model with a lifecycle, not a screen waiting for a query."
      >
        <AbsentList items={s.missing} />
      </Panel>

      {/* ── detection lives elsewhere, deliberately ────────────────────────────────────────────── */}
      <Panel title="Where detection lives">
        <p className="text-[12px] leading-relaxed text-gray-700">
          §0 is explicit: Product Health detects and explains degradation, this module owns response,
          Product Operations owns technical remediation and Releases &amp; Capabilities owns deployment
          and rollback. So the failing journeys and the health evidence behind an incident are read{" "}
          <Link href="/super-admin/pd/health/workflows" className="font-semibold text-teal-700 hover:underline">
            in Workflow Health
          </Link>{" "}
          rather than recomputed here — two surfaces answering the same question from different reads is
          how they come to disagree.
        </p>
      </Panel>

      <Panel title="The eleven submodules (§2)" note="The chip is the state of the RECORD TYPE, not of the page.">
        <SubmoduleGrid items={SUPPORT_SUBMODULES} />
      </Panel>
    </div>
  );
}
