"use client";
// <AssessmentReport>: the finished result. Outcome and WHICH RULE decided it, a readable trace, critical findings,
// findings counts (per answer, with the denominator and every exclusion), group and item results, strengths and gaps
// (passed in), evidence references. Print-friendly: layout.print decides what shows on paper.
import { useMemo } from "react";
import {
  evalField, evaluate, explain, orderedItems, orderedSections, resolveView, fieldSpec, PRIMARY,
  type Evaluation, type InstrumentDef, type ItemStatus, type LayoutDoc, type Responses, type RulesDoc, type ScopeCounts, type TraceStep,
} from "@/lib/assessment/core";
import { answerCodeLabels, describeResponse } from "./describe";
import { summarizeResult } from "@/lib/assessment/import/profiles";
import { Btn, Chip, classTone, humanize, mutedText, type Tone } from "./ui";

export interface ReportListEntry { text: string; itemKey?: string }
export interface EvidenceRef { label: string; itemKey?: string; kind?: string; href?: string; added?: string }

export interface AssessmentReportProps {
  def: InstrumentDef;
  rules: RulesDoc;
  responses: Responses;
  /** an evaluation recorded at submit; if absent the report evaluates the responses now */
  evaluation?: Evaluation | null;
  evidenceCounts?: Record<string, number>;
  /** for example "Self-reported" or "Assessor-evaluated": always shown beside the outcome */
  attestationLabel: string;
  /** extra banner content, for example "Not formally verified" */
  banner?: React.ReactNode;
  layout?: LayoutDoc | null;
  title?: string;
  subtitle?: string;
  metadata?: { label: string; value: string | null }[];
  strengths?: (string | ReportListEntry)[];
  gaps?: (string | ReportListEntry)[];
  evidenceRefs?: EvidenceRef[];
  comments?: Record<string, string>;
  /** shown on paper in place of the screen date */
  generatedAt?: string;
  showPrintButton?: boolean;
  className?: string;
}

const STATUS: Record<ItemStatus, { text: string; tone: Tone }> = {
  satisfactory: { text: "Met", tone: "success" },
  unsatisfactory: { text: "Not met", tone: "error" },
  neutral: { text: "Recorded", tone: "neutral" },
  excluded: { text: "Excluded", tone: "neutral" },
  missing: { text: "Not answered", tone: "warning" },
};

const entry = (e: string | ReportListEntry): ReportListEntry => (typeof e === "string" ? { text: e } : e);

function Card({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-label={title} className={`rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 break-inside-avoid ${className}`}>
      <h3 className="mb-2 text-base font-semibold text-[var(--cmp-app-text)]">{title}</h3>
      {children}
    </section>
  );
}

