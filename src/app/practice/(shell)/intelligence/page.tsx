import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { intelligenceSuite, isCohortDimension } from "@/lib/practice/intelligence";
import { financialIntelligence } from "@/lib/practice/financial-intelligence";
import FinancialArea from "./FinancialArea";
import { piV2Extras } from "@/lib/practice/pi-v2";
import { conditionalZones, patternsConditionals } from "@/lib/practice/pi-conditional";
import { computeSegments, cohortPatients, listCohorts } from "@/lib/practice/cohort-engine";
import { portfolioPeriodSummary } from "@/lib/practice/portfolio";
import { isSegmentId } from "@/lib/practice/segment-registry";
import { OverviewV2Area, PatientV2Area, ClinicalV2Area, FollowUpV2Area, PatternsV2Area } from "./AreasV2";
import {
  INTELLIGENCE_TABS, INTELLIGENCE_TAB_STRIP, DEFAULT_TAB, isIntelligenceTab, TAB_SWATCH, DEFAULT_RANGE_DAYS,
  type IntelligenceTabKey,
} from "@/lib/practice/intelligence-constants";
import RangePicker from "./RangePicker";
import AskField from "./AskField";
import PriorityStrip from "./PriorityStrip";
import AssistantArea from "./AssistantArea";
import AskPracticeArea from "./AskPracticeArea";
import ReportsV2Area from "./ReportsV2Area";
import { askPractice } from "@/lib/practice/ask-practice";
import { CARD } from "./Ui";
import {
  BriefArea, ActivityPanel, TrendsPanel, PatientsArea, CohortsArea,
  ClinicalArea, PathwaysArea, PerformanceArea, ReportsArea, AiInsightPanel,
} from "./Areas";

// /practice/intelligence -- CPR-PI-001 / CPR-PI-002 / CPR-PI-003, THE CONSOLIDATED SUITE.
//
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// THE THREE THINGS THIS SCREEN GETS ASKED FOR THAT IT DOES NOT DO, AND WHY.
//
// 1. RATES ARE GOVERNED NOW, NOT REFUSED (CPR-PI-001 v2, 2026-08-15, superseding the rule this
//    comment used to state). A percentage may render ONLY beside its own counts and only under a
//    metric-registry definition naming numerator and denominator -- "72 of 96 (75%)", never a bare
//    75% and never a judgement. The old refusal's spirit survives as the registry (s14), the
//    denominator rule (s19) and the low-denominator withholding (s22); the v2 P0 areas in AreasV2.tsx
//    are built on exactly that contract, and the older areas stay counts-only until re-specified.
//
// 2. NO SIDEBAR SUBMENU. All three comps draw s6's nine areas as an expanded tree under Practice
//    Intelligence. s4 forbids exactly that, in the paragraph that lists them: "Practice Intelligence may
//    use internal tabs, but these must not create expandable global sidebar submenus." They are tabs.
//
// 3. NO IMPROVING / DETERIORATING / HIGH-COMPLEXITY PATIENTS. s5 asks for them beside overdue and
//    inactive, and only the date-derived ones are real. See the Patients area: the three judgements are
//    refused IN THE POSITION THEY WOULD OCCUPY, each naming what would make it computable.
// ════════════════════════════════════════════════════════════════════════════════════════════════════
//
// ⚠ TRENDS ARE COMPUTED, NOT REFUSED. CPR-PI-002 s5 does ask for "time trends, comparisons", and they
// are here -- as SIGNED COUNTS ("87, and 78 in the period before"), and only when the previous window
// existed for the whole of its length and both windows carry enough records. Otherwise null with the
// reason, never 0%.
//
// SERVER-RENDERED, ONCE, LOGGED ONCE. This is a read of the whole practice; the engine logs it, and the
// three client components on the page (the range picker, the Ask field, the assistant console) hold no
// figure between them.

export const dynamic = "force-dynamic";

