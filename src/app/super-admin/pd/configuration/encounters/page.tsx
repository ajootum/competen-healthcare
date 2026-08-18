import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §10 — ENCOUNTER CONFIGURATION.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE ONLY DOMAIN WHERE THE SPECIFICATION ASKS FOR A CONFIGURATION SCREEN AND ALSO WARNS AGAINST
// USING IT. §10: "Maintain the HFE target of rapid clinical entry and avoid configuration that creates
// unnecessary mandatory fields." Every other domain's risk is a wrong value; this one's risk is a
// correct value applied too often. A required-field switch is the cheapest thing in the world to turn
// on and it is paid for by every clinician on every encounter, for ever.
//
// ⚠ AND ENCOUNTER CONFIGURATION HAS A SECOND SUBJECT NOTHING ELSE HERE HAS: THE OFFLINE CONTRACT.
// §10 requires compatibility with offline/sync. A device holds a captured encounter and applies it
// later against a server that may have changed the rules underneath it — which is a versioning problem,
// not a settings problem, and the sync ledger already refuses a write whose base version is stale.

export const dynamic = "force-dynamic";

const D = domain("encounters")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Encounter Configuration"
        purpose="Sections, defaults, lists, completion and signing behaviour for a clinical encounter — and the two constraints that make this the easiest domain to make worse."
        spec="CPR-PD-011 §10"
      />

      <Warn title="The risk here is a correct setting applied too widely">
        <p>
          §10 asks for permitted and required sections, completion requirements and quick-entry
          behaviour — and in the same breath warns against configuration that creates unnecessary
          mandatory fields. A required field costs one click to enable and is then paid by every
          clinician on every encounter.{" "}
          <span className="font-semibold">
            §17 requires the affected scope of a change to be shown before it is approved, and this plane
            cannot count the encounters a new mandatory field would touch
          </span>
          {" "}— practice_encounter is allowlisted at its tenancy column only.
        </p>
      </Warn>

      <Panel title="What may be locked, and at which level (§10)"
        note="Some encounter fields are required by safety or by law and must not be removable by a Practice.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          The registry has the column that expresses this —{" "}
          <span className="font-mono text-[11px]">override_policy</span>, whose values include{" "}
          <span className="font-mono text-[11px]">none</span>,{" "}
          <span className="font-mono text-[11px]">narrow_only</span> and{" "}
          <span className="font-mono text-[11px]">extend_only</span>, which is a genuinely well-shaped
          vocabulary for exactly this question: a Practice may ADD a section but not remove a required
          one. No encounter field is a registry object, so no encounter field carries a policy, and the
          distinction between &quot;required because it is safe&quot; and &quot;required because someone
          turned it on&quot; is not recorded anywhere.
        </p>
      </Panel>

      <Panel title="Prospective, unless a governed migration says otherwise (§10)"
        note="The rule that keeps a configuration change out of the clinical record.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Forward only, by default.</span> Adding a
            required section changes what a NEW encounter must contain. It must not make a completed
            encounter retrospectively incomplete, and it must never edit one — a signed encounter is a
            clinical record of what a clinician decided.
          </li>
          <li>
            <span className="font-semibold text-gray-900">A migration is the exception and must be governed.</span>{" "}
            §10 permits a backwards-reaching change only where a governed migration explicitly says so.
            No migration object exists in this module — §29 names configuration_activation and
            propagation_result, and neither is built — so today the exception has no mechanism, which is
            the safe direction to be missing one.
          </li>
        </ul>
      </Panel>

      <Panel title="The offline contract (§10)"
        note="A device captures an encounter under one set of rules and applies it under whatever is live at sync.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          This is the one domain whose configuration has to survive a gap in time. The sync ledger
          already handles the general shape of it: every applied write carries a base version and an
          applied version, a refused or conflicted write must record an error code, and an applied create
          must return a version. So a stale device does not silently win.{" "}
          <span className="font-semibold">
            What is not modelled is the encounter CONFIGURATION being versioned at all
          </span>
          {" "}— there is no definition version for a section rule, so a device cannot say which rule
          version it captured under, and the server cannot refuse a capture made under a rule that has
          since changed.
        </p>
        <Explain summary="Why that matters more here than anywhere else">
          Everywhere else, a configuration change takes effect on the next request. Offline capture means
          a change can take effect between the clinician doing the work and the record arriving — so the
          same encounter is valid on the device and invalid on the server, with nobody at fault.
          §28&apos;s &quot;offline client stale&quot; row prescribes reconciliation by sync policy and
          forbids a stale client weakening an enforced rule; enforcing that needs the rule to carry a
          version, which is §4&apos;s Version attribute and is absent for every Practice setting.
        </Explain>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether encounter capture is deployed is Releases &amp; Capabilities&apos;. §24: sync
        backlog, conflict rate and refused writes are Product Health&apos;s — that instrumentation is
        real and it is 008E&apos;s subject, not this module&apos;s.
      </NotThisModule>

      <NoReadNote why="Every encounter configuration store is on the Practice plane and refused to it." />
    </div>
  );
}
