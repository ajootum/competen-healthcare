// Inline area sparkline (server-rendered SVG) for the KPI ribbon. Pure — draws
// whatever real series it is given; renders nothing when there is no signal.
export default function Sparkline({ data, color = "#14b8a6", className = "" }: { data: number[]; color?: string; className?: string }) {
  const pts = (data ?? []).filter(n => typeof n === "number" && !Number.isNaN(n));
  if (pts.length < 2 || Math.max(...pts) === Math.min(...pts)) {
    // Flat / no variation → a subtle baseline rather than a fake trend.
    return <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={`w-full h-7 ${className}`}><line x1="0" y1="24" x2="100" y2="24" stroke={color} strokeOpacity="0.35" strokeWidth="1.5" /></svg>;
  }
  const min = Math.min(...pts), max = Math.max(...pts);
  const range = max - min || 1;
  const n = pts.length;
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (v: number) => 26 - ((v - min) / range) * 22;
  const line = pts.map((v, i) => `${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(" ");
  const area = `0,28 ${line} 100,28`;
  const id = `sg-${color.replace("#", "")}`;
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className={`w-full h-7 ${className}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${id})`} />
      <polyline points={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(n - 1)} cy={y(pts[n - 1])} r="1.8" fill={color} />
    </svg>
  );
}
