import Link from "next/link";
import { runWidget, type WidgetResult } from "@/lib/hq/mission-widgets";
import { compositionProductLine, type MissionComposition } from "@/lib/hq/mission-profile";
import GovernanceContextSwitcher from "./GovernanceContextSwitcher";
import type { GovernanceContext } from "@/lib/hq/governance-context";

// PLAT-GOV-MC-001 - the composed Mission Control shell.
//
// ⚠ THE SAME SHELL, DIFFERENT COMPOSITION (section 2 and acceptance criterion 1). This is not a second
// dashboard bolted beside the first: it is what the shell renders when the resolved governance context is
// not the platform estate. A Practice Product Director opening Mission Control was being shown enterprise
// tenants, platform health, deployments and background jobs - every figure on that screen measures a
// product they do not govern.
//
// ⚠ IT RENDERS ONLY WHAT IT CAN READ. Each widget reports one of four states and each is drawn differently:
// a value, an honest empty, a refusal, or a read that did not complete. Section 10's "fail closed" is not
// only about authorisation - a dashboard that draws a zero where it could not ask is the more common lie.
/* eslint-disable @typescript-eslint/no-explicit-any */

const card = "bg-white rounded-xl border border-gray-200";

function WidgetBody({ result }: { result: WidgetResult }) {
  if (result.state === "forbidden")
    // Reached only if the composition and the source disagree, which is exactly the case worth showing
    // rather than hiding -- it means one of the two is wrong.
    return <p className="text-sm text-gray-500">Not available to your position.</p>;

  if (result.state === "unavailable")
    return (
      <div>
        <p className="text-sm font-medium text-[var(--cmp-text-warning)]">Could not be read</p>
        <p className="text-[11px] text-gray-500 mt-1 break-words">{result.reason}</p>
      </div>
    );

  if (result.state === "empty")
    return <p className="text-sm text-gray-500">{result.caption}</p>;

  const v = result.value;
  if (v.kind === "count")
    return (
      <div>
        <p className="text-3xl font-bold text-gray-900 tabular-nums">{v.value.toLocaleString()}</p>
        <p className="text-xs text-gray-500 mt-0.5">{v.caption}</p>
      </div>
    );

  if (v.kind === "flags")
    return (
      <div>
        <ul className="space-y-1.5">
          {v.rows.map(r => (
            <li key={r.label} className="flex items-center justify-between text-sm">
              <span className="text-gray-700">{r.label}</span>
              <span className={r.on
                ? "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
                : "text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-600"}>
                {r.on ? "on" : "off"}
              </span>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-gray-500 mt-2">{v.caption}</p>
      </div>
    );

  return (
    <div>
      <ul className="space-y-1.5">
        {v.rows.map((r, i) => (
          <li key={`${r.label}-${i}`} className="flex items-center justify-between text-sm gap-3">
            <span className="text-gray-700 truncate">{r.label}</span>
            {r.detail && <span className="text-[11px] text-gray-500 shrink-0">{r.detail}</span>}
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-500 mt-2">{v.caption}</p>
    </div>
  );
}

export default async function ComposedMissionControl({ composition, admin, isOwner, capabilities, viewerName, contexts, activeContextId, contextDefaulted, previewing }: {
  composition: MissionComposition;
  admin: any;
  isOwner: boolean;
  capabilities: string[];
  viewerName: string | null;
  contexts: GovernanceContext[];
  activeContextId: string | null;
  contextDefaulted: boolean;
  /** Owner preview. Changes what is COMPOSED and nothing about what the viewer may do. */
  previewing?: boolean;
}) {
  const line = compositionProductLine(composition);
  const results = await Promise.all(
    composition.widgets.map(async w => ({ widget: w, result: await runWidget(w.dataSource, { admin, isOwner, capabilities }) })),
  );

  return (
    <div data-wide className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">{composition.profile.name}</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {line ? `${line.name} - product governance` : "Competen HQ"}
            {viewerName ? ` - ${viewerName}` : ""}
          </p>
        </div>
        <Link href="/super-admin/platform-ops/practice" className="text-xs text-teal-700 hover:underline shrink-0 mt-1">
          Practice operations →
        </Link>
      </div>

      {/* ⚠ SAYS PLAINLY THAT NOTHING CHANGED. An owner looking at a Product Director's dashboard must not be
          able to mistake it for a reduction in their own authority -- they still hold everything, and any
          screen implying otherwise would be telling them something untrue about themselves. The reverse
          matters too: this is not a way to acquire a position. */}
      {previewing && (
        <div className="bg-white rounded-xl border border-[var(--cmp-color-information)] p-3 flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-blue-700">Preview</p>
            <p className="text-xs text-gray-500 mt-0.5">
              This is what the profile composes for the position that holds it. You are still a platform
              owner — nothing about your authority, capabilities or data access has changed, and previewing
              does not appoint you to anything.
            </p>
          </div>
          <Link href="/super-admin" className="text-xs text-teal-700 hover:underline shrink-0">
            Back to Mission Control →
          </Link>
        </div>
      )}

      {/* PLAT-GOV-MC-001 s4 "Command Header": identity and the CURRENT governance appointment. Rendered with
          one context too -- "which authority am I acting under" is the question this screen exists to answer
          when it shows somebody less than they expected. */}
      <GovernanceContextSwitcher
        contexts={contexts.map(c => ({
          appointmentId: c.appointmentId,
          positionName: c.positionName,
          productLine: c.productLineCode,
          capabilityCount: c.capabilities.length,
        }))}
        activeId={activeContextId}
        defaulted={contextDefaulted}
      />

      {/* ⚠ SAYS WHEN IT IS A FALLBACK. A minimal dashboard that looks deliberate is worse than one that
          admits it could not resolve -- somebody would spend an afternoon wondering where their widgets went. */}
      {composition.state !== "resolved" && (
        <div className={`${card} p-4 border-[var(--cmp-color-warning)]`}>
          <p className="text-sm font-semibold text-[var(--cmp-text-warning)]">
            {composition.state === "unreadable"
              ? "The Mission Control registry could not be read."
              : "No Mission Control profile matched your governance context."}
          </p>
          <p className="text-xs text-gray-500 mt-1">
            This is the minimum safe view, not a configured dashboard. Nothing has been hidden from you by
            policy - the composition simply did not resolve.
          </p>
        </div>
      )}

      {composition.state === "resolved" && composition.widgets.length === 0 && (
        <div className={`${card} p-4`}>
          <p className="text-sm text-gray-600">
            This profile is configured with no widgets yet.
          </p>
          <p className="text-xs text-gray-500 mt-1">
            {composition.profile.description ?? "Widgets are registered in hq_mission_widget and bound to a profile in hq_profile_widget."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {results.map(({ widget, result }) => (
          <div key={widget.code} className={`${card} p-4 ${widget.size === "lg" ? "xl:col-span-2" : ""}`}>
            <p className="text-[11px] font-semibold text-gray-500 mb-2">{widget.label}</p>
            <WidgetBody result={result} />
          </div>
        ))}
      </div>
    </div>
  );
}
