import Link from "next/link";
import type {
  Figure, Sample, HealthState, Coverage, Domain, AttentionSignal, Freshness,
} from "@/lib/hq/pd-health";
import { HEALTH_STATE_LABEL, COVERAGE_LABEL } from "@/lib/hq/pd-health";

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-008 — the Product Health view kit.
//
// ⚠ NOTHING HERE DECIDES WHETHER A FIGURE MAY RENDER. The registry gate runs in the loader, so an absent
// metric arrives already carrying its sentence and there is nothing for a component to forget.
//
// ⚠ AND EVERY IMPLEMENTATION IDENTIFIER GOES IN <Cite> OR <Explain>. PD-001 s3 keeps migration numbers,
// table names and file paths off a Director's surface — not deleted, because a verdict the reader cannot
// check is worth nothing, but one click away. pd-screen-doctrine-harness counts this.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

/** A real <details>. `title` is not an acceptable carrier: unreachable by keyboard, unread by a reader. */
export function Explain({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="mt-1.5 text-[11px] leading-relaxed text-gray-600">
      <summary className="cursor-pointer font-semibold text-teal-700 marker:text-gray-400 hover:underline">
        {summary}
      </summary>
      <div className="mt-1 text-gray-600">{children}</div>
    </details>
  );
}

export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <Explain summary="Where to check this">
      <span className="font-mono text-[10px] break-words text-gray-500">{children}</span>
    </Explain>
  );
}

export function HealthHeader({ title, spec, purpose, readAt, windowDays }: {
  title: string; spec: string; purpose: string; readAt: string; windowDays: number;
}) {
  return (
    <header className="mb-4 border-b border-gray-200 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Product Health</p>
          <h1 className="mt-0.5 text-[22px] font-bold leading-tight tracking-tight text-gray-900">{title}</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-gray-600">{purpose}</p>
        </div>
        <div className="shrink-0 text-right">
          {/* ⚠ GMT, BECAUSE FRESHNESS MUST MEAN THE SAME THING TO TWO READERS IN TWO COUNTRIES. */}
          <p className="font-mono text-[11px] text-gray-500">
            {new Date(readAt).toISOString().replace("T", " ").slice(0, 16)} GMT
          </p>
          <p className="text-[11px] text-gray-400">counted over the last {windowDays} days</p>
          <p className="mt-0.5 font-mono text-[10px] text-gray-400">{spec}</p>
        </div>
      </div>
    </header>
  );
}

export function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * One figure.
 *
 * ⚠ COLOUR IS GRANTED ONLY TO A MEASUREMENT. An unknown or absent figure cannot wear a reassuring tint,
 * because the tint is what a reader scans before the words.
 */
export function Stat({ label, f, unit, explain }: {
  label: string; f: Figure; unit?: string; explain?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      {f.state === "value" ? (
        <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
          {f.value.toLocaleString("en-GB")}
          {unit && <span className="ml-1 text-[12px] font-medium text-gray-400">{unit}</span>}
        </p>
      ) : (
        <>
          <p className="mt-0.5 text-[13px] font-semibold text-gray-400">
            {f.state === "unknown" ? "Could not be read" : "Not measured"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{f.why}</p>
        </>
      )}
      {f.state === "value" && explain}
    </div>
  );
}

/** A duration, rendered in the unit a person reads rather than raw milliseconds. */
export function Duration({ label, f, explain }: { label: string; f: Figure; explain?: React.ReactNode }) {
  if (f.state !== "value") return <Stat label={label} f={f} explain={explain} />;
  const ms = f.value;
  const text = ms >= 1000 ? `${(ms / 1000).toFixed(ms >= 10_000 ? 1 : 2)}s` : `${Math.round(ms)}ms`;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">{text}</p>
      {explain}
    </div>
  );
}

/**
 * A share.
 *
 * ⚠ IT RENDERS ITS DENOMINATOR, ALWAYS. A percentage with no stated base is the figure this product's
 * honesty rules exist to prevent; the registry already refuses a rate whose halves are not both real.
 */
