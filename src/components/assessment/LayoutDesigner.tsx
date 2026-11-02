"use client";
// <LayoutDesigner layout def onChange>: the no-code editor of an asmt.layout/1 document. Every control is a picker over the
// closed vocabulary (presentation, navigation, header blocks, metadata fields, section and item components and their slots,
// a control per response type, grouping, indicators, breakpoint overrides, print). There is NO control that hides, filters or
// reorders items, and every change passes through cleanLayout(), so an item selector can neither be typed nor survive.
// The preview is the real AssessmentRunner at desktop / tablet / mobile container widths, and a print sheet.
import { useMemo, useState } from "react";
import {
  AVAILABLE_PRESENTATIONS, BADGES, CONTROL_VOCAB, GROUPINGS, HEADER_BLOCKS, ITEM_COMPONENTS, NAV_MODES, NAV_PROGRESS, NAV_UNITS, PRESENTATIONS,
  RESPONSE_TYPES, SECTION_COMPONENTS, SLOT_VALUES, presetAllSatisfactory, validateLayout,
  type Badge, type Breakpoint, type HeaderBlock, type InstrumentDef, type LayoutDoc, type LayoutSlots, type ResponseType, type Responses, type RulesDoc, type ValidationResult,
} from "@/lib/assessment/core";
import { AssessmentRunner } from "./AssessmentRunner";
import { PrintSheet } from "./PrintSheet";
import { cleanLayout } from "./layout-clean";
import { Btn, Check, Inline, IssueSummary, issuesUnder, mutedText, SelectIn, TextIn, humanize, focusRing, touch, type Opt } from "./ui";
import { removeAt, setAt } from "./rules-helpers";

const PRES_LABEL: Record<string, string> = { standard_checklist: "Standard checklist", guided_assessment: "Guided assessment", audit_inspection: "Audit and inspection", assessment_form: "Assessment form", matrix: "Matrix" };
const VALUE_LABEL: Record<string, string> = {
  inline: "Inline", disclosure: "Disclosure (tap to open)", drawer: "Drawer (tap to open)", right: "Beside the question", below: "Below the question",
  grid2: "Two columns", stack: "One column", scroll: "One scrolling page", stepper: "Step by step", section_tabs: "Section tabs",
  item: "One item", section: "One section", bar: "Bar and count", count: "Count only", group: "By group", section_then_group: "By section, then group",
  SectionCard: "Cards", SectionAccordion: "Accordion", ItemRow: "Row", ItemCard: "Card", ItemFocus: "Focus",
  segmented: "Segmented buttons", radio_list: "Radio list", select: "Dropdown", input: "Number box", checkbox_list: "Checkbox list", textarea: "Text area", checkbox: "Checkbox", uploader: "Attach box",
};
const HEADER_LABEL: Record<HeaderBlock, string> = {
  TitleBlock: "Title", InstructionsBlock: "Instructions", SubjectBlock: "Subject", ProgressBlock: "Progress", ContextBlock: "Context", MetadataBlock: "Details row",
};
const SLOT_LABEL: Record<string, string> = { guidance: "Guidance", expected: "Expected performance", response: "Answer position", evidence: "Evidence", comment: "Comment", fields: "Extra fields" };
const SLOT_KEYS_SEL = Object.keys(SLOT_VALUES) as (keyof typeof SLOT_VALUES)[];
const optsOf = (vals: readonly string[]): Opt[] => vals.map((v) => ({ value: v, label: VALUE_LABEL[v] ?? humanize(v) }));

type Preview = "desktop" | "tablet" | "mobile" | "print";
const PREVIEW_WIDTH: Record<Exclude<Preview, "print">, number> = { desktop: 1100, tablet: 768, mobile: 375 };

function Group({ title, children, hint }: { title: string; children: React.ReactNode; hint?: string }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-4">
      <legend className="px-1 text-sm font-semibold text-[var(--cmp-app-text)]">{title}</legend>
      {hint ? <p className={`text-xs ${mutedText}`}>{hint}</p> : null}
      {children}
    </fieldset>
  );
}

