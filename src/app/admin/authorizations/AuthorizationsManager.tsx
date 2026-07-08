"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AUTH_TYPE_LABELS, AUTH_STATUS_CONFIG, type AuthorizationType, type AuthStatus } from "@/lib/ckcm";

type Worker = { id: string; full_name: string };
type Authorization = {
  id: string; authorization_number: string; nurse_id: string;
  authorization_type: string; authorization_level: string; status: string;
  scope: string | null; conditions: string | null; effective_date: string; expiry_date: string | null;
  granted_by_name: string | null; profiles: { full_name: string } | null;
};

export default function AuthorizationsManager({
  workers, authorizations, decisionsByWorker,
}: {
  workers: Worker[];
  authorizations: Authorization[];
  decisionsByWorker: Record<string, { competency_id: string; name: string }[]>;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [granting, setGranting] = useState(false);
  const [form, setForm] = useState({
    nurse_id: "", authorization_type: "clinical_privilege", authorization_level: "independent",
    scope: "", conditions: "", expiry_date: "",
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  async function api(method: string, body: object) {
    setBusy(true);
    const res = await fetch("/api/authorizations", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "Failed");
    return res.ok;
  }

  async function grant() {
    if (!form.nurse_id) { alert("Select a worker"); return; }
    const comps = decisionsByWorker[form.nurse_id] ?? [];
    const activities = comps.filter(c => picked.has(c.competency_id)).map(c => ({ competency_id: c.competency_id, label: c.name }));
    const ok = await api("POST", { ...form, expiry_date: form.expiry_date || null, activities });
    if (ok) { setGranting(false); setForm({ nurse_id: "", authorization_type: "clinical_privilege", authorization_level: "independent", scope: "", conditions: "", expiry_date: "" }); setPicked(new Set()); }
  }

  const workerComps = decisionsByWorker[form.nurse_id] ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button onClick={() => setGranting(g => !g)} className="px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700">
          {granting ? "Cancel" : "+ Grant Authorization"}
        </button>
      </div>

      {granting && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Worker *</label>
              <select value={form.nurse_id} onChange={e => { setForm(p => ({ ...p, nurse_id: e.target.value })); setPicked(new Set()); }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="">Select…</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Type</label>
              <select value={form.authorization_type} onChange={e => setForm(p => ({ ...p, authorization_type: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                {(Object.keys(AUTH_TYPE_LABELS) as AuthorizationType[]).map(t => <option key={t} value={t}>{AUTH_TYPE_LABELS[t]}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Level</label>
              <select value={form.authorization_level} onChange={e => setForm(p => ({ ...p, authorization_level: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                <option value="independent">Independent</option>
                <option value="supervised">Supervised</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1 block">Expiry (optional)</label>
              <input type="date" value={form.expiry_date} onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Scope of practice</label>
            <input value={form.scope} onChange={e => setForm(p => ({ ...p, scope: e.target.value }))}
              placeholder="e.g. Adult ICU, general ward oxygen therapy"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-500 mb-1 block">Conditions (optional)</label>
            <input value={form.conditions} onChange={e => setForm(p => ({ ...p, conditions: e.target.value }))}
              placeholder="e.g. Supervised for first 10 procedures; restricted to pediatric patients"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm" />
          </div>

          {form.nurse_id && (
            <div>
              <label className="text-xs font-semibold text-gray-500 mb-1.5 block">Authorized activities — from competent decisions</label>
              {workerComps.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {workerComps.map(c => {
                    const on = picked.has(c.competency_id);
                    return (
                      <button key={c.competency_id}
                        onClick={() => setPicked(prev => { const s = new Set(prev); s.has(c.competency_id) ? s.delete(c.competency_id) : s.add(c.competency_id); return s; })}
                        className={`text-[11px] px-2.5 py-1 rounded-full border ${on ? "bg-teal-600 text-white border-teal-600" : "bg-white text-gray-600 border-gray-200 hover:border-teal-300"}`}>
                        {on ? "✓ " : "+ "}{c.name}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] text-amber-600 italic">This worker has no competent decisions yet — competency should precede authorization.</p>
              )}
            </div>
          )}

          <button onClick={grant} disabled={busy}
            className="self-end px-4 py-2 bg-teal-600 text-white text-sm font-semibold rounded-lg hover:bg-teal-700 disabled:opacity-50">
            {busy ? "Granting…" : "Grant Authorization"}
          </button>
        </div>
      )}

      {authorizations.map(a => {
        const st = AUTH_STATUS_CONFIG[a.status as AuthStatus];
        return (
          <div key={a.id} className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{a.profiles?.full_name ?? "—"}</p>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${st?.cls ?? "bg-gray-100 text-gray-600"}`}>{st?.label ?? a.status}</span>
                </div>
                <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{a.authorization_number}</p>
                <p className="text-xs text-gray-600 mt-1">
                  {AUTH_TYPE_LABELS[a.authorization_type as AuthorizationType] ?? a.authorization_type} · <span className="capitalize">{a.authorization_level}</span>
                  {a.scope && <> · {a.scope}</>}
                </p>
                {a.conditions && <p className="text-[11px] text-amber-600 mt-0.5">⚠ {a.conditions}</p>}
                <p className="text-[10px] text-gray-400 mt-1">
                  From {new Date(a.effective_date).toLocaleDateString()}
                  {a.expiry_date && ` → ${new Date(a.expiry_date).toLocaleDateString()}`}
                  {a.granted_by_name && ` · granted by ${a.granted_by_name}`}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {a.status === "active" && (
                  <>
                    <button onClick={() => api("PATCH", { id: a.id, status: "suspended" })} className="px-2.5 py-1 text-xs text-amber-600 border border-amber-200 rounded-lg hover:bg-amber-50">Suspend</button>
                    <button onClick={() => api("PATCH", { id: a.id, status: "revoked" })} className="px-2.5 py-1 text-xs text-red-500 border border-red-200 rounded-lg hover:bg-red-50">Revoke</button>
                  </>
                )}
                {a.status === "suspended" && (
                  <button onClick={() => api("PATCH", { id: a.id, status: "active" })} className="px-2.5 py-1 text-xs text-green-600 border border-green-200 rounded-lg hover:bg-green-50">Reactivate</button>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {!authorizations.length && !granting && (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center">
          <p className="text-2xl mb-2">🔑</p>
          <p className="text-gray-400 text-sm">No authorizations yet — grant one to permit a competent worker to practise.</p>
        </div>
      )}
    </div>
  );
}
