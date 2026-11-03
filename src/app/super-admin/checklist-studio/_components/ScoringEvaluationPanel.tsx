"use client";
// Checklist Studio, Scoring & Evaluation (ASMT-SCORING-INTEGRATION-01 section 8): one place that shows the selected scoring
// profile, the response scale or options with their values, the formula, N/A handling, critical and mandatory items, the
// threshold configuration, a result preview and the validation status. It applies a profile through the scoring route; it
// decides nothing itself.
import { useMemo } from "react";
import { Btn, Chip } from "@/components/assessment/ui";
import { evaluate, presetAllSatisfactory, runTests, type InstrumentDef, type RulesDoc, type ScoringTestCase } from "@/lib/assessment/core";
import { PROFILE_LIST, summarizeResult, type ProfileId } from "@/lib/assessment/import/profiles";
import type { ValidationResult } from "@/lib/assessment/core";
import { Notice, Panel } from "./studio-ui";

export function ScoringEvaluationPanel({ def, doc, tests, live, editable, busy, onApply }: {
  def: InstrumentDef; doc: RulesDoc | null; tests: ScoringTestCase[]; live: ValidationResult | undefined; editable: boolean; busy: boolean;
  onApply: (profileId: ProfileId) => void;
}) {
  const rating = def.items.find((it) => it.response_type === "rating_scale")?.scale ?? null;
  const options = def.items.find((it) => it.response_type === "multiple_choice")?.config.options ?? null;
  const naReason = def.items.filter((it) => it.config.naReasonRequired).length;
  const naAllowed = def.items.filter((it) => (it.config.allowedStates ?? []).includes("not_applicable")).length;
  const mandatory = def.items.filter((it) => it.mandatory).length;
  const critical = def.items.filter((it) => it.critical).length;
  const thresholds = doc ? doc.rules.filter((r) => "aggregate" in r.when) : [];
  const preview = useMemo(() => {
    if (!doc || !def.items.length) return null;
    try {
      const responses = presetAllSatisfactory(def);
      const ev = evaluate(def, doc, responses);
      return { ev, summary: summarizeResult(def, doc, ev, responses), tests: tests.length ? runTests(def, doc, tests) : null };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  }, [def, doc, tests]);
  const fieldKeys = [...new Set(def.items.flatMap((it) => (it.fields ?? []).map((f) => f.label)))];

  return (
    <Panel title="Scoring & Evaluation">
      <dl className="grid gap-x-6 gap-y-2 text-sm md:grid-cols-2">
        <Row label="Selected scoring profile">{doc?.profile ? <span><b>{doc.profile.label}</b> <Chip>v{doc.profile.version}</Chip>{doc.profile.notes ? <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{doc.profile.notes}</span> : null}</span> : <span className="text-[var(--cmp-app-text-secondary)]">None applied{doc ? " (rules written by hand)" : ""}</span>}</Row>
        <Row label="Response scale / options">
          {rating ? <span>{rating.levels.length} grades: {[...rating.levels].sort((a, b) => a.ordinal - b.ordinal).map((l) => `${l.code} ${l.label}${l.numeric_value !== null && l.numeric_value !== undefined ? ` (${l.numeric_value})` : ""}`).join(", ")}</span>
            : options ? <span>{options.map((o) => `${o.label} = ${o.credit === null || o.credit === undefined ? "no value" : o.credit * 2}${o.satisfactory === true ? " (met)" : o.satisfactory === false ? "" : " (no meaning)"}`).join(", ")}</span>
            : <span className="text-[var(--cmp-app-text-secondary)]">No rating or option items</span>}
        </Row>
        <Row label="Scoring formula">{doc?.profile?.formula ?? (doc ? `${doc.aggregates?.length ?? 0} aggregate(s) defined in the rules below.` : "No rules yet.")}</Row>
        <Row label="N/A handling">{naAllowed} of {def.items.length} items allow N/A, {naReason} require a reason. {doc?.defaults?.na === "exclude" || !doc?.defaults?.na ? "N/A is excluded from every count and never counted as zero." : "N/A is counted as not met."}</Row>
        <Row label="Critical items">{critical} {doc?.gates?.criticalFail ? `(a critical failure decides ${doc.gates.criticalFail})` : critical ? "(no critical gate in the rules)" : ""}</Row>
        <Row label="Mandatory items">{mandatory} of {def.items.length} {doc?.gates?.mandatoryMissing ? `(unanswered decides ${doc.gates.mandatoryMissing})` : ""}</Row>
        <Row label="Evidence fields">{fieldKeys.length ? fieldKeys.join(", ") : "None"}</Row>
        <Row label="Threshold configuration">
          {thresholds.length ? <ul className="list-disc pl-4">{thresholds.map((r) => <li key={r.id}>{r.label}: {JSON.stringify(r.when)} gives {r.then.outcome}{r.id.startsWith("proposed_") ? " (proposed)" : ""}</li>)}</ul>
            : <span>No pass or decision threshold is configured: the interpretation is <b>Not configured</b> and the calculated result stands on its own. Add a threshold rule only where the approved standard names one.</span>}
        </Row>
        <Row label="Validation status">{!doc ? <Chip tone="warning">No rules</Chip> : live && live.errors.length ? <Chip tone="error">{live.errors.length} problem(s)</Chip> : <Chip tone="success">Rules valid</Chip>}{live?.warnings.length ? <span className="ml-2 text-xs text-[var(--cmp-app-text-secondary)]">{live.warnings.length} warning(s)</span> : null}</Row>
      </dl>
      {preview && "error" in preview && <Notice tone="warning">The preview could not be evaluated: {preview.error}</Notice>}
      {preview && "ev" in preview && (
        <div className="mt-3 rounded-lg border border-[var(--cmp-app-border)] p-3 text-sm">
          <p className="font-semibold">Result preview (every item answered with its met value)</p>
          {preview.summary ? (
            <>
              <ul className="mt-1 grid gap-1 md:grid-cols-2">{preview.summary.calculated.map((l) => <li key={l.label}><span className="text-[var(--cmp-app-text-secondary)]">{l.label}:</span> <b>{l.value}</b>{l.note ? <span className="block text-xs text-[var(--cmp-app-text-secondary)]">{l.note}</span> : null}</li>)}</ul>
              <p className="mt-1">Interpretation: <Chip tone={preview.summary.interpretation.configured ? "info" : "neutral"}>{preview.summary.interpretation.label}</Chip> <span className="text-xs text-[var(--cmp-app-text-secondary)]">{preview.summary.interpretation.note}</span></p>
            </>
          ) : (
            <p className="mt-1">Outcome <Chip>{preview.ev.outcome.label}</Chip> · aggregates {Object.entries(preview.ev.aggregates).map(([k, v]) => `${k} = ${v ?? "null"}`).join(", ") || "none"}</p>
          )}
          {preview.tests && <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">Saved tests: {preview.tests.passed} pass, {preview.tests.failed} fail.</p>}
        </div>
      )}
      <div className="mt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-[var(--cmp-app-text-secondary)]">Apply a scoring profile</p>
        <p className="text-xs text-[var(--cmp-app-text-secondary)]">A profile writes its configuration into this draft (option values, N/A with a reason, mandatory, evidence fields, rules and tests), all editable here afterwards. Marked proposed until you accept it; the interpretation stays Not configured until a threshold or decision is approved.</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-3">
          {PROFILE_LIST.map((p) => {
            const unfit = p.unfit(def);
            return (
              <li key={p.id} className="rounded-lg border border-[var(--cmp-app-border)] p-3">
                <p className="text-sm font-semibold">{p.label}{doc?.profile?.id === p.id ? <Chip tone="info">applied</Chip> : null}</p>
                <p className="mt-1 text-xs text-[var(--cmp-app-text-secondary)]">{p.summary}</p>
                {unfit && <p className="mt-1 text-xs text-[var(--cmp-text-warning)]">{unfit}</p>}
                <Btn size="sm" className="mt-2" disabled={!editable || !!unfit || busy} onClick={() => { if (!doc || window.confirm(`Apply ${p.label}? The current rules are replaced and the content settings above are written.`)) onApply(p.id); }}>Apply this profile</Btn>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><dt className="text-xs font-semibold uppercase tracking-wide text-[var(--cmp-app-text-secondary)]">{label}</dt><dd className="mt-0.5">{children}</dd></div>;
}
