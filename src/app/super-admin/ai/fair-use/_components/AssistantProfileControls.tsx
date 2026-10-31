"use client";

import { useState } from "react";
import { input, Message, primary, useSend } from "./FairUseControls";

// "Personal AI profiles" on /super-admin/ai/fair-use. One card per product. Posts { action: "assistant_profile" } to
// /api/hq/ai-governance (hq.platform.ai.manage), which validates the draft strictly against the product's AUTHORISED
// scopes and modes and stores it through CONFIG-002. Publishing is the page's existing Publish button.
// ⚠ The lists shown are the product's AUTHORISED ones, passed from the server: this form can only narrow, never widen.

export type ProfileOption = { code: string; label: string; description?: string };
export type ProfileDoc = { defaultMode: string; modes: string[]; scopes: string[] };

export function AssistantProfileEditor({ product, scopes, modes, initial }: { product: string; scopes: ProfileOption[]; modes: ProfileOption[]; initial: ProfileDoc }) {
  const [d, setD] = useState<ProfileDoc>(initial);
  const { busy, msg, send } = useSend();
  const toggle = (k: "modes" | "scopes", code: string, on: boolean) =>
    setD(x => {
      const next = on ? [...x[k], code] : x[k].filter(c => c !== code);
      const nm = k === "modes" ? next : x.modes;
      return { ...x, [k]: next, defaultMode: nm.includes(x.defaultMode) ? x.defaultMode : (modes.find(m => nm.includes(m.code))?.code ?? x.defaultMode) };
    });
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1">
        <legend className="text-[12.5px] font-semibold text-gray-800">Data it may read</legend>
        {scopes.map(s => (
          <label key={s.code} className="flex items-start gap-2 text-[13px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="checkbox" className="mt-0.5" checked={d.scopes.includes(s.code)} onChange={e => toggle("scopes", s.code, e.target.checked)} />
            <span><strong className="font-semibold">{s.label}</strong> <span className="font-mono text-[11.5px] text-gray-500">{s.code}</span><span className="block text-[12.5px] text-gray-600">{s.description}</span></span>
          </label>
        ))}
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <legend className="mb-1 text-[12.5px] font-semibold text-gray-800">Modes it offers</legend>
        {modes.map(m => (
          <label key={m.code} className="inline-flex items-center gap-1 text-[13px] text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)]">
            <input type="checkbox" checked={d.modes.includes(m.code)} onChange={e => toggle("modes", m.code, e.target.checked)} />{m.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-[12.5px] text-gray-700">Opens in
        <select value={d.defaultMode} onChange={e => setD(x => ({ ...x, defaultMode: e.target.value }))} className={`${input} ml-1`}>
          {modes.filter(m => d.modes.includes(m.code)).map(m => <option key={m.code} value={m.code}>{m.label}</option>)}
        </select>
      </label>
      {d.modes.length === 0 && <p className="text-[12.5px] text-amber-900">Offer at least one mode.</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || d.modes.length === 0} className={primary} onClick={() => send({ action: "assistant_profile", product, profile: d }, "Draft saved. Publish to make it effective.")}>Save {product} draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}
