"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SERVICE_TYPES, PAYMENT_METHODS, COLLECTORS, PAYER_KINDS, ENTITLEMENT_KINDS, formatMinor,
} from "@/lib/practice/billing-constants";

// CPR-PAY-001 s11 -- the Payments console. Overview | Transactions | Outstanding | Settlements | Fees.
//
// THE COMP'S RATES ARE NOT HERE. Its paid-share and outstanding-share figures and the revenue donut
// are rates over denominators a young practice does not have; every figure below is a sum or a count
// with its scope said in words, per the standing honesty rule. (The forbidden shapes are not quoted
// here verbatim because the billing harness scans this file for them.)
//
// COLLECTED IS NOT RECEIVED, ON EVERY SURFACE. The overview separates "received by you" from
// "collected by others"; the payment form asks WHO COLLECTED as a first-class field; a facility
// collection never renders inside a received figure.

/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full rounded-lg border border-gray-200 px-2.5 py-2 text-[13px] outline-none focus:border-[var(--cp-primary)] focus:ring-2 focus:ring-[var(--cp-primary)]/10";
const BTN = "rounded-lg bg-[var(--cp-primary)] px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-[var(--cp-primary-deep)] disabled:opacity-40";
const QUIET = "rounded-lg border border-gray-200 px-2.5 py-1 text-[11px] font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50";
const card = "rounded-xl border border-gray-200 bg-white p-4";

const STATUS_CHIP: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  UNPAID: "bg-gray-100 text-gray-700",
  PART_PAID: "bg-sky-50 text-sky-700",
  PAID: "bg-emerald-50 text-emerald-700",
  OVERDUE: "bg-amber-50 text-amber-800",
  VOID: "bg-gray-100 text-gray-400",
};

type Money = { amountMinor: number; currency: string };

