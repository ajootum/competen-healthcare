"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Decision-Table Editor (NCP-007 Rules & Decision Engine) — the type-specific designer on top of the
// Configuration Studio's governed BUSINESS_RULE objects. Define condition (input) and action (output) columns,
// add priority-ordered rows, and SIMULATE against sample inputs (first-match hit policy). Condition cells
// support comparators (>= <= > < = !=), exact match and any/*. Persists onto object.definition via PATCH
// /api/config/objects. The runtime decision service, decision trees and conflict salience are next-phase.
type Col = { key: string; label: string };
type Row = { conditions: Record<string, string>; actions: Record<string, string> };
type Table = { conditions: Col[]; actions: Col[]; rows: Row[]; hitPolicy?: string };
type Rule = { object_key: string; display_name: string; status: string; definition?: Table };

const input = "w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400";
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "col";
const empty = (): Table => ({ conditions: [], actions: [], rows: [], hitPolicy: "first" });

function cellMatches(cell: string, value: string): boolean {
  const c = String(cell ?? "").trim();
  if (!c || c === "*" || c.toLowerCase() === "any") return true;
  const m = c.match(/^(>=|<=|>|<|!=|=)\s*(.+)$/);
  if (m) {
    const op = m[1], rhs = m[2].trim(), num = parseFloat(value), rn = parseFloat(rhs);
    if (!isNaN(num) && !isNaN(rn) && ["<", ">", "<=", ">="].includes(op)) return op === ">=" ? num >= rn : op === "<=" ? num <= rn : op === ">" ? num > rn : num < rn;
    if (op === "=") return !isNaN(num) && !isNaN(rn) ? num === rn : value.trim().toLowerCase() === rhs.toLowerCase();
    if (op === "!=") return !isNaN(num) && !isNaN(rn) ? num !== rn : value.trim().toLowerCase() !== rhs.toLowerCase();
  }
  return value.trim().toLowerCase() === c.toLowerCase();
}

