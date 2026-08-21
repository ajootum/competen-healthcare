import Link from "next/link";
import type { IntelligenceSuite } from "@/lib/practice/intelligence";
import type { PiV2Extras } from "@/lib/practice/pi-v2";
import type { ConditionalZones } from "@/lib/practice/pi-conditional";
// Type-only: the reads happen on the page, so this component stays a pure renderer.
import type { treatmentsRecorded, investigationsOrdered } from "@/lib/practice/report-engine";
import CohortSaveControl from "./CohortSaveControl";
import { SEGMENT_REGISTRY } from "@/lib/practice/segment-registry";
import { metricById } from "@/lib/practice/intelligence-registry";
// ⚠ THE SHARED BLOCK, NOT A SECOND COPY. OpenableCountBlock carries the rule that a non-ok status
// draws an EM DASH AND NEVER A NOUGHT, and it has no prop that makes it do otherwise. Re-rendering a
// count inline here would give that rule two owners and one maintainer -- Areas.tsx already imports
// the same component for the same reason.
import { OpenableCountBlock } from "./Ui";
import { weekdayPattern, INTELLIGENCE_TABS, type IntelligenceTabKey } from "@/lib/practice/intelligence-constants";

// CPR-PI-001 v2 P0 -- the five rebuilt screen contracts (s6-s10), composed from the EXISTING modules
// plus pi-v2's three extras. No figure here is computed in this file: presentation only, so a screen
// can never disagree with the engine that owns its number.
//
// THE PERCENTAGE RULE, APPLIED: a proportion renders as a percentage ONLY beside its own counts
// ("72 of 96 · 75%"), only where a registry entry governs it, and never as a judgement. Every
// percentage in this file is derived inline from a numerator and denominator that print WITH it --
// there is no % without its fraction in the same breath (v2 s19).
//
// DRILL-THROUGH (s17): intelligence informs, operational workspaces act. Every actionable row is a
// LINK into the workspace that owns the work, carrying its filter.

/* eslint-disable @typescript-eslint/no-explicit-any */

type Suite = IntelligenceSuite;
const CARD = "rounded-xl border border-gray-200 bg-white p-4";

/** "72 of 96 (75%)" -- the only way a percentage is ever born on these screens. */
function ofPct(numerator: number | null, denominator: number | null): string {
  if (numerator === null || denominator === null) return "not available";
  if (denominator === 0) return `${numerator} of 0`;
  return `${numerator} of ${denominator} (${Math.round((numerator / denominator) * 100)}%)`;
}

// `className` exists so ONE card in a grid can be breakpoint-scoped without wrapping it in a div --
// a wrapper would stop it being a direct grid child and would silently break the desktop column count.
function Kpi({ label, value, sub, className }: { label: string; value: string; sub?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-[11px] font-semibold text-gray-500">{label}</p>
      <p className="mt-0.5 text-xl font-bold text-gray-900">{value}</p>
      {sub && <p className="text-[10px] text-gray-500">{sub}</p>}
    </div>
  );
}

function TrustFooter({ ids }: { ids: string[] }) {
  // s6's trust footer, on every rebuilt screen: where the numbers come from and which definitions
  // they answer to. The registry names render so a reader can ask for any definition by name.
  return (
    <p className="rounded-xl border border-gray-100 bg-gray-50/60 px-4 py-3 text-[11px] text-gray-500">
      <strong className="text-gray-600">All insights are derived from this practice&apos;s own records.</strong>{" "}
      Definitions: {ids.map(id => metricById(id)?.displayName ?? id).join(", ")}. Every percentage on
      this screen prints beside its own counts; a figure that could not be read says so rather than
      rendering as zero.
    </p>
  );
}

function Unavailable({ module: m }: { module: any }) {
  return <p className="text-[12px] text-gray-600">{m.unavailableReason ?? "This module could not be read. That is not a zero."}</p>;
}

function metricValue(m: any): string {
  return m?.value === null || m?.value === undefined ? "—" : String(m.value);
}

// weekdayPattern moved to intelligence-constants.ts: the report engine renders the same weekday
// grouping, and two copies of that loop is how two surfaces disagree about what a Tuesday is.

function MiniTrend({ buckets }: { buckets: { day: string; total: number }[] }) {
  const max = Math.max(1, ...buckets.map(b => b.total));
  return (
    <div className="flex h-16 items-end gap-[2px]" role="img"
      aria-label={`Consultations per day, peak ${max}`}>
      {buckets.map(b => (
        <div key={b.day} title={`${b.day}: ${b.total}`}
          className="min-w-[3px] flex-1 rounded-t bg-[var(--cp-primary)]/60"
          style={{ height: `${Math.max(3, Math.round((b.total / max) * 100))}%` }} />
      ))}
    </div>
  );
}

// ══ 1. OVERVIEW (v2 s6) ═════════════════════════════════════════════════════════════════════════════

