import Link from "next/link";
import type { Figure, LadderRung, ConfigDomain, DomainStore } from "@/lib/hq/pd-configuration";
import { RUNG_STATE_LABEL } from "@/lib/hq/pd-configuration";

// Shared furniture for Product Configuration's eleven pages (CPR-PD-011).
//
// ⚠ THE RULES THESE COMPONENTS EXIST TO KEEP, written once so eleven pages cannot each forget one.
// They are the CPR-PD screen doctrine, expressed as types rather than as good intentions.
//
//   A FIGURE IS EITHER MEASURED OR IT IS A SENTENCE. `Stat` takes a `Figure`, whose three states are
//   value / unknown / absent. There is no prop that accepts a bare number, so a component cannot draw
//   one the loader did not gate. An em-dash in a metric slot claims something was measured and came
//   back empty; a zero claims it came back zero. Both are lies when the read failed.
//
//   COLOUR IS GRANTED ONLY TO A REAL VALUE. `tone` is applied inside the `state === "value"` branch and
//   nowhere else, so an unmeasured metric structurally cannot wear a reassuring colour.
//
//   NEVER COLOUR ALONE. Every rung state and every store verdict carries its word beside the dot.
//
//   EXPLANATIONS GO BEHIND A REAL <details>. `title` is unreachable by keyboard and unread by a screen
//   reader, so it is not used as the carrier for anything a reader needs.
//
// No client component here and none on the eleven pages: everything is a server render of facts the
// loader already resolved.

export function ConfigHeader({ title, purpose, spec, children }: {
  title: string; purpose: string; spec: string; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/pd/configuration" className="hover:text-teal-700">Product Configuration</Link>
        <span>/</span><span className="text-gray-600">{title}</span>
      </div>
      <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">{purpose}</p>
      <p className="mt-1 font-mono text-[11px] text-gray-400">{spec}</p>
      {children}
    </div>
  );
}

export function Stat({ label, figure, scope, tone }: {
  label: string;
  figure: Figure;
  /** What the number is over. A count without its denominator is not a fact. */
  scope?: string;
  tone?: "neutral" | "critical" | "warning" | "success";
}) {
  const toneClass =
    tone === "critical" ? "text-[var(--cmp-text-critical)]"
      : tone === "warning" ? "text-[var(--cmp-text-warning)]"
        : tone === "success" ? "text-[var(--cmp-text-success)]"
          : "text-gray-900";
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      {figure.state === "value" ? (
        <>
          <p className={`text-2xl font-bold tabular-nums ${toneClass}`}>{figure.value.toLocaleString()}</p>
          {scope && <p className="text-[11px] leading-snug text-gray-500">{scope}</p>}
        </>
      ) : (
        <>
          <p className="mt-1 text-[12px] font-semibold text-gray-700">
            {figure.state === "unknown" ? "Could not be read" : "Not shown"}
          </p>
          <Explain summary={figure.state === "unknown" ? "Why there is no number here" : "Why this is not shown"}>
            {figure.why}
          </Explain>
        </>
      )}
    </div>
  );
}

