"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useModalFocus } from "@/components/ui/use-modal-focus";
import type { Family } from "@/lib/assessment/catalogue/families";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { SimilarInstrument } from "@/lib/assessment/catalogue/similar";
import ClassificationFields, { type TermChoice } from "./ClassificationFields";
import { BASE, CodeChip, btnGhost, btnPrimary, callApi, input } from "./ui";

// Register an instrument: its identity only ("Create new", registration option 1). Title, family, classification and a
// description. The database assigns the next code of the family and creates the master record as a Draft with NO version.
// A duplicate warning shows before saving and never blocks. Content is written next, in Checklist Studio.
export default function RegisterDialog({ families, taxonomy, onClose, onBack }: { families: Family[]; taxonomy: TaxonomyDimension[]; onClose: () => void; onBack?: () => void }) {
  const router = useRouter();
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(true, panel, onClose);
  const active = families.filter(f => f.isActive);
  const [title, setTitle] = useState("");
  const [family, setFamily] = useState(active[0]?.code ?? "");
  const [terms, setTerms] = useState<TermChoice[]>([]);
  const [description, setDescription] = useState("");
  const [similar, setSimilar] = useState<SimilarInstrument[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownSimilar = title.trim().length < 3 ? [] : similar;

  // The duplicate check runs after a pause in typing. A late answer for an old title is ignored.
  useEffect(() => {
    if (title.trim().length < 3) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/hq/assessment-catalogue/similar?title=${encodeURIComponent(title)}&family=${family}`).then(x => x.json()).catch(() => ({}));
      if (live) setSimilar((r.similar ?? []) as SimilarInstrument[]);
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [title, family]);

  async function save() {
    setBusy(true); setError(null);
    const r = await callApi("/api/hq/assessment-catalogue", { family, name: title, description, terms });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    router.push(`${BASE}?i=${r.json.id as string}`, { scroll: false });
    router.refresh();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-teal-950/40 p-4">
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="reg-title" tabIndex={-1} className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div>
            <h2 id="reg-title" className="text-lg font-bold text-gray-900">Create a new instrument</h2>
            <p className="mt-0.5 text-[12.5px] text-gray-700">Creates the master record as a Draft with its permanent code. No content yet: that is written in Checklist Studio.</p>
          </div>
          <button type="button" className={btnGhost} onClick={onClose} aria-label="Close">{"×"}</button>
        </div>
        <form className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" onSubmit={e => { e.preventDefault(); void save(); }}>
          <label className="block text-[12.5px] font-semibold text-gray-800">Title
            <input className={`${input} mt-1`} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} required autoFocus />
          </label>
          {shownSimilar.length > 0 && (
            <div role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-950">
              <p className="font-semibold">Similar instruments already exist.</p>
              <p className="text-[12px]">This is a warning, not a block. Two instruments may share a subject when their family or method differs.</p>
              <ul className="mt-1 space-y-0.5">
                {shownSimilar.map(s => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2">
                    <CodeChip code={s.code} /> <a className="font-semibold underline" href={`${BASE}/${s.id}`} target="_blank" rel="noreferrer">{s.name}</a>
                    <span className="text-[12px]">{s.familyLabel}{s.sameFamily ? " (same family)" : ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <label className="block text-[12.5px] font-semibold text-gray-800">Family
            <select className={`${input} mt-1`} value={family} onChange={e => setFamily(e.target.value)} required>
              {active.map(f => <option key={f.code} value={f.code}>{f.label} ({f.code})</option>)}
            </select>
            <span className="mt-0.5 block text-[11.5px] font-normal text-gray-600">The kind of instrument. It prefixes the permanent code and cannot change afterwards.</span>
          </label>
          <ClassificationFields taxonomy={taxonomy} value={terms} onChange={setTerms} />
          <label className="block text-[12.5px] font-semibold text-gray-800">Description
            <textarea className={`${input} mt-1`} rows={3} value={description} onChange={e => setDescription(e.target.value)} maxLength={2000} />
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
          <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-3">
            <div>{onBack && <button type="button" className={btnGhost} onClick={onBack}>Back</button>}</div>
            <div className="flex gap-2">
              <button type="button" className={btnGhost} onClick={onClose}>Cancel</button>
              <button type="submit" className={btnPrimary} disabled={busy || title.trim().length < 3 || !family}>{busy ? "Registering…" : "Register instrument"}</button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
