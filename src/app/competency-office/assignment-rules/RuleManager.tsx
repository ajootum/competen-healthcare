"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// COMP-018 — define, apply & manage competency assignment rules (population × competency × cadence).
// Talks to /api/competency/assignment-rules (POST create / DELETE remove) and .../{id}/apply (materialise).
/* eslint-disable @typescript-eslint/no-explicit-any */
type Rule = { id: string; name: string; competency: string; targetRole: string | null; targetLabel: string; priority: string; dueDays: number; recurrence: number | null; population: number; generated: number; active: boolean };
type Comp = { id: string; name: string };

const PRIO_TONE: Record<string, string> = { high: "bg-rose-100 text-rose-700", medium: "bg-amber-100 text-amber-700", low: "bg-gray-100 text-gray-600" };
const ANY = "__any__";

export default function RuleManager({ rules, competencies, roles }: { rules: Rule[]; competencies: Comp[]; roles: string[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [compId, setCompId] = useState("");
  const [role, setRole] = useState(ANY);
  const [label, setLabel] = useState("");
  const [priority, setPriority] = useState("medium");
  const [dueDays, setDueDays] = useState("30");
  const [recur, setRecur] = useState("");
  const inp = "border border-gray-200 rounded-lg px-2.5 py-1.5 text-[12px]";

  async function create() {
    const comp = competencies.find(c => c.id === compId);
    if (!name.trim() || !comp) { setErr("A rule name and a competency are required"); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const body: any = {
        name: name.trim(), competency_id: comp.id, competency_name: comp.name,
        target_role: role === ANY ? null : role, target_label: label.trim() || null,
        priority, due_days: Number(dueDays) || 30, recurrence_months: recur.trim() ? Number(recur) : null,
      };
      const res = await fetch("/api/competency/assignment-rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; }
      setName(""); setCompId(""); setRole(ANY); setLabel(""); setPriority("medium"); setDueDays("30"); setRecur(""); setOpen(false); router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  async function apply(id: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetch(`/api/competency/assignment-rules/${id}/apply`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(j.error ?? `Error ${res.status}`); return; }
      setMsg(j.already ? "Already assigned — no duplicate created." : "Assignment created — tracked in the Assignment Centre.");
      router.refresh();
    } catch { setErr("Network error"); } finally { setBusy(false); }
  }
  async function del(id: string) {
    setBusy(true); setErr(null); setMsg(null);
    try { const res = await fetch(`/api/competency/assignment-rules?id=${id}`, { method: "DELETE" }); if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error ?? `Error ${res.status}`); return; } router.refresh(); }
    catch { setErr("Network error"); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      {err && <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-3 py-2 text-[12px]">{err}</div>}
      {msg && <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-3 py-2 text-[12px]">{msg}</div>}
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-gray-500">{rules.length} assignment rule{rules.length === 1 ? "" : "s"}</p>
        <button onClick={() => setOpen(v => !v)} className="text-[12px] bg-teal-600 text-white rounded-lg px-3 py-1.5 hover:bg-teal-700">{open ? "Close" : "＋ New rule"}</button>
      </div>

      {open && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 grid grid-cols-1 md:grid-cols-6 gap-2 items-end">
          <div className="md:col-span-3"><label className="text-[11px] text-gray-500 mb-0.5 block">Rule name</label><input className={`${inp} w-full`} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. ICU nurses — Sepsis pathway" /></div>
          <div className="md:col-span-3"><label className="text-[11px] text-gray-500 mb-0.5 block">Competency</label><select className={`${inp} w-full`} value={compId} onChange={e => setCompId(e.target.value)}><option value="">— competency —</option>{competencies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div className="md:col-span-2"><label className="text-[11px] text-gray-500 mb-0.5 block">Target role</label><select className={`${inp} w-full`} value={role} onChange={e => setRole(e.target.value)}><option value={ANY}>Any (all staff)</option>{roles.map(r => <option key={r} value={r}>{r.replace(/_/g, " ")}</option>)}</select></div>
          <div className="md:col-span-2"><label className="text-[11px] text-gray-500 mb-0.5 block">Population label (optional)</label><input className={`${inp} w-full`} value={label} onChange={e => setLabel(e.target.value)} placeholder="e.g. ICU Nurses" /></div>
          <div><label className="text-[11px] text-gray-500 mb-0.5 block">Priority</label><select className={`${inp} w-full`} value={priority} onChange={e => setPriority(e.target.value)}>{["low", "medium", "high"].map(p => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</select></div>
          <div><label className="text-[11px] text-gray-500 mb-0.5 block">Due (days)</label><input className={`${inp} w-full`} type="number" min={1} value={dueDays} onChange={e => setDueDays(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-2 md:col-span-2">
            <div><label className="text-[11px] text-gray-500 mb-0.5 block">Recur (months)</label><input className={`${inp} w-full`} type="number" min={1} value={recur} onChange={e => setRecur(e.target.value)} placeholder="one-off" /></div>
            <div className="flex items-end"><button disabled={busy || !name.trim() || !compId} onClick={create} className="w-full text-[12px] bg-gray-800 text-white rounded-lg px-3 py-1.5 disabled:opacity-40">Create rule</button></div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-50">
        {rules.length === 0 && <p className="text-sm text-gray-400 p-6 text-center">No assignment rules yet. Define a population × competency × cadence, then apply it to materialise assignments.</p>}
        {rules.map(r => (
          <div key={r.id} className="p-2.5 flex items-center gap-2 text-[12px] flex-wrap">
            <div className="flex-1 min-w-[10rem]">
              <div className="flex items-center gap-1.5"><span className="font-medium text-gray-800 truncate">{r.name}</span>{!r.active && <span className="text-[10px] text-gray-400">(inactive)</span>}</div>
              <p className="text-[11px] text-gray-500 truncate">{r.competency} · {r.targetLabel}</p>
            </div>
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${PRIO_TONE[r.priority] ?? "bg-gray-100 text-gray-600"}`}>{r.priority}</span>
            <span className="text-[11px] text-gray-500 w-20 text-right"><span className="font-semibold text-gray-800 tabular-nums">{r.population}</span> staff</span>
            <span className="text-[11px] text-gray-500 w-24 text-right"><span className="font-semibold text-gray-800 tabular-nums">{r.generated}</span> generated</span>
            <span className="text-[11px] text-gray-400 w-16 text-right">{r.recurrence ? `${r.recurrence}mo` : "one-off"}</span>
            <button disabled={busy} onClick={() => apply(r.id)} className="text-[11px] bg-teal-600 text-white rounded-lg px-2.5 py-1 hover:bg-teal-700 disabled:opacity-40">Apply</button>
            <button disabled={busy} onClick={() => del(r.id)} className="text-rose-400 hover:text-rose-600 text-[11px] disabled:opacity-40">remove</button>
          </div>
        ))}
      </div>
    </div>
  );
}
