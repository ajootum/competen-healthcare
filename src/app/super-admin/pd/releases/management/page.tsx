import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases,
  TECHNICAL_OBJECTS, refusalFor, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Stat, Fact, Panel, AbsentList, Warn, Explain, Cite, ObjectTable, Verdict,
  ReadFailures, ReadStamp, NotThisModule,
  StateModel, Structure, Questions,
} from "../_components/release-ui";

// CPR-PD-012 §6 — RELEASE MANAGEMENT.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE MOST IMPORTANT SENTENCE ON THIS PAGE IS THAT NOTHING WRITES THIS TABLE EXCEPT A PERSON.
//
// plat_deployments is real, it has a version, a channel, a status and a note, and it is genuinely the
// release record §6 asks for — minus every field that would make it governed. No pipeline feeds it, so
// a "current production release" tile inherits that caveat completely: it names the last release
// SOMEBODY RECORDED, which is not the same claim as what is running. Making that tile confident would
// be this page claiming knowledge of production it does not have.
//
// ⚠ AND `failed` IS NOT IN THE STATUS ENUM. Migration 044:36 constrains status to planned, releasing,
// released and rolled_back. §6 requires Failed as a deployment state; a failed deploy is not expressible
// here at all, so it would be recorded as one of the four or not recorded — and the second is more
// likely. That is stated rather than left for a reader to discover from an empty column.

export const dynamic = "force-dynamic";

const SPEC = subSpec("management");
const SCORE = structureScore(SPEC);

