// Shared UI kit for the UMW Administration & Configuration section (ADM-001..009). Light UMW shell (the unit-manager
// layout gates hospital_admin/super_admin). Pure server components + one guard so each module page stays lean.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

export async function admGuard() {
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
        <p className="text-[11px] font-semibold text-blue-600 uppercase tracking-wide">{code}</p>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

const MODULES: [string, string, string][] = [
  ["001", "Dashboard", "/unit-manager/administration"],
  ["002", "Structure", "/unit-manager/administration/structure"],
  ["003", "Documents", "/unit-manager/administration/documents"],
  ["004", "Assets", "/unit-manager/administration/assets"],
  ["005", "Forms & Registers", "/unit-manager/administration/forms"],
  ["006", "Configuration", "/unit-manager/administration/configuration"],
  ["007", "Governance", "/unit-manager/administration/governance"],
  ["008", "Change & Audit", "/unit-manager/administration/change"],
  ["009", "AI Assistant", "/unit-manager/administration/ai-assistant"],
];
export function Tabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
      {MODULES.map(([code, label, href]) => (
        <Link key={code} href={href} className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${active === code ? "border-blue-500 text-blue-700 bg-blue-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}>
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

export function Kpi({ label, value, sub, tone, delta, deltaUp }: { label: string; value: any; sub?: string; tone?: string; delta?: string; deltaUp?: boolean }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      <div className="flex items-center gap-2 mt-0.5">
        {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
        {delta && <p className={`text-[11px] font-medium ${deltaUp ? "text-emerald-600" : "text-rose-600"}`}>{deltaUp ? "▲" : "▼"} {delta}</p>}
      </div>
    </div>
  );
}

export function Pill({ text, tone }: { text: string; tone?: string }) {
  return <span className={`text-[10px] font-semibold uppercase tracking-wide rounded px-1.5 py-0.5 ${PILL[tone ?? "slate"]}`}>{String(text).replace(/_/g, " ")}</span>;
}

export function Progress({ pct, tone }: { pct: number; tone?: string }) {
  const color = tone ?? (pct >= 80 ? "bg-emerald-500" : pct >= 50 ? "bg-blue-500" : pct >= 25 ? "bg-amber-500" : "bg-rose-500");
  return <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
}

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

export function Ring({ pct, size = 76, label }: { pct: number; size?: number; label?: string }) {
  const R = size * 0.4, C = 2 * Math.PI * R, len = (Math.max(0, Math.min(100, pct)) / 100) * C, mid = size / 2;
  const color = pct >= 85 ? "#10b981" : pct >= 70 ? "#3b82f6" : pct >= 50 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="7" />
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={C * 0.25} transform={`rotate(-90 ${mid} ${mid})`} />
        <text x={mid} y={mid + 3} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.26}>{pct}%</text>
      </svg>
      {label && <p className="text-[11px] text-gray-600 mt-1 text-center font-medium">{label}</p>}
    </div>
  );
}

export function HBar({ label, value, max, tone, right }: { label: string; value: number; max: number; tone?: string; right?: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="text-gray-600 flex-1 truncate">{label}</span>
      <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full" style={{ width: `${(value / (max || 1)) * 100}%`, background: tone ?? "#3b82f6" }} /></div>
      <span className="text-gray-900 font-semibold tabular-nums w-14 text-right">{right ?? value}</span>
    </div>
  );
}

export function Provision({ module, part }: { module: string; part?: string }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6">
      <p className="font-semibold text-amber-900">⚙️ Administration suite not provisioned</p>
      <p className="text-sm text-amber-800 mt-1">Apply migrations <code className="font-mono">109-admin-structure-docs-assets.sql</code> + <code className="font-mono">110-admin-config-governance-change.sql</code>{part ? ` (${part})` : ""}, then seed with <code className="font-mono">node scripts/seed-admin.mjs</code> to activate {module}.</p>
    </div>
  );
}

export function Foot({ children }: { children: any }) {
  return <p className="text-[11px] text-gray-400">{children}</p>;
}