// ⚠ CPR-MOB-001 s13 LIVES IN THIS FUNCTION, AND IT REORDERS NOTHING.
//
// s13's mobile priority order is 1 period selector, 2 three-to-four KPI cards, 3 top conditions,
// 4 practice changes, 5 care gaps / continuity, 6 Ask Practice, 7 View more. The DOM order this
// screen already had -- KPIs, top conditions, practice changes, follow-up status, care gaps, trend --
// is s13's 2,3,4,5 verbatim, so below md nothing moves. Only three things happen:
//
//   * the 6-up KPI grid shows FOUR below md (s5's "prioritise 3-4 key metrics"), the other two going
//     into View more UNCHANGED and IN THEIR OWN ORDER;
//   * Ask Practice is slotted at 6 by the page, which owns the one AskField;
//   * the consultations chart and the two secondary KPIs sit behind View more at 7.
//
// Every figure below is rendered by the SAME expression the desktop face uses -- no mobile branch
// reads a field of its own, which is the only reliable defence against a mobile card confidently
// rendering a property the payload never carried.
export function OverviewV2Area({ suite, extras, mobileAsk, tabHref }: {
  suite: Suite; extras: PiV2Extras;
  /** s13 priority 6, injected by the page so there is exactly one AskField in the tree. */
  mobileAsk?: React.ReactNode;
  /** Range-carrying tab links for the View more doors. Without it they are omitted, never built
      range-less: a door that silently resets the period is worse than no door. */
  tabHref?: (key: IntelligenceTabKey) => string;
}) {
  const mods = suite.workspace.modules;
  const o = mods.overview;
  const f = mods.followUps;
  // OverviewData.metrics is the PracticeMetrics WRAPPER; the twelve live under .metrics by key.
  const metrics: any = o.available ? (o.data as any).metrics?.metrics : null;
  const patientsMod = mods.patients;
  const newTo: any = patientsMod.available ? (patientsMod.data as any).newToPractice : null;
  const completion: any = f.available ? (f.data as any).completion : null;
  const overdue: any = f.available ? (f.data as any).overdue : null;

  // s6's care gaps, each a DOOR (s17), never an action here. Only gaps the record can prove.
  const gaps: { label: string; count: number | null; href: string }[] = [
    { label: "Overdue clinical follow-ups", count: overdue?.value ?? null, href: "/practice/follow-ups?filter=overdue" },
  ];

  // THE TWO SECONDARY KPIs, DEFINED ONCE AND PLACED TWICE. Identical expressions in the desktop grid
  // (hidden below md) and inside View more (hidden at md and up), so the two faces cannot drift into
  // showing different numbers for the same label -- the conflicting-copy failure the whole engine
  // layer is arranged to prevent.
  const secondaryKpis = (className?: string) => (
    <>
      <Kpi label="Follow-ups due" value={metricValue(metrics?.follow_ups_due)} className={className} />
      <Kpi label="Visits per patient"
        value={extras.available && extras.data && extras.data.avgVisitsPerPatient.patients > 0
          ? (extras.data.avgVisitsPerPatient.encounters / extras.data.avgVisitsPerPatient.patients).toFixed(1)
          : "—"}
        sub={extras.available && extras.data
          ? `${extras.data.avgVisitsPerPatient.encounters} visits, ${extras.data.avgVisitsPerPatient.patients} patients`
          : undefined}
        className={className} />
    </>
  );

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        {!o.available ? <Unavailable module={o} /> : (
          // grid-cols-2 is the BASE only: sm and lg still win at 640 and 1024, so the desktop grid is
          // 3-up and 6-up exactly as before. The change is confined to phones, where a single column
          // of six made s13's priority-2 cards a scroll instead of a glance.
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Patients seen" value={metricValue(metrics.patients_seen)} />
            <Kpi label="Consultations" value={metricValue(metrics.completed)} />
            <Kpi label="Returning patients"
              value={newTo && newTo.numerator !== null && newTo.denominator !== null
                ? ofPct(newTo.denominator - newTo.numerator, newTo.denominator) : "—"}
              sub="of patients seen; the rest are new to the practice" />
            <Kpi label="Follow-ups completed"
              value={completion ? ofPct(completion.numerator, completion.denominator) : "—"}
              sub="of those raised this period" />
            {secondaryKpis("max-md:hidden")}
          </div>
        )}
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <div className="flex items-baseline justify-between">
            <h3 className="text-[13px] font-bold text-gray-900">Top conditions</h3>
            <Link href={tabLink("clinical")} className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">View all &rarr;</Link>
          </div>
          <ConditionsList suite={suite} limit={5} />
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Practice changes</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">vs the immediately preceding equal period; a comparison that was not earned says why.</p>
          {!o.available ? <Unavailable module={o} /> : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {((o.data as any).comparisons as any[]).slice(0, 6).map(c => (
                <li key={c.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-700">{c.label}</span>
                  <span className="ml-auto font-semibold text-gray-900">
                    {c.current ?? "—"}{c.prior !== null && <span className="font-normal text-gray-500"> vs {c.prior}</span>}
                  </span>
                  {c.status !== "ok" && c.reason && <span className="text-[10px] text-gray-400">{c.reason}</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Follow-up status</h3>
          {!f.available ? <Unavailable module={f} /> : (
            <div className="mt-1 text-[12px] text-gray-700">
              {/* pi.followup_completion: the governed denominator IS the raised-in-period cohort, and
                  the not-yet-due share prints beside the figure instead of quietly shrinking it. */}
              <p>Completed {ofPct(completion?.numerator ?? null, completion?.denominator ?? null)}</p>
              {completion?.caveat && <p className="mt-0.5 text-[11px] text-gray-500">{completion.caveat}</p>}
              <p className="mt-1">
                <Link href="/practice/follow-ups" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                  Act on follow-ups &rarr;
                </Link>
              </p>
            </div>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Care gaps detected from your records</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {gaps.map(g => (
              <li key={g.label}>
                <Link href={g.href} className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                  <span className="text-gray-800">{g.label}</span>
                  <span className="ml-auto font-bold text-gray-900">{g.count ?? "could not be read"}</span>
                  <span aria-hidden="true" className="text-gray-400">&rarr;</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[10px] text-gray-500">
            A gap here is a record without a successor, never a claim that care did not happen.
          </p>
        </section>
      </div>

      {/* ── s13 PRIORITY 7's CHART, ABOVE md ONLY ───────────────────────────────────────────────
          It is NOT converted to a ranked list: MiniTrend is already the "simplified mini chart" s13
          offers as the alternative, and it already carries the textual summary s17 requires under it
          ("N this period, M in the period before, busiest ..."). Converting a 30-day bar sparkline
          into a 30-row ranked list would be strictly less comprehensible on a phone, which is the
          test s13 sets. So it moves behind View more unchanged rather than being redrawn. */}
      <TrendSection suite={suite} className="max-md:hidden" />

      {/* ── s13 PRIORITY 6: ASK PRACTICE, in its contract position ──────────────────────────────
          Slotted rather than built here: the page owns the single AskField (see its doctrine), and
          this area owns only WHERE it lands in the vertical story. */}
      {mobileAsk}

      {/* ── s13 PRIORITY 7: VIEW MORE ───────────────────────────────────────────────────────────
          "View more for deeper charts and secondary metrics", and that is exactly and only what is
          in here: the two KPI cards s5 asked to be demoted, the consultations chart, and doors to
          the deeper areas the desktop overview grid draws (which is hidden below md -- see the page).
          Collapsed by default and native <details>, so it costs one tap and no JavaScript. */}
      <details className="rounded-xl border border-gray-200 bg-white md:hidden">
        <summary className="flex min-h-[var(--cp-touch)] cursor-pointer list-none items-center gap-2 px-4 text-[13px] font-semibold text-[var(--cp-primary-deep)]">
          View more
          <span aria-hidden className="ml-auto text-gray-400">&#9662;</span>
        </summary>
        <div className="flex flex-col gap-3 border-t border-gray-100 p-4">
          {/* The demoted two, from the SAME expression the desktop grid renders. Omitted entirely
              when the module could not be read -- the section above already carries that reason, and
              two em dashes with no explanation beside them is the confident blank this workspace
              exists to refuse. */}
          {o.available && <div className="grid grid-cols-2 gap-3">{secondaryKpis()}</div>}
          <TrendSection suite={suite} />
          {/* ⚠ DOORS, NOT COPIES -- AND FOR TWO OF THEM THIS IS THE ONLY MOBILE ROUTE.
              INTELLIGENCE_TAB_STRIP draws nine of the twelve tabs; brief, cohorts and pathways are
              OFF-STRIP and reachable by URL alone. The desktop overview grid is where Today's Brief
              and Care Pathways were actually surfaced, so hiding that grid below md without these
              two links would strand both areas on a phone. Patient Intelligence and Reports are on
              the strip as well; all four are listed so that every panel the hidden grid drew has a
              door, rather than leaving a reader to work out which two happen to be in the strip.
              Labels come from the registry, so this list cannot drift from what the strip calls
              them. If a key here is ever added to the strip, this list is still correct. */}
          {tabHref && (
            <ul className="flex flex-col gap-2">
              {(["brief", "patients", "pathways", "reports"] as IntelligenceTabKey[]).map(k => {
                const t = INTELLIGENCE_TABS.find(x => x.key === k);
                if (!t) return null;
                return (
                  <li key={k}>
                    <Link href={tabHref(k)}
                      className="flex min-h-[var(--cp-touch)] items-center gap-2 rounded-lg border border-gray-100 px-3 text-[12.5px] font-semibold text-[var(--cp-primary-deep)]">
                      <span className="min-w-0 flex-1">{t.label}</span>
                      <span aria-hidden className="text-gray-400">&rarr;</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </details>

      <TrustFooter ids={["pi.followup_completion", "pi.avg_visits_per_patient", "pi.top_conditions_by_patients"]} />
    </div>
  );
}

const tabLink = (key: string) => `/practice/intelligence?tab=${key}`;

function ConditionsList({ suite, limit }: { suite: Suite; limit: number }) {
  const p = suite.workspace.modules.patients;
  const o = suite.workspace.modules.overview;
  if (!p.available) return <Unavailable module={p} />;
  const diagnoses: any = (p.data as any).diagnoses;
  const rows: any[] = (diagnoses?.rows ?? []) as any[];
  if (rows.length === 0) return <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period. The read succeeded.</p>;
  // pi.top_conditions_by_patients: the ELIGIBLE set is patients seen -- summing per-condition patient
  // counts would double-count everyone with two conditions, which is most of general practice.
  const eligible: number | null = o.available ? ((o.data as any).metrics?.metrics?.patients_seen?.value ?? null) : null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {rows.slice(0, limit).map((r, i) => (
        <li key={i} className="flex items-baseline gap-2 text-[12px]">
          <span className="text-gray-800">{r.label}</span>
          <span className="ml-auto text-[11px] text-gray-500">
            {eligible ? ofPct(r.patients, eligible) : `${r.patients} patient${r.patients === 1 ? "" : "s"}`}
          </span>
        </li>
      ))}
    </ul>
  );
}

function TrendSection({ suite, className }: { suite: Suite; className?: string }) {
  const c = suite.workspace.modules.clinicalActivity;
  if (!c.available) return <section className={`${CARD} ${className ?? ""}`}><Unavailable module={c} /></section>;
  const trend: any = (c.data as any).trend;
  return (
    <section className={`${CARD} ${className ?? ""}`}>
      <h3 className="text-[13px] font-bold text-gray-900">Consultations over time</h3>
      <div className="mt-2"><MiniTrend buckets={trend.buckets ?? []} /></div>
      <p className="mt-1 text-[11px] text-gray-600">
        {trend.total} this period, {trend.priorTotal} in the period before
        {trend.busiestDay && trend.busiestDay.total > 0 ? ` · busiest ${trend.busiestDay.day} with ${trend.busiestDay.total}` : ""}
      </p>
    </section>
  );
}

// ══ 2. PATIENT INTELLIGENCE (v2 s7) ═════════════════════════════════════════════════════════════════

export function PatientV2Area({ suite, extras, segments, cohort, activeSegment, segmentHref, savedCohorts, activeCohortId, cohortHref, canManageCohorts }: {
  suite: Suite; extras: PiV2Extras;
  /** v2 s6 cohort controls: registered segment counts, and the filtered list when one is open. */
  segments: Awaited<ReturnType<typeof import("@/lib/practice/cohort-engine").computeSegments>> | null;
  cohort: Awaited<ReturnType<typeof import("@/lib/practice/cohort-engine").cohortPatients>> | null;
  activeSegment: string | null;
  segmentHref: (id: string | null) => string;
  savedCohorts: { id: string; name: string; segmentIds: string[] }[];
  activeCohortId: string | null;
  cohortHref: (id: string) => string;
  canManageCohorts: boolean;
}) {
  const p = suite.workspace.modules.patients;
  if (!p.available) return <section className={CARD}><Unavailable module={p} /></section>;
  const d: any = p.data;
  const rec = extras.available && extras.data ? extras.data.recency : null;

  const dist = (dist: any, title: string) => (
    <section className={CARD}>
      <h3 className="text-[13px] font-bold text-gray-900">{title}</h3>
      {dist.status !== "ok" && dist.reason ? (
        <p className="mt-1 text-[12px] text-gray-600">{dist.reason}</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-0.5">
          {(dist.slices as any[]).map((s: any) => (
            <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
              <span className="text-gray-800">{s.label}</span>
              {/* Distribution slices carry the module's own `of` denominator -- v2 s19 satisfied by shape. */}
              <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, dist.of)}</span>
            </li>
          ))}
          {dist.unrecorded > 0 && (
            <li className="flex items-baseline gap-2 text-[12px] text-gray-500">
              <span>Unknown / not recorded</span>
              <span className="ml-auto text-[11px]">{ofPct(dist.unrecorded, dist.of)}</span>
            </li>
          )}
        </ul>
      )}
    </section>
  );

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Patients seen" value={metricValue(d.patientsSeen)} />
          <Kpi label="New registrations" value={d.registered?.value === null ? "—" : String(d.registered.value)} />
          <Kpi label="New to the practice" value={ofPct(d.newToPractice?.numerator ?? null, d.newToPractice?.denominator ?? null)}
            sub="of patients seen this period" />
          <Kpi label="Visits per patient"
            value={extras.available && extras.data && extras.data.avgVisitsPerPatient.patients > 0
              ? (extras.data.avgVisitsPerPatient.encounters / extras.data.avgVisitsPerPatient.patients).toFixed(1) : "—"}
            sub={extras.available && extras.data
              ? `${extras.data.avgVisitsPerPatient.encounters} visits over ${extras.data.avgVisitsPerPatient.patients} patients` : undefined} />
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        {dist(d.byAgeBand, "Age distribution")}
        {dist(d.bySex, "Sex distribution")}
      </div>
      <section className={CARD}>
        <div className="flex items-baseline justify-between">
          <h3 className="text-[13px] font-bold text-gray-900">Recency of last visit</h3>
          <Link href="/practice/patients" className="text-[11px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
            Open the register &rarr;
          </Link>
        </div>
        {!rec ? (
          <p className="mt-1 text-[12px] text-gray-600">{extras.unavailableReason ?? "Could not be read."}</p>
        ) : (
          <>
            <ul className="mt-1 flex flex-col gap-0.5">
              {rec.buckets.map(bkt => (
                <li key={bkt.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{bkt.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(bkt.count, rec.denominator)}</span>
                </li>
              ))}
              <li className="flex items-baseline gap-2 text-[12px] text-gray-500">
                <span>Never seen (registered, no encounter)</span>
                <span className="ml-auto text-[11px]">{ofPct(rec.neverSeen, rec.denominator)}</span>
              </li>
            </ul>
            {rec.truncated && (
              <p className="mt-1 text-[11px] text-amber-800">
                The read stopped at the row cap, so these buckets undercount. Narrow the question.
              </p>
            )}
          </>
        )}
      </section>
      {/* ── v2 s6 COHORT CONTROLS -- cohorts are FILTERS, not destinations. Segments are REGISTERED
             derivations (segment-registry.ts) computed at read time; membership is never stored. ── */}
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">Cohorts</h3>
        {!segments ? (
          <p className="mt-1 text-[12px] text-gray-500">Segment counts were not computed for this view.</p>
        ) : !segments.ok ? (
          <p className="mt-1 text-[12px] text-gray-600">{segments.message}</p>
        ) : (
          <>
            {/* CPR-MOB-001 s13 priority 1's "optional cohort/filter". Below md every chip grows to
                s4's 44px; the desktop row is unchanged at md and up. */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Link href={segmentHref(null)}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${activeSegment === null
                  ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                All patients
              </Link>
              {segments.results.map(r => (
                <Link key={r.segment.segmentId} href={segmentHref(r.segment.segmentId)}
                  title={r.segment.definition}
                  className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${activeSegment === r.segment.segmentId
                    ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                    : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                  {r.segment.displayName} &middot; {ofPct(r.count, r.denominator)}
                  {r.truncated ? "+" : ""}
                </Link>
              ))}
              {/* Gate-failed segments: the registry's refusal, worn as a disabled chip -- a zero here
                  would read as a fact about patients instead of a missing writer.
                  ⚠ s4: THE REASON WAS HOVER-ONLY, AND A PHONE HAS NO HOVER. Above md the `title`
                  still carries it; below md the same string renders as visible words, because a
                  greyed chip saying "not computable yet" with no reachable why is the disabled
                  control that reads as a broken product. One source, two presentations. */}
              {SEGMENT_REGISTRY.filter(s => s.gateFailed).map(s => (
                <span key={s.segmentId} title={s.gateFailed}
                  className="cursor-help rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-[11px] text-slate-400 max-md:block max-md:w-full max-md:cursor-auto">
                  {s.displayName} &middot; not computable yet
                  <span className="mt-0.5 block text-[10px] leading-snug text-slate-500 md:hidden">{s.gateFailed}</span>
                </span>
              ))}
            </div>
            {savedCohorts.length > 0 && (
              <div className="mt-2 flex flex-wrap items-baseline gap-1.5 border-t border-gray-100 pt-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Saved</span>
                {savedCohorts.map(c => (
                  <Link key={c.id} href={cohortHref(c.id)}
                    className={`rounded-lg border px-2.5 py-1 text-[11px] font-semibold max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${activeCohortId === c.id
                      ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
                    {c.name}
                  </Link>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-gray-500">
              {segments.timezoneNote}. A count marked + hit the read cap and is a floor. Age segments
              exclude patients with no recorded date of birth, and say so in their definitions. A saved
              cohort stores its definition, never its members &mdash; the list is recomputed every time.
            </p>
            {canManageCohorts && activeSegment && (
              <CohortSaveControl segmentIds={[activeSegment]}
                noVisitDays={segments.results.find(r => r.segment.segmentId === activeSegment)?.noVisitDays ?? null} />
            )}
          </>
        )}

        {cohort && (activeSegment || activeCohortId) && (
          <div className="mt-3 border-t border-gray-100 pt-2.5">
            {!cohort.ok ? (
              <p className="text-[12px] text-gray-600">{cohort.message}</p>
            ) : (
              <>
                {cohort.definitionSentences.map((s, i) => (
                  <p key={i} className="text-[11px] leading-relaxed text-gray-600">{s}</p>
                ))}
                <p className="mt-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                  {cohort.total} patient{cohort.total === 1 ? "" : "s"}
                  {cohort.rows.length < cohort.total ? ` (first ${cohort.rows.length} shown)` : ""}
                  {cohort.truncated ? " -- a read hit its cap, so this is a floor" : ""}
                </p>
                <ul className="mt-1 flex flex-col">
                  {cohort.rows.map(r => (
                    <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-50 py-1 last:border-0">
                      {cohort.identified ? (
                        <Link href={`/practice/patients/${r.id}`} className="min-w-0 truncate text-[12px] text-gray-800 hover:underline">{r.label}</Link>
                      ) : (
                        <span className="min-w-0 truncate text-[12px] text-gray-600">{r.label}</span>
                      )}
                      <span className="ml-auto shrink-0 text-[10px] text-gray-500">{r.detail}</span>
                    </li>
                  ))}
                </ul>
                {!cohort.identified && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    Names need patient.view -- the count is complete, the list is deliberately unnamed.
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">Top conditions</h3>
        <ConditionsList suite={suite} limit={8} />
      </section>
      <TrustFooter ids={["pi.recency_last_visit", "pi.avg_visits_per_patient", "pi.top_conditions_by_patients"]} />
    </div>
  );
}

// ══ 3. CLINICAL INTELLIGENCE (v2 s8) ════════════════════════════════════════════════════════════════

/** v2 s8's two Required-Now datasets, read by the page from the engines the reports already use. */
export type ClinicalV2Reads = {
  treatments: Awaited<ReturnType<typeof treatmentsRecorded>>;
  investigations: Awaited<ReturnType<typeof investigationsOrdered>>;
};

export function ClinicalV2Area({ suite, zones, clinical }: {
  suite: Suite; zones: ConditionalZones; clinical: ClinicalV2Reads;
}) {
  const p = suite.workspace.modules.patients;
  const c = suite.workspace.modules.clinicalActivity;
  const proc = suite.workspace.modules.procedures;
  const o = suite.workspace.modules.overview;
  // ⚠ BOUND TO CONSTS, NOT READ THROUGH `clinical.` AT EACH USE. TypeScript discards the narrowing of
  // a PROPERTY ACCESS inside a callback -- the object could in principle change between the check and
  // the call -- so `tx.total` inside a .map() does not see the ok:true branch. A const
  // cannot be reassigned, so the narrowing survives into every callback below.
  const tx = clinical.treatments;
  const inv = clinical.investigations;
  const diagnoses: any = p.available ? (p.data as any).diagnoses : null;
  const rows: any[] = (diagnoses?.rows ?? []) as any[];
  const totalRecords: number | null = diagnoses?.total ?? null;
  const eligible: number | null = o.available ? ((o.data as any).metrics?.metrics?.patients_seen?.value ?? null) : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Top conditions by patients</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">Distinct people. Prevalence in this practice, not occurrence.</p>
          {!p.available ? <Unavailable module={p} /> : rows.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {rows.slice(0, 8).map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{r.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.patients ?? null, eligible)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Top conditions by records</h3>
          {/* v2 s15's own warning, on the screen: occurrence is NOT prevalence, so the two lists
              stand side by side under different headings instead of blending into one number. */}
          <p className="mt-0.5 text-[10px] text-gray-500">Diagnosis records, not people -- one patient reviewed monthly counts each time.</p>
          {!p.available ? <Unavailable module={p} /> : rows.length === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No diagnoses recorded in this period.</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {[...rows].sort((x, y) => (y.total ?? 0) - (x.total ?? 0)).slice(0, 8).map((r, i) => (
                <li key={i} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{r.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.total ?? null, totalRecords)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
      <TrendSection suite={suite} />
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Procedures</h3>
          {!proc.available ? <Unavailable module={proc} /> : (
            <p className="mt-1 text-[12px] text-gray-700">
              See the longitudinal record on{" "}
              <Link href="/practice/activity" className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                Procedures &amp; Clinical Activity &rarr;
              </Link>
            </p>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultation shape</h3>
          {!c.available ? <Unavailable module={c} /> : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {(((c.data as any).byMode?.slices ?? []) as any[]).map((s: any) => (
                <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{s.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, (c.data as any).byMode?.of ?? null)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* ── v2 s8's TREATMENTS AND INVESTIGATIONS, which this screen did not have ─────────────────
          Both are Required-Now in v2 s8 and both were reachable ONLY through a report template or an
          Ask Practice question -- `pi.treatments_recorded` had two consumers, both in the report path,
          and nothing rendered `ask.investigations_ordered` at all. The engines and the registry entries
          already existed; the Clinical screen simply never asked for them.

          Counts and denominators, labels as typed. No rate is drawn over either: a "top treatment"
          percentage would be a share of an unbounded label space nobody normalises. */}
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Treatments recorded</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            What was DECIDED in the period &mdash; an intention, never an administration record.
          </p>
          {!tx.ok ? (
            <p className="mt-1 text-[12px] text-gray-600">
              Treatments could not be read ({tx.detail}). That is not a zero.
            </p>
          ) : tx.total === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No treatments recorded in this period.</p>
          ) : (
            <>
              <ul className="mt-1 flex flex-col gap-0.5">
                {tx.byType.map(r => (
                  <li key={r.label} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-gray-800">{String(r.label).replace(/_/g, " ")}</span>
                    <span className="ml-auto tabular-nums text-gray-900">{r.total}</span>
                    <span className="text-[11px] text-gray-500">of {tx.total}</span>
                  </li>
                ))}
              </ul>
              {tx.byLabel.length > 0 && (
                <>
                  <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500">Most recorded</p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {tx.byLabel.slice(0, 8).map(r => (
                      <li key={r.label} className="flex items-baseline gap-2 text-[12px]">
                        <span className="truncate text-gray-800">{r.label}</span>
                        <span className="ml-auto tabular-nums text-gray-900">{r.total}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-1.5 text-[10px] text-gray-400">
                {metricById("pi.treatments_recorded")?.displayName ?? "Treatments recorded"}
                {tx.truncated
                  ? " · read capped at 1000 rows, so these counts are a floor rather than a total"
                  : " · labels as typed, so two spellings are two rows"}
              </p>
            </>
          )}
        </section>

        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Investigations ordered</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Requested in the period, and how many have been reviewed since.
          </p>
          {!inv.ok ? (
            <p className="mt-1 text-[12px] text-gray-600">
              Investigations could not be read ({inv.detail}). That is not a zero.
            </p>
          ) : inv.total === 0 ? (
            <p className="mt-1 text-[12px] text-gray-500">No investigations requested in this period.</p>
          ) : (
            <>
              <ul className="mt-1 flex flex-col gap-0.5">
                {inv.rows.slice(0, 10).map(r => (
                  <li key={r.label} className="flex items-baseline gap-2 text-[12px]">
                    <span className="truncate text-gray-800">{r.label}</span>
                    <span className="ml-auto tabular-nums text-gray-900">{r.total}</span>
                    {/* ⚠ REVIEWED IS A COUNT BESIDE ITS DENOMINATOR, NOT A COMPLETION RATE. An
                        unreviewed investigation may be one whose result has not arrived, so a
                        percentage here would read as a performance figure for waiting. */}
                    <span className="text-[11px] text-gray-500">{r.reviewed} reviewed</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-[10px] text-gray-400">
                {inv.total} requested in the period
                {inv.truncated ? " · read capped at 1000 rows, so this is a floor" : ""}
                {" · "}an investigation with no result recorded is not evidence that none arrived
              </p>
            </>
          )}
        </section>
      </div>

      {/* ── s8's CONDITIONAL ZONES, both gates met -- see pi-conditional.ts's header. ───────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Condition &rarr; treatment</h3>
          {(() => {
            if (!zones.available || !zones.data)
              return <p className="mt-1 text-[12px] text-gray-600">{zones.unavailableReason ?? "could not be read"}</p>;
            const ct = zones.data.conditionTreatment;
            if (ct.total === 0)
              return <p className="mt-2 text-[12px] text-gray-500">No treatments recorded in this period.</p>;
            return (
              <>
                {ct.pairs.length === 0 ? (
                  <p className="mt-2 text-[12px] text-gray-600">
                    0 of {ct.total} treatment rows carry a diagnosis link, so no pair can be drawn.
                    Linking happens at capture &mdash; a pair is a practitioner&apos;s own connection,
                    never a guess.
                  </p>
                ) : (
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {ct.pairs.map((p, i) => (
                      <li key={i} className="flex items-baseline gap-2 text-[12px]">
                        <span className="min-w-0 truncate text-gray-800">{p.condition} &rarr; {p.treatment}</span>
                        <span className="ml-auto shrink-0 text-[11px] text-gray-500">{ofPct(p.total, ct.linked)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[10px] text-gray-500">
                  {ct.linked} of {ct.total} treatment rows carry the link; the {ct.unlinked} without
                  it are counted here, never guessed into a pair.
                </p>
              </>
            );
          })()}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Referrals</h3>
          {(() => {
            const refs: any = suite.referrals;
            if (!refs?.available || !refs.data) return <Unavailable module={refs} />;
            const rd: any = refs.data;
            return (
              <>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {((rd.byStatus?.slices ?? []) as any[]).map((s: any) => (
                    <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                      <span className="text-gray-800">{s.label}</span>
                      <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, rd.byStatus?.of ?? null)}</span>
                    </li>
                  ))}
                </ul>
                {(rd.destinations ?? []).length > 0 && (
                  <ul className="mt-2 border-t border-gray-100 pt-1.5">
                    {(rd.destinations as any[]).slice(0, 5).map((x: any, i: number) => (
                      <li key={i} className="flex items-baseline gap-2 text-[11px]">
                        <span className="min-w-0 truncate text-gray-700">{x.label}</span>
                        <span className="ml-auto shrink-0 text-gray-500">{x.total} ({x.patients} patient{x.patients === 1 ? "" : "s"})</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[10px] leading-relaxed text-amber-700">{rd.limitation}</p>
              </>
            );
          })()}
        </section>
      </div>
      {/* ══ MEDICATION REVIEW (CPR-PIE-001 s3) ═════════════════════════════════════════════════
          ⚠ IT SITS IN CLINICAL RATHER THAN BECOMING A SIXTH AREA. The tab strip is frozen and
          practice-pi-v2 4-5 pins the screen at exactly five trust footers -- a new area would red
          both. This is a clinical figure and it belongs beside referrals, not in a tab of its own.

          ⚠⚠ TWO COUNTS, ALWAYS BOTH. "3 due for review" on its own invites the reading that
          everything else is watched, when forty medications may carry no review date at all. The
          engine returns the unscheduled count for exactly that reason and the panel may not drop it:
          rendering the first without the second would put the omission back. */}
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">Medication review</h3>
        {(() => {
          const meds: any = suite.medications;
          if (!meds?.available || !meds.data) return <Unavailable module={meds} />;
          const md: any = meds.data;
          return (
            <>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <OpenableCountBlock item={md.dueForReview} figureClass="text-amber-700" />
                <OpenableCountBlock item={md.noReviewDate} />
              </div>
              {/* The rule, on the screen, because the rule is what the first figure MEANS. */}
              <p className="mt-2 text-[10px] leading-relaxed text-gray-500">{md.rule}</p>
            </>
          );
        })()}
      </section>
      <TrustFooter ids={["pi.top_conditions_by_patients", "pi.top_conditions_by_encounters", "pi.condition_treatment_pairs", "pi.referrals_recorded", "pi.medication_due_for_review", "pi.medication_no_review_date"]} />
    </div>
  );
}

// ══ 4. FOLLOW-UP & OUTCOMES (v2 s9) ═════════════════════════════════════════════════════════════════

export function FollowUpV2Area({ suite, extras, zones }: { suite: Suite; extras: PiV2Extras; zones: ConditionalZones }) {
  const f = suite.workspace.modules.followUps;
  if (!f.available) return <section className={CARD}><Unavailable module={f} /></section>;
  const d: any = f.data;
  const median = extras.available && extras.data ? extras.data.medianDaysToFollowUp : null;
  const refs: any = suite.referrals;
  const inv = zones.available && zones.data ? zones.data.investigationsAwaiting : null;

  return (
    <div className="flex flex-col gap-3">
      <section className={CARD}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Raised this period" value={String(d.completion?.denominator ?? "—")} />
          <Kpi label="Completed" value={ofPct(d.completion?.numerator ?? null, d.completion?.denominator ?? null)}
            sub={d.completion?.caveat ?? undefined} />
          <Kpi label="Overdue now" value={d.overdue?.value === null ? "—" : String(d.overdue.value)}
            sub="as at today, across all periods" />
          <Kpi label="Median days to follow-up"
            value={median?.medianDays === null || !median ? "—" : String(median.medianDays)}
            sub={median ? `${median.pairs} completed pair${median.pairs === 1 ? "" : "s"}; early completions count negative` : undefined} />
        </div>
      </section>
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">By kind</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byKind?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byKind?.of ?? null)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Care gaps</h3>
          <ul className="mt-1 flex flex-col gap-1">
            <li>
              <Link href="/practice/follow-ups?filter=overdue"
                className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                <span className="text-gray-800">Overdue clinical follow-ups</span>
                <span className="ml-auto font-bold text-gray-900">{d.overdue?.value ?? "—"}</span>
                <span aria-hidden="true" className="text-gray-400">&rarr;</span>
              </Link>
            </li>
            {/* v2 s9's conditional gaps, each gated on real structure -- see pi-conditional.ts. */}
            <li>
              <Link href="/practice/encounters"
                className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                <span className="text-gray-800">Investigations with nothing back</span>
                <span className="ml-auto font-bold text-gray-900">{inv ? inv.nothingBack : "—"}</span>
                <span aria-hidden="true" className="text-gray-400">&rarr;</span>
              </Link>
              {inv && inv.linkedNotReviewed > 0 && (
                <p className="mt-0.5 px-2.5 text-[10px] text-amber-700">
                  Plus {inv.linkedNotReviewed} where a report arrived and is not yet marked reviewed.
                </p>
              )}
            </li>
            <li>
              <Link href="/practice/patients"
                className="flex items-baseline gap-2 rounded-lg border border-gray-100 px-2.5 py-1.5 text-[12px] hover:bg-gray-50">
                <span className="text-gray-800">Referrals without subsequent information</span>
                <span className="ml-auto font-bold text-gray-900">
                  {refs?.available ? ((refs.data as any)?.awaitingNews?.count ?? "—") : "—"}
                </span>
                <span aria-hidden="true" className="text-gray-400">&rarr;</span>
              </Link>
            </li>
            {/* The gap that failed its gate, refused IN POSITION (s7 "where supported"): */}
            <li className="rounded-lg border border-dashed border-slate-200 px-2.5 py-1.5">
              <p className="text-[12px] text-gray-500">Planned procedures incomplete</p>
              <p className="text-[10px] leading-relaxed text-gray-500">
                Not supported: procedures here have exactly two states, performed and abandoned &mdash; a planned-procedure state does not exist, so this gap cannot
                be computed and no number pretends otherwise.
              </p>
            </li>
          </ul>
          <p className="mt-1 text-[10px] text-gray-500">
            Every gap routes to the workspace that owns the work (v2 s17). No subsequent record in
            CompetenPractice is never a claim that care did not occur.
          </p>
        </section>
      </div>
      {/* ── s9's OUTCOMES ZONE, conditional and its gate is met: outcome_code is an explicit
             assessment vocabulary. Rendered from outcomePicture's own counts -- NEVER inferred from
             notes or from absence, and the uncoded share sits beside the coded rows. ─────────── */}
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">Outcomes, as recorded</h3>
        <div className="mt-1 grid gap-3 md:grid-cols-2">
          <ul className="flex flex-col gap-0.5">
            {((d.concluded?.byOutcome ?? []) as any[]).map((b: any) => (
              <li key={b.code} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{b.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(b.total ?? null, d.concluded?.concluded ?? null)}</span>
              </li>
            ))}
            <li className="flex items-baseline gap-2 text-[12px]">
              <span className="italic text-gray-500">Completed without an outcome code</span>
              <span className="ml-auto text-[11px] text-gray-500">{ofPct(d.concluded?.uncoded ?? null, d.concluded?.concluded ?? null)}</span>
            </li>
          </ul>
          <p className="text-[10px] leading-relaxed text-gray-500">
            Only what a practitioner explicitly coded at closure counts here &mdash; an outcome is
            never inferred from notes or from absence, so the coded rows understate what happened
            and the uncoded row says by how much.
          </p>
        </div>
      </section>
      <TrustFooter ids={["pi.followup_completion", "pi.median_days_followup", "pi.followup_outcomes", "pi.investigations_awaiting_result", "pi.referrals_awaiting_news"]} />
    </div>
  );
}

// ══ 5. PRACTICE PATTERNS (v2 s10) ═══════════════════════════════════════════════════════════════════

export function PatternsV2Area({ suite, patterns }: {
  suite: Suite;
  patterns: import("@/lib/practice/pi-conditional").PatternsConditionals;
}) {
  const c = suite.workspace.modules.clinicalActivity;
  const loc = suite.workspace.modules.locations;
  if (!c.available) return <section className={CARD}><Unavailable module={c} /></section>;
  const d: any = c.data;
  const weekdays = weekdayPattern(d.trend?.buckets ?? []);
  const weekTotal = weekdays.reduce((n, w) => n + w.count, 0);
  const max = Math.max(1, ...weekdays.map(w => w.count));
  const pd = patterns.available ? patterns.data : null;
  const dur: any = (suite.workspace.modules.overview.data as any)?.metrics?.metrics?.average_consult_time ?? null;
  const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div className="flex flex-col gap-3">
      <TrendSection suite={suite} />
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultations by weekday</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Derived from the same daily trend every screen shares, in the practice&apos;s own calendar.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {weekdays.map(w => (
              <li key={w.label} className="flex items-center gap-2 text-[12px]">
                <span className="w-9 text-gray-600">{w.label}</span>
                <span className="h-2.5 rounded bg-[var(--cp-primary)]/50" style={{ width: `${Math.round((w.count / max) * 70)}%` }} />
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(w.count, weekTotal || null)}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Consultation types</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byMode?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byMode?.of ?? null)}</span>
              </li>
            ))}
          </ul>
          <h3 className="mt-3 text-[13px] font-bold text-gray-900">Entry pathway</h3>
          <ul className="mt-1 flex flex-col gap-0.5">
            {((d.byPathway?.slices ?? []) as any[]).map((s: any) => (
              <li key={s.key} className="flex items-baseline gap-2 text-[12px]">
                <span className="text-gray-800">{s.label}</span>
                <span className="ml-auto text-[11px] text-gray-500">{ofPct(s.total ?? null, d.byPathway?.of ?? null)}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      {/* v2 s10 "By location -- counts and proportions by configured practice location", consolidated
          here from the deferral card (owner's command, 2026-08-15). The figures are the location
          module's own: attributed through the located session each consultation ran inside, because
          practice_encounter.location_id exists and NOTHING WRITES IT (see locationIntelligence). */}
      <section className={CARD}>
        <h3 className="text-[13px] font-bold text-gray-900">By location</h3>
        {!loc.available ? <Unavailable module={loc} /> : (() => {
          const e = (loc.data as any).encounters;
          const appts = (loc.data as any).appointments;
          const apptRows = ((appts?.locations ?? []) as any[]);
          const apptTotal = apptRows.reduce((n, r) => n + (r.appointments ?? 0), 0);
          if (e.status !== "ok") return <p className="mt-1 text-[12px] text-gray-600">{e.reason}</p>;
          return (
            <>
              <p className="mt-0.5 text-[10px] text-gray-500">
                Counted through the located session each consultation ran inside. A consultation outside
                any located session has no site and is disclosed below &mdash; never dropped, never
                redistributed across the sites.
              </p>
              {e.rows.length === 0 && e.unattributed === 0 ? (
                <p className="mt-2 text-[12px] text-gray-500">No consultations in this period.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-1">
                  {e.rows.map((r: any) => (
                    <li key={r.locationId} className="flex items-baseline gap-2 text-[12px]">
                      <span className="text-gray-800">{r.name}</span>
                      <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.total, e.of)}</span>
                    </li>
                  ))}
                  {e.unattributed > 0 && (
                    <li className="flex items-baseline gap-2 text-[12px]">
                      <span className="italic text-gray-500">No location recorded</span>
                      <span className="ml-auto text-[11px] text-gray-500">{ofPct(e.unattributed, e.of)}</span>
                    </li>
                  )}
                </ul>
              )}
              <p className="mt-2 text-[11px] text-gray-600">
                Active locations this period (v2 s15: configured, with qualifying activity):{" "}
                <span className="font-bold text-gray-900">{e.rows.length}</span>
                {apptRows.length > 0 && <> of {apptRows.length} configured</>}
              </p>
              {appts?.comparable && apptTotal > 0 && (
                <div className="mt-2 border-t border-gray-100 pt-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    Appointments by location (booked, a different universe from consultations held)
                  </p>
                  <ul className="mt-1 flex flex-col gap-0.5">
                    {apptRows.map((r: any) => (
                      <li key={r.id} className="flex items-baseline gap-2 text-[12px]">
                        <span className="text-gray-800">{r.name}</span>
                        <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.appointments ?? 0, apptTotal)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          );
        })()}
      </section>
      {/* ── s10's CONDITIONALS -- gates in pi-conditional.ts's header; each panel names what it is
             and is not showing. ─────────────────────────────────────────────────────────────────── */}
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Average consultation duration</h3>
          {!dur ? (
            <p className="mt-1 text-[12px] text-gray-500">The duration metric was not computed for this view.</p>
          ) : dur.value === null ? (
            <p className="mt-1 text-[12px] text-gray-600">{dur.reason}</p>
          ) : (
            <>
              <p className="mt-1 text-[18px] font-bold tabular-nums text-gray-900">{dur.value} min</p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
                Over {dur.observations} completed consultation{dur.observations === 1 ? "" : "s"}
                {dur.excluded > 0 ? `; ${dur.excluded} excluded (missing or unusable timestamps or transition log)` : ""}.
                Paused time is subtracted from the transition log &mdash; an open record is not a long consultation.
              </p>
            </>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Capacity booked</h3>
          {!pd ? (
            <p className="mt-1 text-[12px] text-gray-600">{patterns.unavailableReason ?? "could not be read"}</p>
          ) : !pd.utilisation.recorded ? (
            <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{pd.utilisation.reason}</p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-gray-800">
                {ofPct(pd.utilisation.bookedMinutes, pd.utilisation.slotMinutes)} minutes booked against recorded availability
              </p>
              <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
                {pd.utilisation.apptCount} appointment{pd.utilisation.apptCount === 1 ? "" : "s"} against{" "}
                {pd.utilisation.slotCount} recorded slot{pd.utilisation.slotCount === 1 ? "" : "s"}. Two universes,
                named: slots offered versus appointments booked &mdash; consultations held live in the trend above.
                {pd.utilisation.truncated ? " A read hit its cap, so these are floors." : ""}
              </p>
            </>
          )}
        </section>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">By hour of day</h3>
          <p className="mt-0.5 text-[10px] text-gray-500">
            Consultations STARTED, on the practice&apos;s own clock &mdash; activity, not booked demand.
          </p>
          {!pd ? null : pd.hourly.total === 0 ? (
            <p className="mt-2 text-[12px] text-gray-500">No consultations in this period.</p>
          ) : (
            <>
              <ul className="mt-2 flex flex-col gap-1">
                {pd.hourly.hours.map(h => (
                  <li key={h.hour} className="flex items-center gap-2 text-[12px]">
                    <span className="w-12 text-gray-600">{hh(h.hour)}</span>
                    <span className="h-2.5 rounded bg-[var(--cp-primary)]/50"
                      style={{ width: `${Math.round((h.count / Math.max(1, ...pd.hourly.hours.map(x => x.count))) * 70)}%` }} />
                    <span className="ml-auto text-[11px] text-gray-500">{ofPct(h.count, pd.hourly.total)}</span>
                  </li>
                ))}
              </ul>
              {pd.peak.busiestHour !== null && (
                <p className="mt-1.5 text-[11px] text-gray-600">
                  Peak: {pd.peak.busiestWeekday ?? "—"}, around {hh(pd.peak.busiestHour)}. Descriptive only
                  &mdash; never a target.
                </p>
              )}
            </>
          )}
        </section>
        <section className={CARD}>
          <h3 className="text-[13px] font-bold text-gray-900">Workload by time band</h3>
          {!pd ? null : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {pd.bands.map(b => (
                <li key={b.key} className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-800">{b.label}</span>
                  <span className="ml-auto text-[11px] text-gray-500">{ofPct(b.count, pd.hourly.total || null)}</span>
                </li>
              ))}
            </ul>
          )}
          <h3 className="mt-3 text-[13px] font-bold text-gray-900">Referral sources</h3>
          {!pd ? null : pd.referralSources.captured === 0 ? (
            <p className="mt-1 text-[11px] leading-relaxed text-gray-600">
              No booking request in this period captured a referral source
              {pd.referralSources.requests > 0 ? ` (${pd.referralSources.requests} requests arrived without one)` : ""}.
              Capture is an intake setting on booking rules &mdash; and consultations themselves carry no
              referral-source field, so nothing is borrowed to stand in for one.
            </p>
          ) : (
            <>
              <ul className="mt-1 flex flex-col gap-0.5">
                {pd.referralSources.rows.map(r => (
                  <li key={r.value} className="flex items-baseline gap-2 text-[12px]">
                    <span className="min-w-0 truncate text-gray-800">{r.value}</span>
                    <span className="ml-auto text-[11px] text-gray-500">{ofPct(r.count, pd.referralSources.captured)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-gray-500">
                As typed at intake; {pd.referralSources.captured} of {pd.referralSources.requests} requests
                captured one.
              </p>
            </>
          )}
        </section>
      </div>
      <TrustFooter ids={["pi.day_of_week", "pi.consultations_trend", "pi.encounters_by_location", "pi.avg_consult_duration", "pi.time_of_day", "pi.workload_bands", "pi.utilisation", "pi.referral_sources"]} />
    </div>
  );
}
