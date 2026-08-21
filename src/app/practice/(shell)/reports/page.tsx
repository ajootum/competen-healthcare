import Link from "next/link";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { reportsDashboard } from "@/lib/practice/document-generation";
import { TEMPLATE_KINDS } from "@/lib/practice/document-constants";
import { practiceToday } from "@/lib/practice/practice-time";
import { periodFromParams, type PeriodTarget } from "@/lib/practice/period-range";
import { REPORT_TEMPLATES, REPORT_CATEGORIES } from "@/lib/practice/report-templates";
import ReportsNavigator from "./ReportsNavigator";
import GenerateConsole from "./GenerateConsole";
import MobileReportsLanding, { type MobileReportTemplate } from "./MobileReportsLanding";
import { recentReports } from "./recent-reports";
import type { Metadata } from "next";

/** The tab name, so a practitioner with several open can tell which is which. */
export const metadata: Metadata = { title: "Reports" };

// /practice/reports -- CPR-330 REPORTS, DOCUMENTS & CORRESPONDENCE.
//
// BUILT TO THE COMP'S LAYOUT, which is the correction CPR-AUDIT-001 recorded: KPI strip, report
// categories, recently generated, quick create, template library, scheduled reports, most used. The
// layout was never in dispute -- what the first attempt got wrong was the SUBJECT (it built analytics,
// which is CPR-270) and the habit of dropping a tile rather than filling its position honestly.
//
// SO TWO TILES RENDER EMPTY, IN PLACE, SAYING WHY. "Time saved by AI" has no AI to save it. That is
// more useful to a reader than a gap where a tile was, because a gap looks like a bug and an empty state
// looks like a decision.

export const dynamic = "force-dynamic";

const KIND_LABEL = Object.fromEntries(TEMPLATE_KINDS.map(([k, l]) => [k, l])) as Record<string, string>;

const CATEGORY_LABEL = Object.fromEntries(REPORT_CATEGORIES.map(c => [c.key, c.label])) as Record<string, string>;

// ── CPR-MOB-001 s14 ROW 1: THE QUICK REPORTS, IN THE SPECIFICATION'S ORDER ────────────────────────
//
// ⚠ TWO OF s14's SIX NAMES ARE CATEGORY PHRASING, NOT TEMPLATE NAMES. s14 writes "Patient Population"
// and "Clinical Activity"; the catalogue (report-templates.ts, which carries s12's names verbatim)
// calls those templates "Patient Demographics" and "Consultation Types", and the definition block
// printed on the generated file carries the catalogue's name. The tile therefore shows the name the
// file will show -- a tile promising "Patient Population" that yields a sheet headed "Patient
// Demographics" is a small lie, and the catalogue is the source of truth for what a report is called.
//
// s14 does NOT list the Financial Summary among the quick six even though s12's quick-access set
// includes it; it stays in the catalogue below, where its billing.view gate is already honoured.
const S14_QUICK_IDS = [
  "practice_summary",       // s14 "Practice Summary"
  "patient_demographics",   // s14 "Patient Population"
  "consultation_types",     // s14 "Clinical Activity"
  "followup_completion",    // s14 "Follow-up & Outcomes"
  "session_report",         // s14 "Session Report"
  "daily_practice_report",  // s14 "Daily Practice Report"
];

const asMobileTemplate = (t: (typeof REPORT_TEMPLATES)[number]): MobileReportTemplate => ({
  id: t.id, name: t.name, blurb: t.blurb, category: t.category,
  categoryLabel: CATEGORY_LABEL[t.category] ?? t.category,
  metricCount: t.registryIds.length,
  // HFE-001 s8: the engine refuses this one by name without an activity id, and Session Complete is
  // the only screen that has one. A date form could not satisfy it, so it is never offered one.
  needsSession: t.id === "session_report",
  // "Your completed activity across ONE day" -- its form opens on today, not on the page's window.
  singleDay: t.id === "daily_practice_report",
});

// The three header doors, one class. The max-md:* half is CPR-MOB-001 s4: three chips of this width
// cannot sit on one 360px row without the horizontal scroll s4 forbids, and a 29px-high chip is under
// the 44px minimum. At md and up the class is character-for-character what each of them carried.
const HEADER_LINK =
  "rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 "
  + "max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  FINAL: "bg-amber-50 text-amber-700",
  SIGNED: "bg-emerald-50 text-emerald-700",
  AMENDED: "bg-blue-50 text-blue-700",
  ENTERED_IN_ERROR: "bg-red-50 text-red-700",
};

