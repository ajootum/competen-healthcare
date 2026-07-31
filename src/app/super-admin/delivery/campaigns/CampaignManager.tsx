"use client";

import { useState } from "react";

// CDP-008 — campaign manager UI: create a campaign (competency + cohort + deadline), launch it (materialises
// an assignment + emits an event), and track live compliance from competency decisions.

type Camp = { id: string; name: string; competency: string; target: string; mandatory: boolean; status: string; dueOn: string | null; ownerName: string | null; cohort: number; achieved: number; compliance: number | null };
type Opt = { id: string; name: string };

const STATUS: Record<string, string> = {
  draft: "text-gray-500 bg-gray-50 border-gray-100",
  active: "text-teal-700 bg-teal-50 border-teal-100",
  closed: "text-gray-400 bg-gray-50 border-gray-100",
};

export default function CampaignManager({ campaigns, competencies, roles }: { campaigns: Camp[]; competencies: Opt[]; roles: string[] }) {
  const [show, setShow] = useState(false);
  const [name, setName] = useState("");
  const [competency, setCompetency] = useState("");
  const [role, setRole] = useState("");
  const [mandatory, setMandatory] = useState(false);
  const [due, setDue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function post(body: Record<string, unknown>) {
    setBusy(true); setErr(null);
    const r = await fetch("/api/admin/delivery/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) { setBusy(false); setErr(j.error ?? "Action failed"); return; }
    window.location.reload();
  }

  function create() {
    if (!name.trim()) { setErr("Name is required"); return; }
    const comp = competencies.find(c => c.id === competency);
    post({ action: "create", name, competency_id: competency || null, competency_name: comp?.name ?? null, target_type: "role", target_role: role || null, target_label: role || "All staff", mandatory, due_on: due || null });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white rounded-xl border border-gray-100 p-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">New campaign</h2>
          <button onClick={() => setShow(s => !s)} className="text-xs font-semibold text-violet-700 hover:underline">{show ? "Cancel" : "+ Create campaign"}</button>
        </div>
        {show && (
          <div className="mt-3 flex flex-col gap-2.5">
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Campaign name, e.g. Q3 Sepsis Bundle" className="text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <select value={competency} onChange={e => setCompetency(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400">
                <option value="">Competency…</option>
                {competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <select value={role} onChange={e => setRole(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-violet-400">
                <option value="">Target: all staff</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-xs text-gray-600"><span className="text-[10px] text-gray-400">Due</span><input type="date" value={due} onChange={e => setDue(e.target.value)} className="text-xs border border-gray-200 rounded-lg px-2 py-1.5" /></label>
              <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={mandatory} onChange={e => setMandatory(e.target.checked)} /> Mandatory</label>
              <button onClick={create} disabled={busy} className="ml-auto text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50 rounded-lg px-4 py-1.5">Create draft</button>
            </div>
          </div>
        )}
        {err && <p className="text-[11px] text-[var(--cmp-text-error)] mt-2">{err}</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-50"><p className="text-[11px] text-gray-400">{campaigns.length} campaign{campaigns.length === 1 ? "" : "s"}</p></div>
        {campaigns.length === 0 ? (
          <p className="text-xs text-gray-400 px-4 py-8 text-center">No campaigns yet. Create one to broadcast a competency initiative to a cohort.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {campaigns.map(c => (
              <div key={c.id} className="px-4 py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-semibold text-gray-800 truncate">{c.name}</span>
                  {c.mandatory && <span className="text-[8px] font-bold uppercase tracking-wide text-[var(--cmp-text-error)] bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] rounded px-1 py-0.5">Mandatory</span>}
                  <span className={`text-[8px] font-bold uppercase tracking-wide border rounded px-1.5 py-0.5 ${STATUS[c.status] ?? STATUS.draft}`}>{c.status}</span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    {c.status === "draft" && <button onClick={() => post({ action: "launch", id: c.id })} disabled={busy} className="text-[11px] font-semibold text-violet-700 hover:underline disabled:opacity-50">Launch →</button>}
                    {c.status === "active" && <button onClick={() => post({ action: "close", id: c.id })} disabled={busy} className="text-[11px] font-semibold text-gray-400 hover:text-gray-600 disabled:opacity-50">Close</button>}
                  </span>
                </div>
                <p className="text-[11px] text-gray-400 mb-1.5">{c.competency} · {c.target} · {c.cohort} in cohort{c.dueOn ? ` · due ${c.dueOn}` : ""}</p>
                {c.compliance != null && (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 flex-1 bg-gray-100 rounded-full overflow-hidden"><div className="h-full bg-teal-500 rounded-full" style={{ width: `${c.compliance}%` }} /></div>
                    <span className="text-[10px] font-semibold text-gray-500 shrink-0 tabular-nums">{c.compliance}% · {c.achieved}/{c.cohort}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
