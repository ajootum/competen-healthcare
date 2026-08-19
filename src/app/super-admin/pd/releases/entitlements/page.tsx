import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases,
  RESOLVER_CONDITIONS, refusalFor, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, AbsentList, Warn, Explain, Conditions, Verdict,
  PlaneRefusal, ReadFailures, ReadStamp, NotThisModule,
  StateModel, Structure, Questions,
} from "../_components/release-ui";

// CPR-PD-012 §10, §11 — ENTITLEMENTS & AVAILABILITY.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ THREE DIFFERENT THINGS IN THIS CODEBASE ARE CALLED A "CAPABILITY", AND A BUILD THAT CONFUSES THEM
// SHIPS A BROKEN ENTITLEMENT MODEL. The capability registry's own header is emphatic about it, so this
// page states the three before it states anything else — a Product Director asking "who may use this"
// gets three different answers depending on which one they meant, and only one of them is this module's.
//
//   SECURITY  capability_code — patient.edit, encounter.edit, about fifty more. What may THIS USER do.
//             Per membership. Checked on every Practice API call. Not this module.
//   COMMERCIAL CP.* — twelve ids. What has THIS PRACTICE switched on. Per workspace. THIS MODULE.
//   ESTATE    plat_feature_flags — the hospital estate's flags, per tenant. A different product.
//
// They are independent in both directions and neither may ever be derived from the other: deactivating
// a capability must not revoke anybody's permission, and granting a permission must not switch a
// product on. The engine that enforces that touches no permission table.
//
// ⚠ AND §11's RESOLVER IS NOT BUILT HERE, DELIBERATELY. Five of its eleven conditions have no store at
// all and one more is refused to this plane. A resolver that evaluated only what it could see would
// return a machine-readable "available" from a partial evaluation — and a machine-readable verdict
// carries more authority than a sentence, so it would be wrong more convincingly. The conditions are
// scored instead, which is the same information without the false decision.

export const dynamic = "force-dynamic";

const SPEC = subSpec("entitlements");
const SCORE = structureScore(SPEC);

