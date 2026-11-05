import type { Metadata } from "next";
import SearchHistorySupplementPage from "@/components/legal/SearchHistorySupplementPage";
import { SEARCH_HISTORY_SUPPLEMENT as S } from "@/lib/legal/search-history-supplement";

// /legal/search-history: the CURRENT version of the Privacy Notice supplement for My Search History.
export const metadata: Metadata = { title: S.title, robots: { index: false, follow: false } };

export default function Page() {
  return <SearchHistorySupplementPage s={S} permanent={false} />;
}
