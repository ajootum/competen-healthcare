/* eslint-disable @typescript-eslint/no-explicit-any */

// ── HOLDINGS-FX-01: THE FX RESERVE LEDGER (holdings_fx_event, migration 560) ──────────────────────────────
//
// A person records what the bank statement already shows: an opening USD balance, a conversion (UGX sold,
// USD bought, which is the ACTUAL executed rate), a provider payment out of the reserve, or a void of an
// earlier entry. Nothing here moves money. The table is append-only, so a mistake is voided and re-entered.
// Amounts arrive in major units and are stored in the currency's minor unit (gateway.ts MINOR_EXPONENT).

import { majorToMinor, minorToMajor } from "@/lib/commerce/gateway";

export type FxEventKind = "opening_balance" | "conversion" | "provider_payment" | "void";
export const FX_EVENT_KINDS: readonly FxEventKind[] = ["opening_balance", "conversion", "provider_payment", "void"];
export type CostPool = "scholar" | "professional" | "shared";
export const RESERVE_CURRENCY = "USD";

export type FxEventRow = {
  id: string; occurred_at: string; kind: FxEventKind; cost_pool: CostPool;
  from_currency: string | null; from_amount_minor: number | null;
  to_currency: string | null; to_amount_minor: number | null;
  counterparty: string | null; source_ref: string; note: string | null; voids_id: string | null;
  recorded_by: string; created_at: string;
};

type Refusal = { ok: false; errors: Record<string, string> };
const ISO = /^[A-Z]{3}$/;

/** Validate a form submission into an insertable row. Field-level errors, never a guess. */
export function validateFxEvent(input: any, now: Date): { ok: true; row: Record<string, unknown> } | Refusal {
  const errors: Record<string, string> = {};
  const kind = String(input?.kind ?? "") as FxEventKind;
  if (!FX_EVENT_KINDS.includes(kind)) errors.kind = "Choose what happened.";
  const occurred = new Date(String(input?.occurredAt ?? ""));
  if (Number.isNaN(occurred.getTime())) errors.occurredAt = "Enter the date on the statement.";
  else if (occurred.getTime() > now.getTime() + 86400000) errors.occurredAt = "The date cannot be in the future.";
  const sourceRef = String(input?.sourceRef ?? "").trim();
  if (sourceRef.length < 4) errors.sourceRef = "Enter the bank or invoice reference (at least 4 characters).";
  const pool = String(input?.costPool ?? "scholar") as CostPool;
  if (!["scholar", "professional", "shared"].includes(pool)) errors.costPool = "Choose a cost pool.";

  const money = (k: "from" | "to") => {
    const cur = String(input?.[`${k}Currency`] ?? "").trim().toUpperCase();
    const amt = Number(input?.[`${k}Amount`]);
    if (!ISO.test(cur)) { errors[`${k}Currency`] = "Enter a three-letter currency code."; return null; }
    if (!Number.isFinite(amt) || amt <= 0) { errors[`${k}Amount`] = "Enter an amount greater than zero."; return null; }
    const minor = majorToMinor(amt, cur);
    if (minor === null) { errors[`${k}Currency`] = `${cur} is not a supported currency.`; return null; }
    if (minor <= 0) { errors[`${k}Amount`] = "The amount is smaller than the currency's smallest unit."; return null; }
    return { cur, minor };
  };

  const row: Record<string, unknown> = {
    kind, occurred_at: Number.isNaN(occurred.getTime()) ? null : occurred.toISOString(), cost_pool: pool,
    source_ref: sourceRef, note: String(input?.note ?? "").trim() || null,
    from_currency: null, from_amount_minor: null, to_currency: null, to_amount_minor: null, counterparty: null, voids_id: null,
  };
  if (kind === "opening_balance") {
    const t = money("to"); if (t) { row.to_currency = t.cur; row.to_amount_minor = t.minor; }
  } else if (kind === "conversion") {
    const f = money("from"); const t = money("to");
    if (f && t && f.cur === t.cur) errors.toCurrency = "A conversion needs two different currencies.";
    if (f) { row.from_currency = f.cur; row.from_amount_minor = f.minor; }
    if (t) { row.to_currency = t.cur; row.to_amount_minor = t.minor; }
  } else if (kind === "provider_payment") {
    const f = money("from"); if (f) { row.from_currency = f.cur; row.from_amount_minor = f.minor; }
    const cp = String(input?.counterparty ?? "").trim();
    if (cp.length < 2) errors.counterparty = "Name the provider paid, e.g. Anthropic.";
    row.counterparty = cp || null;
  } else if (kind === "void") {
    const v = String(input?.voidsId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(v)) errors.voidsId = "Choose the entry to void.";
    row.voids_id = v;
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, row };
}

