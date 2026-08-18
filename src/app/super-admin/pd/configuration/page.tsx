import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdConfiguration, DOMAINS, LIFECYCLE, SAFETY_LABEL } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Stat, Panel, AbsentList, Warn, ModuleLink, Ladder, Explain,
  WritesAndApprovals, ReadFailures, ReadStamp,
} from "./_components/config-ui";

// CPR-PD-011 §6 — CONFIGURATION OVERVIEW.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 §7: "a hidden navigation item does
// not constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation). The await resolves before any JSX is returned, so an
// unauthorized direct URL is redirected without rendering anything.
//
// ⚠ WHAT THIS SCREEN LEADS WITH, AND WHY IT IS NOT THE REGISTRY TOTAL.
//
// This module has more real prior work behind it than any other Product Director module: a populated
// configuration registry whose columns nearly implement §4, an override store with draft/publish and
// version snapshots, a change-set lifecycle that lines up with §16, and a resolver that already returns
// an effective value with a provenance trace. Every one of those figures is real.
//
// And they are all about a DIFFERENT PRODUCT. The registry is seeded from WORKSPACE_CATALOG, which
// catalogues Unit Manager, Shift Supervisor and the Personal Workspace. So the first number on this
// page is how many of those definitions describe Competen Practice, with its denominator beside it —
// because a large registry total under a Product Configuration heading is the most plausible lie this
// screen could tell, and it would end the question rather than raise it.
//
// ⚠ AND THE LADDER IS THE POINT OF THE PAGE. §3 prescribes six rungs. Two of them have no scope value
// in the schema at all, and the tenancy rungs point at `hospitals`. Rendering the inheritance stack
// without those verdicts would advertise a market override that nothing can evaluate.

