"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

// Metric Formula Editor (NCP-005) — the type-specific designer on top of the Configuration Studio's governed
// METRIC objects. Define the formula, aggregation, unit, target, RAG thresholds and direction; the formula is
// validated live (balanced parens, tokens, self-reference) and persisted onto the object's `definition` via
// PATCH /api/config/objects. Metric references in the formula are wired into the object's dependencies by the
// API, so the dependency graph + publish gate account for them.
type MetricDef = { formula?: string; aggregation?: string; unit?: string | null; target?: number | null; thresholds?: { green?: number | null; amber?: number | null }; direction?: string; refresh?: string };
type Metric = { object_key: string; display_name: string; description?: string; data_source_key?: string | null; status: string; definition?: MetricDef };
type Def = { formula: string; aggregation: string; unit: string; target: string; green: string; amber: string; direction: string; refresh: string };

const AGG: [string, string][] = [["ratio", "Ratio"], ["sum", "Sum"], ["avg", "Average"], ["count", "Count"], ["latest", "Latest"], ["min", "Min"], ["max", "Max"]];
const REFRESH: [string, string][] = [["daily", "Daily"], ["real_time", "Real-time"], ["hourly", "Hourly"], ["weekly", "Weekly"]];
const FUNCS = new Set(["sum", "avg", "count", "ratio", "min", "max", "round", "abs", "pct", "if", "coalesce"]);
const input = "w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/30";
const lbl = "text-[11px] font-semibold text-gray-500";

function validate(formula: string, selfKey: string): { ok: boolean; refs: string[]; msg: string } {
  const f = formula.trim();
  if (!f) return { ok: false, refs: [], msg: "Define a formula." };
  let depth = 0;
  for (const ch of f) { if (ch === "(") depth++; else if (ch === ")") { if (--depth < 0) return { ok: false, refs: [], msg: "Unbalanced parentheses" }; } }
  if (depth !== 0) return { ok: false, refs: [], msg: "Unbalanced parentheses" };
  if (!/^[\w\s.+\-*/(),%<>=?:]+$/.test(f)) return { ok: false, refs: [], msg: "Unsupported characters" };
  const refs = [...new Set([...f.matchAll(/[a-zA-Z_][a-zA-Z0-9_.]*/g)].map(m => m[0]).filter(t => !FUNCS.has(t.toLowerCase())))];
  if (refs.includes(selfKey)) return { ok: false, refs, msg: "Formula references itself (circular)" };
  return { ok: true, refs, msg: `Valid · ${refs.length} reference${refs.length === 1 ? "" : "s"}` };
}
function ragOf(v: number, green: number, amber: number, dir: string): string {
  if (dir === "lower_better") return v <= green ? "green" : v <= amber ? "amber" : "red";
  return v >= green ? "green" : v >= amber ? "amber" : "red";
}
const RAG_TONE: Record<string, string> = { green: "bg-emerald-500", amber: "bg-amber-400", red: "bg-rose-500" };

const toForm = (m?: Metric): Def => {
  const d = m?.definition ?? {};
  return { formula: d.formula ?? "", aggregation: d.aggregation ?? "ratio", unit: d.unit ?? "", target: d.target != null ? String(d.target) : "", green: d.thresholds?.green != null ? String(d.thresholds.green) : "", amber: d.thresholds?.amber != null ? String(d.thresholds.amber) : "", direction: d.direction ?? "lower_better", refresh: d.refresh ?? "daily" };
};

