import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import PracticeNav from "@/components/marketing/PracticeNav";
import { PatternField } from "@/components/marketing/Pattern";
import {
  PRACTICE_ACCENT, PRACTICE_ACCENT_DARK, PRACTICE_HERO, PRACTICE_PROMISES, NOT_AN_EMR, PATIENT_JOURNEY,
  PRACTICE_AREAS, PRACTICE_ROLES, INTEGRATIONS, INTEGRATION_NOTE, PRACTICE_CTA, PREVIEW_NOTE,
} from "@/lib/marketing/practice-content";

// Competen Practice -- the product overview page, derived from CPR-000 through CPR-020.
//
// This replaces the shared SolutionPage template that /practice used to render. The other four landing
// pages are still one page each; Practice is a product with six capability pages behind it, and a template
// built for a single page cannot carry a section.
//
// The page follows the order a clinician actually evaluates in: what it does for me, what it is NOT (the
// EMR boundary, stated early rather than discovered later), what the patient's journey through it looks
// like, then the detail.

export const metadata = {
  title: "Competen Practice — run your practice, delight your patients",
  description: PRACTICE_HERO.body,
};

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function Page() {
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <PracticeNav />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${PRACTICE_ACCENT} 7%, white), #fff 75%)` }}>
          <div className={`${container} pt-6`}>
            <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
              <Link href="/" className="hover:text-gray-800">Home</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <span className="text-gray-700">Practice</span>
            </nav>
          </div>

          <div className={`${container} py-10 lg:py-14`}>
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 12%, white)`, color: PRACTICE_ACCENT_DARK }}>
                ✦ {PRACTICE_HERO.eyebrow}
              </span>
              <h1 className="mt-6 text-[2.4rem] sm:text-[3.2rem] font-bold tracking-tight text-gray-900 leading-[1.06] text-balance">
                {PRACTICE_HERO.headline.map(l => <span key={l} className="block">{l}</span>)}
              </h1>
              <p className="mt-5 text-[16px] leading-relaxed text-gray-600">{PRACTICE_HERO.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={PRACTICE_HERO.primary.href}
                  className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: PRACTICE_ACCENT }}>{PRACTICE_HERO.primary.label}</Link>
                <a href={PRACTICE_HERO.secondary.href} className="rounded-xl border-2 px-6 py-3.5 text-[15px] font-semibold transition-colors hover:bg-white"
                  style={{ borderColor: `${PRACTICE_ACCENT}44`, color: PRACTICE_ACCENT }}>{PRACTICE_HERO.secondary.label}</a>
              </div>
            </div>

            <figure className="mt-10">
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={PRACTICE_HERO.image} alt={PRACTICE_HERO.imageAlt} width={1400} height={933}
                  fetchPriority="high" className="w-full h-auto" />
              </div>
              <figcaption className="mt-3 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</figcaption>
            </figure>
          </div>
        </section>

        {/* ── PROMISES ─────────────────────────────────────────────────────── */}
        <section className={`${container} py-12 lg:py-14`}>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PRACTICE_PROMISES.map(p => (
              <li key={p.title}>
                <span aria-hidden className="block w-7 h-1 rounded-full" style={{ background: PRACTICE_ACCENT }} />
                <h2 className="mt-3 text-[16px] font-bold text-gray-900">{p.title}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── THE EMR BOUNDARY ─────────────────────────────────────────────
            Stated here, near the top, on purpose. A clinic that buys this expecting an EMR will churn in
            month three, and that outcome is worse for everybody than a visitor who leaves in minute two. */}
        <section className={`${container} pb-14`}>
          <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-9">
            <div className="grid lg:grid-cols-3 gap-8">
              <div>
                <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900 text-balance">{NOT_AN_EMR.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-gray-600">{NOT_AN_EMR.body}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PRACTICE_ACCENT }}>What it does</p>
                <ul className="mt-3 space-y-2.5">
                  {NOT_AN_EMR.is.map(i => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-gray-700">
                      <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                        style={{ background: PRACTICE_ACCENT }}>✓</span>
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">What it does not</p>
                <ul className="mt-3 space-y-2.5">
                  {NOT_AN_EMR.isNot.map(i => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-gray-500">
                      <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-[9px] text-gray-400">–</span>
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── THE PATIENT JOURNEY ──────────────────────────────────────────
            Numbered because the steps genuinely are a sequence -- each one is the trigger for the next. */}
        <section id="journey" className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-16`}>
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">One patient, end to end</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
              Every step hands off to the next automatically. The practice does not have to remember any of them.
            </p>
            <ol className="mt-8 grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
              {PATIENT_JOURNEY.map((s, i) => (
                <li key={s.step} className="relative">
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: PRACTICE_ACCENT }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h3 className="mt-1 text-[15.5px] font-bold text-gray-900">{s.step}</h3>
                  <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── THE SIX AREAS ────────────────────────────────────────────────── */}
        <section className={`${container} py-12 lg:py-16`}>
          <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">What is inside</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
            Six areas, one product. Nothing below is a separate purchase.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PRACTICE_AREAS.map(a => (
              <li key={a.slug}>
                <Link href={`/practice/${a.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
                  <div className="overflow-hidden bg-[var(--cmp-neutral-100)] border-b border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.screens[0].src} alt="" width={1400} height={933} loading="lazy" decoding="async"
                      className="w-full h-auto transition-transform group-hover:scale-[1.02]" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <span aria-hidden className="flex w-10 h-10 rounded-xl items-center justify-center text-xl"
                      style={{ background: `color-mix(in srgb, ${a.accent} 12%, white)` }}>{a.icon}</span>
                    <h3 className="mt-3 text-[16px] font-bold text-gray-900">{a.nav}</h3>
                    <p className="mt-1.5 flex-1 text-[13px] leading-snug text-gray-600">{a.blurb}</p>
                    <span className="mt-3 text-[13px] font-semibold" style={{ color: a.accent }}>Explore →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</p>
        </section>

        {/* ── ROLES ────────────────────────────────────────────────────────── */}
        <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-14`}>
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">Everyone in the practice, on the right screen</h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PRACTICE_ROLES.map(r => (
                <li key={r.role} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <span aria-hidden className="flex w-11 h-11 rounded-xl items-center justify-center text-xl"
                    style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 10%, white)` }}>{r.icon}</span>
                  <h3 className="mt-3 text-[15px] font-bold text-gray-900">{r.role}</h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-gray-600">{r.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[12.5px] text-gray-500">
              Larger groups can add an organisation administrator across multiple practices.
            </p>
          </div>
        </section>

        {/* ── INTEGRATIONS ─────────────────────────────────────────────────
            The roadmap items are LABELLED. A clinic choosing this because it "connects to our laboratory"
            would be buying something the specifications do not promise for Version 1. */}
        <section className={`${container} py-12 lg:py-16`}>
          <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">Connects to what you already run</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">{INTEGRATION_NOTE}</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {INTEGRATIONS.map(i => (
              <li key={i.name} className="rounded-2xl border border-gray-200 bg-white p-5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-[14.5px] font-bold text-gray-900">{i.name}</h3>
                  {!i.inV1 && (
                    <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                      Roadmap
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-[12.5px] leading-snug text-gray-600">{i.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── CLOSING ──────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#141B4D] px-6 py-9 sm:px-10 flex flex-col lg:flex-row lg:items-center gap-6">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative flex-1">
              <h2 className="text-[1.7rem] font-bold text-white leading-snug text-balance">{PRACTICE_CTA.title}</h2>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/65">{PRACTICE_CTA.body}</p>
            </div>
            <Link href={PRACTICE_CTA.action.href}
              className="relative shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: PRACTICE_ACCENT }}>{PRACTICE_CTA.action.label} →</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
