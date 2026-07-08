"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { CREDENTIAL_TYPE_LABELS, CREDENTIAL_STATUS_CONFIG } from "@/lib/ckcm";

type Worker = { id: string; full_name: string };
type Credential = {
  id: string; credential_number: string; nurse_id: string; credential_type: string;
  title: string; issuing_body: string | null; issue_date: string | null; expiry_date: string | null;
  status: string; verified: boolean; profiles: { full_name: string } | null;
};

function expiryFlag(expiry: string | null): { label: string; cls: string } | null {
  if (!expiry) return null;
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000);
  if (days < 0) return { label: "Expired", cls: "bg-red-50 text-red-600" };
  if (days <= 90) return { label: `Renews in ${days}d`, cls: "bg-amber-50 text-amber-700" };
  return null;
}

export default function CredentialsManager({ workers, credentials }: { workers: Worker[]; credentials: Credential[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ nurse_id: "", credential_type: "professional_license", title: "", issuing_body: "", issue_date: "", expiry_date: "" });

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/credentials", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
    return res.ok;
  }
  async function create() {
    if (!form.nurse_id || !form.title.trim()) { alert("Worker and title required"); return; }
    const ok = await api("POST", { ...form, title: form.title.trim(), issue_date: form.issue_date || null, expiry_date: form.expiry_date || null, issuing_body: form.issuing_body || null });
    if (ok) { setAdding(false); setForm({ nurse_id: "", credential_type: "professional_license", title: "", issuing_body: "", issue_date: "", expiry_date: "" }); }
  }
  async function del(c: Credential) {
    if (!confirm(`Delete credential "${c.title}"?`)) return;
    setBusy(true); await fetch(`/api/credentials?id=${c.id}`, { method: "DELETE" }); setBusy(false); router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setAdding(a => !a)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {adding ? "Cancel" : "+ Add Credential"}
        </button>
      </div>

      {adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Worker *</label>
              <select value={form.nurse_id} onChange={e => setForm(p => ({ ...p, nurse_id: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Type</label>
              <select value={form.credential_type} onChange={e => setForm(p => ({ ...p, credential_type: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {Object.entries(CREDENTIAL_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="Credential title * (e.g. RN License, BSc Nursing)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <input value={form.issuing_body} onChange={e => setForm(p => ({ ...p, issuing_body: e.target.value }))} placeholder="Issuing body (e.g. Nursing Council)"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Issue date</label>
              <input type="date" value={form.issue_date} onChange={e => setForm(p => ({ ...p, issue_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Expiry date</label>
              <input type="date" value={form.expiry_date} onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <button onClick={create} disabled={busy} className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Saving…" : "Add"}
          </button>
        </div>
      )}

      {credentials.map(c => {
        const st = CREDENTIAL_STATUS_CONFIG[c.status] ?? CREDENTIAL_STATUS_CONFIG.pending_verification;
        const ex = expiryFlag(c.expiry_date);
        return (
          <div key={c.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-semibold text-gray-900 text-sm">{c.title}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st.cls}`}>{st.label}</span>
                  {c.verified && <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded font-semibold">✓ Verified</span>}
                  {ex && <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${ex.cls}`}>{ex.label}</span>}
                </div>
                <p className="text-xs text-gray-600 mt-1">
                  {c.profiles?.full_name ?? "—"} · {CREDENTIAL_TYPE_LABELS[c.credential_type] ?? c.credential_type}
                  {c.issuing_body && ` · ${c.issuing_body}`}
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5 font-mono">
                  {c.credential_number}
                  {c.issue_date && ` · issued ${new Date(c.issue_date).toLocaleDateString()}`}
                  {c.expiry_date && ` · expires ${new Date(c.expiry_date).toLocaleDateString()}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!c.verified && <button onClick={() => api("PATCH", { id: c.id, action: "verify" })} className="px-2.5 py-1 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50">Verify</button>}
                <button onClick={() => del(c)} className="px-2.5 py-1 text-xs text-red-500 border border-red-100 rounded-lg hover:bg-red-50">Delete</button>
              </div>
            </div>
          </div>
        );
      })}

      {!credentials.length && !adding && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">🎖️</p>
          <p className="text-gray-400 text-sm">No credentials recorded yet.</p>
        </div>
      )}
    </div>
  );
}
