import Link from "next/link";
import type {
  Figure, RolloutStage, ReadinessGate, ResolverCondition, LifecycleState,
  TechnicalObject, MigrationRow, AttributeRow, StateRow, StructureRow, Held,
} from "@/lib/hq/pd-releases";
import {
  STAGE_STATE_LABEL, GATE_STATE_LABEL, CONDITION_STATE_LABEL, HELD_LABEL,
} from "@/lib/hq/pd-releases";

// Shared furniture for Releases & Capabilities' twelve pages (CPR-PD-012).
//
// ⚠ COPIED FROM Product Configuration's config-ui.tsx RATHER THAN IMPORTED ACROSS THE MODULE BOUNDARY.
// Two modules sharing a component means one module's layout change silently redraws the other's pages,
// and the reviewer of that change is looking at a different folder. The RULES below are the same rules
// because they are the CPR-PD screen doctrine, not because the file is the same file.
//
// ⚠ THE RULES THESE COMPONENTS EXIST TO KEEP, expressed as types rather than as good intentions:
//
//   A FIGURE IS EITHER MEASURED OR IT IS A SENTENCE. `Stat` takes a `Figure`, whose three states are
//   value / unknown / absent. There is no prop that accepts a bare number, so a component cannot draw
//   one the loader did not gate. An em-dash in a metric slot claims something was measured and came
//   back empty; a zero claims it came back zero. Both are lies when the read failed.
//
//   COLOUR IS GRANTED ONLY TO A REAL VALUE. `tone` is applied inside the `state === "value"` branch and
//   nowhere else, so an unmeasured metric structurally cannot wear a reassuring colour.
//
//   NEVER COLOUR ALONE. Every stage, gate and condition verdict carries its word beside the dot.
//
//   EXPLANATIONS GO BEHIND A REAL <details>. `title` is unreachable by keyboard and unread by a screen
//   reader, so it is never the carrier for anything a reader needs.
//
// No client component here and none on the twelve pages: everything is a server render of facts the
// loader already resolved.

