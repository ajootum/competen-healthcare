/**
 * Paged reads of the plat_* catalogue registries.
 *
 * THE FIRST SHARED MODULE IN scripts/, and the convention it breaks is deliberate. Every harness here is
 * standalone and runnable on its own, which is a good property. But three of them read the same registry
 * the same way, and the way was wrong: a single .rpc() call returns at most 1000 rows, and PostgREST says
 * nothing when it truncates. The index registry crossed that line at 1020 rows and the migration-object
 * audit spent three commits reporting confident nonsense -- indexes "missing" that were simply past the
 * cap, and a set that CHANGED between runs because the function had no ORDER BY.
 *
 * plat_rls_registry is at 494 of 1000 today. It is not broken. It is one large migration from breaking,
 * and when it does it breaks quietly and in the direction of "everything is fine": the anon-exposure
 * harness would stop probing tables past the cap and still print a clean bill of health for the ones it
 * managed to reach. A security harness that silently narrows its own scope is worse than no harness.
 *
 * So the fix lives in ONE place. Copied into three files, the control drifts between them the first time
 * someone edits one -- which is the same argument that put the modal focus trap in a single hook.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PAGE = 1000;

export type PagedResult<T> = {
  rows: T[];
  /** True when the total landed exactly on a page boundary -- see `capWarning`. */
  suspicious: boolean;
  error: string | null;
};

/**
 * Read a set-returning function completely, in pages.
 *
 * `orderBy` is REQUIRED, not optional. Paging an unordered result is not merely untidy: Postgres may
 * return rows in a different order per call, so page 2 can repeat or skip rows from page 1. That is how
 * six unrelated indexes appeared in a "missing" list after nine unrelated ones were added.
 */
export async function pagedRpc<T>(
  client: SupabaseClient, fn: string, orderBy: string[],
): Promise<PagedResult<T>> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = client.rpc(fn);
    for (const col of orderBy) q = q.order(col, { ascending: true, nullsFirst: true });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) return { rows, suspicious: false, error: error.message };
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  // A total that is an exact multiple of the page size is far more likely to mean paging stopped early
  // than that the catalogue holds a round number of rows.
  return { rows, suspicious: rows.length > 0 && rows.length % PAGE === 0, error: null };
}

/** The line to print when `suspicious` is set. Kept here so all three callers say the same thing. */
export const capWarning = (n: number) =>
  `read returned exactly ${n} rows (${n / PAGE} full page(s)) -- paging may have stopped early, `
  + `in which case every verdict below covers only part of the catalogue`;
