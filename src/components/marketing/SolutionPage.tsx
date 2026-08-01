import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import { ACCENT_SOFT } from "@/lib/marketing/home-content";
import type { Solution, SolutionTemplate } from "@/lib/marketing/solutions";

// One template for the single-page landing pages (WEB-STRAT-001 Phase 1). Near-identical pages written out
// four times drift within a week -- one changes its CTA, another its heading level, and the set stops
// looking like one site. The differences that matter are data; the structure is not a difference.
//
// The prop type requires `template`, so a solution that owns a whole section instead (/practice) cannot be
// passed here by accident and silently render an empty features grid. Reach it via `templated(slug)`.

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function SolutionPage({ s }: { s: Solution & { template: SolutionTemplate } }) {
  const t = s.template;
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}55, #fff)` }}>
          <div className={`${container} pt-6`}>
            <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
              <Link href="/" className="hover:text-gray-800">Home</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <span className="text-gray-700">{s.eyebrow}</span>
            </nav>
          </div>

          <div className={`${container} grid lg:grid-cols-2 gap-10 items-center py-10 lg:py-14`}>
            <div>
              <h1 className="text-[2.2rem] sm:text-[3rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
                {t.headline.map(line => <span key={line} className="block">{line}</span>)}
              </h1>
              <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-gray-600">{s.body}</p>

              <ul className="mt-6 space-y-2.5">
                {t.points.map(p => (
                  <li key={p} className="flex gap-2.5 text-[14px] text-gray-700">
                    <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                      style={{ background: s.accent }}>✓</span>
                    {p}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={t.primary.href} className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: s.accent }}>
                  {t.primary.label}
                </Link>
                <a href={t.secondary.href} className="text-[15px] font-semibold transition-opacity hover:opacity-80" style={{ color: s.accent }}>
                  {t.secondary.label} →
                </a>
              </div>
            </div>

            <div className="relative rounded-3xl overflow-hidden aspect-[4/3] bg-[var(--cmp-neutral-100)]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={t.image} alt={t.imageAlt} className="w-full h-full object-cover object-top" />
            </div>
          </div>
        </section>

        {/* ── FEATURES ─────────────────────────────────────────────────────
            OUTCOMES, NOT MODULES. Each card names what the person can do; none of them names an internal
            product. That is the disclosure rule, and it is asserted by the public-disclosure harness. */}
        <section id="features" className={`${container} py-14 lg:py-16`}>
          <h2 className="text-center text-[1.6rem] font-bold tracking-tight text-gray-900">{t.featuresTitle}</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {t.features.map(f => (
              <div key={f.title} className="rounded-2xl border border-gray-200 bg-white p-5 text-center hover:shadow-md transition-shadow">
                <span aria-hidden className="mx-auto flex w-11 h-11 rounded-xl items-center justify-center"
                  style={{ background: `color-mix(in srgb, ${s.accent} 12%, white)` }}>
                  <span className="w-3.5 h-3.5 rounded" style={{ background: s.accent }} />
                </span>
                <h3 className="mt-3 text-[15px] font-bold text-gray-900">{f.title}</h3>
                <p className="mt-1 text-[12.5px] leading-snug text-gray-600">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CLOSING ──────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 flex flex-col sm:flex-row sm:items-center gap-5"
            style={{ background: `color-mix(in srgb, ${s.accent} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={s.accent} opacity={0.10} />
            <span aria-hidden className="relative hidden sm:flex w-14 h-14 shrink-0 rounded-2xl bg-white items-center justify-center text-2xl shadow-sm">✦</span>
            <div className="relative flex-1">
              <p className="text-[17px] font-bold text-gray-900">{t.closing.title}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{t.closing.body}</p>
            </div>
            <Link href={t.primary.href} className="relative shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: s.accent }}>
              {t.closing.action}
            </Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
