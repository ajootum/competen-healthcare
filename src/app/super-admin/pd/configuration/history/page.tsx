import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadConfigHistory, domain, LADDER, LIFECYCLE, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary,
  ReadFailures, ReadStamp, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §22 — CONFIGURATION HISTORY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THERE IS NOT ONE TRAIL HERE, THERE ARE FIVE, AND THEY DO NOT COVER THE SAME SUBJECT. A reader who
// assumes a single configuration timeline will conclude from a quiet page that nothing has changed.
//
//   workspace_config_audit             a VALUE changed at a scope, with old_value AND new_value.
//   configuration_registry_audit       a DEFINITION changed — created, updated, synced, retired.
//   configuration_release_events       a CHANGE SET moved state, with the actor.
//   workspace_config_versions          a published SNAPSHOT — the material §22's historical
//                                      effective-value reconstruction actually needs.
//   practice_identifier_format_history the one Practice-plane setting whose history this plane may read.
//
// And a sixth exists and is refused: a Practice's OWN configuration changes are audited into
// practice_audit_event (configuration.ts:241), which is deliberately absent from the platform-plane
// allowlist because its payloads carry clinical detail. So this timeline is complete for the estate's
// configuration and structurally silent about every Practice's, and the page says so at the top rather
// than letting an empty row count read as calm.

export const dynamic = "force-dynamic";

const D = domain("history")!;

