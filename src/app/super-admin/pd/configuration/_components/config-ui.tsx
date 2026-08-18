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

const STATE_STYLE: Record<string, { dot: string; text: string }> = {
  resolves: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  partial: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  "no-scope": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
  "wrong-subject": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

export function Ladder({ rungs }: { rungs: LadderRung[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {rungs.map((r, i) => {
        const s = STATE_STYLE[r.state];
        return (
          <li key={r.level} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-gray-400">{i + 1}</span>
              <span className="text-[13px] font-bold text-gray-900">{r.level}</span>
              {/* ⚠ NEVER COLOUR ALONE — the dot always travels with its word. */}
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${s.text}`}>
                <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${s.dot}`} />
                {RUNG_STATE_LABEL[r.state]}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-gray-600">{r.intent}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{r.verdict}</p>
            {r.engine && (
              <Explain summary="What implements this rung">
                <span className="font-mono text-[11px] break-words">{r.engine}</span>
              </Explain>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── WHERE A DOMAIN'S SETTINGS ACTUALLY LIVE ──────────────────────────────────────────────────────────

export function Stores({ stores }: { stores: DomainStore[] }) {
  return (
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
                <span className="block font-mono text-[10px] text-gray-400">migration {s.migration}</span>
              </td>
              <td className="py-2 pr-3 leading-relaxed text-gray-700">{s.holds}</td>
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
      note="PD-011 §17 maker-checker, §25 segregation of duties, migration 311.">
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
          and is deliberately NOT granted to the Product Director (migration 311). You{" "}
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
    </Panel>
  );
}

/** Reads that did not complete, in the reader's words. Never swallowed, never rendered as zero. */
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
 * they are: statements about the schema, each verifiable at the migration and line named above.
 */
export function NoReadNote({ why }: { why: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-400">
      ⚠ This page makes no database read, so it carries no freshness stamp. {why} Everything on it is a
      statement about the schema, checkable at the migration and line named beside each store.
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
        note="Named at the migration and line so a reader can go and look, rather than being told a capability is missing when the rows are right there.">
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