function CountsTable({ rows, labels }: { rows: { name: string; c: ScopeCounts }[]; labels: Record<string, string> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[34rem] border-collapse text-sm">
        <thead>
          <tr className={`text-left text-xs ${mutedText}`}>
            <th className="py-1 pr-3 font-semibold">Scope</th><th className="px-2 font-semibold">Items</th><th className="px-2 font-semibold">Answered</th>
            <th className="px-2 font-semibold">Met</th><th className="px-2 font-semibold">Not met</th><th className="px-2 font-semibold">Excluded</th>
            <th className="px-2 font-semibold">Denominator</th><th className="px-2 font-semibold">By answer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ name, c }) => (
            <tr key={name} className="border-t border-[var(--cmp-app-border)] align-top">
              <th scope="row" className="py-1.5 pr-3 text-left font-semibold">{name}</th>
              <td className="px-2">{c.items}</td><td className="px-2">{c.answered}</td><td className="px-2">{c.satisfactory}</td>
              <td className="px-2">{c.unsatisfactory}</td><td className="px-2">{c.excluded}</td>
              <td className="px-2" title="Met plus not met: the items a percentage would be computed over">{c.denominator}</td>
              <td className="px-2">
                <ul className="flex flex-wrap gap-1">
                  {Object.entries(c.byAnswer).map(([code, n]) => <li key={code}><Chip>{labels[code] ?? humanize(code.replace("state:", ""))}: {n}</Chip></li>)}
                  {Object.keys(c.byAnswer).length === 0 ? <li className={mutedText}>None</li> : null}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function traceLines(ev: Evaluation, rules: RulesDoc): { key: string; text: string; tone?: Tone }[] {
  const ruleLabel = (id: string) => [...rules.rules, ...(rules.groups ?? []).flatMap((g) => g.rules)].find((r) => r.id === id)?.label ?? id;
  const out: { key: string; text: string; tone?: Tone }[] = [];
  ev.trace.forEach((t: TraceStep, i) => {
    const key = `t${i}`;
    switch (t.kind) {
      case "gate":
        out.push({ key, text: `${t.gate === "criticalFail" ? "Critical items" : "Required items"}: ${t.triggered ? `triggered (${t.items.map((x) => x.code).join(", ")})` : "no problem found"}.`, tone: t.triggered ? "error" : "success" });
        break;
      case "aggregate":
        out.push({ key, text: `${t.id}: ${t.value === null ? "no value" : t.value} (${t.included.length} counted, ${t.excluded.length} left out).` });
        break;
      case "rule":
        out.push({ key, text: `${t.scope === "overall" ? "Rule" : `Rule in ${t.scope.replace("group:", "group ")}`} "${ruleLabel(t.id)}" (priority ${t.priority}): ${t.matched ? "matched" : "did not match"}.`, tone: t.matched ? "success" : undefined });
        break;
      case "fallback": out.push({ key, text: `No rule matched in ${t.scope.replace("group:", "group ")}, so the fallback applies.` }); break;
      case "skipped": out.push({ key, text: `Rules skipped: ${t.why}.` }); break;
      case "decision": out.push({ key, text: `Decided by ${t.by.replace("gate:", "gate ").replace("rule:", "rule ")}.` }); break;
    }
  });
  return out;
}

export function AssessmentReport(props: AssessmentReportProps) {
  const { def, rules, responses, layout } = props;
  const ev = useMemo(() => props.evaluation ?? evaluate(def, rules, responses, { evidenceCounts: props.evidenceCounts }), [props.evaluation, def, rules, responses, props.evidenceCounts]);
  const view = useMemo(() => resolveView(def, layout, responses, ev, { evidenceCounts: props.evidenceCounts, defaults: rules.defaults }), [def, layout, responses, ev, props.evidenceCounts, rules.defaults]);
  const pr = view.print;
  const labels = useMemo(() => answerCodeLabels(def.items), [def.items]);
  const lines = explain(rules, ev);
  const deciding = ev.decided_by.startsWith("rule:") ? [...rules.rules, ...(rules.groups ?? []).flatMap((g) => g.rules)].find((r) => `rule:${r.id}` === ev.decided_by) : null;
  const decidedWords = ev.decided_by === "gate:criticalFail" ? "Critical item gate" : ev.decided_by === "gate:mandatoryMissing" ? "Required items gate" : ev.decided_by === "fallback" ? "Fallback (no rule matched)" : deciding ? `Rule "${deciding.label}" (priority ${deciding.priority})` : ev.decided_by;

  const items = orderedItems(def);
  const sections = orderedSections(def);
  const critical = items.filter((i) => i.critical).map((i) => {
    const e = evalField(i, PRIMARY, responses, rules.defaults);
    const failed = ev.gates.criticalFail.items.find((x) => x.key === i.stable_key);
    return { item: i, e, failed, text: failed ? failed.why : !e.answered ? "Not answered" : "Met" };
  });
  const criticalFindings = critical.filter((c) => c.failed || !c.e.answered);

  // ASMT-SCORING-INTEGRATION-01: the instrument-specific summary the scoring profile promises. Raw responses, the calculated
  // result and the governed interpretation stay distinct; the three instruments are never rolled into one score.
  const profileSummary = summarizeResult(def, rules, ev, responses);
  const strengths = (props.strengths ?? []).map(entry);
  const gaps = (props.gaps ?? []).map(entry);
  const rows = [
    { name: "All items", c: ev.counts.overall },
    ...sections.map((s) => ({ name: s.title, c: ev.counts.sections[s.stable_key] })),
    ...def.groups.map((g) => ({ name: `Group: ${g.label}`, c: ev.counts.groups[g.code] })),
  ].filter((r) => r.c);
  const exclusions = ev.counts.overall.exclusions;
  const comment = (k: string) => props.comments?.[k];

  return (
    <article data-orientation={pr.orientation} className={`flex flex-col gap-4 text-[var(--cmp-app-text)] ${props.className ?? ""}`}>
      <style>{`@media print { @page { size: ${pr.orientation}; } }`}</style>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{props.title ?? def.instrument_code ?? "Assessment report"}</h2>
          {props.subtitle ? <p className={`text-sm ${mutedText}`}>{props.subtitle}</p> : null}
          {props.generatedAt ? <p className={`text-xs ${mutedText}`}>{props.generatedAt}</p> : null}
        </div>
        {props.showPrintButton ? <Btn className="print:hidden" onClick={() => window.print()}>Print</Btn> : null}
      </header>

      <div role="note" data-attestation className="rounded-lg border border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] px-4 py-3 text-sm text-[var(--cmp-theme-ink)]">
        <p className="font-semibold">{props.attestationLabel}</p>
        {props.banner ? <div>{props.banner}</div> : null}
      </div>

      {props.metadata?.length ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          {props.metadata.map((m) => <div key={m.label}><dt className={`text-xs font-semibold ${mutedText}`}>{m.label}</dt><dd>{m.value ?? "Not set"}</dd></div>)}
        </dl>
      ) : null}

      <Card title="Outcome">
        <div className="flex flex-wrap items-center gap-2" data-outcome>
          <Chip tone={classTone(ev.class)}>{ev.outcome.label}</Chip>
          <span className={`text-sm ${mutedText}`}>{props.attestationLabel}</span>
        </div>
        <p className="mt-2 text-sm" data-decided-by><span className="font-semibold">Decided by:</span> {decidedWords}</p>
        {lines.map((l, i) => <p key={i} className="text-sm">{l}</p>)}
        {deciding?.explain ? <p className={`text-sm ${mutedText}`}>{deciding.explain}</p> : null}
        <details className="mt-2 text-sm print:hidden">
          <summary className="cursor-pointer font-semibold text-[var(--cmp-theme-ink)]">How this outcome was decided</summary>
          <ol className="mt-2 list-decimal space-y-0.5 pl-5">
            {traceLines(ev, rules).map((t) => <li key={t.key} className={t.tone === "error" ? "text-[var(--cmp-text-error)]" : ""}>{t.text}</li>)}
          </ol>
          <p className={`mt-2 text-xs ${mutedText}`}>Engine {ev.engine_version}. Trace {ev.traceHash.slice(0, 12)}. The same answers always give the same trace.</p>
        </details>
      </Card>

      {Object.keys(ev.groupOutcomes).length ? (
        <Card title="Group results">
          <ul className="flex flex-col gap-1 text-sm">
            {def.groups.filter((g) => ev.groupOutcomes[g.code]).map((g) => (
              <li key={g.code} className="flex flex-wrap items-center gap-2"><span className="font-semibold">{g.label}</span><Chip tone={classTone(ev.groupOutcomes[g.code].class)}>{ev.groupOutcomes[g.code].label}</Chip></li>
            ))}
          </ul>
        </Card>
      ) : null}

      {critical.length ? (
        <Card title="Critical findings">
          {criticalFindings.length === 0 ? <p className="text-sm">Every critical item was met.</p> : (
            <ul className="flex flex-col gap-1.5 text-sm" data-critical-findings>
              {criticalFindings.map((c) => (
                <li key={c.item.stable_key} className="border-l-4 border-l-[var(--cmp-color-critical)] pl-3">
                  <span className="font-semibold">{c.item.code}</span> {c.item.prompt}
                  <span className="block text-[var(--cmp-text-critical)]">{c.text}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {profileSummary && (
        <Card title={`Result summary: ${profileSummary.title}`}>
          <dl className="grid gap-x-6 gap-y-1 text-sm md:grid-cols-2" data-profile-summary>
            {profileSummary.calculated.map((l) => <div key={l.label}><dt className={`text-xs ${mutedText}`}>{l.label}</dt><dd><b>{l.value}</b>{l.note ? <span className={`block text-xs ${mutedText}`}>{l.note}</span> : null}</dd></div>)}
          </dl>
          <p className="mt-2 text-sm">Governed interpretation: <Chip tone={profileSummary.interpretation.configured ? classTone(ev.class) : "neutral"}>{profileSummary.interpretation.label}</Chip> <span className={`text-xs ${mutedText}`}>{profileSummary.interpretation.note}</span></p>
          {profileSummary.attention.filter((a) => a.items.length).map((a) => (
            <div key={a.label} className="mt-2"><p className="text-xs font-semibold uppercase tracking-wide">{a.label} ({a.items.length})</p>
              <ul className="list-disc pl-5 text-sm">{a.items.map((x) => <li key={x.key}><span className="font-semibold">{x.code}</span>{x.detail ? ` ${x.detail}` : ""}</li>)}</ul></div>
          ))}
        </Card>
      )}
      <Card title="Findings counts">
        <CountsTable rows={rows} labels={labels} />
        <p className={`mt-2 text-xs ${mutedText}`}>The denominator is the items met plus the items not met. Items left out of it are listed below with the reason.</p>
        {exclusions.length ? (
          <ul className="mt-1 list-disc pl-5 text-sm" data-exclusions>
            {exclusions.map((x) => <li key={x.key}><span className="font-semibold">{x.code}</span> {x.why}</li>)}
          </ul>
        ) : <p className="mt-1 text-sm">No items were excluded.</p>}
      </Card>

      <Card title="Item results" className={pr.responses ? "" : "print:hidden"}>
        {view.blocks.map((b, bi) => (
          <section key={b.key} className="mb-3" style={pr.pageBreak === "section" && bi > 0 ? { breakBefore: "page" } : undefined}>
            <h4 className="mb-1 text-sm font-semibold">{b.title}{b.subtitle ? ` (${b.subtitle})` : ""}</h4>
            <ul className="divide-y divide-[var(--cmp-app-border)]">
              {b.items.map((vi) => {
                const item = def.items.find((i) => i.stable_key === vi.key)!;
                const sp = fieldSpec(item, PRIMARY)!;
                const e = evalField(item, PRIMARY, responses, rules.defaults);
                const st = STATUS[e.status];
                return (
                  <li key={vi.key} data-result-item={vi.key} className="flex flex-col gap-1 py-2 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{item.code}</span>
                      {item.critical ? <Chip tone="critical">Critical</Chip> : null}
                      <Chip tone={st.tone}>{st.text}</Chip>
                    </div>
                    <p>{item.prompt}</p>
                    <p><span className={mutedText}>Answer:</span> {describeResponse(sp, vi.response) ?? "Not answered"}</p>
                    {vi.fields.map((f) => <p key={f.field_key}><span className={mutedText}>{f.label}:</span> {describeResponse(fieldSpec(item, f.field_key)!, f.response) ?? "Not answered"}</p>)}
                    {comment(vi.key) ? <p className={mutedText}>Comment: {comment(vi.key)}</p> : null}
                    {pr.guidance && item.guidance ? <p className={`text-xs ${mutedText}`}>{item.guidance}</p> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </Card>

      {strengths.length || gaps.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card title="Strengths">
            {strengths.length ? <ul className="list-disc pl-5 text-sm">{strengths.map((s, i) => <li key={i}>{s.text}</li>)}</ul> : <p className="text-sm">None recorded.</p>}
          </Card>
          <Card title="Gaps">
            {gaps.length ? <ul className="list-disc pl-5 text-sm">{gaps.map((s, i) => <li key={i}>{s.text}</li>)}</ul> : <p className="text-sm">None recorded.</p>}
          </Card>
        </div>
      ) : null}

      <Card title="Evidence" className={pr.evidenceList ? "" : "print:hidden"}>
        {props.evidenceRefs?.length ? (
          <ul className="flex flex-col gap-1 text-sm">
            {props.evidenceRefs.map((r, i) => (
              <li key={i}>{r.href ? <a className="text-[var(--cmp-theme-ink)] underline" href={r.href}>{r.label}</a> : r.label}{r.kind ? <span className={mutedText}> ({humanize(r.kind)})</span> : null}{r.added ? <span className={mutedText}>, {r.added}</span> : null}</li>
            ))}
          </ul>
        ) : <p className="text-sm">No evidence attached.</p>}
      </Card>

      {pr.signature ? (
        <div className="hidden grid-cols-2 gap-8 pt-8 text-sm print:grid" data-print-signature>
          <div className="border-t border-[var(--cmp-app-text)] pt-1">Signature</div>
          <div className="border-t border-[var(--cmp-app-text)] pt-1">Date</div>
        </div>
      ) : null}
    </article>
  );
}
