"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

// Report & Dashboard Builder (NCP-006) — the visual composer on top of governed DASHBOARD and REPORT registry
// objects authored in the Configuration Studio. A dashboard is a 12-col grid of visualisation tiles, each bound
// to a metric (authored in NCP-005); a report is an ordered stack of sections. Both persist onto object.definition
// via PATCH /api/config/objects, which validates the blocks and wires bound metrics into object.dependencies
// (METRIC_REF) so the dependency graph + publish gate account for them. The runtime rendering/export/scheduling/
// AI-narrative engines (NCP-006 §4/§9) are honest next-phase.
type Tile = { key: string; viz: string; title: string; metric?: string; span: number };
type Section = { key: string; type: string; title: string; metric?: string };
type NF = { key: string; label: string; type: string };
type Def = {
  tiles?: Tile[]; filters?: NF[]; refresh?: { mode: string; interval?: string }; exports?: string[];
  sections?: Section[]; params?: NF[]; page?: { size: string; orientation: string }; distribution?: { formats: string[]; schedule?: string };
};
type Obj = { object_key: string; object_type: string; display_name: string; status: string; definition?: Def };
type Metric = { object_key: string; display_name: string };

const VIZ = [
  { v: "kpi_card", l: "KPI Card", i: "▦" }, { v: "table", l: "Table", i: "▤" }, { v: "pivot", l: "Pivot Table", i: "⊞" },
  { v: "line", l: "Line Chart", i: "📈" }, { v: "bar", l: "Bar Chart", i: "📊" }, { v: "pie", l: "Pie Chart", i: "◔" },
  { v: "heatmap", l: "Heat Map", i: "▩" }, { v: "treemap", l: "Treemap", i: "▬" }, { v: "scatter", l: "Scatter", i: "⁘" },
  { v: "map", l: "Map", i: "🗺" }, { v: "gauge", l: "Gauge", i: "◑" }, { v: "timeline", l: "Timeline", i: "▭" },
  { v: "calendar", l: "Calendar", i: "🗓" }, { v: "trend", l: "Trend Indicator", i: "↗" }, { v: "custom", l: "Custom Widget", i: "✦" },
];
const VM = Object.fromEntries(VIZ.map(x => [x.v, x]));
const SECT = [
  { v: "cover", l: "Cover" }, { v: "summary", l: "Summary" }, { v: "kpi_band", l: "KPI Band" }, { v: "table", l: "Table" },
  { v: "chart", l: "Chart" }, { v: "narrative", l: "AI Narrative" }, { v: "page_break", l: "Page Break" },
];
const SM = Object.fromEntries(SECT.map(x => [x.v, x.l]));
const FIELD_TYPES = ["text", "number", "date", "date_range", "dropdown", "boolean"];
const FORMATS = ["pdf", "docx", "xlsx", "csv"];
const SPANS = [2, 3, 4, 6, 8, 12];

const input = "border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 bg-white";
const freeKey = (prefix: string, have: Set<string>) => { let n = 1; while (have.has(`${prefix}_${n}`)) n++; return `${prefix}_${n}`; };
const load = (o?: Obj): Def => {
  const def = o?.definition ?? {};
  return o?.object_type === "DASHBOARD"
    ? { tiles: def.tiles ?? [], filters: def.filters ?? [], refresh: def.refresh ?? { mode: "manual" }, exports: def.exports ?? [] }
    : { sections: def.sections ?? [], params: def.params ?? [], page: def.page ?? { size: "A4", orientation: "portrait" }, distribution: def.distribution ?? { formats: [] } };
};

