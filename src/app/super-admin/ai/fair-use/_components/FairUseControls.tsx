"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// The write half of /super-admin/ai/fair-use (AI-FAIR-USE-01 s12). Every control posts to /api/hq/ai-governance,
// which re-checks the capability and clamps every value. Nothing here can change a person's balance.

const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const primary = `${btn} bg-teal-700 text-white hover:bg-teal-800`;
const ghost = `${btn} border border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const input = "rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";

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

export function RateForm({ kind }: { kind: "price" | "fx" | "cau" }) {
  const [f, setF] = useState<Record<string, string>>({ provider: "anthropic" });
  const { busy, msg, send } = useSend();
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(s => ({ ...s, [k]: e.target.value }));
  return (
    <div className="flex flex-wrap items-end gap-2">
      {kind === "price" && <>
        <label className="text-[12.5px] text-gray-700">Provider<select value={f.provider} onChange={set("provider")} className={`${input} ml-1`}><option>anthropic</option><option>openai</option><option>gemini</option></select></label>
        <label className="text-[12.5px] text-gray-700">Model id or prefix<input value={f.modelPrefix ?? ""} onChange={set("modelPrefix")} className={`${input} ml-1 w-48`} /></label>
        <label className="text-[12.5px] text-gray-700">Input USD / M tokens<input inputMode="decimal" value={f.inputPerMtokUsd ?? ""} onChange={set("inputPerMtokUsd")} className={`${input} ml-1 w-24`} /></label>
        <label className="text-[12.5px] text-gray-700">Output USD / M tokens<input inputMode="decimal" value={f.outputPerMtokUsd ?? ""} onChange={set("outputPerMtokUsd")} className={`${input} ml-1 w-24`} /></label>
        <label className="text-[12.5px] text-gray-700">Extra USD / request<input inputMode="decimal" value={f.extraPerRequestUsd ?? ""} onChange={set("extraPerRequestUsd")} className={`${input} ml-1 w-24`} /></label>
      </>}
      {kind === "fx" && <>
        <label className="text-[12.5px] text-gray-700">Currency<input value={f.currency ?? ""} onChange={set("currency")} maxLength={3} className={`${input} ml-1 w-20`} /></label>
        <label className="text-[12.5px] text-gray-700">Units per USD<input inputMode="decimal" value={f.perUsd ?? ""} onChange={set("perUsd")} className={`${input} ml-1 w-28`} /></label>
      </>}
      {kind === "cau" && <label className="text-[12.5px] text-gray-700">USD per allowance unit<input inputMode="decimal" value={f.usdPerCau ?? ""} onChange={set("usdPerCau")} className={`${input} ml-1 w-28`} /></label>}
      <label className="text-[12.5px] text-gray-700">Source or reason<input value={f.note ?? ""} onChange={set("note")} maxLength={500} className={`${input} ml-1 w-56`} /></label>
      <button type="button" disabled={busy} className={primary} onClick={() => send({ action: "rate", kind, ...f }, "Saved. The previous rate is kept as history.")}>Save new rate</button>
      <Message msg={msg} />
    </div>
  );
}

type ActivityRow = { label: string; tier: string; minTier: string; maxOutputTokens: number; capPerPeriod: number | null; clinicallySensitive: boolean; class: string };
type PolicyForm = {
  includedCau: number; reserveCau: number; windowMinutes: number | null; windowCapCau: number | null;
  levels: { optimisedBelowPct: number; essentialBelowPct: number }; reset: { rule: string; cycleDays: number };
  messages: { full: string; optimised: string; essential: string; continuity: string };
  activities: Record<string, ActivityRow>;
};

export function PolicyEditor({ product, initial }: { product: string; initial: PolicyForm }) {
  const [p, setP] = useState<PolicyForm>(initial);
  const { busy, msg, send } = useSend();
  const n = (v: string) => (v === "" ? null : Number(v));
  const field = (label: string, value: number | null, on: (v: number | null) => void, hint?: string) => (
    <label className="block text-[12.5px] text-gray-700">{label}{hint && <span className="text-gray-500"> ({hint})</span>}
      <input inputMode="decimal" value={value ?? ""} onChange={e => on(n(e.target.value))} className={`${input} mt-0.5 block w-32`} />
    </label>
  );
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {field("Included allowance (CAU) per period", p.includedCau, v => setP({ ...p, includedCau: v ?? 0 }))}
        {field("Essential reserve (CAU), hard cap", p.reserveCau, v => setP({ ...p, reserveCau: v ?? 0 }))}
        <label className="block text-[12.5px] text-gray-700">Renewal
          <select value={p.reset.rule} onChange={e => setP({ ...p, reset: { ...p.reset, rule: e.target.value } })} className={`${input} mt-0.5 block`}>
            <option value="entitlement_cycle">Every cycle from the subscription start</option><option value="calendar_month">Calendar month</option>
          </select>
        </label>
        {field("Cycle length (days)", p.reset.cycleDays, v => setP({ ...p, reset: { ...p.reset, cycleDays: v ?? 30 } }))}
        {field("Rolling window (minutes)", p.windowMinutes, v => setP({ ...p, windowMinutes: v }), "blank = none")}
        {field("Rolling window cap (CAU)", p.windowCapCau, v => setP({ ...p, windowCapCau: v }), "blank = none")}
        {field("Efficient mode below (% remaining)", p.levels.optimisedBelowPct, v => setP({ ...p, levels: { ...p.levels, optimisedBelowPct: v ?? 0 } }))}
        {field("Essential only below (% remaining)", p.levels.essentialBelowPct, v => setP({ ...p, levels: { ...p.levels, essentialBelowPct: v ?? 0 } }))}
      </div>
      <table className="w-full text-left text-[13px]">
        <caption className="sr-only">Activities</caption>
        <thead><tr className="border-b border-gray-200 text-[11.5px] uppercase tracking-[0.08em] text-gray-500">
          <th scope="col" className="py-1.5">Activity</th><th scope="col">Model tier</th><th scope="col">Max output tokens</th><th scope="col">Per period</th></tr></thead>
        <tbody>
          {Object.entries(p.activities).map(([code, a]) => (
            <tr key={code} className="border-b border-gray-100">
              <th scope="row" className="py-1.5 font-normal text-gray-900">{a.label}{a.class === "essential" ? " (essential)" : ""}{a.clinicallySensitive ? " · clinically sensitive" : ""}</th>
              <td><select aria-label={`${a.label} tier`} value={a.tier} onChange={e => setP({ ...p, activities: { ...p.activities, [code]: { ...a, tier: e.target.value } } })} className={input}>
                {["cheap", "reasoning", "heavy"].map(t => <option key={t} value={t}>{t}</option>)}</select></td>
              <td><input aria-label={`${a.label} max output tokens`} inputMode="numeric" value={a.maxOutputTokens} onChange={e => setP({ ...p, activities: { ...p.activities, [code]: { ...a, maxOutputTokens: Number(e.target.value) || 0 } } })} className={`${input} w-24`} /></td>
              <td><input aria-label={`${a.label} per period`} inputMode="numeric" value={a.capPerPeriod ?? ""} placeholder="no cap" onChange={e => setP({ ...p, activities: { ...p.activities, [code]: { ...a, capPerPeriod: n(e.target.value) } } })} className={`${input} w-24`} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-2">
        {(["full", "optimised", "essential", "continuity"] as const).map(k => (
          <label key={k} className="block text-[12.5px] text-gray-700">Message shown at the {k} level
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
