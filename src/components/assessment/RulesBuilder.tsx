"use client";
// <RulesBuilder def doc onChange>: the visual scoring-rules editor. It reads and writes an asmt.rules/1 document
// exactly as rules-ast.ts defines it: outcomes, built-in gates, defaults, aggregates, group rule blocks and overall
// rule blocks (priority, IF / AND / OR / NOT, THEN outcome), and a fallback. Validation is validateRules() on every
// change, shown at the path it belongs to. The builder never writes a key the grammar does not have.
import { useMemo } from "react";
import {
  AGG_FNS, OPS, OUTCOME_CLASSES, PRIMARY, fieldSpec, selectItems, validateRules,
  type AggFn, type AggregateDef, type InstrumentDef, type Op, type Pred, type Rule, type RulesDoc, type Selector, type Test, type ValidationResult,
} from "@/lib/assessment/core";
import type { ScoringTestCase } from "@/lib/assessment/core";
import { ConditionEditor } from "./ConditionEditor";
import { TestScoring } from "./TestScoring";
import { Btn, Check, Chip, classTone, Inline, IssueSummary, issuesUnder, NumIn, SelectIn, TextIn, humanize, mutedText, type Opt } from "./ui";
import {
  AGG_LABEL, aggApplicable, defaultTest, levelChoices, newOutcome, newPred, newRule, removeAt, renameOutcome, setAt, specsFor,
  stateChoices, TEST_LABEL, testKind, validTestKinds, without, type TestKind,
} from "./rules-helpers";

const OP_LABEL: Record<Op, string> = { "=": "is", "!=": "is not", "<": "is less than", "<=": "is at most", ">": "is more than", ">=": "is at least" };
const opOptions: Opt[] = OPS.map((o) => ({ value: o, label: OP_LABEL[o] }));

// ── selector ─────────────────────────────────────────────────────────────────────────────────────────────────
export function SelectorEditor({ sel, onChange, def, label, allowAll, readOnly }: { sel: Selector | true; onChange: (s: Selector | true) => void; def: InstrumentDef; label: string; allowAll?: boolean; readOnly?: boolean }) {
  const isAll = sel === true;
  const s: Selector = sel === true ? { scope: "all" } : sel;
  const set = (n: Selector) => {
    const out: Selector = { scope: n.scope };
    if (n.scope !== "all" && n.keys) out.keys = n.keys;
    if (n.critical !== undefined) out.critical = n.critical;
    if (n.mandatory !== undefined) out.mandatory = n.mandatory;
    if (n.methods?.length) out.methods = n.methods;
    onChange(out);
  };
  const choices = s.scope === "section" ? def.sections.map((x) => ({ value: x.stable_key, label: x.title }))
    : s.scope === "group" ? def.groups.map((x) => ({ value: x.code, label: x.label }))
    : s.scope === "items" ? def.items.map((x) => ({ value: x.stable_key, label: `${x.code} ${x.prompt}` })) : [];
  const methods = Array.from(new Set(def.items.flatMap((i) => i.method_codes)));
  const tri = (v: boolean | undefined) => (v === undefined ? "any" : v ? "yes" : "no");
  const fromTri = (v: string) => (v === "any" ? undefined : v === "yes");
  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border border-[var(--cmp-app-border)] p-2" aria-label={label}>
      {allowAll ? (
        <Check label="Any item" checked={isAll} disabled={readOnly} onChange={(c) => onChange(c ? true : { scope: "all" })} />
      ) : null}
      {!isAll ? (
        <>
          <div className="grid gap-2 sm:grid-cols-3">
            <SelectIn
              label={`${label}: which items`} value={s.scope} disabled={readOnly}
              options={[{ value: "all", label: "All items" }, { value: "section", label: "Items in sections" }, ...(def.groups.length ? [{ value: "group", label: "Items in groups" }] : []), { value: "items", label: "Specific items" }]}
              onChange={(v) => set({ ...s, scope: v as Selector["scope"], keys: v === "all" ? undefined : v === "section" ? [def.sections[0]?.stable_key].filter(Boolean) as string[] : v === "group" ? [def.groups[0]?.code].filter(Boolean) as string[] : [def.items[0]?.stable_key].filter(Boolean) as string[] })}
            />
            <SelectIn label={`${label}: critical`} value={tri(s.critical)} disabled={readOnly} options={[{ value: "any", label: "Critical or not" }, { value: "yes", label: "Only critical" }, { value: "no", label: "Only not critical" }]} onChange={(v) => set({ ...s, critical: fromTri(v) })} />
            <SelectIn label={`${label}: required`} value={tri(s.mandatory)} disabled={readOnly} options={[{ value: "any", label: "Required or not" }, { value: "yes", label: "Only required" }, { value: "no", label: "Only optional" }]} onChange={(v) => set({ ...s, mandatory: fromTri(v) })} />
          </div>
          {choices.length ? (
            <div role="group" aria-label={`${label}: choose`} className="max-h-44 overflow-y-auto rounded border border-[var(--cmp-app-border)] p-1">
              {choices.map((c) => (
                <Check key={c.value} label={c.label} disabled={readOnly} checked={(s.keys ?? []).includes(c.value)} onChange={(on) => set({ ...s, keys: on ? [...(s.keys ?? []), c.value] : (s.keys ?? []).filter((k) => k !== c.value) })} />
              ))}
            </div>
          ) : null}
          {methods.length ? (
            <div role="group" aria-label={`${label}: methods`} className="flex flex-wrap gap-x-4">
              {methods.map((m) => <Check key={m} label={humanize(m)} disabled={readOnly} checked={(s.methods ?? []).includes(m)} onChange={(on) => set({ ...s, methods: on ? [...(s.methods ?? []), m] : (s.methods ?? []).filter((x) => x !== m) })} />)}
            </div>
          ) : null}
        </>
      ) : null}
    </fieldset>
  );
}

