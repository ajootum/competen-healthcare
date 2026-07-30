// HWW shared clinical kit (HWW-UI-001) — the tone maps, formatters and small
// presentational components every Healthcare Worker Workspace surface uses, so
// acuity/risk/priority/EWS render identically across the workspace (and stop
// being re-declared per page, as they were across CurrentShiftClient and the
// supervisor surfaces). Server-safe: no hooks, no client directives.

export const pretty = (s: string | null | undefined) => (s ?? "").replace(/_/g, " ");
export const titleCase = (s: string | null | undefined) =>
  pretty(s).split(" ").filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--";
export const fmtDateLong = (d: string | null | undefined) =>
  d ? new Date(d + "T00:00:00").toLocaleDateString([], { weekday: "short", day: "numeric", month: "long", year: "numeric" }) : "";
export const fmtWhen = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" }) : "";

// ── Clinical tone maps (single source of truth) ──────────────────────────────
export const ACUITY: Record<string, string> = {
  stable: "bg-green-100 text-green-700", moderate: "bg-yellow-100 text-yellow-700",
  high: "bg-orange-100 text-orange-700", critical: "bg-red-100 text-red-700",
};
export const RISK: Record<string, string> = {
  low: "bg-green-100 text-green-700", medium: "bg-amber-100 text-amber-700", high: "bg-red-100 text-red-700",
};
export const PRIO: Record<string, string> = {
  urgent: "bg-red-100 text-red-700", high: "bg-orange-100 text-orange-700",
  normal: "bg-gray-100 text-gray-500", low: "bg-gray-100 text-gray-400",
  // Nurse-concern priorities (HWW-ADD-001) share the map
  immediate: "bg-red-100 text-red-700", today: "bg-amber-100 text-amber-700", routine: "bg-gray-100 text-gray-500",
};
export const PRIO_RANK: Record<string, number> = { urgent: 3, immediate: 3, high: 2, today: 1, normal: 1, low: 0, routine: 0 };
export const ewsColor = (n: number | null | undefined) =>
  n == null ? "text-gray-400" : n >= 7 ? "text-red-600" : n >= 5 ? "text-orange-600" : n >= 3 ? "text-yellow-600" : "text-green-600";

// ── Shared class constants (emerald accent — the HWW identity) ───────────────
export const card = "bg-white rounded-xl border border-gray-200 p-5";
export const input = "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40";
export const btn = "px-3.5 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50";
export const btnGhost = "px-2.5 py-1 rounded-lg border border-gray-300 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50";
export const label = "text-[11px] font-semibold text-gray-400 uppercase tracking-wider";

// ── Small components ─────────────────────────────────────────────────────────
export function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full ${tone}`}>{children}</span>;
}
export function AcuityChip({ level }: { level: string | null | undefined }) {
  return <Chip tone={ACUITY[level ?? ""] ?? ACUITY.stable}>{titleCase(level ?? "stable")}</Chip>;
}
export function RiskChip({ level }: { level: string | null | undefined }) {
  return <Chip tone={RISK[level ?? ""] ?? RISK.low}>{titleCase(level ?? "low")}</Chip>;
}
export function PrioChip({ p }: { p: string | null | undefined }) {
  return <Chip tone={PRIO[p ?? ""] ?? PRIO.normal}>{titleCase(p ?? "normal")}</Chip>;
}
export function EwsBadge({ score }: { score: number | null | undefined }) {
  return <span className={`font-semibold tabular-nums ${ewsColor(score)}`}>{score ?? "—"}</span>;
}

export function StatCard({ icon, title, value, sub, tone }: { icon: string; title: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className={card}>
      <div className="flex items-center gap-2 mb-2"><span className="text-lg">{icon}</span><span className={label}>{title}</span></div>
      <p className={`text-2xl font-bold tabular-nums ${tone ?? "text-gray-900"}`}>{value}</p>
      {sub != null && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}

export function SectionCard({ icon, title, count, right, children }: { icon?: string; title: string; count?: number; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={card}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">{icon} {title}{count != null && <span className="text-gray-400 font-normal">({count})</span>}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-400">{children}</p>;
}
