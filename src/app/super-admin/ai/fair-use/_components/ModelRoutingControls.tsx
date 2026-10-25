"use client";

import { useState } from "react";
import { Message, ghost, input, useSend } from "./FairUseControls";

// Providers and model routing (owner MULTI-PROVIDER AI DIRECTION). It posts { action: "model_routing", settings } to
// /api/hq/ai-governance, which re-checks hq.platform.ai.manage, keeps only the known fields (model-routing.ts), and
// audits. A draft changes nothing until it is published with the other AI policies.
//
// ⚠ NO CREDENTIALS HERE. A provider's key is set in the deployment environment by the owner. This page shows only
// whether one is present, never the key, and the document cannot store one.

type Provider = "anthropic" | "openai" | "gemini";
type Tier = "cheap" | "reasoning" | "heavy";
type Routing = {
  providers: Record<Provider, { enabled: boolean; models: Partial<Record<Tier, string>> }>;
  tiers: Record<Tier, string[]>;
  activities: Record<string, { provider: Provider; model: string }[]>;
};
const PROVIDERS: { code: Provider; label: string }[] = [{ code: "anthropic", label: "Anthropic (Claude)" }, { code: "openai", label: "OpenAI (GPT)" }, { code: "gemini", label: "Google Gemini" }];
const TIERS: { code: Tier; label: string }[] = [{ code: "cheap", label: "Light" }, { code: "reasoning", label: "Reasoning" }, { code: "heavy", label: "Most capable" }];

const activitiesText = (a: Routing["activities"]) => Object.entries(a).map(([k, rs]) => `${k} = ${rs.map(r => `${r.provider}:${r.model}`).join(", ")}`).join("\n");
const parseActivities = (t: string): Routing["activities"] => Object.fromEntries(t.split("\n").map(l => l.trim()).filter(Boolean).map(l => {
  const [k, rest = ""] = l.split("=").map(x => x.trim());
  return [k, rest.split(",").map(x => x.trim()).filter(Boolean).map(x => { const i = x.indexOf(":"); return { provider: x.slice(0, i) as Provider, model: x.slice(i + 1) }; })];
}));

export function ModelRoutingEditor({ initial, keyed, primary, registered = [] }: { initial: Routing; keyed: Record<Provider, boolean>; primary: { provider: string | null; models: Record<Tier, string> | null }; registered?: { id: string; label: string }[] }) {
  const [r, setR] = useState<Routing>(initial);
  const [acts, setActs] = useState(activitiesText(initial.activities));
  const { busy, msg, send } = useSend();
  const setProvider = (p: Provider, f: (x: Routing["providers"][Provider]) => Routing["providers"][Provider]) => setR({ ...r, providers: { ...r.providers, [p]: f(r.providers[p]) } });
  const setOrder = (t: Tier, i: number, p: string) => {
    const next = [...r.tiers[t]]; if (p) next[i] = p; else next.splice(i, 1);
    setR({ ...r, tiers: { ...r.tiers, [t]: [...new Set(next.filter(Boolean))] } });
  };
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-gray-600">
        Unpublished, every request runs on this deployment&apos;s primary provider ({primary.provider ?? "none"}) with its models, as today.
        Once published, these choices decide. Clinical requests only ever run on a model with a recorded eligibility decision for that
        activity and risk tier. An alternative is used only when it is itself eligible, and nothing falls back to an unapproved model.
      </p>

      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="text-[13px] font-semibold text-gray-800">Providers and their models</legend>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-gray-600"><th scope="col" className="py-1">Provider</th><th scope="col">Enabled</th><th scope="col">Key in the deployment</th>{TIERS.map(t => <th key={t.code} scope="col">{t.label} model</th>)}</tr></thead>
            <tbody>
              {PROVIDERS.map(p => (
                <tr key={p.code} className="border-t border-gray-100">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">{p.label}</th>
                  <td><input type="checkbox" aria-label={`${p.label} enabled`} checked={r.providers[p.code].enabled} onChange={e => setProvider(p.code, x => ({ ...x, enabled: e.target.checked }))} /></td>
                  <td>{keyed[p.code] ? <span className="text-[var(--cmp-text-success)]">present</span> : <span className="text-amber-900">none: not available until the owner sets it</span>}</td>
                  {TIERS.map(t => (
                    <td key={t.code} className="pr-1">
                      <input aria-label={`${p.label} ${t.label} model`} className={`${input} w-40`} value={r.providers[p.code].models[t.code] ?? ""} placeholder={p.code === primary.provider ? primary.models?.[t.code] ?? "" : ""}
                        onChange={e => setProvider(p.code, x => ({ ...x, models: { ...x.models, [t.code]: e.target.value.trim() || undefined } }))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-gray-200 p-3">
        <legend className="text-[13px] font-semibold text-gray-800">For each tier: the primary provider, then the alternatives</legend>
        <ul className="space-y-1">
          {TIERS.map(t => (
            <li key={t.code} className="flex flex-wrap items-center gap-2 text-[13px]">
              <span className="w-28">{t.label}</span>
              {[0, 1, 2].map(i => (
                <select key={i} aria-label={`${t.label} choice ${i + 1}`} className={input} value={r.tiers[t.code][i] ?? ""} onChange={e => setOrder(t.code, i, e.target.value)}>
                  <option value="">{i === 0 ? "No primary" : "No alternative"}</option>
                  {PROVIDERS.map(p => <option key={p.code} value={p.code}>{p.label}</option>)}
                  {registered.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                </select>
              ))}
            </li>
          ))}
        </ul>
      </fieldset>

      <label className="block text-[13px] text-gray-800">
        <span className="font-semibold">Per-activity primary and alternatives</span> (optional, one per line: <code>scholar.case_steps = anthropic:claude-opus-4-8, openai:gpt-4o</code>)
        <textarea rows={4} className={`${input} mt-1 block w-full font-mono`} value={acts} onChange={e => setActs(e.target.value)} />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "model_routing", settings: { ...r, activities: parseActivities(acts) } }, "Draft saved. Publish to make it effective.")}>Save routing draft</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}