// ── test ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function TestEditor({ test, onChange, specs, isPrimary, label, readOnly }: { test: Test; onChange: (t: Test) => void; specs: ReturnType<typeof specsFor>; isPrimary: boolean; label: string; readOnly?: boolean }) {
  const valid = validTestKinds(specs, isPrimary);
  const cur = testKind(test);
  const kinds: Opt[] = [...(cur && !valid.includes(cur) ? [{ value: cur, label: `${TEST_LABEL[cur]} (not valid here)` }] : []), ...valid.map((k) => ({ value: k, label: TEST_LABEL[k] }))];
  const levels = levelChoices(specs);
  const states = stateChoices(specs);
  const t = test as Record<string, unknown>;
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <SelectIn label={`${label}: the answer`} value={cur ?? ""} options={kinds} disabled={readOnly} onChange={(k) => onChange(defaultTest(k as TestKind, specs))} />
      {cur === "state" ? (
        <SelectIn label={`${label}: answer type`} value={String(t.state)} disabled={readOnly} options={[...(states.some((s) => s.state === t.state) ? [] : [{ value: String(t.state), label: humanize(String(t.state)) }]), ...states.map((s) => ({ value: s.state, label: s.label }))]} onChange={(v) => onChange({ state: v as never })} />
      ) : null}
      {cur === "satisfactory" ? (
        <SelectIn label={`${label}: result`} value={t.satisfactory ? "true" : "false"} disabled={readOnly} options={[{ value: "true", label: "Met" }, { value: "false", label: "Not met" }]} onChange={(v) => onChange({ satisfactory: v === "true" })} />
      ) : null}
      {cur === "answered" ? (
        <SelectIn label={`${label}: answered`} value={t.answered ? "true" : "false"} disabled={readOnly} options={[{ value: "true", label: "Answered" }, { value: "false", label: "Not answered" }]} onChange={(v) => onChange({ answered: v === "true" })} />
      ) : null}
      {cur === "levelAtLeast" || cur === "levelAtMost" ? (
        levels.length ? (
          <SelectIn
            label={`${label}: level`} value={String(t[cur])} disabled={readOnly}
            options={[...(levels.some((l) => l.ordinal === t[cur]) ? [] : [{ value: String(t[cur]), label: String(t[cur]) }]), ...levels.map((l) => ({ value: String(l.ordinal), label: `${l.ordinal} - ${l.label}` }))]}
            onChange={(v) => onChange({ [cur]: Number(v) } as Test)}
          />
        ) : <NumIn label={`${label}: level`} value={Number(t[cur])} disabled={readOnly} onChange={(n) => onChange({ [cur]: n ?? 0 } as Test)} />
      ) : null}
      {cur === "value" ? (
        <div className="grid grid-cols-2 gap-2">
          <SelectIn label={`${label}: compare`} value={(t.value as { op: Op }).op} disabled={readOnly} options={opOptions} onChange={(v) => onChange({ value: { ...(t.value as { op: Op; n: number }), op: v as Op } })} />
          <NumIn label={`${label}: number`} value={(t.value as { n: number }).n} disabled={readOnly} onChange={(n) => onChange({ value: { ...(t.value as { op: Op; n: number }), n: n ?? 0 } })} />
        </div>
      ) : null}
    </div>
  );
}