export interface LayoutDesignerProps {
  layout: LayoutDoc;
  def: InstrumentDef;
  onChange: (layout: LayoutDoc) => void;
  readOnly?: boolean;
  /** lets the preview's Preview outcome button work */
  rules?: RulesDoc | null;
  /** starting answers for the preview; the preview keeps its own copy and never writes back */
  previewResponses?: Responses;
  previewMetadata?: Record<string, string | null | undefined>;
  previewContext?: string | null;
  validation?: ValidationResult;
  /** also refuse presentations that cannot be published yet */
  forPublication?: boolean;
}

export function LayoutDesigner({ layout, def, onChange, readOnly, rules, previewResponses, previewMetadata, previewContext, validation, forPublication }: LayoutDesignerProps) {
  const v = useMemo(() => validation ?? validateLayout(layout, def, { forPublication }), [validation, layout, def, forPublication]);
  const [preview, setPreview] = useState<Preview>("desktop");
  const [sample, setSample] = useState<Responses>(previewResponses ?? {});
  const emit = (next: LayoutDoc) => onChange(cleanLayout(next));
  const setNav = (patch: Partial<LayoutDoc["navigation"]>) => emit({ ...layout, navigation: { ...layout.navigation, ...patch } });
  const setSlots = (patch: Partial<LayoutSlots>) => emit({ ...layout, item: { ...layout.item, slots: { ...layout.item.slots, ...patch } } });
  const dis = readOnly;

  const header = layout.header ?? [];
  const missingBlocks = HEADER_BLOCKS.filter((b) => !header.includes(b));
  const moveHeader = (i: number, d: -1 | 1) => { const to = i + d; if (to < 0 || to >= header.length) return; const c = [...header]; [c[i], c[to]] = [c[to], c[i]]; emit({ ...layout, header: c }); };
  const fields = layout.metadata?.fields ?? [];
  const setFields = (f: { key: string; label: string }[]) => emit({ ...layout, metadata: { fields: f } });

  const bpOverride = (bp: "mobile" | "tablet") => {
    const cur = layout.breakpoints?.[bp] ?? {};
    const put = (patch: { item?: { component: LayoutDoc["item"]["component"] } | null; slots?: Partial<LayoutSlots> }) => {
      const next: { item?: { component: LayoutDoc["item"]["component"] }; slots?: Partial<LayoutSlots> } = { ...cur };
      if ("item" in patch) { if (patch.item) next.item = patch.item; else delete next.item; }
      if (patch.slots) { const s = { ...(cur.slots ?? {}), ...patch.slots }; for (const k of Object.keys(s) as (keyof LayoutSlots)[]) if (s[k] === undefined) delete s[k]; if (Object.keys(s).length) next.slots = s; else delete next.slots; }
      const bps = { ...(layout.breakpoints ?? {}) };
      if (Object.keys(next).length) bps[bp] = next; else delete bps[bp];
      emit({ ...layout, breakpoints: Object.keys(bps).length ? bps : undefined });
    };
    return (
      <div key={bp} className="flex flex-col gap-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3">
        <p className="text-sm font-semibold">{humanize(bp)} overrides</p>
        <div className="grid gap-2 sm:grid-cols-3">
          <SelectIn label={`${humanize(bp)}: item style`} value={cur.item?.component ?? ""} disabled={dis} options={[{ value: "", label: "Same as default" }, ...optsOf(ITEM_COMPONENTS)]} onChange={(val) => put({ item: val ? { component: val as LayoutDoc["item"]["component"] } : null })} />
          {(["guidance", "expected", "response", "evidence", "comment", "fields"] as const).map((k) => (
            <SelectIn key={k} label={`${humanize(bp)}: ${SLOT_LABEL[k].toLowerCase()}`} value={(cur.slots?.[k] as string | undefined) ?? ""} disabled={dis} options={[{ value: "", label: "Same as default" }, ...optsOf(SLOT_VALUES[k])]} onChange={(val) => put({ slots: { [k]: val || undefined } as Partial<LayoutSlots> })} />
          ))}
        </div>
        <Inline errors={issuesUnder(v.errors, `breakpoints.${bp}`)} warnings={[]} />
      </div>
    );
  };

  const emulated: Breakpoint = preview === "print" ? "desktop" : preview;
  const stepper = layout.navigation?.mode === "stepper";

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]" data-layout-designer>
      <div className="flex flex-col gap-4">
        <IssueSummary errors={v.errors} warnings={v.warnings} label="Layout validation" />
        <p className={`rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3 text-xs ${mutedText}`}>
          A layout changes how an assessment looks, never which items appear or in what order. Items are shown exactly as the content defines them.
        </p>

        <Group title="Presentation">
          <SelectIn label="Presentation" value={layout.presentation} disabled={dis} options={PRESENTATIONS.map((p) => ({ value: p, label: `${PRES_LABEL[p]}${AVAILABLE_PRESENTATIONS.includes(p) ? "" : " (not yet available)"}` }))} onChange={(val) => emit({ ...layout, presentation: val as LayoutDoc["presentation"] })} />
          <Inline errors={issuesUnder(v.errors, "presentation")} warnings={issuesUnder(v.warnings, "presentation")} />
        </Group>

        <Group title="Navigation">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectIn label="Navigation" value={layout.navigation.mode} disabled={dis} options={optsOf(NAV_MODES)} onChange={(val) => setNav({ mode: val as LayoutDoc["navigation"]["mode"] })} />
            <SelectIn label="One step is" value={layout.navigation.unit} disabled={dis} options={optsOf(NAV_UNITS)} onChange={(val) => setNav({ unit: val as LayoutDoc["navigation"]["unit"] })} />
            <SelectIn label="Progress display" value={layout.navigation.progress} disabled={dis} options={optsOf(NAV_PROGRESS)} onChange={(val) => setNav({ progress: val as LayoutDoc["navigation"]["progress"] })} />
          </div>
          <Check label="Allow jumping to any step" checked={!!layout.navigation.allowJump} disabled={dis} onChange={(c) => setNav({ allowJump: c })} />
          <Check label="Previous and Next buttons" checked={!!layout.navigation.prevNext} disabled={dis} onChange={(c) => setNav({ prevNext: c })} />
          <Check label="Section tabs show counts" checked={layout.navigation.sectionTabs?.counts ?? false} disabled={dis} onChange={(c) => setNav({ sectionTabs: { counts: c } })} />
          <Inline errors={issuesUnder(v.errors, "navigation")} warnings={issuesUnder(v.warnings, "navigation")} />
        </Group>

        <Group title="Header blocks" hint="Shown above the items, in this order.">
          <ul className="flex flex-col gap-1">
            {header.map((b, i) => (
              <li key={b} className="flex items-center justify-between gap-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] px-3 py-1 text-sm">
                <span>{HEADER_LABEL[b] ?? b}</span>
                {!dis ? (
                  <span className="flex gap-1">
                    <Btn size="sm" aria-label={`Move ${HEADER_LABEL[b] ?? b} up`} disabled={i === 0} onClick={() => moveHeader(i, -1)}>Up</Btn>
                    <Btn size="sm" aria-label={`Move ${HEADER_LABEL[b] ?? b} down`} disabled={i === header.length - 1} onClick={() => moveHeader(i, 1)}>Down</Btn>
                    <Btn size="sm" kind="danger" aria-label={`Remove ${HEADER_LABEL[b] ?? b}`} onClick={() => emit({ ...layout, header: header.filter((x) => x !== b) })}>Remove</Btn>
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
          {!dis && missingBlocks.length ? (
            <div className="flex flex-wrap gap-2">
              {missingBlocks.map((b) => <Btn key={b} size="sm" onClick={() => emit({ ...layout, header: [...header, b] })}>Add {HEADER_LABEL[b]}</Btn>)}
            </div>
          ) : null}
          <Inline errors={issuesUnder(v.errors, "header")} warnings={[]} />
        </Group>

        <Group title="Details row fields" hint="Labels only. The values come from the product that runs the assessment.">
          {fields.map((f, i) => (
            <div key={i} className="flex flex-col gap-1">
              <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                <TextIn label={`Field key ${i + 1}`} value={f.key} disabled={dis} onChange={(t) => setFields(setAt(fields, i, { ...f, key: t }))} />
                <TextIn label={`Field label ${i + 1}`} value={f.label} disabled={dis} onChange={(t) => setFields(setAt(fields, i, { ...f, label: t }))} />
                {!dis ? <Btn size="sm" kind="danger" aria-label={`Remove field ${f.label || i + 1}`} onClick={() => setFields(removeAt(fields, i))}>Remove</Btn> : null}
              </div>
              <Inline errors={issuesUnder(v.errors, `metadata.fields[${i}]`)} warnings={[]} />
            </div>
          ))}
          {!dis ? <div><Btn size="sm" onClick={() => setFields([...fields, { key: `field_${fields.length + 1}`, label: "New field" }])}>Add field</Btn></div> : null}
          <Inline errors={v.errors.filter((e) => e.path === "metadata")} warnings={[]} />
        </Group>

        <Group title="Sections and grouping">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectIn label="Section style" value={layout.section.component} disabled={dis} options={optsOf(SECTION_COMPONENTS)} onChange={(val) => emit({ ...layout, section: { ...layout.section, component: val as LayoutDoc["section"]["component"] } })} />
            <SelectIn label="Grouping" value={layout.grouping} disabled={dis} options={optsOf(GROUPINGS)} onChange={(val) => emit({ ...layout, grouping: val as LayoutDoc["grouping"] })} />
          </div>
          <Check label="Sections can be collapsed" checked={!!layout.section.collapsible} disabled={dis} onChange={(c) => emit({ ...layout, section: { ...layout.section, collapsible: c } })} />
          <Check label="Show a group badge on items" checked={!!layout.section.groupBadges} disabled={dis} onChange={(c) => emit({ ...layout, section: { ...layout.section, groupBadges: c } })} />
          <Inline errors={issuesUnder(v.errors, "section")} warnings={[]} />
        </Group>

        <Group title="Items">
          <SelectIn label="Item style" value={layout.item.component} disabled={dis} options={optsOf(ITEM_COMPONENTS)} onChange={(val) => emit({ ...layout, item: { ...layout.item, component: val as LayoutDoc["item"]["component"] } })} />
          <div className="grid gap-3 sm:grid-cols-2">
            {SLOT_KEYS_SEL.map((k) => (
              <SelectIn key={k} label={SLOT_LABEL[k]} value={layout.item.slots[k]} disabled={dis} options={optsOf(SLOT_VALUES[k])} onChange={(val) => setSlots({ [k]: val } as Partial<LayoutSlots>)} />
            ))}
          </div>
          <div role="group" aria-label="Badges">
            <p className={`text-xs font-semibold ${mutedText}`}>Badges</p>
            {BADGES.map((b) => (
              <Check key={b} label={humanize(b)} checked={layout.item.slots.badges.includes(b as Badge)} disabled={dis} onChange={(on) => setSlots({ badges: on ? [...layout.item.slots.badges, b as Badge] : layout.item.slots.badges.filter((x) => x !== b) })} />
            ))}
          </div>
          <Inline errors={issuesUnder(v.errors, "item")} warnings={[]} />
        </Group>

        <Group title="Controls" hint="How each answer type is drawn. Default uses the standard control.">
          <div className="grid gap-3 sm:grid-cols-2">
            {RESPONSE_TYPES.map((t: ResponseType) => (
              <SelectIn key={t} label={`Control for ${humanize(t).toLowerCase()}`} value={layout.controls?.[t] ?? ""} disabled={dis} options={[{ value: "", label: "Default" }, ...optsOf(CONTROL_VOCAB[t])]} onChange={(val) => { const c = { ...(layout.controls ?? {}) }; if (val) c[t] = val; else delete c[t]; emit({ ...layout, controls: c }); }} />
            ))}
          </div>
          <Inline errors={issuesUnder(v.errors, "controls")} warnings={[]} />
        </Group>

        <Group title="Indicators and outcome preview">
          {(["completed", "unassessed", "critical", "missingEvidence"] as const).map((k) => (
            <Check key={k} label={{ completed: "Completed and required fields", unassessed: "Not answered", critical: "Critical items", missingEvidence: "Missing evidence" }[k]} checked={!!layout.indicators[k]} disabled={dis} onChange={(c) => emit({ ...layout, indicators: { ...layout.indicators, [k]: c } })} />
          ))}
          <Check label="Show the Preview outcome button" checked={!!layout.outcomePreview?.enabled} disabled={dis} onChange={(c) => emit({ ...layout, outcomePreview: { ...(layout.outcomePreview ?? {}), enabled: c } })} />
          <TextIn label="Preview outcome button label" value={layout.outcomePreview?.label ?? ""} disabled={dis || !layout.outcomePreview?.enabled} onChange={(t) => emit({ ...layout, outcomePreview: { enabled: !!layout.outcomePreview?.enabled, ...(t ? { label: t } : {}) } })} />
        </Group>

        <Group title="Phone and tablet" hint="Only what changes. Everything else follows the default.">
          {(["tablet", "mobile"] as const).map(bpOverride)}
        </Group>

        <Group title="Print">
          <Check label="Print guidance" checked={!!layout.print.guidance} disabled={dis} onChange={(c) => emit({ ...layout, print: { ...layout.print, guidance: c } })} />
          <Check label="Print the answers" checked={!!layout.print.responses} disabled={dis} onChange={(c) => emit({ ...layout, print: { ...layout.print, responses: c } })} />
          <Check label="Print the evidence list" checked={!!layout.print.evidenceList} disabled={dis} onChange={(c) => emit({ ...layout, print: { ...layout.print, evidenceList: c } })} />
          <Check label="Print a signature line" checked={!!layout.print.signature} disabled={dis} onChange={(c) => emit({ ...layout, print: { ...layout.print, signature: c } })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectIn label="Page break" value={layout.print.pageBreak} disabled={dis} options={[{ value: "section", label: "Before each section" }, { value: "none", label: "None" }]} onChange={(val) => emit({ ...layout, print: { ...layout.print, pageBreak: val as "section" | "none" } })} />
            <SelectIn label="Paper orientation" value={layout.print.orientation} disabled={dis} options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]} onChange={(val) => emit({ ...layout, print: { ...layout.print, orientation: val as "portrait" | "landscape" } })} />
          </div>
          <Inline errors={issuesUnder(v.errors, "print")} warnings={[]} />
        </Group>
      </div>

      <div className="flex min-w-0 flex-col gap-3" data-layout-preview>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="group" aria-label="Preview size" className="inline-flex overflow-hidden rounded-lg border border-[var(--cmp-app-control-border)]">
            {(["desktop", "tablet", "mobile", "print"] as const).map((p) => (
              <button key={p} type="button" aria-pressed={preview === p} onClick={() => setPreview(p)} className={`${touch} px-4 text-sm font-semibold ${focusRing} ${preview === p ? "bg-[var(--cmp-theme-accent)] text-[var(--cmp-theme-on-accent)]" : "bg-[var(--cmp-app-surface)] text-[var(--cmp-app-text)] hover:bg-[var(--cmp-app-bg)]"}`}>{humanize(p)}</button>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn size="sm" onClick={() => setSample(presetAllSatisfactory(def))}>Fill sample answers</Btn>
            <Btn size="sm" onClick={() => setSample({})}>Clear answers</Btn>
          </div>
        </div>
        <p className={`text-xs ${mutedText}`}>{preview === "print" ? `Print preview, ${layout.print.orientation}. Sample answers are not saved.` : `Preview at ${PREVIEW_WIDTH[preview]} pixels wide. Sample answers are not saved.`}</p>
        <div className="overflow-x-auto rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-3">
          {preview === "print" ? (
            <PrintSheet def={def} layout={layout} responses={sample} metadata={(layout.metadata?.fields ?? []).map((f) => ({ label: f.label, value: previewMetadata?.[f.key] ?? null }))} />
          ) : (
            <div className="mx-auto" style={{ width: "100%", maxWidth: PREVIEW_WIDTH[preview] }} data-preview-width={PREVIEW_WIDTH[preview]}>
              <AssessmentRunner
                def={def} layout={layout} responses={sample} onChange={(next) => setSample(next)} rules={rules} breakpoint={emulated}
                mode={stepper ? "guided" : "standard"} modeSwitch={false} metadata={previewMetadata} context={previewContext}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
