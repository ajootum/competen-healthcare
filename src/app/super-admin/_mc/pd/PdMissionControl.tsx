import Link from "next/link";
import { loadPdMission, type PulseCard, type TodayMetric } from "@/lib/hq/pd-mission";
import type { MissionComposition } from "@/lib/hq/mission-profile";
import type { GovernanceContext } from "@/lib/hq/governance-context";
import GovernanceContextSwitcher from "../GovernanceContextSwitcher";
import { Icon, type IconName } from "./icons";
import {
  CARD, Panel, FigureValue, Delta, SeverityChip, Absent, Ratio, Bar, StatusDot,
  IconTile, Explain, ExplainDot, Note, type TileTone,
} from "./ui";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-002 — MISSION CONTROL FOR THE PRACTICE PRODUCT DIRECTOR.
//
// The daily cockpit, answering five questions in this order (§ BUILD INTENT): is Practice healthy, is it
// growing, are practitioners using it, what is going wrong, and what needs a decision. The eleven
// components below are §2's prescribed hierarchy, in its order, laid out in the approved comp's four
// bands: six KPIs, then Needs attention · Today · journey, then four cards, then Focus beside Quick
// actions. Reading order IS §2's order A–K; the bands only decide how many sit side by side.
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
//
// ⚠ THE COMP'S SHAPES ARE ADOPTED; ITS NUMBERS ARE NOT, AND THE DIFFERENCE IS THE WHOLE POINT.
// The approved PNG shows 99.96% health with eight green dots, MRR of UGX 4.8m, and a seven-stage
// PRACTITIONER funnel with per-stage conversion. A gate-check found no producer for any of them. So
// every one of those components is rendered HERE, in the comp's own layout and in the comp's own place
// on the page — the dotted service rows, the commercial figure grid, the funnel with bars — carrying the
// state that is true instead of the figure that is not. Deleting the card would have hidden the finding;
// drawing the comp's number would have invented one.
//
// ⚠ AND THE PROSE MOVED, IT DID NOT GO. Every long explanation this page used to print under a KPI now
// sits behind a <details> disclosure — a real element that tabs, takes focus and announces itself, not a
// `title` attribute (§15 asks for progressive disclosure AND keyboard reachability in the same list, and
// a tooltip satisfies only the first half). Nothing was shortened, summarised or dropped to make room.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/* eslint-disable @typescript-eslint/no-explicit-any */

const SHORTCUTS: { label: string; href: string; note: string; icon: IconName }[] = [
  { label: "Product Operations", href: "/super-admin/pd/operations", note: "Launch state, provisioning, workspaces", icon: "queue" },
  { label: "Provisioning & onboarding", href: "/super-admin/pd/operations/provisioning", note: "Sign-ups that failed or stalled", icon: "provision" },
  { label: "Product Health", href: "/super-admin/pd/health", note: "Service state, once instrumented", icon: "health" },
  { label: "Support & Incidents", href: "/super-admin/pd/support", note: "Cases and incidents, once a store exists", icon: "support" },
  { label: "Releases & Capabilities", href: "/super-admin/pd/releases", note: "Flags, rollout, entitlements", icon: "release" },
  { label: "Product Configuration", href: "/super-admin/pd/configuration", note: "Defaults, markets, clinical settings", icon: "configuration" },
];

/**
 * The comp's tinted KPI tiles, keyed by the loader's own card keys.
 *
 * ⚠ THE TINT IS SPENT ONLY ON A MEASURED FIGURE (see `PulseTile`). The comp draws Product Health as a
 * green shield because it shows 99.96%; ours shows "Not measured", and a green shield over that reads as
 * reassurance at exactly the distance a KPI row is scanned from. An unmeasured tile is grey, by rule
 * rather than by choice at each call site, so a metric that goes absent tomorrow loses its colour too.
 */
const PULSE_ART: Record<string, { icon: IconName; tone: TileTone }> = {
  practices: { icon: "practices", tone: "blue" },
  practitioners: { icon: "practitioners", tone: "green" },
  active: { icon: "active", tone: "violet" },
  patients: { icon: "patients", tone: "orange" },
  bookings: { icon: "bookings", tone: "sky" },
  health: { icon: "health", tone: "green" },
};

const TODAY_ICON: Record<string, IconName> = {
  "new-practitioners": "practitioners",
  onboarding: "onboarding",
  "bookings-today": "bookings",
  "encounters-today": "encounters",
  support: "support",
  incidents: "incident",
};

const utcStamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(11, 16)} UTC on ${d.toISOString().slice(0, 10)}`;
};

/**
 * Everything about one KPI that will not fit on one line, gathered once.
 *
 * ⚠ ASSEMBLED IN ONE PLACE SO NOTHING CAN BE LEFT BEHIND. The card shows a figure, a delta word and a
 * window; every other sentence the loader supplied — the registry's refusal, §3's reason for withholding
 * a comparison, the lifecycle mix, the caveats — lands here verbatim and is rendered by the disclosure.
 * A per-card hand-picked list is how one of them eventually goes missing without anybody noticing.
 */
function pulseNotes(c: PulseCard): string[] {
  return [
    c.figure.state !== "value" ? c.figure.why : "",
    c.comparison?.state === "insufficient" ? `Not enough data — ${c.comparison.why}` : "",
    ...c.context,
    c.window,
  ].filter(Boolean);
}

function PulseTile({ card }: { card: PulseCard }) {
  const art = PULSE_ART[card.key] ?? { icon: "practices" as IconName, tone: "blue" as TileTone };
  const measured = card.figure.state === "value";
  const notes = pulseNotes(card);
  return (
    <div className={`${CARD} relative p-3`}>
      <Link
        href={card.href}
        className="block rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <div className="flex items-start gap-2.5">
          <IconTile name={art.icon} tone={measured ? art.tone : "neutral"} />
          <div className="min-w-0 flex-1 pr-5">
            <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-gray-500">
              {card.label}
            </p>
            <div className="mt-1">
              <FigureValue figure={card.figure} />
            </div>
            <div className="mt-1">
              <Delta comparison={card.comparison} unit="in this period" />
            </div>
            <p title={card.window} className="mt-0.5 line-clamp-2 text-[10px] leading-tight text-gray-400">
              {card.window}
            </p>
          </div>
        </div>
      </Link>
      <ExplainDot anchor="absolute right-2 top-2" label={`How ${card.label} is measured, and what it does not say`}>
        {notes.map((n, i) => <Note key={i}>{n}</Note>)}
      </ExplainDot>
    </div>
  );
}

function TodayRow({ metric }: { metric: TodayMetric }) {
  const extra = [metric.figure.state !== "value" ? metric.figure.why : "", metric.note ?? ""].filter(Boolean);
  return (
    <li className="relative border-b border-gray-100 py-1 last:border-0">
      <Link
        href={metric.href}
        className="flex min-w-0 items-center gap-2.5 rounded-lg py-0.5 pr-6 transition-colors hover:text-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500">
          <Icon name={TODAY_ICON[metric.key] ?? "queue"} className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-[3.25rem] shrink-0">
          <FigureValue figure={metric.figure} size="sm" />
        </span>
        <span className="min-w-0 flex-1 text-[12px] leading-snug text-gray-700">{metric.label}</span>
      </Link>
      {extra.length > 0 && (
        <ExplainDot anchor="absolute right-0 top-1.5" label={`About ${metric.label}`}>
          {extra.map((n, i) => <Note key={i}>{n}</Note>)}
        </ExplainDot>
      )}
    </li>
  );
}

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

  // The header strip takes the colour of the worst thing under it, and nothing worse. An empty
  // exception list under a red header is an alarm the page invented for itself.
  const attentionTone = m.attention.some(a => a.severity === "critical")
    ? "critical"
    : m.attention.length ? "warning" : "plain";

  return (
    <div data-wide className="space-y-3">

      {/* ── A. CONTEXT HEADER (§2 A, §13) ───────────────────────────────────────────────────────── */}
      <header className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Competen Practice</p>
            <h1 className="mt-0.5 text-xl font-bold leading-tight text-gray-900">Product Mission Control</h1>
            <p className="mt-0.5 text-[12px] text-gray-600">
              {composition.profile.name}
              {viewerName ? ` · ${viewerName}` : ""}
            </p>
          </div>
          {/* ⚠ THE FRESHNESS NOTE STAYS VISIBLE. §2 A names data freshness as part of the context header
              and the sentence is one line, not a paragraph — it was never the density problem, so it is
              not one of the things that moved behind a disclosure. */}
          <div className="text-right">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Last updated</p>
            <p className="text-[12px] tabular-nums text-gray-700">{utcStamp(m.freshness.generatedAt)}</p>
            <p className="mt-0.5 max-w-[18rem] text-[10px] leading-tight text-gray-400">{m.freshness.note}</p>
          </div>
        </div>

        {/* §13: global product context is fixed to Practice; the market scope is the one selector. */}
        <nav aria-label="Market scope" className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-semibold text-gray-500">Scope</span>
          {[null, ...m.scope.markets].map(opt => {
            const active = m.scope.market === opt;
            return (
              <Link
                key={opt ?? "all"}
                href={scopeHref(opt)}
                aria-current={active ? "true" : undefined}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors ${
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
            <span className="text-[11px] text-gray-500">No market can be offered yet — no Practice declares one.</span>
          )}
        </nav>
        {m.scope.truncated && (
          <p className="mt-2 text-[11px] text-[var(--cmp-text-warning)]">
            The list of Practices did not read completely, so this market list may be short and the counts below are floors.
          </p>
        )}

        {contexts.length > 0 && (
          <div className="mt-3">
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
            <p className="text-[13px] font-semibold text-blue-700">Preview</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              This is what the Practice product profile composes for the position that holds it. You are
              still a platform owner — nothing about your authority, capabilities or data access has
              changed, and previewing does not appoint you to anything.
            </p>
          </div>
          <Link href="/super-admin" className="shrink-0 text-[11px] font-semibold text-teal-700 hover:underline">
            Back to Mission Control →
          </Link>
        </div>
      )}

      {/* ── B. PRODUCT PULSE (§3) — the comp's six-across KPI row ────────────────────────────────── */}
      <section aria-labelledby="pulse-h">
        <h2 id="pulse-h" className="sr-only">Product pulse</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
          {m.pulse.map(c => <PulseTile key={c.key} card={c} />)}
        </div>
      </section>

      {/* ── C · D · E — the comp's three-column band, in §2's order left to right ────────────────── */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-[1.05fr_0.85fr_1.4fr]">

        {/* ── C. NEEDS ATTENTION (§4) ───────────────────────────────────────────────────────────── */}
        <Panel
          id="attention"
          title="Needs attention"
          tone={attentionTone}
          badge={m.attention.length}
          footer={{ label: "Open Product Operations", href: "/super-admin/pd/operations" }}
        >
          {m.attention.length === 0 ? (
            <p className="text-[12px] leading-relaxed text-gray-600">
              Nothing is currently flagged. That covers provisioning, suspensions, invitations and launch
              readiness only — the conditions this page can observe. It is not a statement about the
              product&apos;s reliability, which nothing measures.
            </p>
          ) : (
            <ul>
              {m.attention.map(a => (
                <li key={a.key} className="border-b border-gray-100 py-2 first:pt-0 last:border-0 last:pb-0">
                  <Link
                    href={a.action.href}
                    className="group block rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <SeverityChip severity={a.severity} />
                      <p className="text-[12.5px] font-semibold leading-snug text-gray-900">{a.title}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-600">{a.evidence}</p>
                    <div className="mt-1 flex items-end justify-between gap-2">
                      <p className="min-w-0 text-[10px] leading-tight text-gray-400">
                        {a.scope}
                        {a.age ? ` · ${a.age}` : ""}
                      </p>
                      <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-teal-700 group-hover:underline">
                        {a.action.label}
                        <Icon name="chevron" className="h-3 w-3" />
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Explain summary="What counts as an exception here" className="mt-2">
            <Note>
              Conditions that need a decision or an action, most serious first. Repeated instances of one
              condition are counted together rather than listed separately.
            </Note>
          </Explain>
        </Panel>

        {/* ── D. TODAY (§5) — the comp's numeric + caption rows ──────────────────────────────────── */}
        <Panel
          id="today"
          title={m.day.label}
          tone="info"
          footer={{ label: "Open today's operations", href: "/super-admin/pd/operations" }}
        >
          <ul>
            {m.today.map(t => <TodayRow key={t.key} metric={t} />)}
          </ul>
          <Explain summary="Which day this is, and how it was chosen" className="mt-2">
            <Note>{m.day.basis}</Note>
          </Explain>
        </Panel>

        {/* ── E. PRACTICE JOURNEY (§6) — the comp's funnel, drawn over Practices ─────────────────── */}
        <Panel
          id="journey"
          title="Practice journey"
          subtitle={m.journey.label}
          footer={{ label: "View full funnel", href: "/super-admin/pd/intelligence/funnel" }}
        >
          {!m.journey.available ? (
            <Absent
              heading="This funnel is not shown"
              why={m.journey.why}
              explainLabel="What is missing"
            />
          ) : (
            <>
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(2.5rem,1.1fr)_auto] items-center gap-2 pb-1">
                <span className="text-[9px] font-semibold uppercase tracking-wide text-gray-400">Stage</span>
                <span className="text-right text-[9px] font-semibold uppercase tracking-wide text-gray-400">Count</span>
                <span className="text-right text-[9px] font-semibold uppercase tracking-wide text-gray-400">From the stage before</span>
              </div>
              <ol>
                {m.journey.stages.map(s => {
                  const pct = s.reached !== null && m.journey.denominator > 0
                    ? (s.reached / m.journey.denominator) * 100
                    : null;
                  return (
                    <li key={s.key} className="grid grid-cols-[minmax(0,1fr)_minmax(2.5rem,1.1fr)_auto] items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                      <span title={s.label} className="truncate text-[11.5px] text-gray-800">{s.label}</span>
                      {/* ⚠ NO BAR WHERE THERE IS NO NUMBER. An empty track beside "could not be counted"
                          reads as a measured zero, which is the exact substitution §14 forbids. */}
                      <span className="flex items-center gap-2">
                        {pct !== null
                          ? <Bar pct={pct} tone="info" />
                          : <span className="flex-1" />}
                        <span className="min-w-[2.25rem] shrink-0 whitespace-nowrap text-right text-[11.5px] font-semibold tabular-nums text-gray-900">
                          {s.reached !== null
                            ? s.reached.toLocaleString()
                            : <span className="text-[10px] font-semibold text-[var(--cmp-text-warning)]">Not counted</span>}
                        </span>
                      </span>
                      <span className="text-right">
                        {s.from === null
                          ? <span className="text-[10px] text-gray-400">First stage</span>
                          : <Ratio n={s.reached} of={s.from} />}
                      </span>
                    </li>
                  );
                })}
              </ol>

              {/* ⚠ THE COMP'S MISSING STAGES STAY IN THE FUNNEL, AS ROWS, WITHOUT BARS OR NUMBERS. The
                  approved PNG draws seven stages; four of them have no producer at all. Dropping them
                  would have quietly shortened the funnel to whatever happened to be countable. */}
              <p className="mt-2 text-[10px] font-semibold text-gray-500">
                A further {m.journey.unavailable.length} stages this specification asks for cannot be
                drawn at all, and are named rather than dropped
              </p>
              <ul className="mt-1 space-y-0.5">
                {m.journey.unavailable.map(u => (
                  <li key={u.label}>
                    <Explain summary={`${u.label} — not recorded`}>
                      <Note>{u.why}</Note>
                    </Explain>
                  </li>
                ))}
              </ul>

              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">{m.journey.denominatorNote}</p>
            </>
          )}
          <Explain summary="Why this funnel counts Practices and not practitioners" className="mt-2">
            <Note>
              How far Practices get after they are created. {m.journey.label}: every milestone in this
              product is recorded against a Practice and stamped by whichever colleague reached it first,
              so presenting it as one person&apos;s progress would credit their first booking to everyone
              in the room.
            </Note>
          </Explain>
        </Panel>
      </div>

      {/* ── F · G · H · I — the comp's four-card band, in §2's order left to right ───────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">

        {/* ── F. FEATURE ADOPTION (§7) ──────────────────────────────────────────────────────────── */}
        <Panel
          id="adoption"
          title="How Practice is being used"
          footer={{ label: "Explore feature adoption", href: "/super-admin/pd/intelligence/features" }}
        >
          {!m.adoption.available ? (
            <Absent heading="Adoption is not shown" why={m.adoption.why} explainLabel="What is missing" />
          ) : (
            <ul className="space-y-2">
              {m.adoption.rows.map(r => {
                const pct = r.practices !== null && m.adoption.denominator > 0
                  ? (r.practices / m.adoption.denominator) * 100
                  : null;
                return (
                  <li key={r.key}>
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[11.5px] text-gray-800">{r.label}</span>
                      <Ratio n={r.practices} of={m.adoption.denominator} />
                    </div>
                    {pct !== null && <div className="mt-1"><Bar pct={pct} /></div>}
                  </li>
                );
              })}
            </ul>
          )}
          <Explain
            summary={`What this counts, and ${m.adoption.blind.length} capabilities it cannot see`}
            className="mt-2.5"
          >
            <Note>{m.adoption.denominatorNote}</Note>
            <Note>
              Use is inferred from the records a capability leaves behind, because nothing in this product
              records a feature being opened.
            </Note>
            {m.adoption.blind.map(b => (
              <Note key={b.label}>
                <span className="font-semibold text-gray-900">{b.label}</span> — {b.why}
              </Note>
            ))}
          </Explain>
        </Panel>

        {/* ── G. PRODUCT HEALTH (§8) — the comp's dotted service rows, every one of them Unknown ─── */}
        <Panel
          id="health"
          title="Product health"
          tone="warning"
          footer={{ label: "Open product health", href: "/super-admin/pd/health" }}
        >
          <Absent
            heading="No service state can be shown, because nothing measures one"
            why={m.health.why}
            explainLabel="Which facts are missing"
          />
          <ul className="mt-2">
            {m.health.services.map(s => (
              <li key={s} className="flex items-center justify-between gap-2 border-b border-gray-100 py-1 last:border-0">
                <span className="truncate text-[11.5px] text-gray-800">{s}</span>
                <StatusDot state="unknown" word="Unknown" />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
            Unknown is one of this specification&apos;s own four states and is the only true one here.
            None of these {m.health.services.length} services is being reported as healthy.
          </p>
        </Panel>

        {/* ── H. GROWTH & COMMERCIAL PULSE (§9) — the comp's figure grid, saying what is absent ──── */}
        <Panel
          id="commercial"
          title="Growth & commercial pulse"
          tone="warning"
          footer={{ label: "Open commercial", href: "/super-admin/pd/commercial" }}
        >
          <Absent
            heading="The commercial capability is not enabled for Practice, and this one is structural"
            why="A Practice cannot be the subject of a subscription in this product at all, so there is no trial to convert, no paid state to convert into and no revenue to recognise. §9 asks that unavailable metrics be hidden cleanly rather than shown as misleading zeros; they are named instead, because a director needs to know this is a schema decision awaiting them and not a screen awaiting a developer."
            explainLabel="Why this is a schema decision, not an unbuilt screen"
          />
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {m.commercial.lines.map(l => (
              <div key={l.label} className="rounded-lg border border-gray-200 bg-[var(--cmp-surface-neutral)] p-1.5 text-center">
                <p className="text-[11px] font-bold leading-tight text-gray-500">Not available</p>
                <p className="mt-1 text-[9.5px] leading-tight text-gray-500">{l.label}</p>
              </div>
            ))}
          </div>
          <Explain summary="What each of these would need" className="mt-2">
            <Note>
              Trials, paid customers, conversion, churn and revenue — where the commercial capability is
              enabled.
            </Note>
            {m.commercial.lines.map(l => (
              <Note key={l.label}>
                <span className="font-semibold text-gray-900">{l.label}</span> — {l.why}
              </Note>
            ))}
          </Explain>
        </Panel>

        {/* ── I. PRACTICES REQUIRING ATTENTION (§10) ────────────────────────────────────────────── */}
        <Panel
          id="practices"
          title="Practices requiring attention"
          tone="warning"
          right={{ label: "View all", href: "/super-admin/pd/practices" }}
        >
          {m.practices.rows.length === 0 ? (
            <p className="text-[12px] text-gray-600">No Practice in scope is currently in an exception state.</p>
          ) : (
            <ul>
              {m.practices.rows.map(p => (
                <li key={p.id} className="border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
                  <Link
                    href={p.href}
                    className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-[12px] font-semibold text-gray-900 group-hover:text-teal-800">
                        {p.name}
                      </p>
                      <SeverityChip severity={p.severity} />
                    </div>
                    <p className="mt-0.5 text-[11px] leading-snug text-gray-600">{p.reason}</p>
                    <p className="mt-0.5 truncate text-[10px] text-gray-400">
                      {p.lifecycle}
                      {p.market ? ` · ${p.market}` : ""}
                      {p.ownerName ? ` · owned by ${p.ownerName}` : " · owner not recorded"}
                      {` · ${p.age}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Explain summary="How this list is ranked and how far it reaches" className="mt-2">
            <Note>
              Ranked by severity. Non-clinical throughout: a Practice&apos;s name, its owner, its market
              and its state — never anything about a patient.
            </Note>
            <Note>
              {m.practices.note}
              {m.practices.estateTotal !== null
                ? m.practices.estateTotal === 1
                  ? " Across the whole of this scope, 1 Practice is suspended or failed to be created."
                  : ` Across the whole of this scope, ${m.practices.estateTotal} Practices are suspended or failed to be created.`
                : " The count of exceptions across the whole scope could not be read, so this list may not be the whole picture."}
            </Note>
          </Explain>
        </Panel>
      </div>

      {/* ── J · K — the comp's closing band: Director Focus beside Quick actions ─────────────────── */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[2fr_1fr]">

        {/* ── J. PRODUCT DIRECTOR FOCUS (§11) ───────────────────────────────────────────────────── */}
        <Panel id="focus" title="Product Director focus" tone="brand" icon="spark">
          {/* ⚠ NO VERTICAL RULES BETWEEN THE ITEMS. The comp draws three focus items separated by
              hairlines; §11 allows up to five, so a fourth starts a second row and a first-in-row
              divider would be a rule hanging in space. The numbered badge carries the sequence. */}
          <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {m.focus.map((f, i) => (
              <li key={f.key} className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-violet-100 text-[9.5px] font-bold tabular-nums text-violet-700">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="min-w-0 text-[12px] font-semibold leading-snug text-gray-900">{f.title}</p>
                </div>
                <p className="mt-1 text-[11px] leading-snug text-gray-600">{f.rationale}</p>
                <Link
                  href={f.action.href}
                  className="mt-1 inline-flex items-center gap-1 rounded text-[11px] font-semibold text-violet-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                >
                  {f.action.label}
                  <Icon name="arrow" className="h-3 w-3" />
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-2.5 text-[10px] leading-relaxed text-gray-500">
            At most five. Each is a fixed rule over the figures above, not a suggestion from a model — the
            reasoning is shown so it can be disagreed with.
          </p>
        </Panel>

        {/* ── K. OPERATIONAL SHORTCUTS (§12) ────────────────────────────────────────────────────── */}
        <Panel id="shortcuts" title="Quick actions">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 xl:grid-cols-1">
            {SHORTCUTS.map(s => (
              <Link
                key={s.href}
                href={s.href}
                className="group flex items-center gap-2 rounded-lg px-1.5 py-1.5 transition-colors hover:bg-teal-50/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500"
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500 group-hover:text-teal-700">
                  <Icon name={s.icon} className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12px] font-semibold text-gray-800 group-hover:text-teal-800">{s.label}</span>
                  <span className="block truncate text-[10px] text-gray-500">{s.note}</span>
                </span>
                <Icon name="chevron" className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-teal-600" />
              </Link>
            ))}
          </div>
          <Explain summary="What reaching one of these does and does not grant" className="mt-2">
            <Note>
              Secondary to product state and exceptions, and deliberately last on the page (§12). Every
              destination checks your authorisation again on arrival. Reaching one from here grants
              nothing, and a link you can see is not a permission you hold.
            </Note>
          </Explain>
        </Panel>
      </div>

      {/* Read failures, in full, at the foot. §14: a component that could not be filled says so. */}
      {m.problems.length > 0 && (
        <section aria-labelledby="problems-h" className={`${CARD} border-[var(--cmp-color-warning)] p-4`}>
          <h2 id="problems-h" className="text-[13px] font-semibold text-[var(--cmp-text-warning)]">
            Reads that did not complete
          </h2>
          <p className="mt-0.5 text-[11px] text-gray-600">
            Listed so no figure above has to stand in for one. None of these is being shown as a zero.
          </p>
          <ul className="mt-1.5 space-y-1">
            {m.problems.map((p, i) => (
              <li key={i} className="text-[11px] leading-relaxed text-gray-700">{p}</li>
            ))}
          </ul>
        </section>
      )}

      <p className="pb-4 text-[10px] leading-relaxed text-gray-400">
        Mission Control summarises Competen Practice and routes to the module that owns each subject; it
        does not replace Product Operations, Product Intelligence, Product Health or Commercial. Every
        figure carries its period and its scope, and every figure it cannot produce says which fact is
        missing instead of showing a zero.
      </p>
    </div>
  );
}
