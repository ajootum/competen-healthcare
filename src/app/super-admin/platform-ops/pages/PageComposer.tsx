"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Page & Layout Composer (NCP-001) — the layout designer on top of the Configuration Studio's governed PAGE
// objects. Compose the page on a 12-column grid: rows of proportional columns, each holding a widget (from the
// WCE-005 catalogue) or a structural component. Column widths render to their span so the canvas is WYSIWYG.
// Persists onto object.definition via PATCH /api/config/objects; referenced widgets wire into the object's
// dependencies. Free-form positioning, responsive breakpoint overrides and the runtime renderer are next-phase.
type Col = { span: number; widget: string };
type Rw = { columns: Col[] };
type Def = { grid: number; rows: Rw[] };
type Page = { object_key: string; display_name: string; status: string; definition?: Def };

const GRID = 12;
const sel = "border border-gray-200 rounded px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white w-full";
const empty = (): Def => ({ grid: GRID, rows: [] });
const load = (p?: Page): Def => (p?.definition?.rows ? { grid: p.definition.grid || GRID, rows: p.definition.rows } : empty());

export default function PageComposer({ pages, palette }: { pages: Page[]; palette: { value: string; label: string }[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(pages[0]?.object_key ?? null);
  const selPage = pages.find(p => p.object_key === selKey) ?? null;
  const [d, setD] = useState<Def>(load(pages[0]));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);

  function pick(k: string) { setSelKey(k); setD(load(pages.find(p => p.object_key === k))); setMsg(null); }
  const addRow = () => setD(p => ({ ...p, rows: [...p.rows, { columns: [{ span: 12, widget: "" }] }] }));
  const addCol = (ri: number) => setD(p => ({ ...p, rows: p.rows.map((r, j) => j === ri ? { columns: [...r.columns, { span: 6, widget: "" }] } : r) }));
  const setCol = (ri: number, ci: number, patch: Partial<Col>) => setD(p => ({ ...p, rows: p.rows.map((r, j) => j === ri ? { columns: r.columns.map((c, k) => k === ci ? { ...c, ...patch } : c) } : r) }));
  const rmCol = (ri: number, ci: number) => setD(p => ({ ...p, rows: p.rows.map((r, j) => j === ri ? { columns: r.columns.filter((_, k) => k !== ci) } : r).filter(r => r.columns.length) }));
  const moveRow = (ri: number, dl: number) => setD(p => { const n = [...p.rows]; const j = ri + dl; if (j < 0 || j >= n.length) return p; [n[ri], n[j]] = [n[j], n[ri]]; return { ...p, rows: n }; });
  const rmRow = (ri: number) => setD(p => ({ ...p, rows: p.rows.filter((_, j) => j !== ri) }));
  const rowSum = (r: Rw) => r.columns.reduce((s, c) => s + (Number(c.span) || 0), 0);

  async function save() {
    if (!selPage) return;
    const bad = d.rows.findIndex(r => rowSum(r) > GRID);
    if (bad >= 0) { setMsg(`Row ${bad + 1} exceeds the 12-column grid.`); return; }
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: selPage.object_key, definition: d }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? `✓ Saved a ${d.rows.length}-row layout onto the page.` : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!pages.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No page objects yet.</p><p className="text-xs text-gray-500 mt-1">Author a <b>Page</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then compose its layout here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Pages ({pages.length})</p>
        <div className="space-y-1 max-h-[460px] overflow-y-auto">
          {pages.map(p => <button key={p.object_key} onClick={() => pick(p.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === p.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}><p className="text-xs font-medium text-gray-800 truncate">{p.display_name}</p><p className="text-[10px] text-gray-500 truncate">{(p.definition?.rows?.length ?? 0)} row(s)</p></button>)}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selPage ? <p className="text-sm text-gray-500 py-16 text-center">Select a page.</p> : (
          <>
            <div className="flex items-center justify-between mb-4"><div><h3 className="text-sm font-semibold text-gray-900">{selPage.display_name}</h3><p className="text-[10px] text-gray-500 font-mono">{selPage.object_key} · 12-column grid</p></div><button onClick={addRow} className="text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1.5">+ Row</button></div>

            {d.rows.length === 0 ? <p className="text-xs text-gray-500 py-8 text-center border border-dashed border-gray-200 rounded-lg">Empty page — add a row to begin.</p> : (
              <div className="space-y-2">
                {d.rows.map((row, ri) => {
                  const sum = rowSum(row); const over = sum > GRID;
                  return (
                    <div key={ri} className={`rounded-lg border p-2 ${over ? "border-[var(--cmp-color-error)] bg-[var(--cmp-surface-error)]/40" : "border-gray-100 bg-gray-50/40"}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] text-gray-500">Row {ri + 1}</span>
                        <span className={`text-[10px] font-semibold ${over ? "text-[var(--cmp-text-error)]" : sum === GRID ? "text-[var(--cmp-text-success)]" : "text-gray-500"}`}>{sum}/{GRID}</span>
                        <span className="flex-1" />
                        <button onClick={() => addCol(ri)} className="text-[10px] text-indigo-700 hover:underline">+ col</button>
                        <button onClick={() => moveRow(ri, -1)} className="text-gray-500 hover:text-gray-700 text-xs px-0.5">↑</button>
                        <button onClick={() => moveRow(ri, 1)} className="text-gray-500 hover:text-gray-700 text-xs px-0.5">↓</button>
                        <button onClick={() => rmRow(ri)} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-xs px-0.5">✕</button>
                      </div>
                      <div className="flex gap-1.5">
                        {row.columns.map((col, ci) => (
                          <div key={ci} className="bg-white border border-gray-200 rounded-lg p-2 min-w-0" style={{ flex: `${col.span} 1 0%` }}>
                            <select className={sel} value={col.widget} onChange={e => setCol(ri, ci, { widget: e.target.value })}>
                              <option value="">— empty —</option>
                              {palette.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                            </select>
                            <div className="flex items-center gap-1 mt-1">
                              <select className={`${sel} w-14`} value={col.span} onChange={e => setCol(ri, ci, { span: Number(e.target.value) })}>{Array.from({ length: GRID }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select>
                              <span className="text-[9px] text-gray-500">cols</span>
                              <span className="flex-1" />
                              <button onClick={() => rmCol(ri, ci)} className="text-gray-500 hover:text-[var(--cmp-text-error)] text-[11px]">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save layout"}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
