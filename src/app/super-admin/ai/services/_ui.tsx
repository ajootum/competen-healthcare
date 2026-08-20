// Shared kit for the AI Services Platform control plane (AIS Phase 1). Light super-admin shell (layout gates
// super_admin). Pure server components + one guard.
/* eslint-disable @typescript-eslint/no-explicit-any */
import Link from "next/link";
import { PillTag as Pill } from "../../../../components/ui/primitives";
import { KitFoot as Foot } from "../../../../components/ui/primitives";
import { PlainCard as Card } from "../../../../components/ui/primitives";
// Re-exported: this file is a KIT, and pages import these names from it. Lifting the
// implementations into the library must not remove that surface.
export { Pill, Foot, Card };

// aisGuard() WAS HERE AND IS GONE ON PURPOSE. It was a shared `roles.includes("super_admin")` check that
// twelve pages delegated to — which meant the permission-matrix scanner, reading each page file on its own,
// saw no gate in any of them and classified all twelve as `none`: "no access check of any kind". Each page
// now calls requireHqContext("hq.platform.ai.view") itself, so the gate is visible where it is enforced and
// the page carries the capability it actually needs (PLAT-ARCH-SURVEY-001 §2.5).

export const PILL: Record<string, string> = { slate: "bg-gray-100 text-gray-600", blue: "bg-[var(--cmp-surface-information)] text-blue-700", emerald: "bg-[var(--cmp-surface-success)] text-emerald-700", amber: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)]", rose: "bg-[var(--cmp-surface-error)] text-[var(--cmp-text-error)]", violet: "bg-violet-50 text-violet-700", teal: "bg-teal-50 text-teal-700" };

export function Head({ code, title, sub, right }: { code: string; title: string; sub?: string; right?: any }) {
  return (
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div><p className="text-[11px] font-semibold text-violet-600 uppercase tracking-wide">{code}</p><h1 className="text-2xl font-bold text-gray-900">{title}</h1>{sub && <p className="text-sm text-gray-500 mt-0.5 max-w-3xl">{sub}</p>}</div>
      {right}
    </div>
  );
}

const MODULES: [string, string, string][] = [
  ["001", "Control Plane", "/super-admin/ai/services"],
  ["002", "Context", "/super-admin/ai/services/context"],
  ["003", "Knowledge", "/super-admin/ai/services/knowledge"],
  ["004", "Skills", "/super-admin/ai/services/skills"],
  ["005", "Actions", "/super-admin/ai/services/actions"],
  ["006", "Recommendations", "/super-admin/ai/services/recommendations"],
  ["007", "Prompts", "/super-admin/ai/services/prompts"],
  ["008", "Governance", "/super-admin/ai/services/governance"],
  ["009", "Models", "/super-admin/ai/services/models"],
  ["010", "Config", "/super-admin/ai/services/config"],
  ["011", "Observability", "/super-admin/ai/services/observability"],
  ["012", "Agents", "/super-admin/ai/services/agents"],
];
export function Tabs({ active }: { active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
      {MODULES.map(([code, label, href]) => (
        <Link key={code} href={href} className={`shrink-0 px-3 py-1.5 text-xs font-medium rounded-t-lg border-b-2 -mb-px transition-colors ${active === code ? "border-violet-500 text-violet-700 bg-violet-50/50" : "border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50"}`}><span className="text-gray-500 mr-1">AIS-{code}</span>{label}</Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: any; sub?: string; tone?: string }) {
  return <div className="bg-white border border-gray-200 rounded-xl p-3.5"><p className="text-[11px] text-gray-500 uppercase tracking-wide truncate">{label}</p><p className={`text-2xl font-bold tabular-nums mt-1 ${tone ?? "text-gray-900"}`}>{value}</p>{sub && <p className="text-[11px] text-gray-500 mt-0.5">{sub}</p>}</div>;
}

export function Bars({ rows, unit }: { rows: { label: string; n: number; extra?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map(r => r.n));
  return <div className="space-y-2">{rows.map(r => (
    <div key={r.label} className="flex items-center gap-2 text-[11px]"><span className="text-gray-600 w-28 truncate font-mono text-[10px]">{r.label}</span><div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden"><div className="h-full rounded-full bg-violet-500" style={{ width: `${(r.n / max) * 100}%` }} /></div><span className="text-gray-900 font-semibold tabular-nums w-20 text-right">{r.extra ?? `${r.n}${unit ?? ""}`}</span></div>
  ))}</div>;
}

export function Provision() {
  return <div className="bg-[var(--cmp-surface-warning)] border border-[var(--cmp-color-warning)] rounded-xl p-6"><p className="font-semibold text-amber-900">⚙️ AI Services registry not provisioned</p><p className="text-sm text-amber-800 mt-1">Apply migration <code className="font-mono">111-ai-services-registry.sql</code> then seed with <code className="font-mono">node scripts/seed-ai-services.mjs</code>.</p></div>;
}