function MetricSelect({ value, onChange, metrics }: { value: string; onChange: (v: string) => void; metrics: Metric[] }) {
  return <select className={`${input} min-w-[8rem]`} value={value} onChange={e => onChange(e.target.value)}><option value="">— metric —</option>{metrics.map(m => <option key={m.object_key} value={m.object_key}>{m.display_name}</option>)}</select>;
}
function KeyValRows({ rows, setRows, prefix, noun }: { rows: NF[]; setRows: (fn: (r: NF[]) => NF[]) => void; prefix: string; noun: string }) {
  const add = () => setRows(r => [...r, { key: freeKey(prefix, new Set(r.map(x => x.key))), label: "", type: "text" }]);
  return (
    <div>
      <div className="space-y-1 mb-1.5">
        {rows.map((f, i) => (
          <div key={f.key} className="flex items-center gap-1.5">
            <input className={`${input} flex-1`} value={f.label} onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder={`${noun} label`} />
            <select className={`${input} w-28`} value={f.type} onChange={e => setRows(r => r.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>{FIELD_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select>
            <span className="text-[9px] text-gray-300 font-mono">{f.key}</span>
            <button onClick={() => setRows(r => r.filter((_, j) => j !== i))} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
          </div>
        ))}
      </div>
      <button onClick={add} className="text-[11px] font-medium text-indigo-700 border border-indigo-200 rounded px-2 py-0.5 hover:bg-indigo-50">+ {noun}</button>
    </div>
  );
}

export default function ReportDashboardBuilder({ objects, metrics }: { objects: Obj[]; metrics: Metric[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(objects[0]?.object_key ?? null);
  const selO = objects.find(o => o.object_key === selKey) ?? null;
  const [d, setD] = useState<Def>(load(objects[0]));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<string | null>(null);
  const isDash = selO?.object_type === "DASHBOARD";
  const metricName = (k?: string) => k ? (metrics.find(m => m.object_key === k)?.display_name ?? k) : null;

  function pick(k: string) { setSelKey(k); setD(load(objects.find(o => o.object_key === k))); setMsg(null); }
  async function save() {
    if (!selO) return;
    setBusy(true); setMsg(null);
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: selO.object_key, definition: d }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    const n = isDash ? `${(d.tiles ?? []).length} tile(s)` : `${(d.sections ?? []).length} section(s)`;
    setMsg(r.ok ? `✓ Saved ${n}.` : (j?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  // Dashboard mutators
  const tiles = d.tiles ?? [];
  const setTiles = (fn: (t: Tile[]) => Tile[]) => setD(p => ({ ...p, tiles: fn(p.tiles ?? []) }));
  const addTile = () => setTiles(t => [...t, { key: freeKey("tile", new Set(t.map(x => x.key))), viz: "kpi_card", title: "", metric: "", span: 4 }]);
  // Report mutators
  const sections = d.sections ?? [];
  const setSections = (fn: (s: Section[]) => Section[]) => setD(p => ({ ...p, sections: fn(p.sections ?? []) }));
  const addSection = () => setSections(s => [...s, { key: freeKey("section", new Set(s.map(x => x.key))), type: "summary", title: "", metric: "" }]);
  const move = (i: number, dir: -1 | 1) => setSections(s => { const j = i + dir; if (j < 0 || j >= s.length) return s; const c = [...s]; [c[i], c[j]] = [c[j], c[i]]; return c; });
  const toggleFmt = (list: string[], f: string) => list.includes(f) ? list.filter(x => x !== f) : [...list, f];

  const card = "bg-white rounded-xl border border-gray-200";
  if (!objects.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No dashboard or report objects yet.</p><p className="text-xs text-gray-400 mt-1">Author a <b>Dashboard</b> or <b>Report</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then compose it here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
      <div className={`${card} p-4`}>
        <p className="text-[11px] font-semibold text-gray-500 mb-2">Dashboards &amp; Reports ({objects.length})</p>
        <div className="space-y-1 max-h-[520px] overflow-y-auto">
          {objects.map(o => (
            <button key={o.object_key} onClick={() => pick(o.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === o.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}>
              <p className="text-xs font-medium text-gray-800 truncate flex items-center gap-1.5"><span className={`text-[8px] px-1 py-px rounded ${o.object_type === "DASHBOARD" ? "bg-[var(--cmp-surface-information)] text-[var(--cmp-text-information)]" : "bg-violet-100 text-violet-700"}`}>{o.object_type === "DASHBOARD" ? "DASH" : "RPT"}</span>{o.display_name}</p>
              <p className="text-[10px] text-gray-400 truncate">{o.object_type === "DASHBOARD" ? `${o.definition?.tiles?.length ?? 0} tile(s)` : `${o.definition?.sections?.length ?? 0} section(s)`}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-3`}>
        {!selO ? <p className="text-sm text-gray-400 py-16 text-center">Select a dashboard or report.</p> : (
          <>
            <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">{selO.display_name}</h3><span className="text-[10px] text-gray-400 font-mono">{selO.object_key}</span></div>

            {isDash ? (
              <>
                {/* Tiles */}
                <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Visualisation tiles</p><button onClick={addTile} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1">+ Tile</button></div>
                {tiles.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">Add tiles to compose the dashboard.</p> : (
                  <div className="space-y-1.5 mb-4">
                    {tiles.map((t, i) => (
                      <div key={t.key} className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2.5 py-1.5 flex-wrap">
                        <select className={`${input} w-32`} value={t.viz} onChange={e => setTiles(ts => ts.map((x, j) => j === i ? { ...x, viz: e.target.value } : x))}>{VIZ.map(v => <option key={v.v} value={v.v}>{v.i} {v.l}</option>)}</select>
                        <input className={`${input} flex-1 min-w-[7rem]`} value={t.title} onChange={e => setTiles(ts => ts.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Tile title" />
                        <MetricSelect value={t.metric ?? ""} onChange={v => setTiles(ts => ts.map((x, j) => j === i ? { ...x, metric: v } : x))} metrics={metrics} />
                        <select className={`${input} w-16`} value={t.span} onChange={e => setTiles(ts => ts.map((x, j) => j === i ? { ...x, span: Number(e.target.value) } : x))} title="grid span">{SPANS.map(s => <option key={s} value={s}>{s}/12</option>)}</select>
                        <button onClick={() => setTiles(ts => ts.filter((_, j) => j !== i))} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Dashboard settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Global filters</p>
                    <KeyValRows rows={d.filters ?? []} setRows={fn => setD(p => ({ ...p, filters: fn(p.filters ?? []) }))} prefix="filter" noun="Filter" />
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">Refresh</p>
                      <div className="flex items-center gap-1.5">
                        <select className={`${input} w-28`} value={d.refresh?.mode ?? "manual"} onChange={e => setD(p => ({ ...p, refresh: { ...p.refresh, mode: e.target.value } }))}><option value="manual">Manual</option><option value="realtime">Real-time</option><option value="scheduled">Scheduled</option></select>
                        {d.refresh?.mode === "scheduled" && <input className={`${input} w-24`} value={d.refresh?.interval ?? ""} onChange={e => setD(p => ({ ...p, refresh: { ...p.refresh, mode: p.refresh?.mode ?? "scheduled", interval: e.target.value } }))} placeholder="e.g. 15m / daily" />}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">Export options</p>
                      <div className="flex gap-2">{FORMATS.map(f => <label key={f} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(d.exports ?? []).includes(f)} onChange={() => setD(p => ({ ...p, exports: toggleFmt(p.exports ?? [], f) }))} />{f.toUpperCase()}</label>)}</div>
                    </div>
                  </div>
                </div>

                {/* Live dashboard preview */}
                {tiles.length > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[11px] font-semibold text-gray-500 mb-2">Preview <span className="font-normal text-gray-400">· 12-col grid</span></p>
                    <div className="grid gap-1.5" style={{ gridTemplateColumns: "repeat(12, minmax(0, 1fr))" }}>
                      {tiles.map(t => (
                        <div key={t.key} className="rounded-md bg-white border border-gray-200 px-2 py-1.5 min-h-[46px]" style={{ gridColumn: `span ${t.span} / span ${t.span}` }}>
                          <p className="text-[10px] text-gray-400">{VM[t.viz]?.i} {VM[t.viz]?.l}</p>
                          <p className="text-xs font-medium text-gray-800 truncate">{t.title || <span className="text-gray-300">untitled</span>}</p>
                          {metricName(t.metric) && <p className="text-[10px] text-indigo-500 truncate">↳ {metricName(t.metric)}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                {/* Report sections */}
                <div className="flex items-center justify-between mb-2"><p className="text-[11px] font-semibold text-gray-500">Report sections</p><button onClick={addSection} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-3 py-1">+ Section</button></div>
                {sections.length === 0 ? <p className="text-xs text-gray-400 py-4 text-center">Add sections to compose the report.</p> : (
                  <div className="space-y-1.5 mb-4">
                    {sections.map((s, i) => (
                      <div key={s.key} className="flex items-center gap-1.5 border border-gray-100 rounded-lg px-2 py-1.5 flex-wrap">
                        <div className="flex flex-col leading-none"><button onClick={() => move(i, -1)} disabled={i === 0} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[10px]">▲</button><button onClick={() => move(i, 1)} disabled={i === sections.length - 1} className="text-gray-300 hover:text-gray-600 disabled:opacity-30 text-[10px]">▼</button></div>
                        <select className={`${input} w-28`} value={s.type} onChange={e => setSections(ss => ss.map((x, j) => j === i ? { ...x, type: e.target.value } : x))}>{SECT.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}</select>
                        {s.type !== "page_break" && <input className={`${input} flex-1 min-w-[7rem]`} value={s.title} onChange={e => setSections(ss => ss.map((x, j) => j === i ? { ...x, title: e.target.value } : x))} placeholder="Section title" />}
                        {["kpi_band", "table", "chart"].includes(s.type) && <MetricSelect value={s.metric ?? ""} onChange={v => setSections(ss => ss.map((x, j) => j === i ? { ...x, metric: v } : x))} metrics={metrics} />}
                        <span className="text-[9px] text-gray-300 font-mono">{s.key}</span>
                        <button onClick={() => setSections(ss => ss.filter((_, j) => j !== i))} className="text-gray-300 hover:text-[var(--cmp-text-error)] text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Report settings */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-[11px] font-semibold text-gray-500 mb-1.5">Parameters</p>
                    <KeyValRows rows={d.params ?? []} setRows={fn => setD(p => ({ ...p, params: fn(p.params ?? []) }))} prefix="param" noun="Parameter" />
                  </div>
                  <div className="space-y-2">
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">Page</p>
                      <div className="flex items-center gap-1.5">
                        <select className={`${input} w-24`} value={d.page?.size ?? "A4"} onChange={e => setD(p => ({ ...p, page: { size: e.target.value, orientation: p.page?.orientation ?? "portrait" } }))}><option>A4</option><option>Letter</option><option>Legal</option></select>
                        <select className={`${input} w-28`} value={d.page?.orientation ?? "portrait"} onChange={e => setD(p => ({ ...p, page: { size: p.page?.size ?? "A4", orientation: e.target.value } }))}><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold text-gray-500 mb-1">Distribution</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="flex gap-2">{FORMATS.map(f => <label key={f} className="flex items-center gap-1 text-xs"><input type="checkbox" checked={(d.distribution?.formats ?? []).includes(f)} onChange={() => setD(p => ({ ...p, distribution: { formats: toggleFmt(p.distribution?.formats ?? [], f), schedule: p.distribution?.schedule } }))} />{f.toUpperCase()}</label>)}</div>
                        <input className={`${input} w-28`} value={d.distribution?.schedule ?? ""} onChange={e => setD(p => ({ ...p, distribution: { formats: p.distribution?.formats ?? [], schedule: e.target.value } }))} placeholder="schedule (opt)" />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Live report preview */}
                {sections.length > 0 && (
                  <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                    <p className="text-[11px] font-semibold text-gray-500 mb-2">Preview <span className="font-normal text-gray-400">· {d.page?.size} {d.page?.orientation}</span></p>
                    <div className="mx-auto bg-white border border-gray-200 rounded-md p-3 max-w-sm space-y-1.5">
                      {sections.map(s => s.type === "page_break"
                        ? <div key={s.key} className="border-t border-dashed border-gray-300 my-1 text-center text-[9px] text-gray-300">page break</div>
                        : <div key={s.key}><p className="text-[9px] text-gray-400 uppercase tracking-wide">{SM[s.type]}</p><p className="text-xs font-medium text-gray-800">{s.title || <span className="text-gray-300">untitled</span>}</p>{metricName(s.metric) && <p className="text-[10px] text-indigo-500">↳ {metricName(s.metric)}</p>}</div>)}
                    </div>
                  </div>
                )}
              </>
            )}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4"><button onClick={save} disabled={busy} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : `Save ${isDash ? "dashboard" : "report"}`}</button></div>
          </>
        )}
      </div>
    </div>
  );
}
