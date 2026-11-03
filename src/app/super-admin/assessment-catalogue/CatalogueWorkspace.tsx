"use client";

import { useEffect, useState, useTransition, type MouseEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MORE_FILTERS, SORT_OPTIONS, TABS, hasActiveFilters, hrefFor, moreFiltersActive, withChange,
  type CatalogueQuery, type FilterKey, type SortKey,
} from "@/lib/assessment/catalogue/filters";
import { pageCount, showingLabel, type CatalogueRow } from "@/lib/assessment/catalogue/shape";
import { treeOrder } from "@/lib/assessment/catalogue/hierarchy";
import type { CatalogueStats, SearchResult } from "@/lib/assessment/catalogue/search";
import type { Family } from "@/lib/assessment/catalogue/families";
import type { TaxonomyDimension } from "@/lib/assessment/catalogue/classify";
import type { Collection } from "@/lib/assessment/catalogue/collections";
import type { InstrumentDetail } from "@/lib/assessment/catalogue/detail";
import ClassificationGuide from "./ClassificationGuide";
import InstrumentDrawer from "./InstrumentDrawer";
import InstrumentView from "./InstrumentView";
import RegisterChooser from "./RegisterChooser";
import { BASE, CodeChip, StatusBadge, btnGhost, btnPrimary, callApi, input } from "./ui";

const MORE_LABEL: Record<string, string> = { domain: "Domain", profession: "Profession", specialty: "Specialty", setting: "Context", population: "Population", level: "Level", purpose: "Purpose" };

type Props = {
  query: CatalogueQuery;
  stats: CatalogueStats;
  result: SearchResult;
  families: Family[];
  taxonomy: TaxonomyDimension[];
  productLines: { code: string; name: string }[];
  collections: Collection[];
  referenceKinds: { code: string; label: string }[];
  detail: InstrumentDetail | null;
  canManage: boolean;
  canStudio: boolean;
  canAuthor: boolean;
};

