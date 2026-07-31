// Shared kit for the Competency Office expansion pages (CMO-008..020). Light shell (the competency-office layout
// provides the sidebar + gate). Pure server components + one guard so each module page stays lean.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { holdsOfficeAppointment } from "@/lib/ogs/office";

export async function cmoGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles, hospital_id").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  const isSuper = roles.includes("super_admin");
  const hid = (profile?.hospital_id ?? null) as string | null;
  // R001 appointment-based access (additive): a role holder OR an active Competency Office member may enter.
  const roleOk = roles.some((r: string) => ["hospital_admin", "educator", "super_admin"].includes(r));
  const apptOk = roleOk ? false : await holdsOfficeAppointment(admin, "competency", hid, isSuper, user.id);
  if (!roleOk && !apptOk) redirect("/dashboard");
  return { admin, isSuper, hid };
}

export const PILL: Record<string, string> = { slate: "bg-gray-100 text-gray-600", blue: "bg-[var(--cmp-surface-information)] text-blue-700", emerald: "bg-[var(--cmp-surface-success)] text-emerald-700", amber: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", rose: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", violet: "bg-violet-50 text-violet-700", teal: "bg-teal-50 text-teal-700" };

export function Head({ code, title, sub }: { code: string; title: string; sub?: string }) {
  return <div><p className="text-[11px] font-semibold text-teal-600 uppercase tracking-wide">{code}</p><h1 className="text-xl font-bold text-gray-900">{title}</h1>{sub && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{sub}</p>}</div>;
}

export function Card({ title, right, children, className }: { title?: string; right?: any; children: any; className?: string }) {
  return <div className={`bg-white border border-gray-200 rounded-xl p-4 ${className ?? ""}`}>{(title || right) && <div className="flex items-center justify-between mb-3 gap-2"><h3 className="text-sm font-semibold text-gray-900">{title}</h3>{right}</div>}{children}</div>;
}

export function Kpi({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className="bg-white border border-gray-200 rounded-xl p-3.5"><p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}</div>;
}

export function Pill({ text, tone }: { text: string; tone?: string }) {
  return <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${PILL[tone ?? "slate"]}`}>{String(text).replace(/_/g, " ")}</span>;
}

export function Progress({ pct, tone }: { pct: number; tone?: string }) {
  const color = tone ?? (pct >= 80 ? "bg-[var(--cmp-color-success)]" : pct >= 50 ? "bg-teal-500" : pct >= 25 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");
  return <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

export function Donut({ segs, total, centre, sub, size = 110 }: { segs: { n: number; color: string }[]; total: number; centre: any; sub?: string; size?: number }) {
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

export function Ring({ pct, size = 72, label }: { pct: number; size?: number; label?: string }) {
  const R = size * 0.4, C = 2 * Math.PI * R, len = (Math.max(0, Math.min(100, pct)) / 100) * C, mid = size / 2;
  const color = pct >= 85 ? "#10b981" : pct >= 70 ? "#14b8a6" : pct >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={C * 0.25} transform={`rotate(-90 ${mid} ${mid})`} />
        <text x={mid} y={mid + 4} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.26}>{pct}%</text>
      </svg>
      {label && <p className="text-[11px] text-gray-600 mt-1 text-center font-medium">{label}</p>}
    </div>
  );
}

export function Bars({ rows, colors }: { rows: { label: string; n: number; extra?: string }[]; colors?: string[] }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return <div className="space-y-2">{rows.map((r, i) => (
    <div key={r.label} className="flex items-center gap-2 text-[11px]"><span className="text-gray-600 w-32 truncate">{r.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(r.n / max) * 100}%`, background: (colors && colors[i]) ?? "#14b8a6" }} /></div><span className="text-gray-900 font-semibold tabular-nums w-14 text-right">{r.extra ?? r.n}</span></div>
  ))}</div>;
}

export function Provision({ module, part }: { module: string; part?: string }) {
  return <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ Competency Office expansion not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migrations <code className="font-mono">114</code> + <code className="font-mono">115</code>{part ? ` (${part})` : ""}, then seed with <code className="font-mono">node scripts/seed-cmo-expansion.mjs</code> to activate {module}.</p></div>;
}

export function Foot({ children }: { children: any }) { return <p className="text-[11px] text-gray-400">{children}</p>; }