// ── predicate ────────────────────────────────────────────────────────────────────────────────────────────────
const PRED_KIND_LABEL: Record<string, string> = {
  count: "Number of items where", aggregate: "An aggregate value", item: "One item", criticalFailed: "A critical item is not met",
  mandatoryMissing: "A required item is unanswered", evidenceMissing: "Evidence is missing", groupOutcome: "A group outcome",
};
const predKind = (p: Pred): string => Object.keys(p).find((k) => k in PRED_KIND_LABEL) ?? "count";

function PredEditor({ pred, onChange, def, doc, inGroup, readOnly, path }: { pred: Pred; onChange: (p: Pred) => void; def: InstrumentDef; doc: RulesDoc; inGroup: boolean; readOnly?: boolean; path: string }) {
  const kind = predKind(pred);
  const kinds = Object.keys(PRED_KIND_LABEL).filter((k) => k === kind || (k === "aggregate" ? !!doc.aggregates?.length : k === "groupOutcome" ? !inGroup && def.groups.length > 0 : true));
  const lab = `Condition ${path}`;
  const p = pred as unknown as Record<string, unknown>;
  const outcomeOpts: Opt[] = doc.outcomes.map((o) => ({ value: o.code, label: `${o.label} (${o.code})` }));
  return (
    <div className="flex flex-col gap-2">
      <SelectIn label={`${lab}: kind`} value={kind} disabled={readOnly} options={kinds.map((k) => ({ value: k, label: PRED_KIND_LABEL[k] }))} onChange={(k) => onChange(newPred(k, def, doc))} />
      {kind === "count" ? (
        <>
          <SelectorEditor label={`${lab}: items`} sel={p.count as Selector} def={def} readOnly={readOnly} onChange={(s) => onChange({ ...(pred as Extract<Pred, { count: Selector }>), count: s as Selector })} />
          <TestEditor label={`${lab}: where`} test={p.where as Test} specs={specsFor(def, p.count as Selector)} isPrimary readOnly={readOnly} onChange={(t) => onChange({ ...(pred as Extract<Pred, { count: Selector }>), where: t })} />
          <div className="grid grid-cols-2 gap-2">
            <SelectIn label={`${lab}: compare`} value={String(p.op)} options={opOptions} disabled={readOnly} onChange={(v) => onChange({ ...(pred as Extract<Pred, { count: Selector }>), op: v as Op })} />
            <NumIn label={`${lab}: number of items`} value={p.value as number} min={0} disabled={readOnly} onChange={(n) => onChange({ ...(pred as Extract<Pred, { count: Selector }>), value: n ?? 0 })} />
          </div>
        </>
      ) : null}
      {kind === "aggregate" ? (
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectIn label={`${lab}: aggregate`} value={String(p.aggregate)} disabled={readOnly} options={[...(doc.aggregates?.some((a) => a.id === p.aggregate) ? [] : [{ value: String(p.aggregate), label: String(p.aggregate) || "Choose an aggregate" }]), ...(doc.aggregates ?? []).map((a) => ({ value: a.id, label: a.id }))]} onChange={(v) => onChange({ ...(pred as Extract<Pred, { aggregate: string }>), aggregate: v })} />
          <SelectIn label={`${lab}: compare`} value={String(p.op)} options={opOptions} disabled={readOnly} onChange={(v) => onChange({ ...(pred as Extract<Pred, { aggregate: string }>), op: v as Op })} />
          <NumIn label={`${lab}: value`} value={p.value as number} disabled={readOnly} onChange={(n) => onChange({ ...(pred as Extract<Pred, { aggregate: string }>), value: n ?? 0 })} />
        </div>
      ) : null}
      {kind === "item" ? (() => {
        const item = def.items.find((i) => i.stable_key === p.item);
        const fieldKey = typeof p.field === "string" ? p.field : PRIMARY;
        const sp = item ? fieldSpec(item, fieldKey) : null;
        const cur = pred as Extract<Pred, { item: string }>;
        return (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <SelectIn label={`${lab}: item`} value={String(p.item)} disabled={readOnly} options={[...(item ? [] : [{ value: String(p.item), label: "Choose an item" }]), ...def.items.map((i) => ({ value: i.stable_key, label: `${i.code} ${i.prompt}` }))]} onChange={(v) => { const n = def.items.find((i) => i.stable_key === v); onChange({ item: v, test: defaultTest(validTestKinds(n ? [fieldSpec(n, PRIMARY)!] : [], true)[0], n ? [fieldSpec(n, PRIMARY)!] : []) }); }} />
              {item && (item.fields ?? []).length ? (
                <SelectIn label={`${lab}: field`} value={fieldKey} disabled={readOnly} options={[{ value: PRIMARY, label: "The item answer" }, ...(item.fields ?? []).map((f) => ({ value: f.field_key, label: f.label }))]} onChange={(v) => { const fs = fieldSpec(item, v)!; const next: Pred = v === PRIMARY ? { item: cur.item, test: defaultTest(validTestKinds([fs], true)[0], [fs]) } : { item: cur.item, field: v, test: defaultTest(validTestKinds([fs], false)[0], [fs]) }; onChange(next); }} />
              ) : null}
            </div>
            <TestEditor label={`${lab}: test`} test={cur.test} specs={sp ? [sp] : []} isPrimary={fieldKey === PRIMARY} readOnly={readOnly} onChange={(t) => onChange({ ...cur, test: t })} />
          </>
        );
      })() : null}
      {kind === "criticalFailed" || kind === "mandatoryMissing" || kind === "evidenceMissing" ? (
        <SelectorEditor label={`${lab}: items`} allowAll sel={p[kind] as Selector | true} def={def} readOnly={readOnly} onChange={(s) => onChange({ [kind]: s } as unknown as Pred)} />
      ) : null}
      {kind === "groupOutcome" ? (
        <div className="grid gap-2 sm:grid-cols-2">
          <SelectIn label={`${lab}: group`} value={String(p.groupOutcome)} disabled={readOnly} options={def.groups.map((g) => ({ value: g.code, label: g.label }))} onChange={(v) => onChange({ groupOutcome: v, is: String(p.is) })} />
          <SelectIn label={`${lab}: has outcome`} value={String(p.is)} disabled={readOnly} options={outcomeOpts} onChange={(v) => onChange({ groupOutcome: String(p.groupOutcome), is: v })} />
        </div>
      ) : null}
    </div>
  );
}

