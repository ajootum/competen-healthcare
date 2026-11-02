"use client";
// One assessment item: the ItemRow, ItemCard and ItemFocus components of the closed layout vocabulary share this body.
// They differ in density and frame only. A layout slot decides WHERE guidance, expected performance, evidence and
// comment appear (inline or in a disclosure / drawer panel), never whether the item appears.
import { useId, useState } from "react";
import {
  fieldSpec, rkey, validateResponse, PRIMARY,
  type InstrumentItem, type ResponseValue, type Responses, type ViewField, type ViewItem,
} from "@/lib/assessment/core";
import { FieldInput } from "./FieldControls";
import { Btn, Chip, fieldBase, focusRing, humanize, mutedText, touch } from "./ui";

export interface ItemViewProps {
  view: ViewItem;
  item: InstrumentItem;
  number: number;
  responses: Responses;
  onChange: (responseKey: string, next: ResponseValue | null) => void;
  /** container is at least the md edge wide (a prop, not a media query, so a preview can emulate it) */
  wide: boolean;
  disabled?: boolean;
  indicators: { completed: boolean; unassessed: boolean; critical: boolean; missingEvidence: boolean };
  groupLabel?: string | null;
  methodLabels?: Record<string, string>;
  evidenceCount?: number;
  onAttachEvidence?: (itemKey: string) => void;
  renderEvidence?: (itemKey: string) => React.ReactNode;
  comment?: string;
  onCommentChange?: (itemKey: string, text: string) => void;
  renderComment?: (itemKey: string) => React.ReactNode;
  /** "Item x of y" line for a focused (stepper) item */
  position?: string;
}

function Disclosure({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] px-3 py-1 text-sm">
      <summary className={`flex ${touch} cursor-pointer items-center font-semibold text-[var(--cmp-theme-ink)] ${focusRing}`}>{summary}</summary>
      <div className="pb-2 text-[var(--cmp-app-text)]">{children}</div>
    </details>
  );
}

function Drawer({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div>
      <Btn size="sm" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>{label}{count !== undefined ? ` (${count})` : ""}</Btn>
      <div id={id} role="region" aria-label={label} hidden={!open} className="mt-2 rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-3">{children}</div>
    </div>
  );
}

