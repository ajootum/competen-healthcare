import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import {
  loadPdReleases, READINESS_GATES, capabilityGraph, SETUP_LABELS,
  subSpec, structureScore, refusalFor,
} from "@/lib/hq/pd-releases";
import {
  ReleaseHeader, Fact, Panel, Absent, AbsentList, Warn, Explain, Cite, Gates, StateModel,
  Structure, Questions, ReadFailures, ReadStamp, NotThisModule,
} from "../_components/release-ui";

// CPR-PD-012J — DEPENDENCIES & READINESS.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7).
//
// ⚠ TWO HALVES, AND THEY COULD NOT BE MORE DIFFERENT.
//
// The DEPENDENCY half is the best-built thing in this module. Every capability declares what it needs,
// in two kinds — other capabilities, and configuration artefacts — the closure rules are exported so a
// reader and a harness use the same rule rather than two copies of it, and the graph resolves in both
// directions. §15's dependency graph is genuinely satisfied.
//
// The READINESS half has no evidence store at all. None of §7's twelve gates has a definition, a result
// or an attestation, so nothing can be Ready, Conditional or Blocked, and nothing can go stale. What
// DOES exist is the live cutover checklist: a hard-coded list in one function, evaluated against the
// database on every load, with its human-attested items kept separate and never auto-greened. It is a
// launch gate for the whole product rather than a gate on a release — and generalising it is the single
// highest-value piece of work this module could commission.
//
// ⚠ AND UNKNOWN IS NEVER PROMOTED TO READY. 012J §6 says it in one line, and it is the rule that decides
// how eight of the twelve gates render here.

export const dynamic = "force-dynamic";

const SPEC = subSpec("dependencies");

