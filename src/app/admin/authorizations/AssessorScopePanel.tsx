"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const isExpired = (iso?: string | null) => !!iso && new Date(iso).getTime() < Date.now();

// Assessor scope matrix (User Account Architecture §17): who may ASSESS which
// CPU. Assessors with no rows here see the whole hospital queue; once any
// scope is granted, their queue and entrustment powers are limited to it.

type Assessor = { id: string; full_name: string };
type Cpu = { id: string; name: string };
type Grant = {
  id: string; user_id: string; cpu_id: string | null; independence: string;
  valid_until: string | null; assessor_name: string; cpu_name: string | null;
};

const INDEPENDENCE_LABELS: Record<string, string> = {
  independent: "Independent",
  supervised: "Supervised",
  countersigned: "Countersigned",
};

export default function AssessorScopePanel({ assessors, cpus, grants }: {
  assessors: Assessor[]; cpus: Cpu[]; grants: Grant[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ user_id: "", cpu_id: "", independence: "independent", valid_until: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant() {
    setBusy(true); setError(null);
    const res = await fetch("/api/assessor-authorizations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, cpu_id: form.cpu_id || null, valid_until: form.valid_until || null }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setForm({ user_id: "", cpu_id: "", independence: "independent", valid_until: "" });
    router.refresh();
  }

  async function revoke(id: string) {
    setBusy(true);
    await fetch(`/api/assessor-authorizations?id=${id}`, { method: "DELETE" });
    setBusy(false); router.refresh();
  }

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30";

  return (
    <div className="mt-8">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">Assessor Scope Matrix 🎓</h2>
      <p className="text-[11px] text-gray-400 mb-3">
        Limits which CPUs an assessor may assess. An assessor with no grants sees the full queue; the first grant restricts them to their authorized scope.
      </p>

      <div className="bg-white rounded-xl border border-indigo-100 p-5 mb-4">
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select className={input} value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
            <option value="">Assessor…</option>
            {assessors.map(a => <option key={a.id} value={a.id}>{a.full_name}</option>)}
          </select>
          <select className={input} value={form.cpu_id} onChange={e => setForm(f => ({ ...f, cpu_id: e.target.value }))}>
            <option value="">All CPUs (blanket)</option>
            {cpus.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={input} value={form.independence} onChange={e => setForm(f => ({ ...f, independence: e.target.value }))}>
            {Object.entries(INDEPENDENCE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex gap-2">
            <input className={`${input} flex-1`} type="date" title="Valid until (optional)"
              value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} />
            <button disabled={busy || !form.user_id} onClick={grant}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold px-4 rounded-lg transition-colors disabled:opacity-50">
              Grant
            </button>
          </div>
        </div>
      </div>

      {grants.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-6 text-center text-sm text-gray-400">
          No assessor scopes granted — all assessors currently see the full hospital queue.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {grants.map(g => {
            const expired = isExpired(g.valid_until);
            return (
              <div key={g.id} className="flex items-center gap-3 px-5 py-3">
                <span className="text-lg">🎓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <b>{g.assessor_name}</b> → {g.cpu_name ?? "All CPUs"}
                  </p>
                  <p className="text-[10px] text-gray-400">
                    {INDEPENDENCE_LABELS[g.independence] ?? g.independence}
                    {g.valid_until ? ` · valid to ${new Date(g.valid_until).toLocaleDateString()}` : " · no expiry"}
                  </p>
                </div>
                {expired && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-600">Expired</span>}
                <button disabled={busy} onClick={() => revoke(g.id)}
                  className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors">Revoke</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
