import Link from "next/link";
import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal/interim";
import { SEARCH_HISTORY_SUPPLEMENT as S } from "@/lib/legal/search-history-supplement";

// /legal/search-history: the Privacy Notice supplement for My Search History (owner pilot GO, 5 Nov 2026, item 5). Public, as /legal is, and a
// draft under legal review like the other documents here. Beside the Individual Privacy Notice: it changes no version and no acceptance.
export const metadata: Metadata = { title: S.title, robots: { index: false, follow: false } };

export default function Page() {
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-[12px] text-gray-500"><Link href="/legal" className="hover:underline">Legal</Link> / My Search History</p>
        <h1 className="mt-2 text-[28px] font-semibold text-gray-900">{S.title}</h1>
        <div role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          <p className="font-semibold">{CURRENT_LEGAL_VERSION.status}</p>
          <p className="mt-1">Published {S.date}. Notice version <span className="font-mono">{S.version}</span>.</p>
        </div>
        <p className="mt-6 text-[14.5px] font-medium leading-relaxed text-gray-900">{S.applies}</p>
        <div className="mt-4 space-y-3 text-[14.5px] leading-relaxed text-gray-700">
          {S.body.map(p => <p key={p}>{p}</p>)}
        </div>
        <p className="mt-6 text-[13.5px]">Read it with the <Link href="/legal/privacy" className="underline">Privacy Notice</Link>.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
