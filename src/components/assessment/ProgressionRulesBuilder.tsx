"use client";
// <ProgressionRulesBuilder doc stageScale def onChange>: the visual editor for an asmt.progression/1 document.
// Stage rules over many assessments, evidence filters, how repeated and conflicting records combine, and the two
// permits a reviewer will see. Self-reported evidence is NOT offered anywhere: it can never support a stage.
// Validation is validateProgression() on every change, shown at the path it belongs to.
import { useMemo } from "react";
import {
  ATTESTATIONS, OPS, OUTCOME_CLASSES, validateProgression,
  type Attestation, type EvidenceWhere, type InstrumentDef, type Op, type ProgPred, type ProgressionDoc, type StageScale, type ValidationResult,
} from "@/lib/assessment/core";
import { ConditionEditor } from "./ConditionEditor";
import { Btn, Check, Inline, IssueSummary, issuesUnder, NumIn, SelectIn, TextIn, humanize, mutedText, type Opt } from "./ui";
import { removeAt, setAt } from "./rules-helpers";

const OFFERED = ATTESTATIONS.filter((a) => a !== "self_reported");
const OP_LABEL: Record<Op, string> = { "=": "is", "!=": "is not", "<": "is less than", "<=": "is at most", ">": "is more than", ">=": "is at least" };
const opOptions: Opt[] = OPS.map((o) => ({ value: o, label: OP_LABEL[o] }));

const KIND_LABEL: Record<string, string> = {
  count: "Number of assessments where", latest: "The latest assessment", anyCriticalFailure: "A critical failure", distinctAssessors: "Number of different assessors",
};
const kindOf = (p: ProgPred): string => Object.keys(p).find((k) => k in KIND_LABEL) ?? "count";
const newPred = (kind: string): ProgPred => {
  switch (kind) {
    case "latest": return { latest: { field: "outcomeClass", is: "positive" } };
    case "anyCriticalFailure": return { anyCriticalFailure: {} };
    case "distinctAssessors": return { distinctAssessors: {}, op: ">=", value: 2 };
    default: return { count: { where: { outcomeClass: "positive" } }, op: ">=", value: 2 };
  }
};

function WhereEditor({ where, onChange, def, stageScale, methods, label, readOnly }: { where: EvidenceWhere | undefined; onChange: (w: EvidenceWhere) => void; def?: InstrumentDef; stageScale: StageScale; methods: string[]; label: string; readOnly?: boolean }) {
  const w = where ?? {};
  const set = (patch: Partial<EvidenceWhere>) => {
    const n: Record<string, unknown> = { ...w, ...patch };
    for (const k of Object.keys(n)) if (n[k] === undefined) delete n[k];
    onChange(n as EvidenceWhere);
  };
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SelectIn label={`${label}: assessed by`} value={w.attestation ?? ""} disabled={readOnly} options={[{ value: "", label: "Any counted assessment" }, ...OFFERED.map((a) => ({ value: a, label: humanize(a) }))]} onChange={(v) => set({ attestation: (v || undefined) as Attestation | undefined })} />
      {methods.length ? (
        <SelectIn label={`${label}: method`} value={w.method ?? ""} disabled={readOnly} options={[{ value: "", label: "Any method" }, ...methods.map((m) => ({ value: m, label: humanize(m) }))]} onChange={(v) => set({ method: v || undefined })} />
      ) : <TextIn label={`${label}: method`} value={w.method ?? ""} disabled={readOnly} onChange={(v) => set({ method: v || undefined })} />}
      <SelectIn label={`${label}: outcome class`} value={w.outcomeClass ?? ""} disabled={readOnly} options={[{ value: "", label: "Any outcome" }, ...OUTCOME_CLASSES.map((c) => ({ value: c, label: humanize(c) }))]} onChange={(v) => set({ outcomeClass: (v || undefined) as EvidenceWhere["outcomeClass"] })} />
      <div className="grid grid-cols-2 gap-2">
        <SelectIn label={`${label}: lowest level in group`} value={w.minLevelStage?.group ?? ""} disabled={readOnly} options={[{ value: "", label: "Not required" }, ...(def?.groups ?? []).map((g) => ({ value: g.code, label: g.label }))]} onChange={(v) => set({ minLevelStage: v ? { group: v, atLeast: w.minLevelStage?.atLeast ?? stageScale.stages[0]?.code ?? "" } : undefined })} />
        {w.minLevelStage ? (
          <SelectIn label={`${label}: maps to at least`} value={w.minLevelStage.atLeast} disabled={readOnly} options={stageScale.stages.map((s) => ({ value: s.code, label: s.label }))} onChange={(v) => set({ minLevelStage: { group: w.minLevelStage!.group, atLeast: v } })} />
        ) : null}
      </div>
    </div>
  );
}