export type LedgerSummary = {
  reserveUsd: number;
  entries: number;
  voided: number;
  actual: { ugxPerUsd: number; conversions: number } | null;
};

/** Pure: the USD reserve and the weighted UGX-per-USD actually paid in the window. Voided entries are excluded. */
export function summariseLedger(rows: FxEventRow[], now: Date, windowDays: number): LedgerSummary {
  const voidedIds = new Set(rows.filter(r => r.kind === "void" && r.voids_id).map(r => r.voids_id as string));
  const live = rows.filter(r => r.kind !== "void" && !voidedIds.has(r.id));
  const usd = (cur: string | null, minor: number | null) => (cur === RESERVE_CURRENCY && minor != null ? minorToMajor(minor, cur) ?? 0 : 0);
  let reserve = 0;
  for (const r of live) reserve += usd(r.to_currency, r.to_amount_minor) - usd(r.from_currency, r.from_amount_minor);

  const since = now.getTime() - windowDays * 86400000;
  const conv = live.filter(r => r.kind === "conversion" && r.from_currency === "UGX" && r.to_currency === RESERVE_CURRENCY && new Date(r.occurred_at).getTime() >= since);
  const ugx = conv.reduce((n, r) => n + (minorToMajor(r.from_amount_minor ?? 0, "UGX") ?? 0), 0);
  const bought = conv.reduce((n, r) => n + (minorToMajor(r.to_amount_minor ?? 0, RESERVE_CURRENCY) ?? 0), 0);
  return {
    reserveUsd: Math.round(reserve * 100) / 100,
    entries: live.length,
    voided: voidedIds.size,
    actual: conv.length && bought > 0 ? { ugxPerUsd: Math.round((ugx / bought) * 100) / 100, conversions: conv.length } : null,
  };
}

/** The ledger, newest first. Null when it cannot be read (for example before migration 560 is applied). */
export async function loadFxLedger(admin: any): Promise<FxEventRow[] | null> {
  const { data, error } = await admin.from("holdings_fx_event")
    .select("id, occurred_at, kind, cost_pool, from_currency, from_amount_minor, to_currency, to_amount_minor, counterparty, source_ref, note, voids_id, recorded_by, created_at")
    .order("occurred_at", { ascending: false }).limit(5000);
  return error ? null : ((data ?? []) as FxEventRow[]);
}

export async function recordFxEvent(admin: any, row: Record<string, unknown>, actorId: string): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> {
  if (row.kind === "void") {
    const { data: target } = await admin.from("holdings_fx_event").select("id, kind").eq("id", row.voids_id).maybeSingle();
    if (!target) return { ok: false, status: 404, message: "That entry does not exist." };
    if (target.kind === "void") return { ok: false, status: 409, message: "A void cannot itself be voided. Record the entry again instead." };
  }
  const { data, error } = await admin.from("holdings_fx_event").insert({ ...row, recorded_by: actorId }).select("id").single();
  if (error) {
    if (/duplicate|unique/i.test(error.message)) return { ok: false, status: 409, message: "That entry has already been voided." };
    if (/does not exist|schema cache/i.test(error.message)) return { ok: false, status: 503, message: "The reserve ledger is not available yet (migration 560)." };
    return { ok: false, status: 400, message: "The database refused the entry." };
  }
  return { ok: true, id: data.id };
}
