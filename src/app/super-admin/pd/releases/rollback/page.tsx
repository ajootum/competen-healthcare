import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases, ROLLBACK_OPTIONS, subSpec, structureScore, refusalFor,
  FLAG_ORDER, FLAG_CONSEQUENCE, SUPABASE_GATE_NOTE,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, Verdict, StateModel,
  Structure, Questions, WritesAndApprovals, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012K — ROLLBACK & RECOVERY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ ROLLBACK HERE IS A STATUS SOMEBODY TYPED, NOT A PATH ANYBODY TESTED.
//
// A release row can be marked rolled back. Nothing performs the reversal, nothing records why, nothing
// records what scope it covered, and — most seriously — nothing verifies that the product recovered.
// §16 requires post-rollback verification against health and critical journeys, and there is no health
// telemetry and no journey check, so a rollback can be recorded and can never be confirmed to have
// worked.
//
// ⚠ TWO REVERSALS ARE GENUINELY REAL and both are worth naming precisely, because overstating either
// would be worse than the absences around them:
//
//   THE LAUNCH FLAGS withdraw an entry pathway — provisioning, sign-in or signup — immediately, with an
//   audit row, gated on a capability. They fail toward closed, which is the safe posture §8 requires.
//   They do NOT withdraw a capability from anybody already inside.
//
//   THE CONFIGURATION CHECKPOINT restores the estate's configuration objects from a snapshot taken
//   before activation. It is a real restore point and it contains no Competen Practice setting.
//
// ⚠ AND THE MIGRATION QUESTION HAS NO ANSWER AT ALL. §16 says not to promise one-click rollback for an
// irreversible data migration and to label the constraint clearly. Nothing records which migrations
// have been applied, so no migration can be labelled reversible or irreversible before approval.

export const dynamic = "force-dynamic";