export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.configuration.view");
  const cfg = await loadPdConfiguration(createAdminClient());

  const canManage = ctx.isOwner || ctx.capabilities.includes("hq.practice.configuration.manage");
  const canApprove = ctx.isOwner || ctx.capabilities.includes("hq.practice.change.approve");
  const rungsResolving = cfg.ladder.filter(r => r.state === "resolves").length;
  const rungsRefused = cfg.ladder.filter(r => r.state === "no-scope" || r.state === "wrong-subject").length;

  return (
    <div data-wide className="space-y-4">
      <ConfigHeader
        title="Configuration Overview"
        purpose="What is configured, what is pending, what is high-risk, and which levels of the configuration hierarchy this product can actually resolve today."
        spec="CPR-PD-011 §3, §6, §16"
      />

      {/* ── THE HEADLINE FINDING, AND IT IS FIRST ────────────────────────────────────────────────
          ⚠ EVERYTHING BELOW THIS BANNER IS ELABORATION OF IT. A Product Director learns one thing on
          this page — the engine is real and Practice is not yet its subject — and the eight tiles, the
          ladder and every domain link are that sentence in more detail. It used to sit under two rows
          of tiles, which made the reader assemble the finding from evidence instead of being told it
          and then shown why. The migration numbers that prove it are in the disclosure, not the claim:
          PD-001 §3 puts implementation detail in Technical Operations, not on this screen. */}
      {cfg.registry.practiceDefinitions.state === "value" && cfg.registry.practiceDefinitions.value === 0 && (
        <Warn title="The configuration engine is real. Competen Practice is not yet its subject.">
          <p>
            Three configuration estates exist here and are populated: a definition registry carrying
            allowed scopes, safety classification, override policy, dependencies and owner; an override
            store with draft, publish, version snapshots and a change trail; and a change-set lifecycle
            whose states line up almost exactly with §16.{" "}
            <span className="font-semibold">None of them holds a Competen Practice setting.</span> The
            registry is seeded from the in-code workspace catalogue, which describes the estate
            workspaces — Unit Manager, Shift Supervisor, the Personal Workspace — and names Practice
            nowhere. So every figure below is true and is about the estate&apos;s configuration, not
            Practice&apos;s.
          </p>
          <Explain summary="The three estates, and where each one is defined">
            <ul className="flex flex-col gap-0.5">
              <li>
                <span className="font-semibold">Definition registry</span> —{" "}
                <span className="font-mono text-[10px]">configuration_registry_objects</span>, migration 092.
                Seeded from <span className="font-mono text-[10px]">WORKSPACE_CATALOG</span> at{" "}
                <span className="font-mono text-[10px]">src/lib/config/registry.ts:77</span>.
              </li>
              <li>
                <span className="font-semibold">Override store</span> —{" "}
                <span className="font-mono text-[10px]">workspace_config_overrides / _versions / _audit</span>, migration 076.
              </li>
              <li>
                <span className="font-semibold">Change sets</span> —{" "}
                <span className="font-mono text-[10px]">configuration_releases / _events</span>, migration 099.
              </li>
            </ul>
          </Explain>
        </Warn>
      )}

      {/* ⚠ TONE IS CONDITIONAL ON THE VALUE, NOT ON THE TILE. Colour is granted only to a real value —
          `Stat` enforces that structurally — but a fixed `tone` would still paint a healthy number red
          the day the number became healthy. A count of high-risk settings is a fact, not a warning,
          until it is above zero; a Practice-definition count is only alarming when it IS zero. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Definitions describing Practice" figure={cfg.registry.practiceDefinitions}
          tone={cfg.registry.practiceDefinitions.state === "value" && cfg.registry.practiceDefinitions.value === 0 ? "critical" : "neutral"}
          scope={cfg.registry.definitions.state === "value"
            ? `of ${cfg.registry.definitions.value.toLocaleString()} configuration definitions in the registry`
            : "of the registry, whose total could not be read"} />

        <Stat label="Configuration definitions" figure={cfg.registry.definitions}
          scope={`registered objects across the estate${cfg.registry.active === null ? "" : ` — ${cfg.registry.active.toLocaleString()} active, ${cfg.registry.draft?.toLocaleString() ?? 0} in review`}`} />

        <Stat label="High-risk settings" figure={cfg.registry.highRisk}
          tone={cfg.registry.highRisk.state === "value" && cfg.registry.highRisk.value > 0 ? "warning" : "neutral"}
          scope="classified clinical-safety, security, regulatory or financial-control critical" />

        <Stat label="Overridden values" figure={cfg.overrides.published}
          scope={cfg.overrides.total === null ? "override rows with a published value" : `of ${cfg.overrides.total.toLocaleString()} override rows`} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Platform-enforced rules" figure={cfg.registry.platformEnforced}
          scope="definitions no lower scope may override" />
        <Stat label="Pending changes" figure={cfg.changeSets.pending}
          scope="unpublished override drafts plus change sets not yet live" />
        <Stat label="Scheduled changes" figure={cfg.changeSets.scheduled}
          scope="change sets with a future effective time" />
        <Stat label="Failed activations" figure={cfg.changeSets.failed}
          tone={cfg.changeSets.failed.state === "value" && cfg.changeSets.failed.value > 0 ? "critical" : "neutral"}
          scope="change sets whose activation failed" />
      </div>

      <ReadFailures problems={cfg.problems} />

      {/* ── THE LADDER, AS A TABLE ───────────────────────────────────────────────────────────── */}
      <Panel
        title="The configuration hierarchy (§3), and which levels resolve today"
        note={`${rungsResolving} of ${cfg.ladder.length} levels resolve; ${rungsRefused} cannot be resolved at all. Each verdict is a statement about the schema — a check constraint, a foreign key, a branch that does not exist — and each row's disclosure carries the full verdict and the line it was read at.`}>
        <Ladder rungs={cfg.ladder} />
        <p className="mt-2.5 text-[12px] leading-snug text-gray-700">
          <span className="font-semibold text-gray-900">The machinery is built and pointed at the wrong six levels.</span>{" "}
          The resolver already returns an effective value together with every contributing layer and its
          scope — which is §5&apos;s &quot;expose effective value plus source scope&quot; answered rather
          than pending. What it resolves along is the estate&apos;s hierarchy, not the product&apos;s.
        </p>
      </Panel>

      {/* ── NEEDS ATTENTION ──────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Needs attention (§6)"
          note="Measured exceptions only. Two of §6's triggers cannot appear here at all and are listed under Not shown, rather than leaving this panel looking clean.">
          {cfg.attention.length === 0 ? (
            <p className="text-[12px] text-gray-500">
              No failed activation, no unresolved dependency, no orphaned definition and no ownerless
              definition among the rows this page read. That is a measured empty set over the stores
              named above — not over Practice&apos;s own configuration, which this plane cannot see.
            </p>
          ) : (
            <ul className="flex flex-col gap-2 text-[12px]">
              {cfg.attention.map(a => (
                <li key={a.label}>
                  <span className={`inline-flex items-center gap-1.5 font-bold ${a.tone === "critical" ? "text-[var(--cmp-text-critical)]" : a.tone === "warning" ? "text-[var(--cmp-text-warning)]" : "text-gray-800"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${a.tone === "critical" ? "bg-[var(--cmp-text-critical)]" : a.tone === "warning" ? "bg-[var(--cmp-color-warning)]" : "bg-gray-400"}`} />
                    {a.tone === "critical" ? "Critical" : a.tone === "warning" ? "Warning" : "For information"}
                  </span>
                  <p className="mt-0.5 font-semibold text-gray-900">{a.label}</p>
                  <p className="leading-snug text-gray-600">{a.detail}</p>
                  {/* ⚠ The citation is how the claim gets checked, so it is kept — behind the
                      disclosure, not in the sentence a director reads. */}
                  {a.cite && <Explain summary="Where to check this">{a.cite}</Explain>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Not shown, and why"
          note="§6 also asks for drift, expired temporary overrides, outstanding approvals, markets configured and affected-Practice previews. Each is refused by the metric registry, which holds the reason once so eleven screens cannot each invent one — open a row for the reason it gives.">
          <AbsentList items={cfg.refusals} />
        </Panel>
      </div>

      {/* ── CHANGE SETS ──────────────────────────────────────────────────────────────────────── */}
      <Panel title="Change sets (§18) and the lifecycle they can express (§16)"
        note="configuration_releases is effectively §18's change-set object already built: title, channel, rollout, included objects, validation result, pre-activation checkpoint and status.">
        {!cfg.changeSets.read ? (
          <p className="text-[12px] text-[var(--cmp-text-warning)]">
            The change-set store could not be read. That is not &quot;no change sets exist&quot;.
          </p>
        ) : cfg.changeSets.rows.length === 0 ? (
          <p className="text-[12px] text-gray-500">
            The change-set store answered and holds no rows. Nobody has grouped a configuration edit into
            a named change set — which is a measured empty table, not an unreadable one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[12px]">
              <thead>
                <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5 pr-3 font-semibold">Change set</th>
                  <th className="py-1.5 pr-3 font-semibold">Channel</th>
                  <th className="py-1.5 pr-3 font-semibold">Rollout</th>
                  <th className="py-1.5 pr-3 font-semibold">Objects</th>
                  <th className="py-1.5 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {cfg.changeSets.rows.map(r => (
                  <tr key={r.key} className="border-b border-gray-100 align-top">
                    <td className="py-2 pr-3">
                      <span className="font-semibold text-gray-900">{r.name}</span>
                      <span className="block font-mono text-[10px] text-gray-400">{r.key}</span>
                    </td>
                    <td className="py-2 pr-3 text-gray-700">{r.channel}</td>
                    <td className="py-2 pr-3 text-gray-700">
                      {r.rollout}{r.scheduledFor ? ` · ${r.scheduledFor.slice(0, 16).replace("T", " ")}` : ""}
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-700">{r.objects}</td>
                    <td className="py-2 font-semibold text-gray-900">{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Explain summary="Which of §16's nine lifecycle states this schema can represent">
          <ul className="mt-1 flex flex-col gap-1">
            {LIFECYCLE.map(l => (
              <li key={l.state}>
                <span className="font-semibold text-gray-800">{l.state}</span> — {l.meaning}{" "}
                {l.represented
                  ? <span className="font-mono text-[10px] text-gray-500">{l.represented}</span>
                  : <span className="font-semibold text-[var(--cmp-text-critical)]">nothing in this schema represents it.</span>}
              </li>
            ))}
          </ul>
        </Explain>
      </Panel>

      {/* ── GOVERNANCE QUALITY + SENSITIVITY MIX ─────────────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Definition quality (§4, §19)"
          note="§4 requires ownership, dependencies and a version on every definition. These are the definitions that do not have them.">
          {cfg.registry.governance === null ? (
            <p className="text-[12px] text-[var(--cmp-text-warning)]">{cfg.registry.governanceWhy}</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12px] text-gray-700">
              <li><span className="font-bold tabular-nums text-gray-900">{cfg.registry.governance.missingOwners}</span> with no configuration owner</li>
              <li><span className="font-bold tabular-nums text-gray-900">{cfg.registry.governance.unresolvedDeps}</span> depending on a key that does not exist</li>
              <li><span className="font-bold tabular-nums text-gray-900">{cfg.registry.governance.orphaned}</span> parented to a key that does not exist</li>
            </ul>
          )}
          <Explain summary="What §4 asks for that this registry has no column for">
            Data type, typed default value, validation rules and approval class. The registry already
            carries allowed scopes (<span className="font-mono text-[11px]">allowed_config_levels</span>),
            sensitivity (<span className="font-mono text-[11px]">safety_classification</span>), override
            policy, dependencies, owner and version — six of §4&apos;s twelve attributes, with the right
            vocabulary. The four missing ones are why a product default can currently say on or off and
            cannot say &quot;30 minutes&quot;.
          </Explain>
        </Panel>

        <Panel title="Sensitivity mix (§4)"
          note="Safety classification — the nine-value vocabulary the database already constrains on every definition. This is the attribute §8 depends on for clinical-safety approval rules.">
          {cfg.registry.bySafety.length === 0 ? (
            <p className="text-[12px] text-gray-500">No definition carries a safety classification in the rows this page read.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-[12px]">
              {cfg.registry.bySafety.map(s => (
                <li key={s.key} className="flex items-baseline justify-between gap-3">
                  <span className="text-gray-700">{SAFETY_LABEL[s.key] ?? s.key}</span>
                  <span className="font-bold tabular-nums text-gray-900">{s.n.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <WritesAndApprovals canManage={canManage} canApprove={canApprove} />

      {/* ── DRILL-THROUGH ────────────────────────────────────────────────────────────────────── */}
      <Panel title="By domain (§7–§15, §22)"
        note="§6: do not overload Overview with every configuration key. Each page names the settings its domain owns, the stores that hold them today, and what this plane may read of them.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map(d => (
            <ModuleLink key={d.key} href={d.href} label={d.title}
              summary={`${d.purpose} ${d.stores.filter(s => s.readable).length} of ${d.stores.length} stores readable here.`} />
          ))}
        </div>
      </Panel>

      <ReadStamp at={cfg.generatedAt} />
    </div>
  );
}