export default function RuleEditor({ rules }: { rules: Rule[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(rules[0]?.object_key ?? null);
  const sel = rules.find(r => r.object_key === selKey) ?? null;
  const [t, setT] = useState<Table>(rules[0]?.definition?.conditions ? rules[0].definition! : empty());
  const [newCond, setNewCond] = useState(""); const [newAct, setNewAct] = useState("");
  const [sim, setSim] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  function pick(k: string) { const r = rules.find(x => x.object_key === k); setSelKey(k); setT(r?.definition?.conditions ? r.definition! : empty()); setMsg(null); setSim({}); }
  const addCol = (which: "conditions" | "actions", label: string) => { if (!label.trim()) return; const have = new Set([...t.conditions, ...t.actions].map(c => c.key)); let key = slug(label); let i = 2; const b = key; while (have.has(key)) key = `${b}_${i++}`; setT(p => ({ ...p, [which]: [...p[which], { key, label: label.trim() }] })); };
  const rmCol = (which: "conditions" | "actions", key: string) => setT(p => ({ ...p, [which]: p[which].filter(c => c.key !== key), rows: p.rows.map(r => ({ conditions: which === "conditions" ? omit(r.conditions, key) : r.conditions, actions: which === "actions" ? omit(r.actions, key) : r.actions })) }));
  const addRow = () => setT(p => ({ ...p, rows: [...p.rows, { conditions: {}, actions: {} }] }));
  const setCell = (ri: number, which: "conditions" | "actions", key: string, v: string) => setT(p => ({ ...p, rows: p.rows.map((r, j) => j === ri ? { ...r, [which]: { ...r[which], [key]: v } } : r) }));
  const moveRow = (ri: number, d: number) => setT(p => { const n = [...p.rows]; const j = ri + d; if (j < 0 || j >= n.length) return p; [n[ri], n[j]] = [n[j], n[ri]]; return { ...p, rows: n }; });
  const rmRow = (ri: number) => setT(p => ({ ...p, rows: p.rows.filter((_, j) => j !== ri) }));

  const matchIdx = t.rows.findIndex(r => t.conditions.every(c => cellMatches(r.conditions[c.key] ?? "", sim[c.key] ?? "")));
  const canSim = t.conditions.length > 0 && t.conditions.some(c => (sim[c.key] ?? "").trim() !== "");

  async function save() {
    if (!sel) return;
    if (!t.actions.length) { setMsg("Add at least one action (output) column."); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: sel.object_key, definition: t }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved a ${t.rows.length}-row decision table onto the rule.` : (d?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!rules.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No business-rule objects yet.</p><p className="text-xs text-gray-400 mt-1">Author a <b>Business Rule</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then design its decision table here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Rules ({rules.length})</p>
        <div className="space-y-1 max-h-[460px] overflow-y-auto">
          {rules.map(r => <button key={r.object_key} onClick={() => pick(r.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === r.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{r.display_name}</p><p className="text-[10px] text-gray-400 truncate">{(r.definition?.rows?.length ?? 0)} row(s)</p></button>)}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!sel ? <p className="text-sm text-gray-400 py-16 text-center">Select a rule.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">{sel.display_name}</h3><span className="text-[10px] text-gray-400 font-mono">{sel.object_key}</span></div>

            {/* Columns */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <div><p className="text-[11px] font-semibold text-[var(--cmp-text-information)] mb-1">Conditions (inputs)</p><div className="flex flex-wrap gap-1 items-center">{t.conditions.map(c => <span key={c.key} className="text-[10px] bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)] rounded px-1.5 py-0.5 flex items-center gap-1">{c.label}<button onClick={() => rmCol("conditions", c.key)} className="text-sky-400 hover:text-[var(--cmp-text-error)]">✕</button></span>)}<input className={`${input} w-24 inline`} value={newCond} onChange={e => setNewCond(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addCol("conditions", newCond); setNewCond(""); } }} placeholder="+ condition" /></div></div>
              <div><p className="text-[11px] font-semibold text-[var(--cmp-text-success)] mb-1">Actions (outputs)</p><div className="flex flex-wrap gap-1 items-center">{t.actions.map(c => <span key={c.key} className="text-[10px] bg-[var(--cmp-surface-success)] text-emerald-700 rounded px-1.5 py-0.5 flex items-center gap-1">{c.label}<button onClick={() => rmCol("actions", c.key)} className="text-emerald-400 hover:text-[var(--cmp-text-error)]">✕</button></span>)}<input className={`${input} w-24 inline`} value={newAct} onChange={e => setNewAct(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { addCol("actions", newAct); setNewAct(""); } }} placeholder="+ action" /></div></div>
            </div>

            {/* Decision table */}
            {(t.conditions.length + t.actions.length) === 0 ? <p className="text-xs text-gray-400 py-4 text-center">Add condition &amp; action columns, then rows.</p> : (
              <div className="overflow-x-auto border border-gray-100 rounded-lg">
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50">
                    <th className="p-1 text-gray-400 font-medium w-8">#</th>
                    {t.conditions.map(c => <th key={c.key} className="p-1.5 text-left text-[var(--cmp-text-information)] font-semibold">{c.label}</th>)}
                    {t.actions.map(c => <th key={c.key} className="p-1.5 text-left text-emerald-700 font-semibold border-l border-gray-200">{c.label}</th>)}
                    <th className="w-12" />
                  </tr></thead>
                  <tbody>
                    {t.rows.map((row, ri) => (
                      <tr key={ri} className={`border-t border-gray-50 ${matchIdx === ri && canSim ? "bg-indigo-50/60" : ""}`}>
                        <td className="p-1 text-center text-gray-300">{ri + 1}</td>
                        {t.conditions.map(c => <td key={c.key} className="p-1"><input className={input} value={row.conditions[c.key] ?? ""} onChange={e => setCell(ri, "conditions", c.key, e.target.value)} placeholder="any" /></td>)}
                        {t.actions.map(c => <td key={c.key} className="p-1 border-l border-gray-100"><input className={input} value={row.actions[c.key] ?? ""} onChange={e => setCell(ri, "actions", c.key, e.target.value)} /></td>)}
                        <td className="p-1 whitespace-nowrap text-gray-400"><button onClick={() => moveRow(ri, -1)} className="hover:text-gray-700 px-0.5">↑</button><button onClick={() => moveRow(ri, 1)} className="hover:text-gray-700 px-0.5">↓</button><button onClick={() => rmRow(ri)} className="hover:text-[var(--cmp-text-error)] px-0.5">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <button onClick={addRow} disabled={!t.actions.length} className="text-[11px] text-indigo-700 hover:underline mt-2 disabled:opacity-40">+ Add row</button>

            {/* Simulation */}
            {t.conditions.length > 0 && (
              <div className="mt-4 rounded-lg bg-gray-50 border border-gray-100 p-3">
                <p className="text-[11px] font-semibold text-gray-500 mb-2">Simulate (first-match)</p>
                <div className="flex flex-wrap gap-2 items-end">
                  {t.conditions.map(c => <label key={c.key} className="text-[10px] text-gray-500">{c.label}<input className={`${input} w-24`} value={sim[c.key] ?? ""} onChange={e => setSim(p => ({ ...p, [c.key]: e.target.value }))} /></label>)}
                </div>
                {canSim && <div className="mt-2 text-[11px]">{matchIdx >= 0 ? <span className="text-emerald-700">→ Row {matchIdx + 1}: {t.actions.map(a => `${a.label}=${t.rows[matchIdx].actions[a.key] ?? "—"}`).join(", ")}</span> : <span className="text-gray-400">No row matched.</span>}</div>}
              </div>
            )}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save decision table"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}

function omit(o: Record<string, string>, k: string): Record<string, string> { const n = { ...o }; delete n[k]; return n; }
