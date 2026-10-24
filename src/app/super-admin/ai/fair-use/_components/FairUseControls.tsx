"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/ai/fair-use (AI-FAIR-USE-01 s12). Every control posts to /api/hq/ai-governance,
// which re-checks the capability and clamps every value. Nothing here can change a person's balance.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const TIERS = ["cheap", "reasoning", "heavy"] as const;

function useSend() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(body: Record<string, unknown>, done: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/ai-governance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "That could not be saved. Nothing has changed." }); return; }
      setMsg({ ok: true, text: done });
      router.refresh();
    } catch { setMsg({ ok: false, text: "That could not be saved. Check your connection." }); } finally { setBusy(false); }
  }
  return { busy, msg, send };
}
function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <p role={msg.ok ? "status" : "alert"} className={`text-[12.5px] ${msg.ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>{msg.text}</p>;
}

export function RateForm({ kind }: { kind: "price" | "fx" | "basis" | "eligibility" }) {
  const [f, setF] = useState<Record<string, string>>({ provider: "anthropic", sourceKind: "list", product: "scholar", eligible: "false", currency: "UGX" });
  const { busy, msg, send } = useSend();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  const provider = <label className="text-[12.5px] text-gray-700">Provider<select value={f.provider} onChange={set("provider")} className={`${input} ml-1`}><option>anthropic</option><option>openai</option><option>gemini</option></select></label>;
  const model = <label className="text-[12.5px] text-gray-700">Model id or prefix<input value={f.modelPrefix ?? ""} onChange={set("modelPrefix")} className={`${input} ml-1 w-48`} /></label>;
  return (
    <div className="flex flex-wrap items-end gap-2">
      {kind === "price" && <>
        {provider}{model}
        <label className="text-[12.5px] text-gray-700">Input USD / M tokens<input inputMode="decimal" value={f.inputPerMtokUsd ?? ""} onChange={set("inputPerMtokUsd")} className={`${input} ml-1 w-24`} /></label>
        <label className="text-[12.5px] text-gray-700">Output USD / M tokens<input inputMode="decimal" value={f.outputPerMtokUsd ?? ""} onChange={set("outputPerMtokUsd")} className={`${input} ml-1 w-24`} /></label>
        <label className="text-[12.5px] text-gray-700">Other charges USD / request<input inputMode="decimal" value={f.extraPerRequestUsd ?? ""} onChange={set("extraPerRequestUsd")} className={`${input} ml-1 w-24`} /></label>
        <label className="text-[12.5px] text-gray-700">Price<select value={f.sourceKind} onChange={set("sourceKind")} className={`${input} ml-1`}><option value="list">List price</option><option value="negotiated">Negotiated rate</option></select></label>
        <label className="text-[12.5px] text-gray-700">Source (URL or agreement)<input value={f.sourceRef ?? ""} onChange={set("sourceRef")} maxLength={500} className={`${input} ml-1 w-64`} /></label>
        <label className="text-[12.5px] text-gray-700">Pricing version<input value={f.priceVersion ?? ""} onChange={set("priceVersion")} maxLength={80} className={`${input} ml-1 w-32`} /></label>
      </>}
      {kind === "fx" && <>
        <label className="text-[12.5px] text-gray-700">Currency<input value={f.currency ?? ""} onChange={set("currency")} maxLength={3} className={`${input} ml-1 w-20`} /></label>
        <label className="text-[12.5px] text-gray-700">Reference rate, units per USD<input inputMode="decimal" value={f.perUsd ?? ""} onChange={set("perUsd")} className={`${input} ml-1 w-28`} /></label>
      </>}
      {kind === "basis" && <>
        <label className="text-[12.5px] text-gray-700">Currency<input value={f.currency ?? ""} onChange={set("currency")} maxLength={3} className={`${input} ml-1 w-20`} /></label>
        <label className="text-[12.5px] text-gray-700">One allowance unit is worth<input inputMode="decimal" value={f.currencyPerCau ?? ""} onChange={set("currencyPerCau")} className={`${input} ml-1 w-24`} /></label>
      </>}
      {kind === "eligibility" && <>
        <label className="text-[12.5px] text-gray-700">Product<select value={f.product} onChange={set("product")} className={`${input} ml-1`}><option>scholar</option><option>professional</option></select></label>
        <label className="text-[12.5px] text-gray-700">Activity code<input value={f.activity ?? ""} onChange={set("activity")} maxLength={41} className={`${input} ml-1 w-32`} /></label>
        {provider}{model}
        <label className="text-[12.5px] text-gray-700">Decision<select value={f.eligible} onChange={set("eligible")} className={`${input} ml-1`}><option value="false">Not eligible</option><option value="true">Eligible</option></select></label>
        <label className="text-[12.5px] text-gray-700">Evaluation evidence<input value={f.evidenceRef ?? ""} onChange={set("evidenceRef")} maxLength={500} className={`${input} ml-1 w-64`} /></label>
      </>}
      <label className="text-[12.5px] text-gray-700">{kind === "fx" ? "Source (for example the Bank of Uganda reference rate and month)" : "Note"}<input value={f.note ?? ""} onChange={set("note")} maxLength={500} className={`${input} ml-1 w-56`} /></label>
      <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "rate", kind, ...f }, "Saved. The previous record is kept as history.")}>
        {kind === "eligibility" ? "Record decision" : "Save new rate"}
      </button>
      <Message msg={msg} />
    </div>
  );
}

type ActivityRow = { label: string; class: "essential" | "standard"; tier: string; minTier: string; maxOutputTokens: number; capPerPeriod: number | null; clinicallySensitive: boolean; reserveEligible: boolean };
type PolicyForm = {
  includedCau: number; reserveCau: number; windowMinutes: number | null; windowCapCau: number | null;
  levels: { optimisedBelowPct: number; essentialBelowPct: number }; reset: { rule: string; cycleDays: number };
  currency: string; fxBufferPct: number; maxUnreconciledCau: number;
  messages: { full: string; optimised: string; essential: string; continuity: string; levelInsufficient: string };
  activities: Record<string, ActivityRow>;
};
const CODE = /^[a-z][a-z0-9_]{1,40}$/;

export function PolicyEditor({ product, initial }: { product: string; initial: PolicyForm }) {
  const [p, setP] = useState<PolicyForm>(initial);
  const [newCode, setNewCode] = useState("");
  const { busy, msg, send } = useSend();
  const n = (v: string) => (v === "" ? null : Number(v));
  const field = (label: string, value: number | null, on: (v: number | null) => void, hint?: string) => (
    <label className="block text-[12.5px] text-gray-700">{label}{hint && <span className="text-gray-500"> ({hint})</span>}
      <input inputMode="decimal" value={value ?? ""} onChange={e => on(n(e.target.value))} className={`${input} mt-0.5 block w-32`} />
    </label>
  );
  const setA = (code: string, a: ActivityRow) => setP({ ...p, activities: { ...p.activities, [code]: a } });
  const remove = (code: string) => { const rest = { ...p.activities }; delete rest[code]; setP({ ...p, activities: rest }); };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {field("Included allowance (CAU) per period", p.includedCau, v => setP({ ...p, includedCau: v ?? 0 }))}
        {field("Essential reserve (CAU), hard cap", p.reserveCau, v => setP({ ...p, reserveCau: v ?? 0 }))}
        <label className="block text-[12.5px] text-gray-700">Renewal
          <select value={p.reset.rule} onChange={e => setP({ ...p, reset: { ...p.reset, rule: e.target.value } })} className={`${input} mt-0.5 block`}>
            <option value="subscription_anniversary">Monthly, on the subscription anniversary</option>
            <option value="calendar_month">Calendar month</option>
            <option value="entitlement_cycle">Every fixed cycle from the subscription start</option>
          </select>
        </label>
        {p.reset.rule === "entitlement_cycle" && field("Cycle length (days)", p.reset.cycleDays, v => setP({ ...p, reset: { ...p.reset, cycleDays: v ?? 30 } }))}
        {field("Rolling window (minutes)", p.windowMinutes, v => setP({ ...p, windowMinutes: v }), "blank = none")}
        {field("Rolling window cap (CAU)", p.windowCapCau, v => setP({ ...p, windowCapCau: v }), "blank = none")}
        {field("Efficient mode below (% remaining)", p.levels.optimisedBelowPct, v => setP({ ...p, levels: { ...p.levels, optimisedBelowPct: v ?? 0 } }))}
        {field("Essential only below (% remaining)", p.levels.essentialBelowPct, v => setP({ ...p, levels: { ...p.levels, essentialBelowPct: v ?? 0 } }))}
        {field("Exchange-rate buffer on holds (%)", p.fxBufferPct, v => setP({ ...p, fxBufferPct: v ?? 0 }), "holds only, never the charge")}
        {field("Awaiting-reconciliation ceiling (CAU)", p.maxUnreconciledCau, v => setP({ ...p, maxUnreconciledCau: v ?? 0 }), "per person")}
        <label className="block text-[12.5px] text-gray-700">Allowance currency
          <input value={p.currency} maxLength={3} onChange={e => setP({ ...p, currency: e.target.value.toUpperCase() })} className={`${input} mt-0.5 block w-20`} />
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-[13px]">
          <caption className="sr-only">Activities</caption>
          <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500">
            <th scope="col" className="py-1.5">Activity</th><th scope="col">Class</th><th scope="col">Tier</th><th scope="col">Lowest tier</th><th scope="col">Max output</th><th scope="col">Per period</th><th scope="col">Clinical</th><th scope="col">Reserve</th><th scope="col"><span className="sr-only">Remove</span></th></tr></thead>
          <tbody>
            {Object.entries(p.activities).map(([code, a]) => (
              <tr key={code} className="border-b border-gray-100 align-top">
                <th scope="row" className="py-1.5 font-normal text-gray-900">
                  <input aria-label={`${code} label`} value={a.label} maxLength={300} onChange={e => setA(code, { ...a, label: e.target.value })} className={`${input} w-48`} />
                  <span className="block font-mono text-[11.5px] text-gray-500">{code}</span>
                </th>
                <td><select aria-label={`${code} class`} value={a.class} onChange={e => setA(code, { ...a, class: e.target.value as ActivityRow["class"], reserveEligible: e.target.value === "essential" && a.reserveEligible })} className={input}>
                  <option value="standard">standard</option><option value="essential">essential</option></select></td>
                <td><select aria-label={`${code} tier`} value={a.tier} onChange={e => setA(code, { ...a, tier: e.target.value })} className={input}>
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
                <td><select aria-label={`${code} lowest tier`} value={a.minTier} onChange={e => setA(code, { ...a, minTier: e.target.value })} className={input}>
                  {TIERS.map(t => <option key={t} value={t}>{t}</option>)}</select></td>
                <td><input aria-label={`${code} max output tokens`} inputMode="numeric" value={a.maxOutputTokens} onChange={e => setA(code, { ...a, maxOutputTokens: Number(e.target.value) || 0 })} className={`${input} w-20`} /></td>
                <td><input aria-label={`${code} per period`} inputMode="numeric" value={a.capPerPeriod ?? ""} placeholder="no cap" onChange={e => setA(code, { ...a, capPerPeriod: n(e.target.value) })} className={`${input} w-20`} /></td>
                <td><input type="checkbox" aria-label={`${code} clinically sensitive`} checked={a.clinicallySensitive} onChange={e => setA(code, { ...a, clinicallySensitive: e.target.checked })} className="h-4 w-4 pointer-coarse:h-6 pointer-coarse:w-6" /></td>
                <td><input type="checkbox" aria-label={`${code} may use the reserve`} disabled={a.class !== "essential"} checked={a.reserveEligible} onChange={e => setA(code, { ...a, reserveEligible: e.target.checked })} className="h-4 w-4 pointer-coarse:h-6 pointer-coarse:w-6" /></td>
                <td><button type="button" className={ghost} onClick={() => remove(code)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {Object.keys(p.activities).length === 0 && <p className="py-2 text-[13px] text-amber-900">No activities: nothing can be requested under this policy.</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px] text-gray-700">New activity code
          <input value={newCode} maxLength={41} onChange={e => setNewCode(e.target.value.trim())} className={`${input} ml-1 w-40 font-mono`} />
        </label>
        <button type="button" className={ghost} disabled={!CODE.test(newCode) || newCode in p.activities} onClick={() => {
          // A new activity starts sensitive, at its own tier: it is made cheaper or non-clinical deliberately, never by default.
          setA(newCode, { label: newCode, class: "standard", tier: "reasoning", minTier: "reasoning", maxOutputTokens: 800, capPerPeriod: null, clinicallySensitive: true, reserveEligible: false });
          setNewCode("");
        }}>Add activity</button>
      </div>
      <div className="grid gap-2">
        {(["full", "optimised", "essential", "continuity", "levelInsufficient"] as const).map(k => (
          <label key={k} className="block text-[12.5px] text-gray-700">{k === "levelInsufficient" ? "Message when a level cannot serve an activity" : `Message shown at the ${k} level`}
            <input value={p.messages[k]} maxLength={300} onChange={e => setP({ ...p, messages: { ...p.messages, [k]: e.target.value } })} className={`${input} mt-0.5 block w-full`} />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "policy", product, settings: p }, "Draft saved. Publish to make it effective.")}>Save {product} draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

export function PublishPolicies({ pending }: { pending: number }) {
  const [note, setNote] = useState("");
  const { busy, msg, send } = useSend();
  return (
    <div className="space-y-2">
      <label htmlFor="fu-note" className="block text-[12.5px] font-semibold text-gray-700">Why this change (recorded with the version)</label>
      <textarea id="fu-note" rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} className="w-full rounded-lg border border-gray-300 px-2.5 py-1.5 text-[14px]" />
      <button type="button" className={primary} disabled={busy || pending === 0} onClick={() => send({ action: "publish", note }, "Published. New allowance periods use it.")}>
        {pending === 0 ? "Nothing to publish" : `Publish ${pending} policy change${pending === 1 ? "" : "s"}`}
      </button>
      <Message msg={msg} />
    </div>
  );
}