export function Share({ label, f, of }: { label: string; f: Figure; of: string }) {
  if (f.state !== "value") return <Stat label={label} f={f} />;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</p>
      <p className="mt-0.5 text-[22px] font-bold leading-none tracking-tight text-gray-900 tabular-nums">
        {(f.value * 100).toFixed(1)}<span className="ml-0.5 text-[12px] font-medium text-gray-400">%</span>
      </p>
      <p className="mt-1 text-[11px] text-gray-500">of {of}</p>
    </div>
  );
}

/** Says what a sampled statistic was actually computed over. Silence here is how a truncation lies. */
export function SampleNote({ sample, what }: { sample: Sample; what: string }) {
  if (!sample.truncated) {
    return <p className="text-[11px] text-gray-500">{what} computed over all {sample.read.toLocaleString("en-GB")} rows in the window.</p>;
  }
  return (
    <p className="text-[11px] leading-relaxed text-[var(--cmp-text-warning)]">
      ⚠ {what} computed over the most recent {sample.read.toLocaleString("en-GB")} rows, not all{" "}
      {(sample.total ?? 0).toLocaleString("en-GB")} in the window. The read is capped at one thousand
      rows, so this is a recent sample rather than a window statistic.
    </p>
  );
}

export function Absent({ label, why }: { label: string; why: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 px-3 py-2.5">
      <p className="text-[12px] font-semibold text-gray-700">{label} <span className="font-normal text-gray-400">— not measured</span></p>
      <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{why}</p>
    </div>
  );
}

export function AbsentList({ items }: { items: { label: string; why: string }[] }) {
  return (
    <ul className="flex flex-col divide-y divide-gray-100">
      {items.map(i => (
        <li key={i.label} className="py-2 first:pt-0 last:pb-0">
          <p className="text-[12px] font-semibold text-gray-800">{i.label} <span className="font-normal text-gray-400">— not measured</span></p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-gray-600">{i.why}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * ⚠ A REFUSED READ IS NOT AN ABSENCE, AND THE TWO MUST NOT LOOK ALIKE. These rows exist and Competen
 * Practice writes them every day; this plane may not read them. Filing that under "no data" would leave
 * a reader with the exact opposite of the truth.
 */
export function PlaneRefusal({ what, tables, why }: { what: string; tables: readonly string[]; why: string }) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
        {what}: these values exist and this page may not read them
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-800">{why}</p>
      <Explain summary="What it would take to change that">
        One entry per table in the practice plane&apos;s allowlist, naming the exact columns and the
        reason, plus the matching change to what the Practice product tells practitioners the platform
        can see. That is an owner decision, not a screen&apos;s.
        <Cite>{tables.join(", ")} are absent from PRACTICE_ALLOWLIST in src/lib/access/plane-boundary.ts</Cite>
      </Explain>
    </div>
  );
}

const STATE_STYLE: Record<string, string> = {
  real: "bg-teal-50 text-teal-800 border-teal-300",
  partial: "bg-amber-50 text-amber-800 border-amber-300",
  absent: "bg-gray-100 text-gray-600 border-gray-300",
  refused: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]",
};
const STATE_WORD: Record<string, string> = {
  real: "Measured",
  partial: "Partly measured",
  absent: "Not measured",
  refused: "Refused read",
};

/** ⚠ NEVER COLOUR ALONE — the chip carries its word, so the state survives a monochrome screen. */
export function StateChip({ state }: { state: string }) {
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${STATE_STYLE[state] ?? STATE_STYLE.absent}`}>
      {STATE_WORD[state] ?? state}
    </span>
  );
}

export function SubmoduleGrid({ items }: { items: readonly { key: string; label: string; href: string; spec: string; state: string }[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {items.map(s => (
        <Link key={s.key} href={s.href}
          className="flex items-start justify-between gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
          <span className="min-w-0">
            <span className="block text-[12.5px] font-semibold text-gray-900">{s.label} →</span>
            <span className="mt-0.5 block font-mono text-[10px] text-gray-400">{s.spec}</span>
          </span>
          <StateChip state={s.state} />
        </Link>
      ))}
    </div>
  );
}

/** Read failures, shown rather than swallowed. A count that could not be read is not zero. */
export function ReadFailures({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-3">
      <p className="text-[12px] font-bold text-[var(--cmp-text-warning)]">Some reads did not answer</p>
      <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-gray-800">
        {problems.map(p => <li key={p}>{p}</li>)}
      </ul>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-008 §3 — THE COMMAND-SURFACE REGIONS.
//
// ⚠ THE APPROVED COMP'S SHAPES, NEVER ITS NUMBERS. The design shows a 92/100 health score, 99.93%
// availability, Apdex 0.86 and eight journeys at 93–99%. Every one of those is rendered here in its
// honest state, in the same slot, at the same size. When a producer arrives the shape is already built
// for the figure to land in — and until then the screen cannot be mistaken for a green dashboard.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const HEALTH_TONE: Record<HealthState, string> = {
  healthy: "bg-teal-50 text-teal-800 border-teal-300",
  degraded: "bg-amber-50 text-amber-800 border-amber-300",
  major: "bg-orange-50 text-orange-800 border-orange-400",
  critical: "bg-[var(--cmp-surface-warning)] text-[var(--cmp-text-warning)] border-[var(--cmp-color-warning)]",
  maintenance: "bg-sky-50 text-sky-800 border-sky-300",
  unknown: "bg-gray-100 text-gray-600 border-gray-300",
};

/** §12: state never relies on colour alone — the badge always carries its word. */
export function StateBadge({ state, size = "sm" }: { state: HealthState; size?: "sm" | "lg" }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded border font-bold uppercase tracking-wide ${HEALTH_TONE[state]} ${
      size === "lg" ? "px-2.5 py-1 text-[12px]" : "px-1.5 py-0.5 text-[10px]"}`}>
      {HEALTH_STATE_LABEL[state]}
    </span>
  );
}

