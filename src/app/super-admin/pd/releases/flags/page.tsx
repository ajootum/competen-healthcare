import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases,
  FLAG_ORDER, FLAG_CONSEQUENCE, SUPABASE_GATE_NOTE, refusalFor, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Stat, Fact, Panel, AbsentList, Warn, Explain, Verdict,
  WritesAndApprovals, ReadFailures, ReadStamp, NotThisModule,
  StateModel, Structure, Questions,
} from "../_components/release-ui";

// CPR-PD-012 §8 — FEATURE FLAGS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ TWO FLAG SYSTEMS, TWO PLANES, AND MERGING THEM WOULD BE THE WORST DEFECT THIS PAGE COULD SHIP.
//
//   practice_platform_flags — THREE flags, ordered, global, about Competen Practice. They decide
//   whether anybody may be provisioned, sign in, or sign up. This is the landlord's real control.
//
//   plat_feature_flags / _assignments — the HOSPITAL ESTATE's flag catalogue, scoped per tenant,
//   country, plan or cohort. Different product, different tenancy, different readers. No CP.*
//   capability is reachable from it and no assignment there changes anything in Competen Practice.
//
// A combined "N feature flags" tile would be arithmetic across two products. So they are two panels,
// each labelled, and the estate panel says plainly that it governs something else.
//
// ⚠ AND THE FOURTH GATE. A launch flag reading ON does not mean signup is open: Supabase Auth's own
// project-level "allow new users to sign up" switch sits above all three, lives in the Supabase
// dashboard, and no code in this repository can read it. That sentence exists on the Mission Control
// widget and was once missing from the operator console. It is carried here beside the flags rather
// than hidden in a disclosure, because it changes what the word ON means.

export const dynamic = "force-dynamic";

const SPEC = subSpec("flags");
const SCORE = structureScore(SPEC);

const FLAG_LABEL: Record<string, string> = {
  practice_pilot_provisioning: "Pilot provisioning",
  practice_sign_in: "Sign-in open",
  practice_public_signup: "Public signup",
};

