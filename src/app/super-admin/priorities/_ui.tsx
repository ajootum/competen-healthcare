// Shared UI kit for the Platform Priority & Execution Framework (PPE) super-admin section (PPE-001..008). Light
// super-admin shell (the layout already gates super_admin). Pure server components + one auth guard so each module
// page stays lean. Consistent teal-accent headers, white cards, semantic pills/progress for strategy state.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { PillTag as Pill } from "../../../components/ui/primitives";
import { KitFoot as Foot } from "../../../components/ui/primitives";
import { PanelCard as Card } from "../../../components/ui/primitives";
import { ProgressBar as Progress } from "../../../components/ui/primitives";
// Re-exported: this file is a KIT, and pages import these names from it. Lifting the
// implementations into the library must not remove that surface.
export { Pill, Foot, Card, Progress };

export async function ppeGuard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const admin = createAdminClient() as any;
  const { data: profile } = await admin.from("profiles").select("role, roles").eq("id", user.id).single();
  const roles: string[] = (profile?.roles?.length ? profile.roles : [profile?.role]).filter(Boolean);
  if (!roles.includes("super_admin")) redirect("/dashboard");
  return { admin, userId: user.id };
}

export const PILL: Record<string, string> = {
  slate: "bg-gray-100 text-gray-600", blue: "bg-[var(--cmp-surface-information)] text-blue-700", emerald: "bg-[var(--cmp-surface-success)] text-emerald-700",
  amber: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", rose: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", violet: "bg-violet-50 text-violet-700", teal: "bg-teal-50 text-teal-700",
};
export const STATUS_TONE: Record<string, string> = { draft: "slate", pending: "amber", published: "emerald", archived: "slate", active: "emerald", planned: "blue", paused: "amber", completed: "teal", cancelled: "slate", approved: "emerald", rejected: "rose", changes_requested: "amber", on_track: "emerald", at_risk: "amber", off_track: "rose", achieved: "teal" };
export const URGENCY_TONE: Record<string, string> = { low: "slate", medium: "blue", high: "amber", critical: "rose" };

export function Head({ code, title, sub, actions }: { code: string; title: string; sub?: string; actions?: any }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div>
        <p className="text-[11px] font-semibold text-teal-600 uppercase tracking-wide">{code}</p>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        {sub && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{sub}</p>}
      </div>
      {actions}
    </div>
  );
}

// Sub-nav across the 8 PPE modules (active item highlighted by the page passing `active`).
const MODULES: [string, string, string][] = [
  ["001", "Strategy", "/super-admin/priorities"],
  ["002", "Distribution", "/super-admin/priorities/distribution"],
  ["003", "Goal → Action", "/super-admin/priorities/actions"],
  ["004", "Personalisation", "/super-admin/priorities/personalisation"],
  ["005", "Campaigns", "/super-admin/priorities/campaigns"],
  ["006", "Analytics", "/super-admin/priorities/analytics"],
  ["007", "AI Orchestrator", "/super-admin/priorities/ai"],
  ["008", "Governance", "/super-admin/priorities/governance"],
];
export function ModuleNav({ active }: { active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
      {MODULES.map(([code, label, href]) => (
        <Link key={code} href={href} className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${active === code ? "border-teal-500 text-teal-700 bg-teal-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}>
          <span className="text-gray-300 mr-1">{code}</span>{label}
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3.5">
      <p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

export function Ring({ pct, size = 64, label }: { pct: number; size?: number; label?: string }) {
  const R = size * 0.4, C = 2 * Math.PI * R, len = (Math.max(0, Math.min(100, pct)) / 100) * C, mid = size / 2;
  const color = pct >= 80 ? "#10b981" : pct >= 50 ? "#14b8a6" : pct >= 25 ? "#f59e0b" : "#f43f5e";
  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={mid} cy={mid} r={R} fill="none" stroke="#f1f5f9" strokeWidth="6" />
        <circle cx={mid} cy={mid} r={R} fill="none" stroke={color} strokeWidth="6" strokeLinecap="round" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={C * 0.25} transform={`rotate(-90 ${mid} ${mid})`} />
        <text x={mid} y={mid + 4} textAnchor="middle" className="fill-gray-900 font-bold" fontSize={size * 0.24}>{pct}%</text>
      </svg>
      {label && <p className="text-[10px] text-gray-500 mt-1 text-center">{label}</p>}
    </div>
  );
}

export function Provision({ module }: { module: string }) {
  return (
    <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6">
      <p className="font-semibold text-amber-900">⚙️ Priority framework not provisioned</p>
      <p className="text-sm text-amber-800 mt-1">Apply migration <code className="font-mono">107-priority-framework.sql</code> then seed with <code className="font-mono">node scripts/seed-priorities.mjs</code> to activate {module}.</p>
    </div>
  );
}

