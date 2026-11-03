/**
 * Assessment catalogue -- the registry's query, parsed from the URL and turned into the arguments of
 * asmt_catalogue_search (migration 894). Pure: no I/O. The URL is the whole query, so a link reopens the same view.
 *
 * Everything that reaches the database is a code (letters, digits, underscore, hyphen) or a short free text for the
 * owner. Anything else is dropped rather than passed on, so a hand-edited URL can only narrow the view.
 */

export const PAGE_SIZE = 50;

export const FILTER_KEYS = ["family", "method", "product", "status", "population", "domain", "setting", "level", "profession", "specialty", "purpose", "owner", "collection"] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

/** The filters shown in the toolbar row, and those behind "More filters". */
export const PRIMARY_FILTERS: readonly FilterKey[] = ["family", "method", "product", "status"];
export const MORE_FILTERS: readonly FilterKey[] = ["domain", "profession", "specialty", "setting", "population", "level", "purpose"];

export const SORT_OPTIONS = [
  { value: "updated_desc", label: "Recently updated" },
  { value: "name_asc", label: "Name, A to Z" },
  { value: "name_desc", label: "Name, Z to A" },
  { value: "published_desc", label: "Recently published" },
  { value: "published_asc", label: "Oldest published" },
  { value: "code_asc", label: "Code" },
] as const;
export type SortKey = (typeof SORT_OPTIONS)[number]["value"];
export const DEFAULT_SORT: SortKey = "updated_desc";

export const STATUS_FILTER_VALUES = ["none", "draft", "in_review", "approved", "published", "retired"] as const;

export type CatalogueTab = "instruments" | "collections" | "guide";
export const TABS: readonly { value: CatalogueTab; label: string }[] = [
  { value: "instruments", label: "All instruments" },
  { value: "collections", label: "Collections" },
  { value: "guide", label: "Classification guide" },
];

export type CatalogueQuery = {
  q: string;
  filters: Partial<Record<FilterKey, string>>;
  sort: SortKey;
  page: number;
  tab: CatalogueTab;
  /** The instrument whose drawer is open. */
  open: string | null;
};

type Raw = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const CODE = /^[A-Za-z0-9_-]{1,60}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export function parseCatalogueQuery(sp: Raw): CatalogueQuery {
  const q = (first(sp.q) ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const filters: Partial<Record<FilterKey, string>> = {};
  for (const k of FILTER_KEYS) {
    const v = (first(sp[k]) ?? "").trim();
    if (!v) continue;
    if (k === "owner") filters.owner = v.slice(0, 80);
    else if (k === "status") { if ((STATUS_FILTER_VALUES as readonly string[]).includes(v)) filters.status = v; }
    else if (CODE.test(v)) filters[k] = v;
  }
  const sortRaw = first(sp.sort) ?? "";
  const sort = (SORT_OPTIONS.some(o => o.value === sortRaw) ? sortRaw : DEFAULT_SORT) as SortKey;
  const pageRaw = Number.parseInt(first(sp.page) ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 100000) : 1;
  const tabRaw = first(sp.tab) ?? "";
  const tab: CatalogueTab = tabRaw === "collections" || tabRaw === "guide" ? tabRaw : "instruments";
  const openRaw = first(sp.i) ?? "";
  return { q, filters, sort, page, tab, open: isUuid(openRaw) ? openRaw : null };
}

/** The arguments of asmt_catalogue_search for a query. */
export function toSearchArgs(query: Pick<CatalogueQuery, "q" | "filters" | "sort" | "page">) {
  return {
    p_q: query.q || null,
    p_filters: { ...query.filters },
    p_sort: query.sort,
    p_limit: PAGE_SIZE,
    p_offset: (query.page - 1) * PAGE_SIZE,
  };
}

/** The query string for a query. Defaults are omitted so a clean view has a clean URL. */
export function toParams(query: CatalogueQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (query.tab !== "instruments") p.set("tab", query.tab);
  if (query.q) p.set("q", query.q);
  for (const k of FILTER_KEYS) { const v = query.filters[k]; if (v) p.set(k, v); }
  if (query.sort !== DEFAULT_SORT) p.set("sort", query.sort);
  if (query.page > 1) p.set("page", String(query.page));
  if (query.open) p.set("i", query.open);
  return p;
}

export const hrefFor = (base: string, query: CatalogueQuery) => {
  const s = toParams(query).toString();
  return s ? `${base}?${s}` : base;
};

export const hasActiveFilters = (query: Pick<CatalogueQuery, "q" | "filters">) => !!query.q || Object.keys(query.filters).length > 0;

/** Number of filters set behind "More filters", for the disclosure label. */
export const moreFiltersActive = (filters: Partial<Record<FilterKey, string>>) => MORE_FILTERS.filter(k => !!filters[k]).length;

/** A change to the filters, search or sort starts again at page 1. */
export function withChange(query: CatalogueQuery, change: Partial<Pick<CatalogueQuery, "q" | "sort" | "tab" | "open" | "page">> & { filters?: Partial<Record<FilterKey, string | null>> }): CatalogueQuery {
  const filters: Partial<Record<FilterKey, string>> = { ...query.filters };
  for (const [k, v] of Object.entries(change.filters ?? {}) as [FilterKey, string | null | undefined][]) {
    if (v) filters[k] = v; else delete filters[k];
  }
  const resets = change.q !== undefined || change.sort !== undefined || change.filters !== undefined;
  return {
    q: change.q ?? query.q,
    filters,
    sort: change.sort ?? query.sort,
    tab: change.tab ?? query.tab,
    open: change.open === undefined ? query.open : change.open,
    page: change.page ?? (resets ? 1 : query.page),
  };
}
