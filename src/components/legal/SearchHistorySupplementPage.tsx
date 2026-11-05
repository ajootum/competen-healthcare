import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { CURRENT_LEGAL_VERSION } from "@/lib/legal/interim";
import { SEARCH_HISTORY_SUPPLEMENT, supplementPath, type SearchHistorySupplement } from "@/lib/legal/search-history-supplement";

// One version of the Privacy Notice supplement for My Search History. Public, as /legal is, and a draft under legal review like the other documents here.
// Beside the Individual Privacy Notice: it changes no version and no acceptance. It renders the text it is given and adds only navigation and the banner.
export default function SearchHistorySupplementPage({ s, permanent }: { s: SearchHistorySupplement; permanent: boolean }) {
  const isCurrent = s.key === SEARCH_HISTORY_SUPPLEMENT.key;
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-[12px] text-gray-500"><Link href="/legal" className="hover:underline">Legal</Link> / My Search History</p>
        <h1 className="mt-2 text-[28px] font-semibold text-gray-900">{s.title}</h1>
        <div role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          <p className="font-semibold">{CURRENT_LEGAL_VERSION.status}</p>
          <p className="mt-1">Published {s.date}. Notice version <span className="font-mono">{s.version}</span>.{" "}
            {!isCurrent ? <>This is an earlier version. See the <Link className="underline" href={supplementPath(SEARCH_HISTORY_SUPPLEMENT.key)}>current version</Link>.</>
              : permanent ? "This is the permanent address of this version."
              : <>Permanent address of this version: <Link className="underline" href={supplementPath(s.key)}>{supplementPath(s.key)}</Link>.</>}
          </p>
        </div>
        <p className="mt-6 text-[14.5px] font-medium leading-relaxed text-gray-900">{s.applies}</p>
        <div className="mt-4 space-y-3 text-[14.5px] leading-relaxed text-gray-700">
          {s.body.map(p => <p key={p}>{p}</p>)}
        </div>
        <p className="mt-6 text-[13.5px]">Read it with the <Link href="/legal/privacy" className="underline">Privacy Notice</Link>.</p>
      </main>
      <SiteFooter />
    </div>
  );
}
