import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { resolvePracticeShell } from "@/lib/practice/shell";
import { hasCapability } from "@/lib/practice/access";
import { audit } from "@/lib/practice/audit";
import { formatMinor } from "@/lib/practice/billing-constants";

// CREDIT / ADJUSTMENT NOTE and REFUND NOTE -- CPR-PAY-002 s3's two Conditional documents.
//
// THE ADJUSTMENT ROW IS THE RECORD; THIS PAGE IS ITS DOCUMENT FACE. recordAdjustment already
// captures s14's whole contract (amount, kind, reason, user, date) in an append-only row -- so the
// note renders FROM that row, carries the row's own identity, and no second numbered series exists
// to drift from it. A refund note states s14's rule in its own body: the refund reverses money, it
// never erases the original payment.
//
// THE PRINT VIEW IS THE PDF -- the same policy as invoices, statements and reports.

export const dynamic = "force-dynamic";

/* eslint-disable @typescript-eslint/no-explicit-any */

const KIND_TITLE: Record<string, string> = {
  discount: "Adjustment Note -- Discount",
  waiver: "Adjustment Note -- Waiver",
  correction: "Adjustment Note -- Correction",
  refund: "Refund Note",
};

export default async function AdjustmentNotePage({ params }: {
  params: Promise<{ adjustmentId: string }>;
}) {
  const shell = await resolvePracticeShell();
  if (shell.state !== "READY") redirect("/practice");
  if (!hasCapability(shell.ctx, "billing.view")) redirect("/practice/home");

  const { adjustmentId } = await params;
  const admin = createAdminClient();
  // `as any`: the typed client cannot parse a concatenated select string with embeds.
  const { data: a }: { data: any } = await admin.from("practice_billing_adjustment")
    .select("id, kind, amount_minor, currency, reason, created_at, "
      + "practice_invoice:invoice_id(invoice_number, patient_id), practice_payment:payment_id(amount_minor, currency, method, paid_at, patient_id)")
    .eq("id", adjustmentId).eq("workspace_id", shell.ctx.workspaceId).maybeSingle();
  if (!a) notFound();

  const inv: any = a.practice_invoice;
  const pay: any = a.practice_payment;
  const identified = hasCapability(shell.ctx, "patient.view");
  let patientName: string | null = null;
  const patientId = inv?.patient_id ?? pay?.patient_id ?? null;
  if (identified && patientId) {
    const { data: p } = await admin.from("practice_patient")
      .select("display_name").eq("id", patientId).eq("workspace_id", shell.ctx.workspaceId).maybeSingle();
    patientName = p?.display_name ?? null;
  }

  await audit(admin, {
    workspaceId: shell.ctx.workspaceId, actorId: shell.ctx.userId,
    eventType: "practice.billing_document_printed",
    payload: { kind: a.kind === "refund" ? "refund_note" : "adjustment_note", adjustmentId: a.id },
  });

  return (
    <div className="mx-auto max-w-[190mm] bg-white p-8 print:p-0">
      <div className="no-print mb-4 flex items-center gap-2 print:hidden">
        <Link href="/practice/payments"
          className="rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50">
          &larr; Payments
        </Link>
        <span className="text-[11px] text-gray-500">Use your browser&apos;s print for paper or PDF.</span>
      </div>

      <header className="border-b-2 border-gray-900 pb-3">
        <h1 className="text-lg font-bold text-gray-900">{KIND_TITLE[a.kind] ?? "Adjustment Note"}</h1>
        <p className="mt-0.5 text-[11px] text-gray-500">
          The formal record of a governed correction (CPR-PAY-002 s14). This note documents the
          adjustment row itself &mdash; there is no separate note register to drift from it.
        </p>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-[12px]">
        {[
          ["Recorded", String(a.created_at).slice(0, 16).replace("T", " ") + " UTC"],
          ["Record", a.id],
          ["Amount", formatMinor(a.amount_minor, a.currency)],
          ["Kind", a.kind],
          ["Patient", patientName ?? (identified ? (patientId ? "(name unavailable)" : "not linked to a patient") : "withheld -- viewing names needs patient.view")],
          ["Against invoice", inv?.invoice_number ?? "not linked to an invoice"],
        ].map(([k, v]) => (
          <div key={String(k)}>
            <dt className="text-[10px] uppercase tracking-wide text-gray-400">{k}</dt>
            <dd className="font-semibold text-gray-900">{v}</dd>
          </div>
        ))}
      </dl>

      <section className="mt-4 rounded-lg bg-gray-50 px-3 py-2.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Reason, as recorded</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-gray-800">{a.reason}</p>
      </section>

      {a.kind === "refund" && pay && (
        <p className="mt-4 rounded-lg border border-gray-200 px-3 py-2.5 text-[11.5px] leading-relaxed text-gray-700">
          This refund reverses money against the payment of {formatMinor(pay.amount_minor, pay.currency)}
          {" "}({pay.method}) received {String(pay.paid_at).slice(0, 10)}. <b>The original payment stands
          on the record</b> &mdash; a refund is its own transaction and never erases what it reverses
          (CPR-PAY-002 s14).
        </p>
      )}

      <p className="mt-4 text-[9px] text-gray-400">
        Rendered from the adjustment record above at the moment of printing. The row is the source of
        truth; this page adds nothing to it.
      </p>
    </div>
  );
}
