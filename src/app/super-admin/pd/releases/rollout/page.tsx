import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases,
  ROLLOUT_STAGES, TECHNICAL_OBJECTS, refusalFor, FLAG_ORDER, FLAG_CONSEQUENCE,
  SUPABASE_GATE_NOTE, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, Pipeline, ObjectTable,
  WritesAndApprovals, ReadFailures, ReadStamp, NotThisModule,
  StateModel, Structure, Questions,
} from "../_components/release-ui";

// CPR-PD-012 §9 — ROLLOUT MANAGEMENT.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THIS IS THE PAGE THE DESIGNS PRESS HARDEST ON, AND THE ONE WITH THE LEAST BEHIND IT.
//
// The approved comp shows a rollout pipeline with a population in each stage and a percentage dial
// above it. There is no rollout object in this database: no rollout, no rollout_stage, no
// rollout_cohort, no rollout_assignment — §25 names all four and none exists. A percentage needs two
// things at once and this product has neither: somewhere to store the number, and a deterministic
// bucketing function to make an assignment sticky per subject so that a practitioner does not gain and
// lose a feature between two page loads.
//
// So the SHAPE is drawn — seven stages, in order, each carrying its verdict — and every count and the
// dial are refused. A shape with an honest state is where a real figure lands the day a producer
// exists. A shape with a plausible number in it is a claim that this product does progressive delivery,
// and it does not.
//
// ⚠ WHAT IT DOES DO IS A LADDER, and the ladder is real. Two of the seven stages have a genuine control
// behind them, and one of those — Internal — is exactly how Competen Practice is exposed today.

export const dynamic = "force-dynamic";

const SPEC = subSpec("rollout");
const SCORE = structureScore(SPEC);

