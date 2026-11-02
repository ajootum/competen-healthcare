"use client";
// <AssessmentRunner> draws resolveView() and nothing else. It never decides which items appear: every item of the
// definition is drawn, in both modes, from the same responses. Switching Standard Checklist <-> Guided Assessment
// loses nothing because the responses live with the host, not here.
//
//   Standard Checklist   scroll (section cards or accordions) or section tabs with counts
//   Guided Assessment    stepper, one item (or one section) at a time, Previous / Next, "Item x of y"
//
// Layout is driven by the `breakpoint` prop ("auto" measures the container, so a pane next to a sidebar behaves like
// a tablet). Two columns from the md edge (768px of container width), stacked below. 44px targets throughout.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  evaluate, explain, resolveView, RulesError, GUIDED_ASSESSMENT_LAYOUT, STANDARD_CHECKLIST_LAYOUT,
  type Breakpoint, type EvalContext, type Evaluation, type InstrumentDef, type LayoutDoc, type ResponseValue, type Responses, type RulesDoc, type ViewBlock, type ViewItem, type ViewModel,
} from "@/lib/assessment/core";
import { ItemView } from "./ItemView";
import { Btn, Chip, classTone, focusRing, mutedText, SelectIn, touch, TONE, type Tone } from "./ui";

export type SaveStatus = "idle" | "saving" | "saved" | "offline" | "conflict";
export type RunnerMode = "standard" | "guided";

const SAVE_LABEL: Record<Exclude<SaveStatus, "idle">, { text: string; tone: Tone }> = {
  saving: { text: "Saving", tone: "info" },
  saved: { text: "Saved", tone: "success" },
  offline: { text: "Offline, will retry", tone: "warning" },
  conflict: { text: "Conflict", tone: "error" },
};

/** The save-status pill. Driven entirely by the host. */
export function SaveStatusPill({ status }: { status: SaveStatus }) {
  const s = status === "idle" ? null : SAVE_LABEL[status];
  return (
    <span role="status" aria-live="polite" data-save-status={status} className={s ? `inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${TONE[s.tone]}` : "sr-only"}>
      {s ? s.text : ""}
    </span>
  );
}

/** The layout a mode uses: the host's layout if it already fits the mode, else the host's layout turned into the mode's navigation. */
export function layoutForMode(layout: LayoutDoc | null | undefined, mode: RunnerMode, guidedLayout?: LayoutDoc | null): LayoutDoc {
  const base = layout ?? (mode === "guided" ? GUIDED_ASSESSMENT_LAYOUT : STANDARD_CHECKLIST_LAYOUT);
  if (mode === "guided") {
    if (guidedLayout) return guidedLayout;
    if (base.navigation.mode === "stepper") return base;
    return {
      ...base, presentation: "guided_assessment", navigation: { ...GUIDED_ASSESSMENT_LAYOUT.navigation },
      item: { component: "ItemFocus", slots: { ...base.item.slots, guidance: "inline", response: "below" } },
      section: { ...base.section, collapsible: false }, breakpoints: undefined,
    };
  }
  if (base.navigation.mode !== "stepper") return base;
  return {
    ...base, presentation: "standard_checklist", navigation: { ...STANDARD_CHECKLIST_LAYOUT.navigation },
    item: { component: "ItemRow", slots: { ...base.item.slots, response: "right" } },
  };
}

export interface AssessmentRunnerProps {
  def: InstrumentDef;
  layout: LayoutDoc | null | undefined;
  /** the layout to use in guided mode; if absent the standard layout is turned into a stepper */
  guidedLayout?: LayoutDoc | null;
  responses: Responses;
  onChange: (next: Responses, change: { key: string; value: ResponseValue | null }) => void;
  /** scoring rules: needed for the Preview outcome button */
  rules?: RulesDoc | null;
  /** an evaluation computed by the host (overrides the built-in preview) */
  evaluation?: Evaluation | null;
  metadata?: Record<string, string | null | undefined>;
  context?: string | null;
  mode?: RunnerMode;
  onModeChange?: (mode: RunnerMode) => void;
  /** show the Standard / Guided switch (default true) */
  modeSwitch?: boolean;
  breakpoint?: Breakpoint | "auto";
  saveStatus?: SaveStatus;
  readOnly?: boolean;
  title?: string;
  subtitle?: string;
  instructions?: React.ReactNode;
  subject?: React.ReactNode;
  /** a banner above everything, for example the attestation line */
  banner?: React.ReactNode;
  /** host actions (Save draft, Submit) shown in the toolbar */
  actions?: React.ReactNode;
  evidenceCounts?: EvalContext["evidenceCounts"];
  onAttachEvidence?: (itemKey: string) => void;
  renderEvidence?: (itemKey: string) => React.ReactNode;
  comments?: Record<string, string>;
  onCommentChange?: (itemKey: string, text: string) => void;
  renderComment?: (itemKey: string) => React.ReactNode;
  methodLabels?: Record<string, string>;
  /** called when the Preview outcome button is pressed */
  onPreviewRequest?: () => void;
  className?: string;
}

