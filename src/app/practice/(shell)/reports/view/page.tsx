import Link from "next/link";
import PrintButton from "../../PrintButton";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { generateReport } from "@/lib/practice/report-engine";

// The report print view -- CPR-PI-001 v2 s12 "Formats": PDF where appropriate.
//
// THE PRINT VIEW IS THE PDF EXPORT -- the same policy the invoice and clinical-document print routes
// state: browser print-to-PDF, no rendering library, no second definition of what a report looks
// like. The engine that computed the screen computes this page, and generating it leaves the same
// practice.report_generated audit row a CSV download does -- a printed report is a generation like
// any other, and the Recent reports list shows it.
//
// A REGENERATION SAYS SO. Nothing stores a generated file (owner's decision, 2026-08-15): this page
// always renders TODAY's records over the requested period with a fresh timestamp, and the footer
// states that a reprint after more records exist will differ.

export const dynamic = "force-dynamic";

export default async function ReportPrintPage({ searchParams }: {
  searchParams: Promise<{ template?: string; from?: string; to?: string; days?: string; activity?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "report.view")) redirect("/practice/home");

  const sp = await searchParams;
  const admin = createAdminClient();
  const days = Number(sp.days);
  const result = await generateReport(admin, shell.ctx, {
    templateId: sp.template ?? "",
    fromDay: sp.from, toDay: sp.to,
    days: Number.isFinite(days) && days > 0 ? Math.min(366, Math.round(days)) : undefined,
    activityId: sp.activity,
    actorId: shell.ctx.userId, correlationId: crypto.randomUUID(),
  });

  if (!result.ok) {
    return (
      <div className="mx-auto max-w-[190mm] bg-white p-4 md:p-8">
        {/* THE REFUSAL KEEPS ITS SENTENCE AT EVERY WIDTH. result.message is the engine's own reason --
            "a Session Report is about one session", "needs billing.view" -- and s14 does not get to
            shorten it for a phone. Only the padding and the tap target move. */}
        <p className="text-[13px] font-semibold text-gray-900">This report cannot be generated.</p>
        <p className="mt-1 text-[12px] text-gray-600">{result.message}</p>
        <Link href="/practice/intelligence?tab=reports" className="mt-3 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center">
          &larr; Back to reports
        </Link>
      </div>
    );
  }

  const r = result.data;
  const d = r.definition;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-4 md:p-8 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2 max-md:flex-wrap print:hidden">
        <Link href="/practice/intelligence?tab=reports"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50 max-md:flex max-md:min-h-[var(--cp-touch)] max-md:items-center max-md:px-3">
          &larr; Reports
        </Link>
        <PrintButton />
        <span className="text-[11px] text-gray-500">Use your browser&apos;s print for paper or PDF.</span>
      </div>

      {/* ══ CPR-MOB-001 s14 row 5: THE FORMATS, BELOW md ═══════════════════════════════════════════
          "Mobile-friendly preview; user may download PDF/XLSX/CSV where permitted." Two of those three
          are downloads and the third is not: the API refuses format=pdf by name because THE PRINT VIEW
          IS THE PDF -- this page, through the browser -- and there is no PDF generator behind it. So
          the row offers the two real files and says where the third comes from, rather than a PDF
          button that would 400.

          md:hidden, and only that: at md and up the template catalogue already sits CSV/XLSX/Print
          side by side, so the desktop preview is unchanged. A phone arrives here from Session Complete
          or from a quick report and has no catalogue on screen to go back to.

          The hrefs are built from the DEFINITION the engine returned, not from the raw query string --
          the period it actually resolved is the period the file must carry. */}
      <div className="no-print mb-4 md:hidden print:hidden">
        <div className="flex gap-2">
          <a href={`/api/v1/practice/reports/generate?template=${d.templateId}&from=${d.fromDay}&to=${d.toDay}${sp.activity ? `&activity=${sp.activity}` : ""}`}
            className="flex min-h-[var(--cp-touch)] flex-1 items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-[var(--cp-primary-deep)]">
            CSV &darr;
          </a>
          <a href={`/api/v1/practice/reports/generate?template=${d.templateId}&from=${d.fromDay}&to=${d.toDay}${sp.activity ? `&activity=${sp.activity}` : ""}&format=xlsx`}
            className="flex min-h-[var(--cp-touch)] flex-1 items-center justify-center rounded-lg border border-gray-200 text-[13px] font-semibold text-[var(--cp-primary-deep)]">
            XLSX &darr;
          </a>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
          Both files carry the same figures as this page. There is no PDF download &mdash; this page
          printed from your browser is the PDF, which is why a reprint is stamped afresh.
        </p>
      </div>

      {/* ── s12 REPORT DEFINITION -- the header travels with the page ─────────────────────────── */}
      <header className="border-b-2 border-gray-900 pb-3">
        <h1 className="text-lg font-bold text-gray-900">{d.templateName}</h1>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] text-gray-700">
          <p><span className="font-semibold">Practice:</span> {d.practiceName}</p>
          <p><span className="font-semibold">Period:</span> {d.fromDay} to {d.toDay}</p>
          <p><span className="font-semibold">Generated:</span> {d.generatedAtIso.slice(0, 16).replace("T", " ")} UTC</p>
          <p><span className="font-semibold">Filters:</span> {d.filters}</p>
          <p className="col-span-2">
            <span className="font-semibold">Contents:</span>{" "}
            {d.identified ? "may carry identifying detail -- treat as confidential" : "counts without names"}.
            Aggregate but not anonymised: a count of one identifies somebody to anyone who knows this practice.
          </p>
        </div>
      </header>

      {r.sections.map((s, i) => (
        <section key={i} className="mt-5 break-inside-avoid">
          <h2 className="text-[13px] font-bold text-gray-900">{s.title}</h2>
          {s.unavailable ? (
            <p className="mt-1 text-[11px] text-gray-600">Unavailable: {s.unavailable}</p>
          ) : s.rows.length === 0 ? (
            <p className="mt-1 text-[11px] text-gray-500">Nothing recorded in the period.</p>
          ) : (
            <table className="mt-1.5 w-full border-collapse text-[11px]">
              {s.columns.length > 0 && (
                <thead>
                  <tr>
                    {s.columns.map((c, j) => (
                      <th key={j} className={`border-b border-gray-300 py-1 pr-3 font-semibold text-gray-700 ${j === 0 ? "text-left" : "text-right"}`}>{c}</th>
                    ))}
                  </tr>
                </thead>
              )}
              <tbody>
                {s.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((cell, k) => (
                      // max-md:* only -- s4 forbids horizontal scrolling in a core workflow, and a
                      // report label long enough to be one unbroken token would push this table wider
                      // than a 360px phone. Top-aligned once a first column wraps to two lines so the
                      // figure still reads against the row it belongs to. Desktop is untouched.
                      <td key={k} className={`border-b border-gray-100 py-1 pr-3 text-gray-800 max-md:break-words max-md:align-top ${k === 0 ? "text-left" : "text-right tabular-nums"}`}>{cell}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {s.note && <p className="mt-1 text-[10px] leading-relaxed text-gray-500">{s.note}</p>}
        </section>
      ))}

      {d.metrics.length > 0 && (
        <section className="mt-6 border-t border-gray-200 pt-2">
          <h2 className="text-[11px] font-bold text-gray-700">Metric definitions</h2>
          <ul className="mt-1 flex flex-col gap-0.5">
            {d.metrics.map(m => (
              <li key={m.id} className="text-[9px] leading-relaxed text-gray-500">
                <span className="font-semibold">{m.displayName}</span> ({m.id} v{m.version}): {m.definition}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="mt-4 text-[9px] text-gray-400">
        Generated from this practice&apos;s records as they stood at the timestamp above. Nothing stores
        a generated report: printing this page again after more records exist will show different
        figures with a fresh timestamp. Absence of a record in CompetenPractice is never a claim that
        care did not happen.
      </p>
    </div>
  );
}
