// Shared UI kit for the UMW Administration & Configuration section (ADM-001..009). Light UMW shell (the unit-manager
// layout gates hospital_admin/super_admin). Pure server components + one guard so each module page stays lean.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PillTag as Pill } from "../../../components/ui/primitives";
import { KitFoot as Foot } from "../../../components/ui/primitives";
import { PanelCard as Card } from "../../../components/ui/primitives";
import { DonutMid as Donut } from "../_kit";
export { Donut };
// Re-exported: this file is a KIT, and pages import these names from it. Lifting the
// implementations into the library must not remove that surface.
export { Pill, Foot, Card };

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

export const PILL: Record<string, string> = { slate: "bg-gray-100 text-gray-600", blue: "bg-[var(--cmp-surface-information)] text-blue-700", emerald: "bg-[var(--cmp-surface-success)] text-emerald-700", amber: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", rose: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", violet: "bg-violet-50 text-violet-700", teal: "bg-teal-50 text-teal-700" };

export function Head({ code, title, sub, actions }: { code: string; title: string; sub?: string; actions?: any }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[11px] font-semibold text-[var(--cmp-text-information)] uppercase tracking-wide">{code}</p>
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
        <Link key={code} href={href} className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${active === code ? "border-blue-500 text-blue-700 bg-[var(--cmp-surface-information)]/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}>
          <span className="text-gray-300 mr-1">{code}</span>{label}
        </Link>
      ))}
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
        {delta && <p className={`text-[11px] font-medium ${deltaUp ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-error)]"}`}>{deltaUp ? "▲" : "▼"} {delta}</p>}
      </div>
    </div>
  );
}

export function Progress({ pct, tone }: { pct: number; tone?: string }) {
  const color = tone ?? (pct >= 80 ? "bg-[var(--cmp-color-success)]" : pct >= 50 ? "bg-[var(--cmp-color-information)]" : pct >= 25 ? "bg-[var(--cmp-color-warning)]" : "bg-[var(--cmp-color-error)]");
  return <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} /></div>;
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
    <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6">
      <p className="font-semibold text-amber-900">⚙️ Administration suite not provisioned</p>
      <p className="text-sm text-amber-800 mt-1">Apply migrations <code className="font-mono">109-admin-structure-docs-assets.sql</code> + <code className="font-mono">110-admin-config-governance-change.sql</code>{part ? ` (${part})` : ""}, then seed with <code className="font-mono">node scripts/seed-admin.mjs</code> to activate {module}.</p>
    </div>
  );
}