export function Panel({ title, note, children }: {
  title: string; note?: string; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <h2 className="text-[13px] font-bold text-gray-900">{title}</h2>
      {note && <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

/**
 * The sentence that explains a figure, behind a real disclosure control.
 *
 * ⚠ NOT A `title` ATTRIBUTE. The doctrine is explicit: `title` is unreachable by keyboard and unread by
 * a screen reader, so it cannot carry a sentence the reader needs. And not inline prose either — three
 * lines under every tile is how a six-card row becomes a scroll.
 */
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

/**
 * ⚠ THE ONE PLACE A MIGRATION NUMBER, FILE OR LINE MAY APPEAR ON THESE PAGES.
 *
 * PD-001 §3 and the PD screen doctrine both say the same thing: raw implementation detail must not
 * dominate a Product Director surface — it belongs in Technical Operations and Diagnostics. But
 * deleting a citation would make a verdict something a reader has to TRUST, and these verdicts are
 * only worth reading because they can be checked. So the visible sentence states the fact in the
 * product's own language and the exact reference goes here, one click away, where a developer or an
 * auditor looks for it.
 *
 * Rule of thumb the module follows: a table or column NAME may be visible — it is the answer to
 * "where does this setting live", which is a Product Director's question. A migration number or a
 * file:line is not; it is the answer to "prove it".
 */
export function Cite({ children }: { children: React.ReactNode }) {
  return (
    <Explain summary="Where to check this">
      <span className="font-mono text-[10px] break-words text-gray-500">{children}</span>
    </Explain>
  );
}

/**
 * Several facts this surface does NOT have, as a tight list. Never "coming soon".
 *
 * ⚠ THE SAME REFUSAL, AT A DENSITY A LIST CAN CARRY. Five dashed cards of full prose is four screens
 * of a reader being told the same shape of thing five times. The NAME of the missing fact is the row;
 * the registry's sentence — which is the part that must never be softened or dropped — is one click
 * away on the row itself. Use `Absent` when there is exactly one, where a card is the right weight.
 */
export function AbsentList({ items }: { items: { label: string; why: string }[] }) {
  return (
    <ul className="flex flex-col">
      {items.map(i => (
        <li key={i.label} className="border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
          <p className="text-[12px] font-semibold text-gray-800">
            {i.label} <span className="font-normal text-gray-400">— not shown</span>
          </p>
          <Explain summary="Why this is not shown">{i.why}</Explain>
        </li>
      ))}
    </ul>
  );
}

/** A fact this surface does NOT have, with the reason named. Never "coming soon". */
export function Absent({ what, why }: { what: string; why: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-300 bg-[var(--cmp-surface-neutral)] p-4">
      <p className="text-[12px] font-bold text-gray-700">{what}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{why}</p>
    </div>
  );
}

export function Warn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">{title}</p>
      <div className="mt-1.5 text-[12px] leading-relaxed text-gray-800">{children}</div>
    </div>
  );
}

export function ModuleLink({ href, label, summary }: { href: string; label: string; summary: string }) {
  return (
    <Link href={href}
      className="block rounded-xl border border-gray-200 bg-white p-4 transition hover:border-teal-600 hover:bg-teal-50/30">
      <p className="text-[13px] font-bold text-gray-900">{label} →</p>
      <p className="mt-1 text-[12px] leading-relaxed text-gray-600">{summary}</p>
    </Link>
  );
}

// ── THE LADDER (PD-011 §3) ───────────────────────────────────────────────────────────────────────────
//
// ⚠ THE MOST IMPORTANT COMPONENT IN THIS MODULE, AND THE REASON IT IS NOT A DECORATIVE DIAGRAM.
//
// The comp draws six rungs as an inheritance stack. Drawing that alone would tell a Product Director
// that a market override is a thing this product does — and nothing in this system can write one, read
// one or evaluate one. So each rung carries its verdict, and the two rungs that have no scope at all
// are rendered as refusals rather than as empty rows waiting for data.
//
// ⚠ AND IT IS A TABLE, NOT SIX CARDS OF PROSE. Every verdict here is true and none of them is what a
// Product Director reads first: they learn ONE thing on this page — the engine does not yet serve
// Practice — and six full-width paragraphs made them read it six times. So the row carries the level,
// its status with its word beside the dot, and ONE short line in the product's language. The full
// verdict, §3's intent wording and the exact migration and line sit behind the row's own disclosure,
// which is where a developer or an auditor should find them and where PD-001 §3 says they belong.

const STATE_STYLE: Record<string, { dot: string; text: string }> = {
  resolves: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  partial: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  "no-scope": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
  "wrong-subject": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

export function Ladder({ rungs }: { rungs: LadderRung[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th className="w-[26%] py-1.5 pr-3 font-semibold">Level (§3)</th>
            <th className="w-[24%] py-1.5 pr-3 font-semibold">Does it resolve</th>
            <th className="py-1.5 font-semibold">What that means here</th>
          </tr>
        </thead>
        <tbody>
          {rungs.map((r, i) => {
            const s = STATE_STYLE[r.state];
            return (
              <tr key={r.level} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3">
                  <span className="font-mono text-[10px] text-gray-400">{i + 1}</span>{" "}
                  <span className="text-[12px] font-bold text-gray-900">{r.level}</span>
                </td>
                {/* ⚠ NEVER COLOUR ALONE — the dot always travels with its word. */}
                <td className="py-2 pr-3">
                  <span className={`inline-flex items-baseline gap-1.5 text-[11px] font-semibold leading-snug ${s.text}`}>
                    <span aria-hidden className={`relative top-[3px] inline-block h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                    {RUNG_STATE_LABEL[r.state]}
                  </span>
                </td>
                <td className="py-2 leading-snug text-gray-700">
                  {r.reason}
                  <Explain summary="The full verdict, and where to check it">
                    <p className="text-gray-500">
                      <span className="font-semibold text-gray-700">§3 asks this level to do:</span> {r.intent}
                    </p>
                    <p className="mt-1 text-gray-700">{r.verdict}</p>
                    {r.engine && (
                      <p className="mt-1 text-gray-700">
                        <span className="font-semibold">What implements it:</span> {r.engine}
                      </p>
                    )}
                    {r.citation && (
                      <p className="mt-1 font-mono text-[10px] break-words text-gray-500">{r.citation}</p>
                    )}
                  </Explain>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── WHERE A DOMAIN'S SETTINGS ACTUALLY LIVE ──────────────────────────────────────────────────────────

/**
 * ⚠ THE MIGRATION AND LINE ARE UNDER THE TABLE, NOT UNDER EVERY ROW.
 *
 * The store's NAME and whether this plane may read it are the whole of the answer at a Product
 * Director's altitude — "where does the booking horizon live" is answered by `practice_booking_rule`
 * and "refused". The exact migration and line are how the claim gets CHECKED, which is a different
 * job for a different reader, so they go in one disclosure beneath the table. Deleting them would
 * make the page unverifiable; printing them beside every row made it a schema dump.
 */
export function Stores({ stores }: { stores: DomainStore[] }) {
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-[12px]">
          <thead>
            <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
              <th className="py-1.5 pr-3 font-semibold">Store</th>
              <th className="py-1.5 pr-3 font-semibold">What it holds</th>
              <th className="py-1.5 font-semibold">Readable here</th>
            </tr>
          </thead>
          <tbody>
            {stores.map(s => (
              <tr key={s.table} className="border-b border-gray-100 align-top">
                <td className="py-2 pr-3">
                  <span className="font-mono text-[11px] text-gray-800">{s.table}</span>
                </td>
                <td className="py-2 pr-3 leading-snug text-gray-700">{s.holds}</td>
                <td className="py-2 whitespace-nowrap">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${s.readable ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${s.readable ? "bg-[var(--cmp-text-success)]" : "bg-[var(--cmp-text-critical)]"}`} />
                    {s.readable ? "Yes" : "Refused"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Explain summary="Where to check each of these in the schema">
        <ul className="mt-1 flex flex-col gap-0.5 font-mono text-[10px] text-gray-500">
          {stores.map(s => (
            <li key={s.table}>
              {s.table} — migration {s.migration}{s.cite ? `, ${s.cite}` : ""}
            </li>
          ))}
        </ul>
      </Explain>
    </>
  );
}

/**
 * The refusal sentence, written once and shown on every page whose domain tables are outside the plane.
 *
 * ⚠ THIS IS NOT "NOT BUILT". The rows exist and the product writes them every day. Saying so is the
 * difference between a reader going to look somewhere else and a reader concluding the feature is
 * missing.
 */
export function PlaneRefusal({ tables, why }: { tables: string[]; why: string }) {
  return (
    <div className="rounded-xl border border-[var(--cmp-color-warning)] bg-[var(--cmp-surface-warning)] p-4">
      <p className="text-[13px] font-bold text-[var(--cmp-text-warning)]">
        These values exist and this page may not read them
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-800">{why}</p>
      {tables.length > 0 && (
        <p className="mt-1.5 font-mono text-[11px] text-gray-700">{tables.join(" · ")}</p>
      )}
      <Explain summary="What it would take to change that">
        One entry per table in <span className="font-mono">PRACTICE_ALLOWLIST</span>{" "}
        (<span className="font-mono">src/lib/access/plane-boundary.ts</span>), naming the exact columns
        and the reason, plus the matching change to what the Practice product tells practitioners the
        platform can see. That is an owner decision, not a screen&apos;s: it has been taken once,
        deliberately, for one table, and the reasoning is recorded in the allowlist beside the grant.
      </Explain>
    </div>
  );
}

/** The settings the specification prescribes for a domain, as a plain list. Authored, never measured. */
export function Prescribed({ domain }: { domain: ConfigDomain }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Settings this domain owns</p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-gray-700">
          {domain.settings.map(s => <li key={s}>{s}</li>)}
        </ul>
      </div>
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-gray-500">Rules a change must not break</p>
        <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-4 text-[12px] leading-relaxed text-gray-700">
          {domain.constraints.map(c => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </div>
  );
}

/**
 * ⚠ WRITES AND APPROVALS, STATED RATHER THAN OFFERED.
 *
 * Migration 311 creates `hq.practice.configuration.manage` for configuration writes and deliberately
 * withholds `hq.practice.change.approve` from the Product Director — the checker half of maker-checker,
 * so a high-risk change is proposed by one person and approved by another. This build renders no
 * propose button and no approve button, and the reason is not caution: there is nowhere to write a
 * proposal to. PD-011 §29 names `configuration_change_set`, `configuration_approval` and
 * `configuration_activation`; the only one of the three that exists is the change set, and it carries
 * no approver, no approval class and no required-decision record.
 *
 * A button that opens a modal and writes nothing is worse than no button. So this panel says what the
 * process is, and where the two consoles that CAN change something actually live.
 */
export function WritesAndApprovals({ canManage, canApprove }: { canManage: boolean; canApprove: boolean }) {
  return (
    <Panel
      title="Changing a setting: what this page does, and what it deliberately does not"
      note="PD-011 §17 maker-checker, §25 segregation of duties.">
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
        <li>
          <span className="font-semibold text-gray-900">This page is read-only, and that is a design decision.</span>{" "}
          No value on it can be proposed, approved, scheduled or activated here. The capability for a
          configuration write exists — <span className="font-mono text-[11px]">hq.practice.configuration.manage</span>{" "}
          — and you {canManage ? "hold it" : "do not hold it"}. It is not offered because there is no
          proposal record to write to: of §29&apos;s three change objects, only the change set exists,
          and it carries no approver and no approval class.
        </li>
        <li>
          <span className="font-semibold text-gray-900">A high-risk change is proposed here and approved elsewhere.</span>{" "}
          <span className="font-mono text-[11px]">hq.practice.change.approve</span> is the checker half
          and is deliberately NOT granted to the Product Director. You{" "}
          {canApprove ? "hold it, which is unusual for this role — check the appointment that granted it" : "do not hold it, which is correct for this role"}.
          Until both halves have somewhere to record a decision, an approve button here would be an
          affordance with no counterparty.
        </li>
        <li>
          <span className="font-semibold text-gray-900">Where a configuration change is actually made today.</span>{" "}
          The registry catalogue is edited at{" "}
          <Link href="/super-admin/platform-ops/registry" className="font-semibold text-teal-700 hover:underline">Configuration Registry</Link>{" "}
          and scope overrides at{" "}
          <Link href="/super-admin/platform-ops/configuration" className="font-semibold text-teal-700 hover:underline">Workspace Configuration</Link>.
          ⚠ Both act on the ESTATE&apos;s configuration objects. Neither can change a Competen Practice
          setting, because no Practice setting is a registry object.
        </li>
        <li>
          <span className="font-semibold text-gray-900">A Practice&apos;s own settings are changed inside that Practice.</span>{" "}
          practice_configuration and the domain tables are written by the Practice product through its
          own guarded paths, audited into practice_audit_event. That is the delegation §3&apos;s
          &quot;Practice configuration&quot; rung describes — it simply is not delegated BY this engine,
          because this engine cannot address a Practice.
        </li>
      </ul>
      <Cite>
        Migration 311 creates hq.practice.configuration.manage and withholds hq.practice.change.approve
        from the Product Director. PD-011 §29 names configuration_change_set, configuration_approval and
        configuration_activation; only the change set exists, as configuration_releases (migration 099).
      </Cite>
    </Panel>
  );
}

/** Reads that did not complete, in the reader's words. Never swallowed, never rendered as zero. */
// ════════════════════════════════════════════════════════════════════════════════════════════════════
// CPR-PD-011 §6 / §27 — THE OVERVIEW'S COMMAND-SURFACE SHAPES.
//
// ⚠ THE APPROVED COMP'S SHAPES, NEVER ITS NUMBERS. The design shows 126 active definitions of 134, six
// hierarchy levels resolving at 100/100/92/88/85/0%, and ten domains at 58–100% coverage. Every one of
// those slots is filled here from what the engine actually reports. Where the comp draws a percentage
// this product cannot form, the slot renders the state instead — a level that CANNOT resolve is a fact,
// and "85% resolvable" would be a number with no denominator behind it.
// ════════════════════════════════════════════════════════════════════════════════════════════════════

const SAFETY_TONE: Record<string, string> = {
  clinical_safety_critical: "var(--cmp-color-error)",
  clinical_safety_relevant: "var(--cmp-color-warning)",
  clinical_support: "#0D9488",
  operational: "#2563EB",
  administrative: "#64748B",
  non_clinical: "#94A3B8",
};
const SAFETY_LABEL: Record<string, string> = {
  clinical_safety_critical: "Clinical-safety critical",
  clinical_safety_relevant: "Clinical-safety relevant",
  clinical_support: "Clinical support",
  operational: "Operational",
  administrative: "Administrative",
  non_clinical: "Non-clinical",
};
const pretty = (k: string) => SAFETY_LABEL[k] ?? k.replace(/_/g, " ");

/**
 * §4's safety classification, as the comp's donut.
 *
 * ⚠ THE ONLY GENUINELY COMPLETE DISTRIBUTION ON THIS SCREEN, which is why it earns the chart. Every
 * definition carries a classification and the constraint makes it mandatory, so the segments sum to the
 * registry total exactly — no "other", no rounding, nothing unclassified hiding in the middle.
 */
export function RiskDonut({ slices, total }: { slices: { key: string; n: number }[]; total: number | null }) {
  if (total === null || total === 0 || slices.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-gray-600">
        The registry could not be read, so no distribution can be drawn. That is not an empty registry.
      </p>
    );
  }
  const R = 52, C = 2 * Math.PI * R;
  // ⚠ OFFSETS PRECOMPUTED, NOT ACCUMULATED INSIDE map(). A `let offset` mutated during the render pass
  // is what React's immutability rule forbids, and it is the kind of thing a production build happily
  // compiles while eslint refuses it — the build passed on the first attempt and the lint did not.
  const arcs = slices.reduce<{ key: string; n: number; len: number; offset: number }[]>((acc, s) => {
    const prev = acc[acc.length - 1];
    const len = (s.n / total) * C;
    return [...acc, { key: s.key, n: s.n, len, offset: prev ? prev.offset + prev.len : 0 }];
  }, []);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 130 130" className="h-[130px] w-[130px] shrink-0" role="img"
        aria-label={`Definitions by safety classification: ${slices.map(s => `${pretty(s.key)} ${s.n}`).join(", ")}`}>
        <g transform="rotate(-90 65 65)">
          {arcs.map(a => (
            <circle key={a.key} cx="65" cy="65" r={R} fill="none"
              stroke={SAFETY_TONE[a.key] ?? "#94A3B8"} strokeWidth="16"
              strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.offset} />
          ))}
        </g>
        <text x="65" y="62" textAnchor="middle" className="fill-gray-900 text-[20px] font-bold">{total}</text>
        <text x="65" y="76" textAnchor="middle" className="fill-gray-400 text-[9px] font-semibold uppercase tracking-wider">Total</text>
      </svg>
      {/* ⚠ NEVER COLOUR ALONE — every segment is named and counted beside the chart. */}
      <ul className="min-w-[190px] flex-1 flex flex-col gap-1">
        {slices.map(s => (
          <li key={s.key} className="flex items-center gap-2 text-[11.5px]">
            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: SAFETY_TONE[s.key] ?? "#94A3B8" }} />
            <span className="min-w-0 flex-1 truncate text-gray-700">{pretty(s.key)}</span>
            <span className="shrink-0 tabular-nums font-semibold text-gray-900">{s.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * §3's six levels as the comp's numbered rail.
 *
 * ⚠ THE COMP PUTS A "RESOLUTION HEALTH" PERCENTAGE UNDER EACH LEVEL AND THERE IS NO SUCH FRACTION.
 * A level either resolves, resolves partially, or cannot be resolved at all — that is a property of the
 * SCHEMA, not a score out of the settings at that level. "85% resolvable" would need a count of
 * resolvable settings over a count of settings, and five of the six levels hold no settings whatever.
 * The state is the honest occupant of that slot, and it is the more decision-useful one.
 */
const RUNG_TONE: Record<string, string> = {
  resolves: "bg-teal-500",
  partial: "bg-amber-500",
  "wrong-subject": "bg-[var(--cmp-color-error)]",
  "no-scope": "bg-[var(--cmp-color-error)]",
};

export function HierarchyRail({ rungs }: { rungs: LadderRung[] }) {
  return (
    <div className="overflow-x-auto">
      <ol className="flex gap-2 pb-1" style={{ minWidth: "min-content" }}>
        {rungs.map((r, i) => (
          <li key={r.level} className="flex w-[176px] shrink-0 flex-col rounded-lg border border-gray-200 bg-white px-3 py-2.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 text-[10px] font-bold text-gray-500">
              {i + 1}
            </span>
            <span className="mt-1.5 text-[12px] font-semibold leading-snug text-gray-900">{r.level}</span>
            <span className="mt-1 text-[10.5px] leading-snug text-gray-500">{r.intent}</span>
            <span aria-hidden className={`mt-2 h-1 w-full rounded-full ${RUNG_TONE[r.state] ?? "bg-gray-300"}`} />
            <span className="mt-1.5 text-[10.5px] font-semibold text-gray-600">{RUNG_STATE_LABEL[r.state]}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * Per-domain coverage, as the comp's bar list.
 *
 * ⚠ AND THE LABEL IS THE WHOLE POINT: THIS MEASURES WHAT THIS PLANE MAY READ, NOT HOW CONFIGURED A
 * DOMAIN IS. The comp's "Configuration coverage — how complete is our configuration across domains"
 * implies the second, and this product cannot answer it: no domain has a count of settings it OUGHT to
 * have. Both halves of what IS shown are real — stores the allowlist admits, over stores the domain
 * uses — so the bar is a measurement rather than an impression, provided it is named correctly.
 */
export function DomainCoverage({ domains }: { domains: { key: string; title: string; href: string; stores: { readable: boolean }[] }[] }) {
  return (
    <ul className="flex flex-col gap-1.5">
      {domains.map(d => {
        const total = d.stores.length;
        const readable = d.stores.filter(s => s.readable).length;
        const pct = total === 0 ? 0 : (readable / total) * 100;
        return (
          <li key={d.key}>
            <Link href={d.href} className="group flex items-center gap-2.5">
              <span className="w-[150px] shrink-0 truncate text-[11.5px] text-gray-700 group-hover:text-gray-900">{d.title}</span>
              <span aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-200">
                <span className={`block h-full rounded-full ${readable === total && total > 0 ? "bg-teal-500" : readable === 0 ? "bg-[var(--cmp-color-error)]" : "bg-amber-500"}`}
                  style={{ width: `${Math.max(pct, total === 0 ? 0 : 3)}%` }} />
              </span>
              <span className="w-[52px] shrink-0 text-right text-[11px] tabular-nums text-gray-600">
                {readable}/{total}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** §6's recent changes, in the comp's table shape. §6 wants actor, setting, scope, values, time, status. */
export function ChangesTable({ rows }: {
  rows: { key: string; name: string; channel: string | null; rollout: string | null; status: string; objects: number; at: string | null }[];
}) {
  if (rows.length === 0) {
    return (
      <p className="text-[12px] leading-relaxed text-gray-600">
        The change-set store answered and holds no rows. ⚠ A measured empty table, not an unreadable one:
        nobody has grouped a configuration edit into a named change set, so there is no recent change to
        list rather than a list that failed to load.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] font-bold uppercase tracking-wider text-gray-400">
            <th className="py-1.5 pr-3">Change set</th>
            <th className="py-1.5 pr-3">Included</th>
            <th className="py-1.5 pr-3">Mode</th>
            <th className="py-1.5 pr-3">Status</th>
            <th className="py-1.5">When</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key} className="border-b border-gray-100 last:border-0">
              <td className="py-1.5 pr-3 font-medium text-gray-800">{r.name || r.key}</td>
              <td className="py-1.5 pr-3 tabular-nums text-gray-600">{r.objects}</td>
              <td className="py-1.5 pr-3 text-gray-600">{r.rollout ?? "—"}</td>
              <td className="py-1.5 pr-3 text-gray-700">{r.status}</td>
              <td className="py-1.5 font-mono text-[11px] text-gray-500">{r.at ? new Date(r.at).toISOString().slice(0, 10) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] leading-relaxed text-gray-500">
        §6 asks each row to carry the actor, the scope and the previous and new effective value. The
        change-set store holds none of those — it records the set, not the per-key diff — so the columns
        that exist are shown and the ones that do not are named here rather than left blank.
      </p>
    </div>
  );
}

/** The footer strip: what this module is, and the one sentence a reader should leave with. */
export function ConfigFooter({ at }: { at: string }) {
  return (
    <footer className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1.5">
        <p className="text-[11px] leading-relaxed text-gray-600">
          Configuration is data that decides how Competen Practice behaves. This module governs that data;
          whether a capability EXISTS is Releases &amp; Capabilities, and whether it is healthy at runtime
          is Product Health.
        </p>
        <p className="shrink-0 font-mono text-[10.5px] text-gray-400">CPR-PD-011 · Configuration Overview</p>
      </div>
      <p className="mt-1.5 text-[10.5px] text-gray-500">
        All times GMT · read at request time and cached nowhere, so this page does not poll and nothing on
        it is stale · counted at {new Date(at).toISOString().replace("T", " ").slice(0, 16)}
      </p>
    </footer>
  );
}

export function ReadFailures({ problems }: { problems: string[] }) {
  if (problems.length === 0) return null;
  return (
    <Warn title="Some reads on this page did not complete">
      <p>
        Every figure they feed is shown as &quot;could not be read&quot; rather than as a zero. A missing
        number is a question; a wrong zero ends one.
      </p>
      <ul className="mt-1.5 flex flex-col gap-0.5 font-mono text-[11px]">
        {problems.map(p => <li key={p}>{p}</li>)}
      </ul>
    </Warn>
  );
}

/**
 * ⚠ THE STAMP A PAGE THAT READ NOTHING MUST CARRY INSTEAD OF A FRESHNESS TIME.
 *
 * Seven of these pages make no database call, because every store their domain owns is on the Practice
 * plane. Printing "Read at 14:32 UTC" on such a page would be a freshness claim about a read that never
 * happened — the same class of defect as a zero standing in for an unreadable count. So they say what
 * they are: statements about the schema, each verifiable at the migration and line the stores
 * disclosure names.
 */
export function NoReadNote({ why }: { why: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-400">
      ⚠ This page makes no database read, so it carries no freshness stamp. {why} Everything on it is a
      statement about the schema, checkable at the migration and line listed under the stores above.
    </p>
  );
}

export function ReadStamp({ at, note }: { at: string; note?: string }) {
  return (
    <p className="text-[11px] text-gray-400">
      Read at {at.slice(0, 16).replace("T", " ")} UTC.{" "}
      {note ?? "Every figure on this page is counted from the live database at request time; none is cached, projected or sampled."}
    </p>
  );
}

/** The one-line reminder of what this module is not, per §23's ownership table. */
export function NotThisModule({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-gray-500">{children}</p>;
}

/**
 * The three sections every §7–§15 domain page carries, in the same order.
 *
 * ⚠ SHARED BECAUSE THE ANSWER IS SHARED, NOT TO SAVE TYPING. Nine domains hit the same wall for the
 * same reason — their tables are on the Practice plane and this plane may not read them — and nine
 * different phrasings of one refusal would read as nine different problems. What differs per domain is
 * the DATA: the settings it owns, the rules a change must not break, and the tables that hold them.
 * That is in `DOMAINS`, and each page adds whatever it can genuinely show on top.
 */
export function DomainSections({ domain, refusalWhy }: { domain: ConfigDomain; refusalWhy: string }) {
  const refused = domain.stores.filter(s => !s.readable);
  return (
    <>
      <Panel title="What this domain configures" note={`${domain.spec} — the settings and the rules, in the specification's own vocabulary.`}>
        <Prescribed domain={domain} />
      </Panel>

      <Panel title="Where these settings live today"
        note="Every store named, so a reader who asks where a setting lives is answered rather than told a capability is missing when the rows are right there. The migration and line that prove each one are behind the disclosure below.">
        <Stores stores={domain.stores} />
      </Panel>

      {refused.length > 0 && <PlaneRefusal tables={refused.map(s => s.table)} why={refusalWhy} />}
    </>
  );
}

/**
 * The rung summary a domain page carries: which levels of §3 could govern THIS domain's settings.
 *
 * The answer is the same for every domain because it is a property of the schema rather than of the
 * domain — which is exactly why it is worth repeating on each page instead of leaving a reader to infer
 * that scheduling somehow has a market layer that clinical does not.
 */
export function RungSummary({ rungs }: { rungs: LadderRung[] }) {
  const resolving = rungs.filter(r => r.state === "resolves" || r.state === "partial");
  const refused = rungs.filter(r => r.state === "no-scope" || r.state === "wrong-subject");
  return (
    <Panel title="Which levels could govern these settings (§3)"
      note="A property of the schema, not of this domain — the same six rungs answer the same way everywhere.">
      <p className="text-[12px] leading-relaxed text-gray-700">
        <span className="font-semibold text-gray-900">{resolving.length} of {rungs.length} rungs resolve:</span>{" "}
        {resolving.map(r => r.level).join(", ")}.{" "}
        <span className="font-semibold text-[var(--cmp-text-critical)]">{refused.length} cannot:</span>{" "}
        {refused.map(r => r.level).join(", ")}.
      </p>
      <p className="mt-1.5 text-[12px] leading-relaxed text-gray-700">
        So a market-specific or plan-specific value for anything on this page cannot be written, cannot
        be evaluated and cannot be counted — and a Practice-level delegation cannot be expressed by this
        engine, because a Practice cannot be the subject of an override row.
      </p>
      <Explain summary="The six rungs and their verdicts">
        <Ladder rungs={rungs} />
      </Explain>
    </Panel>
  );
}
