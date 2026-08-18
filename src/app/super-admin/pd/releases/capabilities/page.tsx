import { requireHqCapability } from "@/lib/hq/context";
import {
  capabilityGraph,
  CAPABILITY_ATTRIBUTES, LIFECYCLE, LIFECYCLE_ABSENCE, SETUP_LABELS, DEFAULT_ACTIVE_IDS,
  catalogueAnomalies, refusalFor, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Panel, AbsentList, Warn, Explain, Cite, Lifecycle, AttributeTable,
  PlaneRefusal, NoReadNote, NotThisModule,
  StateModel, Structure, Questions,
} from "../_components/release-ui";

// CPR-PD-012 §3, §4 — THE CAPABILITY REGISTRY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THIS PAGE MAKES NO DATABASE READ, AND THAT IS THE HONEST SHAPE OF IT.
//
// The catalogue is CODE. CAPABILITY_REGISTRY ships with the product as constants, so the twelve
// capabilities, their areas, their dependency closures and their defaults are always present and can
// never be unreadable. That is a genuine strength of this codebase and it is why this page carries no
// freshness stamp: there is nothing to be fresh.
//
// ⚠ AND THE ONE FIGURE A READER WILL WANT — how many practices have each capability switched on — IS A
// REFUSED READ. practice_capability_activation holds it, per workspace, with actor, source and
// timestamps. It is not on the platform-plane allowlist, so no page under src/app/super-admin/** may
// read it. Saying "refused" rather than "not built" is the difference between a reader going to look
// somewhere else and a reader concluding the feature is missing.
//
// ⚠ THREE DIFFERENT THINGS IN THIS CODEBASE ARE CALLED A CAPABILITY and confusing them ships a broken
// entitlement model. This page is about the SECOND. Entitlements & Availability sets all three out.

export const dynamic = "force-dynamic";

const SPEC = subSpec("capabilities");
const SCORE = structureScore(SPEC);

