"use client";

import { useState } from "react";
import { Message, ghost, input, primary, useSend } from "./FairUseControls";

// Registered AI providers (owner NO-CODE AI PROVIDER EXTENSIBILITY, provider-registry.ts). Each control posts to
// /api/hq/ai-governance, which re-checks hq.platform.ai.manage, validates and audits. Nothing here holds a key: a
// provider's key is the deployment's AI_PROVIDER_KEY_<ID>, set by the owner, and this page only says whether it is set.

type Check = { at: string; ok: boolean; detail: string | null } | undefined;
type Provider = {
  id: string; label: string; protocol: string; endpoint: string; models: Partial<Record<"cheap" | "reasoning" | "heavy", string>>; maxOutputTokens: number;
  status: "inactive" | "active"; checks: { connectivity?: Check; capability?: Check; privacy?: Check & { termsRef?: string; region?: string }; security?: Check };
};
const TIERS = [["cheap", "Light"], ["reasoning", "Reasoning"], ["heavy", "Most capable"]] as const;
const when = (c: Check) => (c ? `${c.ok ? "passed" : "failed"} ${c.at.slice(0, 16).replace("T", " ")} UTC${c.detail ? `: ${c.detail}` : ""}` : "not recorded");

function NewProvider({ hosts }: { hosts: string[] }) {
  const [p, setP] = useState({ id: "", label: "", endpoint: "", models: { cheap: "", reasoning: "", heavy: "" }, maxOutputTokens: 1500 });
  const { busy, msg, send } = useSend();
  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3">
      <p className="text-[13px] font-semibold text-gray-800">Register a provider (OpenAI chat-completions protocol)</p>
      <p className="text-[12.5px] text-gray-600">
        The host must be one this deployment permits: {hosts.length ? hosts.join(", ") : "none yet (the owner sets AI_PROVIDER_ALLOWED_HOSTS)"}. A provider using any
        other protocol needs an adapter written in the gateway, and cannot be configured here. A new registration starts inactive and is never used until it is checked,
        activated and published. It is never used for clinical requests without its own evaluation and eligibility decision.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[12.5px] text-gray-700">Provider id<input className={`${input} mt-1 block w-full`} value={p.id} onChange={e => setP({ ...p, id: e.target.value.trim().toLowerCase() })} placeholder="e.g. mistral" /></label>
        <label className="text-[12.5px] text-gray-700">Name<input className={`${input} mt-1 block w-full`} value={p.label} onChange={e => setP({ ...p, label: e.target.value })} /></label>
        <label className="text-[12.5px] text-gray-700 sm:col-span-2">Endpoint (https, the base before /chat/completions)<input className={`${input} mt-1 block w-full`} value={p.endpoint} onChange={e => setP({ ...p, endpoint: e.target.value.trim() })} placeholder="https://api.example.com/v1" /></label>
        {TIERS.map(([t, l]) => <label key={t} className="text-[12.5px] text-gray-700">{l} model id<input className={`${input} mt-1 block w-full`} value={p.models[t]} onChange={e => setP({ ...p, models: { ...p.models, [t]: e.target.value.trim() } })} /></label>)}
        <label className="text-[12.5px] text-gray-700">Largest answer (tokens)<input type="number" min={16} max={32000} className={`${input} mt-1 block w-full`} value={p.maxOutputTokens} onChange={e => setP({ ...p, maxOutputTokens: Number(e.target.value) })} /></label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "provider_save", provider: { ...p, protocol: "openai_chat_completions", models: Object.fromEntries(Object.entries(p.models).filter(([, v]) => v)) } }, "Registered as a draft, inactive.")}>Save registration</button>
        <Message msg={msg} />
      </div>
    </div>
  );
}

