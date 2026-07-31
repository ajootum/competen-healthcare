import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import Link from "next/link";
import ScopeFilter from "@/components/ScopeFilter";
import { holdsOfficeAppointment } from "@/lib/ogs/office";

// Shared presentational + guard kit for the Quality & Accreditation Workspace (QAW-000..014).
// Pure server-safe components (static SVG charts, cards, pills) so every module renders the same
// mockup-aligned design language without a chart dependency. Teal is the workspace accent; content
// uses semantic RAG tones. Grounds in real data — callers pass honest nulls where a store is absent.
/* eslint-disable @typescript-eslint/no-explicit-any */

export const NONE = "00000000-0000-0000-0000-000000000000";
const ALLOWED = ["hospital_admin", "super_admin", "assessor"];

// ── Shared guard: auth + role, returns the scope every module needs.
export async function qaGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("full_name, role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  // R001 appointment-based access (additive): role holder OR active Quality Office appointee. Fail-soft.
  const roleOk = roles.some(r => ALLOWED.includes(r));
  const apptOk = roleOk ? false : await holdsOfficeAppointment(admin, "quality", profile?.hospital_id ?? null, roles.includes("super_admin"), user.id);
  if (!roleOk && !apptOk) redirect("/dashboard");
  const cookieStore = await cookies();
  const selected = cookieStore.get("active_hospital")?.value ?? null;
  const isSuperRole = roles.includes("super_admin");
  // super_admin may scope to a chosen hospital (or "all"); everyone else is fixed to their own hospital.
  let hid: string | null, isSuper: boolean;
  if (isSuperRole && selected && selected !== "all") { hid = selected; isSuper = false; }
  else if (isSuperRole) { hid = null; isSuper = true; }
  else { hid = profile?.hospital_id ?? null; isSuper = false; }
  return { admin, user, profile, roles, isSuper, hid, fullName: profile?.full_name ?? "Quality lead" };
}

// ── Tone system — full literal Tailwind class strings (no dynamic construction) + SVG hexes.
export const TONE: Record<string, { text: string; chip: string; dot: string; bar: string; soft: string; hex: string }> = {
  emerald: { text: "text-[var(--cmp-text-success)]", chip: "bg-[var(--cmp-surface-success)] text-emerald-700", dot: "bg-[var(--cmp-color-success)]", bar: "bg-[var(--cmp-color-success)]", soft: "bg-[var(--cmp-surface-success)]", hex: "#10b981" },
  teal: { text: "text-teal-600", chip: "bg-teal-100 text-teal-700", dot: "bg-teal-500", bar: "bg-teal-500", soft: "bg-teal-50", hex: "#14b8a6" },
  blue: { text: "text-[var(--cmp-text-information)]", chip: "bg-[var(--cmp-surface-information)] text-blue-700", dot: "bg-[var(--cmp-color-information)]", bar: "bg-[var(--cmp-color-information)]", soft: "bg-[var(--cmp-surface-information)]", hex: "#3b82f6" },
  indigo: { text: "text-indigo-600", chip: "bg-indigo-100 text-indigo-700", dot: "bg-indigo-500", bar: "bg-indigo-500", soft: "bg-indigo-50", hex: "#6366f1" },
  violet: { text: "text-violet-600", chip: "bg-violet-100 text-violet-700", dot: "bg-violet-500", bar: "bg-violet-500", soft: "bg-violet-50", hex: "#8b5cf6" },
  amber: { text: "text-[var(--cmp-text-warning)]", chip: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", dot: "bg-[var(--cmp-color-warning)]", bar: "bg-[var(--cmp-color-warning)]", soft: "bg-[var(--cmp-surface-warning)]", hex: "#f59e0b" },
  rose: { text: "text-[var(--cmp-text-error)]", chip: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", dot: "bg-[var(--cmp-color-error)]", bar: "bg-[var(--cmp-color-error)]", soft: "bg-[var(--cmp-surface-error)]", hex: "#f43f5e" },
  red: { text: "text-[var(--cmp-text-critical)]", chip: "bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]", dot: "bg-[var(--cmp-color-critical)]", bar: "bg-[var(--cmp-color-critical)]", soft: "bg-[var(--cmp-surface-critical)]", hex: "#ef4444" },
  slate: { text: "text-slate-600", chip: "bg-slate-100 text-slate-700", dot: "bg-slate-400", bar: "bg-slate-400", soft: "bg-slate-50", hex: "#94a3b8" },
  gray: { text: "text-gray-500", chip: "bg-gray-100 text-gray-600", dot: "bg-gray-300", bar: "bg-gray-300", soft: "bg-gray-50", hex: "#cbd5e1" },
};
export const T = (k?: string) => TONE[k ?? "slate"] ?? TONE.slate;
export const ragPct = (n: number) => (n >= 85 ? "emerald" : n >= 60 ? "amber" : "rose");

// ── Page header with title, sub, a real hospital-scope filter (ScopeFilter) + optional primary action.
export function Head({ title, code, sub, action }: { title: string; code?: string; sub?: string; action?: { label: string; href: string } }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {code && <p className="text-[11px] font-semibold uppercase tracking-widest text-teal-600/80">{code}</p>}
        <h1 className="text-[26px] font-bold text-gray-900 leading-tight flex items-center gap-2">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-1 max-w-3xl">{sub}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <ScopeFilter />
        {action && <Link href={action.href} className="text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3.5 py-1.5">{action.label}</Link>}
      </div>
    </div>
  );
}

// ── Section tab strip (Overview + module sub-sections). Overview is live; deeper tabs are labels
// (section markers, not fake CTAs) until built out — see each module Foot.
export function Tabs({ tabs, active }: { tabs: string[]; active: string }) {
  return (
    <div className="flex gap-5 border-b border-gray-200 overflow-x-auto -mb-px">
      {tabs.map(t => (
        <span key={t} className={`shrink-0 pb-2.5 text-[13px] border-b-2 ${t === active ? "border-teal-600 text-teal-700 font-semibold" : "border-transparent text-gray-400"}`}>{t}</span>
      ))}
    </div>
  );
}

// ── KPI stat card: colored icon square, label, big number, semantic trend arrow.
export function Stat({ icon, tone, label, value, sub, trend }: {
  icon?: string; tone?: string; label: string; value: any; sub?: string;
  trend?: { dir: "up" | "down" | "flat"; label: string; good?: boolean };
}) {
  const tt = T(tone);
  const arrow = trend ? (trend.dir === "up" ? "↑" : trend.dir === "down" ? "↓" : "→") : "";
  const trendCls = trend ? (trend.good === false ? "text-[var(--cmp-text-error)]" : trend.good === true ? "text-[var(--cmp-text-success)]" : "text-gray-400") : "";
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        {icon && <span className={`w-9 h-9 rounded-xl ${tt.soft} ${tt.text} flex items-center justify-center text-base shrink-0`}>{icon}</span>}
        <p className="text-[12px] text-gray-500 leading-tight">{label}</p>
      </div>
      <p className="text-[26px] font-bold text-gray-900 tabular-nums leading-none">{value}</p>
      <div className="flex items-center gap-1.5 mt-1.5">
        {trend && <span className={`text-[11px] font-semibold ${trendCls}`}>{arrow} {trend.label}</span>}
        {sub && <span className="text-[11px] text-gray-400">{sub}</span>}
      </div>
    </div>
  );
}

