"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { TaxonomyDimension, Term } from "@/lib/assessment/catalogue/classify";
import { childrenOf, termPath, topLevel } from "@/lib/assessment/catalogue/hierarchy";
import { DIMENSION_HELP } from "@/lib/assessment/catalogue/shape";
import { Chip, btnGhost, input } from "./ui";

/**
 * The hierarchical, configurable classification of an instrument (ASMT-CATALOGUE-IMPORT-01, section on classification).
 * One component for registering, importing, creating from a template and editing: the catalogue cannot classify differently
 * in two places. Everything shown is READ from the taxonomy rows, so an administrator adds an axis or a term in Terms
 * and it appears here without a deployment. Nothing names a profession.
 *
 * Progressive disclosure: the primary domain (parent, then subdomain) and the method are always shown. Related domains,
 * profession, specialty, clinical context, population, qualification level, purpose, keywords and any further axis sit
 * behind "More classification". Every picker is searchable and sized for a tablet.
 */
export type TermChoice = { termId: string; isPrimary: boolean };

type Props = {
  taxonomy: TaxonomyDimension[];
  value: TermChoice[];
  onChange: (next: TermChoice[]) => void;
  /** open the disclosure from the start (editing an already classified instrument) */
  expanded?: boolean;
};

const ALWAYS = ["domain", "method"];
const MORE_ORDER = ["profession", "specialty", "setting", "population", "level", "purpose", "keyword"];