export function AssessmentRunner(props: AssessmentRunnerProps) {
  const { def, responses, rules, readOnly } = props;
  const [modeState, setModeState] = useState<RunnerMode>(props.mode ?? "standard");
  const mode = props.mode ?? modeState;
  const [step, setStep] = useState(0);
  const [tab, setTab] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [previewOn, setPreviewOn] = useState(false);

  // container width -> breakpoint
  const rootRef = useRef<HTMLDivElement>(null);
  const [auto, setAuto] = useState<Breakpoint>("desktop");
  const asked = props.breakpoint ?? "auto";
  useEffect(() => {
    if (asked !== "auto" || !rootRef.current || typeof ResizeObserver === "undefined") return;
    const el = rootRef.current;
    const f = (w: number) => { if (w > 0) setAuto(w >= 1024 ? "desktop" : w >= 768 ? "tablet" : "mobile"); };
    f(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((es) => f(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [asked]);
  const bp: Breakpoint = asked === "auto" ? auto : asked;
  const wide = bp !== "mobile";

  const layout = useMemo(() => layoutForMode(props.layout, mode, props.guidedLayout), [props.layout, props.guidedLayout, mode]);
  const viewOpts = useMemo(() => ({ breakpoint: bp, currentStep: step, metadata: props.metadata, context: props.context, evidenceCounts: props.evidenceCounts, defaults: rules?.defaults }), [bp, step, props.metadata, props.context, props.evidenceCounts, rules?.defaults]);

  const evalState = useMemo((): { ev: Evaluation | null; err: string | null } => {
    if (props.evaluation) return { ev: props.evaluation, err: null };
    if (!previewOn || !rules) return { ev: null, err: null };
    try { return { ev: evaluate(def, rules, responses, { evidenceCounts: props.evidenceCounts }), err: null }; }
    catch (e) { return { ev: null, err: e instanceof RulesError ? e.message : String(e) }; }
  }, [props.evaluation, previewOn, rules, def, responses, props.evidenceCounts]);

  const view: ViewModel = useMemo(() => resolveView(def, layout, responses, evalState.ev, viewOpts), [def, layout, responses, evalState.ev, viewOpts]);

  const itemByKey = useMemo(() => new Map(def.items.map((i) => [i.stable_key, i])), [def.items]);
  const groupLabel = useMemo(() => new Map(def.groups.map((g) => [g.code, g.label])), [def.groups]);
  const numberOf = useMemo(() => new Map(view.items.map((i, n) => [i.key, n + 1])), [view.items]);

  const setMode = (m: RunnerMode) => {
    if (m === mode) return;
    if (m === "guided") {
      const gv = resolveView(def, layoutForMode(props.layout, "guided", props.guidedLayout), responses, null, { ...viewOpts, currentStep: 0 });
      const firstOpen = gv.steps.findIndex((s) => s.itemKeys.some((k) => !gv.items.find((i) => i.key === k)!.status.complete));
      setStep(firstOpen < 0 ? 0 : firstOpen);
    }
    setModeState(m);
    props.onModeChange?.(m);
  };

  const change = useCallback((rk: string, next: ResponseValue | null) => {
    const r: Responses = { ...responses };
    if (next === null) delete r[rk]; else r[rk] = next;
    props.onChange(r, { key: rk, value: next });
  }, [responses, props]);

  const renderItem = (vi: ViewItem) => (
    <ItemView
      key={vi.key} view={vi} item={itemByKey.get(vi.key)!} number={numberOf.get(vi.key) ?? 0} responses={responses} onChange={change}
      wide={wide} disabled={readOnly} indicators={view.indicators} groupLabel={vi.group_code ? groupLabel.get(vi.group_code) ?? vi.group_code : null}
      methodLabels={props.methodLabels} evidenceCount={props.evidenceCounts?.[vi.key] ?? 0} onAttachEvidence={props.onAttachEvidence} renderEvidence={props.renderEvidence}
      comment={props.comments?.[vi.key]} onCommentChange={props.onCommentChange} renderComment={props.renderComment}
      position={view.mode === "stepper" && view.unit === "item" ? `Item ${numberOf.get(vi.key) ?? 0} of ${view.items.length}` : undefined}
    />
  );

  // ── header ────────────────────────────────────────────────────────────────────────────────────────────────
  const p = view.progress;
  const header = view.header.map((b) => {
    switch (b) {
      case "TitleBlock":
        return (
          <div key={b}>
            <h2 className="text-xl font-semibold text-[var(--cmp-app-text)]">{props.title ?? def.instrument_code ?? "Assessment"}</h2>
            {props.subtitle ? <p className={`text-sm ${mutedText}`}>{props.subtitle}</p> : null}
          </div>
        );
      case "InstructionsBlock": return props.instructions ? <div key={b} className="text-sm text-[var(--cmp-app-text)]">{props.instructions}</div> : null;
      case "SubjectBlock": return props.subject ? <div key={b} className="text-sm text-[var(--cmp-app-text)]">{props.subject}</div> : null;
      case "ContextBlock":
        return view.context ? <p key={b} role="note" className="rounded-lg border border-[var(--cmp-theme-border)] bg-[var(--cmp-theme-soft)] px-3 py-2 text-sm text-[var(--cmp-theme-ink)]">{view.context}</p> : null;
      case "MetadataBlock":
        return view.metadata.length ? (
          <dl key={b} data-metadata className={`grid gap-x-6 gap-y-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3 text-sm ${wide ? "grid-cols-2" : "grid-cols-1"}`}>
            {view.metadata.map((m) => (
              <div key={m.key} className="min-w-0">
                <dt className={`text-xs font-semibold ${mutedText}`}>{m.label}</dt>
                <dd className="break-words text-[var(--cmp-app-text)]">{m.value ?? "Not set"}</dd>
              </div>
            ))}
          </dl>
        ) : null;
      case "ProgressBlock":
        return (
          <div key={b} className="flex flex-col gap-2" data-progress>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[var(--cmp-app-text)]">{p.completed} of {p.total} completed</p>
              <div className="flex flex-wrap gap-1.5">
                {view.indicators.unassessed ? <Chip>{p.unassessed} not answered</Chip> : null}
                {view.indicators.critical && p.critical.total ? <Chip tone={p.critical.failed ? "critical" : "neutral"}>{p.critical.total} critical{p.critical.failed ? `, ${p.critical.failed} not met` : ""}</Chip> : null}
                {view.indicators.missingEvidence && p.missingEvidence ? <Chip tone="warning">{p.missingEvidence} missing evidence</Chip> : null}
                {view.indicators.completed && p.missingFields ? <Chip tone="warning">{p.missingFields} required {p.missingFields === 1 ? "field" : "fields"} missing</Chip> : null}
              </div>
            </div>
            {view.navigation.progress === "bar" ? (
              <div role="progressbar" aria-label="Progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.percentComplete)} className="h-2 overflow-hidden rounded-full bg-[var(--cmp-neutral-200)]">
                <div className="h-full bg-[var(--cmp-theme-accent)]" style={{ width: `${Math.max(0, Math.min(100, p.percentComplete))}%` }} />
              </div>
            ) : null}
          </div>
        );
      default: return null;
    }
  });

  // ── sections ──────────────────────────────────────────────────────────────────────────────────────────────
  const accordion = view.section.component === "SectionAccordion";
  const canCollapse = accordion || view.section.collapsible;
  const toggle = (k: string) => setCollapsed((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const counts = (b: ViewBlock) => `${b.counts.complete} of ${b.counts.total} completed`;

  const renderBlock = (b: ViewBlock, forced?: boolean) => {
    const closed = !forced && canCollapse && collapsed.has(b.key);
    const hid = `blk-${b.key.replace(/[^a-z0-9]/gi, "")}`;
    const titleRow = (
      <>
        <span className="min-w-0">
          <span className="block text-base font-semibold text-[var(--cmp-app-text)]">{b.title}</span>
          {b.subtitle ? <span className={`block text-xs ${mutedText}`}>{b.subtitle}</span> : null}
        </span>
        <span className={`shrink-0 text-xs ${mutedText}`}>{counts(b)}</span>
      </>
    );
    return (
      <section key={b.key} aria-labelledby={`${hid}-t`} data-block={b.key} style={{ marginLeft: b.depth ? `${Math.min(b.depth, 3) * 16}px` : undefined }} className="overflow-hidden rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)]">
        {canCollapse && !forced ? (
          <h3 id={`${hid}-t`} className="m-0">
            <button type="button" aria-expanded={!closed} aria-controls={`${hid}-body`} onClick={() => toggle(b.key)} className={`flex w-full ${touch} items-center justify-between gap-3 bg-[var(--cmp-app-bg)] px-4 py-2 text-left ${focusRing}`}>{titleRow}</button>
          </h3>
        ) : (
          <h3 id={`${hid}-t`} className={`m-0 flex ${touch} items-center justify-between gap-3 bg-[var(--cmp-app-bg)] px-4 py-2`}>{titleRow}</h3>
        )}
        <div id={`${hid}-body`} hidden={closed} className={`flex flex-col px-4 py-2 ${view.items[0]?.component === "ItemRow" ? "" : "gap-3 py-3"}`}>
          {b.guidance ? <p className={`py-1 text-sm ${mutedText}`}>{b.guidance}</p> : null}
          {b.items.map(renderItem)}
          {b.items.length === 0 ? <p className={`py-2 text-sm ${mutedText}`}>This section has no items.</p> : null}
        </div>
      </section>
    );
  };

  // ── body by navigation ────────────────────────────────────────────────────────────────────────────────────
  let body: React.ReactNode;
  if (view.mode === "stepper") {
    const cur = view.steps[view.step.index];
    const keys = new Set(cur?.itemKeys ?? []);
    const block = view.blocks.find((b) => b.key === cur?.blockKey);
    const items = view.items.filter((i) => keys.has(i.key));
    const labelOf = (i: number) => {
      const s = view.steps[i];
      const first = view.items.find((x) => x.key === s.itemKeys[0])!;
      const done = s.itemKeys.every((k) => view.items.find((x) => x.key === k)!.status.complete);
      return `${i + 1}. ${view.unit === "item" ? first.code : view.blocks.find((b) => b.key === s.blockKey)?.title ?? first.code}${done ? " (completed)" : ""}`;
    };
    const go = (i: number) => setStep(Math.max(0, Math.min(view.steps.length - 1, i)));
    body = (
      <div className="flex flex-col gap-3" data-stepper>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--cmp-app-text)]" aria-live="polite">
            {view.unit === "item" ? "Item" : "Section"} {view.step.index + 1} of {view.step.total}
          </p>
          {block ? <p className={`text-xs ${mutedText}`}>{block.title}{block.subtitle ? `, ${block.subtitle}` : ""}</p> : null}
        </div>
        {view.navigation.allowJump && view.steps.length > 1 ? (
          <SelectIn label={`Jump to ${view.unit === "item" ? "item" : "section"}`} value={String(view.step.index)} options={view.steps.map((_s, i) => ({ value: String(i), label: labelOf(i) }))} onChange={(v) => go(Number(v))} />
        ) : null}
        <div className="flex flex-col gap-3">{items.map(renderItem)}</div>
        {view.navigation.prevNext ? (
          <div className="flex items-center justify-between gap-2">
            <Btn disabled={view.step.prevKey === null} onClick={() => go(view.step.index - 1)}>Previous</Btn>
            <Btn kind="primary" disabled={view.step.nextKey === null} onClick={() => go(view.step.index + 1)}>Next</Btn>
          </div>
        ) : null}
      </div>
    );
  } else if (view.mode === "section_tabs" && view.sectionTabs) {
    const activeKey = view.blocks.find((b) => b.key === tab)?.key ?? view.blocks[0]?.key;
    const showCounts = view.navigation.sectionTabs?.counts !== false;
    const onKey = (e: React.KeyboardEvent, i: number) => {
      const n = view.blocks.length;
      const to = e.key === "ArrowRight" ? (i + 1) % n : e.key === "ArrowLeft" ? (i - 1 + n) % n : null;
      if (to !== null) { e.preventDefault(); setTab(view.blocks[to].key); }
    };
    body = (
      <div className="flex flex-col gap-3">
        <div role="tablist" aria-label="Sections" className="flex gap-2 overflow-x-auto pb-1">
          {view.sectionTabs.map((t, i) => (
            <button
              key={t.key} type="button" role="tab" id={`tab-${t.key}`} aria-selected={t.key === activeKey} aria-controls={`panel-${t.key}`} tabIndex={t.key === activeKey ? 0 : -1}
              onClick={() => setTab(t.key)} onKeyDown={(e) => onKey(e, i)}
              className={`inline-flex ${touch} shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${focusRing} ${t.key === activeKey ? "border-[var(--cmp-theme-accent)] bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "border-[var(--cmp-app-control-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)]"}`}
            >
              {t.title}{showCounts ? <span className="text-xs font-normal" aria-label={`${t.complete} of ${t.total} completed`}>{t.complete}/{t.total}</span> : null}
            </button>
          ))}
        </div>
        {view.blocks.map((b) => (
          <div key={b.key} role="tabpanel" id={`panel-${b.key}`} aria-labelledby={`tab-${b.key}`} hidden={b.key !== activeKey}>
            {renderBlock(b, true)}
          </div>
        ))}
      </div>
    );
  } else {
    body = <div className="flex flex-col gap-4">{view.blocks.map((b) => renderBlock(b))}</div>;
  }

  // ── outcome preview ───────────────────────────────────────────────────────────────────────────────────────
  const canPreview = view.outcomePreview.enabled && (!!rules || !!props.evaluation || !!props.onPreviewRequest);
  const ev = evalState.ev;
  const lines = ev && rules ? explain(rules, ev) : [];
  const preview = canPreview ? (
    <section aria-label="Outcome preview" className="flex flex-col gap-2 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4 print:hidden">
      <div>
        <Btn kind="primary" onClick={() => { setPreviewOn(true); props.onPreviewRequest?.(); }}>{view.outcomePreview.label}</Btn>
      </div>
      <div aria-live="polite" data-outcome-preview>
        {evalState.err ? <p role="alert" className="text-sm text-[var(--cmp-text-error)]">{evalState.err}</p> : null}
        {view.outcomePreview.evaluation ? (
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--cmp-app-text)]">
              <span className="font-semibold">Outcome</span>
              <Chip tone={classTone(view.outcomePreview.evaluation.class)}>{view.outcomePreview.evaluation.label}</Chip>
            </p>
            {lines.map((l, i) => <p key={i} className={`text-sm ${mutedText}`}>{l}</p>)}
            <p className={`text-xs ${mutedText}`}>A preview only. Nothing is submitted.</p>
          </div>
        ) : null}
      </div>
    </section>
  ) : null;

  const showToolbar = props.modeSwitch !== false || props.saveStatus || props.actions;

  return (
    <div ref={rootRef} data-breakpoint={bp} data-mode={mode} className={`flex flex-col gap-4 text-[var(--cmp-app-text)] ${props.className ?? ""}`}>
      {props.banner ? <div role="note">{props.banner}</div> : null}
      {showToolbar ? (
        <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
          {props.modeSwitch !== false ? (
            <div role="group" aria-label="View" className="inline-flex overflow-hidden rounded-lg border border-[var(--cmp-app-control-border)]">
              {(["standard", "guided"] as const).map((m) => (
                <button
                  key={m} type="button" aria-pressed={mode === m} onClick={() => setMode(m)}
                  className={`${touch} px-4 text-sm font-semibold ${focusRing} ${mode === m ? "bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)]"}`}
                >{m === "standard" ? "Standard checklist" : "Guided assessment"}</button>
              ))}
            </div>
          ) : <span />}
          <div className="flex items-center gap-2">
            <SaveStatusPill status={props.saveStatus ?? "idle"} />
            {props.actions}
          </div>
        </div>
      ) : null}
      {header}
      {body}
      {preview}
    </div>
  );
}
