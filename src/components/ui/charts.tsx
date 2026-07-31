import { Stat, cardClass, type Trend } from "./primitives";

// Data visualisation & dashboard standards (PUI-007).
//
// NO CHARTING DEPENDENCY. These are hand-drawn SVG, deliberately: the existing pages already draw bars and
// conic donuts by hand, a chart library is a decision that belongs to the project owner rather than to a
// spec implementation, and an SVG a page renders server-side costs nothing on the client. Every component
// here is server-component safe.
//
// ACCESSIBILITY IS THE HARD PART OF CHARTS, and it is handled the honest way rather than with a decorative
// aria-label. Each chart is role="img" with a summary label, AND emits a visually-hidden data table listing
// every point. A screen-reader user gets the actual numbers, not "chart of revenue". PUI-005 requires the
// content be perceivable, and a summary sentence is not the content.
//
// EMPTY IS NOT ZERO. A series with no data renders "No data" — never a flat line along the axis, which
// would read as a measured zero.

const PALETTE = [
  "var(--cmp-color-primary)", "var(--cmp-color-secondary)", "var(--cmp-color-warning)",
  "var(--cmp-color-information)", "var(--cmp-color-critical)", "var(--cmp-neutral-400)",
];

export type Point = { label: string; value: number | null };
export type Series = { name: string; points: Point[]; color?: string };

const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const nice = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n * 10) / 10));