const AXES = [
  {
    axis: "Security — what may this USER do",
    store: "practice_role_capabilities → practice_role_assignment",
    scope: "per membership",
    detail:
      "About fifty codes — patient.edit, encounter.edit, appointment.manage, billing.view — copied from "
      + "the role catalogue at provision time and checked on every Practice API call. This is "
      + "authorization, it is enforced server-side, and it is not what this module governs.",
    readable: true,
    readNote: "row count only, to prove the catalogue migrations are live. No column is selected.",
  },
  {
    axis: "Commercial — what has this PRACTICE switched on",
    store: "practice_capability_activation",
    scope: "per workspace",
    detail:
      "The twelve CP.* capabilities, with state, source, mode provenance and activation timestamps. "
      + "This IS PD-012's capability, and it is the answer to §10's question at the practice level.",
    readable: false,
    readNote: "not on the platform-plane allowlist — the rows exist and this page may not read them.",
  },
  {
    axis: "Estate — what is exposed to this TENANT",
    store: "plat_feature_flags → plat_feature_flag_assignments",
    scope: "per tenant, country, plan or cohort",
    detail:
      "The hospital estate's flag system. Different plane, different tenancy, different readers. It "
      + "cannot name a Practice workspace and cannot name a CP.* capability.",
    readable: true,
    readNote: "platform-plane table, fully readable here. Shown on Feature Flags.",
  },
];

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const resolves = RESOLVER_CONDITIONS.filter(c => c.state === "resolves");
  const refused = RESOLVER_CONDITIONS.filter(c => c.state === "refused");
  const noStore = RESOLVER_CONDITIONS.filter(c => c.state === "no-store");

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Entitlements & Availability"
        purpose="Who is permitted to use a capability — the three separate systems this codebase calls a capability, and the eleven conditions §11's resolver would have to evaluate."
        spec="CPR-PD-012 §10, §11"
      />

      <Warn title="Three different things here are called a capability, and only one of them is this module's">
        <p>
          The capability registry&apos;s own header sets this out because collapsing any two of them
          ships a broken entitlement model. <span className="font-semibold">Activation is not
          permission.</span> Deactivating Quick Encounters for a practice must not revoke anybody&apos;s{" "}
          <span className="font-mono text-[11px]">encounter.edit</span> grant — somebody who turns a
          product off for a month has not been demoted — and adding a colleague to the team must not
          switch on a product the practice never bought.
        </p>
        <p className="mt-1.5">
          The effective gate on any surface is <span className="font-semibold">both</span>: the practice
          has activated the capability AND the user holds the permission. Neither is ever derived from
          the other, and the activation engine touches no permission table at all.
        </p>
      </Warn>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Fact label="Resolver conditions that resolve here" value={`${resolves.length} of ${RESOLVER_CONDITIONS.length}`}
          note={resolves.map(c => c.condition).join(", ")} />
        <Fact label="Refused to this plane" value={`${refused.length}`}
          note="the fact exists and the Practice product writes it; this plane may not read it" />
        <Fact label="No store at all" value={`${noStore.length}`}
          note="nothing anywhere records the fact these conditions would test" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE THREE AXES ───────────────────────────────────────────────────────────────────────── */}
      <Panel title="The three axes, kept apart"
        note="Each with its store, its scope, and whether this plane may read it. A page that merged them would answer the wrong question confidently.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[820px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Axis</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Store</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Scope</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Readable here</th>
                <th scope="col" className="py-1.5 font-semibold">What it decides</th>
              </tr>
            </thead>
            <tbody>
              {AXES.map(a => (
                <tr key={a.axis} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-bold text-gray-900">{a.axis}</th>
                  <td className="py-2 pr-3 font-mono text-[10px] break-words text-gray-700">{a.store}</td>
                  <td className="py-2 pr-3 whitespace-nowrap text-gray-700">{a.scope}</td>
                  <td className="py-2 pr-3">
                    <Verdict ok={a.readable} yes="Yes" no="Refused" />
                    <span className="mt-1 block leading-relaxed text-gray-600">{a.readNote}</span>
                  </td>
                  <td className="py-2 leading-relaxed text-gray-700">{a.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── §11's RESOLVER ───────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Why available, or not available (§11) — the eleven conditions"
        note="§11 requires a resolver returning a machine-readable decision plus safe human-readable reason codes. Each condition is scored against what could actually be evaluated from this plane today."
      >
        <Conditions conditions={RESOLVER_CONDITIONS} />
        <Explain summary="Why the resolver itself is not built here">
          <p>
            A decision object carries more authority than a sentence. One built from{" "}
            {resolves.length} of {RESOLVER_CONDITIONS.length} conditions would return
            &quot;available&quot; whenever the conditions it cannot see are the ones that would have
            refused — and a reader would have no way to tell a complete evaluation from a partial one,
            because both return the same shape.
          </p>
          <p className="mt-1">
            The real gate already exists and it is inside the Practice product, where the activation
            rows and the permission grants both live: a surface is shown when the practice has the
            capability active AND the caller holds the permission, checked server-side on every request.
            §10 is explicit that server-side authorization remains authoritative and that hiding UI is
            not access control — which is exactly why nothing on this landlord surface should be treated
            as the answer.
          </p>
        </Explain>
      </Panel>

      {/* ── THE REFUSED READ ─────────────────────────────────────────────────────────────────────── */}
      <PlaneRefusal
        tables={["practice_capability_activation", "practice_capability_activation_event", "practice_entitlement"]}
        why={
          "Which practices have which capability active, when it changed and why; and which plan each "
          + "practice is entitled to. All three are real, written by the product, and outside what this "
          + "plane may read. So this page can name the axis and cannot count along it."
        }
      />

      <Panel title="Not shown, and why">
        <AbsentList items={[
          "rel.capability_activation_estate", "rel.entitlement_plan_mix",
          "rel.availability_decision", "rel.market_availability",
        ].map(refusalFor)} />
      </Panel>

      <Warn title="What §10 requires that no store here can express">
        <p>
          Entitlements must be <span className="font-semibold">explicit, auditable and effective-dated
          where needed</span>. Activation is explicit and auditable — every change writes an event with
          an actor, a source and a reason. It is <span className="font-semibold">not</span>{" "}
          effective-dated: a row records when a capability was switched on and off, and cannot express
          &quot;entitled from 1 April&quot; or an entitlement that lapses on a date. And there is no
          entitlement RULE object at all, so an entitlement can only ever be a stored fact about one
          practice, never a policy that decides for many.
        </p>
      </Warn>

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for availability`}
        note="Four states. Unknown is the honest one from here, and it is why no resolver is offered.">
        <StateModel rows={SPEC.states} holdLabel="Can this plane reach this verdict?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Recorded per workspace, and on the Practice plane. This page names the axis and its store; it cannot look a subject up.",
        "The eleven conditions are scored above with the reason for each. No decision is returned, because five have no store at all and one more is refused to this plane.",
        "Only one condition can block from here: a launch flag closing the product's front door. Every other condition is evaluated inside the Practice product, on each request.",
        "There are no entitlement rules at all, so nothing can conflict or go stale. Entitlement here is a stored fact about one practice, never a policy that decides for many.",
      ]} />

      <NotThisModule>
        §1: whether a capability is FUNCTIONING is Product Health&apos;s question, and how it behaves
        once enabled is Product Configuration&apos;s. The authoritative plan and subscription data §13
        refers to belongs to{" "}
        <Link href="/super-admin/pd/commercial/plans" className="font-semibold text-teal-700 hover:underline">Commercial</Link>,
        and is referenced rather than recreated here.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
