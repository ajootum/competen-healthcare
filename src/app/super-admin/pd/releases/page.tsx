import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases,
  SUBMODULES, ROLLOUT_STAGES, LIFECYCLE, LIFECYCLE_ABSENCE, refusalFor, FLAG_ORDER,
  FLAG_CONSEQUENCE, SUPABASE_GATE_NOTE, subSpec, structureScore,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Stat, Fact, Panel, Absent, AbsentList, Warn, ModuleLink, Explain, Pipeline,
  Lifecycle, AttentionList, WritesAndApprovals, ReadFailures, ReadStamp, NotThisModule,
  StateModel, Structure, Questions,
} from "./_components/release-ui";

// CPR-PD-012 §5 — RELEASE & CAPABILITY OVERVIEW.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ WHAT THIS SCREEN LEADS WITH, AND WHY IT IS NOT A ROLLOUT PIPELINE.
//
// §5 asks for the current production release, active rollouts by stage and percentage, capabilities by
// lifecycle state, and blocked readiness gates. Of those four, ONE has a producer — and it is a table
// a human types into. There is no rollout object, no lifecycle field and no gate result anywhere in
// this schema, so three of §5's four headline panels would have been drawn from nothing.
//
// So this page leads with what the landlord genuinely controls TODAY: the launch ladder. Three ordered
// flags, each with a consequence sentence written in the same constant the API and the operator console
// use, and the fourth gate nobody's code can read stated beside them. That is a real control plane, it
// is small, and saying so is the difference between a Product Director trusting this screen and
// discovering later that the rollout dial was decoration.
//
// ⚠ AND THE PIPELINE IS STILL DRAWN. §9's seven stages appear in shape, each carrying its own verdict,
// because the shape is where a figure lands the day a producer exists — and because a reader who has
// seen the comp needs to be told which stages are real rather than left to assume all seven are.

export const dynamic = "force-dynamic";

const SPEC = subSpec("overview");
const SCORE = structureScore(SPEC);

