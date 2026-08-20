import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdOperations, SUPABASE_GATE_NOTE } from "@/lib/hq/pd-operations";
import { loadLaunchAttestations, attestedCount, CAP_LAUNCH_ATTEST } from "@/lib/hq/pd-launch-attestation";
import { FLAG_CONSEQUENCE, FLAG_ORDER } from "@/lib/practice/operations";
import { OpsHeader, Panel, Warn, TechnicalOpsLink } from "../_components/ops-ui";
import {
  GateDecision, Blockers, ControlGroup, AttestationRows, LadderCompact, ExternalGate,
  GROUPS, HUMAN_GROUP,
} from "./_components/gate";

// CPR-PD-014 §6 — LAUNCH READINESS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7: "a hidden navigation item does not
// constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ THE AUTO/MANUAL SPLIT IS THE WHOLE HONESTY OF THE GATE, and §6.7 makes it an acceptance test. An
// item a person must attest — somebody signing in cold, a pilot walkthrough — is never turned green by a
// page. A single combined ratio would let the manual set disappear into a number that looks nearly done.
//
// ⚠ READ-ONLY, BY §6.7: "No toggle exists on this screen if the action belongs to Technical Operations."
// The flag toggles live there, and the consequence sentences below come from the same FLAG_CONSEQUENCE
// constant that page and the flags API use, so the warning shown at the moment of a flip and the warning
// shown afterwards cannot diverge.

export const dynamic = "force-dynamic";

const FLAG_LABEL: Record<string, string> = {
  practice_pilot_provisioning: "Pilot provisioning",
  practice_sign_in: "Sign-in",
  practice_public_signup: "Public signup",
};

export default async function Page() {
  const hq = await requireHqCapability("hq.practice.operations.view");
  // !! THE OWNER BRANCH IS EXPLICIT. decideHq returns capabilities: [] for allow_owner, so reading the
  // array alone would hide the control from the break-glass account -- the one used when something is
  // wrong. Same shape as canRetry on Technical Operations.
  const canAttest = hq.isOwner || hq.capabilities.includes(CAP_LAUNCH_ATTEST);
  const admin = createAdminClient();
  const [ops, attestations] = await Promise.all([
    loadPdOperations(admin),
    loadLaunchAttestations(admin),
  ]);

  const auto = ops.gate.filter(g => g.kind === "auto");
  const manual = ops.gate.filter(g => g.kind === "manual");
  const publiclyLive = FLAG_ORDER.filter(f => ops.flags[f] && f !== "practice_pilot_provisioning");

  // §6.2 — the gate numerator and denominator, and nothing derived from them beyond the bar.
  const humanAttested = attestedCount(manual.map(m => m.id), attestations);
  const satisfied = ops.gateSummary.autoPass + humanAttested;
  const total = auto.length + manual.length;

  // A blocker is an automatic check that is failing, or a human control not yet attested. Ordered
  // automatic-first because those are actionable by a change rather than by a person's time.
  const blockers = [
    ...auto.filter(a => a.state !== "pass"),
    ...manual.filter(m => attestedCount([m.id], attestations) === 0),
  ];

  // §6.5 — the ladder as a sequence, and the next rung that is off.
  const rungs = FLAG_ORDER.map(f => ({ label: FLAG_LABEL[f] ?? f, on: !!ops.flags[f] }));
  const nextOff = FLAG_ORDER.find(f => !ops.flags[f]);
  const nextTransition = nextOff ? (FLAG_LABEL[nextOff] ?? nextOff) : null;

  const grouped = GROUPS.map(g => ({ title: g.title, items: auto.filter(a => g.ids.includes(a.id)) }));
  // ⚠ ANY AUTOMATIC CONTROL THE GROUPS DO NOT NAME STILL APPEARS. A control that quietly belonged to no
  // group would vanish from the page while still counting toward the denominator, which is the shape of
  // a gate that reads satisfied because something stopped being displayed.
  const ungrouped = auto.filter(a => !GROUPS.some(g => g.ids.includes(a.id)));

  return (
    <div data-wide className="space-y-4">
      <OpsHeader
        title="Launch Readiness"
        purpose="Are the defined controls satisfied to move Competen Practice to the next launch state?"
        spec="CPR-PD-014 §6 · CPR-IAM-001 §14, §14.1"
      />

      {/* §6.2 — the decision, before any checklist. */}
      <GateDecision
        launchState={ops.launch.state}
        satisfied={satisfied}
        total={total}
        blockers={blockers.map(b => b.label)}
        autoPass={ops.gateSummary.autoPass}
        autoTotal={auto.length}
        humanAttested={humanAttested}
        humanTotal={manual.length}
        nextTransition={nextTransition}
      />

      <Blockers items={blockers} />

      <LadderCompact rungs={rungs} nextTransition={nextTransition} blockerCount={blockers.length} />

      {/* STANDING STATEMENT OF WHAT IS PUBLICLY LIVE. Not a toast: whoever opens this page sees it,
          including someone who did not flip the flag and does not know it moved. */}
      {publiclyLive.length > 0 && (
        <Warn title="Live on the public site right now">
          <ul className="flex flex-col gap-1">
            {publiclyLive.map(f => (
              <li key={f}>
                <span className="font-semibold">{FLAG_LABEL[f] ?? f}</span> — {FLAG_CONSEQUENCE[f]}
              </li>
            ))}
          </ul>
        </Warn>
      )}

      {/* §6.3 — grouped controls. A fully passing group is collapsed; one with a blocker opens. */}
      <div className="grid gap-3 lg:grid-cols-2">
        {grouped.map(g => <ControlGroup key={g.title} title={g.title} items={g.items} />)}
        {ungrouped.length > 0 && (
          <ControlGroup title="Other automatic controls" items={ungrouped} />
        )}
      </div>

      {/* §6.4 — human attestation, governed rather than prose. */}
      <Panel title={HUMAN_GROUP}
        note="Controls a person must attest. No page turns these green, and an attestation records who, holding what capability, against which build, with what evidence.">
        <AttestationRows
          items={manual}
          attestations={attestations}
          canAttest={canAttest}
          recordingUnavailableReason={
            attestations.unavailable || canAttest
              ? null
              // !! NAMES WHO MAY, RATHER THAN OFFERING A CONTROL THAT WOULD REFUSE. s13 forbids a
              // placeholder that does nothing, and the reader still needs to know why they cannot.
              // !! NO MIGRATION NUMBER IN A SENTENCE THE READER CANNOT AVOID. The first version of this
              // line named the migration that granted the capability and pushed the screen-doctrine
              // ratchet from 16 to 17. What the reader needs is WHO MAY ATTEST, not which migration
              // created it -- the identifier belongs in Technical Operations, and the doctrine harness
              // is what stopped it reaching the screen.
              : "You do not hold the launch-attestation capability, so no recording control is offered "
                + "here. It belongs to the Practice Product Director position."
          } />
      </Panel>

      {/* §6.6 — the project-level switch, as an external control rather than a footnote. */}
      <ExternalGate note={SUPABASE_GATE_NOTE} />

      <TechnicalOpsLink for="Flipping a flag changes what the public site does, so the toggle and its confirmation stay on" />

      <p className="text-[11px] text-gray-500">
        Read at {ops.generatedAt.slice(0, 16).replace("T", " ")} UTC. Automatic controls are evaluated
        against the live database on every load.
      </p>
    </div>
  );
}