// ── rule block ───────────────────────────────────────────────────────────────────────────────────────────────
function RuleBlock({ rule, path, def, doc, inGroup, v, onChange, onRemove, onMove, first, last, readOnly }: {
  rule: Rule; path: string; def: InstrumentDef; doc: RulesDoc; inGroup: boolean; v: ValidationResult;
  onChange: (r: Rule) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void; first: boolean; last: boolean; readOnly?: boolean;
}) {
  const own = { errors: issuesUnder(v.errors, path, [`${path}.when`]), warnings: issuesUnder(v.warnings, path, [`${path}.when`]) };
  const outcome = doc.outcomes.find((o) => o.code === rule.then.outcome);
  return (
    <section aria-label={`Rule ${rule.label}`} data-rule={rule.id} className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
        <TextIn label={`Rule name ${path}`} value={rule.label} disabled={readOnly} onChange={(t) => onChange({ ...rule, label: t })} />
        <NumIn label={`Priority ${path}`} value={rule.priority} step={1} disabled={readOnly} onChange={(n) => onChange({ ...rule, priority: Math.trunc(n ?? 0) })} />
        {!readOnly ? (
          <div className="flex gap-1">
            <Btn size="sm" aria-label={`Move rule ${rule.label} up`} disabled={first} onClick={() => onMove(-1)}>Up</Btn>
            <Btn size="sm" aria-label={`Move rule ${rule.label} down`} disabled={last} onClick={() => onMove(1)}>Down</Btn>
            <Btn size="sm" kind="danger" aria-label={`Delete rule ${rule.label}`} onClick={onRemove}>Delete</Btn>
          </div>
        ) : null}
      </div>
      <p className={`text-xs ${mutedText}`}>Higher priority is checked first. The first rule that matches decides.</p>
      <ConditionEditor<Pred>
        cond={rule.when} path={`${path}.when`} validation={v} readOnly={readOnly}
        onChange={(c) => onChange({ ...rule, when: c })}
        makeLeaf={() => newPred("count", def, doc)}
        renderLeaf={(p, set, lp) => <PredEditor pred={p} onChange={set} def={def} doc={doc} inGroup={inGroup} readOnly={readOnly} path={lp} />}
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="flex items-end gap-2">
          <SelectIn className="flex-1" label={`THEN the outcome is ${path}`} value={rule.then.outcome} disabled={readOnly} options={[...(outcome ? [] : [{ value: rule.then.outcome, label: rule.then.outcome || "Choose an outcome" }]), ...doc.outcomes.map((o) => ({ value: o.code, label: `${o.label} (${o.code})` }))]} onChange={(c) => onChange({ ...rule, then: { outcome: c } })} />
          {outcome ? <Chip tone={classTone(outcome.class)}>{humanize(outcome.class)}</Chip> : null}
        </div>
        <TextIn label={`Explanation ${path}`} value={rule.explain ?? ""} disabled={readOnly} hint="Shown to the person reading the result." onChange={(t) => onChange(t === "" ? without(rule, "explain") : { ...rule, explain: t })} />
      </div>
      <Inline errors={own.errors} warnings={own.warnings} />
    </section>
  );
}

