// Concrete widget components (NCP-015 / NCP-002) — presentational renderers keyed by visualisation type. They
// draw the real structure carried by the metric/widget DEFINITION (title, target, RAG thresholds, unit, columns),
// so a composed dashboard/page renders as an actual widget board rather than blank name cards. Live numeric values
// need the metric calculation runtime (NCP-005 next-phase); until then a metric-bound widget shows its target +
// RAG spec, which is real configuration, and unbound widgets show their type + a bind hint (honest, not faked).
/* eslint-disable @typescript-eslint/no-explicit-any */

const VIZ_ICON: Record<string, string> = { kpi_card: "▦", table: "▤", pivot: "⊞", line: "📈", bar: "📊", pie: "◔", heatmap: "▩", treemap: "▬", scatter: "⁘", map: "🗺", gauge: "◑", timeline: "▭", calendar: "🗓", trend: "↗", custom: "✦" };
const CHART = new Set(["line", "bar", "pie", "scatter", "heatmap", "treemap", "map", "timeline", "calendar"]);

// RAG band derived from the metric's real thresholds + direction (order flips with direction).
function RagBand({ def }: { def: any }) {
  const g = def?.thresholds?.green, a = def?.thresholds?.amber;
  if (g == null && a == null) return null;
  const lower = (def?.direction ?? "lower_better") === "lower_better";
  const segs = lower ? ["bg-emerald-400", "bg-amber-300", "bg-rose-400"] : ["bg-rose-400", "bg-amber-300", "bg-emerald-400"];
  const labels = lower ? [`≤${g ?? "?"}`, `≤${a ?? "?"}`, `>${a ?? "?"}`] : [`<${a ?? "?"}`, `≥${a ?? "?"}`, `≥${g ?? "?"}`];
  return (
    <div className="mt-2">
      <div className="flex h-1.5 rounded overflow-hidden">{segs.map((s, i) => <div key={i} className={`flex-1 ${s}`} />)}</div>
      <div className="flex justify-between text-[8px] text-gray-400 mt-0.5 font-mono">{labels.map((l, i) => <span key={i}>{l}</span>)}</div>
    </div>
  );
}

// A dashboard tile: metric-bound → target headline + RAG; chart type → framed with the metric spec; else a hint.
export function Tile({ tile }: { tile: any }) {
  const m = tile.metric;
  const def = m?.definition ?? {};
  const icon = VIZ_ICON[tile.viz] ?? "▦";
  const target = def?.target;
  const unit = def?.unit ?? "";

  return (
    <div className="h-full flex flex-col">
      <p className="text-[10px] text-gray-400 flex items-center gap-1"><span>{icon}</span><span className="uppercase tracking-wide">{tile.viz.replace(/_/g, " ")}</span></p>
      <p className="text-sm font-medium text-gray-800 truncate">{tile.title || tile.key}</p>
      {m ? (
        <div className="mt-auto pt-1">
          {CHART.has(tile.viz) ? (
            <div className="rounded bg-gradient-to-t from-indigo-50 to-transparent border-b-2 border-indigo-200 h-8 flex items-end justify-center"><span className="text-[9px] text-indigo-300 mb-1">{m.name}</span></div>
          ) : (
            <p className="text-lg font-bold text-gray-900 tabular-nums">{target != null && target !== "" ? <>{target}<span className="text-xs text-gray-400 font-normal ml-0.5">{unit}</span></> : <span className="text-sm text-gray-300 font-normal">{m.name}</span>}<span className="block text-[9px] text-gray-400 font-normal">{target != null && target !== "" ? "target" : ""}</span></p>
          )}
          <RagBand def={def} />
        </div>
      ) : (
        <p className="text-[10px] text-gray-300 mt-auto pt-2">no metric bound</p>
      )}
    </div>
  );
}

// A page widget: renders by the WIDGET definition kind when known, else the object name + type.
export function WidgetCard({ widget }: { widget: any }) {
  const def = widget?.definition ?? {};
  const kind = def?.kind || (widget?.external ? "structural" : "widget");
  return (
    <div className="h-full">
      <p className="text-sm font-medium text-gray-800 truncate">{widget?.name ?? "—"}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{kind}{def?.data_source_key ? ` · ${def.data_source_key}` : ""}</p>
      {def?.data_source_key ? <div className="mt-2 rounded bg-gray-50 border border-gray-100 h-6" /> : null}
    </div>
  );
}
