"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Licensing & Subscription Centre (POP-001 §5) — plans table with create/edit,
// subscriptions/seats, and upcoming renewals. Billing history isn't stored, so
// MRR is derived from plan price × live subscriptions (honest).
/* eslint-disable @typescript-eslint/no-explicit-any */

const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/40";
const ENT = [["max_users", "Max users"], ["max_hospitals", "Max facilities"], ["storage_gb", "Storage (GB)"], ["ai_credits", "AI credits"]] as const;
const blank = { name: "", code: "", price_monthly: "0", currency: "USD", max_users: "", max_hospitals: "", storage_gb: "", ai_credits: "", api_access: false, is_active: true };

export default function LicensingClient({ planRows, renewals, currency }: { planRows: any[]; renewals: any[]; currency: string }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ mode: "create" | "edit"; plan?: any } | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  return (
    <div className="grid lg:grid-cols-3 gap-4">
      {/* Plans */}
      <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200">
        <div className="flex items-center justify-between p-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">Plans <span className="text-gray-400 font-normal text-sm">({planRows.length})</span></h2>
          <button onClick={() => { setModal({ mode: "create" }); setErr(""); }} className="text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg px-3.5 py-2">+ Create Plan</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="px-4 py-2.5 font-semibold">Plan</th><th className="px-4 py-2.5 font-semibold">Price</th><th className="px-4 py-2.5 font-semibold">Max users</th><th className="px-4 py-2.5 font-semibold">API</th>
              <th className="px-4 py-2.5 font-semibold text-right">Tenants</th><th className="px-4 py-2.5 font-semibold text-right">Seats</th><th className="px-4 py-2.5 font-semibold text-right">Status</th>
            </tr></thead>
            <tbody>
              {planRows.map(p => (
                <tr key={p.id} onClick={() => { setModal({ mode: "edit", plan: p }); setErr(""); }} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer">
                  <td className="px-4 py-3"><div className="flex items-center gap-2"><span className="w-7 h-7 rounded-lg bg-violet-50 flex items-center justify-center text-sm shrink-0">🧾</span><div><p className="font-medium text-gray-900">{p.name}</p><p className="text-[10px] text-gray-400">{p.code}</p></div></div></td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums">{p.currency} {p.price}<span className="text-gray-400">/mo</span></td>
                  <td className="px-4 py-3 text-gray-600 tabular-nums">{p.entitlements?.max_users ?? "∞"}</td>
                  <td className="px-4 py-3">{p.entitlements?.api_access ? <span className="text-green-600">✓</span> : <span className="text-gray-300">—</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{p.tenants}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-gray-700">{p.seats}</td>
                  <td className="px-4 py-3 text-right"><span className={`text-[10px] font-medium px-2 py-0.5 rounded ${p.active ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"}`}>{p.active ? "Active" : "Inactive"}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Renewals */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-900 mb-3">Upcoming renewals</h2>
        {renewals.length === 0 ? <p className="text-sm text-gray-400">No scheduled renewals.</p> : (
          <div className="space-y-2">
            {renewals.map((r: any, i: number) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <div className="min-w-0"><p className="text-gray-800 truncate">{r.tenant}</p><p className="text-[10px] text-gray-400">{r.plan}</p></div>
                <span className={`text-[11px] tabular-nums shrink-0 ${r.days < 0 ? "text-rose-600" : r.days <= 30 ? "text-amber-600" : "text-gray-500"}`}>{r.days < 0 ? `${-r.days}d overdue` : `in ${r.days}d`}</span>
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-gray-400 mt-3 pt-3 border-t border-gray-50">Billing &amp; invoicing history activates when the billing provider is connected — MRR shown is plan list-price × live subscriptions.</p>
      </div>

      {modal && <PlanModal mode={modal.mode} plan={modal.plan} currency={currency} saving={saving} err={err}
        onClose={() => setModal(null)}
        onSave={async (payload: any) => {
          setSaving(true); setErr("");
          const r = modal.mode === "create"
            ? await fetch("/api/platform/plans", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
            : await fetch(`/api/platform/plans?id=${modal.plan.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          setSaving(false);
          if (r.ok) { setModal(null); router.refresh(); } else setErr((await r.json().catch(() => ({}))).error ?? "Failed");
        }} />}
    </div>
  );
}

function PlanModal({ mode, plan, currency, saving, err, onClose, onSave }: any) {
  const [form, setForm] = useState<any>(() => mode === "edit" ? {
    name: plan.name, code: plan.code, price_monthly: String(plan.price ?? 0), currency: plan.currency ?? currency,
    max_users: plan.entitlements?.max_users ?? "", max_hospitals: plan.entitlements?.max_hospitals ?? "", storage_gb: plan.entitlements?.storage_gb ?? "", ai_credits: plan.entitlements?.ai_credits ?? "",
    api_access: !!plan.entitlements?.api_access, is_active: !!plan.active,
  } : { ...blank, currency });
  const set = (k: string) => (e: any) => setForm((f: any) => ({ ...f, [k]: k === "api_access" || k === "is_active" ? e.target.checked : e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100"><h3 className="font-bold text-gray-900 capitalize">{mode} plan</h3><button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">×</button></div>
        <div className="p-6 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Plan name *</label><input value={form.name} onChange={set("name")} className={input} placeholder="Professional" /></div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Code {mode === "edit" && <span className="text-gray-300">(fixed)</span>}</label><input value={form.code} onChange={set("code")} disabled={mode === "edit"} className={`${input} disabled:bg-gray-50 disabled:text-gray-400`} placeholder="professional" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Price / month</label><input type="number" value={form.price_monthly} onChange={set("price_monthly")} className={input} /></div>
            <div><label className="text-xs font-semibold text-gray-600 mb-1 block">Currency</label><input value={form.currency} onChange={set("currency")} maxLength={3} className={input} /></div>
          </div>
          <p className="text-[11px] font-semibold text-gray-500 pt-1">Entitlements <span className="font-normal text-gray-400">(blank = unlimited)</span></p>
          <div className="grid grid-cols-2 gap-3">
            {ENT.map(([k, l]) => <div key={k}><label className="text-xs font-semibold text-gray-600 mb-1 block">{l}</label><input type="number" value={form[k]} onChange={set(k)} className={input} placeholder="∞" /></div>)}
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.api_access} onChange={set("api_access")} /> API access</label>
            <label className="flex items-center gap-2 text-sm text-gray-600"><input type="checkbox" checked={form.is_active} onChange={set("is_active")} /> Active</label>
          </div>
          {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-2 pt-1">
            <button onClick={onClose} className="flex-1 py-2 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
            <button onClick={() => onSave(form)} disabled={saving || !form.name.trim()} className="flex-1 py-2 bg-teal-600 text-white rounded-lg text-sm font-semibold hover:bg-teal-700 disabled:opacity-60">{saving ? "Saving…" : mode === "create" ? "Create" : "Save"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