const FIELDS: { field: string; requirement: string; present: boolean; where: string }[] = [
  { field: "Release ID / version", requirement: "Stable version and release identifier.", present: true, where: "a version string, with an optional build number and commit beside it" },
  { field: "Title / summary", requirement: "Human-readable release purpose.", present: true, where: "a free-text note, and the only field that could carry a purpose" },
  { field: "Content", requirement: "Capabilities, fixes, migrations and relevant configuration changes.", present: false, where: "no release_item object; content is whatever the free-text note says" },
  { field: "Environment", requirement: "Target environments.", present: false, where: "the channel — stable, staged or canary — is a release track, not an environment. There is one production environment" },
  { field: "Owner", requirement: "Release or product owner.", present: true, where: "the person who RECORDED the row, who is not necessarily the person who owns the release" },
  { field: "Risk class", requirement: "Governed release risk classification.", present: false, where: "no risk column and no classification vocabulary" },
  { field: "Readiness", requirement: "Gate results and blockers.", present: false, where: "no gate result object; see Dependencies & Readiness" },
  { field: "Approvals", requirement: "Required approvals and conditions.", present: false, where: "no approval record, no required approver, no condition" },
  { field: "Deployment state", requirement: "Planned, Deploying, Deployed, Failed, Rolled Back and so on.", present: false, where: "⚠ four states are allowed and FAILED is not one of them, so a failed deployment cannot be recorded as one" },
  { field: "Rollout", requirement: "Linked rollout plan and stages.", present: false, where: "no rollout object exists to link to" },
  { field: "Health", requirement: "Post-deploy Product Health evidence.", present: false, where: "no health telemetry to evidence anything with" },
  { field: "Rollback", requirement: "Strategy, readiness and result.", present: false, where: "status can READ rolled_back; no strategy is declared and no result is verified" },
  { field: "Timeline", requirement: "Plan, deploy, expand, pause, rollback and GA events.", present: false, where: "two timestamps, and the row is updated in place — so a release has no event stream of its own" },
];

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const carried = FIELDS.filter(f => f.present).length;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Release Management"
        purpose="What has been released, in what channel, and how far the release record is from the governed object §6 describes."
        spec="CPR-PD-012 §6"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Releases recorded" figure={r.releases.total} scope="rows in plat_deployments" />
        <Stat label="Rollbacks recorded" figure={r.releases.rolledBack}
          tone={r.releases.rolledBack.state === "value" && r.releases.rolledBack.value > 0 ? "warning" : "neutral"}
          scope="rows whose status reads rolled_back" />
        <Fact
          label="Current production release"
          value={r.releases.current ? r.releases.current.version : r.releases.read ? "None recorded" : "Could not be read"}
          note={
            r.releases.current
              ? `Recorded as released on ${String(r.releases.current.releasedAt).slice(0, 10)}. ⚠ This is the last release somebody RECORDED, not a reading of production.`
              : r.releases.read
                ? "No row has status `released` with a date. A measured empty result."
                : "The read did not complete — that is not \"no releases\"."
          } />
        <Fact
          label="§6 fields carried"
          value={`${carried} of ${FIELDS.length}`}
          note="the release record against the specification's own field table, below" />
      </div>

      <ReadFailures problems={r.problems} />

      <Warn title="A release row is a human's note, and the table cannot express a failed deployment">
        <p>
          Nothing in this repository writes <span className="font-mono text-[11px]">plat_deployments</span> —
          no CI/CD hook, no build step, no deploy script. A row exists because a person created one. So
          every figure on this page is <span className="font-semibold">what was recorded</span>, and the
          gap between that and what is running is invisible from here.
        </p>
        <p className="mt-1.5">
          And a release can be in one of four states: planned, releasing, released or rolled back.{" "}
          <span className="font-semibold">§6 requires Failed and it is not one of them</span>, so a
          deployment that failed cannot be recorded as having failed. It would be left reading as still
          in progress, or never written down at all — and the second is the one that leaves no trace.
        </p>
        <Cite>
          plat_deployments status check constrains it to planned, releasing, released, rolled_back
          (migration 044:36). No file in this repository writes to plat_deployments.
        </Cite>
      </Warn>

      {/* ── THE RELEASES ─────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The release log"
        note="Newest first, up to the most recent 200 rows. Every column shown is a column the table actually has.">
        {!r.releases.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The release log could not be read. That is not &quot;no releases exist&quot; — see the read
            failures above.
          </p>
        ) : r.releases.rows.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The log answered and holds no rows. Nobody has recorded a release — a measured empty table.
            ⚠ Which also means no capability can point at the release that shipped it, and no readiness
            gate has a release to gate.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Version</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Channel</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Status</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Released</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Recorded</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Build</th>
                  <th scope="col" className="py-1.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {r.releases.rows.map(row => (
                  <tr key={`${row.version}-${row.createdAt}`} className="border-b border-gray-100 align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-mono text-[11px] font-bold text-gray-900">{row.version}</th>
                    <td className="py-2 pr-3 text-gray-700">{row.channel}</td>
                    <td className="py-2 pr-3 font-semibold text-gray-900">{row.status}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-700">
                      {row.releasedAt ? String(row.releasedAt).slice(0, 10) : <span className="text-gray-400">not recorded</span>}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{String(row.createdAt).slice(0, 10)}</td>
                    <td className="py-2 pr-3 font-mono text-[10px] text-gray-500">
                      {row.buildNumber || row.gitCommit
                        ? [row.buildNumber, row.gitCommit ? row.gitCommit.slice(0, 8) : null].filter(Boolean).join(" · ")
                        : <span className="text-gray-400">not recorded</span>}
                    </td>
                    <td className="py-2 leading-relaxed text-gray-600">{row.notes || <span className="text-gray-400">no note</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {r.releases.byStatus.length > 0 && (
          <Explain summary="How the recorded releases break down">
            <p>
              By status: {r.releases.byStatus.map(s => `${s.status} ${s.n}`).join(", ")}.
              {" "}By channel: {r.releases.byChannel.map(c => `${c.channel} ${c.n}`).join(", ")}.
            </p>
            <p className="mt-1">
              These count the rows this page read, which is the most recent 200. Where fewer than 200
              rows exist — the release-count tile above says how many — the breakdown is over all of
              them.
            </p>
          </Explain>
        )}
      </Panel>

      {/* ── §6's FIELD TABLE, SCORED ─────────────────────────────────────────────────────────────── */}
      <Panel title="What §6 asks a release record to carry"
        note="Thirteen fields, each scored against what plat_deployments actually holds. This is the distance between a changelog and a governed release object.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Field (§6)</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Requirement</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Carried</th>
                <th scope="col" className="py-1.5 font-semibold">Where, or why not</th>
              </tr>
            </thead>
            <tbody>
              {FIELDS.map(f => (
                <tr key={f.field} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-bold text-gray-900">{f.field}</th>
                  <td className="py-1.5 pr-3 leading-relaxed text-gray-600">{f.requirement}</td>
                  <td className="py-1.5 pr-3"><Verdict ok={f.present} yes="Yes" no="No" /></td>
                  <td className="py-1.5 leading-relaxed text-gray-700">{f.where}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Cite>
          plat_deployments (migration 044:32-41, enriched by 054:29-31): version, channel, status,
          notes, released_at, created_by, git_commit, build_number. There is no release_item,
          deployment_record, release_approval or post_deploy_verification table in any migration.
        </Cite>
      </Panel>

      {/* ── THE CONFIGURATION CHANGE SETS — the nearest real release object ──────────────────────── */}
      <Panel title="Configuration change sets — the release object this repository actually built"
        note="The configuration publishing service has a channel, a rollout mode, an object list, a validation result, a pre-activation restore point and an eight-state lifecycle. ⚠ It releases the ESTATE's configuration; no Competen Practice setting is one of its objects.">
        {!r.changeSets.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The change-set store could not be read. That is not &quot;no change sets exist&quot;.
          </p>
        ) : r.changeSets.rows.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The store answered and holds no rows. Nobody has grouped a configuration edit into a named
            change set — a measured empty table, not an unreadable one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Change set</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Channel</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Rollout mode</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Objects</th>
                  <th scope="col" className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {r.changeSets.rows.slice(0, 20).map(c => (
                  <tr key={c.key} className="border-b border-gray-100 align-top">
                    <th scope="row" className="py-2 pr-3 text-left">
                      <span className="block font-semibold text-gray-900">{c.name}</span>
                      <span className="block font-mono text-[10px] font-normal text-gray-400">{c.key}</span>
                    </th>
                    <td className="py-2 pr-3 text-gray-700">{c.channel}</td>
                    <td className="py-2 pr-3 text-gray-700">
                      {c.rollout}{c.scheduledFor ? ` · ${c.scheduledFor.slice(0, 16).replace("T", " ")}` : ""}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-700">{c.objects}</td>
                    <td className="py-2 font-semibold text-gray-900">{c.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Explain summary="Why its `phased` and `canary` rollout modes are not a rollout percentage">
          The rollout column stores ONE WORD naming how a change set is applied — immediate, scheduled,
          phased or canary (migration 099:12-13). It carries no proportion, no cohort, no assignment and
          no per-subject stickiness, and it is about a configuration change set rather than a capability.
          Reading it as §9&apos;s percentage rollout would turn a mode name into a measurement.
        </Explain>
      </Panel>

      <Panel title="Not shown, and why">
        <AbsentList items={[
          "rel.release_content", "rel.release_approvals",
          "rel.post_deploy_verification", "rel.readiness_gates",
        ].map(refusalFor)} />
      </Panel>

      <Panel title="§25's release objects, and which of them exist"
        note="The specification's own initial object list, scored. This is the build order for the module, and the rows reading No are the reason most of these pages describe rather than count.">
        <ObjectTable objects={TECHNICAL_OBJECTS} />
        <Cite>
          Present: plat_deployments (044:32-41 + 054:29-31), plat_feature_flags /
          plat_feature_flag_assignments (042:91-106), practice_platform_flags (191:256-260),
          practice_capability_activation (278:85-148), configuration_release_events (099:31),
          plat_audit_events. Absent: no migration creates release_item, deployment_record,
          readiness_gate_definition, readiness_gate_result, feature_flag_version, rollout,
          rollout_stage, rollout_cohort, rollout_assignment, entitlement_rule, market_availability,
          plan_availability, pilot_program, pilot_participant, pilot_acceptance, rollback_plan or
          capability_availability_decision.
        </Cite>
      </Panel>

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for a release`}
        note="Seven states. Four can be recorded, and the two that matter most for safety — Ready and Failed — cannot.">
        <StateModel rows={SPEC.states} holdLabel="Can a release hold this state?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "The log names versions, channels and statuses. What a release CONTAINS is one free-text note: no release says which capabilities, fixes or migrations it carried.",
        "A status says somebody recorded it as released. Nothing verifies, so a deployment that succeeded while the product broke is indistinguishable from one that worked.",
        "Neither is recorded. Nothing tracks which migrations have been applied, and no release references a configuration change set.",
        "Risk and approval have no column at all. Rollback is a status somebody set afterwards, with no declared strategy and no verified result.",
      ]} />

      <NotThisModule>
        §27: this is not a CI/CD pipeline and not a deployment console. Deployment execution and
        technical diagnostics belong to Product Operations; this module records what was released and
        what it made available.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