export default async function IntelligencePage({ searchParams }: {
  searchParams: Promise<{
    tab?: string; days?: string; from?: string; to?: string;
    cohortBy?: string; sessionId?: string; q?: string; segment?: string; cohort?: string;
  }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  // The same gate the API declares. Enforced here rather than relying on the sidebar having hidden it.
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const sp = await searchParams;
  const tab: IntelligenceTabKey = isIntelligenceTab(sp.tab) ? sp.tab : DEFAULT_TAB;

  const isDay = (x?: string) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const custom = isDay(sp.from) && isDay(sp.to);
  const rawDays = Number(sp.days);
  const days = Number.isFinite(rawDays) && rawDays > 0
    ? Math.min(Math.max(Math.round(rawDays), 1), 366) : null;

  const admin = createAdminClient();
  const suite = await intelligenceSuite(admin, shell.ctx, {
    fromDay: custom ? sp.from : undefined,
    toDay: custom ? sp.to : undefined,
    days: custom ? undefined : (days ?? DEFAULT_RANGE_DAYS),
    cohortBy: isCohortDimension(sp.cohortBy) ? sp.cohortBy : undefined,
  });

  // The query string minus the tab, so every tab link keeps the range and the cohort dimension. Losing
  // the window on a tab change is the bug that makes a tabbed workspace feel broken, and it is invisible
  // in review because the default tab looks correct.
  const carried = new URLSearchParams();
  if (custom) { carried.set("from", sp.from!); carried.set("to", sp.to!); }
  else if (days) carried.set("days", String(days));
  if (isCohortDimension(sp.cohortBy)) carried.set("cohortBy", sp.cohortBy);

  const tabHref = (key: IntelligenceTabKey) => {
    const p = new URLSearchParams(carried);
    p.set("tab", key);
    return `/practice/intelligence?${p.toString()}`;
  };

  const active = INTELLIGENCE_TABS.find(t => t.key === tab)!;

  // ══ CPR-MOB-001 s13 PRIORITY 6: ASK PRACTICE, PROMINENT ═════════════════════════════════════════
  //
  // s13 singles this out -- "Ask Practice should be especially prominent on mobile because it reduces
  // navigation burden" -- so below md it stops being a 28px input tucked beside the page title and
  // becomes a full-width tinted module at its contract position in the vertical story.
  //
  // ⚠ NOT A SECOND ASK FIELD. It renders the SAME AskField client component against the same
  // tabHref, so there is one submit path, one consent gate and one disclosure log (AskField's own
  // doctrine). The header copy is hidden below md; exactly one is ever in a viewport.
  //
  // ⚠ NOT ONE NEW WORD. The heading and the sentence are the assistant TAB'S OWN label and blurb,
  // read from the registry rather than retyped here -- CPR-PI-001 v2 froze this workspace's content,
  // and a mobile face that invented its own description of Ask Practice would be a second source of
  // truth for what Ask Practice is.
  const assistantTab = INTELLIGENCE_TABS.find(t => t.key === "assistant")!;
  const mobileAsk = (
    <section className="rounded-xl border border-sky-200 bg-sky-50/60 p-4 md:hidden"
      aria-labelledby="m-ask">
      <h2 id="m-ask" className="text-[14px] font-bold text-gray-900">
        <span aria-hidden className="mr-1 text-sky-600">&#10022;</span>{assistantTab.label}
      </h2>
      <p className="mt-0.5 text-[12px] leading-snug text-gray-600">{assistantTab.blurb}</p>
      <div className="mt-2.5">
        <AskField tabHref={tabHref("assistant")} />
      </div>
    </section>
  );

  return (
    <div className="max-w-7xl">
      {/* ── s7.1 HEADER ─────────────────────────────────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-gray-900">Practice intelligence</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            What needs you now, and what your own records add up to.
          </p>
        </div>
        {/* Below md the right-hand control column stops being a right-aligned rail and becomes the
            full-width top of the page, because s13's PRIORITY 1 is the period selector: the first
            thing a phone reader must be able to see and change. Every class here is max-md:* — the
            desktop rail is byte-identical at md and up. */}
        <div className="ml-auto flex min-w-[280px] flex-1 flex-col items-end gap-2 max-md:w-full max-md:min-w-0 max-md:items-stretch">
          <div className="flex w-full flex-wrap items-center justify-end gap-2 max-md:justify-start">
            <RangePicker fromDay={suite.range.period.fromDay} toDay={suite.range.period.toDay}
              days={custom ? null : (days ?? DEFAULT_RANGE_DAYS)} />
            <Link href="/practice/reports"
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] max-md:flex max-md:min-h-[var(--cp-touch)] max-md:flex-1 max-md:items-center max-md:justify-center">
              Generate report
            </Link>
          </div>
          {/* s13 puts Ask Practice at PRIORITY 6, not beside the title — so below md this copy is
              hidden and the SAME component is rendered once, larger, in its contract position
              further down. One Ask field per viewport, never two. */}
          <div className="w-full max-w-md max-md:hidden">
            <AskField tabHref={tabHref("assistant")} />
          </div>
        </div>
      </header>

      <p className="mt-2 text-[11px] text-gray-400">
        {suite.range.period.label} &middot; {suite.timezone} &middot; computed{" "}
        {new Date(suite.asOfIso).toISOString().slice(0, 16).replace("T", " ")} UTC.
        Every figure below names its own date range and how it was counted.
      </p>

      {/* ── s6 INTERNAL NAVIGATION -- TABS, NOT SIDEBAR ENTRIES ─────────────────────────────────── */}
      <nav aria-label="Practice intelligence areas"
        className="mt-4 flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {/* CPR-PI-001 v2 s3: the STRIP is v2's order (mapped from the strip, not filtered from the
            catalogue, so declaration order cannot quietly reorder the screen); off-strip keys stay
            valid for old links. */}
        {/* CPR-MOB-001 s5 leaves this strip as a strip. Its large-tab-set row offers a section
            SELECTOR, and the _responsive SectionTabs primitive implements exactly that above five
            tabs -- but it drives an onSelect callback, and these are eight bookmarkable <Link>s that
            carry the period in the query string. Converting them would trade the whole screen's URL
            semantics (and the "hand this window to a colleague" property RangePicker is built around)
            for a dropdown. s5's own first fallback, "scrollable tabs", is what this already is, and
            it scrolls inside its own box rather than scrolling the page -- which is the distinction
            s4's no-horizontal-scroll rule turns on. Only the touch height is raised below md. */}
        {INTELLIGENCE_TAB_STRIP.map(k => INTELLIGENCE_TABS.find(t => t.key === k)!).map(t => {
          const on = t.key === tab;
          const s = TAB_SWATCH[t.swatch] ?? TAB_SWATCH.primary;
          return (
            <Link key={t.key} href={tabHref(t.key)} aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-t-lg px-3 py-1.5 text-[12px] font-semibold transition max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center ${on ? s.on : s.off}`}>
              {t.label}
            </Link>
          );
        })}
      </nav>
      <p className="mt-1.5 text-[11px] text-gray-500">{active.blurb}</p>

      {/* ── s7.2 PRIORITY STRIP -- on every area, because "what needs me first" does not stop being
             true when you open a different tab ────────────────────────────────────────────────── */}
      <div className="mt-3">
        <PriorityStrip strip={suite.priority} />
      </div>

      <div className="mt-4">
        {tab === "overview" && (
          // ⚠ HIDDEN BELOW md, AND THIS IS THE ONE JUDGEMENT CALL ON THIS SCREEN.
          //
          // CPR-MOB-001 s13 names SEVEN things mobile Intelligence shows, in order, and none of the
          // seven is this seven-panel grid; s5's transformation row for a multi-panel dashboard is
          // "priority-ordered single column"; s13 says outright "Do not stack every desktop chart on
          // mobile". Stacked below md this grid puts seven full panels between the tab strip and the
          // KPI cards that are s13's PRIORITY 2 — the shrunken dashboard the contract exists to stop.
          //
          // NOTHING BECOMES UNREACHABLE. Every panel here has a canonical tab that the strip above
          // already reaches on a phone: brief, patients, pathways and reports each own one, and the
          // View more disclosure at the foot of the mobile story links to them by name. That is s13's
          // priority 7 ("View more for deeper charts and secondary metrics") rather than a deletion.
          //
          // ⚠ HONEST LIMIT: CSS hiding still SHIPS this markup to the phone, so s18's "lazy-load
          // secondary analytics" is only half-kept. Fixing it properly needs a server-side viewport
          // decision this render has no access to; recorded, not papered over.
          <div className="flex flex-col gap-4 max-md:hidden">
            {/* s7.3's seven panels, in s7.3's order. */}
            <div className="grid gap-4 lg:grid-cols-3 items-start">
              <div className="lg:col-span-2 flex flex-col gap-4">
                <BriefArea suite={suite} />
                <ActivityPanel suite={suite} />
                <PatientsArea suite={suite} compact />
              </div>
              <div className="flex flex-col gap-4">
                <TrendsPanel suite={suite} />
                <PathwaysArea suite={suite} />
                <AiInsightPanel suite={suite} />
                <ReportsArea suite={suite} />
              </div>
            </div>
          </div>
        )}

        {tab === "brief" && <BriefArea suite={suite} />}
        {tab === "patients" && <PatientsArea suite={suite} />}
        {tab === "cohorts" && <CohortsArea suite={suite} query={carried.toString()} />}
        {tab === "clinical" && <ClinicalArea suite={suite} />}
        {tab === "pathways" && <PathwaysArea suite={suite} />}
        {tab === "performance" && (
          <PerformanceArea suite={suite}
            portfolio={await portfolioPeriodSummary(admin, shell.ctx, {
              fromIso: suite.range.period.fromIso, toIso: suite.range.period.toIso,
            })}
            exportHrefs={{
              csv: `/api/v1/practice/reports/generate?template=professional_portfolio&from=${suite.range.period.fromDay}&to=${suite.range.period.toDay}`,
              xlsx: `/api/v1/practice/reports/generate?template=professional_portfolio&from=${suite.range.period.fromDay}&to=${suite.range.period.toDay}&format=xlsx`,
              print: `/practice/reports/view?template=professional_portfolio&from=${suite.range.period.fromDay}&to=${suite.range.period.toDay}`,
            }} />
        )}
        {/* v2 s12: the rebuilt Reports tab -- catalogue, quick access, audit-derived recent list.
            The old ReportsArea still serves the overview side panel. */}
        {tab === "reports" && (
          <ReportsV2Area admin={admin} ctx={shell.ctx} suite={suite}
            fromDay={suite.range.period.fromDay} toDay={suite.range.period.toDay} />
        )}
        {/* Phase 3 (CPR-PAY-001 s17) under CPR-PI-001 v2: computed ONLY when its tab is open --
            two extra billing sweeps have no business running under every other tab's load. */}
        {/* v2 P0: the five rebuilt screen contracts. The extras module runs only for tabs that
            read it -- three additional reads have no business under the other tabs' load. */}
        {tab === "overview" && (
          <OverviewV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
          })}
            // CPR-MOB-001 s13: the area places these two at priorities 6 and 7. tabHref is passed so
            // the View more doors carry the period -- a door that reset the window would be the
            // exact bug the `carried` params exist to prevent.
            mobileAsk={mobileAsk} tabHref={tabHref} />
        )}
        {tab === "patients" && await (async () => {
          // v2 s6 cohort controls: registered segments + saved combinations, filters not destinations.
          const activeSegment = isSegmentId(sp.segment) ? sp.segment : null;
          const saved = await listCohorts(admin, shell.ctx);
          const savedCohorts = saved.ok ? saved.cohorts : [];
          const activeCohort = sp.cohort ? savedCohorts.find(c => c.id === sp.cohort) ?? null : null;
          const filterSegs = activeCohort ? activeCohort.segmentIds : activeSegment ? [activeSegment] : [];
          const hrefWith = (k: "segment" | "cohort", v: string | null) => {
            const p2 = new URLSearchParams(carried);
            p2.set("tab", "patients");
            if (v) p2.set(k, v);
            return `/practice/intelligence?${p2.toString()}`;
          };
          return (
            <PatientV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
              fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
            })}
              segments={await computeSegments(admin, shell.ctx, { noVisitDays: activeCohort?.noVisitDays ?? undefined })}
              cohort={filterSegs.length > 0
                ? await cohortPatients(admin, shell.ctx, { segmentIds: filterSegs, noVisitDays: activeCohort?.noVisitDays ?? undefined })
                : null}
              activeSegment={activeSegment}
              segmentHref={(id) => hrefWith("segment", id)}
              savedCohorts={savedCohorts}
              activeCohortId={activeCohort?.id ?? null}
              cohortHref={(id) => hrefWith("cohort", id)}
              canManageCohorts={hasCapability(shell.ctx, "cohort.manage")}
            />
          );
        })()}
        {tab === "followups" && (
          <FollowUpV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
          })} zones={await conditionalZones(admin, shell.ctx, {
            fromIso: suite.range.period.fromIso, toIso: suite.range.period.toIso,
          })} />
        )}
        {tab === "clinical" && (
          <ClinicalV2Area suite={suite} zones={await conditionalZones(admin, shell.ctx, {
            fromIso: suite.range.period.fromIso, toIso: suite.range.period.toIso,
          })} />
        )}
        {tab === "patterns" && (
          <PatternsV2Area suite={suite} patterns={await patternsConditionals(admin, shell.ctx, {
            fromIso: suite.range.period.fromIso, toIso: suite.range.period.toIso, timezone: suite.timezone,
          })} />
        )}
        {tab === "financial" && (
          <FinancialArea financial={await financialIntelligence(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay,
          })} />
        )}
        {/* v2 s13: the Ask field lands here. The GROUNDED stage answers first -- deterministic,
            registry-tied, DERIVED-chipped (ask-practice.ts) -- and the model console keeps its own
            consent gate below it, prefilled but never auto-sent. One entry point, two provenances. */}
        {tab === "assistant" && (
          <div className="flex flex-col gap-4">
            {sp.q && sp.q.trim().length >= 3 && (
              <AskPracticeArea
                carried={[...carried.entries()]}
                answer={await askPractice(admin, shell.ctx, {
                  question: sp.q, fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay,
                  todayDate: suite.range.period.toDay, actorId: shell.ctx.userId,
                  correlationId: crypto.randomUUID(),
                })}
              />
            )}
            <AssistantArea admin={admin} ctx={shell.ctx} sessionId={sp.sessionId} question={sp.q} />
          </div>
        )}
      </div>

      {/* ⚠ THE OTHER TABS KEEP THEIR ASK TOO. Hiding the header field below md would otherwise strip
          Ask Practice off every area except Overview, which is the opposite of s13's reason for
          promoting it ("it reduces navigation burden"). Overview gets it INSIDE the area at priority
          6; Assistant is excluded because it already IS Ask Practice, and two ask fields in one
          viewport is the duplicate-entry-point defect AskField's own doctrine argues against.
          The wrapper is md:hidden as well, so desktop gains no stray margin. */}
      {tab !== "overview" && tab !== "assistant" && (
        <div className="mt-4 md:hidden">{mobileAsk}</div>
      )}

      {/* ⚠ THE PAYLOAD SAYS SO TOO. `ratesComputed: false` travels in the API response, so a second
          surface cannot render any of this as a percentage and call it the same data. */}
      {!suite.identified && (
        <p className={`${CARD} mt-4 text-[11px] text-gray-600`}>
          You hold reporting access but not clinical access, so this workspace shows counts and no
          patient names &mdash; the same rule the access log follows. That is a permissions answer rather
          than a degraded one: the counts are complete.
        </p>
      )}
    </div>
  );
}
