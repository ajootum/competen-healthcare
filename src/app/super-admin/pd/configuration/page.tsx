import { createAdminClient } from "@/lib/supabase/server";
import { requireHqCapability } from "@/lib/hq/context";
import { loadPdConfiguration, DOMAINS } from "@/lib/hq/pd-configuration";
import {
  ConfigHeader, Stat, Panel, Warn, Explain, Cite, AbsentList, ModuleLink,
  ReadFailures, WritesAndApprovals, RungSummary,
  RiskDonut, HierarchyRail, DomainCoverage, ChangesTable, ConfigFooter,
} from "./_components/config-ui";

// CPR-PD-011 §6 — CONFIGURATION OVERVIEW, as the command surface the specification and the approved
// comp describe.
//
// ⚠ THE GUARD IS ON THE PAGE, NOT ONLY ON THE LAYOUT (CPR-PD-001 s7: "a hidden navigation item does not
// constitute authorization"; Next's authentication guide: a layout check is not sufficient because
// layouts do not re-render on navigation).
//
// ⚠ THE COMP'S SHAPES, NEVER ITS NUMBERS. The design shows 126 active definitions of 134, six hierarchy
// levels resolving at 100/100/92/88/85/0%, ten domains at 58-100% coverage and five recent changes with
// actors. Every slot is filled from what the engine actually reports, and the two slots this product
// cannot form a fraction for render the STATE instead — because "85% resolvable" needs a count of
// resolvable settings over a count of settings, and five of the six levels hold no settings at all.
//
// ⚠ s6's LAST LINE GOVERNS THE WHOLE PAGE: "Do not overload Overview with every configuration key." So
// the posture, the hierarchy, the risk mix and what needs attention lead; the per-domain detail is a
// link, and the long verdicts stay behind their disclosures.
//
// s27 requires the overview to answer: what is changing, what is risky, what is invalid, what drift
// exists, what needs my approval. The first two regions answer all five.

export const dynamic = "force-dynamic";

