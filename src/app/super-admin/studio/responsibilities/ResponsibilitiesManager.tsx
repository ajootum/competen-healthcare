"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const isPast = (iso?: string | null) => !!iso && new Date(iso).getTime() < Date.now();

type Row = {
  id: string; content_type: string; content_id: string; content_name: string;
  responsibility_type: string; review_due: string | null; start_date: string; holder: string;
};
type Staff = { id: string; full_name: string; role: string };
type ContentObject = { type: string; id: string; label: string };

const RESP_LABELS: Record<string, string> = {
  product_owner: "Product Owner",
  primary_author: "Primary Author",
  contributing_author: "Contributing Author",
  clinical_reviewer: "Clinical Reviewer",
  evidence_owner: "Evidence Owner",
  assessment_owner: "Assessment Owner",
  governance_approver: "Governance Approver",
  publisher: "Publisher",
};

export default function ResponsibilitiesManager({ rows, staff, objects }: {
  rows: Row[]; staff: Staff[]; objects: ContentObject[];
}) {
  const router = useRouter();
  const [form, setForm] = useState({ user_id: "", object: "", responsibility_type: "product_owner", review_due: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    const obj = objects.find(o => `${o.type}:${o.id}` === form.object);
    if (!obj || !form.user_id) return;
    setBusy(true); setError(null);
    const res = await fetch("/api/studio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "responsibility", user_id: form.user_id,
        content_type: obj.type, content_id: obj.id,
        content_name: obj.label.split("· ")[1] ?? obj.label,
        responsibility_type: form.responsibility_type,
        review_due: form.review_due || null,
      }),
    });
    setBusy(false);
    if (!res.ok) { setError((await res.json()).error ?? "Failed"); return; }
    setForm({ user_id: "", object: "", responsibility_type: "product_owner", review_due: "" });
    router.refresh();
  }

  async function end(id: string) {
    setBusy(true);
    await fetch(`/api/studio?kind=responsibility&id=${id}`, { method: "DELETE" });
    setBusy(false); router.refresh();
  }

  const input = "border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";

  return (
    <div className="flex flex-col gap-5">
      {/* Assign form */}
      <div className="bg-white rounded-xl border border-teal-100 p-5">
        <p className="text-[10px] font-bold text-teal-600 uppercase tracking-widest mb-3">Assign responsibility</p>
        {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg px-3 py-2 mb-3">{error}</div>}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <select className={input} value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}>
            <option value="">Person…</option>
            {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
          </select>
          <select className={input} value={form.object} onChange={e => setForm(f => ({ ...f, object: e.target.value }))}>
            <option value="">Content object…</option>
            {objects.map(o => <option key={`${o.type}:${o.id}`} value={`${o.type}:${o.id}`}>{o.label}</option>)}
          </select>
          <select className={input} value={form.responsibility_type} onChange={e => setForm(f => ({ ...f, responsibility_type: e.target.value }))}>
            {Object.entries(RESP_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="flex gap-2">
            <input className={`${input} flex-1`} type="date" title="Annual review due (optional)"
              value={form.review_due} onChange={e => setForm(f => ({ ...f, review_due: e.target.value }))} />
            <button disabled={busy || !form.user_id || !form.object} onClick={assign}
              className="bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold px-4 rounded-lg transition-colors disabled:opacity-50">
              Assign
            </button>
          </div>
        </div>
      </div>

      {/* Current responsibilities */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 p-10 text-center text-sm text-gray-400">
          No responsibilities assigned yet — start with a Product Owner for each published CPU.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {rows.map(r => {
            const overdue = isPast(r.review_due);
            return (
              <div key={r.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">
                    <b>{r.holder}</b> — {RESP_LABELS[r.responsibility_type] ?? r.responsibility_type}
                  </p>
                  <p className="text-[10px] text-gray-400 capitalize">
                    {r.content_type.replace("_", " ")} · {r.content_name} · since {new Date(r.start_date).toLocaleDateString()}
                  </p>
                </div>
                {r.review_due && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${overdue ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"}`}>
                    Review {overdue ? "overdue" : `due ${new Date(r.review_due).toLocaleDateString()}`}
                  </span>
                )}
                <button disabled={busy} onClick={() => end(r.id)}
                  className="text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 px-2 py-1 rounded transition-colors">End</button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