function ProgPredEditor({ pred, onChange, def, stageScale, methods, path, readOnly }: { pred: ProgPred; onChange: (p: ProgPred) => void; def?: InstrumentDef; stageScale: StageScale; methods: string[]; path: string; readOnly?: boolean }) {
  const kind = kindOf(pred);
  const p = pred as unknown as Record<string, unknown>;
  const lab = `Condition ${path}`;
  return (
    <div className="flex flex-col gap-2">
      <SelectIn label={`${lab}: kind`} value={kind} disabled={readOnly} options={Object.entries(KIND_LABEL).map(([k, l]) => ({ value: k, label: l }))} onChange={(k) => onChange(newPred(k))} />
      {kind === "count" || kind === "distinctAssessors" ? (
        <>
          <WhereEditor label={`${lab}: where`} where={((kind === "count" ? p.count : p.distinctAssessors) as { where?: EvidenceWhere }).where} def={def} stageScale={stageScale} methods={methods} readOnly={readOnly}
            onChange={(w) => onChange(({ ...p, [kind]: { where: w } }) as unknown as ProgPred)} />
          <div className="grid grid-cols-2 gap-2">
            <SelectIn label={`${lab}: compare`} value={String(p.op)} options={opOptions} disabled={readOnly} onChange={(v) => onChange({ ...p, op: v } as unknown as ProgPred)} />
            <NumIn label={`${lab}: number`} value={p.value as number} min={0} disabled={readOnly} onChange={(n) => onChange({ ...p, value: n ?? 0 } as unknown as ProgPred)} />
          </div>
        </>
      ) : null}
      {kind === "latest" ? (() => {
        const l = p.latest as { field: "outcomeClass" | "outcomeCode"; is: string };
        return (
          <div className="grid gap-2 sm:grid-cols-2">
            <SelectIn label={`${lab}: look at`} value={l.field} disabled={readOnly} options={[{ value: "outcomeClass", label: "Outcome class" }, { value: "outcomeCode", label: "Outcome code" }]} onChange={(v) => onChange({ latest: { field: v as "outcomeClass" | "outcomeCode", is: v === "outcomeClass" ? "positive" : "" } })} />
            {l.field === "outcomeClass"
              ? <SelectIn label={`${lab}: is`} value={l.is} disabled={readOnly} options={OUTCOME_CLASSES.map((c) => ({ value: c, label: humanize(c) }))} onChange={(v) => onChange({ latest: { field: l.field, is: v } })} />
              : <TextIn label={`${lab}: is`} value={l.is} disabled={readOnly} onChange={(v) => onChange({ latest: { field: l.field, is: v } })} />}
          </div>
        );
      })() : null}
      {kind === "anyCriticalFailure" ? (
        <NumIn label={`${lab}: within days (leave empty for any time)`} value={(p.anyCriticalFailure as { withinDays?: number }).withinDays ?? null} min={1} disabled={readOnly} onChange={(n) => onChange({ anyCriticalFailure: n === null ? {} : { withinDays: n } })} />
      ) : null}
    </div>
  );
}

