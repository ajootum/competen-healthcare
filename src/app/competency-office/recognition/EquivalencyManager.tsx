"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// COMP-024 — define & manage competency equivalency rules (source→target with a recognition type).
// Talks to /api/competency/equivalencies (POST create / DELETE remove).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Rule = { id: string; source: string; target: string; type: string; recognition: string; bridgingNote: string | null; createdBy: string | null };
type Comp = { id: string; name: string };

const TYPE_TONE: Record<string, string> = { exact: "bg-[var(--cmp-surface-success)] text-emerald-700", equivalent: "bg-[var(--cmp-surface-success)] text-emerald-700", conditional: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", bridging: "bg-[var(--cmp-surface-information)] text-blue-700", denied: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]" };

export default function EquivalencyManager({ rules, competencies }: { rules: Rule[]; competencies: Comp[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [srcMode, setSrcMode] = useState<"internal" | "external">("external");
  const [sourceId, setSourceId] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [targetId, setTargetId] = useState("");
  const [type, setType] = useState("equivalent");
  const [note, setNote] = useState("");
  const inp = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px]";

  async function create() {
    if (!targetId || (srcMode === "internal" ? !sourceId : !sourceLabel.trim())) return;
    setBusy(true); setErr(null);
    try {
      const body: any = { target_competency_id: targetId, equivalence_type: type, bridging_note: note || null };
      if (srcMode === "internal") body.source_competency_id = sourceId; else body.source_label = sourceLabel.trim();
      const res = await fetch("/api/competency/equivalencies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      setSourceLabel(""); setSourceId(""); setNote(""); setOpen(false); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  async function del(id: string) {
    setBusy(true); setErr(null);
    try { const res = await fetch(`/api/competency/equivalencies?id=${id}`, { method: "DELETE" }); if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; } router.refresh(); }
    catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {err && <div className="bg-[var(--cmp-surface-error)] border border-[var(--cmp-color-error)] text-[var(--cmp-text-error)] rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-500">{rules.length} equivalency rule{rules.length === 1 ? "" : "s"}</p>
        <button onClick={() => setOpen(v => !v)} className="text-[12px] bg-teal-700 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700">{open ? "Close" : "＋ New rule"}</button>
      </div>

      {open && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="text-[11px] text-gray-500 mb-0.5 block">Incoming (source)</label>
            <div className="flex gap-1 mb-1">{(["external", "internal"] as const).map(m => <button key={m} type="button" onClick={() => setSrcMode(m)} className={`text-[10px] px-2 py-0.5 rounded ${srcMode === m ? "bg-gray-800 text-white" : "text-gray-500 border border-gray-200"}`}>{m === "external" ? "External" : "Internal competency"}</button>)}</div>
            {srcMode === "internal"
              ? <select className={`${inp} w-full`} value={sourceId} onChange={e => setSourceId(e.target.value)}><option value="">— competency —</option>{competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              : <input className={`${inp} w-full`} value={sourceLabel} onChange={e => setSourceLabel(e.target.value)} placeholder="e.g. IV Cannulation (St Mary's)" />}
          </div>
          <div className="md:col-span-2"><label className="text-[11px] text-gray-500 mb-0.5 block">Maps to (local target)</label><select className={`${inp} w-full`} value={targetId} onChange={e => setTargetId(e.target.value)}><option value="">— local competency —</option>{competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="text-[11px] text-gray-500 mb-0.5 block">Recognition</label><select className={`${inp} w-full`} value={type} onChange={e => setType(e.target.value)}>{["exact", "equivalent", "conditional", "bridging", "denied"].map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}</select></div>
          <div className="flex gap-1.5"><input className={`${inp} flex-1 min-w-0`} value={note} onChange={e => setNote(e.target.value)} placeholder="Bridging note (optional)" /><button disabled={busy || !targetId} onClick={create} className="text-[12px] bg-gray-800 text-white rounded-lg px-3 disabled:opacity-40">Add</button></div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {rules.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No equivalency rules yet. Define how incoming competencies map to your local requirements.</p>}
        {rules.map(r => (
          <div key={r.id} className="p-2.5 flex items-center gap-2 text-[12px]">
            <span className="text-gray-700 flex-1 min-w-0 truncate">{r.source}</span>
            <span className="text-gray-300">→</span>
            <span className="text-gray-800 font-medium flex-1 min-w-0 truncate">{r.target}</span>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${TYPE_TONE[r.type] ?? "bg-gray-100 text-gray-600"}`}>{r.type}</span>
            <span className="text-[10px] text-gray-400 w-20 text-right hidden md:inline">{r.recognition}</span>
            <button disabled={busy} onClick={() => del(r.id)} className="text-rose-400 hover:text-[var(--cmp-text-error)] text-[11px] disabled:opacity-40">remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
