"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// PPE-001 authoring — the client controls over the objective write API. NewObjectiveButton opens an inline create
// form; ObjectiveControls renders the lifecycle actions available for an objective's current status. Both POST/
// PATCH the objectives route then refresh the server component so the read model re-renders with the new state.

type Theme = { id: string; name: string };

async function call(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, error: j.error as string | undefined };
}

export function NewObjectiveButton({ themes }: { themes: Theme[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({ title: "", description: "", theme_id: "", framework: "okr", scope_type: "platform", target_pct: 100 });

  async function submit() {
    if (!f.title.trim()) { setErr("Title is required"); return; }
    setBusy(true); setErr(null);
    const { ok, error } = await call("/api/priorities/objectives", "POST", f);
    setBusy(false);
    if (!ok) { setErr(error ?? "Create failed"); return; }
    setOpen(false); setF({ title: "", description: "", theme_id: "", framework: "okr", scope_type: "platform", target_pct: 100 });
    router.refresh();
  }

  if (!open) return <button onClick={() => setOpen(true)} className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3.5 py-2">+ New Objective</button>;

  const input = "w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/30";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 w-full sm:w-[420px] shadow-sm">
      <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">New objective</h3><button onClick={() => { setOpen(false); setErr(null); }} className="text-gray-500 hover:text-gray-600 text-sm">✕</button></div>
      <div className="space-y-2.5">
        <input value={f.title} onChange={e => setF({ ...f, title: e.target.value })} placeholder="Objective title" className={input} autoFocus />
        <textarea value={f.description} onChange={e => setF({ ...f, description: e.target.value })} placeholder="Description (optional)" rows={2} className={input} />
        <div className="grid grid-cols-2 gap-2">
          <select value={f.theme_id} onChange={e => setF({ ...f, theme_id: e.target.value })} className={input}>
            <option value="">No theme</option>
            {themes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select value={f.framework} onChange={e => setF({ ...f, framework: e.target.value })} className={input}>
            <option value="okr">OKR</option><option value="bsc">Balanced Scorecard</option><option value="custom">Custom</option>
          </select>
          <select value={f.scope_type} onChange={e => setF({ ...f, scope_type: e.target.value })} className={input}>
            <option value="platform">Platform</option><option value="enterprise">Enterprise</option>
          </select>
          <div className="flex items-center gap-1.5"><input type="number" min={0} max={100} value={f.target_pct} onChange={e => setF({ ...f, target_pct: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} className={`${input} text-right tabular-nums`} /><span className="text-[11px] text-gray-500 shrink-0">% target</span></div>
        </div>
        {err && <p className="text-[11px] text-[var(--cmp-text-error)]">{err}</p>}
        <div className="flex items-center gap-2 pt-0.5">
          <button onClick={submit} disabled={busy} className="text-sm font-semibold text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-lg px-3.5 py-1.5">{busy ? "Creating…" : "Create draft"}</button>
          <span className="text-[11px] text-gray-500">Created as a draft — submit or publish from its row.</span>
        </div>
      </div>
    </div>
  );
}

const ACTIONS: Record<string, { action: string; label: string; cls: string }[]> = {
  draft: [
    { action: "submit", label: "Submit", cls: "text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)] hover:bg-[var(--cmp-surface-warning)]" },
    { action: "publish", label: "Publish", cls: "text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]" },
  ],
  pending: [
    { action: "publish", label: "Approve & publish", cls: "text-emerald-700 border-[var(--cmp-color-success)] hover:bg-[var(--cmp-surface-success)]" },
    { action: "withdraw", label: "Withdraw", cls: "text-gray-600 border-gray-200 hover:bg-gray-50" },
  ],
  published: [
    { action: "archive", label: "Archive", cls: "text-gray-600 border-gray-200 hover:bg-gray-50" },
  ],
  archived: [],
};

export function ObjectiveControls({ objective }: { objective: { id: string; status: string; title: string } }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const actions = ACTIONS[objective.status] ?? [];
  if (!actions.length) return null;

  async function run(action: string) {
    setBusy(action); setErr(null);
    const { ok, error } = await call(`/api/priorities/objectives?id=${objective.id}`, "PATCH", { action });
    setBusy(null);
    if (!ok) { setErr(error ?? "Failed"); return; }
    router.refresh();
  }

  return (
    <div className="flex items-center gap-1.5 mt-2">
      {actions.map(a => (
        <button key={a.action} onClick={() => run(a.action)} disabled={!!busy}
          className={`text-[11px] font-semibold border rounded-md px-2 py-0.5 disabled:opacity-50 transition-colors ${a.cls}`}>
          {busy === a.action ? "…" : a.label}
        </button>
      ))}
      {err && <span className="text-[10px] text-[var(--cmp-text-error)]">{err}</span>}
    </div>
  );
}
