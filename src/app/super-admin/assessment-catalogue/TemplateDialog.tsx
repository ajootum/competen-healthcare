"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import type { Family } from "@/lib/assessment/catalogue/families";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { TemplateChoice } from "@/lib/assessment/catalogue/template";
import ClassificationFields, { type TermChoice } from "./ClassificationFields";
import { BASE, CodeChip, btnGhost, btnPrimary, callApi, input } from "./ui";

// Create from template (registration option 3): a new identity whose first Draft copies a PUBLISHED instrument's content,
// settings, scoring, layouts and tags. The copy keeps an "adapted from" relation to its source. Same governance afterwards.
export default function TemplateDialog({ families, taxonomy, canAuthor, onClose, onBack }: { families: Family[]; taxonomy: TaxonomyDimension[]; canAuthor: boolean; onClose: () => void; onBack: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, onClose);
  const active = families.filter(f => f.isActive);
  const [templates, setTemplates] = useState<TemplateChoice[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("");
  const [family, setFamily] = useState(active[0]?.code ?? "");
  const [description, setDescription] = useState("");
  const [terms, setTerms] = useState<TermChoice[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ instrumentId: string; code: string; versionId: string; warnings: string[] } | null>(null);
  const chosen = templates?.find(t => t.versionId === templateId) ?? null;

  useEffect(() => {
    let live = true;
    fetch("/api/hq/assessment-catalogue/templates").then(r => r.json()).then(j => { if (!live) return; if (Array.isArray(j.templates)) setTemplates(j.templates); else setLoadError(String(j.error ?? "The templates could not be loaded.")); }).catch(() => live && setLoadError("The templates could not be loaded."));
    return () => { live = false; };
  }, []);
  // Choosing a template proposes a title and its family, once, without an effect.
  const pick = (versionId: string) => {
    setTemplateId(versionId);
    const t = templates?.find(x => x.versionId === versionId);
    if (t && !title) setTitle(`${t.name} (copy)`);
    if (t?.familyCode && active.some(f => f.code === t.familyCode)) setFamily(t.familyCode);
  };

  async function save() {
    setBusy(true); setError(null);
    const r = await callApi("/api/hq/assessment-catalogue/templates", { templateVersionId: templateId, family, name: title, description, terms });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setMade(r.json as unknown as { instrumentId: string; code: string; versionId: string; warnings: string[] });
    router.refresh();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-teal-950/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="tpl-title" tabIndex={-1} className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="tpl-title" className="text-lg font-bold text-gray-900">Create from template</h2>
            <p className="mt-0.5 text-[12.5px] text-gray-700">A new instrument with its own code. Its first Draft copies the published version you choose, and the catalogue records where it came from.</p>
          </div>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close">{"×"}</button>
        </div>
        {made ? (
          <div className="space-y-3 px-5 py-4">
            <p className="text-[14px] text-gray-900"><CodeChip code={made.code} /> <b>{title}</b> is registered as a Draft, adapted from {chosen?.code}.</p>
            {made.warnings.length > 0 && <ul className="list-disc pl-5 text-[12.5px] text-amber-900">{made.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
            <div className="flex flex-wrap gap-2">
              <a className={btnPrimary} href={`/super-admin/checklist-studio/${made.instrumentId}`}>Open in Checklist Studio</a>
              <button type="button" className={btnGhost} onClick={() => { router.push(`${BASE}?i=${made.instrumentId}`, { scroll: false }); onClose(); }}>Show in the catalogue</button>
            </div>
          </div>
        ) : (
          <form className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" onSubmit={e => { e.preventDefault(); void save(); }}>
            {!canAuthor && <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-950">Creating from a template needs catalogue management or Checklist authoring, held through an appointment.</p>}
            <label className="block text-[12.5px] font-semibold text-gray-800">Template (a published instrument)
              <select className={`${input} mt-1`} value={templateId} onChange={e => pick(e.target.value)} required disabled={!templates}>
                <option value="">{templates === null ? (loadError ?? "Loading…") : templates.length ? "Choose a template" : "No published instrument exists yet"}</option>
                {(templates ?? []).map(t => <option key={t.versionId} value={t.versionId}>{t.code} · {t.name} (v{t.versionNo}, {t.items} item{t.items === 1 ? "" : "s"})</option>)}
              </select>
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-800">Title of the new instrument
              <input className={`${input} mt-1`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required />
            </label>
            <label className="block text-[12.5px] font-semibold text-gray-800">Family
              <select className={`${input} mt-1`} value={family} onChange={e => setFamily(e.target.value)} required>
                {active.map(f => <option key={f.code} value={f.code}>{f.label} ({f.code})</option>)}
              </select>
            </label>
            <ClassificationFields taxonomy={taxonomy} value={terms} onChange={setTerms} />
            <label className="block text-[12.5px] font-semibold text-gray-800">Description
              <textarea className={`${input} mt-1`} rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} />
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
            <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
              <button type="button" className={btnGhost} onClick={onBack}>Back</button>
              <div className="flex gap-2">
                <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
                <button type="submit" className={btnPrimary} disabled={busy || !canAuthor || !templateId || title.trim().length < 3 || !family}>{busy ? "Creating…" : "Create Draft from template"}</button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
