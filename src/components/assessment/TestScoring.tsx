"use client";
// <TestScoring>: try the rules before anyone relies on them. Start from a preset (blank, all met, one critical item not
// met, all not applicable) or answer by hand, say what you expect, run it with runTests(), and save the case. Saved
// cases are re-run every time and again at submit and publish.
import { useMemo, useState } from "react";
import {
  fieldSpec, rkey, runTests, validateResponse, presetAllNA, presetAllSatisfactory, presetBlank, presetOneCriticalFailed, PRIMARY, OUTCOME_CLASSES,
  type InstrumentDef, type ResponseValue, type Responses, type RulesDoc, type ScoringTestCase, type TestResult,
} from "@/lib/assessment/core";
import { FieldInput } from "./FieldControls";
import { Btn, Chip, classTone, humanize, mutedText, NumIn, SelectIn, TextIn, TONE } from "./ui";

export interface TestScoringProps {
  def: InstrumentDef;
  doc: RulesDoc;
  tests: ScoringTestCase[];
  onTestsChange: (tests: ScoringTestCase[]) => void;
  readOnly?: boolean;
}

const ANY = "";
const PRESETS: { id: string; label: string; make: (def: InstrumentDef) => Responses }[] = [
  { id: "blank", label: "Blank", make: () => presetBlank() },
  { id: "all_satisfactory", label: "All met", make: presetAllSatisfactory },
  { id: "one_critical_failed", label: "One critical item not met", make: (d) => presetOneCriticalFailed(d) },
  { id: "all_na", label: "All not applicable", make: presetAllNA },
];

function summary(t: ScoringTestCase): string {
  const x = t.expect;
  const parts: string[] = [];
  if (x.outcome) parts.push(`outcome ${x.outcome}`);
  if (x.class) parts.push(`class ${x.class}`);
  if (x.gate !== undefined) parts.push(`gate ${x.gate ?? "none"}`);
  if (x.ruleId) parts.push(`rule ${x.ruleId}`);
  return parts.length ? parts.join(", ") : "no expectation";
}