function RuleList({ rules, path, def, doc, inGroup, v, onChange, readOnly }: { rules: Rule[]; path: string; def: InstrumentDef; doc: RulesDoc; inGroup: boolean; v: ValidationResult; onChange: (r: Rule[]) => void; readOnly?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {rules.map((r, i) => (
        <RuleBlock
          key={i} rule={r} path={`${path}[${i}]`} def={def} doc={doc} inGroup={inGroup} v={v} readOnly={readOnly} first={i === 0} last={i === rules.length - 1}
          onChange={(n) => onChange(setAt(rules, i, n))} onRemove={() => onChange(removeAt(rules, i))}
          onMove={(d) => { const to = i + d; if (to < 0 || to >= rules.length) return; const c = [...rules]; [c[i], c[to]] = [c[to], c[i]]; onChange(c); }}
        />
      ))}
      {!readOnly ? <div><Btn onClick={() => onChange([...rules, newRule(def, doc)])}>Add rule</Btn></div> : null}
    </div>
  );
}

function Panel({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4">
      <div><h3 className="text-base font-semibold text-[var(--cmp-app-text)]">{title}</h3>{hint ? <p className={`text-xs ${mutedText}`}>{hint}</p> : null}</div>
      {children}
    </section>
  );
}

export interface RulesBuilderProps {
  def: InstrumentDef;
  doc: RulesDoc;
  onChange: (doc: RulesDoc) => void;
  readOnly?: boolean;
  /** saved test cases; when given (with onTestsChange) the Test Scoring panel is shown under the builder */
  tests?: ScoringTestCase[];
  onTestsChange?: (tests: ScoringTestCase[]) => void;
  /** externally computed validation (for example the server's), replaces the live one */
  validation?: ValidationResult;
}

