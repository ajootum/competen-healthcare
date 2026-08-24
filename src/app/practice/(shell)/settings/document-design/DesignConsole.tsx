"use client";

import { useMemo, useRef, useState } from "react";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import { DocumentBody } from "@/components/practice/DocumentBody";
import { PREVIEW_DOCUMENTS, CERTIFICATE_PREVIEW_ABSENT, previewDocument, type PreviewKey } from "@/lib/practice/document-preview";
import {
  BODY_FONTS, BODY_SIZE_RANGE, BORDER_STYLES, DENSITIES, FOOTER_STYLES, HEADING_CASES,
  HEADING_SIZE_RANGE, PATIENT_BLOCKS, PRESETS, SECTION_ROLES, SECTION_TREATMENTS,
  contrastRatio, presetTokens, validateTokens, HIDEABLE_CATEGORIES, LOCKED_LAYOUT_NOTICE,
  isLayoutLocked, type PresetName, type SectionRole, type StyleTokens,
} from "@/lib/practice/document-style";
import type { FactCategory } from "@/lib/practice/document-facts";
import type { StyleSummary } from "@/lib/practice/document-design";

// CPR-DOC-CONFIG-001 sections 3, 4, 16 and 17 -- THE ONE-GO DOCUMENT DESIGNER.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// CONFIGURE ONCE, SEE IT IMMEDIATELY, PUBLISH ONCE. Section 1's intent: "analogous to configuring
// Practice letterhead: make the choices once, see the result immediately, save them, and allow CP to
// render future generated documents consistently."
//
// THE PREVIEW IS THE REAL DOCUMENT. It calls the same composers that generate letters and the same
// renderer the print view uses -- so what a practitioner tunes here is what comes out, and section 15's
// preview/print/PDF parity is a property of the wiring rather than a promise. It is fed synthetic data
// and cannot reach a patient record (section 4).
//
// PLAIN LANGUAGE, NOT TOKENS (section 16). Every control below is labelled the way a practitioner would
// describe it -- "Section heading style", not "sectionTreatment". The token names exist in the payload
// and nowhere on the screen.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

const field = "min-h-[var(--cp-touch)] w-full rounded-lg border border-gray-200 px-2.5 text-[13px] text-gray-800";
const label = "text-[11px] font-bold uppercase tracking-wide text-gray-400";

const PRESET_BLURB: Record<string, string> = {
  professional: "The Competen default. Clean hierarchy with soft section bands.",
  classic: "Conservative correspondence. Serif body, no bands, traditional headings.",
  modern: "Crisp spacing, stronger headings, an accent rule instead of a band.",
  minimal: "Mostly monochrome. Headings and dividers rather than colour.",
  practice_brand: "Your own colours, kept within safe contrast.",
};

const ROLE_LABEL: Record<string, string> = {
  purpose: "Purpose / reason", diagnosis: "Diagnoses", treatment: "Treatment",
  medication: "Medication", investigation: "Investigations", follow_up: "Follow-up",
  plan: "Plan / recommendations", additional: "Additional information",
};

const TREATMENT_LABEL: Record<string, string> = {
  band: "Colour band behind the heading", left_accent: "Coloured rule down the left",
  plain: "Plain heading, no colour", card: "Card (coming with the next release)",
  divider: "Divider (coming with the next release)",
};

const DENSITY_LABEL: Record<string, string> = {
  compact: "Compact", standard: "Standard", relaxed: "Relaxed",
};

// s16: plain language. A practitioner reorders "Diagnoses", not a FactCategory.
const SECTION_LABEL: Record<string, string> = {
  encounter: "Consultation context", diagnosis: "Diagnoses", procedure: "Procedures",
  investigation: "Investigations", treatment: "Treatment", medication: "Medication",
  follow_up: "Follow-up",
};

const FONT_LABEL: Record<string, string> = {
  inter: "Inter (sans serif)", source_serif: "Source Serif (serif)", system: "System default",
};