export default function MetricEditor({ metrics }: { metrics: Metric[] }) {
  const router = useRouter();
  const [selKey, setSelKey] = useState<string | null>(metrics[0]?.object_key ?? null);
  const sel = metrics.find(m => m.object_key === selKey) ?? null;
  const [f, setF] = useState<Def>(toForm(metrics[0]));
  const [sample, setSample] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof Def, v: string) => setF(p => ({ ...p, [k]: v }));

  const v = useMemo(() => validate(f.formula, selKey ?? ""), [f.formula, selKey]);
  const preview = useMemo(() => {
    const val = parseFloat(sample), g = parseFloat(f.green), a = parseFloat(f.amber);
    if (isNaN(val) || isNaN(g) || isNaN(a)) return null;
    return ragOf(val, g, a, f.direction);
  }, [sample, f.green, f.amber, f.direction]);

  function pick(k: string) { setSelKey(k); setF(toForm(metrics.find(m => m.object_key === k))); setMsg(null); setSample(""); }

  async function save() {
    if (!sel) return;
    if (!v.ok) { setMsg(v.msg); return; }
    setBusy(true); setMsg(null);
    const definition = {
      formula: f.formula.trim(), aggregation: f.aggregation, unit: f.unit.trim() || null,
      target: f.target === "" ? null : Number(f.target),
      thresholds: { green: f.green === "" ? null : Number(f.green), amber: f.amber === "" ? null : Number(f.amber) },
      direction: f.direction, refresh: f.refresh,
    };
    const r = await fetch("/api/config/objects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ object_key: sel.object_key, definition }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? "✓ Definition saved onto the metric." : (d?.error || "Could not save."));
    if (r.ok) router.refresh();
  }

  const card = "bg-white rounded-xl border border-gray-200";
  if (!metrics.length) return <div className={`${card} p-8 text-center`}><p className="text-sm text-gray-500">No metric objects yet.</p><p className="text-xs text-gray-400 mt-1">Author a <b>Metric</b> in the <a href="/super-admin/platform-ops/studio" className="text-indigo-700 underline">Configuration Studio</a> first, then define its formula here.</p></div>;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className={`${card} p-4`}>
        <p className={`${lbl} mb-2`}>Metrics ({metrics.length})</p>
        <div className="space-y-1 max-h-[440px] overflow-y-auto">
          {metrics.map(m => (
            <button key={m.object_key} onClick={() => pick(m.object_key)} className={`w-full text-left rounded-lg px-2.5 py-1.5 transition-colors ${selKey === m.object_key ? "bg-indigo-50 ring-1 ring-indigo-200" : "hover:bg-gray-50"}`}>
              <p className="text-xs font-medium text-gray-800 truncate">{m.display_name}</p>
              <p className="text-[10px] text-gray-400 font-mono truncate">{m.object_key}{m.definition?.formula ? "" : " · no formula"}</p>
            </button>
          ))}
        </div>
      </div>

      <div className={`${card} p-5 lg:col-span-2`}>
        {!sel ? <p className="text-sm text-gray-400 py-16 text-center">Select a metric.</p> : (
          <>
            <h3 className="text-sm font-semibold text-gray-900">{sel.display_name}</h3>
            <p className="text-[10px] text-gray-400 font-mono mb-4">{sel.object_key}{sel.data_source_key ? ` · source: ${sel.data_source_key}` : ""}</p>

            <label className={`${lbl} block`}>Formula
              <textarea className={`${input} font-mono`} rows={2} value={f.formula} onChange={e => set("formula", e.target.value)} placeholder="sum(op_incidents.falls) / op_patients.count * 1000" />
            </label>
            <div className={`text-[11px] mt-1 flex items-center gap-2 ${v.ok ? "text-emerald-600" : "text-rose-600"}`}>
              <span>{v.ok ? "✓" : "✗"} {v.msg}</span>
              {v.refs.length > 0 && <span className="text-gray-400">refs: {v.refs.join(", ")}</span>}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <label className={lbl}>Aggregation<select className={input} value={f.aggregation} onChange={e => set("aggregation", e.target.value)}>{AGG.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></label>
              <label className={lbl}>Unit<input className={input} value={f.unit} onChange={e => set("unit", e.target.value)} placeholder="/1000" /></label>
              <label className={lbl}>Target<input className={input} type="number" value={f.target} onChange={e => set("target", e.target.value)} placeholder="2.0" /></label>
              <label className={lbl}>Refresh<select className={input} value={f.refresh} onChange={e => set("refresh", e.target.value)}>{REFRESH.map(([val, l]) => <option key={val} value={val}>{l}</option>)}</select></label>
              <label className={lbl}>Direction<select className={input} value={f.direction} onChange={e => set("direction", e.target.value)}><option value="lower_better">Lower is better</option><option value="higher_better">Higher is better</option></select></label>
              <label className={lbl}>Green ≤/≥<input className={input} type="number" value={f.green} onChange={e => set("green", e.target.value)} placeholder="2.0" /></label>
              <label className={lbl}>Amber ≤/≥<input className={input} type="number" value={f.amber} onChange={e => set("amber", e.target.value)} placeholder="3.5" /></label>
              <label className={lbl}>Preview value<input className={input} type="number" value={sample} onChange={e => setSample(e.target.value)} placeholder="test" /></label>
            </div>

            {preview && <div className="mt-3 flex items-center gap-2 text-[11px]"><span className="text-gray-500">RAG at {sample}{f.unit}:</span><span className={`w-3 h-3 rounded-full ${RAG_TONE[preview]}`} /><b className="capitalize text-gray-700">{preview}</b></div>}

            {msg && <p className={`text-xs mt-3 ${msg.startsWith("✓") ? "text-emerald-600" : "text-rose-600"}`}>{msg}</p>}
            <div className="flex items-center justify-end mt-4">
              <button onClick={save} disabled={busy || !v.ok} className="text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg px-4 py-2 disabled:opacity-50">{busy ? "Saving…" : "Save definition"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