export default function ClassificationFields({ taxonomy, value, onChange, expanded = false }: Props) {
  const [more, setMore] = useState(expanded);
  const dims = taxonomy.filter((d) => d.isActive);
  const dim = (code: string) => dims.find((d) => d.code === code) ?? null;
  const chosen = (code: string) => value.filter((v) => dim(code)?.terms.some((t) => t.id === v.termId));
  const set = (code: string, next: TermChoice[]) => {
    const others = value.filter((v) => !dim(code)?.terms.some((t) => t.id === v.termId));
    onChange([...others, ...next]);
  };

  // Domain: a top-level term, optionally a subdomain under it. The primary is the deepest chosen; the parent is carried
  // as a plain term so a search on the parent still finds the instrument.
  const domain = dim("domain");
  const domainTerms = domain?.terms.filter((t) => t.isActive) ?? [];
  const primary = chosen("domain").find((v) => v.isPrimary) ?? null;
  const primaryTerm = primary ? domainTerms.find((t) => t.id === primary.termId) ?? null : null;
  const topId = primaryTerm ? (primaryTerm.parentId ? rootOf(primaryTerm, domainTerms).id : primaryTerm.id) : "";
  const subId = primaryTerm && primaryTerm.parentId ? primaryTerm.id : "";
  const related = chosen("domain").filter((v) => !v.isPrimary && v.termId !== topId);
  const setDomain = (top: string, sub: string) => {
    const keep = related.filter((v) => v.termId !== top && v.termId !== sub);
    const next: TermChoice[] = [];
    if (sub) next.push({ termId: sub, isPrimary: true }, { termId: top, isPrimary: false });
    else if (top) next.push({ termId: top, isPrimary: true });
    set("domain", [...next, ...keep]);
  };
  const subdomains = topId ? childrenOf(topId, domainTerms) : [];

  const method = dim("method");
  const methodChosen = chosen("method")[0]?.termId ?? "";

  const moreDims = [...MORE_ORDER.map(dim).filter((d): d is TaxonomyDimension => !!d), ...dims.filter((d) => !ALWAYS.includes(d.code) && !MORE_ORDER.includes(d.code))];
  const moreCount = related.length + moreDims.reduce((n, d) => n + chosen(d.code).length, 0);

  return (
    <div className="space-y-3">
      {domain && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-[12.5px] font-semibold text-gray-800">Primary domain
            <select className={`${input} mt-1`} value={topId} onChange={(e) => setDomain(e.target.value, "")}>
              <option value="">Not set</option>
              {topLevel(domainTerms).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <label className="block text-[12.5px] font-semibold text-gray-800">Subdomain
            <select className={`${input} mt-1`} value={subId} disabled={!topId || subdomains.length === 0} onChange={(e) => setDomain(topId, e.target.value)}>
              <option value="">{!topId ? "Choose a domain first" : subdomains.length === 0 ? "No subdomains defined" : "Whole domain"}</option>
              {subdomains.map((t) => <option key={t.id} value={t.id}>{termPath(t, domainTerms).slice(1).join(" / ")}</option>)}
            </select>
          </label>
        </div>
      )}
      {method && (
        <label className="block text-[12.5px] font-semibold text-gray-800">{method.label}
          <select className={`${input} mt-1`} value={methodChosen} onChange={(e) => set("method", e.target.value ? [{ termId: e.target.value, isPrimary: true }] : [])}>
            <option value="">Not set</option>
            {method.terms.filter((t) => t.isActive).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
      )}
      <button type="button" className={`${btnGhost} w-full justify-between sm:w-auto`} aria-expanded={more} onClick={() => setMore((m) => !m)}>
        <span>More classification{moreCount ? ` (${moreCount})` : ""}</span><span aria-hidden="true">{more ? "▴" : "▾"}</span>
      </button>
      {more && (
        <div className="space-y-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          {domain && (
            <TermPicker label="Related domains and topics" hint="Other domains this instrument also covers. The primary domain stays above."
              terms={domainTerms.filter((t) => t.id !== topId && t.id !== subId)} chosen={related.map((v) => v.termId)}
              onChange={(ids) => set("domain", [...chosen("domain").filter((v) => v.isPrimary || v.termId === topId), ...ids.map((termId) => ({ termId, isPrimary: false }))])} />
          )}
          {moreDims.map((d) => (
            <TermPicker key={d.code} label={labelFor(d)} hint={DIMENSION_HELP[d.code]} terms={d.terms.filter((t) => t.isActive)} chosen={chosen(d.code).map((v) => v.termId)}
              onChange={(ids) => set(d.code, ids.map((termId, i) => ({ termId, isPrimary: i === 0 && d.code !== "keyword" })))}
              empty={d.code === "level" ? "No qualification levels are linked yet. They are added in Terms from the programme framework levels." : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

const labelFor = (d: TaxonomyDimension) => (d.code === "level" ? "Qualification applicability" : d.code === "setting" ? "Clinical context / setting" : d.code === "keyword" ? "Keywords" : d.label);

function rootOf(t: Term, all: Term[]): Term {
  let cur = t;
  const seen = new Set<string>();
  while (cur.parentId && !seen.has(cur.id)) { seen.add(cur.id); const p = all.find((x) => x.id === cur.parentId); if (!p) break; cur = p; }
  return cur;
}

/** A searchable multi-select of terms, hierarchy shown as a path. Chips for what is chosen, a list for what can be added. */
export function TermPicker({ label, hint, terms, chosen, onChange, empty }: { label: string; hint?: string; terms: Term[]; chosen: string[]; onChange: (ids: string[]) => void; empty?: string }) {
  const id = useId();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const picked = chosen.map((c) => terms.find((t) => t.id === c)).filter((t): t is Term => !!t);
  const options = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return terms.filter((t) => !chosen.includes(t.id)).map((t) => ({ t, path: termPath(t, terms).join(" / ") }))
      .filter((o) => !needle || o.path.toLowerCase().includes(needle)).slice(0, 12);
  }, [q, terms, chosen]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  const add = (termId: string) => { onChange([...chosen, termId]); setQ(""); };
  return (
    <div ref={box} className="text-[12.5px]">
      <label htmlFor={id} className="block font-semibold text-gray-800">{label}</label>
      {hint && <p className="text-[11.5px] text-gray-600">{hint}</p>}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {picked.map((t) => (
          <Chip key={t.id} tone="neutral">{termPath(t, terms).join(" / ")}
            <button type="button" aria-label={`Remove ${t.label}`} className="rounded px-1 font-bold pointer-coarse:min-h-[var(--cmp-touch-min)]" onClick={() => onChange(chosen.filter((c) => c !== t.id))}>{"×"}</button>
          </Chip>
        ))}
      </div>
      {terms.length === 0 ? <p className="mt-1 text-[12px] text-gray-600">{empty ?? "No terms yet. Add them in Terms."}</p> : (
        <div className="relative mt-1">
          <input id={id} className={input} value={q} placeholder="Search and add" role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
            onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
            onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); if (e.key === "Enter") { e.preventDefault(); if (options[0]) add(options[0].t.id); } }} />
          {open && (
            <ul id={`${id}-list`} role="listbox" className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg">
              {options.length === 0 && <li className="px-3 py-2 text-gray-600">No match{q ? ` for "${q}"` : ""}.</li>}
              {options.map((o) => (
                <li key={o.t.id} role="option" aria-selected={false}>
                  <button type="button" className="block w-full px-3 py-1.5 text-left hover:bg-teal-50 pointer-coarse:min-h-[var(--cmp-touch-min)]" onClick={() => add(o.t.id)}>
                    <span style={{ paddingLeft: `${Math.max(0, termPath(o.t, terms).length - 1) * 10}px` }}>{o.path}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
