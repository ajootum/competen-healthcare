/* eslint-disable @typescript-eslint/no-explicit-any */
import { correctQuery, expandText, vocabularyOf } from "../search/tolerant";
import { searchLibrary, type SearchParams, type SearchResult } from "./learn-search";
import { sectionTopicRows, type MaterialRow } from "./store";

// COMPETEN UNIVERSAL SEARCH STANDARD, stage 2: Learn's search with the closed synonym list and one-slip spelling help. At the call
// site only: retrieval.ts is untouched. The result keeps the learner's own words in `params`, so paging, Clear search and My Search
// History all carry what they typed; `showingFor` is the corrected words, only when the first search found nothing and the second did.

export type TolerantResult = SearchResult & { showingFor: string | null };

/**
 * Only the tabs asked for count: the others are not read (a null there is "not asked", not a failure). A null on a tab that WAS asked
 * for is a real read failure, so it is never "nothing found".
 */
export const nothingFound = (r: SearchResult): boolean => {
  const asked = r.params.tab === "all" ? Object.values(r.counts) : [r.counts[r.params.tab]];
  return asked.every(c => c === 0);
};
/** True where a filter narrows the search: a correction is then never tried, as on Saved. */
const filtered = (p: SearchParams) => !!p.type || !!p.within || !!p.subject;

export async function searchLibraryTolerant(admin: any, userId: string, params: SearchParams, materials: readonly MaterialRow[]): Promise<TolerantResult> {
  const run = async (text: string): Promise<SearchResult> => ({ ...(await searchLibrary(admin, userId, { ...params, q: expandText(text) }, materials)), params });
  const first = await run(params.q);
  if (!params.q || filtered(params) || !nothingFound(first)) return { ...first, showingFor: null };
  const topics = await sectionTopicRows(admin, userId);
  const vocabulary = vocabularyOf([...(topics.ok ? topics.data.flatMap(t => t.topics) : []), ...materials.map(m => m.title)]);
  const fixed = correctQuery(params.q, vocabulary);
  if (!fixed.changed) return { ...first, showingFor: null };
  const second = await run(fixed.text);
  return nothingFound(second) ? { ...first, showingFor: null } : { ...second, showingFor: fixed.text };
}