export function ItemView(p: ItemViewProps) {
  const { view, item, onChange, wide, disabled } = p;
  const uid = useId();
  const slots = view.slots;
  const idBase = `${uid}-${view.key}`;
  const titleId = `${idBase}-title`;
  const primarySpec = fieldSpec(item, PRIMARY)!;
  const primaryIssues = validateResponse(item, view.response, PRIMARY).issues;
  const focus = view.component === "ItemFocus";

  const frame = view.component === "ItemRow"
    ? "border-b border-[var(--cmp-app-border)] py-3"
    : view.component === "ItemCard"
      ? "rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-4"
      : "rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-5";
  const accent = view.status.critical ? "border-l-4 border-l-[var(--cmp-color-critical)] pl-3" : "";

  const guidance = view.guidance ? (slots.guidance === "inline" ? <p className={`text-sm ${mutedText}`}>{view.guidance}</p> : <Disclosure summary="Guidance"><p>{view.guidance}</p></Disclosure>) : null;
  const expectedList = view.expected.length ? (
    <ul className="list-disc space-y-0.5 pl-5">{view.expected.map((t, i) => <li key={i}>{t}</li>)}</ul>
  ) : null;
  const expected = expectedList ? (slots.expected === "inline"
    ? <div className="text-sm"><p className={`text-xs font-semibold ${mutedText}`}>Expected performance</p>{expectedList}</div>
    : <Disclosure summary="Expected performance">{expectedList}</Disclosure>) : null;

  const reqs = item.critical_requirements.length ? item.critical_requirements.map(humanize).join(", ") : "";
  const badges = (
    <div className="flex flex-wrap items-center gap-1.5">
      {view.badges.includes("critical") ? <Chip tone="critical" title={reqs || undefined}>Critical</Chip> : null}
      {view.badges.includes("mandatory") ? <Chip tone="info">Required</Chip> : null}
      {view.badges.includes("method") ? item.method_codes.map((m) => <Chip key={m}>{p.methodLabels?.[m] ?? humanize(m)}</Chip>) : null}
      {view.badges.includes("group") && p.groupLabel ? <Chip tone="accent">{p.groupLabel}</Chip> : null}
    </div>
  );

  // status chips
  const st = view.status;
  const chips: React.ReactNode[] = [];
  if (p.indicators.completed && st.complete) chips.push(<Chip key="done" tone="success">Completed</Chip>);
  if (p.indicators.unassessed && st.unassessed) chips.push(<Chip key="un">Not answered</Chip>);
  if (p.indicators.critical && st.criticalFailed) chips.push(<Chip key="cf" tone="critical">Critical item not met</Chip>);
  if (p.indicators.missingEvidence && st.missingEvidence) chips.push(<Chip key="ev" tone="warning">Evidence missing</Chip>);
  if (p.indicators.completed && st.missingFields.length) {
    const names = view.fields.filter((f) => st.missingFields.includes(f.field_key)).map((f) => f.label);
    chips.push(<Chip key="mf" tone="warning">Required: {names.join(", ")}</Chip>);
  }

  const primary = (
    <div className="flex flex-col gap-2">
      {reqs && st.critical ? <p className={`text-xs ${mutedText}`}>{reqs}</p> : null}
      <FieldInput
        spec={primarySpec} control={view.control} value={view.response} idBase={idBase} label={view.prompt} disabled={disabled}
        issues={primaryIssues} onChange={(r) => onChange(rkey(item.stable_key, PRIMARY), r)} evidence={primarySpec.response_type === "evidence" ? { count: p.evidenceCount ?? 0, onAttach: p.onAttachEvidence ? () => p.onAttachEvidence!(view.key) : undefined } : undefined}
      />
    </div>
  );

  const secondary = view.fields.length ? (
    <div className={wide && slots.fields === "grid2" ? "grid grid-cols-2 gap-3" : "flex flex-col gap-3"} data-fields={wide && slots.fields === "grid2" ? "grid2" : "stack"}>
      {view.fields.map((f: ViewField) => {
        const sp = fieldSpec(item, f.field_key)!;
        const fid = `${idBase}-${f.field_key}`;
        const iss = validateResponse(item, f.response, f.field_key).issues;
        const wideField = f.response_type === "free_text" && wide && slots.fields === "grid2";
        return (
          <div key={f.field_key} className={`flex min-w-0 flex-col gap-1 ${wideField ? "col-span-2" : ""}`}>
            <span id={`${fid}-label`} className={`text-xs font-semibold ${mutedText}`}>{f.label}{f.required ? " (required)" : ""}</span>
            <FieldInput spec={sp} control={f.control} value={f.response} idBase={fid} label={f.label} disabled={disabled} issues={iss} onChange={(r) => onChange(rkey(item.stable_key, f.field_key), r)} />
          </div>
        );
      })}
    </div>
  ) : null;

  const needsEvidence = !!item.evidence_requirement && (item.evidence_requirement.required || (item.evidence_requirement.min_count ?? 0) > 0);
  const evidenceBody = (
    <div className="flex flex-col gap-2 text-sm">
      <p className={mutedText}>{p.evidenceCount ?? 0} attached{item.evidence_requirement?.min_count ? `, at least ${item.evidence_requirement.min_count} needed` : ""}.</p>
      {p.onAttachEvidence ? <div><Btn size="sm" disabled={disabled} onClick={() => p.onAttachEvidence!(view.key)}>Attach evidence</Btn></div> : null}
      {p.renderEvidence ? p.renderEvidence(view.key) : null}
    </div>
  );
  const evidenceSlot = needsEvidence || p.renderEvidence ? (slots.evidence === "inline"
    ? <div className="rounded-lg border border-[var(--cmp-app-border)] bg-[var(--cmp-app-bg)] p-3"><p className="mb-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Evidence</p>{evidenceBody}</div>
    : <Drawer label="Evidence" count={p.evidenceCount ?? 0}>{evidenceBody}</Drawer>) : null;

  const commentBody = p.renderComment ? p.renderComment(view.key) : p.onCommentChange ? (
    <textarea aria-label={`Comment on ${item.code}`} value={p.comment ?? ""} disabled={disabled} rows={3} onChange={(e) => p.onCommentChange!(view.key, e.target.value)} className={`${fieldBase} min-h-[5rem]`} />
  ) : null;
  const commentSlot = commentBody ? (slots.comment === "inline"
    ? <div><p className="mb-1 text-xs font-semibold text-[var(--cmp-app-text-secondary)]">Comment</p>{commentBody}</div>
    : <Drawer label="Comment">{commentBody}</Drawer>) : null;

  const responseRight = wide && slots.response === "right" && view.component === "ItemRow";
  const head = (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-start gap-2">
        <span className={`${focus ? "text-sm" : "text-xs"} font-semibold ${mutedText}`}>{p.position ?? `${p.number}.`} {item.code}</span>
        {badges}
      </div>
      <h4 id={titleId} className={`${focus ? "text-lg" : "text-base"} font-semibold leading-snug text-[var(--cmp-app-text)]`}>{view.prompt}</h4>
      {guidance}
      {expected}
      {chips.length ? <div className="flex flex-wrap gap-1.5" data-item-status>{chips}</div> : null}
    </div>
  );

  return (
    <article data-item-key={view.key} data-component={view.component} aria-labelledby={titleId} className={`${frame} ${accent}`}>
      {responseRight ? (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          {head}
          <div className="flex flex-col gap-3">{primary}{secondary}{evidenceSlot}{commentSlot}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">{head}{primary}{secondary}{evidenceSlot}{commentSlot}</div>
      )}
    </article>
  );
}
