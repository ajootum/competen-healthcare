"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EDITABLE_PRODUCTS, PRODUCT_ICONS, type PresentationConfig } from "@/lib/design/presentation-config";
import { PRODUCT_PRESENTATION } from "@/lib/design/product-themes";

// How Individual, Scholar and Professional present themselves on the sign-in chooser (COMPETEN-DESIGN-SYSTEM-01 s4),
// as a draft. Saved to /api/hq/individual/config {action: "presentation"}, which re-checks hq.individual.config.manage
// and validates the whole draft. Names and colours are shown, not edited: they are fixed in code (presentation-config.ts).

const input = "w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-700 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const btn = "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-[13px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)]";
const label = "block text-[12.5px] font-semibold text-gray-700";

export default function PresentationEditor({ initial }: { initial: PresentationConfig }) {
  const router = useRouter();
  const [cfg, setCfg] = useState<PresentationConfig>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (k: keyof PresentationConfig, patch: Partial<PresentationConfig[keyof PresentationConfig]>) => setCfg(c => ({ ...c, [k]: { ...c[k], ...patch } }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/hq/individual/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "presentation", settings: cfg }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ ok: false, text: j?.error ?? "The draft could not be saved." }); return; }
      setMsg({ ok: true, text: "Draft saved. Publish below to make it effective." }); router.refresh();
    } catch { setMsg({ ok: false, text: "The draft could not be saved. Check your connection." }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-4">
      {EDITABLE_PRODUCTS.map(k => (
        <fieldset key={k} data-cmp-theme={PRODUCT_PRESENTATION[k].theme} className="rounded-lg border-l-4 border-[var(--cmp-theme-accent)] bg-gray-50 p-3">
          <legend className="px-1 text-[13.5px] font-bold text-gray-900">{PRODUCT_PRESENTATION[k].name} <span className="font-normal text-gray-600">(name and colour fixed)</span></legend>
          <div className="grid gap-3 md:grid-cols-2">
            <label className={label}>Role line
              <input className={input} maxLength={60} value={cfg[k].role} onChange={e => set(k, { role: e.target.value })} />
            </label>
            <label className={label}>Action label
              <input className={input} maxLength={40} value={cfg[k].action} onChange={e => set(k, { action: e.target.value })} />
            </label>
            <label className={`${label} md:col-span-2`}>Description
              <textarea className={input} rows={2} maxLength={200} value={cfg[k].description} onChange={e => set(k, { description: e.target.value })} />
            </label>
            <label className={label}>Icon
              <select className={input} value={cfg[k].icon} onChange={e => set(k, { icon: e.target.value as PresentationConfig[typeof k]["icon"] })}>
                {PRODUCT_ICONS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </label>
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy} className={`${btn} bg-teal-700 text-white hover:bg-teal-800`} onClick={() => void save()}>Save presentation draft</button>
        {msg && <p role={msg.ok ? "status" : "alert"} className={`text-[13px] font-medium ${msg.ok ? "text-green-800" : "text-red-700"}`}>{msg.text}</p>}
      </div>
    </div>
  );
}
