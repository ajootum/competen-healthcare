import Link from "next/link";
import { loadPdMission } from "@/lib/hq/pd-mission";
import type { MissionComposition } from "@/lib/hq/mission-profile";
import type { GovernanceContext } from "@/lib/hq/governance-context";
import GovernanceContextSwitcher from "../GovernanceContextSwitcher";
import { CARD, Section, FigureValue, Delta, SeverityChip, Absent, Ratio } from "./ui";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-002 — MISSION CONTROL FOR THE PRACTICE PRODUCT DIRECTOR.
//
// The daily cockpit, answering five questions in this order (§ BUILD INTENT): is Practice healthy, is it
// growing, are practitioners using it, what is going wrong, and what needs a decision. The eleven
// components below are §2's prescribed hierarchy, in its order.
//
// ⚠ WHAT THIS SCREEN IS NOT. It is not the provisioning debugger, not the tenant Command Centre and not
// a second Product Operations (§18). It summarises and routes; the modules it links to stay
// authoritative. §4 is the rule that keeps it honest at the surface: no stack traces, no database
// identifiers, no saga step names, no migration numbers. A workspace id appears in a drill-through URL
// and never in text.
//
// ⚠ FOUR OF THE ELEVEN COMPONENTS RENDER AN ABSENCE RATHER THAN A FIGURE, AND THAT IS THE BUILD, NOT A
// SHORTFALL. Product health, the commercial pulse, support requests and open incidents have no producer
// anywhere in this product — no probe, no ticket store, no subscription a Practice can be the subject
// of. Each states the specific missing fact in the metric registry's own words. The alternative was a
// row of confident zeros, and "no incident store" and "no open incidents" render identically as a zero
// while only one of them is a reassurance.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHORTCUTS = [
  { label: "Product Operations", href: "/super-admin/pd/operations", note: "Launch state, provisioning, workspaces" },
  { label: "Provisioning & onboarding", href: "/super-admin/pd/operations/provisioning", note: "Sign-ups that failed or stalled" },
  { label: "Product Health", href: "/super-admin/pd/health", note: "Service state, once instrumented" },
  { label: "Support & Incidents", href: "/super-admin/pd/support", note: "Cases and incidents, once a store exists" },
  { label: "Releases & Capabilities", href: "/super-admin/pd/releases", note: "Flags, rollout, entitlements" },
  { label: "Product Configuration", href: "/super-admin/pd/configuration", note: "Defaults, markets, clinical settings" },
];

const utcStamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(11, 16)} UTC on ${d.toISOString().slice(0, 10)}`;
};

export default async function PdMissionControl({
  admin, market, composition, viewerName, contexts, activeContextId, contextDefaulted, previewCode,
}: {
  admin: any;
  market: string | null;
  composition: MissionComposition;
  viewerName: string | null;
  contexts: GovernanceContext[];
  activeContextId: string | null;
  contextDefaulted: boolean;
  /** Set only on the owner's preview, so changing scope does not drop them out of the preview. */
  previewCode: string | null;
}) {
  const m = await loadPdMission(admin, { market });

  const scopeHref = (target: string | null) => {
    const p = new URLSearchParams();
    if (previewCode) p.set("preview", previewCode);
    if (target) p.set("market", target);
    const qs = p.toString();
    return qs ? `/super-admin?${qs}` : "/super-admin";
  };

  return (
    <div data-wide className="space-y-4">

      {/* ── A. CONTEXT HEADER (§2 A, §13) ───────────────────────────────────────────────────────── */}
      <header className={`${CARD} p-5`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Competen Practice</p>
            <h1 className="mt-0.5 text-2xl font-bold text-gray-900">Product Mission Control</h1>
            <p className="mt-1 text-sm text-gray-600">
              {composition.profile.name}
              {viewerName ? ` · ${viewerName}` : ""}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold text-gray-500">Last updated</p>
            <p className="text-[12px] tabular-nums text-gray-700">{utcStamp(m.freshness.generatedAt)}</p>
            <p className="mt-0.5 max-w-[16rem] text-[10px] leading-tight text-gray-400">{m.freshness.note}</p>
          </div>
        </div>

        {/* §13: global product context is fixed to Practice; the market scope is the one selector. */}
        <nav aria-label="Market scope" className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold text-gray-500">Scope</span>
          {[null, ...m.scope.markets].map(opt => {
            const active = m.scope.market === opt;
            return (
              <Link
                key={opt ?? "all"}
                href={scopeHref(opt)}
                aria-current={active ? "true" : undefined}
                className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
                  active
                    ? "border-teal-600 bg-teal-50 text-teal-800"
                    : "border-gray-200 text-gray-600 hover:border-teal-300 hover:bg-teal-50/40"
                }`}
              >
                {opt ?? "All markets"}
              </Link>
            );
          })}
          {m.scope.markets.length === 0 && (
            <span className="text-[12px] text-gray-500">No market can be offered yet — no Practice declares one.</span>
          )}
        </nav>
        {m.scope.truncated && (
          <p className="mt-2 text-[11px] text-[var(--cmp-text-warning)]">
            The list of Practices did not read completely, so this market list may be short and the counts below are floors.
          </p>
        )}

        {contexts.length > 0 && (
          <div className="mt-4">
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
          </div>
        )}
      </header>

      {/* ⚠ THE OWNER PREVIEW SAYS PLAINLY THAT NOTHING CHANGED — the same sentence the composed shell
          carries. An owner looking at a Product Director's cockpit must not be able to mistake it for a
          reduction in their own authority, and previewing is not a way to acquire a position. */}
      {previewCode && (
        <div className={`${CARD} flex items-start justify-between gap-4 border-[var(--cmp-color-information)] p-3`}>
          <div>
            <p className="text-sm font-semibold text-blue-700">Preview</p>
            <p className="mt-0.5 text-xs text-gray-500">
              This is what the Practice product profile composes for the position that holds it. You are
              still a platform owner — nothing about your authority, capabilities or data access has
              changed, and previewing does not appoint you to anything.
            </p>
          </div>
          <Link href="/super-admin" className="shrink-0 text-xs text-teal-700 hover:underline">
            Back to Mission Control →
          </Link>
        </div>
      )}

      {/* ── B. PRODUCT PULSE (§3) ───────────────────────────────────────────────────────────────── */}
      <section aria-labelledby="pulse-h">
        <h2 id="pulse-h" className="sr-only">Product pulse</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {m.pulse.map(c => (
            <Link
              key={c.key}
              href={c.href}
              className={`${CARD} block p-4 transition-colors hover:border-teal-300 hover:bg-teal-50/20`}
            >
              <p className="text-[11px] font-semibold text-gray-500">{c.label}</p>
              <div className="mt-1.5">
                <FigureValue figure={c.figure} />
              </div>
              <Delta comparison={c.comparison} unit="in this period" />
              <p className="mt-1.5 text-[10px] leading-tight text-gray-400">{c.window}</p>
              {c.context.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {c.context.map(x => (
                    <li key={x} className="text-[11px] leading-tight text-gray-500">{x}</li>
                  ))}
                </ul>
              )}
            </Link>
          ))}
        </div>
      </section>

      {/* ── C. NEEDS ATTENTION (§4) ─────────────────────────────────────────────────────────────── */}
      <Section
        id="attention"
        title="Needs attention"
        purpose="Conditions that need a decision or an action, most serious first. Repeated instances of one condition are counted together rather than listed separately."
      >
        {m.attention.length === 0 ? (
          <p className="py-4 text-sm text-gray-600">
            Nothing is currently flagged. That covers provisioning, suspensions, invitations and launch
            readiness only — the conditions this page can observe. It is not a statement about the
            product&apos;s reliability, which nothing measures.
          </p>
        ) : (
          <ul className="space-y-2">
            {m.attention.map(a => (
              <li key={a.key} className="rounded-lg border border-gray-200 p-3.5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityChip severity={a.severity} />
                      <p className="text-[14px] font-semibold text-gray-900">{a.title}</p>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{a.evidence}</p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {a.scope}
                      {a.age ? ` · ${a.age}` : ""}
                    </p>
                  </div>
                  <Link
                    href={a.action.href}
                    className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-[12px] font-semibold text-teal-800 hover:bg-teal-100"
                  >
                    {a.action.label} →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* ── D. TODAY (§5) ───────────────────────────────────────────────────────────────────────── */}
      <Section id="today" title={m.day.label} purpose={m.day.basis}>
        {/* Three columns, not six: two of these six tiles carry a stated absence rather than a number,
            and a sentence squeezed into a sixth of the width is a sentence nobody reads. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {m.today.map(t => (
            <Link
              key={t.key}
              href={t.href}
              className="rounded-lg border border-gray-200 p-3 transition-colors hover:border-teal-300 hover:bg-teal-50/20"
            >
              <p className="text-[11px] font-semibold text-gray-500">{t.label}</p>
              <div className="mt-1">
                <FigureValue figure={t.figure} size="sm" />
              </div>
              {t.note && <p className="mt-1 text-[10px] leading-tight text-gray-400">{t.note}</p>}
            </Link>
          ))}
        </div>
      </Section>

      {/* ── E. PRACTICE JOURNEY (§6) ────────────────────────────────────────────────────────────── */}
      <Section
        id="journey"
        title="Activation journey"
        purpose={`How far Practices get after they are created. ⚠ ${m.journey.label}: every milestone in this product is recorded against a Practice and stamped by whichever colleague reached it first, so presenting it as one person's progress would credit their first booking to everyone in the room.`}
        action={{ label: "Funnel analysis", href: "/super-admin/pd/intelligence/funnel" }}
      >
        {!m.journey.available ? (
          <Absent heading="This funnel is not shown" why={m.journey.why} />
        ) : (
        <>
        <ol className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {m.journey.stages.map((s, i) => (
            <li key={s.key} className="rounded-lg border border-gray-200 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Stage {i + 1}</p>
              <p className="mt-0.5 text-[13px] font-semibold text-gray-900">{s.label}</p>
              <div className="mt-1.5">
                {s.reached === null ? (
                  <p className="text-[12px] font-semibold text-[var(--cmp-text-warning)]">Could not be counted</p>
                ) : (
                  <p className="text-2xl font-bold tabular-nums text-gray-900">{s.reached.toLocaleString()}</p>
                )}
              </div>
              {s.from !== null && (
                <p className="mt-1 text-[11px] text-gray-500">
                  From the previous stage: <Ratio n={s.reached} of={s.from} />
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[11px] text-gray-500">{m.journey.denominatorNote}</p>

        <div className="mt-3 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3.5">
          <p className="text-[12px] font-bold text-gray-800">
            Four of the seven stages this specification asks for cannot be drawn, and are named rather than dropped
          </p>
          <ul className="mt-1.5 space-y-1">
            {m.journey.unavailable.map(u => (
              <li key={u.label} className="text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold text-gray-900">{u.label}</span> — {u.why}
              </li>
            ))}
          </ul>
        </div>
        </>
        )}
      </Section>

      {/* ── F. FEATURE ADOPTION (§7) ────────────────────────────────────────────────────────────── */}
      <Section
        id="adoption"
        title="Feature adoption"
        purpose="Which capabilities Practices actually use. Use is inferred from the records a capability leaves behind, because nothing in this product records a feature being opened."
        action={{ label: "Feature intelligence", href: "/super-admin/pd/intelligence/features" }}
      >
        {!m.adoption.available ? (
          <Absent heading="Adoption is not shown" why={m.adoption.why} />
        ) : (
          <>
            <ul className="space-y-2.5">
              {m.adoption.rows.map(r => {
                const pct = r.practices !== null && m.adoption.denominator > 0
                  ? Math.round((r.practices / m.adoption.denominator) * 100)
                  : null;
                return (
                  <li key={r.key}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-gray-800">{r.label}</span>
                      <Ratio n={r.practices} of={m.adoption.denominator} />
                    </div>
                    {/* ⚠ NO BAR WHERE THERE IS NO NUMBER. An empty track beside "could not be counted"
                        reads as a measured zero, which is the exact substitution §14 forbids. */}
                    {pct !== null && (
                      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className="h-full rounded-full bg-teal-500" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500">{m.adoption.denominatorNote}</p>
          </>
        )}

        <div className="mt-3 rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-3.5">
          <p className="text-[12px] font-bold text-gray-800">Four capabilities this view cannot see at all</p>
          <ul className="mt-1.5 space-y-1">
            {m.adoption.blind.map(b => (
              <li key={b.label} className="text-[12px] leading-relaxed text-gray-700">
                <span className="font-semibold text-gray-900">{b.label}</span> — {b.why}
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* ── G. PRODUCT HEALTH (§8) — a stated absence ───────────────────────────────────────────── */}
      <Section
        id="health"
        title="Product health"
        purpose="What the director would come here to check first, and the one thing this product cannot yet answer."
        action={{ label: "Product Health", href: "/super-admin/pd/health" }}
      >
        <Absent heading="No service state can be shown, because nothing measures one" why={m.health.why}>
          <ul className="mt-2.5 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            {m.health.services.map(s => (
              <li key={s} className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5">
                <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-gray-300" />
                <span className="truncate text-[12px] text-gray-700">{s}</span>
                <span className="ml-auto shrink-0 text-[10px] font-semibold uppercase text-gray-400">Unknown</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-gray-600">
            Unknown is one of this specification&apos;s own four states and is the only true one here.
            None of these eight services is being reported as healthy.
          </p>
        </Absent>
      </Section>

      {/* ── H. GROWTH & COMMERCIAL PULSE (§9) — a stated absence ────────────────────────────────── */}
      <Section
        id="commercial"
        title="Growth & commercial pulse"
        purpose="Trials, paid customers, conversion, churn and revenue — where the commercial capability is enabled."
        action={{ label: "Commercial", href: "/super-admin/pd/commercial" }}
      >
        <Absent
          heading="The commercial capability is not enabled for Practice, and this one is structural"
          why="A Practice cannot be the subject of a subscription in this product at all, so there is no trial to convert, no paid state to convert into and no revenue to recognise. §9 asks that unavailable metrics be hidden cleanly rather than shown as misleading zeros; they are named instead, because a director needs to know this is a schema decision awaiting them and not a screen awaiting a developer."
        >
          <ul className="mt-2.5 space-y-1.5">
            {m.commercial.lines.map(l => (
              <li key={l.label} className="rounded-md border border-gray-200 bg-white px-3 py-2">
                <p className="text-[12px] font-semibold text-gray-900">{l.label}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-600">{l.why}</p>
              </li>
            ))}
          </ul>
        </Absent>
      </Section>

      {/* ── I. PRACTICES REQUIRING ATTENTION (§10) ──────────────────────────────────────────────── */}
      <Section
        id="practices"
        title="Practices requiring attention"
        purpose="Ranked by severity. Non-clinical throughout: a Practice's name, its owner, its market and its state — never anything about a patient."
        action={{ label: "All practices", href: "/super-admin/pd/practices" }}
      >
        {m.practices.rows.length === 0 ? (
          <p className="py-3 text-sm text-gray-600">
            No Practice in scope is currently in an exception state.
          </p>
        ) : (
          <ul className="space-y-2">
            {m.practices.rows.map(p => (
              <li key={p.id} className="rounded-lg border border-gray-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityChip severity={p.severity} />
                      <p className="truncate text-[14px] font-semibold text-gray-900">{p.name}</p>
                    </div>
                    <p className="mt-1 text-[12px] leading-relaxed text-gray-700">{p.reason}</p>
                    <p className="mt-1 text-[11px] text-gray-500">
                      {p.lifecycle}
                      {p.market ? ` · ${p.market}` : ""}
                      {p.ownerName ? ` · owned by ${p.ownerName}` : " · owner not recorded"}
                      {` · ${p.age}`}
                    </p>
                  </div>
                  <Link
                    href={p.href}
                    className="shrink-0 rounded-lg border border-teal-200 bg-teal-50 px-3 py-1.5 text-[12px] font-semibold text-teal-800 hover:bg-teal-100"
                  >
                    Open Practice →
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
          {m.practices.note}
          {m.practices.estateTotal !== null
            ? m.practices.estateTotal === 1
              ? " Across the whole of this scope, 1 Practice is suspended or failed to be created."
              : ` Across the whole of this scope, ${m.practices.estateTotal} Practices are suspended or failed to be created.`
            : " The count of exceptions across the whole scope could not be read, so this list may not be the whole picture."}
        </p>
      </Section>

      {/* ── J. PRODUCT DIRECTOR FOCUS (§11) ─────────────────────────────────────────────────────── */}
      <Section
        id="focus"
        title="Product Director focus"
        purpose="At most five. Each is a fixed rule over the figures above, not a suggestion from a model — the reasoning is shown so it can be disagreed with."
      >
        <ol className="space-y-2">
          {m.focus.map((f, i) => (
            <li key={f.key} className="flex items-start gap-3 rounded-lg border border-gray-200 p-3">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-semibold text-gray-900">{f.title}</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-gray-700">{f.rationale}</p>
              </div>
              <Link href={f.action.href} className="shrink-0 text-[12px] font-semibold text-teal-700 hover:underline">
                {f.action.label} →
              </Link>
            </li>
          ))}
        </ol>
      </Section>

      {/* ── K. OPERATIONAL SHORTCUTS (§12) ──────────────────────────────────────────────────────── */}
      <Section
        id="shortcuts"
        title="Operational shortcuts"
        purpose="Secondary to product state and exceptions, and deliberately last on the page (§12)."
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {SHORTCUTS.map(s => (
            <Link
              key={s.href}
              href={s.href}
              className="rounded-lg border border-gray-200 px-3 py-2.5 transition-colors hover:border-teal-300 hover:bg-teal-50/40"
            >
              <p className="text-[13px] font-semibold text-gray-800">{s.label}</p>
              <p className="mt-0.5 text-[11px] text-gray-500">{s.note}</p>
            </Link>
          ))}
        </div>
        <p className="mt-2.5 text-[11px] leading-relaxed text-gray-500">
          Every destination checks your authorisation again on arrival. Reaching one from here grants
          nothing, and a link you can see is not a permission you hold.
        </p>
      </Section>

      {/* Read failures, in full, at the foot. §14: a component that could not be filled says so. */}
      {m.problems.length > 0 && (
        <section aria-labelledby="problems-h" className={`${CARD} border-[var(--cmp-color-warning)] p-5`}>
          <h2 id="problems-h" className="text-[15px] font-semibold text-[var(--cmp-text-warning)]">
            Reads that did not complete
          </h2>
          <p className="mt-1 text-[12px] text-gray-600">
            Listed so no figure above has to stand in for one. None of these is being shown as a zero.
          </p>
          <ul className="mt-2 space-y-1">
            {m.problems.map((p, i) => (
              <li key={i} className="text-[12px] leading-relaxed text-gray-700">{p}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="pb-4 text-[11px] leading-relaxed text-gray-400">
        Mission Control summarises Competen Practice and routes to the module that owns each subject; it
        does not replace Product Operations, Product Intelligence, Product Health or Commercial. Every
        figure carries its period and its scope, and every figure it cannot produce says which fact is
        missing instead of showing a zero.
      </p>
    </div>
  );
}
