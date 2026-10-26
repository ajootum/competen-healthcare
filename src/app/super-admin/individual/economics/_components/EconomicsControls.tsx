"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState } from "react";
import { useRouter } from "next/navigation";

// HOLDINGS-FX-01 controls. Field-level validation as the person types, the server's validation as the final
// word, and a clear result line after every save. Nothing here moves money or changes a price.

const API = "/api/hq/holdings/economics";
const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-[14px] focus:border-teal-600 focus:outline-none focus:ring-2 focus:ring-teal-600/30 pointer-coarse:min-h-11";
const btn = "rounded-lg px-4 py-2 text-[14px] font-semibold disabled:opacity-50 pointer-coarse:min-h-11";

async function post(body: unknown) {
  const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, fields: j?.error?.fields as Record<string, string> | undefined, message: j?.error?.message as string | undefined };
}

function Field({ id, label, hint, value, onChange, error, inputMode = "decimal", type = "text" }: {
  id: string; label: string; hint?: string; value: string; onChange: (v: string) => void; error?: string; inputMode?: "decimal" | "numeric" | "text"; type?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-[12.5px] font-semibold text-gray-700">{label}</label>
      <input id={id} type={type} inputMode={inputMode} value={value} onChange={e => onChange(e.target.value)}
        aria-invalid={!!error} aria-describedby={`${id}-hint${error ? ` ${id}-err` : ""}`}
        className={`${input} ${error ? "border-[var(--cmp-color-error)]" : ""}`} />
      {hint && <p id={`${id}-hint`} className="mt-0.5 text-[11.5px] text-gray-500">{hint}</p>}
      {error && <p id={`${id}-err`} role="alert" className="mt-0.5 text-[12px] font-semibold text-[var(--cmp-text-critical)]">{error}</p>}
    </div>
  );
}

type Spec = { key: string; label: string; hint: string; min: number; max: number; optional?: boolean; whole?: boolean };
const SPECS: Spec[] = [
  { key: "planningUgxPerUsd", label: "Planning rate (UGX per USD)", hint: "Your budget rate. Leave empty if none.", min: 1, max: 1_000_000, optional: true },
  { key: "marginFloorPct", label: "Contribution margin floor (%)", hint: "Below this is an exception.", min: -100, max: 100 },
  { key: "pricingReviewFxMovePct", label: "Pricing review trigger (% FX move)", hint: "Reference vs planning rate.", min: 0.1, max: 100 },
  { key: "reserveTargetMonths", label: "USD reserve target (months)", hint: "Months of provider cost to hold.", min: 0, max: 36 },
  { key: "providerBudgetUsdMonthly", label: "Provider cost budget (USD per month)", hint: "Leave empty for no budget.", min: 0, max: 10_000_000, optional: true },
  { key: "otherVariableCostUgxMonthly", label: "Other variable cost (UGX per subscriber per month)", hint: "Hosting, support, messaging.", min: 0, max: 100_000_000 },
  { key: "staleRateDays", label: "Reference rate stale after (days)", hint: "", min: 1, max: 366, whole: true },
  { key: "measurementWindowDays", label: "Measurement window (days)", hint: "For collections and consumption.", min: 7, max: 365, whole: true },
  { key: "executedRateWindowDays", label: "Actual rate window (days)", hint: "For the weighted conversion rate.", min: 7, max: 730, whole: true },
  { key: "outlierMultiple", label: "Consumption outlier (× median)", hint: "Flags only. Never restricts.", min: 1.5, max: 100 },
  { key: "outlierMinUsers", label: "Outlier test minimum users", hint: "", min: 2, max: 10_000, whole: true },
];
const ASSUMED: Spec[] = [
  { key: "priceUgxMonthly", label: "Assumed price (UGX per month)", hint: "Used only while no plan is active.", min: 1, max: 100_000_000, optional: true },
  { key: "gatewayFeePct", label: "Assumed gateway fee (%)", hint: "Used only until fees are recorded.", min: 0, max: 50 },
  { key: "aiCostUsdPerUserMonthly", label: "Assumed AI cost (USD per user per month)", hint: "Used only while nothing is measured.", min: 0, max: 10_000, optional: true },
];

function check(s: Spec, v: string): string | undefined {
  if (v.trim() === "") return s.optional ? undefined : "Required.";
  const n = Number(v);
  if (!Number.isFinite(n)) return "Enter a number.";
  if (n < s.min || n > s.max) return `Enter a number from ${s.min} to ${s.max}.`;
  if (s.whole && !Number.isInteger(n)) return "Enter a whole number.";
  return undefined;
}