// ── White card container.
export function Card({ title, right, children, className = "" }: { title?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-5 ${className}`}>
      {(title || right) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && <h3 className="font-semibold text-gray-900 text-[15px]">{title}</h3>}
          {right && <div className="text-[11px] text-gray-400">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

// ── Status pill.
export function Pill({ text, tone }: { text: string; tone?: string }) {
  const tt = T(tone);
  return <span className={`inline-flex items-center text-[10px] font-semibold rounded-full px-2 py-0.5 ${tt.chip}`}>{text}</span>;
}

// ── SVG donut from segments. Renders a soft ring if total is 0.
export function Donut({ segments, total, label, size = 150 }: { segments: { value: number; tone?: string; label?: string }[]; total?: number; label?: string; size?: number }) {
  const sum = segments.reduce((a, s) => a + (s.value || 0), 0);
  const tot = total ?? sum;
  const r = size / 2 - 12, c = 2 * Math.PI * r, cx = size / 2;
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f1f5f9" strokeWidth={14} />
      {sum > 0 && segments.map((s, i) => {
        const len = (s.value / sum) * c;
        const el = <circle key={i} cx={cx} cy={cx} r={r} fill="none" stroke={T(s.tone).hex} strokeWidth={14} strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cx})`} strokeLinecap="butt" />;
        off += len; return el;
      })}
      <text x={cx} y={cx - 2} textAnchor="middle" className="fill-gray-900" style={{ fontSize: 22, fontWeight: 700 }}>{tot}</text>
      {label && <text x={cx} y={cx + 16} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 11 }}>{label}</text>}
    </svg>
  );
}

// ── Legend rows for a donut / category breakdown.
export function Legend({ items }: { items: { label: string; value: any; tone?: string; pct?: number }[] }) {
  return (
    <div className="space-y-1.5 min-w-0 flex-1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-[12px]">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${T(it.tone).dot}`} />
          <span className="text-gray-600 truncate">{it.label}</span>
          <span className="ml-auto font-medium text-gray-800 tabular-nums">{it.value}</span>
          {it.pct != null && <span className="text-gray-400 tabular-nums w-11 text-right">{it.pct}%</span>}
        </div>
      ))}
    </div>
  );
}

// ── SVG trend line/area chart. points = numbers; optional target line + point labels.
export function Trend({ points, labels, tone = "teal", height = 120, target, suffix = "" }: { points: number[]; labels?: string[]; tone?: string; height?: number; target?: number; suffix?: string }) {
  const w = 480, h = height, pad = 22;
  const all = target != null ? [...points, target] : points;
  const max = Math.max(1, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (w - pad * 2)) / Math.max(1, points.length - 1);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - pad * 2);
  const line = points.map((p, i) => `${x(i)},${y(p)}`).join(" ");
  const area = `${pad},${h - pad} ${line} ${x(points.length - 1)},${h - pad}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" style={{ maxHeight: height + 20 }}>
      {target != null && <line x1={pad} x2={w - pad} y1={y(target)} y2={y(target)} stroke="#cbd5e1" strokeWidth={1} strokeDasharray="4 4" />}
      <polygon points={area} fill={T(tone).hex} opacity={0.08} />
      <polyline points={line} fill="none" stroke={T(tone).hex} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p)} r={3} fill="#fff" stroke={T(tone).hex} strokeWidth={2} />)}
      {points.map((p, i) => <text key={`t${i}`} x={x(i)} y={y(p) - 8} textAnchor="middle" className="fill-gray-500" style={{ fontSize: 9, fontWeight: 600 }}>{p}{suffix}</text>)}
      {labels && labels.map((l, i) => <text key={`l${i}`} x={x(i)} y={h - 6} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 9 }}>{l}</text>)}
    </svg>
  );
}

