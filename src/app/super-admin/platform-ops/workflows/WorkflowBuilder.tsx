"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Workflow & Automation Builder (NCP-004) — the node/transition designer on top of the Configuration Studio's
// governed WORKFLOW objects. Add typed nodes (start/task/decision/approval/timer/notification/integration/
// ai_action/end) with per-type config, wire transitions between them (with optional branch conditions), and
// read the composed flow. Persists onto object.definition via PATCH /api/config/objects. The workflow runtime
// engine, SLA/escalation execution, retries and monitoring are honest next-phase.
type Node = { key: string; type: string; label: string; config?: Record<string, string> };
type Trans = { from: string; to: string; condition?: string };
type Def = { nodes: Node[]; transitions: Trans[] };
type Wf = { object_key: string; display_name: string; status: string; definition?: Def };

const NODE_TYPES: { value: string; label: string; icon: string; cfg?: string; ph?: string }[] = [
  { value: "start", label: "Start", icon: "▶" },
  { value: "task", label: "Task", icon: "☑", cfg: "assignee", ph: "assignee role" },
  { value: "decision", label: "Decision", icon: "◆", cfg: "condition", ph: "condition" },
  { value: "approval", label: "Approval", icon: "✔", cfg: "level", ph: "single / multi / senior" },
  { value: "timer", label: "Timer", icon: "⏱", cfg: "duration", ph: "e.g. 24h" },
  { value: "notification", label: "Notification", icon: "🔔", cfg: "channel", ph: "email / sms / in_app" },
  { value: "integration", label: "Integration", icon: "🔌", cfg: "endpoint", ph: "REST / FHIR / webhook" },
  { value: "ai_action", label: "AI Action", icon: "✨", cfg: "prompt", ph: "recommendation" },
  { value: "end", label: "End", icon: "⏹" },
];
const TM = Object.fromEntries(NODE_TYPES.map(t => [t.value, t]));
const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "node";
const empty = (): Def => ({ nodes: [], transitions: [] });
const load = (w?: Wf): Def => (w?.definition?.nodes ? { nodes: w.definition.nodes, transitions: w.definition.transitions ?? [] } : empty());

