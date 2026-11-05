import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SearchHistorySupplementPage from "@/components/legal/SearchHistorySupplementPage";
import { SEARCH_HISTORY_SUPPLEMENTS } from "@/lib/legal/search-history-supplement";

// /legal/search-history/<key>: one version of the supplement, permanently.
export function generateStaticParams() { return SEARCH_HISTORY_SUPPLEMENTS.map(s => ({ version: s.key })); }
export const dynamicParams = false;

export const metadata: Metadata = { title: "Privacy Notice supplement: My Search History", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ version: string }> }) {
  const { version } = await params;
  const s = SEARCH_HISTORY_SUPPLEMENTS.find(x => x.key === version);
  if (!s) notFound();
  return <SearchHistorySupplementPage s={s} permanent />;
}
