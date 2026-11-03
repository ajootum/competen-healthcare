"use client";
// <PrintSheet>: the paper form. Reads only layout.print (guidance, responses, evidenceList, pageBreak, signature,
// orientation) and draws every item of the definition, in order. Used for the Designer's print preview and for a blank
// printable form. Blank answer lines when responses are not printed or not given.
import { fieldSpec, resolveView, PRIMARY, type InstrumentDef, type LayoutDoc, type Responses } from "@/lib/assessment/core";
import { describeResponse } from "./describe";
import { optionsOf } from "./FieldControls";
import { mutedText } from "./ui";

export interface PrintSheetProps {
  def: InstrumentDef;
  layout: LayoutDoc | null | undefined;
  responses?: Responses;
  title?: string;
  metadata?: { label: string; value: string | null }[];
  /** show a dashed rule where a printed page would break (screen preview) */
  showPageBreaks?: boolean;
}

const Box = () => <span aria-hidden className="mr-2 inline-block h-3.5 w-3.5 shrink-0 translate-y-0.5 border border-[var(--cmp-app-text)]" />;
const Line = ({ label }: { label: string }) => (
  <div className="mt-2 flex items-end gap-2 text-xs">
    <span className="shrink-0">{label}</span><span className="h-5 flex-1 border-b border-[var(--cmp-app-text)]" />
  </div>
);

export function PrintSheet({ def, layout, responses = {}, title, metadata, showPageBreaks = true }: PrintSheetProps) {
  const view = resolveView(def, layout, responses, null, { breakpoint: "desktop" });
  const pr = view.print;
  const width = pr.orientation === "landscape" ? 1123 : 794;
  return (
    <div data-print-sheet data-orientation={pr.orientation} className="mx-auto bg-white p-8 text-black" style={{ maxWidth: width, width: "100%" }}>
      <style>{`@media print { @page { size: ${pr.orientation}; } }`}</style>
      <h2 className="text-xl font-semibold">{title ?? def.instrument_code ?? "Assessment"}</h2>
      {metadata?.length ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
          {metadata.map((m) => <div key={m.label}><dt className="text-xs font-semibold">{m.label}</dt><dd>{m.value ?? "______"}</dd></div>)}
        </dl>
      ) : null}
      {view.blocks.map((b, bi) => (
        <section key={b.key} data-print-section style={pr.pageBreak === "section" && bi > 0 ? { breakBefore: "page" } : undefined} className={`mt-6 ${pr.pageBreak === "section" && bi > 0 && showPageBreaks ? "border-t border-dashed border-[var(--cmp-app-control-border)] pt-6" : ""}`}>
          <h3 className="border-b border-black pb-1 text-base font-semibold">{b.title}{b.subtitle ? ` (${b.subtitle})` : ""}</h3>
          {b.items.map((vi) => {
            const item = def.items.find((i) => i.stable_key === vi.key)!;
            const sp = fieldSpec(item, PRIMARY)!;
            const opts = optionsOf(sp);
            const answer = pr.responses ? describeResponse(sp, vi.response) : null;
            return (
              <article key={vi.key} className="break-inside-avoid border-b border-[var(--cmp-app-border)] py-3 text-sm">
                <p className="font-semibold">{item.code} {vi.prompt}{vi.status.critical ? " (critical)" : ""}</p>
                {pr.guidance && vi.guidance ? <p className={`mt-1 text-xs ${mutedText}`}>{vi.guidance}</p> : null}
                {pr.guidance && vi.expected.length ? <ul className="mt-1 list-disc pl-5 text-xs">{vi.expected.map((t, i) => <li key={i}>{t}</li>)}</ul> : null}
                {opts.length ? (
                  <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                    {opts.map((o) => <li key={o.code}><Box />{o.label}{o.description && pr.guidance ? <span className="text-xs"> - {o.description}</span> : null}</li>)}
                  </ul>
                ) : null}
                {answer ? <p className="mt-2"><span className="font-semibold">Answer:</span> {answer}</p> : <Line label="Answer" />}
                {vi.fields.map((f) => (
                  <div key={f.field_key}>{pr.responses && f.response ? <p className="mt-1 text-xs"><span className="font-semibold">{f.label}:</span> {describeResponse(fieldSpec(item, f.field_key)!, f.response)}</p> : <Line label={f.label} />}</div>
                ))}
                {pr.evidenceList && (item.evidence_requirement || item.critical) ? <Line label="Evidence" /> : null}
              </article>
            );
          })}
        </section>
      ))}
      {pr.signature ? (
        <div data-print-signature className="mt-8 grid grid-cols-2 gap-8 text-sm">
          <Line label="Signature" /><Line label="Date" />
        </div>
      ) : null}
    </div>
  );
}
