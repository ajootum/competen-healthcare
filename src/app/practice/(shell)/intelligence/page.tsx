import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { intelligenceSuite, isCohortDimension } from "@/lib/practice/intelligence";
import { financialIntelligence } from "@/lib/practice/financial-intelligence";
import FinancialArea from "./FinancialArea";
import { piV2Extras } from "@/lib/practice/pi-v2";
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
    cohortBy?: string; sessionId?: string; q?: string;
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
        <div className="ml-auto flex min-w-[280px] flex-1 flex-col items-end gap-2">
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            <RangePicker fromDay={suite.range.period.fromDay} toDay={suite.range.period.toDay}
              days={custom ? null : (days ?? DEFAULT_RANGE_DAYS)} />
            <Link href="/practice/reports"
              className="rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)]">
              Generate report
            </Link>
          </div>
          <div className="w-full max-w-md">
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
        {INTELLIGENCE_TAB_STRIP.map(k => INTELLIGENCE_TABS.find(t => t.key === k)!).map(t => {
          const on = t.key === tab;
          const s = TAB_SWATCH[t.swatch] ?? TAB_SWATCH.primary;
          return (
            <Link key={t.key} href={tabHref(t.key)} aria-current={on ? "page" : undefined}
              className={`shrink-0 rounded-t-lg px-3 py-1.5 text-[12px] font-semibold transition ${on ? s.on : s.off}`}>
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
          <div className="flex flex-col gap-4">
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
        {tab === "performance" && <PerformanceArea suite={suite} />}
        {tab === "reports" && <ReportsArea suite={suite} />}
        {/* Phase 3 (CPR-PAY-001 s17) under CPR-PI-001 v2: computed ONLY when its tab is open --
            two extra billing sweeps have no business running under every other tab's load. */}
        {/* v2 P0: the five rebuilt screen contracts. The extras module runs only for tabs that
            read it -- three additional reads have no business under the other tabs' load. */}
        {tab === "overview" && (
          <OverviewV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
          })} />
        )}
        {tab === "patients" && (
          <PatientV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
          })} />
        )}
        {tab === "followups" && (
          <FollowUpV2Area suite={suite} extras={await piV2Extras(admin, shell.ctx, {
            fromDay: suite.range.period.fromDay, toDay: suite.range.period.toDay, todayDate: suite.range.period.toDay,
          })} />
        )}
        {tab === "clinical" && <ClinicalV2Area suite={suite} />}
        {tab === "patterns" && <PatternsV2Area suite={suite} />}
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
