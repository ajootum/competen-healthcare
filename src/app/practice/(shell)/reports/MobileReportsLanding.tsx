"use client";

import { useState } from "react";
import Link from "next/link";
import CardList from "../_responsive/CardList";
import FullScreenSheet from "../_responsive/FullScreenSheet";
import { useBelowMd } from "../calendar/use-below-md";
import type { RecentReport } from "./recent-reports";

// CPR-MOB-001 s14 rows 1, 2 and 4 -- THE REPORTS LANDING, BELOW md.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// QUICK REPORTS FIRST, then the catalogue as a searchable card list, and a full-screen parameter form
// between either of them and a file. The whole component is mounted inside a md:hidden wrapper on the
// page, so at md and up it renders nothing and the desktop dashboard is untouched -- no CSS order
// utilities anywhere, DOM order below md IS the visual and focus order (s17).
//
// ⚠ IT OWNS NO DATA. Every template here comes from src/lib/practice/report-templates.ts, filtered on
// the SERVER by the caller's capabilities before it is passed down -- so a phone can never be offered
// a report a desktop would refuse (s19 server/API parity), and the catalogue has one definition.
// Generation goes to the SAME /api/v1/practice/reports/generate the desktop catalogue calls, and
// preview to the SAME /practice/reports/view. Nothing here computes a figure.
//
// ⚠ THE s14 ROW-1 NAMES ARE s12's CATEGORY PHRASING, NOT TEMPLATE NAMES. s14 lists "Patient
// Population" and "Clinical Activity"; the catalogue's templates are named "Patient Demographics" and
// "Consultation Types", and the generated file's header block carries THOSE names. A tile labelled
// with one name that produces a file headed with another is the kind of small lie that costs trust,
// so the tile shows the name the file will show. The mapping lives on the server page.
//
// PDF IS NOT A DOWNLOAD AND THE SHEET SAYS SO. format= accepts csv and xlsx and refuses pdf by name;
// the print view IS the PDF. A third download button would be a delivery mechanism that does not
// exist.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type MobileReportTemplate = {
  id: string;
  /** The catalogue's own name -- the one the generated file's definition block will carry. */
  name: string;
  blurb: string;
  category: string;
  categoryLabel: string;
  /** How many governed metric definitions travel with the figures. 0 = formulas stated in-section. */
  metricCount: number;
  /**
   * HFE-001 s8: the Session Report is ABOUT one session, and the engine refuses it by name without
   * one. So it is never handed a parameter form it could not satisfy -- it is handed the door that
   * supplies the session instead.
   */
  needsSession: boolean;
  /** Templates about a single day open their form on one day rather than the page's whole period. */
  singleDay: boolean;
};

const FIELD =
  "mt-1 w-full rounded-lg border border-gray-200 px-3 text-[15px] text-gray-900 outline-none " +
  "min-h-[var(--cp-touch)] focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const LABEL = "block text-[12px] font-semibold text-gray-700";
const SECTION = "rounded-xl border border-gray-200 bg-white p-3.5";