const SPEC = subSpec("rollback");

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const held = (c: string) => ctx.isOwner || ctx.capabilities.includes(c);
  const score = structureScore(SPEC);
  const available = ROLLBACK_OPTIONS.filter(o => o.available).length;
  const rolledBack = r.releases.rows.filter(x => x.status === "rolled_back");
  const openPathways = FLAG_ORDER.filter(f => r.ops.flags[f]);

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Rollback & Recovery"
        purpose="What can actually be reversed, what cannot, and why no rollback in this product has ever been confirmed to have worked."
        spec="CPR-PD-012K · CPR-PD-012 §16"
      />

      <Warn title="Rollback is recorded, never performed, and never verified">
        <p>
          A release can be marked as rolled back and that is the whole of it: no reason, no scope, no
          execution and no result. <span className="font-semibold">§16 requires recovery to be verified
          through health and critical practitioner journeys</span>, and this product has neither — so a
          rollback that left the product broken would look identical to one that fixed it.
        </p>
        <p className="mt-1.5">
          §16 also requires a rollback strategy to be DECLARED BEFORE material expansion. There is no
          plan object, so no strategy has ever been declared for anything, and the two reversals that do
          work were never chosen as a strategy — they are simply the two things this system happens to
          be able to undo.
        </p>
        <Cite>
          plat_deployments.status = &apos;rolled_back&apos; (migration 044:36) is the only rollback
          record. configuration_releases.checkpoint (099:20) holds pre-activation snapshots for estate
          configuration. No migration creates a rollback_plan, rollback_option, recovery_verification or
          kill_switch_event table.
        </Cite>
      </Warn>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Reversal options that work" value={`${available} of ${ROLLBACK_OPTIONS.length}`}
          note="closing an entry pathway, and restoring an estate configuration change set" />
        <Fact label="Entry pathways currently open" value={String(openPathways.length)}
          note={openPathways.length === 0 ? "nothing to withdraw: no pathway is open" : "each can be closed immediately, with an audit row"} />
        <Fact label="Releases marked rolled back"
          value={r.releases.read ? String(rolledBack.length) : "Could not be read"}
          note={r.releases.read ? "recorded reversals, each carrying no reason and no verified outcome" : "the release log did not answer; that is not zero"} />
        <Fact label="Rollbacks verified recovered" value="None"
          note="a statement about the schema: there is no health or journey evidence for a recovery to be verified against" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE FIVE OPTIONS ─────────────────────────────────────────────────────────────────────── */}
      <Panel title="The five recovery options (§16), and which exist here"
        note="Each with exactly what it reverses. Overstating any of these would be worse than the absences around them — a reversal a director believes in and cannot perform is the most expensive kind of wrong.">
        <ul className="flex flex-col">
          {ROLLBACK_OPTIONS.map(o => (
            <li key={o.option} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-2 first:pt-0 last:border-0 last:pb-0">
              <span className="text-[12px] font-semibold text-gray-900">{o.option}</span>
              <Verdict ok={o.available} yes="Real" no="Nothing to act on" />
              <span className="w-full text-[12px] leading-relaxed text-gray-600">{o.detail}</span>
            </li>
          ))}
        </ul>
        <Cite>
          PATCH /api/v1/practice/flags, gated on hq.practice.flags.manage (migration 311).
          configuration_releases.checkpoint (migration 099:20) holds the pre-activation snapshots.
          plat_deployments.status = &apos;rolled_back&apos; (044:36) is a status and performs nothing.
        </Cite>
      </Panel>

      {/* ── THE EMERGENCY CONTROL THAT IS REAL ───────────────────────────────────────────────────── */}
      <Panel title="The emergency control that genuinely works"
        note="The launch flags are real kill switches for ENTRY. They fail toward closed, every flip is audited, and each one's consequence for the public site is written in the same constant the endpoint uses.">
        <ul className="flex flex-col gap-2">
          {FLAG_ORDER.map(f => {
            const on = !!r.ops.flags[f];
            return (
              <li key={f} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[12px] font-bold text-gray-900">{f}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${on ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${on ? "bg-[var(--cmp-color-warning)]" : "bg-gray-300"}`} />
                    {on ? "ON — can be withdrawn" : "OFF — already closed"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{FLAG_CONSEQUENCE[f]}</p>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3 text-[12px] leading-relaxed text-gray-700">
          ⚠ {SUPABASE_GATE_NOTE}
        </p>
        <Explain summary="What these do not reverse, stated plainly">
          They close a door. A practice already inside keeps every capability it has switched on, every
          patient record it has created and every session it holds. There is no control anywhere that
          withdraws a capability from practices that already have it — deactivation is written per
          workspace and belongs to the practice, not to the landlord. So the kill switch withdraws the
          door, never the feature.
        </Explain>
      </Panel>

      {/* ── MIGRATION REVERSIBILITY ──────────────────────────────────────────────────────────────── */}
      <Panel title="Migration reversibility (§16), and why nothing here can be labelled"
        note="§16: do not promise one-click rollback for an irreversible data migration; label the constraints clearly.">
        <div className="rounded-xl border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] p-4">
          <p className="text-[12px] font-bold text-gray-700">No migration can be labelled reversible or irreversible</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            Nothing in this database records which migrations have been applied, in what order or with
            what effect. So a release cannot declare what data changes it carried, an approver cannot be
            shown an irreversibility constraint before approving, and a rollback cannot know what it
            would fail to undo. ⚠ This is the same absence that leaves §7&apos;s migrations gate with no
            evidence to read, and it is one store away from being fixed for both.
          </p>
        </div>
      </Panel>

      {/* ── RECORDED ROLLBACKS ───────────────────────────────────────────────────────────────────── */}
      <Panel title="Rollbacks recorded"
        note="Release rows whose status reads rolled back. Each is a status somebody set — it says a reversal happened and nothing about what it reversed or whether it worked.">
        {!r.releases.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The release log could not be read. That is not &quot;no rollbacks&quot;.
          </p>
        ) : rolledBack.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The log answered and no release is marked rolled back — a measured empty result over the
            releases that have been recorded. ⚠ It is not evidence that no rollback has happened: a
            reversal nobody wrote down leaves no trace here.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-[12px]">
            {rolledBack.map(x => (
              <li key={`${x.version}-${x.createdAt}`} className="border-b border-gray-100 pb-1.5 last:border-0 last:pb-0">
                <span className="font-mono font-bold text-gray-900">{x.version}</span>
                <span className="ml-2 text-gray-600">{x.channel} channel · recorded {String(x.createdAt).slice(0, 10)}</span>
                <span className="block leading-relaxed text-gray-600">{x.notes || "no note was recorded with this rollback"}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="The rollback states 012K prescribes"
        note="Six states. The honest one for most of this product is Unavailable — no safe direct rollback, alternate recovery required.">
        <StateModel rows={SPEC.states} holdLabel="Can a rollback hold this state?" />
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.kill_switch"); return { what: x.label, why: x.why }; })()} />

      <Panel title="What 012K §3 asks this screen to show"
        note={`Eight prescribed elements, ${score.yes} in full and ${score.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "By closing an entry pathway, or by restoring an estate configuration change set from its checkpoint. Nothing else in this product can be reversed.",
        "Available for those two and never tested for either — no rollback has been rehearsed, so nothing here may claim a validated recovery path.",
        "Unknown, and that is the serious answer: no record of applied migrations exists, so no data change can be labelled irreversible before it is approved.",
        "No. Verification needs health evidence and critical-journey checks, and there are none — a rollback can be recorded and never confirmed.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.kill_switch", "rel.post_deploy_verification", "rel.release_content", "rel.rollout_stage"].map(refusalFor)} />
      </Panel>

      <Warn title="And a rollback does not close anything else">
        <p>
          §16: rollback does not close the incident or the governance follow-up automatically, and
          emergency kill-switch use is audited and must have recovery and re-enable criteria. A flag
          flip is audited into the practice trail. <span className="font-semibold">No re-enable
          criteria are recorded anywhere</span> — so a flag turned off in an emergency is turned back on
          when somebody decides to, with nothing written down about what would justify it.
        </p>
      </Warn>

      <WritesAndApprovals
        canActivate={held("hq.practice.release.activate")}
        canRollback={held("hq.practice.release.rollback")}
        canApprove={held("hq.practice.change.approve")}
        canFlags={held("hq.practice.flags.manage")}
      />

      <NotThisModule>
        §16: rollback does not close an incident. Incident command belongs to Support &amp; Incidents,
        and the technical execution of a reversal belongs to{" "}
        <Link href="/super-admin/pd/operations" className="font-semibold text-teal-700 hover:underline">Product Operations</Link>.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