const RECORD_FIELDS: { field: string; practice: boolean; estate: boolean; note: string }[] = [
  { field: "Key", practice: true, estate: true, note: "primary key on both tables" },
  { field: "Description / purpose", practice: true, estate: true, note: "`note` on the Practice flag, `description` on the estate flag" },
  { field: "Linked capability", practice: false, estate: false, note: "neither table references a capability; the estate flag references a PRODUCT code instead" },
  { field: "Owner", practice: false, estate: false, note: "⚠ §8: \"every production flag must have an owner\". Neither table has the column" },
  { field: "Environment", practice: false, estate: false, note: "one production environment; no environment column exists" },
  { field: "Type (release / experiment / kill switch / compatibility)", practice: false, estate: false, note: "not modelled. A kill switch and an experiment are stored identically" },
  { field: "Default", practice: false, estate: true, note: "`default_on` on the estate flag. A Practice flag has a value and no declared default" },
  { field: "Allowed targeting", practice: false, estate: true, note: "estate scope_type: global, tenant, country, plan, cohort. A Practice flag is global only" },
  { field: "Expiry / review date", practice: false, estate: false, note: "⚠ §8 asks for this to prevent permanent hidden product states. A temporary flag is indistinguishable from a permanent one" },
  { field: "Audit state", practice: true, estate: true, note: "a Practice flip writes practice_audit_event; an estate assignment records created_by and created_at" },
];

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const held = (c: string) => ctx.isOwner || ctx.capabilities.includes(c);
  const publiclyLive = FLAG_ORDER.filter(f => r.ops.flags[f] && f !== "practice_pilot_provisioning");
  const governed = RECORD_FIELDS.filter(f => f.practice || f.estate).length;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Feature Flags"
        purpose="The flags that actually decide what Competen Practice exposes, the estate flag system that governs a different product, and the four governance fields §8 requires that neither carries."
        spec="CPR-PD-012 §8, §19"
      />

      {/* STANDING STATEMENT OF WHAT IS PUBLICLY LIVE. Not a toast: whoever opens this page sees it,
          including somebody who did not flip it and does not know it moved. */}
      {publiclyLive.length > 0 && (
        <Warn title="Live on the public site right now">
          <ul className="flex flex-col gap-1">
            {publiclyLive.map(f => (
              <li key={f}>
                <span className="font-mono font-semibold">{f}</span> — {FLAG_CONSEQUENCE[f]}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-gray-700">⚠ {SUPABASE_GATE_NOTE}</p>
        </Warn>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Launch state (§19)" value={r.ops.launch.state} note={r.ops.launch.detail} />
        <Fact label="Practice launch flags" value={`${r.ops.flagRows.length} of ${FLAG_ORDER.length}`}
          note="rows found for the three flags the ladder expects. A missing row is neither on nor off and is shown as such." />
        <Stat label="Estate feature flags" figure={r.flags.catalogue}
          scope="⚠ the hospital estate's catalogue — a different product, on a different plane" />
        <Stat label="Estate flag assignments" figure={r.flags.assignments}
          scope="targeting rows across tenant, country, plan and cohort scopes" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE THREE THAT MATTER ────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Competen Practice launch flags — the real exposure control"
        note="practice_platform_flags, in FLAG_ORDER, read through the same loader the operator console uses. Each consequence is imported from FLAG_CONSEQUENCE, which the flags API also imports, so the warning at the moment of a flip and the standing warning afterwards cannot say different things.">
        <ol className="flex flex-col gap-2">
          {FLAG_ORDER.map((f, i) => {
            const row = r.ops.flagRows.find(x => x.flag === f);
            const on = !!r.ops.flags[f];
            return (
              <li key={f} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-gray-500">{i + 1}</span>
                  <span className="text-[13px] font-bold text-gray-900">{FLAG_LABEL[f] ?? f}</span>
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${!row ? "text-gray-500" : on ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${!row ? "bg-gray-400" : on ? "bg-[var(--cmp-color-warning)]" : "bg-gray-300"}`} />
                    {!row ? "No row for this flag" : on ? "ON" : "OFF"}
                  </span>
                  <span className="font-mono text-[10px] text-gray-500">{f}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{FLAG_CONSEQUENCE[f]}</p>
                {row?.note && <p className="mt-0.5 text-[11px] text-gray-500">{row.note}</p>}
              </li>
            );
          })}
        </ol>

        <div className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3">
          <p className="text-[12px] font-bold text-gray-800">⚠ The gate above these three, which no code here can read</p>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{SUPABASE_GATE_NOTE}</p>
        </div>

        <Explain summary="Why these are a ladder rather than three independent switches">
          <p>
            The named launch state is DERIVED from the three rather than stored separately, so it cannot
            drift from them: public signup on means controlled launch; sign-in on with signup off means
            private pilot; pilot provisioning alone means development, where the public pages say
            &quot;not open yet&quot; and mean it. Turning sign-in on is a public-facing change — it
            replaces a transparent notice with a real password field.
          </p>
          <p className="mt-1">
            ⚠ §8 requires that a kill switch fail toward a known safe posture. These do: every one of
            them is closed-by-default, and turning any of them off withdraws an entry pathway without
            touching anybody already inside.
          </p>
        </Explain>
      </Panel>

      {/* ── THE OTHER PLANE ──────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="Estate feature flags — a different product, shown so it is not mistaken for this one"
        note="plat_feature_flags with their assignments. ⚠ These govern the hospital estate: tenants, hospitals and the workspaces above Competen Practice. No CP.* capability is reachable from any of them.">
        {!r.flags.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The estate flag catalogue could not be read. That is not zero flags.
          </p>
        ) : r.flags.rows.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The catalogue answered and holds no rows — a measured empty table.
          </p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
            <table className="w-full min-w-[720px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Flag</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Product</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Default</th>
                  <th scope="col" className="py-1.5 font-semibold">Targeting</th>
                </tr>
              </thead>
              <tbody>
                {r.flags.rows.map(f => (
                  <tr key={f.key} className="border-b border-gray-100 align-top">
                    <th scope="row" className="py-2 pr-3 text-left">
                      <span className="block font-mono text-[11px] font-bold text-gray-900">{f.key}</span>
                      <span className="block font-normal leading-relaxed text-gray-600">{f.description || "no description"}</span>
                    </th>
                    <td className="py-2 pr-3 font-mono text-[10px] text-gray-500">{f.productCode || "none"}</td>
                    <td className="py-2 pr-3">
                      <Verdict ok={f.defaultOn} yes="On by default" no="Off by default" />
                    </td>
                    <td className="py-2 text-gray-700">
                      {f.assignments.length === 0
                        ? <span className="text-gray-500">no assignment — the default decides</span>
                        : f.assignments.map((a, i) => (
                          <span key={`${a.scopeType}-${a.scopeRef ?? "global"}-${i}`} className="mr-2 inline-block whitespace-nowrap">
                            {a.scopeType}
                            {a.scopeRef ? <span className="font-mono text-[10px] text-gray-500">:{a.scopeRef.slice(0, 8)}</span> : null}
                            {" "}<span className={a.enabled ? "font-semibold text-[var(--cmp-text-success)]" : "font-semibold text-gray-600"}>{a.enabled ? "on" : "off"}</span>
                          </span>
                        ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Explain summary="What its scopes prove, and what they do not">
          <p>
            The estate assignment table already has <span className="font-mono">country</span>,{" "}
            <span className="font-mono">plan</span> and <span className="font-mono">cohort</span> as
            legal scopes. That is more targeting than the configuration engine has, and it is the
            closest thing in this repository to §12&apos;s market availability and §13&apos;s plan
            availability — <span className="font-semibold">for the wrong product</span>. It cannot name
            a Practice workspace and cannot name a CP.* capability, so it is a proof that the shape is
            buildable rather than a partial implementation of it.
          </p>
          <p className="mt-1">
            ⚠ Assignment rows are CREATED, never versioned. So the history answers &quot;this was
            set&quot; and can never answer &quot;this changed from on to off&quot;.
          </p>
        </Explain>
      </Panel>

      {/* ── §8's CANONICAL RECORD, SCORED ────────────────────────────────────────────────────────── */}
      <Panel title="What §8 asks a flag record to carry"
        note={`Ten fields, scored separately for each flag system because they are different tables with different columns. ${governed} are carried by at least one of them.`}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[720px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-500">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Field (§8)</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Practice launch flag</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Estate flag</th>
                <th scope="col" className="py-1.5 font-semibold">Note</th>
              </tr>
            </thead>
            <tbody>
              {RECORD_FIELDS.map(f => (
                <tr key={f.field} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-1.5 pr-3 text-left font-bold text-gray-900">{f.field}</th>
                  <td className="py-1.5 pr-3"><Verdict ok={f.practice} yes="Yes" no="No" /></td>
                  <td className="py-1.5 pr-3"><Verdict ok={f.estate} yes="Yes" no="No" /></td>
                  <td className="py-1.5 leading-relaxed text-gray-700">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.flag_governance", "rel.rollout_percentage", "rel.kill_switch"].map(refusalFor)} />
      </Panel>

      <Warn title="A flag is not entitlement, and this page must not be read as though it were">
        <p>
          §8: <em>&quot;Flag state is not entitlement truth and must not bypass server-side
          authorization.&quot;</em> None of the flags above grants anybody access to anything. Every
          Practice API route re-checks the caller&apos;s own capability on the Practice plane, and every
          page in this workspace re-checks an HQ capability on arrival. Turning{" "}
          <span className="font-mono text-[11px]">practice_sign_in</span> on renders a form; it does not
          admit anybody who could not already have been admitted.
        </p>
      </Warn>

      <WritesAndApprovals
        canActivate={held("hq.practice.release.activate")}
        canRollback={held("hq.practice.release.rollback")}
        canApprove={held("hq.practice.change.approve")}
        canFlags={held("hq.practice.flags.manage")}
      />

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for a flag`}
        note="Six states. On and Off are real for all three launch flags; the four that would make a flag governed are not.">
        <StateModel rows={SPEC.states} holdLabel="Can a flag hold this state?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "The three Practice launch flags, with their state and what each one currently means for the public site. The estate catalogue is listed separately because it governs a different product.",
        "A Practice launch flag is global and has no targeting at all. Estate flags target by tenant, country, plan or cohort, and each one's targets are shown.",
        "Unanswerable, and that is §8's own warning. Neither flag table carries an owner, a type or an expiry, so a temporary flag is indistinguishable from a permanent one.",
        "Yes, for all three. Each fails toward closed, each withdraws an entry pathway rather than granting anything, and every Practice route re-checks the caller's own capability regardless of any flag.",
      ]} />

      <NotThisModule>
        The toggles for these three flags live on{" "}
        <Link href="/super-admin/platform-ops/practice" className="font-semibold text-teal-700 hover:underline">Technical Operations</Link>,
        which PD-001 §3 retains, and the ladder in the context of the cutover checklist is on{" "}
        <Link href="/super-admin/pd/operations/launch-readiness" className="font-semibold text-teal-700 hover:underline">Launch Readiness</Link>.
        This page states what each flag currently means for the product.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