export default async function Page() {
  await requireHqCapability("hq.practice.releases.view");
  const r = await loadPdReleases(createAdminClient());

  const score = structureScore(SPEC);
  const graph = capabilityGraph();
  const live = READINESS_GATES.filter(g => g.state === "live").length;
  const partial = READINESS_GATES.filter(g => g.state === "partial").length;
  const noEvidence = READINESS_GATES.filter(g => g.state === "no-evidence").length;
  const auto = r.ops.gate.filter(g => g.kind === "auto");
  const manual = r.ops.gate.filter(g => g.kind === "manual");
  const setupUse = new Map<string, number>();
  for (const n of graph) for (const s of n.def.requiresSetup) setupUse.set(s, (setupUse.get(s) ?? 0) + 1);

  return (
    <div data-wide className="space-y-4">
      <ReleaseHeader
        title="Dependencies & Readiness"
        purpose="What each capability depends on — which is fully modelled — and the twelve readiness gates, none of which has anywhere to record a result."
        spec="CPR-PD-012J · CPR-PD-012 §7, §15"
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="Automatic checks passing"
          value={`${r.ops.gateSummary.autoPass} of ${r.ops.gateSummary.autoTotal}`}
          note="the live launch checklist, re-evaluated against the database on every load — so it cannot go stale" />
        <Fact label="Human checks outstanding"
          value={`${r.ops.gateSummary.manualOutstanding} of ${r.ops.gateSummary.manualTotal}`}
          note="never auto-greened. Automating the rest shrinks this set; it must never hide it" />
        <Fact label="Prescribed gates with evidence"
          value={`${live + partial} of ${READINESS_GATES.length}`}
          note={`${live} answered by a live check, ${partial} partly, ${noEvidence} with no evidence store at all`} />
        <Fact label="Dependency edges" value={String(graph.reduce((n, g) => n + g.def.requires.length + g.def.requiresSetup.length, 0))}
          note="required capabilities and required configuration artefacts, declared in code and resolvable in both directions" />
      </div>

      <ReadFailures problems={r.problems} />

      {/* ── THE HALF THAT WORKS ──────────────────────────────────────────────────────────────────── */}
      <Panel title="The capability dependency graph (§15)"
        note="Two kinds of dependency, kept apart on purpose: a capability that must be ACTIVE, and a configuration artefact that must be SET UP. Collapsing them would lose a distinction a practitioner needs — 'Calendar is off' and 'you have entered no location' are different problems with different fixes.">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
          <table className="w-full min-w-[760px] border-collapse text-[12px]">
            <thead>
              <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                <th scope="col" className="py-1.5 pr-3 font-semibold">Capability</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Needs active</th>
                <th scope="col" className="py-1.5 pr-3 font-semibold">Needs configured</th>
                <th scope="col" className="py-1.5 font-semibold">Blocking for</th>
              </tr>
            </thead>
            <tbody>
              {graph.map(n => (
                <tr key={n.def.id} className="border-b border-gray-100 align-top">
                  <th scope="row" className="py-2 pr-3 text-left font-bold text-gray-900">{n.def.displayName}</th>
                  <td className="py-2 pr-3 text-gray-700">
                    {n.closure.length === 0 ? <span className="text-gray-400">nothing</span> : n.closure.join(", ")}
                  </td>
                  <td className="py-2 pr-3 text-gray-700">
                    {n.def.requiresSetup.length === 0
                      ? <span className="text-gray-400">nothing</span>
                      : n.def.requiresSetup.map(s => SETUP_LABELS[s]).join(", ")}
                  </td>
                  <td className="py-2 text-gray-700">
                    {n.dependents.length === 0
                      ? <span className="text-gray-400">nothing depends on it</span>
                      : `${n.dependents.length} capabilit${n.dependents.length === 1 ? "y" : "ies"} — ${n.dependents.join(", ")}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Explain summary="What the graph can and cannot tell you">
          <p>
            It resolves fully and it is about DECLARATIONS. It says Follow-ups needs Patients and
            Calendar, and that withdrawing Patients would leave five other capabilities standing on
            nothing. It cannot say whether any of them is HEALTHY, because there is no health store,
            and it cannot say whether a particular practice has completed a configuration artefact,
            because that lives in the practice&apos;s own configuration off this plane.
          </p>
          <p className="mt-1">
            ⚠ 012J §10 requires a dependency cycle to be a validation failure. There is no cycle today,
            and the closure functions are written with a visited set so a cycle added tomorrow
            terminates instead of exhausting the stack inside an API route.
          </p>
        </Explain>
        <Cite>
          CapabilityDefinition.requires / requiresSetup / recommends and the exported requiredClosure,
          dependentClosure, setupClosure functions — src/lib/practice/capability-registry.ts:99-112 and
          :296-372.
        </Cite>
      </Panel>

      <Panel title="Configuration artefacts capabilities depend on"
        note="§15: configuration dependencies link to Product Configuration's effective-value checks. These are the five artefacts the catalogue names, with how many capabilities need each.">
        <ul className="flex flex-wrap gap-2">
          {[...setupUse.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => (
            <li key={k} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px]">
              <span className="font-semibold text-gray-900">{SETUP_LABELS[k as keyof typeof SETUP_LABELS] ?? k}</span>
              <span className="ml-2 text-gray-600">needed by {n}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
          ⚠ Whether any of these is actually COMPLETE for a given practice is not asserted anywhere,
          here or in the catalogue. It is a live read against that practice&apos;s own configuration and
          belongs to its setup flow — inventing an answer would be worse than reporting the requirement.
        </p>
      </Panel>

      {/* ── THE GATE THAT REALLY RUNS ────────────────────────────────────────────────────────────── */}
      <Panel title="The one readiness gate that actually runs"
        note="The launch cutover checklist, evaluated against the live database on every load. Automatic and human-attested items are shown separately, because a combined ratio would let a gate with every human step outstanding read as nearly complete.">
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Checked by this page</p>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[12px]">
              {auto.map(g => (
                <li key={g.id}>
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${g.state === "pass" ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${g.state === "pass" ? "bg-[var(--cmp-text-success)]" : "bg-[var(--cmp-text-critical)]"}`} />
                    {g.state === "pass" ? "Pass" : "Fail"}
                  </span>{" "}
                  <span className="font-semibold text-gray-900">{g.label}</span>
                  <span className="block leading-relaxed text-gray-600">{g.detail}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Attested by a person, never by this page</p>
            <ul className="mt-1.5 flex flex-col gap-1.5 text-[12px]">
              {manual.map(g => (
                <li key={g.id}>
                  <span className={`inline-flex items-center gap-1.5 font-semibold ${g.state === "pass" ? "text-[var(--cmp-text-success)]" : g.state === "fail" ? "text-[var(--cmp-text-critical)]" : "text-[var(--cmp-text-warning)]"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${g.state === "pass" ? "bg-[var(--cmp-text-success)]" : g.state === "fail" ? "bg-[var(--cmp-text-critical)]" : "bg-[var(--cmp-color-warning)]"}`} />
                    {g.state === "pass" ? "Attested" : g.state === "fail" ? "Cannot run yet" : "Outstanding"}
                  </span>{" "}
                  <span className="font-semibold text-gray-900">{g.label}</span>
                  <span className="block leading-relaxed text-gray-600">{g.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Explain summary="Why this is a launch gate and not a release gate">
          <p>
            It asks whether Competen Practice as a product is ready to be used at all — are the routes
            deployed, is identity connected, has a workspace reached ACTIVE, did the clinical loop close
            once. Those questions have one answer for the whole product, and once true most of them stay
            true. A release gate asks a different question every time: is THIS change safe to expand.
          </p>
          <p className="mt-1">
            ⚠ It also has no freshness rule, because it has no stored result to become stale — it is
            recomputed on every load. That is honest today and it is exactly what 012J §6 forbids
            relying on once evidence is stored: a stored Ready must be able to revert to Unknown.
          </p>
        </Explain>
      </Panel>

      {/* ── §7's TWELVE ─────────────────────────────────────────────────────────────────────────── */}
      <Panel title="The twelve prescribed gates (§7)"
        note="Each with the minimum question the specification sets and what this plane can actually evidence. Unknown is never promoted to Ready.">
        <Gates gates={READINESS_GATES} />
      </Panel>

      <Absent {...(() => { const x = refusalFor("rel.readiness_gates"); return { what: x.label, why: x.why }; })()} />

      <Panel title="The readiness states 012J prescribes"
        note="Five states, and which of them anything here can hold.">
        <StateModel rows={SPEC.states} holdLabel="Can a gate hold this state?" />
      </Panel>

      <Panel title="What 012J §3 asks this screen to show"
        note={`Eight prescribed elements, ${score.yes} in full and ${score.partial} in part.`}>
        <Structure rows={SPEC.structure} />
      </Panel>

      <Questions id={SPEC.id} questions={SPEC.questions} answers={[
        "Fully answered for capabilities: what each needs active, what each needs configured, and what breaks if it is withdrawn. Not answered for a release, which has no dependency record.",
        "The live checks are genuinely Ready or Blocked. Eight of the twelve prescribed gates are Unknown, and Unknown is never shown as Ready.",
        "The live checks are re-evaluated at request time, so their freshness is this page's read stamp. Nothing else has evidence to be fresh or stale.",
        "For the product's launch: whatever the checklist above reports as failing or outstanding. For a release or a capability: nothing prevents progression, because nothing gates it.",
      ]} />

      <Panel title="Not shown, and why">
        <AbsentList items={["rel.readiness_gates", "rel.release_approvals", "rel.post_deploy_verification", "rel.release_content"].map(refusalFor)} />
      </Panel>

      <Warn title="Exceptions have nowhere to live, and that is a governance gap rather than a display one">
        <p>
          §7 allows a failed gate to be overridden by an authorized exception or risk acceptance, and
          requires the exception to link to Governance &amp; Risk and to be visible at the release. No
          exception record exists anywhere, and the risk-acceptance capability is deliberately withheld
          from this position. So a blocked release could only be unblocked by a decision nobody wrote
          down — which is the outcome the exception model exists to prevent.
        </p>
      </Warn>

      <NotThisModule>
        Dependency HEALTH is Product Health&apos;s answer and configuration validity is Product
        Configuration&apos;s; §7 has this module read their evidence rather than compute its own. The
        launch checklist in its operational context is on{" "}
        <Link href="/super-admin/pd/operations/launch-readiness" className="font-semibold text-teal-700 hover:underline">Launch Readiness</Link>.
      </NotThisModule>

      <ReadStamp at={r.generatedAt} />
    </div>
  );
}
