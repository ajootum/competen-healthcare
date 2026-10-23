import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { LEGAL_KIND_LABEL, legalPath, type LegalKind, type LegalVersion } from "@/lib/legal/interim";

// One template for every published legal document set (COMPETEN-LEGAL-001 s4). It renders the text it is
// given and adds only navigation and the status banner; it never rewords a document.
export default function LegalDocumentPage({ kind, v, permanent }: { kind: LegalKind; v: LegalVersion; permanent: boolean }) {
  const other: LegalKind = kind === "terms" ? "privacy" : "terms";
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <main id="main" className="mx-auto w-full max-w-3xl px-5 py-10">
        <p className="text-[12px] text-gray-500">
          <Link href="/legal" className="hover:underline">Legal</Link> / {LEGAL_KIND_LABEL[kind]}
        </p>
        <h1 className="mt-2 text-[28px] font-semibold text-gray-900">{LEGAL_KIND_LABEL[kind]}</h1>
        <div role="note" className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-[13.5px] text-amber-900">
          <p className="font-semibold">{v.status}</p>
          <p className="mt-1">Version <span className="font-mono">{v.version}</span>, published {v.published}.{" "}
            {permanent ? "This is the permanent address of this version." :
              <>Permanent address of this version: <Link className="underline" href={legalPath(kind, v.version)}>{legalPath(kind, v.version)}</Link>.</>}
          </p>
        </div>
        <nav aria-label="Documents in this set" className="mt-6 text-[13.5px]">
          <ul className="list-disc pl-5 space-y-1">
            {v.documents[kind].map(d => <li key={d.key}><a href={`#${d.key}`} className="text-[var(--cmp-text-link,#1d4ed8)] hover:underline">{d.title}</a></li>)}
          </ul>
          <p className="mt-3">See also the <Link href={permanent ? legalPath(other, v.version) : `/legal/${other}`} className="underline">{LEGAL_KIND_LABEL[other]}</Link>.</p>
        </nav>

        {v.documents[kind].map(d => (
          <article key={d.key} id={d.key} className="mt-12 scroll-mt-24 border-t border-gray-200 pt-8">
            <h2 className="text-[22px] font-semibold text-gray-900">{d.title}</h2>
            <div className="mt-3 space-y-1 text-[13px] text-gray-600">
              {d.preamble.map((line, i) => <p key={i} className="whitespace-pre-line">{line}</p>)}
            </div>
            {d.sections.map((s, i) => (
              <section key={i} className="mt-7">
                <h3 className="text-[16px] font-semibold text-gray-900">{s.heading}</h3>
                <div className="mt-2 space-y-2 text-[14.5px] leading-relaxed text-gray-700">
                  {s.blocks.map((b, j) => b.type === "p"
                    ? <p key={j} className="whitespace-pre-line">{b.text}</p>
                    : <ul key={j} className="list-disc pl-6 space-y-1">{b.items.map((it, k) => <li key={k}>{it}</li>)}</ul>)}
                </div>
              </section>
            ))}
          </article>
        ))}
      </main>
      <SiteFooter />
    </div>
  );
}