export function TestScoring({ def, doc, tests, onTestsChange, readOnly }: TestScoringProps) {
  const [responses, setResponses] = useState<Responses>({});
  const [evidence, setEvidence] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [expect, setExpect] = useState<ScoringTestCase["expect"]>({});
  const [result, setResult] = useState<TestResult | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);

  const ruleIds = [...doc.rules, ...(doc.groups ?? []).flatMap((g) => g.rules)];
  const all = useMemo(() => runTests(def, doc, tests), [def, doc, tests]);
  const current = (): ScoringTestCase => ({ id: loadedId ?? `case_${tests.length + 1}`, name: name.trim() || `Case ${tests.length + 1}`, responses, evidence: Object.keys(evidence).length ? evidence : undefined, expect });

  const run = () => setResult(runTests(def, doc, [current()]).results[0]);
  const save = () => {
    const c = current();
    const taken = new Set(tests.map((t) => t.id));
    const id = loadedId && taken.has(loadedId) ? loadedId : (() => { let n = tests.length + 1; while (taken.has(`case_${n}`)) n++; return `case_${n}`; })();
    const next = { ...c, id };
    onTestsChange(taken.has(id) ? tests.map((t) => (t.id === id ? next : t)) : [...tests, next]);
    setLoadedId(id);
  };
  const setResp = (key: string, r: ResponseValue | null) => { setResponses((cur) => { const n = { ...cur }; if (r === null) delete n[key]; else n[key] = r; return n; }); setResult(null); };
  const setExp = (patch: Partial<ScoringTestCase["expect"]>) => { setExpect((e) => { const n = { ...e, ...patch }; for (const k of Object.keys(n) as (keyof typeof n)[]) if (n[k] === undefined) delete n[k]; return n; }); setResult(null); };

  return (
    <section aria-label="Test scoring" className="flex flex-col gap-4 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4" data-test-scoring>
      <div>
        <h3 className="text-base font-semibold text-[var(--cmp-app-text)]">Test scoring</h3>
        <p className={`text-xs ${mutedText}`}>Answer the items as a test, say what you expect, and run it. Nothing here is saved to any assessment.</p>
      </div>

      <div role="group" aria-label="Presets" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => <Btn key={p.id} onClick={() => { setResponses(p.make(def)); setResult(null); setLoadedId(null); }}>{p.label}</Btn>)}
      </div>

      <details className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-2">
        <summary className="min-h-9 cursor-pointer text-sm font-semibold text-[var(--cmp-theme-ink)]">Answers ({Object.keys(responses).length} of {def.items.length} items)</summary>
        <div className="mt-2 flex flex-col gap-4">
          {def.items.map((it) => {
            const sp = fieldSpec(it, PRIMARY)!;
            const k = rkey(it.stable_key);
            return (
              <div key={it.stable_key} className="flex flex-col gap-1 border-b border-[var(--cmp-app-border)] pb-3 text-sm">
                <p className="font-semibold">{it.code} {it.prompt}{it.critical ? " (critical)" : ""}</p>
                <FieldInput spec={sp} value={responses[k] ?? null} idBase={`ts-${it.stable_key}`} label={`${it.code} answer`} issues={validateResponse(it, responses[k] ?? null).issues} onChange={(r) => setResp(k, r)} />
                {it.evidence_requirement ? <NumIn label={`${it.code} evidence attached`} value={evidence[it.stable_key] ?? 0} min={0} step={1} onChange={(n) => { setEvidence((e) => ({ ...e, [it.stable_key]: n ?? 0 })); setResult(null); }} /> : null}
                {(it.fields ?? []).map((f) => {
                  const fk = rkey(it.stable_key, f.field_key);
                  const fs = fieldSpec(it, f.field_key)!;
                  return (
                    <div key={f.field_key} className="pl-3">
                      <p className={`text-xs font-semibold ${mutedText}`}>{f.label}</p>
                      <FieldInput spec={fs} value={responses[fk] ?? null} idBase={`ts-${it.stable_key}-${f.field_key}`} label={f.label} issues={validateResponse(it, responses[fk] ?? null, f.field_key).issues} onChange={(r) => setResp(fk, r)} />
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </details>

      <fieldset className="grid gap-3 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold">Expect</legend>
        <SelectIn label="Expected outcome" value={expect.outcome ?? ANY} options={[{ value: ANY, label: "Any" }, ...doc.outcomes.map((o) => ({ value: o.code, label: `${o.label} (${o.code})` }))]} onChange={(v) => setExp({ outcome: v || undefined })} />
        <SelectIn label="Expected class" value={expect.class ?? ANY} options={[{ value: ANY, label: "Any" }, ...OUTCOME_CLASSES.map((c) => ({ value: c, label: humanize(c) }))]} onChange={(v) => setExp({ class: (v || undefined) as ScoringTestCase["expect"]["class"] })} />
        <SelectIn label="Expected gate" value={expect.gate === undefined ? ANY : expect.gate === null ? "none" : expect.gate} options={[{ value: ANY, label: "Any" }, { value: "none", label: "No gate fires" }, { value: "criticalFail", label: "Critical item gate" }, { value: "mandatoryMissing", label: "Required items gate" }]} onChange={(v) => setExp({ gate: v === ANY ? undefined : v === "none" ? null : (v as "criticalFail" | "mandatoryMissing") })} />
        <SelectIn label="Expected deciding rule" value={expect.ruleId ?? ANY} options={[{ value: ANY, label: "Any" }, ...ruleIds.map((r) => ({ value: r.id, label: r.label }))]} onChange={(v) => setExp({ ruleId: v || undefined })} />
        <TextIn label="Case name" value={name} onChange={setName} className="sm:col-span-2" />
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <Btn kind="primary" onClick={run}>Run test</Btn>
        {!readOnly ? <Btn onClick={save}>Save as case</Btn> : null}
      </div>

      <div aria-live="polite" data-test-result>
        {result ? (
          <div className={`rounded-lg border p-3 text-sm ${result.ok ? TONE.success : TONE.error}`}>
            {result.actual ? (
              <>
                <p className="flex flex-wrap items-center gap-2"><span className="font-semibold">Result</span><Chip tone={classTone(result.actual.class)}>{doc.outcomes.find((o) => o.code === result.actual!.outcome)?.label ?? result.actual.outcome}</Chip><span>decided by {result.actual.decided_by.replace("gate:", "gate ").replace("rule:", "rule ")}</span></p>
                {Object.entries(result.actual.aggregates).length ? <p>Aggregates: {Object.entries(result.actual.aggregates).map(([k, val]) => `${k} ${val === null ? "none" : val}`).join(", ")}</p> : null}
                {Object.entries(result.actual.groupOutcomes).length ? <p>Groups: {Object.entries(result.actual.groupOutcomes).map(([k, val]) => `${k} ${val}`).join(", ")}</p> : null}
              </>
            ) : null}
            <p className="font-semibold">{result.ok ? "Matches what you expected." : "Does not match."}</p>
            <ul className="list-disc pl-5">{result.mismatches.map((m, i) => <li key={i}>{m}</li>)}</ul>
          </div>
        ) : null}
      </div>

      <div>
        <h4 className="mb-1 text-sm font-semibold">Saved cases</h4>
        <p className={`text-xs ${mutedText}`} role="status">{tests.length ? `${all.passed} passed, ${all.failed} failed.` : "No saved cases yet."}</p>
        <ul className="mt-1 flex flex-col gap-1">
          {all.results.map((r) => {
            const t = tests.find((x) => x.id === r.id)!;
            return (
              <li key={r.id} data-case={r.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-2 text-sm">
                <Chip tone={r.ok ? "success" : "error"}>{r.ok ? "Pass" : "Fail"}</Chip>
                <span className="font-semibold">{t.name}</span>
                <span className={mutedText}>{summary(t)}</span>
                {!r.ok ? <span className="basis-full text-xs text-[var(--cmp-text-error)]">{r.mismatches.join("; ")}</span> : null}
                <span className="ml-auto flex gap-1">
                  <Btn size="sm" onClick={() => { setResponses(t.responses); setEvidence(t.evidence ?? {}); setExpect(t.expect); setName(t.name); setLoadedId(t.id); setResult(null); }}>Load</Btn>
                  {!readOnly ? <Btn size="sm" kind="danger" aria-label={`Delete case ${t.name}`} onClick={() => onTestsChange(tests.filter((x) => x.id !== t.id))}>Delete</Btn> : null}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