export function PolicyForm({ initial, defaults, canPublish }: { initial: any; defaults: any; canPublish: boolean }) {
  const router = useRouter();
  const src = initial ?? defaults;
  const str = (v: any) => (v == null ? "" : String(v));
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries([
    ...SPECS.map(s => [s.key, str(src?.[s.key])]), ...ASSUMED.map(s => [`assumed.${s.key}`, str(src?.assumed?.[s.key])]),
    ["shocksPct", (src?.shocksPct ?? [10, 15, 25]).join(", ")],
  ]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [note, setNote] = useState("");

  const set = (k: string, s: Spec | null) => (v: string) => {
    setVals(p => ({ ...p, [k]: v }));
    const err = s ? check(s, v) : v.split(/[,\s]+/).filter(Boolean).every(x => Number(x) > 0 && Number(x) <= 100) && v.trim() ? undefined : "List percentages from 1 to 100, e.g. 10, 15, 25.";
    setErrors(p => { const n = { ...p }; if (err) n[k] = err; else delete n[k]; return n; });
  };

  async function save() {
    setBusy(true); setMsg(null);
    const settings: any = { shocksPct: vals.shocksPct, assumed: {} };
    for (const s of SPECS) settings[s.key] = vals[s.key];
    for (const s of ASSUMED) settings.assumed[s.key] = vals[`assumed.${s.key}`];
    const r = await post({ action: "save_policy", settings });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Draft saved. Publish it for it to take effect." }); router.refresh(); }
    else { if (r.fields) setErrors(r.fields); setMsg({ ok: false, text: r.message ?? "The draft could not be saved." }); }
  }
  async function publish() {
    setBusy(true); setMsg(null);
    const r = await post({ action: "publish", note });
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: "Published. The page now uses this version." } : { ok: false, text: r.message ?? "Not published." });
    if (r.ok) router.refresh();
  }
  const invalid = Object.keys(errors).length > 0;

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field id="shocksPct" label="Depreciation scenarios (%)" hint="Comma-separated, e.g. 10, 15, 25." value={vals.shocksPct} onChange={set("shocksPct", null)} error={errors.shocksPct} inputMode="text" />
        {SPECS.map(s => <Field key={s.key} id={s.key} label={s.label} hint={s.hint} value={vals[s.key]} onChange={set(s.key, s)} error={errors[s.key]} inputMode={s.whole ? "numeric" : "decimal"} />)}
      </div>
      <fieldset className="grid gap-3 md:grid-cols-3">
        <legend className="mb-1 text-[12.5px] font-bold text-gray-700">Assumptions (labelled on the page wherever used)</legend>
        {ASSUMED.map(s => <Field key={s.key} id={`assumed-${s.key}`} label={s.label} hint={s.hint} value={vals[`assumed.${s.key}`]} onChange={set(`assumed.${s.key}`, s)} error={errors[`assumed.${s.key}`]} />)}
      </fieldset>
      <div className="flex flex-wrap items-end gap-3">
        <button type="button" onClick={save} disabled={busy || invalid} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>Save draft</button>
        <div className="flex flex-1 flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <label htmlFor="pub-note" className="text-[12.5px] font-semibold text-gray-700">Publication note (optional)</label>
            <input id="pub-note" value={note} onChange={e => setNote(e.target.value)} className={input} />
          </div>
          <button type="button" onClick={publish} disabled={busy || !canPublish} className={`${btn} border border-teal-700 text-teal-800 hover:bg-teal-50`}>Publish</button>
        </div>
      </div>
      {msg && <p role="status" className={`text-[13px] font-semibold ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
    </div>
  );
}

const KINDS = [
  { value: "conversion", label: "Conversion (e.g. UGX sold, USD bought)" },
  { value: "provider_payment", label: "Provider payment from the reserve" },
  { value: "opening_balance", label: "Opening USD balance" },
  { value: "void", label: "Void an earlier entry" },
];

export function LedgerEntryForm({ entries }: { entries: { id: string; label: string }[] }) {
  const router = useRouter();
  const [kind, setKind] = useState("conversion");
  const [f, setF] = useState<Record<string, string>>({ occurredAt: new Date().toISOString().slice(0, 10), fromCurrency: "UGX", toCurrency: "USD", costPool: "scholar" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: string) => (v: string) => { setF(p => ({ ...p, [k]: v })); setErrors(p => { const n = { ...p }; delete n[k]; return n; }); };

  const rateHint = kind === "conversion" && Number(f.fromAmount) > 0 && Number(f.toAmount) > 0
    ? `Executed rate: ${(Number(f.fromAmount) / Number(f.toAmount)).toLocaleString("en-UG", { maximumFractionDigits: 2 })} ${f.fromCurrency || "?"} per ${f.toCurrency || "?"}` : undefined;

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await post({ action: "record_event", event: { kind, ...f } });
    setBusy(false);
    if (r.ok) { setMsg({ ok: true, text: "Recorded. The reserve and the actual rate are updated." }); setF(p => ({ ...p, fromAmount: "", toAmount: "", sourceRef: "", note: "", voidsId: "" })); router.refresh(); }
    else { if (r.fields) setErrors(r.fields); setMsg({ ok: false, text: r.message ?? "Not recorded." }); }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
      <h3 className="text-[15px] font-bold text-gray-900">Record from the bank statement</h3>
      <p className="text-[12.5px] text-gray-600">This records what already happened. It does not buy or move currency. Entries cannot be edited: void a mistake and record it again.</p>
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="fx-kind" className="text-[12.5px] font-semibold text-gray-700">What happened</label>
          <select id="fx-kind" value={kind} onChange={e => { setKind(e.target.value); setErrors({}); }} className={input}>
            {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </div>
        <Field id="fx-date" label="Date on the statement" type="date" value={f.occurredAt ?? ""} onChange={set("occurredAt")} error={errors.occurredAt} inputMode="text" />
        <Field id="fx-ref" label="Bank or invoice reference" value={f.sourceRef ?? ""} onChange={set("sourceRef")} error={errors.sourceRef} inputMode="text" />
        {(kind === "conversion" || kind === "provider_payment") && <>
          <Field id="fx-fc" label={kind === "conversion" ? "Currency sold" : "Currency paid"} value={f.fromCurrency ?? ""} onChange={set("fromCurrency")} error={errors.fromCurrency} inputMode="text" />
          <Field id="fx-fa" label={kind === "conversion" ? "Amount sold" : "Amount paid"} value={f.fromAmount ?? ""} onChange={set("fromAmount")} error={errors.fromAmount} />
        </>}
        {(kind === "conversion" || kind === "opening_balance") && <>
          <Field id="fx-tc" label={kind === "conversion" ? "Currency bought" : "Currency held"} value={f.toCurrency ?? ""} onChange={set("toCurrency")} error={errors.toCurrency} inputMode="text" />
          <Field id="fx-ta" label={kind === "conversion" ? "Amount bought" : "Balance"} hint={rateHint} value={f.toAmount ?? ""} onChange={set("toAmount")} error={errors.toAmount} />
        </>}
        {kind === "provider_payment" && <Field id="fx-cp" label="Provider" hint="e.g. Anthropic" value={f.counterparty ?? ""} onChange={set("counterparty")} error={errors.counterparty} inputMode="text" />}
        {kind === "void" && (
          <div className="md:col-span-2">
            <label htmlFor="fx-void" className="text-[12.5px] font-semibold text-gray-700">Entry to void</label>
            <select id="fx-void" value={f.voidsId ?? ""} onChange={e => set("voidsId")(e.target.value)} aria-invalid={!!errors.voidsId} className={input}>
              <option value="">Choose…</option>
              {entries.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
            {errors.voidsId && <p role="alert" className="mt-0.5 text-[12px] font-semibold text-[var(--cmp-text-critical)]">{errors.voidsId}</p>}
          </div>)}
        {kind !== "void" && (
          <div>
            <label htmlFor="fx-pool" className="text-[12.5px] font-semibold text-gray-700">Cost pool</label>
            <select id="fx-pool" value={f.costPool} onChange={e => set("costPool")(e.target.value)} className={input}>
              <option value="scholar">Scholar</option><option value="professional">Professional</option><option value="shared">Shared</option>
            </select>
          </div>)}
        <div className="md:col-span-3"><Field id="fx-note" label="Note (optional)" value={f.note ?? ""} onChange={set("note")} inputMode="text" /></div>
      </div>
      <button type="button" onClick={submit} disabled={busy} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`}>Record entry</button>
      {msg && <p role="status" className={`text-[13px] font-semibold ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>}
    </div>
  );
}
