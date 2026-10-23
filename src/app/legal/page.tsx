import Link from "next/link";
import type { Metadata } from "next";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { CURRENT_LEGAL_VERSION, LEGAL_KIND_LABEL, LEGAL_VERSIONS, legalPath, type LegalKind } from "@/lib/legal/interim";

// COMPETEN-LEGAL-001 s4: the index of current documents. Drafts are not indexed by search engines.
export const metadata: Metadata = { title: "Legal", robots: { index: false, follow: false } };

export default function Page() {
  const kinds: LegalKind[] = ["terms", "privacy"];
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <h1 className="text-[28px] font-semibold text-gray-900">Legal</h1>
        <div role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          {CURRENT_LEGAL_VERSION.status}
        </div>
        <ul className="mt-6 space-y-3 text-[15px]">
          {kinds.map(k => (
            <li key={k}>
              <Link href={`/legal/${k}`} className="font-medium underline">{LEGAL_KIND_LABEL[k]}</Link>
              <span className="text-gray-500"> — {CURRENT_LEGAL_VERSION.documents[k].map(d => d.title).join("; ")}</span>
            </li>
          ))}
        </ul>
        <h2 className="mt-10 text-[16px] font-semibold text-gray-900">All versions</h2>
        <ul className="mt-2 space-y-1 text-[13.5px] text-gray-700">
          {LEGAL_VERSIONS.map(v => (
            <li key={v.version}>
              <span className="font-mono">{v.version}</span> ({v.published}):{" "}
              {kinds.map((k, i) => <span key={k}>{i ? " · " : ""}<Link className="underline" href={legalPath(k, v.version)}>{LEGAL_KIND_LABEL[k]}</Link></span>)}
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </div>
  );
}