function ProviderRow({ p, keyed, credentialName, problems }: { p: Provider; keyed: boolean; credentialName: string; problems: string[] }) {
  const [terms, setTerms] = useState(p.checks.privacy?.termsRef ?? ""); const [region, setRegion] = useState(p.checks.privacy?.region ?? ""); const [noTraining, setNoTraining] = useState(false);
  const [note, setNote] = useState("");
  const { busy, msg, send } = useSend();
  return (
    <li className="rounded-lg border border-gray-200 p-3 text-[13px]">
      <p className="font-semibold text-gray-900">{p.label} <span className="font-mono text-[12px] text-gray-500">{p.id}</span> · <span className={p.status === "active" ? "text-[var(--cmp-text-success)]" : "text-gray-600"}>{p.status}</span></p>
      <p className="text-gray-700">{p.endpoint || "no approved endpoint"} · models {Object.entries(p.models).map(([t, m]) => `${t}: ${m}`).join(", ") || "none"}</p>
      <p className="text-gray-700">Key: {keyed ? <span className="text-[var(--cmp-text-success)]">present</span> : <span className="text-amber-900">not set. The owner sets <code>{credentialName}</code> in the deployment.</span>}</p>
      <ul className="mt-1 text-[12.5px] text-gray-700">
        <li>Connectivity: {when(p.checks.connectivity)}</li><li>Capability: {when(p.checks.capability)}</li>
        <li>Privacy: {when(p.checks.privacy)}{p.checks.privacy?.termsRef ? ` (${p.checks.privacy.termsRef}, ${p.checks.privacy.region})` : ""}</li><li>Security: {when(p.checks.security)}</li>
      </ul>
      {problems.length > 0 && <p className="mt-1 text-[12.5px] text-amber-900">To activate it still needs: {problems.join("; ")}.</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !keyed} className={ghost} onClick={() => send({ action: "provider_check", id: p.id }, "Checks recorded.")}>Run connectivity and capability checks</button>
        {p.status === "active"
          ? <button type="button" disabled={busy} className={ghost} onClick={() => send({ action: "provider_status", id: p.id, status: "inactive" }, "Deactivated in the draft. Publish to take effect.")}>Deactivate</button>
          : <button type="button" disabled={busy || problems.length > 0 || !keyed} className={primary} onClick={() => send({ action: "provider_status", id: p.id, status: "active" }, "Activated in the draft. Publish to take effect.")}>Activate</button>}
      </div>
      <details className="mt-2"><summary className="cursor-pointer text-[12.5px] font-semibold text-gray-800">Record the privacy and security checks</summary>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px] text-gray-700">Data-processing terms (reference or URL)<input className={`${input} mt-1 block w-full`} value={terms} onChange={e => setTerms(e.target.value)} /></label>
          <label className="text-[12.5px] text-gray-700">Processing region<input className={`${input} mt-1 block w-full`} value={region} onChange={e => setRegion(e.target.value)} /></label>
          <label className="text-[12.5px] text-gray-700 sm:col-span-2"><input type="checkbox" className="mr-2" checked={noTraining} onChange={e => setNoTraining(e.target.checked)} />The terms say user content is not used to train the provider&apos;s models</label>
        </div>
        <button type="button" disabled={busy} className={`${ghost} mt-2`} onClick={() => send({ action: "provider_attest", id: p.id, kind: "privacy", termsRef: terms, region, noTraining }, "Privacy check recorded.")}>Record privacy check</button>
        <label className="mt-2 block text-[12.5px] text-gray-700">Security review (what it covered)<textarea rows={2} className={`${input} mt-1 block w-full`} value={note} onChange={e => setNote(e.target.value)} /></label>
        <button type="button" disabled={busy} className={`${ghost} mt-1`} onClick={() => send({ action: "provider_attest", id: p.id, kind: "security", note }, "Security check recorded.")}>Record security check</button>
      </details>
      <Message msg={msg} />
    </li>
  );
}

export function ProviderRegistry({ registry, keyed, credentialNames, problems, hosts }: {
  registry: Record<string, Provider>; keyed: Record<string, boolean>; credentialNames: Record<string, string>; problems: Record<string, string[]>; hosts: string[];
}) {
  const list = Object.values(registry);
  return (
    <div className="space-y-3">
      {list.length === 0 ? <p className="text-[13px] text-gray-600">No provider is registered beyond Anthropic, OpenAI and Gemini.</p> : (
        <ul className="space-y-2">{list.map(p => <ProviderRow key={p.id} p={p} keyed={!!keyed[p.id]} credentialName={credentialNames[p.id]} problems={problems[p.id] ?? []} />)}</ul>
      )}
      <NewProvider hosts={hosts} />
    </div>
  );
}
