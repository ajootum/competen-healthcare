import Link from "next/link";
import { requireHqCapability } from "@/lib/hq/context";
import { domain, LADDER, refusalFor } from "@/lib/hq/pd-configuration";
import { absenceSentence } from "@/lib/hq/pd-metric-registry";
import {
  ConfigHeader, Panel, Absent, Warn, Explain, DomainSections, RungSummary, NoReadNote, NotThisModule,
} from "../_components/config-ui";

// CPR-PD-011 §13 — COMMERCIAL CONFIGURATION.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THIS DOMAIN'S SETTINGS ARE PARAMETERS OF A BILLING RELATIONSHIP THAT DOES NOT EXIST YET.
//
// §13 lists grace periods, dunning retry parameters, renewal-notice windows and trial reminder timing.
// Every one of them is a parameter of a subscription somebody pays for — and a Practice cannot be the
// SUBJECT of a subscription in this schema: plat_subscriptions keys on tenants(id), practice_workspace
// has no tenant_id, practice_plans carries no price and no currency column, and no payment provider is
// integrated for Practice subscriptions. So a grace period here would be a grace period on nothing.
//
// ⚠ AND THE MONEY THAT DOES EXIST IS A DIFFERENT RELATIONSHIP ENTIRELY. practice_invoice and
// practice_payment are the practitioner billing HER PATIENTS: a different party, a different direction
// and a different currency from the landlord relationship §13 is about. Configuring a dunning policy
// against them would apply a landlord's collection rules to a clinician's patients.

export const dynamic = "force-dynamic";

const D = domain("commercial")!;

export default async function Page() {
  await requireHqCapability("hq.practice.configuration.view");

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Commercial Configuration"
        purpose="Configurable commercial behaviour that is not plan, price, subscription or payment truth — grace periods, dunning parameters, renewal and trial reminder timing."
        spec="CPR-PD-011 §13"
      />

      <Warn title="These are parameters of a subscription this product cannot express">
        <p>
          Grace period, dunning retry, renewal notice and trial reminder are all timings ON a paid
          relationship between Competen and a Practice.{" "}
          <span className="font-semibold">That relationship is not modelled.</span>{" "}
          The platform subscription table keys on tenants and a Practice workspace has no tenant id;
          practice_plans holds codes with no price and no currency; and no payment provider is wired for
          a Practice subscription, so there is no collection attempt for a dunning policy to govern.
          Configuring a grace period today would be configuring a grace period on nothing.
        </p>
      </Warn>

      <Panel title="Two kinds of money, and only one of them is §13's"
        note="Confusing them is the most consequential mistake available in this domain.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">Competen bills the Practice.</span> This is
            §13&apos;s subject — plans, subscriptions, renewals, dunning. It has no store, which is why
            every commercial figure across this workspace is refused rather than estimated.
          </li>
          <li>
            <span className="font-semibold text-gray-900">The practitioner bills her patients.</span>{" "}
            practice_invoice and practice_payment are this, and they are live and real. Different party,
            opposite direction, different currency.{" "}
            <span className="font-semibold text-[var(--cmp-text-critical)]">
              A dunning or grace-period rule configured against these would apply a landlord&apos;s
              collection policy to a clinician&apos;s patients.
            </span>{" "}
            Both tables are allowlisted here at their tenancy column only — countable, never readable —
            which makes that mistake impossible to make accidentally through this plane.
          </li>
        </ul>
      </Panel>

      <Panel title="Not shown, and why">
        <div className="flex flex-col gap-2">
          <Absent what="Anything derived from recurring revenue" why={absenceSentence("cm.mrr")} />
          <Absent what="Trial-to-paid behaviour" why={absenceSentence("cm.trial_to_paid")} />
          <Absent what="Payment failures a dunning policy would act on" why={absenceSentence("cm.payment_failures")} />
        </div>
        <Explain summary="Why these are repeated here rather than left to the Commercial workspace">
          §13 requires this module to REFERENCE commercial entities and never duplicate them, so the
          definitions above are the Commercial module&apos;s own, quoted from the one metric registry
          both modules read. A configuration screen that quietly omitted them would leave a reader to
          assume the parameters it offers have something to act on.{" "}
          <Link href="/super-admin/pd/commercial/plans" className="font-semibold text-teal-700 hover:underline">
            Plans &amp; Pricing
          </Link>{" "}
          remains authoritative for the entities themselves.
        </Explain>
      </Panel>

      <Panel title="What §13 requires before any of this becomes editable"
        note="Two conditions, and the second one is not about schema.">
        <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
          <li>
            <span className="font-semibold text-gray-900">High-impact payment or entitlement behaviour needs approval and safe simulation.</span>{" "}
            A dunning parameter decides when somebody loses access. §17&apos;s dry-run and §16&apos;s
            approval states are not optional here, and neither is modelled — there is no simulation and
            no approval record.
          </li>
          <li>
            <span className="font-semibold text-gray-900">Configuration must not reinterpret accounting rules.</span>{" "}
            A grace period changes when access ends; it must not change what was owed, when it was
            recognised, or what a ledger says. That boundary is a discipline rather than a column, and
            it is the reason §13 keeps plan and price truth in Commercial rather than here.
          </li>
        </ul>
      </Panel>

      <RungSummary rungs={LADDER} />
      <DomainSections domain={D} refusalWhy={refusalFor("cfg.practice_domain_settings").why} />

      <NotThisModule>
        §23 and §31: plans, prices, subscriptions and payment state are Commercial&apos;s truth and this
        module only references them. Entitlement — whether a plan grants access to a feature — is
        Releases &amp; Capabilities&apos;.
      </NotThisModule>

      <NoReadNote why="Every commercial configuration store is either on the Practice plane and refused to it, or does not exist." />
    </div>
  );
}
