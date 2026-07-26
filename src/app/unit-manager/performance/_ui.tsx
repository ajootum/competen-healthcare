// Shared UI kit for the UMW Performance Analytics section (PA-001..009). Light UMW shell (the unit-manager layout
// gates hospital_admin/super_admin). Pure server components + one guard so each module page stays lean: RAG-aware KPI
// cards, sparklines, donuts, rings, radar, bars and the shared 9-module sub-nav.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export async function paGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  return { admin, isSuper: roles.includes("super_admin"), hid: (profile?.hospital_id ?? null) as string | null };
}

export const PILL: Record<string, string> = { slate: "bg-gray-100 text-gray-600", blue: "bg-blue-50 text-blue-700", emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-700", rose: "bg-rose-50 text-rose-700", violet: "bg-violet-50 text-violet-700", teal: "bg-teal-50 text-teal-700" };

export function Head({ code, title, sub, actions }: { code: string; title: string; sub?: string; actions?: any }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[11px] font-semibold text-indigo-600 uppercase tracking-wide">{code}</p>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

const MODULES: [string, string, string][] = [
  ["001", "Dashboard", "/unit-manager/performance"],
  ["002", "KPI & Scorecard", "/unit-manager/performance/scorecard"],
  ["003", "Trends & Benchmarking", "/unit-manager/performance/trends"],
  ["004", "Workforce", "/unit-manager/performance/workforce"],
  ["005", "Operational", "/unit-manager/performance/operational"],
  ["006", "Financial", "/unit-manager/performance/financial"],
  ["007", "Predictive & AI", "/unit-manager/performance/predictive"],
  ["008", "Reporting & Governance", "/unit-manager/performance/reporting"],
  ["009", "Configuration", "/unit-manager/performance/configuration"],
];
export function Tabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
      {MODULES.map(([code, label, href]) => (
        <Link key={code} href={href} className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${active === code ? "border-indigo-500 text-indigo-700 bg-indigo-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}>
          <span className="text-gray-300 mr-1">{code}</span>{label}
        </Link>
      ))}
    </div>
  );
}

export function Card({ title, right, children, className }: { title?: string; right?: any; children: any; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-4 ${className ?? ""}`}>
      {(title || right) && <div className="flex items-center justify-between mb-3 gap-2"><h3 className="text-sm font-semibold text-gray-900">{title}</h3>{right}</div>}
      {children}
    </div>
  );
}

export function Pill({ text, tone }: { text: string; tone?: string }) {
  return <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${PILL[tone ?? "slate"]}`}>{String(text).replace(/_/g, " ")}</span>;
}

export function Progress({ pct, tone }: { pct: number; tone?: string }) {
  const color = tone ?? (pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-indigo-500" : pct >= 25 ? "bg-amber-500" : "bg-rose-500");
  return <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

// Sparkline from a real number series.
export function Spark({ series, tone = "#6366f1" }: { series?: number[]; tone?: string }) {
  if (!series || series.length < 2) return <div className="h-6" />;
  const w = 120, h = 24, min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-1" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={tone} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

// KPI stat card with RAG accent, value, sub, delta and optional sparkline.
export function Kpi({ label, value, sub, status, delta, deltaUp, series }: { label: string; value: any; sub?: string; status?: "green" | "amber" | "red"; delta?: string; deltaUp?: boolean | null; series?: number[] }) {
  const bar = status === "green" ? "bg-emerald-500" : status === "amber" ? "bg-amber-500" : status === "red" ? "bg-rose-500" : "bg-indigo-500";
  const sparkTone = status === "green" ? "#10b981" : status === "amber" ? "#f59e0b" : status === "red" ? "#f43f5e" : "#6366f1";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5 relative overflow-hidden">
      <span className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />
      <p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className="text-2xl font-bold tabular-nums mt-1 text-gray-900">{value}</p>
      <div className="flex items-center gap-2 mt-0.5">
        {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
        {delta && <p className={`text-[11px] font-medium ${deltaUp ? "text-emerald-600" : "text-rose-600"}`}>{deltaUp ? "▲" : "▼"} {delta}</p>}
      </div>
      {series && <Spark series={series} tone={sparkTone} />}
    </div>
  );
}

// Donut (segments + centre value).
export function Donut({ segs, total, centre, sub, size = 120 }: { segs: { n: number; color: string }[]; total: number; centre: any; sub?: string; size?: number }) {
  const R = size * 0.38, C = 2 * Math.PI * R, t = total || 1, mid = size / 2;
  const arr = segs.map((s, i) => ({ ...s, len: (s.n / t) * C, off: segs.slice(0, i).reduce((a, x) => a + (x.n / t) * C, 0) }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="12" />
      {arr.map((s, i) => <circle key={i} cx={mid} cy={mid} r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.off} transform={`rotate(-90 ${mid} ${mid})`} />)}
      <text x={mid} y={mid - 1} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.2}>{centre}</text>
      {sub && <text x={mid} y={mid + 15} textAnchor="middle" className="fill-gray-400" fontSize="9">{sub}</text>}
    </svg>
  );
}

// Circular percentage ring (scores).
export function Ring({ pct, size = 76, label, sub }: { pct: number; size?: number; label?: string; sub?: string }) {
  const R = size * 0.4, C = 2 * Math.PI * R, len = (Math.max(0, Math.min(100, pct)) / 100) * C, mid = size / 2;
  const color = pct >= 85 ? "#10b981" : pct >= 70 ? "#6366f1" : pct >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={C * 0.25} transform={`rotate(-90 ${mid} ${mid})`} />
        <text x={mid} y={mid + 2} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.26}>{pct}</text>
        <text x={mid} y={mid + size * 0.2} textAnchor="middle" className="fill-gray-400" fontSize={size * 0.1}>/100</text>
      </svg>
      {label && <p className="text-[11px] text-gray-600 mt-1 text-center font-medium">{label}</p>}
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

// Radar chart (balanced scorecard perspectives).
export function Radar({ points }: { points: { label: string; value: number }[] }) {
  const size = 200, mid = size / 2, R = size * 0.36, n = points.length;
  const pt = (v: number, i: number) => { const ang = (Math.PI * 2 * i) / n - Math.PI / 2; const r = (Math.max(0, Math.min(100, v)) / 100) * R; return [mid + r * Math.cos(ang), mid + r * Math.sin(ang)]; };
  const ring = (frac: number) => points.map((_, i) => { const ang = (Math.PI * 2 * i) / n - Math.PI / 2; return `${mid + R * frac * Math.cos(ang)},${mid + R * frac * Math.sin(ang)}`; }).join(" ");
  const poly = points.map((p, i) => pt(p.value, i).join(",")).join(" ");
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      {[0.25, 0.5, 0.75, 1].map(f => <polygon key={f} points={ring(f)} fill="none" stroke="#e5e7eb" strokeWidth="1" />)}
      {points.map((_, i) => { const [x, y] = pt(100, i); return <line key={i} x1={mid} y1={mid} x2={x} y2={y} stroke="#e5e7eb" strokeWidth="1" />; })}
      <polygon points={poly} fill="#6366f1" fillOpacity="0.18" stroke="#6366f1" strokeWidth="2" />
      {points.map((p, i) => { const [x, y] = pt(112, i); return <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-gray-500" fontSize="8">{p.label.split(" ")[0]}</text>; })}
    </svg>
  );
}

// Labelled horizontal bar.
export function HBar({ label, value, max, tone, right }: { label: string; value: number; max: number; tone?: string; right?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-600 flex-1 truncate">{label}</span>
      <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(value / (max || 1)) * 100}%`, background: tone ?? "#6366f1" }} /></div>
      <span className="text-gray-900 font-semibold tabular-nums w-14 text-right">{right ?? value}</span>
    </div>
  );
}

export function RagDot({ status }: { status: string }) {
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${status === "green" ? "bg-emerald-500" : status === "amber" ? "bg-amber-500" : "bg-rose-500"}`} />;
}

export function TrendArrow({ up }: { up: boolean | null }) {
  if (up == null) return <span className="text-gray-300">→</span>;
  return <span className={up ? "text-emerald-500" : "text-rose-500"}>{up ? "↗" : "↘"}</span>;
}

export function Provision({ module }: { module: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
      <p className="font-semibold text-amber-900">⚙️ Performance analytics not provisioned</p>
      <p className="text-sm text-amber-800 mt-1">Apply migration <code className="font-mono">108-performance-analytics.sql</code> then seed with <code className="font-mono">node scripts/seed-performance-analytics.mjs</code> to activate {module}.</p>
    </div>
  );
}

export function Foot({ children }: { children: any }) {
  return <p className="text-[11px] text-gray-400">{children}</p>;
}
