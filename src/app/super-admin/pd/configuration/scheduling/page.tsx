import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Panel, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §9 — SCHEDULING & BOOKING.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE ONE DOMAIN WHERE THE PRACTICE PLANE HAS ALREADY BUILT WHAT §21 ASKS FOR. practice_booking_rule
// has a companion practice_booking_rule_version (migration 244:161): immutable prior versions of a
// booking rule, which is exactly §21's "store immutable prior versions sufficient for safe rollback".
// It was built for the Practice product, on the Practice plane, without this module — which is worth
// stating, because it is evidence that the right answer for §7–§15 may be to GOVERN the Practice-plane
// stores rather than to re-implement them under a registry that cannot address a Practice.
//
// ⚠ AND §9's NAMED FAILURE MODE IS A SEMANTIC RULE, NOT A TYPE CHECK. "Booking horizon shorter than the
// required lead time" is two valid integers that are wrong together. §19 calls this semantic validation
// and requires it server-side; the registry has no validation column at all, so a change set can be
// "validated" against schema and dependencies and still carry a horizon inside the lead time.

export const dynamic = "force-dynamic";

const D = domain("scheduling")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Scheduling & Booking"
        purpose="Appointment, availability, self-booking and booking-rule defaults — the rules that decide when a patient can be offered a slot."
        spec="CPR-PD-011 §9"
      />

      <Warn title="A scheduling change is the one most likely to break something already booked">
        <p>
          §9: a configuration change must not silently invalidate existing appointments. Shortening a
          booking horizon, lengthening a lead time or narrowing a cancellation window all have
          appointments already sitting on the far side of them. §17 requires the affected descendants to
          be shown before a change is approved —{" "}
          <span className="font-semibold">
            and this plane cannot count the appointments a rule change would strand
          </span>
          , because practice_appointment is allowlisted at its tenancy column only: it can be counted per
          workspace and never filtered by a date, a rule or a status.
        </p>
      </Warn>

      <Panel title="The conflict §9 names, and why nothing here would catch it"
        note="§19 requires semantic validation server-side: ranges, mutually exclusive settings, required combinations.">
        <p className="text-[12px] leading-relaxed text-gray-700">
          A booking horizon of 7 days with a required lead time of 14 days is two valid integers and one
          unbookable practice. Both pass every type check. The change-set validator stores its result in{" "}
          <span className="font-mono text-[11px]">configuration_releases.validation</span>, and what it
          records is schema errors and dependency reasons —{" "}
          <span className="font-semibold">no per-setting semantic rule exists to run</span>, because no
          definition carries validation rules; §4&apos;s Validation attribute has no column on
          configuration_registry_objects.
        </p>
        <Explain summary="Where the real rule lives today">
          The Practice product enforces its own booking rules in its own engine, on the Practice plane,
          where the rule row and the appointments it governs are both reachable. That is the correct
          place for a rule that has to be evaluated on every booking attempt. What is missing is the
          governance layer above it — a definition that declares the rule&apos;s type, range, allowed
          scopes and approval class — and that is what §4 describes and this registry cannot yet hold.
        </Explain>
      </Panel>

      <Panel title="Product default, or somebody's availability?"
        note="§9 requires the two to be kept apart, and they are different tables for a reason.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">A product default</span> is what a slot duration
            or booking horizon should be when nobody has said otherwise. That is this module&apos;s
            subject, and it has no store: there is no Practice configuration definition.
          </li>
          <li>
            <span className="font-semibold text-gray-900">An availability template</span> is when a
            particular practitioner works. That is operational data belonging to a person and a practice,
            never a product setting, and it is not this module&apos;s to govern even if the plane
            admitted it.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Self-booking</span> is a capability, not a
            configuration. §9 is explicit that its behaviour must respect Releases &amp; Capabilities
            state — so whether a practice CAN take a self-booking is answered at{" "}
            <Link href="/super-admin/pd/releases/capabilities" className="font-semibold text-teal-700 hover:underline">
              Capabilities
            </Link>
            , and only how it behaves once available would be this module&apos;s.
          </li>
        </ul>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23: whether self-booking exists and is deployed is Releases &amp; Capabilities&apos;. §24:
        booking volumes and funnel behaviour are Product Intelligence&apos;s. A stalled practice is
        Product Operations&apos;.
      </NotThisModule>

      <NoReadNote why="Every booking and availability store is on the Practice plane and refused to it." />
    </div>
  );
}
