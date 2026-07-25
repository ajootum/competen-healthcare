// Shared server-rendered widgets for the Quality & Safety section (UMG-QS-002..011). Presentational only —
// no data access, no client hooks — so every deepened module renders a consistent KPI ribbon, donut, stacked
// trend, pipeline bar, risk heat map and RAG badge without re-declaring them.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";

export const qcard = "bg-white rounded-xl border border-gray-200";

export function QHeader({ code, title, subtitle }: { code: string; title: string; subtitle: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center text-lg">🛡️</span>
      <div><h1 className="text-2xl font-bold text-gray-900 tracking-tight">{title}</h1><p className="text-sm text-gray-500">{code} · {subtitle}</p></div>
    </div>
  );
}

export function Kpi({ icon, tint, label, value, sub, tone }: { icon: string; tint: string; label: string; value: any; sub?: string; tone?: string }) {
  return <div className={`${qcard} p-4`}><div className="flex items-center gap-2.5 mb-2"><span className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm ${tint}`}>{icon}</span><span className="text-xs font-medium text-gray-500 leading-tight">{label}</span></div><div className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</div>{sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}</div>;
}

export function Donut({ pct, color, center, sub, size = 120 }: { pct: number; color: string; center: string; sub?: string; size?: number }) {
  const inset = Math.round(size * 0.1);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size, background: `conic-gradient(${color} ${pct * 3.6}deg, #f1f5f9 0)`, borderRadius: "9999px" }}>
      <div className="absolute bg-white rounded-full flex flex-col items-center justify-center" style={{ inset }}>
        <span className="text-2xl font-bold text-gray-900 tabular-nums leading-none">{center}</span>
        {sub && <span className="text-[10px] text-gray-400 mt-0.5">{sub}</span>}
      </div>
    </div>
  );
}

export function Row({ color, label, v }: { color: string; label: string; v: any }) {
  return <div className="flex items-center gap-1.5 text-[11px]"><span className="w-2 h-2 rounded-sm shrink-0" style={{ background: color }} /><span className="text-gray-500">{label}</span><b className="ml-auto tabular-nums text-gray-700">{v}</b></div>;
}

export function Pipe({ label, n, total, color }: { label: string; n: number; total: number; color: string }) {
  const pct = total ? Math.round((n / total) * 100) : 0;
  return <div><div className="flex items-center justify-between text-xs mb-0.5"><span className="text-gray-600">{label}</span><b className="tabular-nums text-gray-800">{n}</b></div><div className="w-full h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} /></div></div>;
}

// Stacked-bar trend. meta = [{key,label,color}]; series keyed by meta.key.
export function StackedTrend({ months, series, meta }: { months: string[]; series: Record<string, number[]>; meta: { key: string; label: string; color: string }[] }) {
  const sums = months.map((_, i) => meta.reduce((n, m) => n + (series[m.key]?.[i] ?? 0), 0));
  const max = Math.max(...sums, 1);
  return (
    <div className="flex items-end justify-between gap-2 h-40 pt-2">
      {months.map((mo, i) => (
        <div key={mo + i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
          <div className="w-full flex flex-col-reverse items-center" style={{ height: "128px" }}>
            {meta.map(m => { const v = series[m.key]?.[i] ?? 0; if (!v) return null; return <div key={m.key} className="w-5 rounded-sm" style={{ height: `${(v / max) * 120}px`, background: m.color }} title={`${m.label}: ${v}`} />; })}
            {sums[i] === 0 && <div className="w-5 h-0.5 bg-gray-100 rounded" />}
          </div>
          <span className="text-[10px] text-gray-400">{mo}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendLegend({ meta, totals }: { meta: { key: string; label: string; color: string }[]; totals?: Record<string, number> }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 mt-3">{meta.map(m => <span key={m.key} className="flex items-center gap-1 text-[11px] text-gray-500"><span className="w-2 h-2 rounded-sm" style={{ background: m.color }} />{m.label}{totals ? <b className="tabular-nums text-gray-700">{totals[m.key] ?? 0}</b> : null}</span>)}</div>;
}

export const riskCellTone = (score: number) => (score >= 15 ? "bg-rose-500 text-white" : score >= 10 ? "bg-orange-400 text-white" : score >= 5 ? "bg-amber-300 text-amber-900" : "bg-emerald-400/80 text-emerald-950");

// 5×5 risk heat map. `count(l, im)` returns the cell count for likelihood l (1-5) × impact im (1-5).
export function RiskHeat({ count }: { count: (l: number, im: number) => number }) {
  return (
    <div className="flex gap-2">
      <div className="flex flex-col justify-between text-[9px] text-gray-400 py-1"><span>5</span><span>Likelihood</span><span>1</span></div>
      <div className="flex-1">
        <div className="grid grid-cols-5 gap-1">
          {[5, 4, 3, 2, 1].map(l => [1, 2, 3, 4, 5].map(im => { const n = count(l, im); const score = l * im; return <div key={`${l}-${im}`} className={`aspect-square rounded flex items-center justify-center text-[11px] font-bold ${n ? riskCellTone(score) : "bg-gray-50 text-gray-200"}`} title={`Likelihood ${l} × Impact ${im} = ${score}`}>{n || ""}</div>; }))}
        </div>
        <div className="flex justify-between text-[9px] text-gray-400 mt-1 px-0.5"><span>1</span><span>Impact</span><span>5</span></div>
      </div>
    </div>
  );
}

const RAG_TONE: Record<string, string> = { green: "bg-emerald-50 text-emerald-700 border-emerald-100", amber: "bg-amber-50 text-amber-700 border-amber-100", red: "bg-rose-50 text-rose-700 border-rose-100", gray: "bg-gray-50 text-gray-500 border-gray-100" };
export function Rag({ tone, label }: { tone: "green" | "amber" | "red" | "gray"; label: string }) {
  return <span className={`inline-block text-[10px] font-semibold rounded-full px-2 py-0.5 border ${RAG_TONE[tone]}`}>{label}</span>;
}

export function NextPhase({ children }: { children: any }) {
  return <p className="text-[11px] text-gray-400 pb-4">{children}</p>;
}

export function CrossLink({ href, children }: { href: string; children: any }) {
  return <Link href={href} className="inline-block text-sm font-medium text-rose-700 hover:underline">{children} →</Link>;
}