// ── Horizontal progress bars (domain scores, distributions).
export function Bars({ items }: { items: { label: string; pct: number; tone?: string; value?: any }[] }) {
  return (
    <div className="space-y-2.5">
      {items.map((it, i) => (
        <div key={i}>
          <div className="flex items-center justify-between text-[12px] mb-1">
            <span className="text-gray-600 truncate pr-2">{it.label}</span>
            <span className="font-medium text-gray-800 tabular-nums shrink-0">{it.value ?? `${it.pct}%`}</span>
          </div>
          <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${T(it.tone ?? ragPct(it.pct)).bar}`} style={{ width: `${Math.min(100, Math.max(2, it.pct))}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Semicircle gauge for a single percentage.
export function Gauge({ pct, label, tone }: { pct: number; label?: string; tone?: string }) {
  const w = 160, h = 92, r = 62, cx = w / 2, cy = 82;
  const c = Math.PI * r;
  const val = Math.min(100, Math.max(0, pct));
  const hex = T(tone ?? ragPct(pct)).hex;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h}>
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke="#f1f5f9" strokeWidth={12} strokeLinecap="round" />
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} fill="none" stroke={hex} strokeWidth={12} strokeLinecap="round" strokeDasharray={`${(val / 100) * c} ${c}`} />
      <text x={cx} y={cy - 8} textAnchor="middle" className="fill-gray-900" style={{ fontSize: 22, fontWeight: 700 }}>{pct}%</text>
      {label && <text x={cx} y={cy + 8} textAnchor="middle" className="fill-gray-400" style={{ fontSize: 10 }}>{label}</text>}
    </svg>
  );
}

// ── Circular progress ring (compact single %).
export function Ring({ pct, size = 60, tone }: { pct: number; size?: number; tone?: string }) {
  const r = size / 2 - 5, c = 2 * Math.PI * r, cx = size / 2;
  const hex = T(tone ?? ragPct(pct)).hex;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <circle cx={cx} cy={cx} r={r} fill="none" stroke="#f1f5f9" strokeWidth={5} />
      <circle cx={cx} cy={cx} r={r} fill="none" stroke={hex} strokeWidth={5} strokeLinecap="round" strokeDasharray={`${(Math.min(100, pct) / 100) * c} ${c}`} transform={`rotate(-90 ${cx} ${cx})`} />
      <text x={cx} y={cx + 4} textAnchor="middle" className="fill-gray-900" style={{ fontSize: size * 0.24, fontWeight: 700 }}>{pct}%</text>
    </svg>
  );
}

// ── Simple table.
export function Table({ cols, rows, empty = "No records yet." }: { cols: string[]; rows: React.ReactNode[][]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-gray-400 py-6 text-center">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[10px] uppercase tracking-wide text-gray-400 border-b border-gray-100">{cols.map((c, i) => <th key={i} className="pb-2 pr-3 font-medium">{c}</th>)}</tr></thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map((r, i) => <tr key={i} className="text-gray-700">{r.map((cell, j) => <td key={j} className="py-2 pr-3 align-middle">{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

// ── Quick-action tile grid.
export function QuickActions({ actions }: { actions: { icon: string; label: string; href: string }[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
      {actions.map((a, i) => (
        <Link key={i} href={a.href} className="flex flex-col items-center justify-center gap-1.5 border border-gray-200 rounded-xl py-4 px-2 text-center hover:border-teal-300 hover:bg-teal-50/40 transition-colors">
          <span className="text-lg">{a.icon}</span>
          <span className="text-[11.5px] text-gray-600 leading-tight">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

// ── Honest footnote (what's live vs. next-phase).
export function Foot({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-gray-400 leading-relaxed border-t border-gray-100 pt-3">{children}</p>;
}

// ── Provision / empty banners.
export function Provision({ module }: { module: string }) {
  return <div className="bg-[var(--cmp-surface-information)] border border-[var(--cmp-color-information)] rounded-xl p-6 text-sm text-blue-800">The data store for {module} is not provisioned yet. Once its migration is applied, this module lights up with live data. Until then the surrounding KPIs and cross-links remain available.</div>;
}
