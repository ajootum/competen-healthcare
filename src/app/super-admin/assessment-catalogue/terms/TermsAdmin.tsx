"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import { forbiddenParents, termPath, treeOrder } from "@/lib/assessment/catalogue/hierarchy";
import { DIMENSION_HELP } from "@/lib/assessment/catalogue/shape";
import { btnGhost, btnPrimary, callApi, input } from "../ui";

const API = "/api/hq/assessment-catalogue/config";

/**
 * The classification terms, by axis, as a tree where the axis allows one (ASMT-CATALOGUE-IMPORT-01, hierarchical and
 * configurable classification). An administrator relabels a term, hides it, moves it under another parent or adds a
 * subterm. The id of a term never changes, so every instrument that carries it keeps it through any of these.
 * Everything here is data: no profession is named in the code.
 */
export default function TermsAdmin({ taxonomy }: { taxonomy: TaxonomyDimension[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [parents, setParents] = useState<Record<string, string>>({});
  const [moving, setMoving] = useState<string | null>(null);

  async function run(body: Record<string, unknown>, after?: () => void) {
    setBusy(true); setError(null);
    const r = await callApi(API, body);
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    after?.();
    router.refresh();
  }
  const clear = (setter: (f: (p: Record<string, string>) => Record<string, string>) => void, key: string) => setter(p => { const n = { ...p }; delete n[key]; return n; });

  return (
    <div className="space-y-5">
      {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-900">{error}</p>}
      {taxonomy.map(d => {
        const tree = treeOrder(d.terms);
        return (
          <section key={d.code} className="rounded-xl border border-gray-100 bg-white">
            <header className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-[15px] font-bold text-gray-900">{d.label} {!d.isActive && <span className="text-[12px] font-semibold text-gray-600">(hidden)</span>}</h2>
                <p className="text-[12px] text-gray-600">{DIMENSION_HELP[d.code] ?? ""}{d.allowsHierarchy ? " Terms can have a parent (subterms)." : " Flat list."} {d.terms.length} term{d.terms.length === 1 ? "" : "s"}.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" className={btnGhost} disabled={busy} onClick={() => run({ action: "dimension_update", code: d.code, allowsHierarchy: !d.allowsHierarchy })}>{d.allowsHierarchy ? "Make flat" : "Allow subterms"}</button>
                <button type="button" className={btnGhost} disabled={busy} onClick={() => run({ action: "dimension_update", code: d.code, isActive: !d.isActive })}>{d.isActive ? "Hide axis" : "Show axis"}</button>
              </div>
            </header>
            <ul className="divide-y divide-gray-50">
              {tree.length === 0 && <li className="px-4 py-3 text-[13px] text-gray-600">No term yet.</li>}
              {tree.map(({ term: t, depth }) => {
                const value = edits[t.id] ?? t.label;
                const forbidden = forbiddenParents(t, d.terms);
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 px-4 py-2" style={{ paddingLeft: `${16 + depth * 22}px` }}>
                    {depth > 0 && <span aria-hidden="true" className="text-gray-400">{"└"}</span>}
                    <input aria-label={`Label of ${termPath(t, d.terms).join(" / ")}`} className={`${input} min-w-[180px] flex-1`} value={value} onChange={e => setEdits(p => ({ ...p, [t.id]: e.target.value }))} maxLength={120} />
                    <span className="font-mono text-[11.5px] text-gray-600">{t.code}</span>
                    {!t.isActive && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold text-gray-700">hidden</span>}
                    {t.sourceKind && <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] font-semibold text-blue-900">linked: {t.sourceKind}</span>}
                    <button type="button" className={btnGhost} disabled={busy || value.trim() === t.label} onClick={() => run({ action: "term_update", termId: t.id, label: value }, () => clear(setEdits, t.id))}>Save</button>
                    <button type="button" className={btnGhost} disabled={busy} aria-pressed={t.isActive} onClick={() => run({ action: "term_update", termId: t.id, isActive: !t.isActive })}>{t.isActive ? "Hide" : "Show"}</button>
                    {d.allowsHierarchy && (moving === t.id ? (
                      <label className="text-[12px] font-semibold text-gray-800">Parent
                        <select aria-label={`Parent of ${t.label}`} className={`${input} ml-1 !w-auto`} value={t.parentId ?? ""} disabled={busy}
                          onChange={e => run({ action: "term_update", termId: t.id, parentId: e.target.value || null }, () => setMoving(null))}>
                          <option value="">None (top level)</option>
                          {d.terms.filter(x => x.isActive && !forbidden.has(x.id)).map(x => <option key={x.id} value={x.id}>{termPath(x, d.terms).join(" / ")}</option>)}
                        </select>
                      </label>
                    ) : (
                      <button type="button" className={btnGhost} disabled={busy} onClick={() => setMoving(t.id)}>{t.parentId ? "Move" : "Move under"}</button>
                    ))}
                    {d.allowsHierarchy && (
                      <button type="button" className={btnGhost} disabled={busy} onClick={() => { setParents(p => ({ ...p, [d.code]: t.id })); document.getElementById(`add-${d.code}`)?.focus(); }}>Add subterm</button>
                    )}
                  </li>
                );
              })}
            </ul>
            <form className="flex flex-wrap items-end gap-2 border-t border-gray-100 px-4 py-3" onSubmit={e => { e.preventDefault(); void run({ action: "term_create", dimensionCode: d.code, label: adding[d.code] ?? "", parentId: parents[d.code] || null, position: d.terms.length * 10 + 10 }, () => { clear(setAdding, d.code); clear(setParents, d.code); }); }}>
              <label className="min-w-[200px] flex-1 text-[12px] font-semibold text-gray-800">New {d.label.toLowerCase()} term
                <input id={`add-${d.code}`} className={`${input} mt-1`} value={adding[d.code] ?? ""} onChange={e => setAdding(p => ({ ...p, [d.code]: e.target.value }))} maxLength={120} required />
              </label>
              {d.allowsHierarchy && d.terms.length > 0 && (
                <label className="text-[12px] font-semibold text-gray-800">Under
                  <select className={`${input} mt-1 !w-auto`} value={parents[d.code] ?? ""} onChange={e => setParents(p => ({ ...p, [d.code]: e.target.value }))}>
                    <option value="">None (top level)</option>
                    {treeOrder(d.terms.filter(t => t.isActive)).map(({ term: t }) => <option key={t.id} value={t.id}>{termPath(t, d.terms).join(" / ")}</option>)}
                  </select>
                </label>
              )}
              <button type="submit" className={btnPrimary} disabled={busy}>Add term</button>
            </form>
          </section>
        );
      })}
    </div>
  );
}