export default function CatalogueWorkspace(p: Props) {
  const { query, stats, result } = p;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [registerOpen, setRegisterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(moreFiltersActive(query.filters) > 0);
  const [search, setSearch] = useState(query.q);

  const go = (q: CatalogueQuery) => startTransition(() => router.push(hrefFor(BASE, q), { scroll: false }));
  const change = (c: Parameters<typeof withChange>[1]) => go(withChange(query, c));
  const setFilter = (k: FilterKey, v: string) => change({ filters: { [k]: v || null } });

  // Search runs after a pause in typing. The URL is the query, so it is also what a link carries.
  useEffect(() => {
    if (search === query.q) return;
    const t = setTimeout(() => go(withChange(query, { q: search })), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // When the URL changes the query from elsewhere (Clear filters, a link), the box follows it.
  const [seenQ, setSeenQ] = useState(query.q);
  if (seenQ !== query.q) { setSeenQ(query.q); setSearch(query.q); }

  const termOptions = (dim: string) => (p.taxonomy.find(d => d.code === dim)?.terms ?? []).filter(t => t.isActive);
  const sel = (k: FilterKey, label: string, options: { value: string; label: string }[], allLabel: string) => (
    <select key={k} aria-label={`Filter by ${label}`} value={query.filters[k] ?? ""} onChange={e => setFilter(k, e.target.value)} className={`${input} !w-auto min-w-[8.5rem]`}>
      <option value="">{allLabel}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );

  const openHref = (id: string) => hrefFor(BASE, withChange(query, { open: id }));
  const open = (id: string) => (e: MouseEvent) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    go(withChange(query, { open: id }));
  };
  const close = () => go(withChange(query, { open: null }));

  const tiles: { label: string; value: number; sub: string }[] = [
    { label: "Registered instruments", value: stats.registered, sub: `across ${stats.familiesUsed} of ${stats.familiesActive} families` },
    { label: "Published", value: stats.published, sub: "latest version is published" },
    { label: "Awaiting review", value: stats.awaitingReview, sub: "latest version is in review" },
    { label: "Connected products", value: stats.connectedProducts, sub: `of ${stats.activeProducts} product lines` },
  ];

  const pages = pageCount(result.total, result.pageSize);
  const offset = (result.page - 1) * result.pageSize;
  const filtered = hasActiveFilters(query);

  return (
    <div aria-busy={pending}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Assessment &amp; Checklist Catalogue</h1>
          <p className="mt-0.5 max-w-2xl text-sm text-gray-700">The Holdings registry of every assessment, audit and checklist: who it is, how it is classified and where it can be found. The content is written in Checklist Studio.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {p.canManage && <Link href="/super-admin/assessment-catalogue/families" className={btnGhost}>Families</Link>}
          {p.canManage && <Link href="/super-admin/assessment-catalogue/terms" className={btnGhost}>Terms</Link>}
          {p.canManage && <button type="button" className={btnPrimary} onClick={() => setRegisterOpen(true)}>Register instrument</button>}
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {tiles.map(t => (
          <div key={t.label} className="rounded-xl border border-gray-100 bg-white p-4">
            <p className="text-2xl font-bold tabular-nums text-gray-900">{t.value.toLocaleString("en-GB")}</p>
            <p className="text-[12.5px] font-semibold text-gray-800">{t.label}</p>
            <p className="text-[11.5px] text-gray-600">{t.sub}</p>
          </div>
        ))}
      </div>

      <nav aria-label="Catalogue sections" className="mb-4 flex flex-wrap gap-1 border-b border-gray-200">
        {TABS.map(t => {
          const on = query.tab === t.value;
          return (
            <button key={t.value} type="button" aria-current={on ? "page" : undefined} onClick={() => change({ tab: t.value })}
              className={`-mb-px border-b-2 px-4 py-2.5 text-[13.5px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "border-teal-700 text-teal-900" : "border-transparent text-gray-700 hover:text-gray-900"}`}>
              {t.label}
            </button>
          );
        })}
      </nav>

      {query.tab === "guide" && <ClassificationGuide taxonomy={p.taxonomy} families={p.families} />}

      {query.tab === "collections" && (
        <CollectionsGrid collections={p.collections} canManage={p.canManage} onOpen={code => go({ ...withChange(query, { tab: "instruments", filters: { collection: code } }) })} />
      )}

      {query.tab === "instruments" && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <input type="search" value={search} onChange={e => setSearch(e.target.value)} aria-label="Search the catalogue"
              placeholder="Search title, code, description, keyword, domain or standard" className={`${input} min-w-[220px] flex-1`} />
            {sel("family", "family", p.families.filter(f => f.isActive).map(f => ({ value: f.code, label: f.label })), "Family: All")}
            {sel("method", "method", termOptions("method").map(t => ({ value: t.code, label: t.label })), "Method: All")}
            {sel("product", "product", p.productLines.map(l => ({ value: l.code, label: l.name })), "Product: All")}
            {sel("status", "status", [
              { value: "none", label: "No version yet" }, { value: "draft", label: "Draft" }, { value: "in_review", label: "In review" },
              { value: "approved", label: "Approved" }, { value: "published", label: "Published" }, { value: "retired", label: "Retired" },
            ], "Status: All")}
            <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(o => !o)} className={btnGhost}>
              More filters{moreFiltersActive(query.filters) ? ` (${moreFiltersActive(query.filters)})` : ""}
            </button>
            {filtered && <button type="button" className="px-2 text-[13px] font-semibold text-teal-800 underline pointer-coarse:min-h-[var(--cmp-touch-min)]" onClick={() => { setSearch(""); go({ ...query, q: "", filters: {}, page: 1 }); }}>Clear filters</button>}
          </div>
          {moreOpen && (
            <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-100 bg-white p-3">
              {MORE_FILTERS.map(k => {
                const dim = p.taxonomy.find(d => d.code === k);
                const label = MORE_LABEL[k] ?? dim?.label ?? k;
                const opts = k === "domain" || k === "specialty"
                  ? treeOrder(termOptions(k)).map(({ term, depth }) => ({ value: term.code, label: `${"  ".repeat(depth)}${term.label}` }))
                  : termOptions(k).map(t => ({ value: t.code, label: t.label }));
                return sel(k, label.toLowerCase(), opts, `${label}: All`);
              })}
              {termOptions("level").length === 0 && <span className="text-[12px] text-gray-600">No level terms yet. They are linked from the programme qualification levels in Terms.</span>}
            </div>
          )}
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px] text-gray-700">
            <p role="status">{showingLabel(result.rows.length, result.total, offset)}{pending ? " · updating…" : ""}</p>
            <label className="flex items-center gap-2">Sort
              <select value={query.sort} onChange={e => change({ sort: e.target.value as SortKey })} className={`${input} !w-auto`} aria-label="Sort the registry">
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          </div>
          <Registry rows={result.rows} openHref={openHref} open={open} empty={filtered
            ? "No instrument matches these filters. Clear a filter or change the search."
            : "No instrument is registered yet. Register the first one to start the catalogue."} />
          {pages > 1 && (
            <div className="mt-3 flex items-center justify-between text-[13px]">
              <button type="button" className={btnGhost} disabled={result.page <= 1} onClick={() => change({ page: result.page - 1 })}>Previous</button>
              <span className="tabular-nums text-gray-700">Page {result.page} of {pages}</span>
              <button type="button" className={btnGhost} disabled={result.page >= pages} onClick={() => change({ page: result.page + 1 })}>Next</button>
            </div>
          )}
        </>
      )}

      {registerOpen && <RegisterChooser families={p.families} taxonomy={p.taxonomy} canAuthor={p.canAuthor} onClose={() => setRegisterOpen(false)} />}
      {p.detail && (
        <InstrumentDrawer onClose={close} label={`${p.detail.code} ${p.detail.name}`}>
          <InstrumentView detail={p.detail} taxonomy={p.taxonomy} collections={p.collections} referenceKinds={p.referenceKinds}
            canManage={p.canManage} canStudio={p.canStudio} layout="drawer" />
        </InstrumentDrawer>
      )}
    </div>
  );
}

