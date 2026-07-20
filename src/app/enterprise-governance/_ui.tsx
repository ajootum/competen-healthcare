import Link from "next/link";
import type { OrgRow } from "@/lib/enterprise-governance-data";

// Shared presentational pieces for the Enterprise Governance workspace.
// (Underscore-prefixed file — not an App Router route.)

export const card = "bg-white rounded-xl border border-gray-200 p-5";
export const tone = (n: number | null) => (n == null ? "text-gray-300" : n >= 85 ? "text-green-600" : n >= 60 ? "text-amber-600" : "text-red-600");
export const barCls = (n: number) => (n >= 85 ? "bg-green-500" : n >= 60 ? "bg-amber-500" : "bg-red-500");
export const pctText = (n: number | null) => (n == null ? "—" : `${n}%`);

export function ScopeBanner({ mode, name }: { mode: "platform" | "group" | "single"; name: string }) {
  if (mode === "platform") return (
    <span className="inline-block text-[11px] text-violet-700 bg-violet-50 border border-violet-200 rounded-full px-3 py-1">Platform-wide · all organisations</span>
  );
  if (mode === "group") return (
    <span className="inline-block text-[11px] text-teal-700 bg-teal-50 border border-teal-200 rounded-full px-3 py-1">Enterprise group · {name}</span>
  );
  return (
    <span className="inline-block text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1">Single organisation · {name} — cross-organisation governance is a platform capability</span>
  );
}

export function BenchmarkTable({ rows }: { rows: OrgRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-gray-500 border-b"><th className="py-2 pr-3">Organisation</th><th className="pr-3 text-right">Facilities</th><th className="pr-3 text-right">Users</th><th className="pr-3 w-40">Competency currency</th><th className="pr-3 text-right">Quality compliance</th></tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={5} className="py-3 text-gray-400">No organisations in scope.</td></tr>}
          {rows.map((o) => (
            <tr key={o.id} className="border-b last:border-0">
              <td className="py-2.5 pr-3 font-medium text-gray-800">{o.name}</td>
              <td className="pr-3 text-right tabular-nums text-gray-600">{o.facilities}</td>
              <td className="pr-3 text-right tabular-nums text-gray-600">{o.users}</td>
              <td className="pr-3">
                {o.compPct == null ? <span className="text-xs text-gray-300">no data</span> : (
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden"><div className={`h-full ${barCls(o.compPct)}`} style={{ width: `${o.compPct}%` }} /></div>
                    <span className={`text-xs tabular-nums w-9 text-right ${tone(o.compPct)}`}>{o.compPct}%</span>
                  </div>
                )}
              </td>
              <td className={`pr-3 text-right tabular-nums ${tone(o.auditPct)}`}>{pctText(o.auditPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Kpi({ n, label, sub, href, toneCls }: { n: React.ReactNode; label: string; sub?: string; href?: string; toneCls?: string }) {
  const inner = (
    <div className={`${card} ${href ? "hover:border-teal-300 transition-colors" : ""}`}>
      <div className={`text-3xl font-bold tabular-nums ${toneCls ?? "text-gray-900"}`}>{n}</div>
      <div className="text-xs text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