const CONTROLS = [
  {
    control: "Pause",
    exists: false,
    detail: "There is no rollout to pause. The nearest real act is turning a launch flag off, which closes an entry pathway for everybody rather than freezing an expansion.",
  },
  {
    control: "Resume",
    exists: false,
    detail: "Follows from Pause. Turning a flag back on reopens the pathway; nothing resumes from a recorded position, because no position is recorded.",
  },
  {
    control: "Expand",
    exists: false,
    detail: "No cohort, no percentage and no market or plan scope, so there is nothing to expand along. §21 requires bulk expansion to be previewable, counted and idempotent — none of which can be built before there is a scope to count.",
  },
  {
    control: "Contract",
    exists: false,
    detail: "Same absence. And a contraction that removed a capability from practices already using it would be the access loss §13 and §24 both forbid doing silently.",
  },
  {
    control: "Roll back",
    exists: false,
    detail: "A release row can be marked rolled_back after the fact. No rollout can be reversed, because none can be started.",
  },
];

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const held = (c: string) => ctx.isOwner || ctx.capabilities.includes(c);
  const controlled = ROLLOUT_STAGES.filter(s => s.state === "controlled");
  const absent = ROLLOUT_STAGES.filter(s => s.state === "absent");
  const rolloutObjects = TECHNICAL_OBJECTS.filter(o =>
    o.name.startsWith("rollout") || o.name.startsWith("entitlement") || o.name === "capability_availability_decision");

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Rollout Management"
        purpose="The seven stages of progressive rollout, which of them this product can actually enter, and why the percentage dial the designs show has nothing behind it."
        spec="CPR-PD-012 §9, §25"
      />

      <Warn title="There is no rollout object in this product, and a percentage cannot be stored or applied">
        <p>
          §9 makes progressive rollout the default model for a material new capability, and §25 names the
          four objects it needs: <span className="font-mono text-[11px]">rollout</span>,{" "}
          <span className="font-mono text-[11px]">rollout_stage</span>,{" "}
          <span className="font-mono text-[11px]">rollout_cohort</span> and{" "}
          <span className="font-mono text-[11px]">rollout_assignment</span>.{" "}
          <span className="font-semibold">None of the four exists.</span> So a rollout cannot be started,
          paused, expanded, contracted, counted or reversed, and {absent.length} of the seven stages
          cannot be entered at all.
        </p>
        <p className="mt-1.5">
          The percentage is the sharpest case, because it needs two absent things at once. There is no
          percentage column on any table — the estate assignment store targets by scope, never by
          proportion — and there is no deterministic bucketing function anywhere in this codebase, which
          §9 requires in the same breath: <em>&quot;percentage assignment must be deterministic and
          sticky where user experience requires it.&quot;</em> A dial drawn here would be reporting a
          number nobody stored, applied by a mechanism nobody wrote.
        </p>
      </Warn>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Stages with a real control" value={`${controlled.length} of ${ROLLOUT_STAGES.length}`}
          note={controlled.map(s => s.stage).join(", ")} />
        <Fact label="Current exposure (§19)" value={r.ops.launch.state} note={r.ops.launch.detail} />
        <Fact label="Rollout objects that exist" value={`0 of 4`}
          note="rollout, rollout_stage, rollout_cohort and rollout_assignment — §25's four" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE PIPELINE ─────────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="The seven stages (§9)"
        note="Drawn in the order the specification gives them, each with what implements it here. No stage carries a population, because a stage nothing can enter cannot hold one — and a count would be the first thing a reader believed.">
        <Pipeline stages={ROLLOUT_STAGES} />
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.rollout_percentage"); return { what: x.label, why: x.why }; })()} />

      {/* ── WHAT EXPOSURE ACTUALLY LOOKS LIKE TODAY ──────────────────────────────────────────────── */}
      <Panel
        title="How Competen Practice is actually exposed today"
        note="Not a rollout — a ladder. Three ordered flags decide whether anybody may be provisioned, sign in, or sign up, and the state below is derived from them rather than stored, so the two cannot drift.">
        <ol className="flex flex-col gap-2">
          {FLAG_ORDER.map((f, i) => {
            const on = !!r.ops.flags[f];
            const row = r.ops.flagRows.find(x => x.flag === f);
            return (
              <li key={f} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-gray-400">{i + 1}</span>
                  <span className="font-mono text-[12px] font-bold text-gray-900">{f}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${!row ? "text-gray-500" : on ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${!row ? "bg-gray-400" : on ? "bg-[var(--cmp-color-warning)]" : "bg-gray-300"}`} />
                    {!row ? "No row for this flag" : on ? "ON" : "OFF"}
                  </span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{FLAG_CONSEQUENCE[f]}</p>
              </li>
            );
          })}
        </ol>
        <p className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3 text-[12px] leading-relaxed text-gray-700">
          ⚠ {SUPABASE_GATE_NOTE}
        </p>
      </Panel>

      {/* ── THE ROLLOUT ACTIONS ──────────────────────────────────────────────────────────────────── */}
      <Panel title="Rollout actions (§9), and what each would act on"
        note="§9 requires a rollout to pause, resume, expand, contract or roll back. Each is listed with the object it would need, so the gap is a work list rather than a blank screen.">
        <ul className="flex flex-col gap-2 text-[12px]">
          {CONTROLS.map(c => (
            <li key={c.control} className="rounded-lg border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-[13px] font-bold text-gray-900">{c.control}</span>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                  <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--cmp-text-critical)]" />
                  Nothing to act on
                </span>
              </div>
              <p className="mt-0.5 leading-relaxed text-gray-700">{c.detail}</p>
            </li>
          ))}
        </ul>
        <Explain summary="Why no button offers any of these, even though the capability exists">
          Migration 311 created <span className="font-mono text-[11px]">hq.practice.release.activate</span>{" "}
          and <span className="font-mono text-[11px]">hq.practice.release.rollback</span> and granted
          both to the Product Director. The capability is real; the object is not. A button that opened a
          modal and wrote nothing would be worse than this list, because a control that appears to work
          is trusted and a missing control is asked about.
        </Explain>
      </Panel>

      <Panel title="The rollout, entitlement and decision objects (§25)"
        note="The specification's own object list, narrowed to this page's section. This is the build order.">
        <ObjectTable objects={rolloutObjects} />
        <Cite>
          No migration in this repository creates a rollout, rollout_stage, rollout_cohort,
          rollout_assignment, entitlement_rule or capability_availability_decision table, and no column
          named percentage, exposure or bucket exists on any table.
        </Cite>
      </Panel>

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.rollout_percentage", "rel.rollout_stage", "rel.active_rollouts", "rel.pilot_acceptance", "rel.availability_decision"].map(refusalFor)} />
      </Panel>

      <Warn title="And the rule that must survive whoever builds this">
        <p>
          §9: <em>&quot;Never expose a capability outside entitlement, market or plan rules merely
          because percentage targeting selected the user.&quot;</em> A percentage is a filter applied
          AFTER eligibility, never instead of it. Whoever adds the store and the bucketing function
          inherits that ordering, and it is the one part of this page that is a constraint on future work
          rather than a description of present absence.
        </p>
      </Warn>

      <WritesAndApprovals
        canActivate={held("hq.practice.release.activate")}
        canRollback={held("hq.practice.release.rollback")}
        canApprove={held("hq.practice.change.approve")}
        canFlags={held("hq.practice.flags.manage")}
      />

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for a rollout`}
        note="Six states, and none of them can be reached — a rollout that cannot be started cannot be planned, paused, contracted or completed.">
        <StateModel rows={SPEC.states} holdLabel="Can a rollout hold this state?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "None. No capability can be in a stage, because no rollout object exists. The seven stages are drawn above with what each would need.",
        "Everybody admitted through the launch ladder, which is the whole product rather than a cohort. No exposure set can be defined and none is recorded.",
        "No threshold can be set and nothing is measured: this product emits no telemetry, so there is nothing for a success or failure threshold to watch.",
        "None of the five can act on anything. What can genuinely change is the launch ladder, and the console that owns it is linked rather than duplicated here.",
      ]} />

      <NotThisModule>
        The provisioning queue that admits a named pilot user is Product Operations&apos; workflow and
        stays there —{" "}
        <Link href="/super-admin/pd/operations/provisioning" className="font-semibold text-teal-700 hover:underline">Provisioning</Link>{" "}
        shows the saga, its step ledger and what a failure leaves behind.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
