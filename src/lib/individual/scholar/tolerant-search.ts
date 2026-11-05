/* eslint-disable @typescript-eslint/no-explicit-any */
import { correctQuery, expandText, vocabularyOf } from "../search/tolerant";
import { searchLibrary, type SearchParams, type SearchResult } from "./learn-search";
import { sectionTopicRows, type MaterialRow } from "./store";

// COMPETEN UNIVERSAL SEARCH STANDARD, stage 2: Learn's search with the closed synonym list and one-slip spelling help. At the call
// site only: retrieval.ts is untouched. The result keeps the learner's own words in `params`, so paging, Clear search and My Search
// History all carry what they typed; `showingFor` is the corrected words, only when the first search found nothing and the second did.

export type TolerantResult = SearchResult & { showingFor: string | null };

const nothingFound = (r: SearchResult) => Object.values(r.counts).every(c => c === 0);

export async function searchLibraryTolerant(admin: any, userId: string, params: SearchParams, materials: readonly MaterialRow[]): Promise<TolerantResult> {
  const run = async (text: string): Promise<SearchResult> => ({ ...(await searchLibrary(admin, userId, { ...params, q: expandText(text) }, materials)), params });
  const first = await run(params.q);
  if (!params.q || !nothingFound(first)) return { ...first, showingFor: null };
  const topics = await sectionTopicRows(admin, userId);
  const vocabulary = vocabularyOf([...(topics.ok ? topics.data.flatMap(t => t.topics) : []), ...materials.map(m => m.title)]);
  const fixed = correctQuery(params.q, vocabulary);
  if (!fixed.changed) return { ...first, showingFor: null };
  const second = await run(fixed.text);
  return nothingFound(second) ? { ...first, showingFor: null } : { ...second, showingFor: fixed.text };
}