export default function DesignConsole(props: {
  styles: StyleSummary[];
  initialTokens: StyleTokens;
  initialId: string | null;
  canManage: boolean;
}) {
  const [tokens, setTokens] = useState<StyleTokens>(props.initialTokens);
  const [styleId, setStyleId] = useState<string | null>(props.initialId);
  // Not editable yet -- the designer names a style when Phase 3 introduces more than one at a time.
  const name = "Practice style";
  const [previewKey, setPreviewKey] = useState<PreviewKey>("referral_letter");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // CPR-PUI a11y: focus into the confirmation, Tab held inside it, focus restored on close, and
  // Escape handled by the hook. A publish dialog a keyboard user cannot reach is a publish dialog
  // they dismiss by guessing.
  const confirmPanel = useRef<HTMLDivElement>(null);
  useModalFocus(confirming, confirmPanel, () => setConfirming(false));

  // ⚠ THE SAME VALIDATOR THE SERVER USES, RUN AS YOU TYPE. Section 16: "Warn when a chosen combination
  // reduces readability or contrast below the product accessibility threshold." A warning that only
  // appeared on save would let somebody spend ten minutes on a palette and be refused at the end.
  const problems = useMemo(() => validateTokens(tokens), [tokens]);
  const doc = useMemo(() => previewDocument(previewKey), [previewKey]);

  const set = (patch: (t: StyleTokens) => StyleTokens) => { setTokens(patch); setNotice(null); };
  const setColour = (k: keyof StyleTokens["colour"], v: string) =>
    set(t => ({ ...t, colour: { ...t.colour, [k]: v } }));
  const setRole = (role: SectionRole, part: "band" | "accent", v: string) =>
    set(t => ({
      ...t,
      colour: { ...t.colour, roles: { ...t.colour.roles, [role]: { ...t.colour.roles[role], [part]: v } } },
    }));
  // s7. Reordering is a permutation, never an insert or a delete -- the validator refuses an order
  // that drops or repeats a section, so a control that could produce one would only ever be refused.
  const moveSection = (from: number, delta: number) => set(t => {
    const order = [...t.structure.sectionOrder];
    const to = from + delta;
    if (to < 0 || to >= order.length) return t;
    [order[from], order[to]] = [order[to], order[from]];
    return { ...t, structure: { ...t.structure, sectionOrder: order } };
  });

  const toggleHidden = (cat: FactCategory) => set(t => ({
    ...t,
    structure: {
      ...t.structure,
      hidden: t.structure.hidden.includes(cat)
        ? t.structure.hidden.filter(c => c !== cat)
        : [...t.structure.hidden, cat],
    },
  }));

  const setType = (k: keyof StyleTokens["typography"], v: unknown) =>
    set(t => ({ ...t, typography: { ...t.typography, [k]: v } as StyleTokens["typography"] }));
  const setLayout = (k: keyof StyleTokens["layout"], v: unknown) =>
    set(t => ({ ...t, layout: { ...t.layout, [k]: v } as StyleTokens["layout"] }));

  const post = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try {
      const res = await fetch("/api/v1/practice/document-style", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: "err", text: json?.error?.message ?? "That did not work." }); return null; }
      return json;
    } catch { setNotice({ kind: "err", text: "That did not work." }); return null; }
    finally { setBusy(false); }
  };

  const saveDraft = async () => {
    const json = await post({ action: "save", id: styleId, name, tokens });
    if (!json) return;
    setStyleId(json.id);
    setNotice({ kind: "ok", text: json.forked
      ? "Saved as a new draft. The published style is unchanged until you publish this one."
      : "Draft saved. Nothing generated for patients has changed yet." });
  };

  const publish = async () => {
    let id = styleId;
    if (!id) { const saved = await post({ action: "save", name, tokens }); if (!saved) return; id = saved.id; setStyleId(id); }
    const json = await post({ action: "publish", id });
    if (!json) return;
    setConfirming(false);
    setNotice({ kind: "ok", text: `Published as version ${json.version}. Documents generated from now on use it.` });
  };

  const applyPreset = async (preset: string) => {
    const json = await post({ action: "preset", preset });
    if (!json) return;
    setStyleId(json.id);
    // Computed here rather than read back: presetTokens is pure and shared with the server, so the
    // preview updates on the same tick instead of after a round trip.
    setTokens(presetTokens(preset as PresetName));
    setNotice({ kind: "ok", text: "Theme applied as a draft. Adjust anything you like, then publish." });
  };

  const published = props.styles.find(s => s.status === "published");

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,380px)_1fr]">
      {/* ── THE CONTROLS ──────────────────────────────────────────────────────────────────────── */}
      {/* min-w-0 on both tracks: either column can hold something wider than its share (a long
          destination name here, the document preview opposite), and without it the PAGE scrolls
          sideways instead of the element. */}
      <div className="flex min-w-0 flex-col gap-3">
        {!props.canManage && (
          <p role="status" className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-[12px] text-gray-600">
            You can see the practice document style here, but changing it needs the practice settings
            permission.
          </p>
        )}

        {/* Section 5's presets, first, because most practitioners will stop here. */}
        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <p className={label}>Start from a theme</p>
          <div className="mt-2 flex flex-col gap-1.5">
            {PRESETS.map(p => (
              <button key={p} type="button" disabled={!props.canManage || busy}
                onClick={() => applyPreset(p)}
                className="min-h-[var(--cp-touch)] rounded-lg border border-gray-200 px-2.5 py-1.5 text-left hover:bg-gray-50 disabled:opacity-40">
                <span className="block text-[12.5px] font-semibold capitalize text-gray-800">{p.replace(/_/g, " ")}</span>
                <span className="block text-[11px] leading-snug text-gray-500">{PRESET_BLURB[p]}</span>
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-gray-500">
            A theme is a starting point, not a lock. Change anything afterwards.
          </p>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <p className={label}>Section heading style</p>
          <select aria-label="Section heading style" value={tokens.layout.sectionTreatment} disabled={!props.canManage}
            onChange={e => setLayout("sectionTreatment", e.target.value)} className={`mt-1 ${field}`}>
            {SECTION_TREATMENTS.map(v => <option key={v} value={v}>{TREATMENT_LABEL[v]}</option>)}
          </select>

          <p className={`${label} mt-3`}>Heading capitals</p>
          <select aria-label="Heading capitals" value={tokens.typography.headingCase} disabled={!props.canManage}
            onChange={e => setType("headingCase", e.target.value)} className={`mt-1 ${field}`}>
            {HEADING_CASES.map(v => <option key={v} value={v}>{v === "uppercase" ? "UPPERCASE" : "Title Case"}</option>)}
          </select>

          <p className={`${label} mt-3`}>Space between sections</p>
          <select aria-label="Space between sections" value={tokens.layout.sectionSpacing} disabled={!props.canManage}
            onChange={e => setLayout("sectionSpacing", e.target.value)} className={`mt-1 ${field}`}>
            {DENSITIES.map(v => <option key={v} value={v}>{DENSITY_LABEL[v]}</option>)}
          </select>
        </section>

        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <p className={label}>Text</p>
          <select aria-label="Body typeface" value={tokens.typography.bodyFont} disabled={!props.canManage}
            onChange={e => setType("bodyFont", e.target.value)} className={`mt-1 ${field}`}>
            {BODY_FONTS.map(v => <option key={v} value={v}>{FONT_LABEL[v]}</option>)}
          </select>

          <label htmlFor="body-size" className={`${label} mt-3 block`}>
            Body text size — {tokens.typography.bodySize}px
          </label>
          <input id="body-size" type="range" disabled={!props.canManage}
            min={BODY_SIZE_RANGE.min} max={BODY_SIZE_RANGE.max} value={tokens.typography.bodySize}
            onChange={e => setType("bodySize", Number(e.target.value))} className="mt-1 w-full" />

          <label htmlFor="heading-size" className={`${label} mt-2 block`}>
            Heading size — {tokens.typography.headingSize}px
          </label>
          <input id="heading-size" type="range" disabled={!props.canManage}
            min={HEADING_SIZE_RANGE.min} max={HEADING_SIZE_RANGE.max} value={tokens.typography.headingSize}
            onChange={e => setType("headingSize", Number(e.target.value))} className="mt-1 w-full" />

          <p className={`${label} mt-3`}>Line spacing</p>
          <select aria-label="Line spacing" value={tokens.typography.lineSpacing} disabled={!props.canManage}
            onChange={e => setType("lineSpacing", e.target.value)} className={`mt-1 ${field}`}>
            {DENSITIES.map(v => <option key={v} value={v}>{DENSITY_LABEL[v]}</option>)}
          </select>
        </section>

        {/* ── s7: SECTION ORDER AND VISIBILITY ────────────────────────────────────────────── */}
        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <p className={label}>Order of sections</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
            The order every generated document follows. A section with nothing recorded in it is left
            out automatically.
          </p>
          <ul className="mt-2 flex flex-col gap-1">
            {tokens.structure.sectionOrder.map((cat, i) => {
              const hidden = tokens.structure.hidden.includes(cat);
              const canHide = HIDEABLE_CATEGORIES.includes(cat);
              return (
                <li key={cat} className="flex items-center gap-1.5 rounded-lg border border-gray-100 px-2 py-1">
                  <span className={`flex-1 text-[12px] ${hidden ? "text-gray-400 line-through" : "text-gray-800"}`}>
                    {SECTION_LABEL[cat]}
                  </span>
                  <button type="button" aria-label={`Move ${SECTION_LABEL[cat]} up`}
                    disabled={!props.canManage || i === 0} onClick={() => moveSection(i, -1)}
                    className="min-h-[var(--cp-touch)] px-1.5 text-[13px] text-gray-500 disabled:opacity-25">
                    &uarr;
                  </button>
                  <button type="button" aria-label={`Move ${SECTION_LABEL[cat]} down`}
                    disabled={!props.canManage || i === tokens.structure.sectionOrder.length - 1}
                    onClick={() => moveSection(i, 1)}
                    className="min-h-[var(--cp-touch)] px-1.5 text-[13px] text-gray-500 disabled:opacity-25">
                    &darr;
                  </button>
                  {canHide ? (
                    <button type="button" disabled={!props.canManage} onClick={() => toggleHidden(cat)}
                      className="min-h-[var(--cp-touch)] px-1 text-[11px] font-semibold text-[var(--cp-primary-deep)]">
                      {hidden ? "Show" : "Hide"}
                    </button>
                  ) : (
                    /* s7: clinical disclosure is chosen when the document is written, never hidden by a
                       theme. Saying so where somebody looks for the control beats leaving them to
                       wonder why only one section has it. */
                    <span className="px-1 text-[10.5px] text-gray-400" title="Choose what to include when you write the document">
                      always shown
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">
            {LOCKED_LAYOUT_NOTICE} for certificates and other statutory forms &mdash; they keep the
            layout their template prescribes, and take only your colours and type.
          </p>
        </section>

        {/* Section 16: "Keep advanced controls collapsed by default." */}
        <section className="rounded-xl border border-gray-100 bg-white p-3">
          <button type="button" onClick={() => setShowAdvanced(v => !v)}
            className="min-h-[var(--cp-touch)] text-[12.5px] font-semibold text-[var(--cp-primary-deep)]">
            {showAdvanced ? "Hide section colours" : "Section colours"}
          </button>
          {showAdvanced && (
            <div className="mt-2 flex flex-col gap-2">
              <p className="text-[11px] leading-relaxed text-gray-500">
                Each kind of section has its own colour, so every document uses the same one for the same
                thing. The heading must stay readable on its band — anything too faint is refused.
              </p>
              {SECTION_ROLES.map(role => {
                const tone = tokens.colour.roles[role];
                const ratio = contrastRatio(tone.accent, tone.band);
                return (
                  <div key={role} className="flex items-center gap-2">
                    <span className="flex-1 text-[12px] text-gray-700">{ROLE_LABEL[role]}</span>
                    <input aria-label={`${ROLE_LABEL[role]} band colour`} type="color" value={tone.band}
                      disabled={!props.canManage} onChange={e => setRole(role, "band", e.target.value.toUpperCase())}
                      className="h-7 w-9 rounded border border-gray-200" />
                    <input aria-label={`${ROLE_LABEL[role]} heading colour`} type="color" value={tone.accent}
                      disabled={!props.canManage} onChange={e => setRole(role, "accent", e.target.value.toUpperCase())}
                      className="h-7 w-9 rounded border border-gray-200" />
                    <span className={`w-14 text-right text-[11px] tabular-nums ${ratio < 4.5 ? "font-bold text-[var(--cmp-text-critical)]" : "text-gray-400"}`}>
                      {ratio.toFixed(1)}:1
                    </span>
                  </div>
                );
              })}
              <div className="mt-1 flex items-center gap-2">
                <span className="flex-1 text-[12px] text-gray-700">Main text colour</span>
                <input aria-label="Main text colour" type="color" value={tokens.colour.text}
                  disabled={!props.canManage} onChange={e => setColour("text", e.target.value.toUpperCase())}
                  className="h-7 w-9 rounded border border-gray-200" />
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[12px] text-gray-700">Borders and rules</span>
                <select aria-label="Borders and rules" value={tokens.layout.borders} disabled={!props.canManage}
                  onChange={e => setLayout("borders", e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                  {BORDER_STYLES.map(v => <option key={v} value={v}>{v === "none" ? "None" : v === "subtle" ? "Subtle" : "Accent"}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[12px] text-gray-700">Patient details</span>
                <select aria-label="Patient details block" value={tokens.layout.patientBlock} disabled={!props.canManage}
                  onChange={e => setLayout("patientBlock", e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                  {PATIENT_BLOCKS.map(v => <option key={v} value={v}>{v === "row" ? "One line" : "Soft card"}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="flex-1 text-[12px] text-gray-700">Footer</span>
                <select aria-label="Footer style" value={tokens.layout.footerStyle} disabled={!props.canManage}
                  onChange={e => setLayout("footerStyle", e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-[12px]">
                  {FOOTER_STYLES.map(v => <option key={v} value={v}>{v === "minimal" ? "Minimal" : "With a rule"}</option>)}
                </select>
              </div>
            </div>
          )}
        </section>

        {/* Section 16's readability warning, live. */}
        {problems.length > 0 && (
          <div role="alert" className="rounded-xl border border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] p-2.5">
            <p className="text-[12px] font-semibold text-[var(--cmp-text-critical)]">
              This cannot be published yet
            </p>
            <ul className="mt-1 list-disc pl-4 text-[11.5px] leading-relaxed text-[var(--cmp-text-critical)]">
              {problems.map((p, i) => <li key={i}>{p.message}</li>)}
            </ul>
          </div>
        )}

        {notice && (
          <p role="status" className={`rounded-lg p-2.5 text-[12px] ${notice.kind === "ok" ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-[var(--cmp-text-critical)]"}`}>
            {notice.text}
          </p>
        )}

        <div className="flex flex-col gap-1.5">
          <button type="button" disabled={!props.canManage || busy || problems.length > 0} onClick={saveDraft}
            className="min-h-[var(--cp-touch)] rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700 disabled:opacity-40">
            Save draft
          </button>
          <button type="button" disabled={!props.canManage || busy || problems.length > 0}
            onClick={() => setConfirming(true)}
            className="min-h-[var(--cp-touch)] rounded-lg bg-[var(--cp-primary-deep)] px-3 text-[13px] font-bold text-white disabled:opacity-40">
            Publish document style
          </button>
          <p className="text-[11px] leading-relaxed text-gray-500">
            Saving a draft changes nothing patients see. Publishing sets the style for documents generated
            from then on.
          </p>
        </div>
      </div>

      {/* ── THE PREVIEW ───────────────────────────────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {PREVIEW_DOCUMENTS.map(d => (
            <button key={d.key} type="button" onClick={() => setPreviewKey(d.key)}
              className={`min-h-[var(--cp-touch)] rounded-lg border px-2.5 text-[11.5px] font-semibold ${
                previewKey === d.key
                  ? "border-[var(--cp-primary-deep)] bg-[var(--cp-primary-deep)] text-white"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50"}`}>
              {d.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">
          A worked example, not a real patient. {CERTIFICATE_PREVIEW_ABSENT}
        </p>
        {isLayoutLocked(previewKey) && (
          <p role="status" className="rounded-lg bg-gray-100 px-2.5 py-1.5 text-[11.5px] font-semibold text-gray-700">
            {LOCKED_LAYOUT_NOTICE} &mdash; this type keeps its prescribed layout.
          </p>
        )}

        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-1 text-[15px] font-bold" style={{ color: tokens.colour.text }}>{doc.title}</h2>
          <DocumentBody blocks={doc.blocks} body={doc.body} tokens={tokens} />
        </div>
      </div>

      {/* ── SECTION 17's PUBLISH CONFIRMATION ─────────────────────────────────────────────────── */}
      {confirming && (
        <>
          <button type="button" aria-label="Cancel publishing" onClick={() => setConfirming(false)}
            className="fixed inset-0 z-40 cursor-default bg-black/40" />
          <div ref={confirmPanel} role="dialog" aria-modal="true" aria-label="Publish document style"
            className="fixed inset-x-0 bottom-0 z-50 rounded-t-2xl border-t border-gray-200 bg-white p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] md:inset-0 md:m-auto md:h-fit md:max-w-md md:rounded-2xl md:border md:p-5 md:pb-5 md:shadow-xl">
            <h3 className="text-[15px] font-bold text-gray-900">Publish document style</h3>
            <dl className="mt-2 flex flex-col gap-2 text-[12px] leading-relaxed">
              <div>
                <dt className="font-semibold text-gray-800">What changes</dt>
                <dd className="text-gray-600">
                  Documents generated from now on use this style. Referral letters, visit summaries,
                  patient instructions, clinical summaries, investigation requests, follow-up
                  instructions and medication lists all inherit it.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800">What does not change</dt>
                <dd className="text-gray-600">
                  Documents you have already signed or issued keep the appearance they were issued with.
                  Publishing never repaints them.
                </dd>
              </div>
              <div>
                <dt className="font-semibold text-gray-800">Exceptions</dt>
                <dd className="text-gray-600">
                  Certificates and other statutory forms are not generated by this product yet, so
                  nothing here applies to them.
                </dd>
              </div>
              {published && (
                <div>
                  <dt className="font-semibold text-gray-800">Replacing</dt>
                  <dd className="text-gray-600">
                    Version {published.version} is kept, so you can go back to it.
                  </dd>
                </div>
              )}
            </dl>
            <div className="mt-3 flex flex-col gap-1.5">
              <button type="button" disabled={busy} onClick={publish}
                className="min-h-[var(--cp-touch)] rounded-lg bg-[var(--cp-primary-deep)] px-3 text-[13px] font-bold text-white disabled:opacity-40">
                {busy ? "Publishing…" : "Publish document style"}
              </button>
              <button type="button" onClick={() => setConfirming(false)}
                className="min-h-[var(--cp-touch)] rounded-lg border border-gray-200 px-3 text-[13px] font-semibold text-gray-700">
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
