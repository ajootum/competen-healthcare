// Shared dark-wallboard UI kit for the UMW-OPC Operational Command Centre (OPC-002..011). Every module renders a
// dark command surface (bg-slate-900) inside the light UMW shell, over the live operational stores. These are pure
// server components (presentational SVG/markup) plus one shared auth+role guard so each module page stays lean.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import UnitFilters from "../UnitFilters";
import { estateRolesOf } from "@/lib/roles";

export const dcard = "bg-slate-800/60 border border-slate-700/70 rounded-xl";
export const NONE = "00000000-0000-0000-0000-000000000000";
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const fmtT = (t: string | null | undefined) => { if (!t) return ""; try { return new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); } catch { return ""; } };
export const missing = (e: any) => /does not exist|schema cache/i.test(String(e?.message ?? ""));

// Shared auth + hospital_admin/super_admin gate for every OPC module page.
export async function opcGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = estateRolesOf(profile);
  if (!roles.some((r: string) => ["hospital_admin", "super_admin"].includes(r))) redirect("/dashboard");
  return { admin, roles, isSuper: roles.includes("super_admin"), hid: (profile?.hospital_id ?? null) as string | null };
}

// Light top strip (breadcrumb code + title + unit filters), matching the rest of the UMW shell.
export function TopStrip({ code, title, departments }: { code: string; title: string; departments: any[] }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="text-[11px] text-gray-400 font-medium">{code}</p><h1 className="text-xl font-bold text-gray-900">{title}</h1></div>
      <UnitFilters departments={departments} />
    </div>
  );
}

// Dark-surface header row with LIVE pulse + right-aligned meta.
export function SurfaceHead({ title, meta, refresh }: { title: string; meta?: string; refresh?: string }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <h2 className="text-lg font-bold text-white">{title}</h2>
      <span className="text-[10px] font-semibold text-emerald-300 bg-[var(--cmp-color-success)]/15 rounded px-1.5 py-0.5 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-[var(--cmp-color-success)] animate-pulse" />LIVE</span>
      <span className="flex-1" />
      {refresh && <span className="text-[10px] text-slate-500">auto-refresh {refresh}</span>}
      {meta && <span className="text-[11px] text-slate-400">{meta}</span>}
    </div>
  );
}

export function Card({ title, right, children, className, pad = "p-4" }: { title?: string; right?: any; children: any; className?: string; pad?: string }) {
  return (
    <div className={`${dcard} ${pad} ${className ?? ""}`}>
      {(title || right) && <div className="flex items-center justify-between mb-3 gap-2"><h3 className="text-sm font-semibold text-white">{title}</h3>{right}</div>}
      {children}
    </div>
  );
}

// Tiny sparkline from a real number series (no series → nothing renders).
export function Spark({ series, color = "#22c55e" }: { series?: number[]; color?: string }) {
  if (!series || series.length < 2) return null;
  const w = 120, h = 26, min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const pts = series.map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / span) * (h - 4) - 2}`).join(" ");
  return <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-6 mt-1.5" preserveAspectRatio="none"><polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

export function Kpi({ label, value, sub, tone, delta, deltaUp, series, sparkColor }: { label: string; value: any; sub?: any; tone?: string; delta?: string; deltaUp?: boolean; series?: number[]; sparkColor?: string }) {
  return (
    <div className={`${dcard} p-3.5`}>
      <p className="text-[10px] text-slate-400 uppercase tracking-wide truncate">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
      {delta && <p className={`text-[10px] mt-0.5 ${deltaUp ? "text-emerald-400" : "text-rose-400"}`}>{deltaUp ? "▲" : "▼"} {delta}</p>}
      <Spark series={series} color={sparkColor} />
    </div>
  );
}

// Traffic-light status tile (Live Unit Status domains).
export function StatusTile({ label, status, value, sub }: { label: string; status: "GREEN" | "AMBER" | "RED"; value: any; sub?: string }) {
  const tone = status === "GREEN" ? { t: "text-emerald-400", b: "border-emerald-500/40", d: "bg-[var(--cmp-color-success)]" } : status === "AMBER" ? { t: "text-amber-400", b: "border-amber-500/40", d: "bg-[var(--cmp-color-warning)]" } : { t: "text-rose-400", b: "border-rose-500/40", d: "bg-[var(--cmp-color-error)]" };
  return (
    <div className={`${dcard} ${tone.b} p-3.5`}>
      <div className="flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${tone.d}`} /><p className="text-[10px] text-slate-300 truncate">{label}</p></div>
      <p className={`text-lg font-bold mt-1 ${tone.t}`}>{status}</p>
      <p className="text-xl font-bold text-white tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// Donut (segments over a track) with a centred value.
