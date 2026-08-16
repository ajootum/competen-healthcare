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
      <div className="mx-auto max-w-[190mm] bg-white p-8">
        <p className="text-[13px] font-semibold text-gray-900">This report cannot be generated.</p>
        <p className="mt-1 text-[12px] text-gray-600">{result.message}</p>
        <Link href="/practice/intelligence?tab=reports" className="mt-3 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Back to reports
        </Link>
      </div>
    );
  }

  const r = result.data;
  const d = r.definition;

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2 print:hidden">
        <Link href="/practice/intelligence?tab=reports"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
          &larr; Reports
        </Link>
        <PrintButton />
        <span className="text-[11px] text-gray-500">Use your browser&apos;s print for paper or PDF.</span>
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
                      <td key={k} className={`border-b border-gray-100 py-1 pr-3 text-gray-800 ${k === 0 ? "text-left" : "text-right tabular-nums"}`}>{cell}</td>
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