export function ReleaseHeader({ title, purpose, spec, children }: {
  title: string; purpose: string; spec: string; children?: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-gray-400">
        <Link href="/super-admin/pd/releases" className="hover:text-teal-700">Releases &amp; Capabilities</Link>
        <span>/</span><span className="text-gray-600">{title}</span>
      </div>
      <h1 className="mt-0.5 text-2xl font-bold text-gray-900">{title}</h1>
      <p className="mt-1 max-w-3xl text-sm text-gray-600">{purpose}</p>
      <p className="mt-1 font-mono text-[11px] text-gray-500">{spec}</p>
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

/** A word rather than a number — a version string, a launch state. Never a measurement in disguise. */
export function Fact({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[10px] uppercase tracking-wide text-gray-400">{label}</p>
      <p className="text-xl font-bold text-gray-900">{value}</p>
      {note && <p className="text-[11px] leading-snug text-gray-500">{note}</p>}
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
 * ⚠ THE FORENSIC CITATION — migration, file and line. DISCLOSURE BODY ONLY, never a visible sentence.
 *
 * The doctrine is explicit: no implementation detail on a director surface — no UUIDs, no saga step
 * names, no migration numbers (PD-001 §3, PD-002 §4). And this module's whole method is that a reader
 * can CHECK a verdict rather than trust it, which needs exactly those numbers. Both hold: the claim is
 * in the product's language, and the line that proves it is one click away.
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
 * ⚠ THE SAME REFUSAL, AT A DENSITY A LIST CAN CARRY. Six dashed cards of full prose is most of a screen
 * spent telling a reader the same shape of thing six times, and this module has more absences than any
 * other. The NAME of the missing fact is the row; the registry's sentence — the part that must never be
 * softened or dropped — is one click away on the row itself, behind a real disclosure control. `Absent`
 * stays for the single case, where a card is the right weight.
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

/** A yes/no verdict that always travels with its word. Used for every schema-presence table. */
export function Verdict({ ok, yes, no }: { ok: boolean; yes: string; no: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${ok ? "text-[var(--cmp-text-success)]" : "text-[var(--cmp-text-critical)]"}`}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${ok ? "bg-[var(--cmp-text-success)]" : "bg-[var(--cmp-text-critical)]"}`} />
      {ok ? yes : no}
    </span>
  );
}

// ── THE SUB-SPECIFICATION'S OWN STATE MODEL AND STRUCTURE ────────────────────────────────────────────
//
// ⚠ THE SHARPEST TEST THIS MODULE CAN APPLY TO ITSELF, and the reason it is a compact table rather than
// prose. Each child specification lists the states its object must be able to HOLD and the elements its
// screen must be able to SHOW. Scoring them one row at a time tells a reader which parts of the
// prescribed product exist — instead of leaving them to infer it from which panels happen to be full,
// which is how a missing thing reads as a quiet one.
//
// Chip, one short reason, forensic detail behind the disclosure. Never colour alone.

const HELD_STYLE: Record<string, { dot: string; text: string }> = {
  yes: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  partial: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  no: { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

function HeldChip({ held, label }: { held: Held; label: string }) {
  const st = HELD_STYLE[held];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] font-semibold ${st.text}`}>
      <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${st.dot}`} />
      {label}
    </span>
  );
}

export function StateModel({ rows, holdLabel }: { rows: StateRow[]; holdLabel: string }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[640px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th scope="col" className="py-1.5 pr-3 font-semibold">State</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Meaning</th>
            <th scope="col" className="py-1.5 font-semibold">{holdLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.state} className="border-b border-gray-100 align-top">
              <th scope="row" className="py-1.5 pr-3 text-left font-bold whitespace-nowrap text-gray-900">{r.state}</th>
              <td className="py-1.5 pr-3 leading-relaxed text-gray-600">{r.meaning}</td>
              <td className="py-1.5">
                <HeldChip held={r.held} label={HELD_LABEL[r.held]} />
                <p className="mt-0.5 leading-relaxed text-gray-800">{r.reason}</p>
                {r.citation && <Cite>{r.citation}</Cite>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Structure({ rows }: { rows: StructureRow[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map(r => (
        <li key={r.element} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-gray-100 py-1.5 first:pt-0 last:border-0 last:pb-0">
          <span className="text-[12px] font-semibold text-gray-900">{r.element}</span>
          <HeldChip held={r.held} label={r.held === "yes" ? "On this page" : r.held === "partial" ? "Partly" : "Not shown"} />
          <span className="w-full text-[12px] leading-relaxed text-gray-600">{r.reason}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The questions the child specification says the FIRST VIEWPORT must answer (§9: "first viewport answers
 * the submodule's primary decision question"). Rendered at the foot as the page's own acceptance test,
 * so a reader can check the screen against what it was asked for rather than against an impression.
 */
export function Questions({ id, questions, answers }: {
  id: string; questions: string[]; answers: string[];
}) {
  return (
    <Panel title={`What ${id} says this page must answer`}
      note="The child specification's primary user questions, each with what this page actually answers today.">
      <ol className="flex flex-col gap-1.5">
        {questions.map((q, i) => (
          <li key={q} className="border-b border-gray-100 pb-1.5 last:border-0 last:pb-0">
            <p className="text-[12px] font-semibold text-gray-900">{q}</p>
            <p className="text-[12px] leading-relaxed text-gray-600">{answers[i] ?? "Not answered on this page."}</p>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

// ── THE ROLLOUT PIPELINE (§9) ────────────────────────────────────────────────────────────────────────
//
// ⚠ THE MOST IMPORTANT COMPONENT IN THIS MODULE, AND THE REASON IT IS NOT A DECORATIVE PIPELINE.
//
// The approved design draws seven stages with a population in each and a percentage dial above them.
// Drawing that alone would tell a Product Director that this product does progressive delivery — and
// nothing here can enter a stage, hold a cohort, assign a subject or count an exposure. So the SHAPE is
// kept, every stage carries its verdict, and the five stages nothing can enter are rendered as refusals
// rather than as empty rows waiting for data.

const STAGE_STYLE: Record<string, { dot: string; text: string }> = {
  controlled: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  partial: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  absent: { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

export function Pipeline({ stages }: { stages: RolloutStage[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {stages.map((s, i) => {
        const st = STAGE_STYLE[s.state];
        return (
          <li key={s.stage} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-gray-500">{i + 1}</span>
              <span className="text-[13px] font-bold text-gray-900">{s.stage}</span>
              {/* ⚠ NEVER COLOUR ALONE — the dot always travels with its word. */}
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${st.text}`}>
                <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${st.dot}`} />
                {STAGE_STATE_LABEL[s.state]}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-gray-600">{s.intent}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{s.verdict}</p>
            {s.engine && (
              <p className="mt-1 text-[12px] leading-relaxed text-gray-600">
                <span className="font-semibold text-gray-700">What does it here:</span> {s.engine}
              </p>
            )}
            {s.citation && <Cite>{s.citation}</Cite>}
          </li>
        );
      })}
    </ol>
  );
}

// ── THE READINESS GATES (§7) ─────────────────────────────────────────────────────────────────────────

const GATE_STYLE: Record<string, { dot: string; text: string }> = {
  live: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  partial: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  "no-evidence": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

export function Gates({ gates }: { gates: ReadinessGate[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Gate</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Minimum question (§7)</th>
            <th scope="col" className="py-1.5 font-semibold">What this plane can evidence</th>
          </tr>
        </thead>
        <tbody>
          {gates.map(g => {
            const st = GATE_STYLE[g.state];
            return (
              <tr key={g.gate} className="border-b border-gray-100 align-top">
                <th scope="row" className="py-2 pr-3 text-left font-bold text-gray-900">{g.gate}</th>
                <td className="py-2 pr-3 leading-relaxed text-gray-600">{g.question}</td>
                <td className="py-2">
                  <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${st.text}`}>
                    <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${st.dot}`} />
                    {GATE_STATE_LABEL[g.state]}
                  </span>
                  <p className="mt-1 leading-relaxed text-gray-800">{g.verdict}</p>
                  {g.citation && <Cite>{g.citation}</Cite>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── THE AVAILABILITY RESOLVER (§11) ──────────────────────────────────────────────────────────────────

const COND_STYLE: Record<string, { dot: string; text: string }> = {
  resolves: { dot: "bg-[var(--cmp-text-success)]", text: "text-[var(--cmp-text-success)]" },
  refused: { dot: "bg-[var(--cmp-color-warning)]", text: "text-[var(--cmp-text-warning)]" },
  "no-store": { dot: "bg-[var(--cmp-text-critical)]", text: "text-[var(--cmp-text-critical)]" },
};

export function Conditions({ conditions }: { conditions: ResolverCondition[] }) {
  return (
    <ol className="flex flex-col gap-2">
      {conditions.map((c, i) => {
        const st = COND_STYLE[c.state];
        return (
          <li key={c.condition} className="rounded-lg border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-[11px] text-gray-500">{i + 1}</span>
              <span className="text-[13px] font-bold text-gray-900">{c.condition}</span>
              <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${st.text}`}>
                <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${st.dot}`} />
                {CONDITION_STATE_LABEL[c.state]}
              </span>
            </div>
            <p className="mt-0.5 text-[12px] text-gray-600">{c.example}</p>
            <p className="mt-1 text-[12px] leading-relaxed text-gray-800">{c.verdict}</p>
            {c.citation && <Cite>{c.citation}</Cite>}
          </li>
        );
      })}
    </ol>
  );
}

// ── THE CAPABILITY LIFECYCLE (§4) ────────────────────────────────────────────────────────────────────

export function Lifecycle({ states }: { states: LifecycleState[] }) {
  return (
    <ol className="flex flex-col gap-1.5">
      {states.map((l, i) => (
        <li key={l.state} className="rounded-lg border border-gray-200 bg-white p-2.5">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-mono text-[11px] text-gray-500">{i + 1}</span>
            <span className="text-[12px] font-bold text-gray-900">{l.state}</span>
            <Verdict ok={l.represented !== null} yes="Representable" no="Nothing can hold this state" />
          </div>
          <p className="mt-0.5 text-[12px] leading-relaxed text-gray-600">{l.meaning}</p>
          {l.represented && <p className="mt-0.5 font-mono text-[10px] text-gray-500">{l.represented}</p>}
        </li>
      ))}
    </ol>
  );
}

// ── §25's TECHNICAL OBJECTS, AND §3's ATTRIBUTES ─────────────────────────────────────────────────────

export function ObjectTable({ objects }: { objects: TechnicalObject[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[560px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Object (§25)</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Exists</th>
            <th scope="col" className="py-1.5 font-semibold">Where, or why not</th>
          </tr>
        </thead>
        <tbody>
          {objects.map(o => (
            <tr key={o.name} className="border-b border-gray-100 align-top">
              <th scope="row" className="py-1.5 pr-3 text-left font-mono text-[11px] font-normal text-gray-800">{o.name}</th>
              <td className="py-1.5 pr-3"><Verdict ok={o.exists} yes="Yes" no="No" /></td>
              <td className="py-1.5 leading-relaxed text-gray-700">{o.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AttributeTable({ rows }: { rows: AttributeRow[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[640px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Attribute (§3)</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Requirement</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Carried</th>
            <th scope="col" className="py-1.5 font-semibold">Where, or why not</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.attribute} className="border-b border-gray-100 align-top">
              <th scope="row" className="py-1.5 pr-3 text-left font-bold text-gray-900">{r.attribute}</th>
              <td className="py-1.5 pr-3 leading-relaxed text-gray-600">{r.requirement}</td>
              <td className="py-1.5 pr-3"><Verdict ok={r.present} yes="Yes" no="No" /></td>
              <td className="py-1.5 leading-relaxed text-gray-700">{r.where}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MigrationTable({ rows }: { rows: MigrationRow[] }) {
  return (
    <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Scrollable table">
      <table className="w-full min-w-[720px] border-collapse text-[12px]">
        <thead>
          <tr className="border-b border-gray-200 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <th scope="col" className="py-1.5 pr-3 font-semibold">Current control</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Exists</th>
            <th scope="col" className="py-1.5 pr-3 font-semibold">Target model (§19)</th>
            <th scope="col" className="py-1.5 font-semibold">Destination exists</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.current} className="border-b border-gray-100 align-top">
              <th scope="row" className="py-2 pr-3 text-left font-mono text-[11px] font-normal text-gray-800">{r.current}</th>
              <td className="py-2 pr-3"><Verdict ok={r.currentReal} yes="Real today" no="Not present" /></td>
              <td className="py-2 pr-3 leading-relaxed text-gray-700">
                {r.target}
                <span className="mt-1 block text-gray-600">{r.note}</span>
              </td>
              <td className="py-2"><Verdict ok={r.targetReal} yes="Built" no="No such object" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── REFUSALS AND FAILURES ────────────────────────────────────────────────────────────────────────────

/**
 * The refusal sentence for data that EXISTS and that this plane may not read.
 *
 * ⚠ THIS IS NOT "NOT BUILT". The rows exist and the Practice product writes them every day. Saying so
 * is the difference between a reader going to look somewhere else and a reader concluding the feature
 * is missing.
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
        platform can see. That is an owner decision, not a screen&apos;s: it has been taken twice,
        deliberately, and the reasoning is recorded in the allowlist beside each grant.
      </Explain>
    </div>
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

export function ReadStamp({ at, note }: { at: string; note?: string }) {
  return (
    <p className="text-[11px] text-gray-500">
      Read at {at.slice(0, 16).replace("T", " ")} UTC.{" "}
      {note ?? "Every figure on this page is counted from the live database at request time; none is cached, projected or sampled."}
    </p>
  );
}

/**
 * ⚠ THE STAMP A PAGE THAT READ NOTHING MUST CARRY INSTEAD OF A FRESHNESS TIME.
 *
 * Printing "Read at 14:32 UTC" on a page that made no database call is a freshness claim about a read
 * that never happened — the same class of defect as a zero standing in for an unreadable count.
 */
export function NoReadNote({ why }: { why: string }) {
  return (
    <p className="text-[11px] leading-relaxed text-gray-400">
      ⚠ This page makes no database read, so it carries no freshness stamp. {why} Everything on it is a
      statement about the schema or about code that ships with the product, checkable at the file,
      migration and line named beside each claim.
    </p>
  );
}

/** The one-line reminder of what this module is not, per §1's ownership table. */
export function NotThisModule({ children }: { children: React.ReactNode }) {
  return <p className="text-[12px] leading-relaxed text-gray-500">{children}</p>;
}

export function AttentionList({ items }: {
  items: { label: string; detail: string; tone: "critical" | "warning" | "neutral" }[];
}) {
  return (
    <ul className="flex flex-col gap-2 text-[12px]">
      {items.map(a => (
        <li key={a.label}>
          <span className={`inline-flex items-center gap-1.5 font-bold ${a.tone === "critical" ? "text-[var(--cmp-text-critical)]" : a.tone === "warning" ? "text-[var(--cmp-text-warning)]" : "text-gray-800"}`}>
            <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${a.tone === "critical" ? "bg-[var(--cmp-text-critical)]" : a.tone === "warning" ? "bg-[var(--cmp-color-warning)]" : "bg-gray-400"}`} />
            {a.tone === "critical" ? "Critical" : a.tone === "warning" ? "Warning" : "For information"}
          </span>
          <p className="mt-0.5 font-semibold text-gray-900">{a.label}</p>
          <p className="text-gray-600">{a.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * ⚠ WRITES AND APPROVALS, STATED RATHER THAN OFFERED.
 *
 * Migration 311 creates `hq.practice.release.activate` and `hq.practice.release.rollback` and grants
 * both to the Product Director, and deliberately WITHHOLDS `hq.practice.change.approve` — the checker
 * half of maker-checker, so a high-risk change is proposed by one person and approved by another.
 *
 * This build renders no activate button and no approve button, and the reason is not caution:
 *
 *   THERE IS NOTHING TO ACTIVATE. §25's release, rollout and rollback objects do not exist, so
 *   "activate a release" has no row to write and no state to move. A button that opens a modal and
 *   writes nothing is worse than no button.
 *
 *   AN APPROVE BUTTON WOULD HAVE NO COUNTERPARTY. No approval record exists, and the Product Director
 *   does not hold the approving capability by design. Rendering it would advertise a workflow that
 *   cannot complete.
 *
 * The one write that IS real is a launch-flag flip, and it already has an endpoint and a console. This
 * panel points at that console rather than reimplementing the control beside a different audit trail.
 */
export function WritesAndApprovals({ canActivate, canRollback, canApprove, canFlags }: {
  canActivate: boolean; canRollback: boolean; canApprove: boolean; canFlags: boolean;
}) {
  return (
    <Panel
      title="Changing something here: what this module does, and what it deliberately does not"
      note="PD-012 §21 segregation of duties, §22 audit and evidence.">
      <ul className="flex flex-col gap-2 text-[12px] leading-relaxed text-gray-700">
        <li>
          <span className="font-semibold text-gray-900">You hold the release actions, and there is nothing for them to act on.</span>{" "}
          <span className="font-mono text-[11px]">hq.practice.release.activate</span> —{" "}
          {canActivate ? "held" : "not held"} — and{" "}
          <span className="font-mono text-[11px]">hq.practice.release.rollback</span> —{" "}
          {canRollback ? "held" : "not held"} — are both granted to this position. No
          button offers either, because §25&apos;s rollout, rollout_stage and rollback_plan objects do
          not exist: there is no row to activate and no plan to reverse.
          <Cite>hq.practice.release.activate and hq.practice.release.rollback were created and granted
          to the Product Director position by migration 311.</Cite>
        </li>
        <li>
          <span className="font-semibold text-gray-900">Approval is deliberately somebody else&apos;s.</span>{" "}
          <span className="font-mono text-[11px]">hq.practice.change.approve</span> is the checker half
          of maker-checker and is withheld from the Product Director by design. You{" "}
          {canApprove ? "hold it, which is unusual for this role — check the appointment that granted it" : "do not hold it, which is correct for this role"}.
          Until both halves have somewhere to record a decision, an approve button here would be an
          affordance with no counterparty.
        </li>
        <li>
          <span className="font-semibold text-gray-900">The one real production write is a launch-flag flip, and it lives where it already lives.</span>{" "}
          <span className="font-mono text-[11px]">PATCH /api/v1/practice/flags</span> is gated on{" "}
          <span className="font-mono text-[11px]">hq.practice.flags.manage</span> — you{" "}
          {canFlags ? "hold it" : "do not hold it"} — and writes an audit event on every flip. Its
          console is{" "}
          <Link href="/super-admin/platform-ops/practice" className="font-semibold text-teal-700 hover:underline">Technical Operations</Link>,
          which PD-001 §3 retains. Reimplementing the toggle here would create a second surface that has
          to remember the same consequences.
        </li>
        <li>
          <span className="font-semibold text-gray-900">A capability is switched on inside the practice that bought it.</span>{" "}
          Activation writes practice_capability_activation per workspace, with the actor, the source and
          a reason, into that practice&apos;s own event log. That is the practice&apos;s switch, not the
          landlord&apos;s, and no path here sets it for anybody.
        </li>
      </ul>
    </Panel>
  );
}
