import Link from "next/link";
import PracticeHeader from "@/components/marketing/PracticeHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import PracticeNav from "@/components/marketing/PracticeNav";
import PracticeScreens from "@/components/marketing/PracticeScreens";
import { PatternField } from "@/components/marketing/Pattern";
import { PRACTICE_AREAS, PRACTICE_CTA, type PracticeArea } from "@/lib/marketing/practice-content";

// One template for all six Competen Practice capability pages. Six near-identical pages written out six
// times drift apart within a fortnight; the differences that matter are data, and the structure is not one
// of them.

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function PracticeAreaPage({ a }: { a: PracticeArea }) {
  const others = PRACTICE_AREAS.filter(x => x.slug !== a.slug);

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <PracticeHeader />
      <PracticeNav current={a.slug} />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${a.accent} 7%, white), #fff)` }}>
          <div className={`${container} pt-6`}>
            <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
              <Link href="/" className="hover:text-gray-800">Home</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <Link href="/practice" className="hover:text-gray-800">Practice</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <span className="text-gray-700">{a.eyebrow}</span>
            </nav>
          </div>

          <div className={`${container} py-10 lg:py-14 max-w-3xl`}>
            <span aria-hidden className="flex w-12 h-12 rounded-2xl items-center justify-center text-2xl"
              style={{ background: `color-mix(in srgb, ${a.accent} 12%, white)` }}>{a.icon}</span>
            <h1 className="mt-5 text-[2.1rem] sm:text-[2.9rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
              {a.headline.map(line => <span key={line} className="block">{line}</span>)}
            </h1>
            <p className="mt-4 text-[16px] leading-relaxed text-gray-600">{a.body}</p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href={PRACTICE_CTA.action.href}
                className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: a.accent }}>{PRACTICE_CTA.action.label}</Link>
              <a href="#screens" className="text-[15px] font-semibold transition-opacity hover:opacity-80"
                style={{ color: a.accent }}>See the screens →</a>
            </div>
          </div>
        </section>

        {/* ── WHAT YOU GET ─────────────────────────────────────────────────── */}
        <section className={`${container} py-12 lg:py-16`}>
          <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">What this gives you</h2>
          <ul className="mt-7 grid gap-x-8 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
            {a.outcomes.map(o => (
              <li key={o.title}>
                <span aria-hidden className="block w-7 h-1 rounded-full" style={{ background: a.accent }} />
                <h3 className="mt-3 text-[15.5px] font-bold text-gray-900">{o.title}</h3>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">{o.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── SCREENS ──────────────────────────────────────────────────────── */}
        <section id="screens" className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-16`}>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">What it looks like</h2>
            <div className="mt-7">
              <PracticeScreens screens={a.screens} accent={a.accent} />
            </div>
          </div>
        </section>

        {/* ── WHERE THIS SITS ──────────────────────────────────────────────── */}
        <section className={`${container} py-12 lg:py-14`}>
          <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">The rest of Competen Practice</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
            Each area is one part of the same product. Nothing here is a separate purchase.
          </p>
          <ul className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {others.map(o => (
              <li key={o.slug}>
                <Link href={`/practice/${o.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
                  <span aria-hidden className="flex w-10 h-10 rounded-xl items-center justify-center text-xl"
                    style={{ background: `color-mix(in srgb, ${o.accent} 12%, white)` }}>{o.icon}</span>
                  <h3 className="mt-3 text-[15px] font-bold text-gray-900">{o.nav}</h3>
                  <p className="mt-1.5 flex-1 text-[12.5px] leading-snug text-gray-600">{o.blurb}</p>
                  <span className="mt-3 text-[12.5px] font-semibold" style={{ color: o.accent }}>Explore →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── CLOSING ──────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-8 sm:px-10 flex flex-col lg:flex-row lg:items-center gap-6"
            style={{ background: `color-mix(in srgb, ${a.accent} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={a.accent} opacity={0.10} />
            <div className="relative flex-1">
              <h2 className="text-[1.35rem] font-bold text-gray-900 text-balance">{PRACTICE_CTA.title}</h2>
              <p className="mt-2 max-w-xl text-[13.5px] leading-relaxed text-gray-600">{PRACTICE_CTA.body}</p>
            </div>
            <Link href={PRACTICE_CTA.action.href}
              className="relative shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: a.accent }}>{PRACTICE_CTA.action.label} →</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