export function RulesBuilder({ def, doc, onChange, readOnly, tests, onTestsChange, validation }: RulesBuilderProps) {
  const v = useMemo(() => validation ?? validateRules(def, doc), [validation, def, doc]);
  const anyCritical = def.items.some((i) => i.critical);
  const anyMandatory = def.items.some((i) => i.mandatory || i.critical);
  const outcomes = doc.outcomes;
  const outOpts = (cls?: string): Opt[] => outcomes.filter((o) => !cls || o.class === cls).map((o) => ({ value: o.code, label: `${o.label} (${o.code})` }));
  const gate = (k: "criticalFail" | "mandatoryMissing", cls: string): Opt[] => [{ value: "", label: "None" }, ...outOpts(cls), ...(doc.gates?.[k] && !outcomes.some((o) => o.code === doc.gates?.[k] && o.class === cls) ? [{ value: doc.gates[k] as string, label: `${doc.gates[k]} (not valid)` }] : [])];
  const setGate = (k: "criticalFail" | "mandatoryMissing", val: string) => {
    const g = { ...(doc.gates ?? {}) };
    if (val === "") delete g[k]; else g[k] = val;
    onChange(Object.keys(g).length ? { ...doc, gates: g } : without(doc, "gates"));
  };
  const setDefault = (k: "na" | "notObserved" | "unable" | "undeterminable", val: string) => {
    const d: Record<string, string> = { ...(doc.defaults ?? {}) } as Record<string, string>;
    if (val === "") delete d[k]; else d[k] = val;
    onChange(Object.keys(d).length ? { ...doc, defaults: d } : without(doc, "defaults"));
  };
  const aggs = doc.aggregates ?? [];
  const setAggs = (a: AggregateDef[]) => onChange(a.length ? { ...doc, aggregates: a } : without(doc, "aggregates"));
  const groupSets = doc.groups ?? [];
  const setGroups = (g: NonNullable<RulesDoc["groups"]>) => onChange(g.length ? { ...doc, groups: g } : without(doc, "groups"));
  const freeGroups = def.groups.filter((g) => !groupSets.some((s) => s.group === g.code));

  return (
    <div className="flex flex-col gap-4" data-rules-builder>
      <IssueSummary errors={v.errors} warnings={v.warnings} label="Rules validation" />

      <Panel title="Outcomes" hint="Every outcome needs a code, a label and a class. The class says what the outcome means, not how it is reached.">
        {outcomes.map((o, i) => {
          const p = `outcomes[${i}]`;
          return (
            <div key={i} className="flex flex-col gap-1" data-outcome-row={o.code}>
              <div className="grid gap-2 sm:grid-cols-[10rem_1fr_11rem_auto] sm:items-end">
                <TextIn label={`Outcome code ${i + 1}`} value={o.code} disabled={readOnly} onChange={(t) => onChange(renameOutcome(doc, o.code, t.trim()))} />
                <TextIn label={`Outcome label ${i + 1}`} value={o.label} disabled={readOnly} onChange={(t) => onChange({ ...doc, outcomes: setAt(outcomes, i, { ...o, label: t }) })} />
                <SelectIn label={`Outcome class ${i + 1}`} value={o.class} disabled={readOnly} options={OUTCOME_CLASSES.map((c) => ({ value: c, label: humanize(c) }))} onChange={(c) => onChange({ ...doc, outcomes: setAt(outcomes, i, { ...o, class: c as typeof o.class }) })} />
                {!readOnly ? <Btn size="sm" kind="danger" aria-label={`Delete outcome ${o.label}`} onClick={() => onChange({ ...doc, outcomes: removeAt(outcomes, i) })}>Delete</Btn> : null}
              </div>
              <Inline errors={issuesUnder(v.errors, p)} warnings={issuesUnder(v.warnings, p)} />
            </div>
          );
        })}
        {!readOnly ? <div><Btn onClick={() => onChange({ ...doc, outcomes: [...outcomes, newOutcome(doc)] })}>Add outcome</Btn></div> : null}
        <Inline errors={v.errors.filter((e) => e.path === "outcomes")} warnings={v.warnings.filter((e) => e.path === "outcomes")} />
      </Panel>

      <Panel title="Gates" hint="Built in and cannot be turned off. A failed critical item or an unanswered required item decides the result before any rule, whatever the average.">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <SelectIn label="A critical item is not met: outcome" value={doc.gates?.criticalFail ?? ""} options={gate("criticalFail", "negative")} disabled={readOnly} onChange={(val) => setGate("criticalFail", val)} hint={anyCritical ? "Required, because an item is critical. Choose a negative outcome." : "Optional. No item is critical."} />
            <Inline errors={issuesUnder(v.errors, "gates.criticalFail")} warnings={[]} />
          </div>
          <div>
            <SelectIn label="A required item is unanswered: outcome" value={doc.gates?.mandatoryMissing ?? ""} options={gate("mandatoryMissing", "incomplete")} disabled={readOnly} onChange={(val) => setGate("mandatoryMissing", val)} hint={anyMandatory ? "Required, because an item is required. Choose an incomplete outcome." : "Optional. No item is required."} />
            <Inline errors={issuesUnder(v.errors, "gates.mandatoryMissing")} warnings={[]} />
          </div>
        </div>
      </Panel>

      <Panel title="Defaults" hint="How an answer type is treated when an item does not say. An item can override each.">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectIn label="Not applicable" value={doc.defaults?.na ?? ""} disabled={readOnly} options={[{ value: "", label: "Left out (default)" }, { value: "exclude", label: "Left out of every count" }, { value: "count_unsatisfactory", label: "Counted as not met" }]} onChange={(val) => setDefault("na", val)} />
          <SelectIn label="Not observed" value={doc.defaults?.notObserved ?? ""} disabled={readOnly} options={[{ value: "", label: "Missing (default)" }, { value: "missing", label: "Missing" }, { value: "unsatisfactory", label: "Counted as not met" }]} onChange={(val) => setDefault("notObserved", val)} />
          <SelectIn label="Unable to demonstrate" value={doc.defaults?.unable ?? ""} disabled={readOnly} options={[{ value: "", label: "Not met (default)" }, { value: "unsatisfactory", label: "Counted as not met" }]} onChange={(val) => setDefault("unable", val)} />
          <SelectIn label="Unable to determine" value={doc.defaults?.undeterminable ?? ""} disabled={readOnly} options={[{ value: "", label: "Missing (default)" }, { value: "missing", label: "Missing" }, { value: "exclude", label: "Left out of every count" }, { value: "unsatisfactory", label: "Counted as not met" }]} onChange={(val) => setDefault("undeterminable", val)} />
        </div>
      </Panel>

      <Panel title="Aggregates" hint="Named figures the rules can test. Not applicable and excluded answers are left out of the denominator and the trace says so.">
        {aggs.map((a, i) => {
          const p = `aggregates[${i}]`;
          const specs = specsFor(def, a.over);
          return (
            <div key={i} className="flex flex-col gap-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3" data-aggregate={a.id}>
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <TextIn label={`Aggregate name ${i + 1}`} value={a.id} disabled={readOnly} onChange={(t) => {
                  const next = aggs.map((x, n) => (n === i ? { ...x, id: t } : x));
                  const walk = (c: unknown): unknown => Array.isArray(c) ? c.map(walk) : c && typeof c === "object" ? Object.fromEntries(Object.entries(c as Record<string, unknown>).map(([k, val]) => [k, k === "aggregate" && val === a.id ? t : walk(val)])) : c;
                  const rename = (r: Rule): Rule => ({ ...r, when: walk(r.when) as Rule["when"] });
                  onChange({ ...doc, aggregates: next, rules: doc.rules.map(rename), ...(doc.groups ? { groups: doc.groups.map((g) => ({ ...g, rules: g.rules.map(rename) })) } : {}) });
                }} />
                <SelectIn label={`Aggregate function ${i + 1}`} value={a.fn} disabled={readOnly} options={AGG_FNS.map((f) => ({ value: f, label: aggApplicable(f, specs) || f === a.fn ? AGG_LABEL[f] + (aggApplicable(f, specs) ? "" : " (not valid here)") : AGG_LABEL[f], disabled: !aggApplicable(f, specs) && f !== a.fn }))} onChange={(f) => setAggs(setAt(aggs, i, { ...a, fn: f as AggFn }))} />
                <SelectIn label={`Aggregate weights ${i + 1}`} value={a.weights} disabled={readOnly} options={[{ value: "none", label: "Every item counts once" }, { value: "item", label: "By item weight" }, { value: "section", label: "By section weight" }]} onChange={(w) => setAggs(setAt(aggs, i, { ...a, weights: w as AggregateDef["weights"] }))} />
                {!readOnly ? <Btn size="sm" kind="danger" aria-label={`Delete aggregate ${a.id}`} onClick={() => setAggs(removeAt(aggs, i))}>Delete</Btn> : null}
              </div>
              <SelectorEditor label={`Aggregate ${i + 1} items`} sel={a.over} def={def} readOnly={readOnly} onChange={(s) => setAggs(setAt(aggs, i, { ...a, over: s as Selector }))} />
              <p className={`text-xs ${mutedText}`}>{selectSafe(def, a.over)} items selected.</p>
              <Inline errors={issuesUnder(v.errors, p)} warnings={issuesUnder(v.warnings, p)} />
            </div>
          );
        })}
        {!readOnly ? <div><Btn onClick={() => setAggs([...aggs, { id: `aggregate_${aggs.length + 1}`, fn: "percent_satisfactory", over: { scope: "all" }, weights: "none" }])}>Add aggregate</Btn></div> : null}
        <Check label="Allow averaging ordinal ratings" checked={!!doc.permitOrdinalMean} disabled={readOnly} hint="The gap between levels is not a fixed amount, so the engine refuses a mean over ratings unless this is on. A reviewer will see that it is." onChange={(c) => onChange(c ? { ...doc, permitOrdinalMean: true } : without(doc, "permitOrdinalMean"))} />
      </Panel>

      {def.groups.length ? (
        <Panel title="Group rules" hint="Checked first, one level, no cycles. Each group gets an outcome that overall rules can read.">
          {groupSets.map((g, gi) => {
            const p = `groups[${gi}]`;
            const label = def.groups.find((x) => x.code === g.group)?.label ?? g.group;
            return (
              <div key={gi} className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3" data-group-rules={g.group}>
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-sm font-semibold">Group: {label}</h4>
                  {!readOnly ? <Btn size="sm" kind="danger" aria-label={`Remove rules for group ${label}`} onClick={() => setGroups(removeAt(groupSets, gi))}>Remove group rules</Btn> : null}
                </div>
                <Inline errors={v.errors.filter((e) => e.path === `${p}.group`)} warnings={[]} />
                <RuleList rules={g.rules} path={`${p}.rules`} def={def} doc={doc} inGroup v={v} readOnly={readOnly} onChange={(r) => setGroups(setAt(groupSets, gi, { ...g, rules: r }))} />
                <SelectIn label={`Fallback for group ${label}`} value={g.fallback} disabled={readOnly} options={[...(outcomes.some((o) => o.code === g.fallback) ? [] : [{ value: g.fallback, label: g.fallback || "Choose an outcome" }]), ...outOpts()]} onChange={(f) => setGroups(setAt(groupSets, gi, { ...g, fallback: f }))} hint="Used when no rule of this group matches." />
                <Inline errors={v.errors.filter((e) => e.path === `${p}.fallback`)} warnings={[]} />
              </div>
            );
          })}
          {!readOnly && freeGroups.length ? (
            <div className="flex flex-wrap gap-2">
              {freeGroups.map((g) => <Btn key={g.code} onClick={() => setGroups([...groupSets, { group: g.code, rules: [], fallback: outcomes[0]?.code ?? "" }])}>Add rules for {g.label}</Btn>)}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel title="Overall rules" hint="Checked after the gates and the group rules, highest priority first. The first rule that matches decides the outcome.">
        <RuleList rules={doc.rules} path="rules" def={def} doc={doc} inGroup={false} v={v} readOnly={readOnly} onChange={(r) => onChange({ ...doc, rules: r })} />
        <SelectIn label="Fallback outcome" value={doc.fallback} disabled={readOnly} options={[...(outcomes.some((o) => o.code === doc.fallback) ? [] : [{ value: doc.fallback ?? "", label: doc.fallback || "Choose an outcome" }]), ...outOpts()]} onChange={(f) => onChange({ ...doc, fallback: f })} hint="Required. Used when no rule matches." />
        <Inline errors={v.errors.filter((e) => e.path === "fallback")} warnings={[]} />
      </Panel>

      {tests && onTestsChange ? <TestScoring def={def} doc={doc} tests={tests} onTestsChange={onTestsChange} readOnly={readOnly} /> : null}
    </div>
  );
}

function selectSafe(def: InstrumentDef, sel: Selector): number {
  try { return selectItems(def, sel).length; } catch { return 0; }
}

