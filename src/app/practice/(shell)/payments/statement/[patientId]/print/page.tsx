import Link from "next/link";
import PrintButton from "../../../../PrintButton";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { patientStatement } from "@/lib/practice/billing";
import { audit } from "@/lib/practice/audit";
import { formatMinor } from "@/lib/practice/billing-constants";
import { workspaceClock } from "@/lib/practice/practice-time";

// The patient statement print view -- CPR-PAY-002 s10. THE PRINT VIEW IS THE PDF (the invoice
// page's policy). A statement is a PERIOD SUMMARY derived at generation time from the same rows
// everything else reads -- s10's own words: not a replacement for the invoice/receipt history, and
// never an independent source of truth. Regenerating after more records exist shows different
// figures with a fresh timestamp, and the footer says so.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function StatementPrintPage({ params, searchParams }: {
  params: Promise<{ patientId: string }>;
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "billing.view")) redirect("/practice/home");

  const { patientId } = await params;
  const sp = await searchParams;
  const isDay = (x?: string) => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x);
  const admin = createAdminClient();
  // ⚠ THE PERIOD PRINTED ON A STATEMENT, so it is the practice's calendar. With no ?from/?to this
  // defaults to "the first of this month, to today" -- on the server's day, a statement printed in the
  // small hours of the 1st in Kampala covered the whole of the PREVIOUS month and called it this one.
  const { today } = await workspaceClock(admin, shell.ctx.workspaceId);
  const fromDay = isDay(sp.from) ? sp.from! : today.slice(0, 8) + "01";
  const toDay = isDay(sp.to) ? sp.to! : today;
  const result = await patientStatement(admin, shell.ctx, { patientId, fromDay, toDay });
  if (!result.ok) {
    return (
      <div className="mx-auto max-w-[190mm] bg-white p-8">
        <p className="text-[13px] font-semibold text-gray-900">This statement cannot be generated.</p>
        <p className="mt-1 text-[12px] text-gray-600">{result.message}</p>
        <Link href="/practice/payments" className="mt-3 inline-block text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Payments
        </Link>
      </div>
    );
  }
  const s = result.data;

  // Producing a copy is an act worth remembering -- the invoice print page's own rule.
  await audit(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId,
    eventType: "practice.billing_document_printed",
    payload: { kind: "patient_statement", patientId, fromDay, toDay, identified: s.identified },
  });

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2 print:hidden">
        <Link href="/practice/payments"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
          &larr; Payments
        </Link>
        <PrintButton />
        <span className="text-[11px] text-gray-500">Use your browser&apos;s print for paper or PDF.</span>
      </div>

      <header className="border-b-2 border-gray-900 pb-3">
        <h1 className="text-lg font-bold text-gray-900">Patient Statement</h1>
        <div className="mt-1.5 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] text-gray-700">
          <p><span className="font-semibold">Patient:</span>{" "}
            {s.patientName ?? (s.identified ? "(name unavailable)" : "withheld -- viewing names needs patient.view")}</p>
          <p><span className="font-semibold">Period:</span> {s.fromDay} to {s.toDay}</p>
          <p><span className="font-semibold">Generated:</span> {s.generatedAtIso.slice(0, 16).replace("T", " ")} UTC</p>
          <p className="col-span-2 text-gray-500">
            A period summary of billing records only -- it carries no clinical detail, and it is not
            a replacement for the invoices and receipts it references.
          </p>
        </div>
      </header>

      {s.sections.length === 0 ? (
        <p className="mt-4 text-[12px] text-gray-600">
          No billing activity for this patient in or before this period. The read succeeded.
        </p>
      ) : s.sections.map(sec => (
        <section key={sec.currency} className="mt-5 break-inside-avoid">
          <h2 className="text-[13px] font-bold text-gray-900">{sec.currency}</h2>
          <table className="mt-1.5 w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {["Date", "Item", "Reference", "Amount", "Balance"].map((c, i) => (
                  <th key={c} className={`border-b border-gray-300 py-1 pr-3 font-semibold text-gray-700 ${i < 3 ? "text-left" : "text-right"}`}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border-b border-gray-100 py-1 pr-3 text-gray-500">{s.fromDay}</td>
                <td className="border-b border-gray-100 py-1 pr-3 italic text-gray-600" colSpan={2}>
                  Opening balance (activity before this period)
                </td>
                <td className="border-b border-gray-100 py-1 pr-3" />
                <td className="border-b border-gray-100 py-1 pr-3 text-right font-semibold tabular-nums text-gray-900">
                  {formatMinor(sec.openingBalanceMinor, sec.currency)}
                </td>
              </tr>
              {sec.lines.map((l, i) => (
                <tr key={i}>
                  <td className="border-b border-gray-100 py-1 pr-3 text-gray-700">{l.date}</td>
                  <td className="border-b border-gray-100 py-1 pr-3 text-gray-800">
                    {l.description}
                    {l.adjustmentId && (
                      <Link href={`/practice/payments/adjustment/${l.adjustmentId}/print`}
                        className="no-print ml-1 text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline print:hidden">
                        note &rarr;
                      </Link>
                    )}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-3 text-gray-600">{l.ref ?? ""}</td>
                  <td className={`border-b border-gray-100 py-1 pr-3 text-right tabular-nums ${l.amountMinor < 0 ? "text-emerald-700" : "text-gray-900"}`}>
                    {formatMinor(l.amountMinor, sec.currency)}
                  </td>
                  <td className="border-b border-gray-100 py-1 pr-3 text-right tabular-nums text-gray-700">
                    {formatMinor(l.runningBalanceMinor, sec.currency)}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="py-1 pr-3 text-gray-500">{s.toDay}</td>
                <td className="py-1 pr-3 font-semibold text-gray-900" colSpan={2}>Closing balance</td>
                <td className="py-1 pr-3" />
                <td className="py-1 pr-3 text-right font-bold tabular-nums text-gray-900">
                  {formatMinor(sec.closingBalanceMinor, sec.currency)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>
      ))}

      {s.uninvoicedInPeriod > 0 && (
        <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">
          {s.uninvoicedInPeriod} charge{s.uninvoicedInPeriod === 1 ? "" : "s"} recorded in this period
          {s.uninvoicedInPeriod === 1 ? " has" : " have"} not been invoiced and {s.uninvoicedInPeriod === 1 ? "is" : "are"} not
          in these balances &mdash; a charge becomes due at issue, not before.
        </p>
      )}

      <p className="mt-4 text-[9px] text-gray-400">
        Derived at the timestamp above from this practice&apos;s billing records: issued invoices raise
        the balance, payments lower it whoever collected them, discounts and corrections lower it, and
        refunds raise it back. Nothing stores a generated statement -- printing again after more
        records exist shows different figures with a fresh timestamp.
      </p>
    </div>
  );
}