function Registry({ rows, openHref, open, empty }: { rows: CatalogueRow[]; openHref: (id: string) => string; open: (id: string) => (e: MouseEvent) => void; empty: string }) {
  if (rows.length === 0) return <div className="rounded-xl border border-gray-100 bg-white px-4 py-12 text-center text-sm text-gray-700">{empty}</div>;
  return (
    <>
      {/* md and up: the table */}
      <div className="hidden overflow-x-auto rounded-xl border border-gray-100 bg-white md:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50 text-[11px] font-bold uppercase tracking-wider text-gray-600">
              <th scope="col" className="px-4 py-3 text-left">Code</th>
              <th scope="col" className="px-3 py-3 text-left">Instrument</th>
              <th scope="col" className="px-3 py-3 text-left">Family</th>
              <th scope="col" className="px-3 py-3 text-left">Method</th>
              <th scope="col" className="px-3 py-3 text-left">Primary domain</th>
              <th scope="col" className="px-3 py-3 text-left">Version</th>
              <th scope="col" className="px-3 py-3 text-left">Status</th>
              <th scope="col" className="px-3 py-3"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(r => (
              <tr key={r.id} onClick={open(r.id)} className="cursor-pointer align-top hover:bg-gray-50/60">
                <td className="px-4 py-3"><CodeChip code={r.code} /></td>
                <td className="max-w-[320px] px-3 py-3">
                  <a href={openHref(r.id)} onClick={open(r.id)} className="block font-semibold text-gray-900 hover:text-teal-800 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">{r.name}</a>
                  {r.sub && <p className="text-[12px] text-gray-600">{r.sub}</p>}
                </td>
                <td className="px-3 py-3 text-[13px] text-gray-800">{r.familyLabel ?? "—"}</td>
                <td className="px-3 py-3 text-[13px] text-gray-800">{r.methods.length ? r.methods.join(", ") : "—"}</td>
                <td className="px-3 py-3 text-[13px] text-gray-800">{r.primaryDomain ?? "—"}</td>
                <td className="px-3 py-3 text-[13px] tabular-nums text-gray-800">{r.version}</td>
                <td className="px-3 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-3 py-3 text-right text-gray-500" aria-hidden="true">{"›"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* below md: cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map(r => (
          <li key={r.id}>
            <a href={openHref(r.id)} onClick={open(r.id)} className="block rounded-xl border border-gray-100 bg-white p-3 pointer-coarse:min-h-[var(--cmp-touch-min)]">
              <div className="flex flex-wrap items-center gap-2"><CodeChip code={r.code} /><StatusBadge status={r.status} /><span className="text-[12px] tabular-nums text-gray-700">{r.version}</span></div>
              <p className="mt-1.5 font-semibold text-gray-900">{r.name}</p>
              {r.sub && <p className="text-[12px] text-gray-600">{r.sub}</p>}
              <p className="mt-1 text-[12px] text-gray-700">{[r.familyLabel, r.methods.join(", "), r.primaryDomain].filter(Boolean).join(" · ")}</p>
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function CollectionsGrid({ collections, canManage, onOpen }: { collections: Collection[]; canManage: boolean; onOpen: (code: string) => void }) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function create() {
    setBusy(true); setError(null);
    const r = await callApi("/api/hq/assessment-catalogue/config", { action: "collection_create", code, name });
    setBusy(false);
    if (!r.ok) { setError(r.error); return; }
    setCode(""); setName(""); router.refresh();
  }
  return (
    <div>
      {collections.length === 0 ? (
        <div className="rounded-xl border border-gray-100 bg-white px-4 py-10 text-center text-sm text-gray-700">No collection yet. A collection is a named list of instruments, such as a pack for a programme or an audit cycle.</div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {collections.map(c => (
            <li key={c.id}>
              <button type="button" onClick={() => onOpen(c.code)} className="h-full w-full rounded-xl border border-gray-100 bg-white p-4 text-left hover:border-teal-300 pointer-coarse:min-h-[var(--cmp-touch-min)]">
                <p className="font-mono text-[11.5px] font-bold text-teal-900">{c.code}</p>
                <p className="mt-0.5 font-semibold text-gray-900">{c.name}{!c.isActive && <span className="ml-2 text-[11px] font-bold text-gray-600">(inactive)</span>}</p>
                {c.description && <p className="mt-1 text-[12.5px] text-gray-700">{c.description}</p>}
                <p className="mt-2 text-[12px] text-gray-700">{c.members} {c.members === 1 ? "instrument" : "instruments"} {"·"} {c.owner}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form className="mt-4 flex flex-wrap items-end gap-2 rounded-xl border border-gray-100 bg-white p-4" onSubmit={e => { e.preventDefault(); void create(); }}>
          <label className="text-[12px] font-semibold text-gray-800">Code
            <input className={`${input} mt-1 uppercase`} value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="NURSING-PACK" maxLength={40} required />
          </label>
          <label className="min-w-[200px] flex-1 text-[12px] font-semibold text-gray-800">Name
            <input className={`${input} mt-1`} value={name} onChange={e => setName(e.target.value)} maxLength={120} required />
          </label>
          <button type="submit" className={btnPrimary} disabled={busy}>New collection</button>
          {error && <p role="alert" className="w-full text-[13px] text-red-900">{error}</p>}
        </form>
      )}
    </div>
  );
}
