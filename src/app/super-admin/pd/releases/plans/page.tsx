import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPlanAvailability, CAPABILITY_REGISTRY, subSpec, structureScore, refusalFor,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, StateModel, Structure,
  Questions, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012H — PLAN AVAILABILITY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THE MATRIX HAS TWO REAL AXES AND NO CELLS.
//
// Plans exist. Capabilities exist. Nothing connects them: no capability column on a plan, no plan
// column on an activation, and no join table between the two. So a plan-capability matrix drawn here
// would have to invent every cell it contained, and the invention would be commercially consequential
// — a tick in a cell is a claim about what somebody has bought.
//
// ⚠ AND THERE ARE TWO PLAN CATALOGUES, ON TWO PLANES, WHICH IS ITSELF THE FINDING. The platform's own
// catalogue is readable here. The Practice-side catalogue is admitted to this plane as a ROW COUNT and
// nothing else — its plan codes and names are not reachable from a super-admin page — so this module
// can say how many Practice plans exist and cannot say what they are called.
//
// §13 is emphatic that Commercial owns plan and pricing master data and that this module references it
// rather than recreating it. That is easy to honour here, because there is nothing to recreate.

export const dynamic = "force-dynamic";

const SPEC = subSpec("plans");

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const p = await loadPlanAvailability(createAdminClient());

  const score = structureScore(SPEC);
  const active = p.platformPlans.filter(x => x.active).length;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Plan Availability"
        purpose="Which plan entitles a practice to which capability — the two plan catalogues that exist, and the mapping between plans and capabilities that does not."
        spec="CPR-PD-012H · CPR-PD-012 §13"
      />

      <Warn title="Nothing joins a capability to a plan, in either direction">
        <p>
          §13 asks for capabilities mapped to eligible plans with effective dates, transition rules and
          grandfathering.{" "}
          <span className="font-semibold">
            There is no mapping object, no capability column on a plan and no plan column on a
            capability activation.
          </span>{" "}
          A practice&apos;s plan and the capabilities it has switched on are recorded separately and
          never meet, so buying a bigger plan grants nothing and switching a capability on costs
          nothing.
        </p>
        <p className="mt-1.5">
          That is not a gap a query closes. Both halves are stored and there is no key between them, so
          plan availability is a schema away rather than a report away — and until it exists, every
          state 012H prescribes is unreachable, including the two that protect customers:
          grandfathering, and a transition that does not remove access mid-workflow.
        </p>
        <Cite>
          practice_entitlement.plan_code (migration 191:138-150), practice_plans (191:249-254),
          plat_plans (042), practice_capability_activation (278:85). No shared key, and no migration
          creates a plan_capability_mapping, plan_transition_rule or grandfathering_rule table.
        </Cite>
      </Warn>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Platform plans"
          value={p.platformRead ? String(p.platformPlans.length) : "Could not be read"}
          note={p.platformRead ? `${active} currently active — Commercial's own catalogue` : "the read did not complete; that is not zero plans"} />
        <Fact label="Practice plan catalogue"
          value={p.practicePlanCount === null ? "Could not be read" : String(p.practicePlanCount)}
          note="⚠ a row count is all this plane may read of it — the plan codes and names are not reachable from here" />
        <Fact label="Capabilities" value={String(CAPABILITY_REGISTRY.length)}
          note="each available to every practice regardless of plan, because no plan grants or withholds one" />
        <Fact label="Plan-capability mappings" value="0"
          note="a statement about the schema: there is nowhere for a mapping to be stored, so none exists" />
      </div>

      <ReadFailures problems={p.problems} />

      {/* ── THE TWO CATALOGUES ───────────────────────────────────────────────────────────────────── */}
      <Panel title="The platform plan catalogue"
        note="§13: reference authoritative Commercial plan identifiers; do not recreate plans or pricing here. These are shown for reference and no price appears on this page.">
        {!p.platformRead ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The plan catalogue could not be read. That is not zero plans.
          </p>
        ) : p.platformPlans.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The catalogue answered and holds no plans — a measured empty table.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {p.platformPlans.map(x => (
              <li key={x.code}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px]">
                <span className="font-semibold text-gray-900">{x.name}</span>
                <span className="ml-2 font-mono text-[10px] text-gray-400">{x.code}</span>
                {!x.active && <span className="ml-2 text-[11px] font-semibold text-gray-500">inactive</span>}
              </li>
            ))}
          </ul>
        )}
        <Explain summary="Why the Practice plan catalogue is a number and not a list">
          <p>
            The platform-plane allowlist admits practice_plans with NO COLUMNS and a permitted row
            count. So this page may ask how many Practice plans exist and may not ask what they are
            called — a boundary decision recorded beside the grant, not an oversight in this module.
          </p>
          <p className="mt-1">
            ⚠ It also means the two catalogues cannot be reconciled from here. Whether the Practice
            plan codes correspond to the platform plan codes is a question this plane cannot answer, and
            §13&apos;s requirement that commercial entitlement and capability availability &quot;reconcile
            deterministically&quot; has no reconciliation to check.
          </p>
        </Explain>
      </Panel>

      {/* ── THE MATRIX THAT CANNOT BE DRAWN ──────────────────────────────────────────────────────── */}
      <Panel title="The plan-capability matrix"
        note="§3 of 012H asks for this first. Both axes are real; every cell would be invented, and a tick in a cell is a claim about what a practice has bought.">
        <div className="rounded-xl border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] p-4">
          <p className="text-[12px] font-bold text-gray-700">Not drawn — every cell would be invented</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
            The rows would be the {CAPABILITY_REGISTRY.length} capabilities and the columns would be the
            plans, and nothing decides any cell. Drawing it filled would misstate what customers have
            bought; drawing it empty would say every plan excludes every capability, which is equally
            untrue — today every capability is available to every practice on every plan.
          </p>
        </div>
      </Panel>

      {/* ── STATE MODEL ──────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The plan availability states 012H prescribes"
        note="Five states, and what in this product could hold each of them. The last two exist to protect customers from losing access, which is why their absence is the one that matters.">
        <StateModel rows={SPEC.states} holdLabel="Can a mapping hold this state?" />
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          ⚠ §6 of 012H: <em>do not silently remove a capability during an active critical
          workflow</em>. Nothing here can remove a capability by changing a plan, so the rule cannot
          currently be broken — and it also cannot be honoured, because the day the mapping is built the
          transition rule has to be built with it rather than after it.
        </p>
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.entitlement_plan_mix"); return { what: x.label, why: x.why }; })()} />

      <Panel title="What 012H §3 asks this screen to show"
        note={`Eight prescribed elements, ${score.yes} shown in full and ${score.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Every plan includes every capability, because no plan includes or excludes any. That is the honest answer and it is not a policy anybody chose.",
        "Commercial's own plan catalogue, linked below. Nothing on this page duplicates a plan or a price.",
        "They are not handled, because there is nothing to grandfather: no mapping has ever changed, since none exists.",
        "It cannot today — a plan change alters no capability. The risk arrives with the mapping, and the transition rule has to arrive at the same time.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.entitlement_plan_mix", "rel.availability_decision", "rel.market_availability"].map(refusalFor)} />
      </Panel>

      <NotThisModule>
        Plans, prices, subscriptions and conversion are Commercial&apos;s truth —{" "}
        <Link href="/super-admin/pd/commercial/plans" className="font-semibold text-teal-700 hover:underline">Plans &amp; Pricing</Link>{" "}
        is authoritative and this page references it. §27: this module is not commercial master data.
      </NotThisModule>

      <ReadStamp at={p.generatedAt} />
    </div>
  );
}
