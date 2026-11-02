import { toSearchArgs, type CatalogueQuery, PAGE_SIZE } from "./filters";
import { shapeRow, totalOf, type CatalogueRow, type SearchRow } from "./shape";
import { must, type Admin } from "./db";

/**
 * The registry list. One call to asmt_catalogue_search does the filtering, sorting and paging in the database, so a
 * page costs the same with a hundred instruments or a hundred thousand. The compact row carries what the table shows.
 */
export type SearchResult = { rows: CatalogueRow[]; total: number; page: number; pageSize: number };

export async function searchCatalogue(admin: Admin, query: Pick<CatalogueQuery, "q" | "filters" | "sort" | "page">): Promise<SearchResult> {
  const res = await admin.rpc("asmt_catalogue_search", toSearchArgs(query));
  const raw = (must(res as { data: SearchRow[] | null; error: { message: string } | null }, "catalogue search") ?? []) as SearchRow[];
  return { rows: raw.map(shapeRow), total: totalOf(raw), page: query.page, pageSize: PAGE_SIZE };
}

/** The four counts of the landing tiles. */
export type CatalogueStats = {
  registered: number; familiesActive: number; familiesUsed: number;
  published: number; awaitingReview: number; connectedProducts: number; activeProducts: number;
};

export async function catalogueStats(admin: Admin): Promise<CatalogueStats> {
  const res = await admin.rpc("asmt_catalogue_stats");
  const j = (must(res as { data: Record<string, number> | null; error: { message: string } | null }, "catalogue stats") ?? {}) as Record<string, number>;
  const n = (k: string) => Number(j[k] ?? 0) || 0;
  return {
    registered: n("registered"), familiesActive: n("families_active"), familiesUsed: n("families_used"),
    published: n("published"), awaitingReview: n("awaiting_review"),
    connectedProducts: n("connected_products"), activeProducts: n("active_products"),
  };
}
