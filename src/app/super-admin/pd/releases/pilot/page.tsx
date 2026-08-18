import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases, subSpec, structureScore, refusalFor, FLAG_CONSEQUENCE, SUPABASE_GATE_NOTE,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, StateModel, Structure,
  Questions, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012I — PILOT & EARLY ACCESS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE PRODUCT IS IN A PILOT RIGHT NOW, AND THE PILOT IS NOT AN OBJECT.
//
// Competen Practice is exposed exactly the way §14 describes a named pilot: a platform operator
// provisions a workspace for a named person, and nobody else can get in. The MECHANICS are real,
// audited and resumable — a provisioning request, a step ledger, a failure consequence for each step.
//
// What does not exist is the PILOT: no program with a name, no participant list that is a list of
// participants rather than a list of provisioning runs, no capability under test, no acceptance
// criteria defined before exposure, no monitoring window, and no exit decision. So this product can
// say who was let in and cannot say what would end the pilot or what would count as it succeeding.
//
// ⚠ AND §6's SHARPEST LINE APPLIES TODAY: "absence of complaints is not acceptance". With no outcome
// store, absence of complaints is all there is — which is worth saying on the screen rather than
// leaving as an implication of an empty panel.

export const dynamic = "force-dynamic";

const SPEC = subSpec("pilot");

const EXIT_DECISIONS = [
  { decision: "Expand", needs: "A next rollout stage to expand into, and acceptance evidence to justify it. Neither exists." },
  { decision: "Extend", needs: "A pilot with a duration. Nothing has a start, an end or a window." },
  { decision: "Pause", needs: "Turning pilot provisioning off does stop new admissions immediately — the closest thing here to a real pause, and it does nothing for the people already in." },
  { decision: "Roll back", needs: "A way to withdraw the capability from participants. Deactivation is the practice's own switch, not the landlord's." },
  { decision: "Stop", needs: "A decision record. Ending a pilot would leave no trace that it had ended, or why." },
];