const COVERAGE_TONE: Record<Coverage, string> = {
  measured: "text-teal-700",
  partial: "text-amber-700",
  absent: "text-gray-500",
  refused: "text-[var(--cmp-text-warning)]",
  stale: "text-orange-700",
};

export function CoverageChip({ coverage }: { coverage: Coverage }) {
  return (
    <span className={`text-[10px] font-semibold uppercase tracking-wide ${COVERAGE_TONE[coverage]}`}>
      {COVERAGE_LABEL[coverage]}
    </span>
  );
}

/**
 * §3 region A — Overall Practice Health.
 *
 * ⚠ THE QUAD BELOW THE VERDICT IS A COVERAGE TALLY, NOT A SUCCESS RATE. The comp puts "99.2% overall
 * success" there. There is no overall success to compute: no domain has an attempt count. What the same
 * four slots CAN carry truthfully is how much of the module has evidence at all, which is the fact a
 * Director most needs before reading anything else on the page.
 */
export function OverallHealth({ overall, tally, gatingCount, freshness, windowDays }: {
  overall: { state: HealthState; headline: string; why: string };
  tally: { measured: number; partial: number; absent: number; refused: number; stale: number };
  gatingCount: number;
  freshness: Freshness;
  windowDays: number;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-bold text-gray-900">Overall Practice Health</h2>
        <StateBadge state={overall.state} size="lg" />
      </div>
      <p className="mt-2 text-[26px] font-bold uppercase leading-none tracking-tight text-gray-900">{overall.headline}</p>
      <p className="mt-2 max-w-2xl text-[12px] leading-relaxed text-gray-700">{overall.why}</p>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([["measured", tally.measured], ["partial", tally.partial], ["refused", tally.refused], ["absent", tally.absent]] as const).map(([k, n]) => (
          <div key={k} className="rounded-lg border border-gray-200 px-2.5 py-2">
            <p className="text-[20px] font-bold leading-none tabular-nums text-gray-900">{n}</p>
            <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{COVERAGE_LABEL[k]}</p>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        {gatingCount} gating domain{gatingCount === 1 ? "" : "s"} — availability and workflow health — decide this verdict.
        A non-gating domain cannot make Practice dependable on its own.
      </p>
      <Explain summary="How this verdict was computed, and why it is not an average">
        §5 requires the overall state to come from configured objectives and criticality rather than a
        mean of whatever happens to be instrumented. Averaging nine domains would let a healthy AI service
        and a healthy job runner outvote an unmeasured sign-in journey, which is backwards: the domains
        that decide whether a practitioner can work are the ones that gate. Both gating domains are
        unmeasured, and §4&apos;s hard rule is that missing evidence must never resolve to Healthy.
        <span className="mt-1 block">
          Evidence window: {new Date(freshness.windowStart).toISOString().slice(0, 10)} to{" "}
          {new Date(freshness.windowEnd).toISOString().slice(0, 10)} ({windowDays} days), observed at{" "}
          {new Date(freshness.observedAt).toISOString().replace("T", " ").slice(0, 16)} GMT.
        </span>
      </Explain>
    </section>
  );
}

/** §3 region B — one domain tile. Carries its coverage AND its health state, which are different facts. */
export function DomainTile({ d }: { d: Domain }) {
  return (
    <Link href={d.href}
      className="flex flex-col rounded-lg border border-gray-200 bg-white px-3 py-2.5 transition-colors hover:border-gray-300 hover:bg-gray-50">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-semibold text-gray-900">{d.label}</span>
        <CoverageChip coverage={d.coverage} />
      </div>
      {d.evidence && d.evidence.state === "value" ? (
        <span className="mt-1 text-[19px] font-bold leading-none tabular-nums text-gray-900">
          {d.key === "errors" ? `${(d.evidence.value * 100).toFixed(2)}%`
            : d.key === "ai" ? (d.evidence.value >= 1000 ? `${(d.evidence.value / 1000).toFixed(1)}s` : `${Math.round(d.evidence.value)}ms`)
            : d.evidence.value.toLocaleString("en-GB")}
        </span>
      ) : (
        <span className="mt-1 text-[13px] font-semibold text-gray-400">No value</span>
      )}
      {d.evidenceLabel && <span className="mt-0.5 text-[10.5px] leading-snug text-gray-500">{d.evidenceLabel}</span>}
      <span className="mt-2"><StateBadge state={d.state} /></span>
    </Link>
  );
}

/** §3 region C — ranked signals, each carrying the §9 fields it can fill and naming the ones it cannot. */
export function NeedsAttention({ signals }: { signals: AttentionSignal[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="text-[13px] font-bold text-gray-900">Needs Attention</h2>
        <span className="text-[11px] font-semibold text-gray-400 tabular-nums">{signals.length}</span>
      </div>
      {signals.length === 0 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          Nothing in the readable logs is above zero. ⚠ That is not &ldquo;no degradations&rdquo; — no
          degradation record exists in this product, so this panel can only ever surface what a log
          happens to show.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-gray-100">
          {signals.map(s => (
            <li key={s.signalId} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[12.5px] font-semibold text-gray-900">{s.title}</p>
                <StateBadge state={s.severity} />
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-gray-600">{s.scope}</p>
              <p className="mt-0.5 text-[11.5px] text-gray-600">Impact: {s.impact}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <Link href={s.actionRoute.href} className="text-[11px] font-semibold text-teal-700 hover:underline">
                  {s.actionRoute.label} →
                </Link>
                <span className="text-[10.5px] text-gray-400">
                  no {s.missingFields.join(", no ")}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Explain summary="Why none of these has a start time, an owner or a status">
        §9 asks for all three, and a signal here is DERIVED at request time by counting a log. It has no
        lifecycle, so no status; nobody has ever been assigned one, so no owner; and a count over a window
        has no first-observation. A real degradation record — one row per degradation, opened when it
        starts and closed when it resolves — is what would fill those columns, and it does not exist.
      </Explain>
    </section>
  );
}

/**
 * §3 region D — the eight critical journeys.
 *
 * ⚠ RENDERED AS THE COMP'S HORIZONTAL CARDS, EACH SHOWING ITS SUCCESS COUNT SLOT EMPTY. §12 requires
 * the numerator and denominator to be shown for a workflow rate; there is neither, so each card shows
 * what its minimum measurable outcome would be instead. Eight cards reading "no attempts recorded" is a
 * far more useful screen than eight cards absent, because it says exactly what instrumenting costs.
 */
export function JourneyRail({ journeys }: { journeys: readonly { key: string; name: string; outcome: string }[] }) {
  return (
    <div className="overflow-x-auto">
      <div className="flex gap-2 pb-1" style={{ minWidth: "min-content" }}>
        {journeys.map(j => (
          <div key={j.key} className="flex w-[210px] shrink-0 flex-col rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <p className="text-[12px] font-semibold text-gray-900">{j.name}</p>
            <p className="mt-1.5 text-[17px] font-bold leading-none text-gray-400">— / —</p>
            <p className="mt-1 text-[10.5px] text-gray-500">no attempts recorded</p>
            <div className="mt-2 h-1 w-full rounded-full bg-gray-200" />
            <p className="mt-2 text-[10.5px] leading-snug text-gray-500">{j.outcome}</p>
            <span className="mt-2"><StateBadge state="unknown" /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** §3 region G — Recent Changes, for correlating a health window with what shipped into it. */
export function RecentChanges({ rows, windowDays }: {
  rows: readonly { version: string | null; channel: string | null; status: string | null; released_at: string | null }[];
  windowDays: number;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">Recent Changes</h2>
      {rows.length === 0 ? (
        <p className="mt-2 text-[12px] leading-relaxed text-gray-600">
          No deployment was recorded in the last {windowDays} days. ⚠ A statement about the deployment
          LOG, not about whether anything shipped — a release nobody recorded leaves no row.
        </p>
      ) : (
        <ul className="mt-2 flex flex-col divide-y divide-gray-100">
          {rows.slice(0, 6).map((r, i) => (
            <li key={`${r.version}-${i}`} className="flex items-baseline justify-between gap-2 py-1.5 first:pt-0">
              <span className="text-[12px] font-medium text-gray-800">{r.version ?? "—"}</span>
              <span className="text-[11px] text-gray-500">{r.channel ?? "—"} · {r.status ?? "—"}</span>
              <span className="font-mono text-[10.5px] text-gray-400">
                {r.released_at ? new Date(r.released_at).toISOString().slice(0, 10) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        §7 recommends a release version on every health event so a change can be correlated with a
        degradation. No health event carries one yet, so these are listed as context rather than joined
        to anything.
      </p>
    </section>
  );
}

/** §3 region H — footer metadata: window, freshness, refresh behaviour, spec identifier. */
export function FooterMeta({ freshness, windowDays }: { freshness: Freshness; windowDays: number }) {
  return (
    <footer className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <p className="text-[11px] leading-relaxed text-gray-600">
          Product Health detects, measures and explains. For incident response and coordination, go to
          Support &amp; Incidents — which is not built yet, so there is currently no route to hand a
          signal to.
        </p>
        <p className="shrink-0 font-mono text-[10.5px] text-gray-400">CPR-PD-008 · Health Overview</p>
      </div>
      <p className="mt-1.5 text-[10.5px] text-gray-500">
        All times GMT · window {windowDays} days, ending{" "}
        {new Date(freshness.windowEnd).toISOString().replace("T", " ").slice(0, 16)} · read at request
        time and cached nowhere, so this page does not poll and nothing on it is stale.
      </p>
    </footer>
  );
}

/**
 * §11 — the instrumentation drawer.
 *
 * ⚠ THIS IS WHERE THE COMMENTARY WENT, AND THE SPEC ASKED FOR THE MOVE BY NAME. §11: "The current
 * explanatory content may remain behind an Instrumentation/Coverage drawer or diagnostic view." §12:
 * "Technical schema/allowlist explanations must not dominate the normal Product Director view." The
 * explanations are not deleted — a Director who wants to know why a domain is unknown can still get the
 * full answer in one click, and the first viewport is no longer three paragraphs of schema.
 */
export function CoverageDrawer({ children }: { children: React.ReactNode }) {
  return (
    <details className="rounded-xl border border-gray-200 bg-white">
      <summary className="cursor-pointer px-4 py-3 text-[12.5px] font-semibold text-gray-900 hover:bg-gray-50">
        Instrumentation &amp; coverage — why domains read Unknown, and what each would need
      </summary>
      <div className="flex flex-col gap-4 border-t border-gray-200 p-4">{children}</div>
    </details>
  );
}

export function TechnicalOpsLink({ what }: { what: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-500">
      {what} is operated from Technical Operations, which this module deliberately does not reimplement —
      PD-001 §3 keeps the console and the lens apart.
    </p>
  );
}
