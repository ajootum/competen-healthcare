import Link from "next/link";
import { priority as PRIORITY, type PriorityKey } from "@/lib/design/tokens";

// Platform Component Library (PUI-004) — the reusable primitives.
//
// SERVER-COMPONENT SAFE ON PURPOSE. Nearly every page in this codebase is a server component that renders
// data straight from a loader, so a library that forced "use client" would either go unused or push whole
// pages onto the client for a card. Anything genuinely interactive lives in ./interactive.tsx instead.
//
// Two rules from the specs are enforced by construction rather than by reviewer discipline:
//
//   1. STATUS IS NEVER COLOUR ALONE (PUI-001 s8, PUI-005 s1). Every status component here renders a LABEL
//      or an icon beside the colour. There is no prop to turn the label off.
//   2. FILL vs TEXT (PUI-001, see tokens.ts semanticText). Colour that carries words uses the AA-passing
//      text tone; colour used as a mark or a fill uses the specified brand value. Components pick the right
//      one per element, so a caller cannot accidentally put 2.15:1 amber text on white.
//
// Everything reads design tokens through CSS custom properties, so a token change reaches these without
// touching them.

// ── Surfaces ────────────────────────────────────────────────────────────────────────────────────────────
export const cardClass = "bg-white rounded-xl border border-gray-200 p-5";

export function Card({ children, className = "", as: As = "div" }: {
  children: React.ReactNode; className?: string; as?: "div" | "section" | "article";
}) {
  return <As className={`${cardClass} ${className}`}>{children}</As>;
}

// A card with a title row. `note` is for the quiet qualifier that keeps a panel honest ("last 7 days",
// "confirmed rows only") — the pattern used all over this codebase, made reusable.
export function Section({ title, sub, note, action, children, className = "" }: {
  title: string; sub?: string; note?: string; action?: React.ReactNode;
  children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`${cardClass} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">
            {title}
            {sub && <span className="text-gray-400 font-normal"> · {sub}</span>}
          </h2>
          {note && <p className="text-[11px] text-gray-400 mt-0.5">{note}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// ── Stat / KPI (PUI-007 s2 KPI ribbon) ──────────────────────────────────────────────────────────────────
export type Trend = { direction: "up" | "down" | "flat"; value: string; good?: boolean };

// `value` accepts a ReactNode so a caller can render an em-dash for "not measured" rather than a
// misleading 0 — the distinction this codebase keeps everywhere.
export function Stat({ label, value, sub, tone, trend, href }: {
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  tone?: "default" | "success" | "warning" | "critical"; trend?: Trend; href?: string;
}) {
  const color = tone && tone !== "default" ? `var(--cmp-text-${tone === "critical" ? "critical" : tone})` : undefined;
  const body = (
    <>
      <p className="text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
      {trend && (
        <p className="text-[10px] mt-0.5 flex items-center gap-1"
          style={{ color: trend.good === false ? "var(--cmp-text-critical)" : trend.good ? "var(--cmp-text-success)" : "var(--cmp-text-neutral)" }}>
          <span aria-hidden>{trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"}</span>
          <span>{trend.value}</span>
          <span className="cmp-sr-only">{trend.direction === "up" ? "increased" : trend.direction === "down" ? "decreased" : "unchanged"}</span>
        </p>
      )}
      {sub != null && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
    </>
  );
  // PUI-007 s2: "Clickable to view detailed report" — a KPI that links says so by being a link.
  return href
    ? <Link href={href} className={`${cardClass} block hover:border-gray-300 transition-colors`}>{body}</Link>
    : <div className={cardClass}>{body}</div>;
}

// ── Badge / Chip ────────────────────────────────────────────────────────────────────────────────────────
const TONE_BG: Record<string, string> = {
  neutral: "bg-gray-100 text-gray-600",
  primary: "bg-[color:var(--cmp-color-primary-light)] text-[color:var(--cmp-color-primary-dark)]",
  info: "bg-sky-50 text-[color:var(--cmp-text-information)]",
  success: "bg-green-50 text-[color:var(--cmp-text-success)]",
  warning: "bg-amber-50 text-[color:var(--cmp-text-warning)]",
  error: "bg-red-50 text-[color:var(--cmp-text-error)]",
  critical: "bg-red-100 text-[color:var(--cmp-text-critical)]",
};
export type BadgeTone = keyof typeof TONE_BG;

// The label is the CHILD, so a badge cannot be rendered without one.
export function Badge({ children, tone = "neutral", icon }: {
  children: React.ReactNode; tone?: BadgeTone; icon?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5 ${TONE_BG[tone] ?? TONE_BG.neutral}`}>
      {icon && <span aria-hidden>{icon}</span>}
      {children}
    </span>
  );
}