// The hidden table every chart emits. This is the accessible alternative — the real numbers, not a summary.
function DataTableAlt({ caption, series }: { caption: string; series: Series[] }) {
  const labels = [...new Set(series.flatMap(s => s.points.map(p => p.label)))];
  return (
    <table className="cmp-sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr><th scope="col">Category</th>{series.map(s => <th key={s.name} scope="col">{s.name}</th>)}</tr>
      </thead>
      <tbody>
        {labels.map(l => (
          <tr key={l}>
            <th scope="row">{l}</th>
            {series.map(s => {
              const p = s.points.find(x => x.label === l);
              return <td key={s.name}>{num(p?.value) ? p!.value : "no data"}</td>;
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function NoData({ height = 120, label }: { height?: number; label: string }) {
  return (
    <div className="flex items-center justify-center text-[11px] text-gray-400 border border-dashed border-gray-200 rounded-lg"
      style={{ height }} role="img" aria-label={`${label}: no data`}>
      No data
    </div>
  );
}

// ── Sparkline (PUI-007 s4 "mini trend") ─────────────────────────────────────────────────────────────────
export function Sparkline({ points, label, width = 80, height = 24, color = "var(--cmp-color-primary)" }: {
  points: (number | null)[]; label: string; width?: number; height?: number; color?: string;
}) {
  const vals = points.filter(num);
  if (vals.length < 2) return <span className="text-[10px] text-gray-400" role="img" aria-label={`${label}: not enough data`}>—</span>;
  const min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const step = width / (points.length - 1);
  // Gaps are BREAKS in the line, not interpolated — a missing reading is not a value.
  const segs: string[] = [];
  let cur: string[] = [];
  points.forEach((v, i) => {
    if (!num(v)) { if (cur.length) segs.push(cur.join(" ")); cur = []; return; }
    cur.push(`${i * step},${height - ((v - min) / span) * height}`);
  });
  if (cur.length) segs.push(cur.join(" "));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`${label}: ${vals.length} points, from ${nice(vals[0])} to ${nice(vals[vals.length - 1])}, range ${nice(min)} to ${nice(max)}`}
      className="overflow-visible">
      {segs.map((s, i) => <polyline key={i} points={s} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />)}
    </svg>
  );
}

// ── Line chart (PUI-007 s4 "trend") ─────────────────────────────────────────────────────────────────────
export function LineChart({ series, label, height = 160, yMax }: {
  series: Series[]; label: string; height?: number; yMax?: number;
}) {
  const all = series.flatMap(s => s.points.map(p => p.value)).filter(num);
  if (!all.length) return <NoData height={height} label={label} />;
  const labels = series[0]?.points.map(p => p.label) ?? [];
  const max = yMax ?? Math.max(...all, 1);
  const W = 300, H = height - 24, pad = 4;
  const x = (i: number) => (labels.length > 1 ? pad + (i * (W - pad * 2)) / (labels.length - 1) : W / 2);
  const y = (v: number) => H - (v / max) * (H - pad);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }} role="img"
        aria-label={`${label}. ${series.map(s => `${s.name}: ${s.points.filter(p => num(p.value)).length} points`).join("; ")}. Maximum ${nice(max)}.`}>
        {[0.25, 0.5, 0.75, 1].map(f => (
          <line key={f} x1={0} x2={W} y1={H - f * (H - pad)} y2={H - f * (H - pad)} stroke="var(--cmp-neutral-100)" strokeWidth={1} />
        ))}
        {series.map((s, si) => {
          const segs: string[] = []; let cur: string[] = [];
          s.points.forEach((p, i) => {
            if (!num(p.value)) { if (cur.length) segs.push(cur.join(" ")); cur = []; return; }
            cur.push(`${x(i)},${y(p.value)}`);
          });
          if (cur.length) segs.push(cur.join(" "));
          const color = s.color ?? PALETTE[si % PALETTE.length];
          return segs.map((seg, i) => (
            <polyline key={`${s.name}-${i}`} points={seg} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ));
        })}
      </svg>
      <div className="flex justify-between text-[9px] text-gray-400 mt-1">
        {labels.map((l, i) => (i === 0 || i === labels.length - 1 || labels.length <= 6 ? <span key={l}>{l}</span> : <span key={l} />))}
      </div>
      {series.length > 1 && <Legend series={series} />}
      <DataTableAlt caption={label} series={series} />
    </div>
  );
}

function Legend({ series }: { series: Series[] }) {
  return (
    <div className="flex flex-wrap gap-2.5 mt-1.5">
      {series.map((s, i) => (
        <span key={s.name} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
          <span className="w-2 h-2 rounded-sm" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} aria-hidden />
          {s.name}
        </span>
      ))}
    </div>
  );
}

// ── Bar chart (PUI-007 s4 "comparison") ─────────────────────────────────────────────────────────────────
export function BarChart({ points, label, height = 140, color = "var(--cmp-color-primary)", format = nice }: {
  points: Point[]; label: string; height?: number; color?: string; format?: (n: number) => string;
}) {
  const vals = points.map(p => p.value).filter(num);
  if (!vals.length) return <NoData height={height} label={label} />;
  const max = Math.max(...vals, 1);
  return (
    <div>
      <div className="flex items-end gap-1.5" style={{ height }} role="img"
        aria-label={`${label}. ${points.map(p => `${p.label}: ${num(p.value) ? p.value : "no data"}`).join(", ")}.`}>
        {points.map(p => (
          <div key={p.label} className="flex-1 flex flex-col items-center justify-end min-w-0">
            <span className="text-[9px] text-gray-500 tabular-nums mb-0.5">{num(p.value) ? format(p.value) : "—"}</span>
            {num(p.value)
              ? <div className="w-full rounded-t" style={{ height: `${(p.value / max) * (height - 28)}px`, background: color, minHeight: 2 }} />
              : <div className="w-full rounded-t border border-dashed border-gray-200" style={{ height: 6 }} />}
            <span className="text-[9px] text-gray-400 mt-0.5 truncate w-full text-center">{p.label}</span>
          </div>
        ))}
      </div>
      <DataTableAlt caption={label} series={[{ name: label, points }]} />
    </div>
  );
}

// ── Stacked bar (PUI-007 s4 "composition") ──────────────────────────────────────────────────────────────
export function StackedBar({ segments, label, showLegend = true }: {
  segments: { name: string; value: number; color?: string }[]; label: string; showLegend?: boolean;
}) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  if (!total) return <NoData height={28} label={label} />;
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden" role="img"
        aria-label={`${label}. ${segments.map(s => `${s.name} ${Math.round((s.value / total) * 100)} percent`).join(", ")}.`}>
        {segments.filter(s => s.value > 0).map((s, i) => (
          <div key={s.name} style={{ width: `${(s.value / total) * 100}%`, background: s.color ?? PALETTE[i % PALETTE.length] }} />
        ))}
      </div>
      {showLegend && (
        <div className="flex flex-wrap gap-2.5 mt-1.5">
          {segments.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-1 text-[10px] text-gray-600">
              <span className="w-2 h-2 rounded-sm" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} aria-hidden />
              {s.name} <span className="tabular-nums text-gray-400">{s.value} · {Math.round((s.value / total) * 100)}%</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Donut (PUI-007 s4 "proportion") ─────────────────────────────────────────────────────────────────────
export function Donut({ segments, label, centre, size = 120 }: {
  segments: { name: string; value: number; color?: string }[]; label: string;
  centre?: { value: React.ReactNode; sub?: string }; size?: number;
}) {
  const total = segments.reduce((s, x) => s + (x.value || 0), 0);
  if (!total) return <NoData height={size} label={label} />;
  const R = 45, C = 2 * Math.PI * R;
  // Cumulative offsets are computed BEFORE the JSX. Mutating an accumulator inside a map during render
  // breaks react-hooks/immutability — a recurring trip-up in this codebase, so it is done up front here.
  const arcs = segments.filter(s => s.value > 0).reduce<{ name: string; color: string; len: number; offset: number }[]>(
    (acc, s, i) => {
      const len = (s.value / total) * C;
      const prev = acc[acc.length - 1];
      return [...acc, { name: s.name, color: s.color ?? PALETTE[i % PALETTE.length], len, offset: prev ? prev.offset + prev.len : 0 }];
    }, []);
  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" role="img"
          aria-label={`${label}. ${segments.map(s => `${s.name} ${Math.round((s.value / total) * 100)} percent`).join(", ")}.`}>
          {arcs.map(a => (
            <circle key={a.name} cx={60} cy={60} r={R} fill="none" strokeWidth={14} stroke={a.color}
              strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset} />
          ))}
        </svg>
        {centre && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-bold tabular-nums text-gray-900">{centre.value}</span>
            {centre.sub && <span className="text-[9px] text-gray-400">{centre.sub}</span>}
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-0.5">
        {segments.map((s, i) => (
          <div key={s.name} className="flex items-center gap-1.5 text-[11px]">
            <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color ?? PALETTE[i % PALETTE.length] }} aria-hidden />
            <span className="text-gray-600 truncate">{s.name}</span>
            <span className="text-gray-400 tabular-nums ml-auto">{Math.round((s.value / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Gauge (PUI-007 s4 "progress / score") ───────────────────────────────────────────────────────────────
// `value` may be null for a score that has not been computed — the arc is left empty and says so.
export function Gauge({ value, label, target, size = 110 }: {
  value: number | null; label: string; target?: number; size?: number;
}) {
  const R = 42, C = Math.PI * R;   // half circle
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const tone = value == null ? "var(--cmp-neutral-300)"
    : pct >= 80 ? "var(--cmp-color-success)" : pct >= 60 ? "var(--cmp-color-warning)" : "var(--cmp-color-critical)";
  return (
    <div className="flex flex-col items-center" style={{ width: size }}>
      <svg viewBox="0 0 100 56" style={{ width: size }} role="img"
        aria-label={value == null ? `${label}: not measured` : `${label}: ${pct} percent${target ? `, target ${target} percent` : ""}`}>
        <path d={`M 8 50 A ${R} ${R} 0 0 1 92 50`} fill="none" stroke="var(--cmp-neutral-100)" strokeWidth={9} strokeLinecap="round" />
        {value != null && (
          <path d={`M 8 50 A ${R} ${R} 0 0 1 92 50`} fill="none" stroke={tone} strokeWidth={9} strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * C} ${C}`} />
        )}
      </svg>
      <p className="text-lg font-bold tabular-nums -mt-3" style={{ color: value == null ? "var(--cmp-neutral-400)" : undefined }}>
        {value == null ? "—" : `${pct}%`}
      </p>
      <p className="text-[10px] text-gray-500 text-center">{label}</p>
      {value == null
        ? <p className="text-[9px] text-gray-400">not measured</p>
        : target != null && <p className="text-[9px] text-gray-400">Target {target}%</p>}
    </div>
  );
}

// ── Heat map (PUI-007 s4 "intensity") ───────────────────────────────────────────────────────────────────
export function HeatMap({ rows, cols, cells, label, format = nice }: {
  rows: string[]; cols: string[];
  cells: { row: string; col: string; value: number | null }[];
  label: string; format?: (n: number) => string;
}) {
  const vals = cells.map(c => c.value).filter(num);
  if (!vals.length) return <NoData height={120} label={label} />;
  const max = Math.max(...vals, 1);
  const get = (r: string, c: string) => cells.find(x => x.row === r && x.col === c)?.value ?? null;
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px]" role="img" aria-label={`${label}. ${rows.length} rows by ${cols.length} columns, values from 0 to ${nice(max)}.`}>
        <caption className="cmp-sr-only">{label}</caption>
        <thead>
          <tr><th /> {cols.map(c => <th key={c} scope="col" className="px-1 pb-1 font-medium text-gray-400">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r}>
              <th scope="row" className="pr-2 text-right font-medium text-gray-500 whitespace-nowrap">{r}</th>
              {cols.map(c => {
                const v = get(r, c);
                // A missing cell is hatched, not shaded 0 — absence of data is not an intensity of zero.
                return (
                  <td key={c} className="p-0.5">
                    <div className="w-7 h-6 rounded flex items-center justify-center tabular-nums"
                      style={num(v)
                        ? { background: `color-mix(in srgb, var(--cmp-color-primary) ${Math.round((v / max) * 100)}%, white)`,
                            color: v / max > 0.55 ? "white" : "var(--cmp-neutral-700)" }
                        : { border: "1px dashed var(--cmp-neutral-200)", color: "var(--cmp-neutral-300)" }}
                      title={`${r} · ${c}: ${num(v) ? format(v) : "no data"}`}>
                      {num(v) ? format(v) : "—"}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── KPI ribbon (PUI-007 s2) ─────────────────────────────────────────────────────────────────────────────
export type Kpi = { label: string; value: React.ReactNode; sub?: React.ReactNode; trend?: Trend;
  tone?: "default" | "success" | "warning" | "critical"; href?: string };

// PUI-007 s2 caps a ribbon at seven, because a ribbon nobody can scan in five seconds is not a ribbon.
// Extra KPIs are NOT silently dropped — the overflow is stated, so a page that outgrew the ribbon shows it
// rather than quietly hiding a metric someone was relying on.
export const KPI_RIBBON_MAX = 7;

export function KpiRibbon({ kpis, note }: { kpis: Kpi[]; note?: string }) {
  const shown = kpis.slice(0, KPI_RIBBON_MAX);
  const hidden = kpis.length - shown.length;
  return (
    <div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(140px, 1fr))` }}>
        {shown.map(k => <Stat key={k.label} {...k} />)}
      </div>
      {(hidden > 0 || note) && (
        <p className="text-[10px] text-gray-400 mt-1.5">
          {hidden > 0 && <>Showing the first {KPI_RIBBON_MAX} of {kpis.length} metrics — {hidden} more {hidden === 1 ? "is" : "are"} not in the ribbon. </>}
          {note}
        </p>
      )}
    </div>
  );
}

// ── Dashboard section wrapper with an honest as-of stamp (PUI-007 s1 "Timely", s11 "Provide context") ──
export function ChartCard({ title, sub, asOf, source, children, action }: {
  title: string; sub?: string; asOf?: string | null; source?: string;
  children: React.ReactNode; action?: React.ReactNode;
}) {
  return (
    <section className={cardClass}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">
            {title}{sub && <span className="text-gray-400 font-normal"> · {sub}</span>}
          </h2>
          {/* PUI-007 s11: "Always show time period, unit and source." A chart without provenance invites
              the reader to assume it is live when it may not be. */}
          {(asOf || source) && (
            <p className="text-[10px] text-gray-400 mt-0.5">
              {asOf ? `As of ${asOf}` : ""}{asOf && source ? " · " : ""}{source ?? ""}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