const FLAG_LABEL: Record<string, string> = {
  practice_pilot_provisioning: "Pilot provisioning",
  practice_sign_in: "Sign-in open",
  practice_public_signup: "Public signup",
};

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const held = (c: string) => ctx.isOwner || ctx.capabilities.includes(c);
  const controlled = ROLLOUT_STAGES.filter(s => s.state === "controlled").length;
  const stagesAbsent = ROLLOUT_STAGES.filter(s => s.state === "absent").length;

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Release & Capability Overview"
        purpose="What is shipping, what is exposed, what is blocked — and which parts of the release model this product can express at all."
        spec="CPR-PD-012 §5, §9, §19"
      />

      {/* ── THE LAUNCH LADDER: the one real control plane, first ─────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Launch state (§19)" value={r.ops.launch.state} note={r.ops.launch.detail} />

        <Fact
          label="Current production release"
          value={r.releases.current ? r.releases.current.version : r.releases.read ? "None recorded" : "Could not be read"}
          note={
            r.releases.current
              ? `${r.releases.current.channel} channel, released ${String(r.releases.current.releasedAt).slice(0, 10)}`
              : r.releases.read
                ? "The release log answered and holds no released row. A measured empty table, not an unreadable one."
                : "The release log did not answer — see the failures below. That is not \"no releases\"."
          }
        />

        <Stat label="Governed capabilities" figure={r.capabilities.catalogue}
          scope={`independently governed Practice capabilities; ${r.capabilities.defaultActive} are on for a practice that has stored nothing`} />

        <Stat label="Automatic readiness checks"
          figure={r.gateAutoPass}
          tone={r.ops.gateSummary.fail > 0 ? "critical" : "success"}
          scope={`of ${r.ops.gateSummary.autoTotal} passing, evaluated live. ${r.ops.gateSummary.manualOutstanding} more need a person and are never auto-greened.`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Releases recorded" figure={r.releases.total}
          scope="rows in the platform release log — written by a person, never by a pipeline" />
        <Stat label="Rollbacks recorded" figure={r.releases.rolledBack}
          tone={r.releases.rolledBack.state === "value" && r.releases.rolledBack.value > 0 ? "warning" : "neutral"}
          scope="release rows whose status reads rolled_back" />
        <Stat label="Declared capability dependencies" figure={r.capabilities.dependencyEdges}
          scope="required capabilities, required configuration artefacts and recommendations, across the catalogue" />
        <Stat label="Configuration change sets" figure={r.changeSets.total}
          scope="the estate's configuration release object — not a Competen Practice release" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE HEADLINE FINDING ─────────────────────────────────────────────────────────────────── */}
      <Warn title="This product has activation machinery and no lifecycle machinery — and §4 says those are different things">
        <p>
          PD-012 §4: <em>&quot;Lifecycle state is distinct from a runtime feature flag. A capability
          cannot be made generally available merely by toggling a flag.&quot;</em> The twelve capabilities
          below are real, their dependency graph is real, and each practice can switch each one on or
          off. <span className="font-semibold">Nothing declares that a capability is in Pilot, in Early
          Access, generally available or deprecated</span>, because no field anywhere holds a lifecycle
          state — so the distinction §4 forbids collapsing is currently collapsed by omission.
        </p>
        <p className="mt-1.5">
          The same is true one level up. There is no rollout object, no stage, no cohort, no assignment
          and no percentage; there is no readiness gate result, no approval and no post-deploy
          verification. {stagesAbsent} of §9&apos;s seven stages cannot be entered at all. What the
          landlord genuinely controls is the launch ladder — three ordered flags that decide whether
          anybody may be provisioned, sign in, or sign up.
        </p>
      </Warn>

      {/* ── THE LAUNCH FLAGS ─────────────────────────────────────────────────────────────────────── */}
      <Panel
        title="The launch ladder (§19) — the one genuine rollout control"
        note="practice_platform_flags, read through the same loader the operator console uses, in FLAG_ORDER. Each consequence is imported from the constant the flags API also imports, so the warning shown at the moment of a flip and the warning shown afterwards cannot diverge.">
        <ol className="flex flex-col gap-2">
          {FLAG_ORDER.map((f, i) => {
            const row = r.ops.flagRows.find(x => x.flag === f);
            const on = !!r.ops.flags[f];
            return (
              <li key={f} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-mono text-[11px] text-gray-400">{i + 1}</span>
                  <span className="text-[13px] font-bold text-gray-900">{FLAG_LABEL[f] ?? f}</span>
                  {/* ⚠ NEVER COLOUR ALONE — the dot always travels with its word, and the word for a
                      flag we could not find is neither "on" nor "off". */}
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${!row ? "text-gray-500" : on ? "text-[var(--cmp-text-warning)]" : "text-gray-700"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${!row ? "bg-gray-400" : on ? "bg-[var(--cmp-color-warning)]" : "bg-gray-300"}`} />
                    {!row ? "No row for this flag" : on ? "ON" : "OFF"}
                  </span>
                  <span className="font-mono text-[10px] text-gray-400">{f}</span>
                </div>
                <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{FLAG_CONSEQUENCE[f]}</p>
                {row?.note && <p className="mt-0.5 text-[11px] text-gray-500">{row.note}</p>}
              </li>
            );
          })}
        </ol>
        {/* ⚠ THE FOURTH GATE, AND IT IS NOT IN THIS DATABASE. This sentence lives on the Practice
            Mission Control flags widget and was once missing from the operator console. A flag reading
            ON does not mean signup is open. */}
        <p className="mt-2 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3 text-[12px] leading-relaxed text-gray-700">
          ⚠ {SUPABASE_GATE_NOTE}
        </p>
      </Panel>

      {/* ── NEEDS ATTENTION + WHAT IS NOT SHOWN ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Needs attention (§5)"
          note="Measured exceptions only. §5's other seven triggers cannot appear here at all and are listed opposite, rather than leaving this panel looking clean.">
          {r.attention.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-500">
              No public entry pathway is open, no readiness check is failing, no release row is recorded
              as unfinished and the capability catalogue is internally consistent. That is a measured
              empty set over the facts this plane can see — it is not a statement about rollouts,
              gates or approvals, none of which exist to be clean.
            </p>
          ) : <AttentionList items={r.attention} />}
        </Panel>

        <Panel title="Not shown, and why"
          note="§5 asks for active rollouts, rollout percentage, capabilities by lifecycle state, failed gates, pending approvals and post-deploy health. Each is refused by the metric registry, which holds the reason once so twelve screens cannot each invent one.">
          <AbsentList items={r.refusals} />
        </Panel>
      </div>

      {/* ── THE PIPELINE, IN SHAPE ───────────────────────────────────────────────────────────────── */}
      <Panel
        title="Progressive rollout (§9), and which stages this product can enter"
        note={`${controlled} of ${ROLLOUT_STAGES.length} stages have a real control behind them. Each verdict is a statement about the schema — a check constraint, a missing column, a function that does not exist — checkable at the line named.`}>
        <Pipeline stages={ROLLOUT_STAGES} />
        <div className="mt-3">
          <Absent {...(() => { const x = refusalFor("rel.rollout_percentage"); return { what: x.label, why: x.why }; })()} />
        </div>
      </Panel>

      {/* ── LIFECYCLE ────────────────────────────────────────────────────────────────────────────── */}
      <Panel title="Capability lifecycle (§4), and what could hold it"
        note="§5 asks for a capabilities-by-lifecycle-state chart. There is no state to chart, so the eight states are listed with what would have to exist for each to be assertable.">
        <Lifecycle states={LIFECYCLE} />
        <Explain summary="Why every one of the eight reads the same way">{LIFECYCLE_ABSENCE}</Explain>
      </Panel>

      {/* ── RECENT RELEASES ──────────────────────────────────────────────────────────────────────── */}
      <Panel title="Recent releases and rollbacks (§5)"
        note="plat_deployments, newest first. ⚠ No CI/CD pipeline writes this table — a row exists because a person created one, so this is what was RECORDED rather than what was deployed.">
        {!r.releases.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The release log could not be read. That is not &quot;no releases exist&quot;.
          </p>
        ) : r.releases.rows.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-gray-500">
            The release log answered and holds no rows. Nobody has recorded a release — a measured empty
            table, not an unreadable one — so this module cannot name a current production version.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Version</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Channel</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Status</th>
                  <th scope="col" className="py-1.5 pr-3 font-semibold">Released</th>
                  <th scope="col" className="py-1.5 font-semibold">Note</th>
                </tr>
              </thead>
              <tbody>
                {r.releases.rows.slice(0, 8).map(row => (
                  <tr key={`${row.version}-${row.createdAt}`} className="border-b border-gray-100 align-top">
                    <th scope="row" className="py-2 pr-3 text-left font-mono text-[11px] font-bold text-gray-900">{row.version}</th>
                    <td className="py-2 pr-3 text-gray-700">{row.channel}</td>
                    <td className="py-2 pr-3 font-semibold text-gray-900">{row.status}</td>
                    <td className="py-2 pr-3 whitespace-nowrap text-gray-700">
                      {row.releasedAt ? String(row.releasedAt).slice(0, 10) : "not recorded"}
                    </td>
                    <td className="py-2 leading-relaxed text-gray-600">{row.notes || "no note"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <WritesAndApprovals
        canActivate={held("hq.practice.release.activate")}
        canRollback={held("hq.practice.release.rollback")}
        canApprove={held("hq.practice.change.approve")}
        canFlags={held("hq.practice.flags.manage")}
      />

      {/* ── DRILL-THROUGH ────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The twelve submodules (§2)"
        note="§23: do not make the Product Director reason from raw flag keys alone. Each page names the objects its section owns, what exists behind them, and what does not.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SUBMODULES.map(s => (
            <ModuleLink key={s.key} href={s.href} label={s.title} summary={s.standing} />
          ))}
        </div>
      </Panel>

      {/* ── SCORED AGAINST ITS OWN CHILD SPECIFICATION ──────────────────────────────────────────── */}
      <Panel title={`The states ${SPEC.id} prescribes for the overview`}
        note="Three states, and what can actually raise each of them here.">
        <StateModel rows={SPEC.states} holdLabel="Can this surface reach this state?" />
      </Panel>

      <Panel title={`What ${SPEC.id} §3 asks this screen to show`}
        note={`${SPEC.structure.length} prescribed elements, ${SCORE.yes} shown in full and ${SCORE.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "The launch ladder's current rung, and the last release anybody recorded. Nothing is rolling out, because no rollout can be started.",
        "Needs Attention lists what is measurably open. Nothing can be awaiting a decision here: no approval, exception or exit-decision record exists anywhere in this module.",
        "None of them can be, because no capability carries a lifecycle state. The eight states are listed with what each would need.",
        "Recent releases and rollbacks are above. Nothing can be safely expanded — there is no rollout to expand, and no gate result that could say it was safe.",
      ]} />

      <NotThisModule>
        §1: how an enabled capability BEHAVES is Product Configuration&apos;s answer; whether it is
        FUNCTIONING is Product Health&apos;s; a material failure is coordinated by Support &amp;
        Incidents; and the technical remediation is executed in Product Operations. This module answers
        only whether the capability exists, what is deployed, and who may reach it.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