export default async function Page() {
  const ctx = await requireHqCapability("hq.practice.configuration.view");
  const admin = await createAdminClient();
  const cfg = await loadPdConfiguration(admin);
  const canManage = ctx.capabilities.includes("hq.practice.configuration.manage");
  const canApprove = ctx.capabilities.includes("hq.practice.change.approve");

  return (
    <div className="flex flex-col gap-4">
      <ConfigHeader
        title="Configuration Overview"
        purpose="The current state of all configuration across Competen Practice, and what is changing."
        spec="CPR-PD-011 §6"
      />

      {/* ── the posture strip (§6 "Configuration posture") ─────────────────────────────────────── */}
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active definitions" figure={cfg.registry.definitions}
          scope={cfg.registry.active !== null && cfg.registry.rowCount !== null
            ? `${cfg.registry.active} active of ${cfg.registry.rowCount} registered`
            : "registered across the estate"} />
        <Stat label="High-risk settings" figure={cfg.registry.highRisk} tone="warning"
          scope="classified clinical-safety, security, regulatory or financial-control critical" />
        <Stat label="Pending changes" figure={cfg.changeSets.pending}
          scope="unpublished override drafts plus change sets not yet live" />
        <Stat label="Scheduled changes" figure={cfg.changeSets.scheduled}
          scope="change sets with a future effective time" />
        <Stat label="Failed activations" figure={cfg.changeSets.failed}
          scope="change sets whose activation failed" />
        <Stat label="Override values" figure={cfg.overrides.published}
          scope={cfg.overrides.total !== null ? `of ${cfg.overrides.total} override rows` : "in effect"} />
      </div>

      <ReadFailures problems={cfg.problems} />

      {/* ── the hierarchy and the risk mix ─────────────────────────────────────────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr]">
        <Panel
          title="Configuration hierarchy (§3), and which levels resolve today"
          note="Six levels. Each card carries what the level is for and whether the engine can resolve a value at it."
        >
          <HierarchyRail rungs={cfg.ladder} />
          <div className="mt-3"><RungSummary rungs={cfg.ladder} /></div>
          <Explain summary="Why there is no percentage under each level">
            The comp puts a resolution-health percentage here. That fraction would need a count of
            resolvable settings over a count of settings at each level, and five of the six levels hold
            no settings at all — so five of the six denominators would be zero. Whether a level resolves
            is a property of the schema rather than a score, and it is the more decision-useful fact: a
            level that cannot be resolved does not become healthier as settings are added to it.
          </Explain>
        </Panel>

        <Panel
          title="Configuration by risk (§4)"
          note="Safety classification across every registered definition. The database constrains this on every row, so the segments sum exactly."
        >
          <RiskDonut slices={cfg.registry.bySafety} total={cfg.registry.rowCount} />
        </Panel>
      </div>

      {/* ── what needs attention, and how much of the estate this plane can see ────────────────── */}
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel
          title="Needs attention (§6)"
          note="Measured exceptions only. Two of §6's triggers cannot appear here at all and are listed under what is not shown."
        >
          {cfg.attention.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              Nothing measurable is outstanding. ⚠ Not the same as &ldquo;nothing is wrong&rdquo; — drift,
              expired overrides and outstanding approvals have no producer, so they could not appear here
              whatever their state.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-gray-100">
              {cfg.attention.map(a => (
                <li key={a.label} className="py-2.5 first:pt-0 last:pb-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12.5px] font-semibold text-gray-900">{a.label}</p>
                    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      a.tone === "critical"
                        ? "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)] text-[var(--cmp-text-critical)]"
                        : "border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]"}`}>
                      {a.tone === "critical" ? "Critical" : "Warning"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{a.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="What this plane may read, by domain"
          note="Stores the platform plane's allowlist admits, over the stores each domain uses."
        >
          <DomainCoverage domains={DOMAINS} />
          <Explain summary="Why this is not &ldquo;configuration coverage&rdquo;">
            The comp labels this bar &ldquo;how complete is our configuration across domains&rdquo;. That
            is a different question and this product cannot answer it: no domain records how many settings
            it OUGHT to have, so there is no denominator for completeness. What both halves of this bar do
            have is a real count — the stores this plane is permitted to read, over the stores the domain
            uses — which is a measurement of visibility rather than an impression of completeness.
          </Explain>
        </Panel>
      </div>

      {/* ── what is changing (§6 "Recent changes", §18 change sets) ────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Recent changes (§6) and the change sets behind them (§18)"
          note="Every configuration edit grouped into a named set, newest first."
        >
          <ChangesTable rows={cfg.changeSets.rows} />
        </Panel>

        <Panel
          title="Upcoming scheduled activations"
          note="§16's SCHEDULED state — approved for a future effective time."
        >
          {(() => {
            const scheduled = cfg.changeSets.rows.filter(r => r.status === "scheduled");
            if (!cfg.changeSets.read) {
              return (
                <p className="text-[12px] leading-relaxed text-gray-600">
                  The change-set store could not be read, so nothing can be said about what is scheduled.
                  That is not &ldquo;nothing is scheduled&rdquo;.
                </p>
              );
            }
            if (scheduled.length === 0) {
              return (
                <p className="text-[12px] leading-relaxed text-gray-600">
                  Nothing is scheduled. The store answered and holds no change set in a scheduled state —
                  a measured empty queue rather than an unreadable one.
                </p>
              );
            }
            return (
              <ul className="flex flex-col divide-y divide-gray-100">
                {scheduled.map(r => (
                  <li key={r.key} className="flex items-baseline justify-between gap-2 py-1.5 first:pt-0">
                    <span className="text-[12px] font-medium text-gray-800">{r.name || r.key}</span>
                    <span className="font-mono text-[10.5px] text-gray-500">
                      {r.scheduledFor ? new Date(r.scheduledFor).toISOString().replace("T", " ").slice(0, 16) : "no time set"}
                    </span>
                  </li>
                ))}
              </ul>
            );
          })()}
        </Panel>
      </div>

      {/* ── the engine's own verdict, kept but no longer leading ───────────────────────────────── */}
      <Warn title="The configuration engine is real. Competen Practice is not yet its subject.">
        Three configuration estates exist here and are populated: a definition registry carrying allowed
        scopes, safety classification, override policy, dependencies and owner; an override store with
        draft, publish, version snapshots and a change trail; and a change-set lifecycle whose states line
        up almost exactly with §16.{" "}
        <span className="font-semibold">None of them holds a Competen Practice setting.</span> The registry
        is seeded from the in-code workspace catalogue, which describes the estate&apos;s workspaces —
        Unit Manager, Shift Supervisor, the Personal Workspace — and names Practice nowhere. So every
        figure above is true and is about the estate&apos;s configuration, not Practice&apos;s.
        <Cite>
          configuration_registry_objects and workspace_config_overrides (migrations 076, 092, 099); the
          resolver at src/lib/config/runtime.ts and applies() at src/lib/config/workspace-config.ts
        </Cite>
      </Warn>

      <Panel title="Not shown, and why" note="§6 asks for these. Each is refused by the metric registry, which holds the reason once.">
        <AbsentList items={cfg.refusals} />
      </Panel>

      <WritesAndApprovals canManage={canManage} canApprove={canApprove} />

      {/* ── drill-through by domain (§6) ───────────────────────────────────────────────────────── */}
      <Panel title="Configuration domains (§7–§15, §22)" note="§6: do not overload Overview with every configuration key. Each domain names the settings it owns.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {DOMAINS.map(d => (
            <ModuleLink key={d.key} href={d.href} label={d.title} summary={d.purpose} />
          ))}
        </div>
      </Panel>

      <ConfigFooter at={cfg.generatedAt} />
    </div>
  );
}