const TRAIL_LABEL: Record<string, string> = {
  value: "Value change",
  definition: "Definition change",
  "change set": "Change set",
  "identifier format": "Identifier format",
};

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");
  const h = await loadConfigHistory(createAdminClient());

  const unread = h.trails.filter(t => !t.read);
  const missingStates = LIFECYCLE.filter(l => !l.represented).map(l => l.state);

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Configuration History"
        purpose="Who changed which setting, at which scope, from what to what — across every configuration trail this plane can read, and honest about the one it cannot."
        spec="CPR-PD-011 §21, §22, §26"
      />

      <ReadFailures problems={h.problems} />

      {/* ── WHICH TRAILS ANSWERED. Printed FIRST, because an empty timeline is two facts. ─────── */}
      <Panel title="The trails behind this timeline"
        note="Five stores, five subjects. A trail that did not answer is named here rather than quietly contributing nothing.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[560px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5 pr-3 font-semibold">Trail</th>
                <th className="py-1.5 pr-3 font-semibold">Store</th>
                <th className="py-1.5 font-semibold">Rows read</th>
              </tr>
            </thead>
            <tbody>
              {h.trails.map(t => (
                <tr key={t.table} className="border-b border-gray-100">
                  <td className="py-2 pr-3 font-semibold text-gray-900">{t.name}</td>
                  <td className="py-2 pr-3 font-mono text-[11px] text-gray-600">{t.table}</td>
                  <td className="py-2">
                    {t.read ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-700">
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--cmp-text-success)]" />
                        {t.rows?.toLocaleString() ?? 0} read
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                        <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--cmp-text-critical)]" />
                        Did not answer
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {unread.length > 0 && (
          <p className="mt-2 text-[12px] text-[var(--cmp-text-warning)]">
            {unread.length} trail(s) did not answer, so the timeline below is incomplete by an unknown
            amount. It is a floor, not a history.
          </p>
        )}
      </Panel>

      <Warn title="A Practice's own configuration changes are not in this timeline">
        <p>
          When a Practice changes its own settings, the change is audited into{" "}
          <span className="font-mono text-[11px]">practice_audit_event</span> — the practice&apos;s own
          trail, whose payloads carry clinical detail and which is therefore deliberately absent from
          the platform-plane allowlist. So no amount of quiet on this page is evidence that Practice
          configuration has been stable. This timeline is complete for the ESTATE&apos;s configuration
          and structurally silent about every Practice&apos;s.
        </p>
      </Warn>

      {/* ── THE TIMELINE ─────────────────────────────────────────────────────────────────────── */}
      <Panel title="Configuration timeline"
        note="Most recent first, merged across the trails that answered. Actor and previous/new value where the trail records them.">
        {h.events.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            {unread.length === h.trails.length
              ? "No trail answered, so there is no timeline to show. That is not an unchanged estate."
              : "Every trail that answered holds no rows in the window read. That is a measured empty history for the estate's configuration — and says nothing about any Practice's."}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {h.events.map((e, i) => (
              <li key={`${e.at}-${e.subject}-${i}`} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded border border-gray-200 bg-[var(--cmp-surface-neutral)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                    {TRAIL_LABEL[e.trail]}
                  </span>
                  <span className="text-[13px] font-bold text-gray-900">{e.action}</span>
                  <span className="font-mono text-[11px] text-gray-600">{e.subject}</span>
                  {e.scope && <span className="text-[11px] text-gray-500">at {e.scope}</span>}
                </div>
                {e.detail && <p className="mt-1 font-mono text-[11px] break-words text-gray-600">{e.detail}</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  {String(e.at).slice(0, 16).replace("T", " ")} UTC{e.actor ? ` · ${e.actor}` : " · actor not recorded"}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      {/* ── ROLLBACK MATERIAL ────────────────────────────────────────────────────────────────── */}
      <Panel title="Published snapshots — the rollback material (§21)"
        note="workspace_config_versions.snapshot holds the settings as published at that version. §21: rollback is a new auditable change, never a deletion of history.">
        {h.versions.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            No published snapshot has been recorded. Without one, §22&apos;s historical effective-value
            reconstruction has nothing to reconstruct from — the audit trail says what changed, and only
            a snapshot says what the whole scope looked like at a moment.
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-[12px]">
            {h.versions.map((v, i) => (
              <li key={`${v.at}-${i}`} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold text-gray-900">{v.label ?? "(unlabelled version)"}</span>
                  <span className="text-[11px] text-gray-500">{v.scope}</span>
                  <span className={`text-[11px] font-semibold ${v.status === "rolled_back" ? "text-[var(--cmp-text-warning)]" : "text-gray-600"}`}>
                    {v.status === "rolled_back" ? "Rolled back" : "Published"}
                  </span>
                </div>
                {v.note && <p className="mt-0.5 text-gray-600">{v.note}</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  {v.entries} setting(s) in the snapshot · {String(v.at).slice(0, 16).replace("T", " ")} UTC
                  {v.by ? ` · ${v.by}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
        <Explain summary="What §21 asks for that this cannot do">
          §21 requires the expected effect to be shown BEFORE a rollback and validation to be re-run
          against current dependencies. Neither is modelled: there is no dry-run, and a snapshot carries
          the settings without the dependency state they were valid under. And some changes are
          migratory and cannot be one-click reversed — §21 requires those to be labelled before
          approval, and no definition carries that label because no definition carries a rollback-support
          attribute at all.
        </Explain>
      </Panel>

      <Panel title="Lifecycle states with no representation (§16)"
        note="A timeline can only show transitions the schema can record.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          {missingStates.length === 0
            ? "Every §16 state has a representation in this schema."
            : <>
              <span className="font-semibold text-[var(--cmp-text-critical)]">{missingStates.join(" and ")}</span>{" "}
              cannot appear in any history here, because nothing in this schema records them. A change
              never sits in a recorded &quot;awaiting approval&quot; state, and a temporary override
              cannot lapse because no override carries an expiry. Their absence from the timeline is a
              property of the schema, not evidence they never happened.
            </>}
        </p>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §22 asks for links from a change to a related incident, risk, release or governance decision.
        None of those links is modelled — there is no incident store on this plane at all — so a change
        here cannot be correlated with what it may have caused.
      </NotThisModule>

      <ReadStamp at={h.generatedAt} />
    </div>
  );
}