const ACCEPTANCE = [
  { criterion: "Usability", detail: "Whether a practitioner can complete the work without help." },
  { criterion: "Critical journey completion", detail: "Whether the end-to-end journeys the capability exists for actually complete." },
  { criterion: "Reliability", detail: "Whether it works consistently over the monitoring window." },
  { criterion: "Support burden", detail: "What it costs to keep the pilot running." },
  { criterion: "Defined product outcomes", detail: "Whatever this pilot was specifically trying to prove." },
];

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const score = structureScore(SPEC);
  const pilotOn = !!r.ops.flags.practice_pilot_provisioning;
  const signInOn = !!r.ops.flags.practice_sign_in;
  const signupOn = !!r.ops.flags.practice_public_signup;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Pilot & Early Access"
        purpose="How named people are actually admitted to Competen Practice today, and everything a governed pilot needs that no record here can hold."
        spec="CPR-PD-012I · CPR-PD-012 §14"
      />

      <Warn title="The product is in a pilot posture and the pilot is not a thing this system can describe">
        <p>
          Admission is real and governed:{" "}
          <span className="font-semibold">
            {pilotOn ? "a platform operator can provision a workspace for a named person" : "operator provisioning is currently closed"}
          </span>
          , {signInOn ? "sign-in is live" : "sign-in is closed"} and{" "}
          {signupOn ? "public signup is open" : "public signup is closed"}. Every provisioning run is
          recorded with its steps, its outcome and what a failure left behind.
        </p>
        <p className="mt-1.5">
          What is missing is everything that would make it a PILOT rather than a set of admissions: a
          program with a name and an owner, participants recorded as participants, the capability and
          version under test, acceptance criteria agreed before exposure, a monitoring window, and an
          explicit exit decision. <span className="font-semibold">§6 of 012I: absence of complaints is
          not acceptance.</span> Today, absence of complaints is all there is.
        </p>
        <Cite>
          practice_platform_flags.practice_pilot_provisioning (migration 191:256);
          provisioning_request / provisioning_step (191). No migration creates a pilot_program,
          pilot_participant, pilot_cohort, pilot_acceptance_criterion, pilot_evidence or
          pilot_exit_decision table. practice_cohort (305) is an analytics cohort on the Practice plane.
        </Cite>
      </Warn>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Current posture" value={r.ops.launch.state} note={r.ops.launch.detail} />
        <Fact label="Pilot programs defined" value="None"
          note="a statement about the schema: there is no pilot record for one to be defined in" />
        <Fact label="Acceptance criteria recorded" value="None"
          note="§6 requires them to be defined BEFORE exposure; there is nowhere to define them" />
        <Fact label="Prescribed elements on this page" value={`${score.yes + score.partial} of ${score.total}`}
          note={`${score.yes} in full, ${score.partial} in part — scored against 012I §3 below`} />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── HOW ADMISSION REALLY WORKS ───────────────────────────────────────────────────────────── */}
      <Panel title="How a named person is admitted today"
        note="The one part of §14 that genuinely exists, and it exists well. It is Product Operations' workflow and it stays there — this page links to it rather than restating its queue.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Provisioning is a flag, and it is the ladder&apos;s first rung.</span>{" "}
            {FLAG_CONSEQUENCE.practice_pilot_provisioning} It is currently{" "}
            <span className="font-semibold">{pilotOn ? "ON" : "OFF"}</span>.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Each admission is a recorded run with a step ledger.</span>{" "}
            A partial failure is legible rather than silent, and a failed run can be resumed by
            re-sending the original request. The queue, the failures and what each failure left behind
            are on{" "}
            <Link href="/super-admin/pd/operations/provisioning" className="font-semibold text-teal-700 hover:underline">Provisioning</Link>.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Nothing marks the person as a pilot participant.</span>{" "}
            The run records who was provisioned and when. It cannot say which pilot they joined, what
            they were asked to try, or when their involvement should end.
          </li>
          <li>
            <span className="font-semibold text-gray-900">⚠ Pilot users are not distinguishable from test workspaces.</span>{" "}
            §6 of 012I requires the distinction. A workspace carries a type, and nothing separates a
            genuine pilot practice from one created to try something out — so any acceptance evidence
            gathered later would mix the two.
          </li>
        </ul>
        <p className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3 text-[12px] leading-relaxed text-gray-700">
          ⚠ {SUPABASE_GATE_NOTE}
        </p>
      </Panel>

      {/* ── ACCEPTANCE ───────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The acceptance §14 asks a pilot to capture"
        note="Five structured criteria. None of the five has a store, so none can be agreed in advance or scored afterwards.">
        <ul className="flex flex-col">
          {ACCEPTANCE.map(a => (
            <li key={a.criterion} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
              <span className="text-[12px] font-semibold text-gray-900">{a.criterion}</span>
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold text-[var(--cmp-text-critical)]">
                <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-[var(--cmp-text-critical)]" />
                Nowhere to record it
              </span>
              <span className="w-full text-[12px] leading-relaxed text-gray-600">{a.detail}</span>
            </li>
          ))}
        </ul>
        <Explain summary="Why two of these five would be hard even with a store">
          Critical journey completion and reliability both need product telemetry, and this product
          emits none — no page view, no feature invocation, no session start. So even once a pilot
          object existed, three of the five criteria could be attested by a person and two would still
          have nothing to measure. That ordering matters for whoever builds this: the store is the
          smaller half of the work.
        </Explain>
      </Panel>

      {/* ── EXIT DECISIONS ───────────────────────────────────────────────────────────────────────── */}
      <Panel title="The five exit decisions (§14), and what each would need"
        note="§6: every pilot ends with an explicit governed exit decision. None of the five can be recorded, so a pilot here can only end by somebody deciding it has.">
        <ul className="flex flex-col">
          {EXIT_DECISIONS.map(e => (
            <li key={e.decision} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
              <span className="text-[12px] font-semibold text-gray-900">{e.decision}</span>
              <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${e.decision === "Pause" ? "text-[var(--cmp-text-warning)]" : "text-[var(--cmp-text-critical)]"}`}>
                <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${e.decision === "Pause" ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-text-critical)]"}`} />
                {e.decision === "Pause" ? "Partly real" : "Cannot be recorded"}
              </span>
              <span className="w-full text-[12px] leading-relaxed text-gray-600">{e.needs}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="The pilot states 012I prescribes"
        note="Eight states. Three of them describe the product's actual posture today and none of the three can be recorded as such.">
        <StateModel rows={SPEC.states} holdLabel="Can a pilot hold this state?" />
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.pilot_acceptance"); return { what: x.label, why: x.why }; })()} />

      <Panel title="What 012I §3 asks this screen to show"
        note={`Eight prescribed elements, ${score.yes} in full and ${score.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Whoever a platform operator provisioned. They are recorded as provisioning runs rather than as a cohort, and the list is on Provisioning.",
        "Neither is recorded. No criteria were agreed before exposure and no monitoring window is defined.",
        "None that this system holds. There is no feedback or outcome store, and no product telemetry to derive one from.",
        "No exit decision can be recorded. The pilot ends when somebody moves the launch ladder, and nothing marks that as an exit.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.pilot_acceptance", "rel.rollout_stage", "rel.capability_lifecycle", "rel.post_deploy_verification"].map(refusalFor)} />
      </Panel>

      <NotThisModule>
        §19: the provisioning queue stays Product Operations&apos; authoritative technical workflow and
        is linked from here rather than rebuilt. §27: this module governs product exposure, not the
        execution of provisioning.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