const DEFAULT_LABEL: Record<string, string> = {
  on: "On by default",
  preset: "On in the Booking preset",
  optional: "Off until asked for",
};

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");

  const graph = capabilityGraph();
  const anomalies = catalogueAnomalies();
  const carried = CAPABILITY_ATTRIBUTES.filter(a => a.present).length;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Capability Registry"
        purpose="The canonical catalogue of independently governed Competen Practice capabilities, their dependencies, and the lifecycle metadata §3 requires that none of them carries."
        spec="CPR-PD-012 §3, §4"
      />

      <Warn title="The catalogue is real and it is code, not a governed table">
        <p>
          Twelve capabilities, a full dependency graph in both directions, five configuration artefacts
          and three default states — all of it shipped as constants in{" "}
          <span className="font-mono text-[11px]">src/lib/practice/capability-registry.ts</span>, with
          the closure rules exported so that a screen and a harness use the same rule rather than two
          copies of it. That is {carried} of §3&apos;s {CAPABILITY_ATTRIBUTES.length} attributes
          genuinely carried.
        </p>
        <p className="mt-1.5">
          <span className="font-semibold">
            What a code catalogue cannot do is be governed at runtime.
          </span>{" "}
          A capability cannot be proposed, owned, classified, deprecated or retired here, because there
          is no row to change and no audit trail on the change — editing the catalogue means shipping a
          release. §3&apos;s owner, lifecycle, release, availability, health, governance class and
          rollback attributes have nowhere to live.
        </p>
      </Warn>

      {/* ── THE TWELVE ───────────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="The twelve capabilities (§3)"
        note="Each row is the specification's own vocabulary. `Needs` is the transitive requirement closure, computed by the exported rule rather than restated here; `Breaks if withdrawn` is everything that would be left standing on nothing.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Capability</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Domain</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Needs</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Configuration needed</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Breaks if withdrawn</th>
                <th scope="col" className="py-1.5 font-semibold">Default</th>
              </tr>
            </thead>
            <tbody>
              {graph.map(n => (
                <tr key={n.def.id} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-2 pr-3 text-left">
                    <span className="block font-bold text-gray-900">{n.def.displayName}</span>
                    <span className="block font-mono text-[10px] font-normal text-gray-400">{n.def.id}</span>
                  </th>
                  <td className="py-2 pr-3 leading-relaxed text-gray-700">{n.def.area}</td>
                  <td className="py-2 pr-3 text-gray-700">
                    {n.closure.length === 0
                      ? <span className="text-gray-400">nothing</span>
                      : n.closure.join(", ")}
                  </td>
                  <td className="py-2 pr-3 text-gray-700">
                    {n.def.requiresSetup.length === 0
                      ? <span className="text-gray-400">none</span>
                      : n.def.requiresSetup.map(s => SETUP_LABELS[s]).join(", ")}
                  </td>
                  <td className="py-2 pr-3 text-gray-700">
                    {n.dependents.length === 0
                      ? <span className="text-gray-400">nothing</span>
                      : n.dependents.join(", ")}
                  </td>
                  <td className="py-2 whitespace-nowrap text-gray-700">{DEFAULT_LABEL[n.def.defaultState]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Explain summary="Why two capabilities are active for a practice that has stored nothing">
          <p>
            {DEFAULT_ACTIVE_IDS.join(" and ")} carry a default of <span className="font-mono">on</span>,
            and the engine treats the ABSENCE of a stored row as the registry default rather than as
            &quot;inactive&quot;. Every practice provisioned before the activation table existed has no
            rows at all; if absence meant off, all of them would have read as having no calendar and no
            patient register on the day that shipped.
          </p>
          <p className="mt-1">
            ⚠ The consequence for any future adoption figure: a count of activation ROWS would understate
            these two and would have to use the registry default instead. The rule is exported for
            exactly that reason.
          </p>
        </Explain>

        <Explain summary="Where this registry deliberately stays silent">
          <ul className="mt-1 flex flex-col gap-1">
            {graph.filter(n => n.def.unmodelled).map(n => (
              <li key={n.def.id}>
                <span className="font-mono text-[11px] font-semibold">{n.def.id}</span> — {n.def.unmodelled}
              </li>
            ))}
          </ul>
          <p className="mt-1">
            The specification&apos;s own dependency cell is kept verbatim on each definition so a reader
            can check the row against the document. Where the specification is vague — &quot;relevant
            source capabilities&quot; — nothing is invented, because a dependency guessed here would
            silently force a product on a practice that never chose it.
          </p>
        </Explain>
      </Panel>

      {/* ── INTEGRITY: a real, measured check ────────────────────────────────────────────────────── */}
      <Panel title="Catalogue integrity"
        note="Every id named in a requirement or recommendation must exist in the catalogue, and every configuration key must have a label. Computed over the shipped constants, so an empty result here is a measured empty set rather than an unread one.">
        {anomalies.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-700">
            Every declared dependency resolves to a capability that exists, and every configuration key
            has a label. A typo would be invisible at runtime — the resolver would simply never find the
            dependency, and a capability would declare a requirement nothing enforces — which is why
            this is checked rather than assumed.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-[12px] text-[var(--cmp-text-critical)]">
            {anomalies.map(a => <li key={a} className="font-semibold">{a}</li>)}
          </ul>
        )}
      </Panel>

      {/* ── LIFECYCLE ────────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Capability lifecycle (§4)"
        note="Eight states, and the schema's answer for each. §4 is explicit that lifecycle is not a flag and that a capability cannot be made generally available by toggling one.">
        <Lifecycle states={LIFECYCLE} />
        <Explain summary="Why every one of the eight reads the same way">{LIFECYCLE_ABSENCE}</Explain>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          §4 also requires that retiring a capability preserve its historical release, entitlement and
          audit records, and §24 requires that retirement be BLOCKED while active users remain. Neither
          rule can be enforced today: there is no retirement action to block, and the activation history
          that would prove who was using it sits on the Practice plane.
        </p>
      </Panel>

      {/* ── §3's ATTRIBUTES, SCORED ──────────────────────────────────────────────────────────────── */}
      <Panel title="What §3 asks a capability object to carry"
        note="Thirteen attributes, each scored against what a CapabilityDefinition actually holds. This is the work list for turning a code catalogue into a governed one.">
        <AttributeTable rows={CAPABILITY_ATTRIBUTES} />
        <Cite>
          CapabilityDefinition — src/lib/practice/capability-registry.ts:99-112; the twelve definitions
          at :127-263; the database check constraining capability_code to those twelve at
          migration 278:118-122. No owner, lifecycle, release, availability, health, governance-class or
          rollback field exists on the type or on any table.
        </Cite>
      </Panel>

      {/* ── THE REFUSED READ ─────────────────────────────────────────────────────────────────────── */}
      <PlaneRefusal
        tables={["practice_capability_activation", "practice_capability_activation_event"]}
        why={
          "How many practices have each capability switched on, when each was switched, by whom, and "
          + "through which of four sources — explicit choice, dependency cascade, mode preset or "
          + "provisioning default — is all recorded, per workspace, and this plane may not read it. It "
          + "is the richest data in this module and it belongs to the practices, not to the landlord."
        }
      />

      <Panel title="Not shown, and why">
        <AbsentList items={[
          "rel.capability_activation_estate", "rel.capability_owner",
          "rel.capability_governance_class", "rel.capability_lifecycle",
        ].map(refusalFor)} />
      </Panel>

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for a capability`}
        note="Eight lifecycle states. Every one reads the same way, and the reason is one missing field rather than eight.">
        <StateModel rows={SPEC.states} holdLabel="Can a capability hold this state?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Twelve, listed above with their domain, their dependencies and their default. This is the canonical answer and it ships with the product rather than being read from a table.",
        "Neither is recorded. No definition carries an owner and none carries a lifecycle state — the two attributes §3 leads with.",
        "Dependencies fully, in both directions, computed by the exported rule. Governance class and rollback characteristics are not modelled for these capabilities at all.",
        "This table is the 360: every field a definition holds is on it. There is no deeper record to open, and the activation history that would fill one is on the Practice plane.",
      ]} />

      <NotThisModule>
        §3: do not create a capability object for every UI button — these twelve are meaningful,
        independently governed product capabilities, which is why the catalogue is small. What each one
        DOES once enabled is Product Configuration&apos;s answer, not this page&apos;s.
      </NotThisModule>

      <NoReadNote why="The catalogue ships as constants, so it is always present and can never be a failed read." />
    </div>
  );
}