export default function WorkflowBuilder({ workflows }: { workflows: Wf[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(workflows[0]?.object_key ?? null);
  const selW = workflows.find(w => w.object_key === selKey) ?? null;
  const [d, setD] = useState<Def>(load(workflows[0]));
  const [nt, setNt] = useState("task"); const [nl, setNl] = useState("");
  const [tr, setTr] = useState({ from: "", to: "", condition: "" });
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  function pick(k: string) { setSelKey(k); setD(load(workflows.find(w => w.object_key === k))); setMsg(null); setTr({ from: "", to: "", condition: "" }); }
  function addNode() {
    if (!nl.trim()) return;
    const have = new Set(d.nodes.map(n => n.key)); let key = slug(nl); let i = 2; const b = key; while (have.has(key)) key = `${b}_${i++}`;
    setD(p => ({ ...p, nodes: [...p.nodes, { key, type: nt, label: nl.trim(), config: {} }] })); setNl("");
  }
  const setNode = (i: number, patch: Partial<Node>) => setD(p => ({ ...p, nodes: p.nodes.map((n, j) => j === i ? { ...n, ...patch } : n) }));
  const setCfg = (i: number, k: string, v: string) => setD(p => ({ ...p, nodes: p.nodes.map((n, j) => j === i ? { ...n, config: { ...n.config, [k]: v } } : n) }));
  const rmNode = (i: number) => setD(p => { const key = p.nodes[i].key; return { nodes: p.nodes.filter((_, j) => j !== i), transitions: p.transitions.filter(t => t.from !== key && t.to !== key) }; });
  function addTrans() { if (!tr.from || !tr.to) return; setD(p => ({ ...p, transitions: [...p.transitions, { from: tr.from, to: tr.to, ...(tr.condition.trim() ? { condition: tr.condition.trim() } : {}) }] })); setTr({ from: "", to: "", condition: "" }); }
  const rmTrans = (i: number) => setD(p => ({ ...p, transitions: p.transitions.filter((_, j) => j !== i) }));
  const nlabel = (k: string) => d.nodes.find(n => n.key === k)?.label ?? k;

  async function save() {
    if (!selW) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: selW.object_key, definition: d }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved ${d.nodes.length} node(s) + ${d.transitions.length} transition(s).` : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!workflows.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No workflow objects yet.</p><p className="text-xs text-gray-400 mt-1">Author a <b>Workflow</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then design it here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Workflows ({workflows.length})</p>
        <div className="space-y-1 max-h-[460px] overflow-y-auto">
          {workflows.map(w => <button key={w.object_key} onClick={() => pick(w.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === w.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{w.display_name}</p><p className="text-[10px] text-gray-400 truncate">{(w.definition?.nodes?.length ?? 0)} node(s)</p></button>)}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selW ? <p className="text-sm text-gray-400 py-16 text-center">Select a workflow.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">{selW.display_name}</h3><span className="text-[10px] text-gray-400 font-mono">{selW.object_key}</span></div>

            {/* Add node */}
            <div className="flex items-end gap-2 mb-3">
              <select className={`${input} w-36`} value={nt} onChange={e => setNt(e.target.value)}>{NODE_TYPES.map(t => <option key={t.value} value={t.value}>{t.icon} {t.label}</option>)}</select>
              <input className={`${input} flex-1`} value={nl} onChange={e => setNl(e.target.value)} onKeyDown={e => e.key === "Enter" && addNode()} placeholder="Node label" />
              <button onClick={addNode} disabled={!nl.trim()} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5 disabled:opacity-50">+ Node</button>
            </div>

            {/* Nodes */}
            {d.nodes.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">Add nodes to build the flow.</p> : (
              <div className="space-y-1.5 mb-4">
                {d.nodes.map((n, i) => (
                  <div key={n.key} className="flex items-center gap-2 border border-gray-100 rounded-lg px-2.5 py-1.5">
                    <span className="text-sm w-5 text-center shrink-0" title={TM[n.type]?.label}>{TM[n.type]?.icon}</span>
                    <input className={`${input} flex-1`} value={n.label} onChange={e => setNode(i, { label: e.target.value })} />
                    {TM[n.type]?.cfg && <input className={`${input} w-40`} value={n.config?.[TM[n.type].cfg!] ?? ""} onChange={e => setCfg(i, TM[n.type].cfg!, e.target.value)} placeholder={TM[n.type].ph} />}
                    <span className="text-[9px] text-gray-300 font-mono shrink-0">{n.key}</span>
                    <button onClick={() => rmNode(i)} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs shrink-0">✕</button>
                  </div>
                ))}
              </div>
            )}

            {/* Transitions */}
            {d.nodes.length >= 2 && (
              <div className="mb-4">
                <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Transitions</p>
                <div className="flex items-end gap-1.5 mb-2 flex-wrap">
                  <select className={`${input} w-32`} value={tr.from} onChange={e => setTr(p => ({ ...p, from: e.target.value }))}><option value="">from…</option>{d.nodes.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}</select>
                  <span className="text-gray-300 text-xs pb-1.5">→</span>
                  <select className={`${input} w-32`} value={tr.to} onChange={e => setTr(p => ({ ...p, to: e.target.value }))}><option value="">to…</option>{d.nodes.map(n => <option key={n.key} value={n.key}>{n.label}</option>)}</select>
                  <input className={`${input} w-28`} value={tr.condition} onChange={e => setTr(p => ({ ...p, condition: e.target.value }))} placeholder="condition (opt)" />
                  <button onClick={addTrans} disabled={!tr.from || !tr.to} className="text-xs font-medium text-indigo-700 border border-indigo-200 rounded-lg px-2.5 py-1.5 disabled:opacity-40 hover:bg-indigo-50">+ Link</button>
                </div>
                <div className="space-y-1">{d.transitions.map((t, i) => <div key={i} className="flex items-center gap-2 text-[11px] text-gray-600"><span>{nlabel(t.from)}</span><span className="text-gray-300">→{t.condition ? ` [${t.condition}]` : ""} →</span><span>{nlabel(t.to)}</span><button onClick={() => rmTrans(i)} className="text-gray-300 hover:text-[var(--cmp-text-error)] ml-1">✕</button></div>)}</div>
              </div>
            )}

            {/* Flow preview */}
            {d.nodes.length > 0 && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <p className="text-[11px] font-semibold text-gray-500 mb-2">Flow</p>
                <div className="space-y-1.5">
                  {d.nodes.map(n => { const out = d.transitions.filter(t => t.from === n.key); return (
                    <div key={n.key} className="text-[11px]">
                      <span className="font-medium text-gray-700">{TM[n.type]?.icon} {n.label}</span>
                      {out.length > 0 && <span className="text-gray-400"> {out.map((t, i) => <span key={i}>→{t.condition ? ` [${t.condition}]` : ""} {nlabel(t.to)}{i < out.length - 1 ? " ;" : ""}</span>)}</span>}
                    </div>
                  ); })}
                </div>
              </div>
            )}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save workflow"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
