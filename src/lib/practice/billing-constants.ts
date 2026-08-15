// CPR-PAY-001/002 -- the billing vocabulary and the pure arithmetic, and NOTHING ELSE.
//
// ⚠ THIS MODULE IMPORTS NOTHING. Client consoles, the engine and the harness all read it, and the
// constants-file rule applies. Every list here mirrors a CHECK constraint in migration 303 -- a value
// added on one side only fails on every write, forever, in a swallowed error, so the two are kept in
// sight of each other by the billing harness.

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ⚠ EXPORTED FOR THE CAPABILITY AUDIT HARNESS. practice-audit-harness scans for capability literals in
 * three call shapes and cannot see codes born inside objects -- six invented codes have shipped that
 * way historically. This array is the documented workaround: the codes as literals, in one place,
 * asserted against the live practice_role_capabilities seed.
 */
export const BILLING_CAPABILITIES = [
  "billing.view", "fee.manage", "invoice.draft", "invoice.issue",
  "payment.record", "billing.adjust", "billing.export",
] as const;

export const SERVICE_TYPES = [
  ["consultation", "Consultation"],
  ["follow_up", "Follow-up"],
  ["teleconsultation", "Teleconsultation"],
  ["procedure", "Procedure"],
  ["report_document", "Report or document"],
  ["other", "Other"],
] as const;

export const PAYMENT_METHODS = [
  ["cash", "Cash"],
  ["mobile_money", "Mobile Money"],
  ["card", "Card"],
  ["bank_transfer", "Bank transfer"],
  ["other", "Other"],
] as const;

// PAY-001 s9: WHO TOOK THE MONEY. The whole collected-versus-received rule hangs on this list.
export const COLLECTORS = [
  ["practitioner", "Me (the practitioner)"],
  ["facility", "Hospital / facility"],
  ["clinic", "Clinic"],
  ["gateway", "Payment gateway"],
  ["other", "Other"],
] as const;

export const PAYER_KINDS = [
  ["patient", "Patient"],
  ["insurer", "Insurer"],
  ["corporate", "Corporate"],
  ["facility", "Hospital / facility"],
  ["other", "Other"],
] as const;

export const ADJUSTMENT_KINDS = [
  ["discount", "Discount"],
  ["waiver", "Waiver"],
  ["correction", "Correction"],
  ["refund", "Refund"],
] as const;

/**
 * ISO 4217 minor-unit exponents for the currencies this product plausibly meets first. UGX is 0 --
 * a shilling has no working subunit -- so amount_minor for UGX IS whole shillings. Unknown currencies
 * fall back to 2, which is the ISO default, and the fallback is a display concern only: the stored
 * integer never moves.
 */
export const CURRENCY_EXPONENT: Record<string, number> = {
  UGX: 0, KES: 2, TZS: 2, RWF: 0, USD: 2, EUR: 2, GBP: 2, NGN: 2, ZAR: 2,
};

/**
 * "UGX 12,450,000" from minor units. Integer arithmetic on safe integers only -- a figure beyond
 * Number.isSafeInteger renders as unformattable rather than silently rounded, because a rounded
 * amount of money is a wrong amount of money.
 */
export function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isSafeInteger(amountMinor)) return `${currency} (unformattable amount)`;
  const exp = CURRENCY_EXPONENT[currency] ?? 2;
  const negative = amountMinor < 0;
  const abs = Math.abs(amountMinor);
  const divisor = 10 ** exp;
  const major = Math.trunc(abs / divisor);
  const minor = abs - major * divisor;
  const grouped = String(major).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = exp > 0 ? `.${String(minor).padStart(exp, "0")}` : "";
  return `${negative ? "-" : ""}${currency} ${grouped}${frac}`;
}

/** CP-INV / CP-RCT / CP-SET -YYYY-NNNNN. The allocator returns the number; THIS is the one formatter. */
export function formatBillingNumber(kind: "invoice" | "receipt" | "settlement", year: number, sequence: number): string {
  const prefix = kind === "invoice" ? "CP-INV" : kind === "receipt" ? "CP-RCT" : "CP-SET";
  return `${prefix}-${year}-${String(sequence).padStart(5, "0")}`;
}

export const INVOICE_NUMBER_RE = /^CP-INV-[0-9]{4}-[0-9]{5,7}$/;
export const RECEIPT_NUMBER_RE = /^CP-RCT-[0-9]{4}-[0-9]{5,7}$/;

export type DerivedInvoiceStatus = "DRAFT" | "UNPAID" | "PART_PAID" | "PAID" | "OVERDUE" | "VOID";

/**
 * PAY-001 s7 / PAY-002 s4: the derived half of the status model. Stored status is only the three
 * ACTS (DRAFT / ISSUED / VOID); everything else is arithmetic over allocations and the due date,
 * computed here and nowhere else so two screens cannot disagree about one invoice.
 *
 * ⚠ OVERDUE outranks PART_PAID: a half-paid invoice past its due date is a late invoice, and s7
 * defines OVERDUE as due-date passed with an unpaid balance remaining.
 */
export function deriveInvoiceStatus(args: {
  status: string; totalMinor: number; allocatedMinor: number; refundedMinor?: number;
  dueDate: string | null; today: string;
}): DerivedInvoiceStatus {
  if (args.status === "DRAFT") return "DRAFT";
  if (args.status === "VOID") return "VOID";
  const effective = args.allocatedMinor - (args.refundedMinor ?? 0);
  if (effective >= args.totalMinor && args.totalMinor > 0) return "PAID";
  if (args.totalMinor === 0) return "PAID";
  if (args.dueDate && args.today > args.dueDate) return "OVERDUE";
  return effective > 0 ? "PART_PAID" : "UNPAID";
}

export const ENTITLEMENT_KINDS = [
  ["percent", "A share of each collection"],
  ["fixed_per_payment", "A fixed amount per collection"],
  ["manual", "Decided per settlement"],
] as const;

/**
 * The practitioner's share of one collected payment, in minor units -- PAY-001 s10, migration 304.
 *
 * ⚠ FLOOR, DELIBERATELY. Integer division has to put the remainder somewhere, and rounding UP would
 * overstate what the practitioner is owed -- on a receivable, the conservative error is the only
 * honest one. A manual rule (or no rule) returns null: "needs a decision", never a guess.
 */
export function entitlementShareMinor(
  rule: { kind: string; percent_bp?: number | null; fixed_minor?: number | null } | null | undefined,
  collectedMinor: number,
): number | null {
  if (!rule || !Number.isSafeInteger(collectedMinor) || collectedMinor < 0) return null;
  if (rule.kind === "percent" && Number.isInteger(rule.percent_bp))
    return Math.floor(collectedMinor * (rule.percent_bp as number) / 10000);
  if (rule.kind === "fixed_per_payment" && Number.isInteger(rule.fixed_minor))
    return Math.min(rule.fixed_minor as number, collectedMinor);
  return null;
}

export const SETTLEMENT_NUMBER_RE = /^CP-SET-[0-9]{4}-[0-9]{5,7}$/;

/** s11.3's aging buckets: useful, few, and in days owed -- never a percentage of anything. */
export function ageBucket(fromDay: string, today: string): "0-7" | "8-30" | "31-90" | "90+" {
  const days = Math.floor((Date.parse(today) - Date.parse(fromDay)) / 86400000);
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 90) return "31-90";
  return "90+";
}