export function Donut({ segs, total, centre, sub, size = 110 }: { segs: { n: number; color: string }[]; total: number; centre: any; sub?: string; size?: number }) {
  const R = size * 0.38, C = 2 * Math.PI * R, t = total || 1, mid = size / 2;
  const arr = segs.map((s, i) => ({ ...s, len: (s.n / t) * C, off: segs.slice(0, i).reduce((a, x) => a + (x.n / t) * C, 0) }));
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={mid} cy={mid} r={R} fill="none" stroke="#1e293b" strokeWidth="12" />
      {arr.map((s, i) => <circle key={i} cx={mid} cy={mid} r={R} fill="none" stroke={s.color} strokeWidth="12" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.off} transform={`rotate(-90 ${mid} ${mid})`} strokeLinecap="butt" />)}
      <text x={mid} y={mid - 2} textAnchor="middle" className="fill-white font-bold" fontSize={size * 0.19}>{centre}</text>
      {sub && <text x={mid} y={mid + 14} textAnchor="middle" className="fill-slate-400" fontSize="9">{sub}</text>}
    </svg>
  );
}

// Half-gauge 0-100 (health / risk scores).
export function Gauge({ v, invert }: { v: number; invert?: boolean }) {
  const R = 34, C = Math.PI * R, len = (Math.max(0, Math.min(100, v)) / 100) * C;
  const good = invert ? v <= 30 : v >= 85, mid = invert ? v <= 60 : v >= 70;
  const color = good ? "#22c55e" : mid ? "#f59e0b" : "#f43f5e";
  return (
    <svg width="90" height="54" viewBox="0 0 90 54"><path d="M 11 48 A 34 34 0 0 1 79 48" fill="none" stroke="#1e293b" strokeWidth="8" strokeLinecap="round" />
      <path d="M 11 48 A 34 34 0 0 1 79 48" fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${len} ${C}`} />
      <text x="45" y="44" textAnchor="middle" className="fill-white font-bold" fontSize="18">{v}</text>
    </svg>
  );
}

// Small circular percentage ring (forecast accuracy / indicator tiles).
export function Ring({ pct: p, label, sub, size = 64 }: { pct: number; label?: string; sub?: string; size?: number }) {
  const R = size * 0.4, C = 2 * Math.PI * R, len = (Math.max(0, Math.min(100, p)) / 100) * C, mid = size / 2;
  const color = p >= 85 ? "#22c55e" : p >= 70 ? "#84cc16" : p >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={C * 0.25} transform={`rotate(-90 ${mid} ${mid})`} />
        <text x={mid} y={mid + 4} textAnchor="middle" className="fill-white font-bold" fontSize={size * 0.24}>{p}%</text>
      </svg>
      {label && <p className="text-[10px] text-slate-300 mt-1 text-center leading-tight">{label}</p>}
      {sub && <p className="text-[9px] text-slate-500">{sub}</p>}
    </div>
  );
}

// Labelled horizontal bars — priority/category distributions.
export function Bars({ rows, max }: { rows: { label: string; n: number; color: string; extra?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map(r => r.n));
  return (
    <div className="space-y-2">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="text-slate-400 w-20 shrink-0 truncate">{r.label}</span>
          <div className="flex-1 h-2 rounded-full bg-slate-700/70 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.n / m) * 100}%`, background: r.color }} /></div>
          <span className="text-white font-semibold tabular-nums w-16 text-right">{r.extra ?? r.n}</span>
        </div>
      ))}
    </div>
  );
}

// Single labelled progress line (coverage / compliance rows).
export function HBar({ label, pct: p, right, tone }: { label: string; pct: number; right?: string; tone?: string }) {
  const color = tone ?? (p >= 90 ? "#22c55e" : p >= 75 ? "#f59e0b" : "#f43f5e");
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-slate-300 flex-1 truncate">{label}</span>
      <div className="w-24 h-1.5 rounded-full bg-slate-700 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, p)}%`, background: color }} /></div>
      <span className="text-white font-semibold tabular-nums w-14 text-right">{right ?? `${p}%`}</span>
    </div>
  );
}

// Severity/status pill.
export function Pill({ text, tone }: { text: string; tone: "rose" | "amber" | "emerald" | "blue" | "slate" | "fuchsia" }) {
  const map: Record<string, string> = { rose: "bg-[var(--cmp-color-error)]/15 text-rose-300", amber: "bg-[var(--cmp-color-warning)]/15 text-amber-300", emerald: "bg-[var(--cmp-color-success)]/15 text-emerald-300", blue: "bg-[var(--cmp-color-information)]/15 text-blue-300", slate: "bg-slate-600/40 text-slate-300", fuchsia: "bg-fuchsia-500/15 text-fuchsia-300" };
  return <span className={`text-[9px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${map[tone]}`}>{text}</span>;
}

// Footer provenance note (honest about what is real vs template/derived).
export function OpsFoot({ children }: { children: any }) {
  return <p className="text-[11px] text-gray-400">{children}</p>;
}
