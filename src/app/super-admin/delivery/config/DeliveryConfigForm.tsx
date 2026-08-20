"use client";

import { useState } from "react";

// CDP-014 — the delivery-policy editor. Edits the four governed knobs the runtime engines read; POSTs the whole
// policy and reflects the saved state. Each control is tagged with the engine it steers, so the operator can see
// the config is consumed, not cosmetic.

type Config = {
  reminder_horizon_days: number;
  auto_remediation: boolean;
  orchestration_enabled: boolean;
  campaign_default_due_days: number;
};

function Toggle({ on, onChange, disabled }: { on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${on ? "bg-violet-600" : "bg-gray-200"}`}>
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

function NumberField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <input type="number" min={1} max={365} value={value}
      onChange={e => onChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
      className="w-20 border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-violet-500/30" />
  );
}

export default function DeliveryConfigForm({ config, updatedBy, updatedAt }: { config: Config; updatedBy: string | null; updatedAt: string | null }) {
  const [form, setForm] = useState<Config>(config);
  const [saved, setSaved] = useState<Config>(config);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [prov, setProv] = useState<{ by: string | null; at: string | null }>({ by: updatedBy, at: updatedAt });

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = <K extends keyof Config>(k: K, v: Config[K]) => { setForm(f => ({ ...f, [k]: v })); setMsg(null); };

  async function save() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/delivery/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok || j.error) { setMsg(j.error ?? "Save failed"); return; }
    setSaved(j.config ?? form);
    setForm(j.config ?? form);
    setProv({ by: j.updatedBy ?? null, at: j.updatedAt ?? null });
    setMsg("Policy saved — engines will use it on their next run.");
  }

  const rowCls = "flex items-start justify-between gap-4 px-4 py-3.5";

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50 overflow-hidden">
        <div className={rowCls}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900">Run delivery orchestration</p><span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">CDP-001</span></div>
            <p className="text-[11px] text-gray-500 mt-0.5">When off, the orchestrator stops materialising new competency deliveries from assignment rules. Existing assignments are untouched.</p>
          </div>
          <Toggle on={form.orchestration_enabled} onChange={v => set("orchestration_enabled", v)} disabled={busy} />
        </div>

        <div className={rowCls}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900">Auto-remediate failed assessments</p><span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">CDP-015</span></div>
            <p className="text-[11px] text-gray-500 mt-0.5">When on, the event consumer notifies the learner and queues a reinforcement card whenever an assessment is failed. When off, those events are acknowledged with no follow-up.</p>
          </div>
          <Toggle on={form.auto_remediation} onChange={v => set("auto_remediation", v)} disabled={busy} />
        </div>

        <div className={rowCls}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900">Reminder lead time</p><span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">CDP-011</span></div>
            <p className="text-[11px] text-gray-500 mt-0.5">How many days ahead the scan reminds learners before a credential or competency expires.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0"><NumberField value={form.reminder_horizon_days} onChange={v => set("reminder_horizon_days", v)} /><span className="text-[11px] text-gray-500">days</span></div>
        </div>

        <div className={rowCls}>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><p className="text-sm font-semibold text-gray-900">Default campaign deadline</p><span className="text-[8px] font-bold uppercase tracking-wide text-violet-600 bg-violet-50 border border-violet-100 rounded px-1.5 py-0.5">CDP-008</span></div>
            <p className="text-[11px] text-gray-500 mt-0.5">The deadline applied to a learning campaign when the author doesn&apos;t set an explicit due date.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0"><NumberField value={form.campaign_default_due_days} onChange={v => set("campaign_default_due_days", v)} /><span className="text-[11px] text-gray-500">days</span></div>
        </div>
      </div>

      <div className="flex items-center gap-3 mt-4">
        <button onClick={save} disabled={busy || !dirty} className="text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-2">{busy ? "Saving…" : dirty ? "Save policy" : "Saved"}</button>
        {dirty && !busy && <button onClick={() => { setForm(saved); setMsg(null); }} className="text-xs font-semibold text-gray-500 hover:text-gray-700">Reset</button>}
        {msg && <span className="text-[11px] text-gray-500">{msg}</span>}
        {!dirty && !msg && prov.by && <span className="text-[11px] text-gray-500">Last set by {prov.by}{prov.at ? ` · ${new Date(prov.at).toLocaleDateString()}` : ""}</span>}
      </div>
    </div>
  );
}