export interface ProgressionRulesBuilderProps {
  doc: ProgressionDoc;
  stageScale: StageScale;
  /** the instrument the evidence comes from: gives group names for level filters */
  def?: InstrumentDef;
  onChange: (doc: ProgressionDoc) => void;
  readOnly?: boolean;
  validation?: ValidationResult;
}

export function ProgressionRulesBuilder({ doc, stageScale, def, onChange, readOnly, validation }: ProgressionRulesBuilderProps) {
  const v = useMemo(() => validation ?? validateProgression(doc, stageScale, def), [validation, doc, stageScale, def]);
  const methods = useMemo(() => Array.from(new Set([...(def?.method_codes ?? []), ...(def?.items.flatMap((i) => i.method_codes) ?? []), ...(doc.evidence?.methods ?? [])])), [def, doc.evidence?.methods]);
  const stageOpts: Opt[] = stageScale.stages.map((s) => ({ value: s.code, label: s.label }));
  const usedStages = new Set(doc.stageRules.map((r) => r.stage));
  const freeStages = stageScale.stages.filter((s) => !usedStages.has(s.code));
  const att = doc.evidence?.attestation ?? [];
  const hasSelf = att.includes("self_reported");
  const target = "stage" in doc.target ? "stage" : "programme";

  return (
    <div className="flex flex-col gap-4" data-progression-builder>
      <IssueSummary errors={v.errors} warnings={v.warnings} label="Progression validation" />

      <section aria-label="Evidence" className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4">
        <div>
          <h3 className="text-base font-semibold">Evidence that counts</h3>
          <p className={`text-xs ${mutedText}`}>Self-reported assessments are never offered here: they can never support a stage.</p>
        </div>
        <div role="group" aria-label="Counted assessments">
          {OFFERED.map((a) => (
            <Check key={a} label={humanize(a)} checked={att.includes(a)} disabled={readOnly} onChange={(on) => onChange({ ...doc, evidence: { ...doc.evidence, attestation: on ? [...att, a] : att.filter((x) => x !== a) } })} />
          ))}
        </div>
        {hasSelf ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--cmp-text-error)]">
            <span>This document lists self-reported evidence, which is never allowed.</span>
            {!readOnly ? <Btn size="sm" kind="danger" onClick={() => onChange({ ...doc, evidence: { ...doc.evidence, attestation: att.filter((x) => x !== "self_reported") } })}>Remove self-reported</Btn> : null}
          </div>
        ) : null}
        <Inline errors={issuesUnder(v.errors, "evidence")} warnings={issuesUnder(v.warnings, "evidence")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextIn label="Methods that count (comma separated, empty for any)" value={(doc.evidence?.methods ?? []).join(", ")} disabled={readOnly} onChange={(t) => {
            const m = t.split(",").map((x) => x.trim()).filter(Boolean);
            const ev = { ...doc.evidence };
            if (m.length) ev.methods = m; else delete ev.methods;
            onChange({ ...doc, evidence: ev });
          }} />
          <NumIn label="Only assessments from the last (days, empty for any)" value={doc.evidence?.withinDays ?? null} min={1} disabled={readOnly} onChange={(n) => {
            const ev = { ...doc.evidence };
            if (n === null) delete ev.withinDays; else ev.withinDays = n;
            onChange({ ...doc, evidence: ev });
          }} />
        </div>
      </section>

      <section aria-label="Stages and targets" className="grid gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4 sm:grid-cols-2">
        <SelectIn label="When nothing qualifies, show as" value={doc.notStaged} disabled={readOnly} options={[{ value: "unstaged", label: "Not staged" }, ...stageOpts]} onChange={(val) => onChange({ ...doc, notStaged: val })} />
        <SelectIn label="Target" value={target} disabled={readOnly} options={[{ value: "stage", label: "A fixed stage" }, { value: "programme", label: "The stage the programme expects" }]} onChange={(val) => onChange({ ...doc, target: val === "stage" ? { stage: stageScale.stages[0]?.code ?? "" } : { fromProgramme: true } })} />
        {"stage" in doc.target ? <SelectIn label="Target stage" value={doc.target.stage} disabled={readOnly} options={stageOpts} onChange={(val) => onChange({ ...doc, target: { stage: val } })} /> : null}
        <SelectIn label="Several matching assessments" value={doc.repeated} disabled={readOnly} options={[{ value: "latest", label: "Only the latest counts" }, { value: "best", label: "The best counts" }, { value: "all_must_meet", label: "All must meet it" }]} onChange={(val) => onChange({ ...doc, repeated: val as ProgressionDoc["repeated"] })} />
        <SelectIn label="Assessors disagree" value={doc.conflicting} disabled={readOnly} options={[{ value: "latest", label: "Use the latest" }, { value: "lowest", label: "Use the lowest" }]} onChange={(val) => onChange({ ...doc, conflicting: val as ProgressionDoc["conflicting"] })} />
        <div className="sm:col-span-2">
          <Check label="Allow a stage from a single assessment" checked={doc.permitSingleAssessment} disabled={readOnly} hint="Off by default: a stage normally needs more than one assessment. A reviewer will see it when on." onChange={(c) => onChange({ ...doc, permitSingleAssessment: c })} />
          <Check label="Allow averaging ordinal ratings" checked={doc.permitOrdinalMean} disabled={readOnly} hint="Progression never averages ratings itself, so this has no effect. A reviewer will see it when on." onChange={(c) => onChange({ ...doc, permitOrdinalMean: c })} />
        </div>
      </section>

      <section aria-label="Stage rules" className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4">
        <div>
          <h3 className="text-base font-semibold">Stage rules</h3>
          <p className={`text-xs ${mutedText}`}>The highest stage whose rule holds wins. A stage is never conferred from a single score unless an approved rule permits it.</p>
        </div>
        {doc.stageRules.map((r, i) => {
          const p = `stageRules[${i}]`;
          const label = stageScale.stages.find((s) => s.code === r.stage)?.label ?? r.stage;
          return (
            <div key={i} className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3" data-stage-rule={r.stage}>
              <div className="flex flex-wrap items-end justify-between gap-2">
                <SelectIn label={`Stage ${i + 1}`} value={r.stage} disabled={readOnly} options={stageOpts.filter((o) => o.value === r.stage || !usedStages.has(o.value))} onChange={(val) => onChange({ ...doc, stageRules: setAt(doc.stageRules, i, { ...r, stage: val }) })} />
                {!readOnly ? <Btn size="sm" kind="danger" aria-label={`Delete rule for ${label}`} onClick={() => onChange({ ...doc, stageRules: removeAt(doc.stageRules, i) })}>Delete</Btn> : null}
              </div>
              <Inline errors={v.errors.filter((e) => e.path === p || e.path === `${p}.stage`)} warnings={v.warnings.filter((e) => e.path === p)} />
              <ConditionEditor<ProgPred>
                cond={r.when} path={`${p}.when`} validation={v} readOnly={readOnly}
                onChange={(c) => onChange({ ...doc, stageRules: setAt(doc.stageRules, i, { ...r, when: c }) })}
                makeLeaf={() => newPred("count")}
                renderLeaf={(pr, set, lp) => <ProgPredEditor pred={pr} onChange={set} def={def} stageScale={stageScale} methods={methods} path={lp} readOnly={readOnly} />}
              />
              <p className={`text-xs ${mutedText}`}>THEN the person is at <strong>{label}</strong>.</p>
            </div>
          );
        })}
        {!readOnly && freeStages.length ? (
          <div className="flex flex-wrap gap-2">
            {freeStages.map((s) => <Btn key={s.code} onClick={() => onChange({ ...doc, stageRules: [...doc.stageRules, { stage: s.code, when: newPred("count") as never }] })}>Add rule for {s.label}</Btn>)}
          </div>
        ) : null}
        <Inline errors={v.errors.filter((e) => e.path === "stageRules")} warnings={[]} />
      </section>
    </div>
  );
}