export default async function ReportsPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const sp = await searchParams;
  const one = (k: string) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v; };
  const from = one("from"), to = one("to"), days = one("days");
  const admin = createAdminClient();
  const clock = { timezone: shell.ctx.workspaceTimezone, today: practiceToday(shell.ctx.workspaceTimezone) };

  // ── THE PERIOD, AND WHY THE OLD PARAMETERS ARE READ FIRST ─────────────────────────────────────────
  //
  // ⚠ `days=30` HAS ALWAYS MEANT THIRTY DAYS INCLUSIVE HERE -- reports.ts subtracts `days - 1` -- so it
  // maps to a rolling window of TWENTY-NINE BACK, which is the same two dates. Mapping it to 30 back
  // would add a day to every bookmarked report in the practice, quietly, and a count with a different
  // denominator from the one somebody wrote down last week is worse than no count.
  //
  // ⚠ AND THE DEFAULT IS THE SAME DEFAULT: no parameters at all is still the last thirty days ending
  // today, because reports.ts's own default is `days ?? 30`. The harness compares the resolved dates
  // against that function rather than trusting this comment.
  const legacyDays = days ? Math.min(Math.max(Number(days) || 30, 1), 366) : null;
  const legacy: PeriodTarget = from && to
    ? { view: "agenda", anchorDate: from, from, to, anchoring: "calendar", backDays: null }
    : {
      view: "agenda", anchorDate: clock.today, from: null, to: null,
      anchoring: "rolling", backDays: (legacyDays ?? 30) - 1,
    };
  const period = periodFromParams(one, clock.today, legacy);

  // s14 row 3's list is the audit trail, so it is read here beside the dashboard rather than after
  // it -- one round trip, not two (s18: do not make a phone wait serially for secondary content).
  const [board, mobileRecent] = await Promise.all([
    reportsDashboard(admin, shell.ctx, {
      // The read is bounded by the RESOLVED range, so the address bar and the query cannot disagree.
      fromDay: period.fromDate, toDay: period.toDate,
    }),
    recentReports(admin, shell.ctx),
  ]);
  const canAuthor = hasCapability(shell.ctx, "document.author");

  // ── CPR-MOB-001 s14: THE MOBILE FACES, FROM THE SAME CAPABILITY-SCOPED SOURCE ───────────────────
  //
  // Filtered on the SERVER, once: a phone must never be offered a report the desktop would refuse
  // (s19 server/API parity), and the client component that renders them holds no capability logic of
  // its own -- which is the client-mirror drift class this codebase has been bitten by before.
  const permittedTemplates = REPORT_TEMPLATES.filter(
    t => !t.capability || hasCapability(shell.ctx, t.capability),
  );
  const mobileCatalogue = permittedTemplates.map(asMobileTemplate);
  const mobileQuick = S14_QUICK_IDS
    .map(id => permittedTemplates.find(t => t.id === id))
    .filter((t): t is (typeof REPORT_TEMPLATES)[number] => t !== undefined)
    .map(asMobileTemplate);
  // Only the categories that actually have a template this caller may open -- a filter chip that
  // resolves to an empty list is a dead control.
  const mobileCategories = REPORT_CATEGORIES
    .filter(c => mobileCatalogue.some(t => t.category === c.key))
    .map(c => ({ key: c.key as string, label: c.label }));
  // ?template=<id> -- the Templates tab's "Use template" door. Passed through raw: the console decides
  // whether it names a usable template, because the usable list lives there and a second copy of that
  // rule here would be the client-mirror drift class.
  const initialTemplateId = one("template") ?? null;

  return (
    <div className="max-w-6xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports, documents and correspondence</h1>
          <p className="mt-0.5 text-[13px] text-gray-500">
            Letters, certificates and summaries, generated from what is already in the record. {board.period.label}.
          </p>
        </div>
        <div className="flex items-center gap-2 max-md:flex-wrap">
          <Link href="/practice/reports/analytics" className={HEADER_LINK}>
            Practice activity
          </Link>
          <Link href="/practice/documents/templates" className={HEADER_LINK}>
            Templates
          </Link>
          {/* PI v2 s12: Financial appears ONLY because a governed financial module exists (303/304),
              and only to holders of the money permission -- report.view alone does not see money. */}
          {hasCapability(shell.ctx, "billing.export") && (
            <a href={`/api/v1/practice/billing/export${period.bounded ? `?from=${period.fromDate}&to=${period.toDate}` : ""}`}
              className={HEADER_LINK}>
              Financial report (CSV)
            </a>
          )}
        </div>
      </div>

      <div className="mt-3">
        <ReportsNavigator period={period} todayDate={clock.today} timezone={clock.timezone} />
      </div>

      {/* ══ CPR-MOB-001 s14: BELOW md, REPORTS LEADS WITH QUICK REPORTS ═══════════════════════════
          s14 row 1 is emphatic that the landing opens on the quick reports, so this block sits in the
          DOM between the period control and the KPI strip. At md and up it is display:none, so the
          desktop dashboard below is pixel-identical and nothing needed a CSS order utility; below md
          it is simply the first thing after the period, which makes DOM order, visual order and focus
          order the same order (s17).

          NOTHING IS HIDDEN BELOW md TO MAKE ROOM. The KPI strip that follows already collapses to two
          columns, and its two deliberately-empty tiles keep their em dash and their reason at every
          width -- an honesty sentence is not secondary content. The desktop panels after it (report
          categories, most used, recently generated documents, quick create, scheduled reports, the
          not-built AI slot and the export panel) all stay, in that order, which is what puts s14's
          "scheduled reports are secondary" into effect by position rather than by concealment.

          ⚠ THIS BLOCK ADDS NO SECOND SOURCE OF TRUTH. The templates are report-templates.ts, the
          recent rows are the audit trail, generation is the same API and preview the same print view
          the desktop catalogue uses. It is a presentation, and the only thing it computes is which
          chips to show. */}
      <div className="mt-4 md:hidden">
        <MobileReportsLanding
          quick={mobileQuick}
          catalogue={mobileCatalogue}
          categories={mobileCategories}
          recent={mobileRecent}
          fromDay={period.fromDate}
          toDay={period.toDate}
          todayDate={clock.today}
        />
      </div>

      {/* ── KPI strip: six tiles, comp order, two of them deliberately empty ── */}
      <div className="mt-4 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        {board.kpis.map(k => (
          <div key={k.key} className={`rounded-xl border p-3 ${k.available ? "border-gray-200 bg-white" : "border-dashed border-gray-200 bg-gray-50/60"}`}>
            <p className="text-[11px] font-semibold text-gray-500">{k.label}</p>
            {k.available ? (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-900">{k.value}</p>
                {k.sub && <p className="mt-0.5 text-[10px] text-gray-500">{k.sub}</p>}
              </>
            ) : (
              <>
                <p className="mt-1 text-2xl font-bold text-gray-300">&mdash;</p>
                <p className="mt-0.5 text-[10px] text-gray-500">{k.reason}</p>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 grid lg:grid-cols-3 gap-4 items-start">
        {/* ── Left: categories, then the template library ── */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-gray-900">Report categories</h2>
              <Link href="/practice/documents/templates" className="text-[11px] text-blue-700 hover:underline">View all</Link>
            </div>
            {board.categories.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">
                No published templates yet. A category appears here once a template exists for it.
              </p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.categories.map(c => (
                  <li key={c.kind} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <span className="text-[12px] font-semibold text-gray-800">{KIND_LABEL[c.kind] ?? c.kind}</span>
                    <span className="ml-auto text-[11px] text-gray-500">
                      {c.templates} {c.templates === 1 ? "template" : "templates"}
                    </span>
                    {/* Which of them can actually be generated from -- a template with no merge body is
                        a heading and five empty boxes, and saying so here saves finding out later. */}
                    <span className="w-24 text-right text-[10px] text-gray-400">
                      {c.mergeable} with a body
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Most used templates</h2>
            {board.mostUsed.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">Nothing generated from a template in this period.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {board.mostUsed.map(t => (
                  <li key={t.id} className="flex items-center gap-2">
                    <span className="w-32 shrink-0 truncate text-[11px] text-gray-700" title={t.title}>{t.title}</span>
                    {/* A bar drawn to the largest count in the list. It is a count rendered, not a rate --
                        the number stays beside it so nothing is read off a picture. */}
                    <span className="h-1.5 flex-1 rounded bg-gray-100">
                      <span className="block h-1.5 rounded bg-blue-600"
                        style={{ width: `${Math.round((t.total / board.mostUsed[0].total) * 100)}%` }} />
                    </span>
                    <span className="w-6 text-right text-[11px] font-bold text-gray-900">{t.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* ── Middle: recently generated, then schedules and batches ── */}
        <div className="flex flex-col gap-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[13px] font-bold text-gray-900">Recently generated</h2>
              <Link href="/practice/documents" className="text-[11px] text-blue-700 hover:underline">View all</Link>
            </div>
            {board.recent.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">No documents yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.recent.map(d => (
                  <li key={d.id} className="flex items-center gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    <div className="min-w-0">
                      <Link href={`/practice/documents/${d.id}`} className="block truncate text-[12px] font-semibold text-gray-800 hover:underline">
                        {d.title}
                      </Link>
                      <p className="text-[10px] text-gray-500">
                        {/* De-identified when the caller holds report.view without patient.view -- the
                            same rule the access log follows. */}
                        {d.patient ?? (board.identified ? "No patient on the record" : "Patient name hidden")}
                        {" · "}{new Date(d.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${STATUS_TONE[d.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {d.status.replace(/_/g, " ").toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Scheduled reports</h2>
            {/* THE ONE SENTENCE THIS SECTION MUST NOT LOSE. A schedule that looks automatic and is not
                is worse than no schedule, because nobody checks.

                ⚠ CPR-MOB-001 s14 row 6 SAYS "SECONDARY; MANAGEMENT MAY REMAIN UNDER MORE/ADVANCED
                SETTINGS" -- AND THIS SECTION DELIBERATELY STAYS WHERE IT IS. Below md it already sits
                far down the single column, behind the quick reports, the catalogue, the recent list,
                the KPI tiles and the recently-generated documents, which is what "secondary" buys.
                Folding it into a collapsed disclosure would have bought nothing more and cost the one
                thing that matters here: the sentence below is only useful if it is READ, and a
                <details> nobody opens is how a not-built feature starts looking built. s14 says "may",
                not "must". */}
            {/* ⚠ THE SECOND HALF OF THIS SENTENCE PROMISED A CONTROL THAT DOES NOT EXIST. There is no
                Run now button on this list and never has been. The FIRST half is true and was checked
                rather than assumed: a Vercel cron does run scheduled reports daily, but it reads
                `report_schedules` and links into /assessor -- a different product. Practice's own
                `practice_scheduled_report` has no executor at all (markScheduleRun in
                document-generation.ts has zero call sites), so a definition here really does sit
                still. Describing a missing feature accurately is the whole job of this sentence. */}
            <p className="mt-0.5 text-[11px] text-[var(--cmp-text-critical)]">
              Definitions only. Nothing runs these on its own yet, and there is no way to run one on
              demand &mdash; a schedule here is a note to yourself until an executor exists.
            </p>
            {board.schedules.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-400">None defined.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {board.schedules.map(s => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    {/* max-md:* ONLY. A long definition name plus the cadence plus the fixed w-28
                        column is wider than a 360px phone, and s4 forbids the scroll that produces --
                        but at desktop width the name has room, and truncating it there would be a
                        change to the frozen screen rather than a responsive one. */}
                    <span className="text-[12px] text-gray-800 max-md:min-w-0 max-md:truncate">{s.name}</span>
                    <span className="ml-auto text-[10px] text-gray-500 max-md:shrink-0">{s.cadence}</span>
                    <span className="w-28 text-right text-[10px] text-gray-400">
                      {s.last_run_at ? `last run ${new Date(s.last_run_at).toLocaleDateString()}` : "never run"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {board.batches.length > 0 && (
            <section className="rounded-xl border border-gray-200 bg-white p-4">
              <h2 className="text-[13px] font-bold text-gray-900">Recent bulk runs</h2>
              <ul className="mt-2 flex flex-col">
                {board.batches.map(b => (
                  <li key={b.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 last:border-0">
                    {/* Same reason, and the same max-md:* scoping: the pattern is free text of any length. */}
                    <span className="text-[12px] text-gray-800 max-md:min-w-0 max-md:truncate">{b.title_pattern}</span>
                    <span className="ml-auto text-[11px] font-bold text-gray-900 max-md:shrink-0">{b.generated}</span>
                    <span className="text-[10px] text-gray-500 max-md:shrink-0">of {b.requested}</span>
                    {/* A failure count is never rounded away: "40 generated" when 2 failed is the kind
                        of claim somebody relies on without checking. */}
                    {b.failed > 0 && (
                      <span className="w-20 text-right text-[10px] font-semibold text-[var(--cmp-text-critical)]">
                        {b.failed} failed
                      </span>
                    )}
                    {b.failed === 0 && <span className="w-20" />}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* ── Right: quick create, then the AI slot ── */}
        <div className="flex flex-col gap-4">
          <GenerateConsole
            templates={board.templates}
            canAuthor={canAuthor}
            canFindPatients={hasCapability(shell.ctx, "patient.list")}
            initialTemplateId={initialTemplateId}
          />

          {/* THE COMP'S AI REPORT ASSISTANT, rendered as the empty slot it is. Not a button that does
              nothing -- a panel that says what would go here and which specification owns it. */}
          <section className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 p-4">
            <h2 className="text-[13px] font-bold text-gray-500">AI report assistant</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              Drafting, summarising and language help are specified in CPR-210 AI Clinical Assistant,
              which is not built. Nothing on this page is machine-written.
            </p>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[13px] font-bold text-gray-900">Export</h2>
            <p className="mt-1 text-[11px] text-gray-500">
              A generated document opens with a print view, which is how it becomes a PDF. Word export is
              not built. There is no send &mdash; this product has no email or messaging channel, so a
              copy leaves the practice when somebody records that it did.
            </p>
            <a href={`/api/v1/practice/reports/export?from=${board.period.fromDay}&to=${board.period.toDay}`}
              className="mt-2 inline-block rounded-lg border border-gray-200 px-3 py-1.5 text-[12px] font-semibold text-gray-700 hover:bg-gray-50">
              Download activity CSV
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