export function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] rounded-lg border px-2.5 py-1 ${
      tone === "neutral" ? "text-gray-600 bg-gray-50 border-gray-100" : `${TONE_BG[tone]} border-transparent`}`}>
      {children}
    </span>
  );
}

// ── Alert / banner (PUI-004 s7, PUI-006 s3) ─────────────────────────────────────────────────────────────
const ALERT: Record<string, { icon: string; bg: string; border: string; text: string; role: "status" | "alert" }> = {
  info:     { icon: "ⓘ", bg: "bg-sky-50",   border: "border-sky-100",   text: "var(--cmp-text-information)", role: "status" },
  success:  { icon: "✓", bg: "bg-green-50", border: "border-green-100", text: "var(--cmp-text-success)",     role: "status" },
  warning:  { icon: "⚠", bg: "bg-amber-50", border: "border-amber-100", text: "var(--cmp-text-warning)",     role: "status" },
  error:    { icon: "✕", bg: "bg-red-50",   border: "border-red-100",   text: "var(--cmp-text-error)",       role: "alert"  },
  critical: { icon: "▲", bg: "bg-red-50",   border: "border-red-200",   text: "var(--cmp-text-critical)",    role: "alert"  },
};
export type AlertTone = keyof typeof ALERT;

// role=alert for error/critical so assistive tech announces them; role=status for the calmer tones, which
// should not interrupt. Both carry an icon AND words.
export function Alert({ tone = "info", title, children, action }: {
  tone?: AlertTone; title?: string; children?: React.ReactNode; action?: React.ReactNode;
}) {
  const a = ALERT[tone] ?? ALERT.info;
  return (
    <div role={a.role} className={`${a.bg} border ${a.border} rounded-xl p-4 flex items-start gap-3`}>
      <span aria-hidden className="text-sm leading-5" style={{ color: a.text }}>{a.icon}</span>
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm font-semibold" style={{ color: a.text }}>{title}</p>}
        {children && <div className="text-sm text-gray-700">{children}</div>}
      </div>
      {action}
    </div>
  );
}

// ── Priority pill (PUI-006 s2) — colour, icon and word, straight from the token table ───────────────────
export function PriorityPill({ level }: { level: PriorityKey }) {
  const p = PRIORITY[level];
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-semibold rounded px-1.5 py-0.5"
      style={{ color: level === "medium" ? "var(--cmp-text-warning)" : `var(--cmp-text-${level === "high" ? "warning" : level === "low" ? "information" : "critical"})`,
        background: level === "low" ? "rgb(240 249 255)" : level === "medium" || level === "high" ? "rgb(255 251 235)" : "rgb(254 226 226)" }}>
      <span aria-hidden>{p.icon}</span>{p.label}
    </span>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────────────────────────────────
// `value` may be null for "not measured", which renders an explicitly empty track rather than a 0% bar
// that would read as a measured zero.
export function Progress({ value, label, tone = "primary", showValue = true }: {
  value: number | null; label?: string; tone?: "primary" | "success" | "warning" | "critical"; showValue?: boolean;
}) {
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const bg = tone === "primary" ? "var(--cmp-color-primary)" : `var(--cmp-color-${tone})`;
  return (
    <div>
      {(label || showValue) && (
        <div className="flex items-center justify-between text-xs mb-0.5">
          {label && <span className="text-gray-700">{label}</span>}
          {showValue && <span className="text-gray-500 tabular-nums">{value == null ? "not measured" : `${pct}%`}</span>}
        </div>
      )}
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden"
        role="progressbar" aria-valuenow={value ?? undefined} aria-valuemin={0} aria-valuemax={100}
        aria-label={label ?? "Progress"} aria-valuetext={value == null ? "not measured" : `${pct}%`}>
        {value != null && <div className="h-full rounded-full" style={{ width: `${pct}%`, background: bg }} />}
      </div>
    </div>
  );
}

// ── Empty / loading / error states (PUI-004 s7) ─────────────────────────────────────────────────────────
export function EmptyState({ title, body, action, icon = "🗒" }: {
  title: string; body?: React.ReactNode; action?: React.ReactNode; icon?: string;
}) {
  return (
    <div className="text-center py-8">
      <p className="text-2xl mb-2" aria-hidden>{icon}</p>
      <p className="text-sm font-medium text-gray-900">{title}</p>
      {body && <div className="text-[11px] text-gray-500 mt-1 max-w-md mx-auto">{body}</div>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

// The state this codebase needs most: a store exists in the schema but not on this database. Names the
// migration instead of rendering zeroes that would read as real measurements.
export function NotProvisioned({ what, migration }: { what: string; migration?: string }) {
  return (
    <Card>
      <p className="text-sm text-gray-600">
        {what} is not provisioned on this database, so there is nothing to show.
        {migration && <> Apply <code className="text-[11px] bg-gray-50 px-1 rounded">{migration}</code> to enable it.</>}
        {" "}No figures are estimated in its place.
      </p>
    </Card>
  );
}

export function Skeleton({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="h-3 rounded bg-gray-100" style={{ width: `${100 - i * 12}%` }} />
      ))}
      <span className="cmp-sr-only">Loading</span>
    </div>
  );
}

// ── Table helpers ───────────────────────────────────────────────────────────────────────────────────────
// PUI-003 s9: wide content scrolls inside its own container so the page body never scrolls sideways.
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto">{children}</div>;
}

export function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th scope="col" className={`pb-2 text-[11px] font-semibold text-gray-400 uppercase tracking-wider ${align === "right" ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}