export default function MobileReportsLanding({
  quick, catalogue, categories, recent, fromDay, toDay, todayDate,
}: {
  /** s14 row 1, in the specification's order, already capability-filtered. */
  quick: MobileReportTemplate[];
  /** s14 row 2 -- every template this caller may open. */
  catalogue: MobileReportTemplate[];
  /** Only the categories actually present in `catalogue`, so no chip filters to an empty list. */
  categories: { key: string; label: string }[];
  /** s14 row 3 -- read from the audit trail on the server. See recent-reports.ts. */
  recent: RecentReport[];
  fromDay: string;
  toDay: string;
  todayDate: string;
}) {
  const belowMd = useBelowMd();

  // s14 row 4 -- the parameter form. `open` carries the template it is about; null means closed.
  const [open, setOpen] = useState<MobileReportTemplate | null>(null);
  const [from, setFrom] = useState(fromDay);
  const [to, setTo] = useState(toDay);

  // s14 row 2's "search/filter". Local to this list, not to the page: the page's own period control
  // is the shared filter and it already persists through the URL (s19 filter persistence).
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);

  function openParameters(t: MobileReportTemplate) {
    // Seeded from the period the page is already showing, so the form opens on the window the reader
    // has in mind -- except for a single-day template, which is about one day by definition and would
    // otherwise open on a thirty-day range it does not mean.
    setFrom(t.singleDay ? todayDate : fromDay);
    setTo(t.singleDay ? todayDate : toDay);
    setOpen(t);
  }

  const shown = catalogue.filter(t => {
    if (category && t.category !== category) return false;
    const q = query.trim().toLowerCase();
    return q.length === 0 || t.name.toLowerCase().includes(q) || t.blurb.toLowerCase().includes(q);
  });

  // s16: the error is a sentence, adjacent to the fields AND beside the pinned action, because the
  // footer sits far from the inputs on a phone and a disabled button with no visible reason reads as
  // a broken product.
  const invalid = !from || !to
    ? "Both dates are needed before a report can be generated."
    : from > to
      ? "The end date is before the start date."
      : null;

  const params = open
    ? `template=${open.id}&from=${from}&to=${to}`
    : "";

  return (
    <div className="flex flex-col gap-4">
      {/* ══ s14 ROW 1: QUICK REPORTS, FIRST ══════════════════════════════════════════════════════ */}
      <section className={SECTION} aria-labelledby="m-quick">
        <h2 id="m-quick" className="text-[13px] font-bold text-gray-900">Quick reports</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          Each one opens a form for its dates, then gives you the file. Counts and denominators, with
          the practice, period and metric definitions printed on the report itself.
        </p>
        <ul className="mt-2.5 flex flex-col gap-2">
          {quick.map(t => (
            <li key={t.id}>
              {t.needsSession ? (
                // NOT a disabled tile. The report is real and reachable -- just not from here, because
                // nothing on this screen knows which session it would be about. So the row carries the
                // engine's own reason and a door that actually opens.
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50/60 p-3">
                  <p className="text-[13.5px] font-semibold text-gray-700">{t.name}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-500">
                    About one session, so it is reached from Session Complete when you end one &mdash;
                    that is what supplies the session. It cannot be generated from a date range.
                  </p>
                  <Link href="/practice/today"
                    className="mt-2 flex min-h-[var(--cp-touch)] items-center justify-center rounded-lg border border-gray-200 bg-white text-[13px] font-semibold text-[var(--cp-primary-deep)]">
                    Go to Today &rarr;
                  </Link>
                </div>
              ) : (
                <button type="button" onClick={() => openParameters(t)}
                  className="flex min-h-[var(--cp-touch-primary)] w-full items-center gap-3 rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13.5px] font-semibold leading-snug text-gray-900">{t.name}</span>
                    <span className="block text-[11.5px] leading-snug text-gray-500">{t.blurb}</span>
                  </span>
                  <span aria-hidden className="shrink-0 text-[13px] text-gray-400">&rarr;</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        {quick.length === 0 && (
          <p className="mt-2 text-[12px] text-gray-500">
            None of the quick reports is open to your access. The catalogue below shows what is.
          </p>
        )}
      </section>

      {/* ══ s14 ROW 2: THE CATALOGUE, AS A SEARCHABLE CARD LIST ══════════════════════════════════ */}
      <section className={SECTION} aria-labelledby="m-catalogue">
        <h2 id="m-catalogue" className="text-[13px] font-bold text-gray-900">Template catalogue</h2>

        <label className={`${LABEL} mt-2`} htmlFor="m-report-search">Search reports</label>
        <input id="m-report-search" type="search" value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Conditions, follow-up, location..." className={FIELD} />

        {/* Chips rather than a select: five short labels, and s4 wants filters reachable without a
            precision tap. Aria-pressed carries the state, so it never depends on colour alone. */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" aria-pressed={category === null} onClick={() => setCategory(null)}
            className={`min-h-[var(--cp-touch)] rounded-lg border px-3 text-[12.5px] font-semibold ${
              category === null ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]" : "border-gray-200 text-gray-700"}`}>
            All ({catalogue.length})
          </button>
          {categories.map(c => (
            <button key={c.key} type="button" aria-pressed={category === c.key}
              onClick={() => setCategory(category === c.key ? null : c.key)}
              className={`min-h-[var(--cp-touch)] rounded-lg border px-3 text-[12.5px] font-semibold ${
                category === c.key ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]" : "border-gray-200 text-gray-700"}`}>
              {c.label}
            </button>
          ))}
        </div>

        <div className="mt-3">
          <CardList
            items={shown}
            getKey={t => t.id}
            // The blurb rides in the title node rather than in a field: CardList truncates field values
            // by design (they are short facts), and a blurb that says what a report deliberately is not
            // is exactly the sentence that must not be cut off mid-word.
            title={t => (
              <>
                {t.name}
                <span className="mt-0.5 block text-[11.5px] font-normal leading-snug text-gray-500">{t.blurb}</span>
              </>
            )}
            badge={t => (
              <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                {t.categoryLabel}
              </span>
            )}
            fields={t => [
              {
                label: "Formats",
                // ⚠ NOT "CSV, XLSX, print" FOR EVERY ROW. A template that needs a session produces
                // none of the three from here -- the engine refuses it without an activity id -- and a
                // formats list is a promise about what tapping this card can give you.
                value: t.needsSession ? "Only with a session" : "CSV, XLSX, print",
              },
              {
                label: "Figures",
                value: t.metricCount > 0
                  ? `${t.metricCount} defined ${t.metricCount === 1 ? "metric" : "metrics"}`
                  : "Formulas in-section",
              },
            ]}
            action={t => t.needsSession
              ? { label: "Reached from Session Complete →", href: "/practice/today" }
              : { label: "Choose dates →", onSelect: () => openParameters(t) }}
            empty={
              query.trim() || category
                ? "No template matches that. Clear the search or the filter to see all of them."
                : "No report template is open to your access."
            }
          />
        </div>

        <p className="mt-2.5 text-[10.5px] leading-relaxed text-gray-500">
          Reports use the same metric definitions as the screens. Aggregate but <b>not anonymised</b>
          {" "}&mdash; a count of one identifies somebody to anyone who knows this practice.
        </p>
      </section>

      {/* ══ s14 ROW 3: RECENT REPORTS, AS A VERTICAL LIST ════════════════════════════════════════
          Format, date and download, which is what s14 asks for -- and the format field says "not
          recorded" wherever the trail does not carry one, because the engine audits a generation
          before the route picks csv or xlsx. See recent-reports.ts.

          THE ACTION IS REGENERATE, NEVER "DOWNLOAD YOUR FILE". Nothing stored a file; the row is the
          record that a report was produced, and following it re-runs the same template over the same
          period against today's records. */}
      <section className={SECTION} aria-labelledby="m-recent">
        <h2 id="m-recent" className="text-[13px] font-bold text-gray-900">Recent reports</h2>
        <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
          From this practice&apos;s audit trail. Regenerating re-runs the template against today&apos;s
          records with a fresh timestamp &mdash; it is not the file that was produced then.
        </p>
        {/* ⚠ CardList IS DELIBERATELY NOT USED HERE, though the shape fits. Its single action renders
            next/link, and every download in this product is a plain anchor to an API route: a
            client-side route transition to /api/... is not a download, and Content-Disposition only
            does its job on a real navigation. The catalogue above adopts CardList precisely because
            its action opens a sheet rather than fetching a file. */}
        {recent.length === 0 ? (
          <p className="mt-2 py-4 text-center text-[13px] text-gray-500">
            Nothing generated yet. A report appears here once you produce one.
          </p>
        ) : (
          <ul className="mt-2.5 flex flex-col gap-2.5">
            {recent.map((r, i) => (
              <li key={`${r.when}-${r.templateId ?? i}`} className="rounded-xl border border-gray-200 bg-white p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="min-w-0 flex-1 text-[14px] font-semibold leading-snug text-gray-900">{r.name}</p>
                  <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">
                    {r.format}
                  </span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Generated</dt>
                    <dd className="truncate text-[12.5px] text-gray-700">{r.when}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Contents</dt>
                    <dd className="truncate text-[12.5px] text-gray-700">
                      {r.identified ? "carried names" : "counts only"}
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Period</dt>
                    <dd className="truncate text-[12.5px] text-gray-700">
                      {r.fromDay && r.toDay ? `${r.fromDay} to ${r.toDay}` : "stated on the file"}
                    </dd>
                  </div>
                </dl>
                {r.templateId && r.fromDay && r.toDay && (
                  <a href={`/api/v1/practice/reports/generate?template=${r.templateId}&from=${r.fromDay}&to=${r.toDay}${r.activityId ? `&activity=${r.activityId}` : ""}`}
                    className="mt-2.5 flex min-h-[var(--cp-touch)] w-full items-center justify-center rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-[var(--cp-primary-deep)] hover:bg-gray-50">
                    Regenerate (CSV) &darr;
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ══ s14 ROW 4: THE PARAMETER FORM, FULL SCREEN ═══════════════════════════════════════════
          ⚠ MOUNTED ONLY BELOW md. FullScreenSheet runs a focus trap and a body scroll lock the moment
          it mounts; this component already lives inside a md:hidden wrapper, so on a desktop the sheet
          would be display:none yet still trapping focus and locking the page behind it. matchMedia is
          the only thing that can tell those two apart, which is why use-below-md.ts exists. Gating the
          mount also closes the sheet if the window is widened past md, rather than leaving a phone
          form floating over a desktop dashboard. */}
      {belowMd && (
        <FullScreenSheet
          open={open !== null}
          onClose={() => setOpen(null)}
          title={open?.name ?? "Report"}
          footer={
            <div>
              {invalid && <p className="mb-2 text-[12px] font-semibold text-[var(--cmp-text-critical)]">{invalid}</p>}
              {invalid || !open ? (
                <button type="button" disabled
                  className="flex min-h-[var(--cp-touch-primary)] w-full cursor-not-allowed items-center justify-center rounded-lg bg-[var(--cp-primary)] text-[14px] font-semibold text-white opacity-40">
                  Open preview
                </button>
              ) : (
                <Link href={`/practice/reports/view?${params}`}
                  className="flex min-h-[var(--cp-touch-primary)] w-full items-center justify-center rounded-lg bg-[var(--cp-primary)] text-[14px] font-semibold text-white">
                  Open preview
                </Link>
              )}
            </div>
          }
        >
          {open && (
            <div className="flex flex-col gap-4">
              <p className="text-[12.5px] leading-relaxed text-gray-600">{open.blurb}</p>

              <div>
                <label className={LABEL} htmlFor="m-report-from">From</label>
                <input id="m-report-from" type="date" value={from} max={todayDate}
                  onChange={e => setFrom(e.target.value)} className={FIELD} />
              </div>
              <div>
                <label className={LABEL} htmlFor="m-report-to">To</label>
                <input id="m-report-to" type="date" value={to} max={todayDate}
                  onChange={e => setTo(e.target.value)} className={FIELD} />
              </div>
              {/* s16: adjacent to the fields it is about, as well as beside the pinned action. */}
              {invalid && <p className="text-[12px] font-semibold text-[var(--cmp-text-critical)]">{invalid}</p>}

              <div>
                <p className={LABEL}>Download</p>
                <div className="mt-1 flex gap-2">
                  {invalid ? (
                    <p className="text-[12px] text-gray-500">
                      Available once the dates above are valid.
                    </p>
                  ) : (
                    <>
                      <a href={`/api/v1/practice/reports/generate?${params}`}
                        className="flex min-h-[var(--cp-touch)] flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white text-[13px] font-semibold text-[var(--cp-primary-deep)]">
                        CSV &darr;
                      </a>
                      <a href={`/api/v1/practice/reports/generate?${params}&format=xlsx`}
                        className="flex min-h-[var(--cp-touch)] flex-1 items-center justify-center rounded-lg border border-gray-200 bg-white text-[13px] font-semibold text-[var(--cp-primary-deep)]">
                        XLSX &darr;
                      </a>
                    </>
                  )}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
                  There is no PDF download. Open preview and print from your browser &mdash; that page
                  is the PDF, and it is stamped with the moment you printed it.
                </p>
              </div>

              <p className="text-[11px] leading-relaxed text-gray-500">
                Nothing is stored: the report is computed when you open it, from the records as they
                stand then. Generating one is recorded in this practice&apos;s audit trail.
              </p>
            </div>
          )}
        </FullScreenSheet>
      )}
    </div>
  );
}