export default function PaymentsConsole(props: {
  tab: string;
  overview: any; invoices: any; outstanding: any; fees: any; locations: any[];
  encounterId: string | null; encounterCharges: any | null; patientId: string | null;
  canManageFees: boolean; canDraft: boolean; canIssue: boolean;
  canRecordPayment: boolean; canAdjust: boolean;
  receivables: any; settlements: any;
}) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function post(payload: Record<string, unknown>): Promise<any | null> {
    setBusy(true); setNotice(null);
    try {
      const res = await fetch("/api/v1/practice/billing", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: "err", text: body?.error?.message ?? `That did not work (${res.status}).` }); return null; }
      return body;
    } finally { setBusy(false); }
  }
  const reload = () => window.location.reload();

  const tabHref = (t: string) =>
    `/practice/payments?tab=${t}${props.patientId ? `&patientId=${props.patientId}` : ""}`;
  const TABS: [string, string][] = [
    ["overview", "Overview"], ["transactions", "Transactions"], ["outstanding", "Outstanding"],
    ["settlements", "Settlements"], ["fees", "Fees"],
  ];

  // ── Record payment state ──
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    invoiceId: "", amountMinor: "", method: "cash", collector: "practitioner",
    payerKind: "patient", reference: "", notes: "",
  });
  const issuedInvoices = (props.invoices?.items ?? []).filter((i: any) => i.status === "ISSUED" && i.balanceMinor > 0);

  async function submitPayment() {
    const inv = issuedInvoices.find((i: any) => i.id === payForm.invoiceId);
    if (!inv) { setNotice({ kind: "err", text: "Choose the invoice this payment answers." }); return; }
    const amount = Number(payForm.amountMinor);
    const body = await post({
      action: "recordPayment", patientId: inv.patient_id ?? null,
      payerKind: payForm.payerKind, amountMinor: amount, currency: inv.currency,
      method: payForm.method, collector: payForm.collector,
      reference: payForm.reference || null, notes: payForm.notes || null,
      allocations: [{ invoiceId: inv.id, amountMinor: amount }],
    });
    if (body) { setNotice({ kind: "ok", text: `Recorded. Receipt ${body.receiptNumber}.` }); reload(); }
  }

  // ── Fee editor state ──
  const [feeForm, setFeeForm] = useState({ feeId: "", name: "", serviceType: "consultation", amountMajor: "", currency: "UGX", code: "" });
  async function submitFee() {
    // The form takes MAJOR units for the human; the wire and the store are minor units. UGX has
    // exponent 0 so major IS minor; for 2-exponent currencies the conversion is exact integer math.
    const exp = { UGX: 0, RWF: 0 }[feeForm.currency as "UGX" | "RWF"] ?? 2;
    const major = Number(feeForm.amountMajor);
    if (!Number.isFinite(major) || major < 0) { setNotice({ kind: "err", text: "The fee must be a non-negative number." }); return; }
    const amountMinor = Math.round(major * 10 ** exp);
    const body = await post({
      action: "saveFee", feeId: feeForm.feeId || null, name: feeForm.name,
      serviceType: feeForm.serviceType, amountMinor, currency: feeForm.currency, code: feeForm.code || null,
    });
    if (body) { setNotice({ kind: "ok", text: "Fee saved." }); reload(); }
  }

  // ── Encounter charge band state ──
  const [chargeFeeId, setChargeFeeId] = useState("");
  async function chargeEncounter() {
    const body = await post({
      action: "createCharge", source: "consultation", sourceRef: props.encounterId,
      encounterId: props.encounterId, serviceFeeId: chargeFeeId || null,
    });
    if (body) { setNotice({ kind: "ok", text: "Charged. It is now available to invoice." }); reload(); }
  }

  // ── Draft + issue from uninvoiced charges of this encounter ──
  async function draftAndIssue(chargeIds: string[]) {
    const draft = await post({ action: "createDraftInvoice", chargeIds });
    if (!draft) return;
    const issued = await post({ action: "issueInvoice", invoiceId: draft.id });
    if (issued) { setNotice({ kind: "ok", text: `Issued ${issued.invoiceNumber}.` }); reload(); }
    else setNotice({ kind: "err", text: "The draft was created but not issued; find it under Transactions to issue or void it." });
  }

  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState("");

  // ── Settlements state (Phase 2, migration 304) ──
  const [entForm, setEntForm] = useState({ locationId: "", kind: "percent", percentBp: "", fixedMinor: "" });
  const [settleFacility, setSettleFacility] = useState<string | null>(null);
  const [settleSel, setSettleSel] = useState<Record<string, boolean>>({});
  const [settleManual, setSettleManual] = useState<Record<string, string>>({});
  const [settleForm, setSettleForm] = useState({ receivedMinor: "", periodFrom: "", periodTo: "", reference: "" });

  async function submitEntitlement() {
    const body = await post({
      action: "saveEntitlement", locationId: entForm.locationId, kind: entForm.kind,
      percentBp: entForm.kind === "percent" ? Number(entForm.percentBp) : null,
      fixedMinor: entForm.kind === "fixed_per_payment" ? Number(entForm.fixedMinor) : null,
    });
    if (body) { setNotice({ kind: "ok", text: "Share saved. It applies to future settlements; nothing already settled moves." }); reload(); }
  }

  async function submitSettlement(f: any) {
    const chosen = f.payments.filter((p: any) => settleSel[p.id]);
    if (chosen.length === 0) { setNotice({ kind: "err", text: "Tick the collected payments this transfer answers for." }); return; }
    const body = await post({
      action: "recordSettlement", locationId: f.locationId, currency: f.currency,
      periodFrom: settleForm.periodFrom, periodTo: settleForm.periodTo,
      receivedMinor: Number(settleForm.receivedMinor), reference: settleForm.reference || null,
      items: chosen.map((p: any) => ({
        paymentId: p.id,
        entitlementMinor: p.entitlementMinor ?? (settleManual[p.id] ? Number(settleManual[p.id]) : null),
      })),
    });
    if (body) { setNotice({ kind: "ok", text: `Recorded ${body.settlementNumber}. That money now counts as received.` }); reload(); }
  }

  return (
    <>
      {notice && (
        <p role="status" className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${notice.kind === "ok"
          ? "bg-[var(--cmp-surface-success)] text-[var(--cmp-text-success)]"
          : "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]"}`}>
          {notice.text}
        </p>
      )}

      {/* ── s13's encounter handoff: charges for the consultation just finished ─────────────────── */}
      {props.encounterId && props.encounterCharges && (
        <section className={`${card} mt-3 border-indigo-100 bg-indigo-50/30`}>
          <h2 className="text-[13px] font-bold text-gray-900">Charges for this consultation</h2>
          <p className="mt-0.5 text-[11px] text-gray-600">
            The clinical record is complete regardless &mdash; payment never blocks care. Charge, invoice
            and take payment here, or press Later and find it all again under Transactions.
          </p>
          {props.encounterCharges.unavailable ? (
            <p className="mt-2 text-[12px] text-rose-800">The charges could not be read: {props.encounterCharges.detail}</p>
          ) : props.encounterCharges.items.length === 0 ? (
            <div className="mt-2 flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-600">Charge from the fee catalogue</span>
                <select value={chargeFeeId} onChange={e => setChargeFeeId(e.target.value)} className={`${input} min-w-[260px]`}>
                  <option value="">Choose a fee</option>
                  {(props.fees?.items ?? []).filter((f: any) => f.active).map((f: any) => (
                    <option key={f.id} value={f.id}>{f.name} · {formatMinor(f.amount_minor, f.currency)}</option>
                  ))}
                </select>
              </label>
              <button type="button" className={BTN} disabled={busy || !chargeFeeId || !props.canDraft} onClick={chargeEncounter}>
                Raise charge
              </button>
              <Link href="/practice/payments" className={QUIET}>Later</Link>
            </div>
          ) : (
            <div className="mt-2">
              <ul className="flex flex-col gap-1">
                {props.encounterCharges.items.map((c: any) => (
                  <li key={c.id} className="flex items-baseline gap-2 text-[12px] text-gray-800">
                    <span>{c.description}</span>
                    <span className="ml-auto font-semibold">{formatMinor(c.amount_minor, c.currency)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-2 flex items-center gap-2">
                <button type="button" className={BTN} disabled={busy || !props.canDraft || !props.canIssue}
                  onClick={() => draftAndIssue(props.encounterCharges.items.map((c: any) => c.id))}>
                  Invoice these
                </button>
                <Link href="/practice/payments" className={QUIET}>Later</Link>
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── Internal navigation ── */}
      <div className="mt-4 flex flex-wrap items-center gap-1">
        {TABS.map(([k, l]) => (
          <Link key={k} href={tabHref(k)} aria-current={props.tab === k ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${props.tab === k
              ? "border-[var(--cp-primary)] bg-[var(--cp-primary)]/10 text-[var(--cp-primary-deep)]"
              : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"}`}>
            {l}
          </Link>
        ))}
        {props.canRecordPayment && (
          <button type="button" onClick={() => setPayOpen(o => !o)} className={`ml-auto ${BTN}`}>
            {payOpen ? "Cancel" : "+ Record payment"}
          </button>
        )}
      </div>

      {payOpen && (
        <section className={`${card} mt-3`}>
          <h3 className="text-[13px] font-bold text-gray-900">Record a payment</h3>
          <p className="mt-0.5 text-[11px] text-gray-500">
            This records money that changed hands in the world. Who collected it is the field the whole
            module turns on &mdash; money the hospital took is not yours until it settles.
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="text-[11px] font-semibold text-gray-600">Against invoice *</span>
              <select value={payForm.invoiceId} onChange={e => {
                const inv = issuedInvoices.find((i: any) => i.id === e.target.value);
                setPayForm(f => ({ ...f, invoiceId: e.target.value, amountMinor: inv ? String(inv.balanceMinor) : "" }));
              }} className={input}>
                <option value="">Choose an issued invoice</option>
                {issuedInvoices.map((i: any) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} · balance {formatMinor(i.balanceMinor, i.currency)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Amount (minor units) *</span>
              <input type="number" min={1} value={payForm.amountMinor}
                onChange={e => setPayForm(f => ({ ...f, amountMinor: e.target.value }))} className={input} />
              <span className="text-[10px] text-gray-400">Part payment is fine; the balance stays on the invoice.</span>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Method</span>
              <select value={payForm.method} onChange={e => setPayForm(f => ({ ...f, method: e.target.value }))} className={input}>
                {PAYMENT_METHODS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Collected by *</span>
              <select value={payForm.collector} onChange={e => setPayForm(f => ({ ...f, collector: e.target.value }))} className={input}>
                {COLLECTORS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Payer</span>
              <select value={payForm.payerKind} onChange={e => setPayForm(f => ({ ...f, payerKind: e.target.value }))} className={input}>
                {PAYER_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold text-gray-600">Reference</span>
              <input value={payForm.reference} placeholder="transaction / MoMo ref (optional)"
                onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))} className={input} />
            </label>
          </div>
          <button type="button" className={`${BTN} mt-2`} disabled={busy || !payForm.invoiceId || !Number(payForm.amountMinor)}
            onClick={submitPayment}>
            Record payment
          </button>
        </section>
      )}

      {/* ══ OVERVIEW ══ */}
      {props.tab === "overview" && !props.overview.unavailable && (
        <>
          {props.overview.byCurrency.length === 0 ? (
            <section className={`${card} mt-3`}>
              <p className="text-[12px] text-gray-600">
                Nothing is charged or recorded in this period. The read succeeded &mdash; this is a
                genuinely empty money picture, not an unreadable one. Set your fees under Fees, and
                charges can be raised from a consultation or here.
              </p>
            </section>
          ) : props.overview.byCurrency.map((c: any) => (
            <section key={c.currency} className={`${card} mt-3`}>
              <h2 className="text-[11px] font-bold uppercase tracking-wide text-gray-700">{c.currency}</h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Charged</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.chargedMinor, c.currency)}</p>
                  <p className="text-[10px] text-gray-500">{c.chargedCount} charge{c.chargedCount === 1 ? "" : "s"}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Received by you</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.receivedByPractitionerMinor, c.currency)}</p>
                  <p className="text-[10px] text-gray-500">
                    {formatMinor(c.collectedDirectlyMinor, c.currency)} collected by you
                    {c.settledToPractitionerMinor > 0 ? ` + ${formatMinor(c.settledToPractitionerMinor, c.currency)} settled to you` : ""}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Collected by others</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.collectedByOthersMinor, c.currency)}</p>
                  <p className="text-[10px] text-gray-500">hospital, clinic or gateway &mdash; not yet yours</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500">Outstanding on invoices</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{formatMinor(c.outstandingInvoicedMinor, c.currency)}</p>
                  <p className={`text-[10px] ${c.overdueCount > 0 ? "font-semibold text-amber-700" : "text-gray-500"}`}>
                    {c.overdueCount} overdue
                  </p>
                </div>
              </div>
              {(c.outstandingSettlementMinor > 0 || c.settlementNeedsDecision > 0 || c.receivablesUnavailable) && (
                <p className="mt-2 text-[11px] text-gray-600">
                  {c.receivablesUnavailable
                    ? "The facility receivable could not be read -- this is not a statement that facilities owe you nothing."
                    : (<>
                      Facilities still owe you <strong>{formatMinor(c.outstandingSettlementMinor, c.currency)}</strong> of
                      unsettled collections{c.settlementNeedsDecision > 0 ? `, and ${c.settlementNeedsDecision} collection${c.settlementNeedsDecision === 1 ? " needs" : "s need"} a share decision` : ""}.{" "}
                      <Link href={tabHref("settlements")} className="font-semibold text-[var(--cp-primary-deep)] hover:underline">
                        Settlements &rarr;
                      </Link>
                    </>)}
                </p>
              )}
            </section>
          ))}

          {props.overview.recent.length > 0 && (
            <section className={`${card} mt-3`}>
              <h2 className="text-[13px] font-bold text-gray-900">Recent</h2>
              <ul className="mt-2 flex flex-col">
                {props.overview.recent.map((r: any) => (
                  <li key={`${r.kind}-${r.id}`} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 text-[12px] last:border-0">
                    <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${r.kind === "charge" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>
                      {r.kind === "charge" ? "Charged" : "Paid"}
                    </span>
                    <span className="text-gray-800">{r.label}</span>
                    <span className="ml-auto text-gray-500">{r.when}</span>
                    <span className="w-32 text-right font-semibold text-gray-900">{formatMinor(r.amountMinor, r.currency)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ══ TRANSACTIONS ══ */}
      {props.tab === "transactions" && (
        <section className={`${card} mt-3`}>
          <h2 className="text-[13px] font-bold text-gray-900">Invoices</h2>
          {props.invoices.unavailable ? (
            <p className="mt-2 text-[12px] text-rose-800">The invoices could not be read: {props.invoices.detail}</p>
          ) : props.invoices.items.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-600">No invoices in this period. The read succeeded.</p>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-gray-200 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                    <th className="py-1.5">Invoice</th><th>Status</th><th>Issued</th><th>Due</th>
                    <th className="text-right">Total</th><th className="text-right">Paid</th>
                    <th className="text-right">Balance</th><th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {props.invoices.items.map((i: any) => (
                    <tr key={i.id} className="border-b border-gray-100 last:border-0">
                      <td className="py-1.5 font-semibold text-gray-800">{i.invoice_number ?? "draft"}</td>
                      <td>
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${STATUS_CHIP[i.derivedStatus] ?? "bg-gray-100 text-gray-600"}`}>
                          {i.derivedStatus.replace("_", " ")}
                        </span>
                      </td>
                      <td className="text-gray-600">{i.issue_date ?? "—"}</td>
                      <td className="text-gray-600">{i.due_date ?? "—"}</td>
                      <td className="text-right text-gray-800">{formatMinor(i.total_minor, i.currency)}</td>
                      <td className="text-right text-gray-800">{formatMinor(i.allocatedMinor, i.currency)}</td>
                      <td className="text-right font-semibold text-gray-900">{formatMinor(i.balanceMinor, i.currency)}</td>
                      <td className="py-1 text-right">
                        <span className="inline-flex items-center gap-1.5">
                          {i.status === "ISSUED" && (
                            <Link href={`/practice/payments/invoice/${i.id}/print`} className={QUIET}>Print</Link>
                          )}
                          {i.status === "DRAFT" && props.canIssue && (
                            <button type="button" className={QUIET} disabled={busy}
                              onClick={async () => {
                                const body = await post({ action: "issueInvoice", invoiceId: i.id });
                                if (body) { setNotice({ kind: "ok", text: `Issued ${body.invoiceNumber}.` }); reload(); }
                              }}>
                              Issue
                            </button>
                          )}
                          {i.status !== "VOID" && props.canAdjust && (
                            <button type="button" className={QUIET} disabled={busy}
                              onClick={() => { setVoidReason(""); setVoidingId(voidingId === i.id ? null : i.id); }}>
                              {voidingId === i.id ? "Cancel" : "Void"}
                            </button>
                          )}
                        </span>
                        {voidingId === i.id && (
                          <form className="mt-1 flex items-center justify-end gap-1.5"
                            onSubmit={async ev => {
                              ev.preventDefault();
                              const body = await post({ action: "voidInvoice", invoiceId: i.id, reason: voidReason });
                              if (body) { setNotice({ kind: "ok", text: "Voided. Its number is never reused; its charges are free to reinvoice." }); reload(); }
                            }}>
                            <input autoFocus value={voidReason} onChange={e => setVoidReason(e.target.value)}
                              placeholder="Why is this void?" className={`${input} max-w-[220px]`} />
                            <button type="submit" className={QUIET} disabled={busy || voidReason.trim().length < 3}>Confirm</button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ══ OUTSTANDING ══ */}
      {props.tab === "outstanding" && (
        <section className={`${card} mt-3`}>
          <h2 className="text-[13px] font-bold text-gray-900">Outstanding balances</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            Issued invoices with money still owed, aged in days. What facilities owe you lives under
            Settlements and is not counted here.
          </p>
          {props.outstanding.unavailable ? (
            <p className="mt-2 text-[12px] text-rose-800">Could not be read: {props.outstanding.detail}</p>
          ) : props.outstanding.items.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-600">Nothing is owed on any issued invoice. The read succeeded.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {props.outstanding.items.map((r: any) => (
                <li key={r.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 text-[12px] last:border-0">
                  <span className="font-semibold text-gray-800">{r.invoice_number}</span>
                  <span className="text-gray-600">{r.patientName ?? r.payer_label ?? r.payer_kind}</span>
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">{r.age} days</span>
                  <span className="ml-auto font-semibold text-gray-900">{formatMinor(r.balanceMinor, r.currency)}</span>
                  {/* PAY-002 s10: the period summary, printable. Only where the invoice knows its patient. */}
                  {r.patient_id && (
                    <a href={`/practice/payments/statement/${r.patient_id}/print`}
                      className="shrink-0 text-[10px] font-semibold text-[var(--cp-primary-deep)] hover:underline">
                      Statement &rarr;
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* ══ SETTLEMENTS ══ Phase 2 (migration 304): the journey of facility-collected money into
          your hands. Receivables are DERIVED; a settlement is a recorded fact; the difference between
          your share and what arrived stays visible -- never silently reconciled away. */}
      {props.tab === "settlements" && (
        <>
          <section className={`${card} mt-3`}>
            <h2 className="text-[13px] font-bold text-gray-900">Owed to you by facilities</h2>
            <p className="mt-0.5 text-[11px] text-gray-500">
              Your share of what hospitals and clinics collected on your behalf and have not yet
              settled. The share is the term you configured per facility, applied to each collection.
            </p>
            {props.receivables.unavailable ? (
              <p className="mt-2 text-[12px] text-rose-800">
                Could not be read: {props.receivables.detail}. This is not a statement that nothing is owed.
              </p>
            ) : props.receivables.facilities.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-600">
                No unsettled facility collections. The read succeeded &mdash; everything collected on
                your behalf has been settled, or nothing has been collected that way.
              </p>
            ) : props.receivables.facilities.map((f: any) => (
              <div key={`${f.locationId}-${f.currency}`} className="mt-3 rounded-lg border border-gray-100 p-3">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[13px] font-semibold text-gray-900">{f.locationName ?? "No location recorded"}</span>
                  <span className="text-[11px] text-gray-500">
                    collected {formatMinor(f.collectedMinor, f.currency)} across {f.payments.length} payment{f.payments.length === 1 ? "" : "s"}
                  </span>
                  <span className="ml-auto text-[13px] font-bold text-gray-900">
                    your share {formatMinor(f.entitlementMinor, f.currency)}
                  </span>
                </div>
                {f.rule === null && (
                  <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
                    No share is configured for this facility, so every entitlement below needs a manual figure.
                  </p>
                )}
                {f.needsDecision > 0 && f.rule !== null && (
                  <p className="mt-1 text-[11px] text-[var(--cmp-text-warning)]">
                    {f.needsDecision} collection{f.needsDecision === 1 ? " needs" : "s need"} a manual entitlement.
                  </p>
                )}
                {settleFacility === `${f.locationId}-${f.currency}` ? (
                  <form className="mt-2 flex flex-col gap-2 rounded-lg bg-gray-50 p-2"
                    onSubmit={e => { e.preventDefault(); submitSettlement(f); }}>
                    <ul className="flex flex-col gap-1">
                      {f.payments.map((p: any) => (
                        <li key={p.id} className="flex items-center gap-2 text-[12px]">
                          <input type="checkbox" checked={!!settleSel[p.id]}
                            onChange={e => setSettleSel(s => ({ ...s, [p.id]: e.target.checked }))} />
                          <span className="text-gray-700">{String(p.paid_at).slice(0, 10)} · {p.method}</span>
                          <span className="text-gray-500">collected {formatMinor(p.amount_minor, f.currency)}</span>
                          <span className="ml-auto font-semibold text-gray-800">
                            {p.entitlementMinor !== null ? `share ${formatMinor(p.entitlementMinor, f.currency)}` : (
                              <input type="number" min={0} max={p.amount_minor} placeholder="share (minor units)"
                                value={settleManual[p.id] ?? ""}
                                onChange={e => setSettleManual(s => ({ ...s, [p.id]: e.target.value }))}
                                className={`${input} w-40`} />
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <div className="grid gap-2 sm:grid-cols-4">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-gray-600">Period from *</span>
                        <input type="date" required value={settleForm.periodFrom}
                          onChange={e => setSettleForm(s => ({ ...s, periodFrom: e.target.value }))} className={input} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-gray-600">to *</span>
                        <input type="date" required value={settleForm.periodTo}
                          onChange={e => setSettleForm(s => ({ ...s, periodTo: e.target.value }))} className={input} />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-gray-600">Amount received (minor) *</span>
                        <input type="number" min={1} required value={settleForm.receivedMinor}
                          onChange={e => setSettleForm(s => ({ ...s, receivedMinor: e.target.value }))} className={input} />
                        {/* The difference from your share is recorded and shown, never forced to zero. */}
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] font-semibold text-gray-600">Reference</span>
                        <input value={settleForm.reference} placeholder="transfer ref (optional)"
                          onChange={e => setSettleForm(s => ({ ...s, reference: e.target.value }))} className={input} />
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="submit" className={BTN} disabled={busy || !props.canRecordPayment}>Record settlement</button>
                      <button type="button" className={QUIET} onClick={() => setSettleFacility(null)}>Cancel</button>
                    </div>
                  </form>
                ) : (
                  <button type="button" className={`${QUIET} mt-2`} disabled={!props.canRecordPayment}
                    onClick={() => { setSettleSel({}); setSettleManual({}); setSettleFacility(`${f.locationId}-${f.currency}`); }}>
                    Record a settlement from this facility
                  </button>
                )}
              </div>
            ))}
          </section>

          <section className={`${card} mt-3`}>
            <h2 className="text-[13px] font-bold text-gray-900">Settlements received</h2>
            {props.settlements.unavailable ? (
              <p className="mt-2 text-[12px] text-rose-800">Could not be read: {props.settlements.detail}</p>
            ) : props.settlements.items.length === 0 ? (
              <p className="mt-2 text-[12px] text-gray-600">None recorded yet. The read succeeded.</p>
            ) : (
              <ul className="mt-2 flex flex-col">
                {props.settlements.items.map((s: any) => (
                  <li key={s.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 text-[12px] last:border-0">
                    <span className="font-mono text-[11px] text-gray-500">{s.settlement_number}</span>
                    <span className="font-semibold text-gray-800">{s.locationName ?? "—"}</span>
                    <span className="text-gray-500">{s.period_from} to {s.period_to} · {s.itemCount ?? "?"} item{s.itemCount === 1 ? "" : "s"}</span>
                    {/* s10: the discrepancy stays visible, in words, without alarm colours. */}
                    {typeof s.differenceMinor === "number" && s.differenceMinor !== 0 && (
                      <span className="text-[11px] font-semibold text-amber-700">
                        {s.differenceMinor < 0 ? formatMinor(-s.differenceMinor, s.currency) + " short of your share" : formatMinor(s.differenceMinor, s.currency) + " above your share"}
                      </span>
                    )}
                    <span className="ml-auto font-semibold text-gray-900">{formatMinor(s.received_minor, s.currency)}</span>
                    <span className="text-[11px] text-gray-500">{s.received_on}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {props.canManageFees && (
            <section className={`${card} mt-3`}>
              <h3 className="text-[13px] font-bold text-gray-900">Your share per facility</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">
                The commercial term you agreed with each facility. Stored exactly (basis points, never a
                float), photographed onto every settlement it touches, and never applied backwards.
              </p>
              <form className="mt-2 flex flex-wrap items-end gap-2"
                onSubmit={e => { e.preventDefault(); submitEntitlement(); }}>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-600">Facility *</span>
                  <select required value={entForm.locationId}
                    onChange={e => setEntForm(f => ({ ...f, locationId: e.target.value }))} className={`${input} min-w-[200px]`}>
                    <option value="">Choose a location</option>
                    {props.locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-[11px] font-semibold text-gray-600">Kind</span>
                  <select value={entForm.kind} onChange={e => setEntForm(f => ({ ...f, kind: e.target.value }))} className={input}>
                    {ENTITLEMENT_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </label>
                {entForm.kind === "percent" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-gray-600">Share, in basis points *</span>
                    <input type="number" min={0} max={10000} required value={entForm.percentBp}
                      onChange={e => setEntForm(f => ({ ...f, percentBp: e.target.value }))} className={input} />
                    <span className="text-[10px] text-gray-400">6000 means you keep 60 of every 100 collected.</span>
                  </label>
                )}
                {entForm.kind === "fixed_per_payment" && (
                  <label className="flex flex-col gap-1">
                    <span className="text-[11px] font-semibold text-gray-600">Fixed share (minor units) *</span>
                    <input type="number" min={0} required value={entForm.fixedMinor}
                      onChange={e => setEntForm(f => ({ ...f, fixedMinor: e.target.value }))} className={input} />
                  </label>
                )}
                <button type="submit" className={BTN} disabled={busy || !entForm.locationId}>Save share</button>
              </form>
            </section>
          )}
        </>
      )}

      {/* ══ FEES ══ */}
      {props.tab === "fees" && (
        <section className={`${card} mt-3`}>
          <h2 className="text-[13px] font-bold text-gray-900">Service fees</h2>
          <p className="mt-0.5 text-[11px] text-gray-500">
            What each kind of work costs by default. A charge photographs the fee it used, so editing a
            fee never rewrites anything already charged.
          </p>
          {props.fees.unavailable ? (
            <p className="mt-2 text-[12px] text-rose-800">The catalogue could not be read: {props.fees.detail}</p>
          ) : props.fees.items.length === 0 ? (
            <p className="mt-2 text-[12px] text-gray-600">No fees yet. Add the first below.</p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {props.fees.items.map((f: any) => (
                <li key={f.id} className="flex items-baseline gap-2 border-b border-gray-100 py-1.5 text-[12px] last:border-0">
                  <span className="font-semibold text-gray-800">{f.name}</span>
                  <span className="text-[10px] text-gray-500">{(SERVICE_TYPES.find(([k]) => k === f.service_type) ?? [null, f.service_type])[1]}</span>
                  {!f.active && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">inactive</span>}
                  {f.overrides.length > 0 && (
                    <span className="text-[10px] text-gray-500">{f.overrides.length} location override{f.overrides.length === 1 ? "" : "s"}</span>
                  )}
                  <span className="ml-auto font-semibold text-gray-900">{formatMinor(f.amount_minor, f.currency)}</span>
                  {props.canManageFees && (
                    <button type="button" className={QUIET} disabled={busy}
                      onClick={() => setFeeForm({
                        feeId: f.id, name: f.name, serviceType: f.service_type,
                        amountMajor: "", currency: f.currency, code: f.code ?? "",
                      })}>
                      Edit
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {props.canManageFees && (
            <form className="mt-3 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-3"
              onSubmit={e => { e.preventDefault(); submitFee(); }}>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-600">{feeForm.feeId ? "Edit fee" : "New fee"} *</span>
                <input required value={feeForm.name} placeholder="e.g. New consultation"
                  onChange={e => setFeeForm(f => ({ ...f, name: e.target.value }))} className={`${input} min-w-[220px]`} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-600">Type</span>
                <select value={feeForm.serviceType} onChange={e => setFeeForm(f => ({ ...f, serviceType: e.target.value }))} className={input}>
                  {SERVICE_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-600">Amount *</span>
                <input required type="number" min={0} value={feeForm.amountMajor} placeholder="e.g. 100000"
                  onChange={e => setFeeForm(f => ({ ...f, amountMajor: e.target.value }))} className={input} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-semibold text-gray-600">Currency</span>
                <input value={feeForm.currency} maxLength={3}
                  onChange={e => setFeeForm(f => ({ ...f, currency: e.target.value.toUpperCase() }))} className={`${input} w-20`} />
              </label>
              <button type="submit" className={BTN} disabled={busy || !feeForm.name.trim() || feeForm.amountMajor === ""}>
                {feeForm.feeId ? "Save changes" : "Add fee"}
              </button>
              {feeForm.feeId && (
                <button type="button" className={QUIET}
                  onClick={() => setFeeForm({ feeId: "", name: "", serviceType: "consultation", amountMajor: "", currency: "UGX", code: "" })}>
                  New instead
                </button>
              )}
            </form>
          )}
        </section>
      )}
    </>
  );
}
