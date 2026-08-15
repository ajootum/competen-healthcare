import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { getInvoice } from "@/lib/practice/billing";
import { audit } from "@/lib/practice/audit";
import { formatMinor } from "@/lib/practice/billing-constants";

// The invoice print view -- CPR-PAY-002 s16. THE PRINT VIEW IS THE PDF EXPORT, the same policy the
// clinical documents print route states: browser print-to-PDF, no rendering library, no second
// definition of what the document looks like.
//
// ⚠ AN ISSUED INVOICE RENDERS FROM ITS SNAPSHOT, NEVER FROM LIVE ROWS. s16 verbatim: "Document PDF
// must be generated from the stored issued-document snapshot, not a mutable live screen." What was
// issued is what prints, forever, even after fees change or the patient is renamed. A DRAFT has no
// snapshot and prints with a watermark saying exactly what it is.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function InvoicePrintPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "billing.view")) redirect("/practice/home");

  const { invoiceId } = await params;
  const admin = createAdminClient();
  const invoice = await getInvoice(admin, shell.ctx, invoiceId);
  if (!invoice) notFound();
  if (invoice.status === "VOID") {
    // A void invoice is not reprinted as though it were owed. Its history lives in Transactions.
    redirect("/practice/payments?tab=transactions");
  }

  // s22: producing a copy is an act worth remembering -- a printed invoice is outside the practice.
  await audit(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId,
    eventType: "practice.billing_document_printed",
    payload: { kind: "invoice", invoiceId, invoiceNumber: invoice.invoice_number ?? null },
  });

  const snap = (invoice.issued_snapshot ?? null) as any;
  const isDraft = invoice.status === "DRAFT";
  // The snapshot is the document. The live row supplies only what a draft has not frozen yet.
  const items: any[] = snap?.items ?? invoice.items.map((i: any) => ({
    description: i.description_snapshot, quantity: i.quantity,
    unitAmountMinor: i.unit_amount_minor, lineAmountMinor: i.line_amount_minor,
  }));
  const currency = snap?.currency ?? invoice.currency;
  const head: string[] = snap?.issuer?.lines ?? (snap?.issuer ? [snap.issuer.name, snap.issuer.registration, snap.issuer.address, snap.issuer.contact].filter(Boolean) : []);

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2 print:hidden">
        <a href="/practice/payments?tab=transactions" className="text-[12px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
          &larr; Payments
        </a>
        <span className="text-[11px] text-gray-500">Use your browser&apos;s print for paper or PDF.</span>
      </div>

      {isDraft && (
        <p className="pointer-events-none fixed inset-x-0 top-1/3 rotate-[-30deg] text-center text-[80px] font-black text-gray-200">
          DRAFT
        </p>
      )}

      <header className="flex items-start justify-between gap-6 border-b-2 border-gray-900 pb-4">
        <div>
          {head.length > 0
            ? head.map((l, i) => <p key={i} className={i === 0 ? "text-[16px] font-bold text-gray-900" : "text-[11px] text-gray-600"}>{l}</p>)
            : <p className="text-[16px] font-bold text-gray-900">{shell.ctx.workspaceName}</p>}
        </div>
        <div className="text-right">
          <p className="text-[22px] font-black tracking-wide text-gray-900">INVOICE</p>
          <p className="mt-1 rounded border border-gray-300 px-2 py-0.5 font-mono text-[12px] text-gray-800">
            {invoice.invoice_number ?? "not yet issued"}
          </p>
          <p className="mt-1 text-[11px] text-gray-600">Issued {snap?.issuedOn ?? "—"}</p>
          {(snap?.dueDate ?? invoice.due_date) && <p className="text-[11px] text-gray-600">Due {snap?.dueDate ?? invoice.due_date}</p>}
          <p className="text-[11px] text-gray-600">Currency {currency}</p>
        </div>
      </header>

      <section className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-wide text-gray-500">Billed to</p>
        <p className="text-[13px] font-semibold text-gray-900">
          {snap?.payer?.patientName ?? snap?.payer?.label ?? invoice.payer_label ?? invoice.payer_kind}
        </p>
      </section>

      <table className="mt-4 w-full text-left text-[12px]">
        <thead>
          <tr className="border-b border-gray-300 text-[10px] font-bold uppercase tracking-wide text-gray-500">
            <th className="py-1.5">Description</th>
            <th className="w-14 text-right">Qty</th>
            <th className="w-32 text-right">Unit</th>
            <th className="w-32 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i, idx) => (
            <tr key={idx} className="border-b border-gray-100 align-top">
              <td className="py-1.5 text-gray-800">{i.description}</td>
              <td className="text-right text-gray-700">{i.quantity}</td>
              <td className="text-right text-gray-700">{formatMinor(i.unitAmountMinor, currency)}</td>
              <td className="text-right font-semibold text-gray-900">{formatMinor(i.lineAmountMinor, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="mt-3 ml-auto w-64 text-[12px]">
        <p className="flex justify-between text-gray-700">
          <span>Subtotal</span><span>{formatMinor(snap?.subtotalMinor ?? invoice.subtotal_minor, currency)}</span>
        </p>
        {(snap?.adjustmentTotalMinor ?? invoice.adjustment_total_minor) > 0 && (
          <p className="flex justify-between text-gray-700">
            <span>Adjustments</span><span>-{formatMinor(snap?.adjustmentTotalMinor ?? invoice.adjustment_total_minor, currency)}</span>
          </p>
        )}
        <p className="mt-1 flex justify-between border-t-2 border-gray-900 pt-1 text-[14px] font-bold text-gray-900">
          <span>Total</span><span>{formatMinor(snap?.totalMinor ?? invoice.total_minor, currency)}</span>
        </p>
        {!isDraft && (
          <>
            <p className="flex justify-between text-gray-700">
              <span>Paid</span><span>{formatMinor(invoice.allocatedMinor, currency)}</span>
            </p>
            <p className="flex justify-between font-semibold text-gray-900">
              <span>Balance</span><span>{formatMinor(invoice.balanceMinor, currency)}</span>
            </p>
          </>
        )}
      </section>

      <footer className="mt-8 border-t border-gray-200 pt-2 text-[10px] text-gray-500">
        {/* The paid/balance figures above are TODAY's derived arithmetic printed beside the frozen
            document -- said so, because a reprint after another payment will show a smaller balance
            on the same invoice number, and that is correct rather than a discrepancy. */}
        <p>
          The invoice body is the issued record and never changes. Paid and balance are as at the
          moment of printing.
        </p>
        <p className="mt-0.5">Generated by CompetenPractice. This document was produced from the practice&apos;s own records.</p>
      </footer>
    </div>
  );
}
