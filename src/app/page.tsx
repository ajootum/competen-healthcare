import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import {
  ACCENT, ACCENT_DARK, ACCENT_SOFT, BRAND, HERO, HERO_CARDS, AFRICA_BAND,
  CTA_BAND, ASSURANCES, ONE_ACCOUNT,
} from "@/lib/marketing/home-content";
import { PRIMARY_SOLUTIONS } from "@/lib/marketing/solutions";
import { pageMetadata } from "@/lib/marketing/site";

// WEB-STRAT-001 — public homepage.
//
// A ROUTER, not a brochure. The strategy is progressive disclosure: expose outcomes, market solutions
// rather than modules, and reveal more only after registration. So the homepage's real job is "Choose your
// path" — get a visitor into the landing page that matches who they are.
//
// The four path cards are generated from the SAME list as the routes, the header menu and the footer, so a
// path cannot exist without a page behind it and a page cannot exist without a way in.

export const metadata = pageMetadata({
  title: "Competen — Healthcare. Empowered.",
  description:
    "Competen helps students, professionals, practices and hospitals build capability, deliver better " +
    "care and improve outcomes.",
  path: "/",
  imageAlt: "Healthcare professionals at work",
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

const PATH_BLURB: Record<string, { title: string; body: string; img: string }> = {
  students:      { title: "Students",      body: "Build your foundation. Start your journey with confidence.", img: "/images/home/path-students.webp" },
  professionals: { title: "Professionals", body: "Grow your career. Keep learning. Stay ready.",               img: "/images/home/path-professionals.webp" },
  practice:      { title: "Practice",      body: "Run your practice. Delight your patients.",                  img: "/images/home/path-practice.webp" },
  hospitals:     { title: "Hospitals",     body: "Empower your teams. Improve care. Transform outcomes.",      img: "/images/home/path-hospitals.webp" },
};

/* Floating intelligence cards over the hero. Drawn, not screenshotted: a screenshot of a seeded tenant
   would put invented patient numbers on the public internet and would go stale the moment the workspace
   changed. They illustrate the kind of thing the platform reports, and say so. */
function HeroCards() {
  const r = HERO_CARDS.readiness, l = HERO_CARDS.learning;
  return (
    <div className="pointer-events-none absolute inset-0 hidden md:block" aria-hidden="true">
      <div className="absolute right-0 top-[6%] w-40 rounded-2xl bg-[#0F172A] text-white p-3.5 shadow-xl">
        <p className="text-[10px] text-white/70">{r.title}</p>
        <div className="relative mx-auto my-1.5 w-16 h-16">
          <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#334155" strokeWidth="3.5" />
            <circle cx="18" cy="18" r="15.9" fill="none" stroke="#22D3EE" strokeWidth="3.5"
              strokeDasharray={`${r.value} 100`} strokeLinecap="round" />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-base font-bold">{r.value}<span className="text-[9px]">%</span></span>
        </div>
        <p className="text-[10px] text-center text-white/80">{r.caption}</p>
      </div>
      <div className="absolute right-3 top-[42%] w-44 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-black/5">
        <p className="text-[10px] font-medium text-gray-700">{HERO_CARDS.performance.title}</p>
        <svg viewBox="0 0 100 34" className="mt-1 w-full h-9">
          <polyline points="0,28 12,24 24,26 36,18 48,21 60,13 72,16 84,7 100,4"
            fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[9px]" style={{ color: ACCENT }}>↑ {HERO_CARDS.performance.caption}</p>
      </div>
      <div className="absolute right-0 bottom-[8%] w-44 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-black/5">
        <p className="text-[10px] font-medium text-gray-700">{l.title}</p>
        <p className="text-2xl font-bold" style={{ color: ACCENT }}>{l.value}<span className="text-sm">%</span></p>
        <p className="text-[10px] text-gray-500">{l.caption}</p>
        <div className="mt-1.5 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full" style={{ width: `${l.value}%`, background: ACCENT }} />
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden" style={{ background: `linear-gradient(180deg, ${ACCENT_SOFT}55, #fff 70%)` }}>
          <div className={`${container} grid lg:grid-cols-2 gap-10 items-center pt-12 pb-10 lg:pt-16`}>
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
                style={{ background: ACCENT_SOFT, color: ACCENT_DARK }}>
                ✦ {BRAND.eyebrow}
              </span>
              <h1 className="mt-6 text-[2.4rem] sm:text-[3.2rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
                {HERO.headline.map(l => <span key={l} className="block">{l}</span>)}
                <span className="block" style={{ color: ACCENT }}>{HERO.headlineAccent}</span>
              </h1>
              <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-gray-600">{HERO.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={HERO.primary.href} className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: ACCENT }}>{HERO.primary.label}</a>
                <Link href={HERO.secondary.href} className="rounded-xl border-2 px-6 py-3.5 text-[15px] font-semibold transition-colors hover:bg-white"
                  style={{ borderColor: `${ACCENT}44`, color: ACCENT }}>{HERO.secondary.label}</Link>
              </div>
            </div>

            <div className="relative">
              <div className="relative rounded-3xl overflow-hidden aspect-[4/3] bg-[var(--cmp-neutral-100)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={HERO.image} alt={HERO.imageAlt} className="w-full h-full object-cover object-top" />
              </div>
              <HeroCards />
            </div>
          </div>
        </section>

        {/* ── CHOOSE YOUR PATH ─────────────────────────────────────────────── */}
        <section id="choose-your-path" className={`${container} py-12 lg:py-16`}>
          {/* WEB-HOME-001 s9's heading. The section id stays `choose-your-path` -- the hero CTA and any
              external link to the anchor keep working, and an anchor is not a sentence a visitor reads. */}
          <h2 className="text-center text-[1.35rem] font-bold tracking-tight text-gray-900">Who are you?</h2>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PRIMARY_SOLUTIONS.map(s => {
              const p = PATH_BLURB[s.slug];
              return (
                <Link key={s.slug} href={`/${s.slug}`}
                  className="group rounded-2xl border border-gray-200 bg-white overflow-hidden hover:shadow-lg hover:-translate-y-0.5 transition-all">
                  <div className="aspect-[4/3] overflow-hidden bg-[var(--cmp-neutral-100)]">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.img} alt="" className="w-full h-full object-cover object-top group-hover:scale-[1.03] transition-transform" />
                  </div>
                  <div className="p-5">
                    <h3 className="text-[16px] font-bold text-gray-900">{p.title}</h3>
                    <p className="mt-1.5 text-[13px] leading-snug text-gray-600">{p.body}</p>
                    <span className="mt-3 inline-block text-[13px] font-semibold" style={{ color: s.accent }}>Explore →</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── BUILT FOR AFRICA ─────────────────────────────────────────────── */}
        <section className={`${container} pb-14`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#141B4D] px-6 py-8 sm:px-10">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative grid lg:grid-cols-4 gap-6 items-center">
              <div className="lg:col-span-1">
                <h2 className="text-[1.35rem] font-bold text-white leading-snug text-balance">{AFRICA_BAND.title}</h2>
                <p className="mt-2 text-[12.5px] leading-relaxed text-white/55">{AFRICA_BAND.body}</p>
              </div>
              {/* Columns follow the number of statements rather than being fixed at four, so removing an
                  entry leaves a balanced band instead of two items adrift in a four-column grid. */}
              <dl className="lg:col-span-3 grid grid-cols-2 gap-5">
                {AFRICA_BAND.stats.map(s => (
                  <div key={s.label}>
                    <dt className="text-[17px] font-bold text-white leading-tight">{s.value}</dt>
                    <dd className="mt-1 text-[11.5px] leading-snug text-white/50">{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* The trusted-organisations band is removed. It named real institutions under a "Trusted by"
            claim, which is a factual statement about a third party and an implied endorsement. It is in
            git if it returns — with permission. */}

        {/* ── ONE COMPETEN ACCOUNT (WEB-HOME-001 s11) ──────────────────────── */}
        <section className={`${container} pb-14`}>
          <div className="rounded-3xl border border-gray-200 bg-white px-6 py-8 sm:px-10 flex flex-col lg:flex-row lg:items-center gap-6">
            <div className="flex-1">
              <h2 className="text-[1.5rem] font-bold text-gray-900 leading-snug">{ONE_ACCOUNT.title}</h2>
              <p className="mt-1 text-[14px] font-medium" style={{ color: ACCENT }}>{ONE_ACCOUNT.subtitle}</p>
              <ul className="mt-4 space-y-2">
                {ONE_ACCOUNT.points.map(p => (
                  <li key={p} className="flex gap-2.5 text-[13.5px] leading-relaxed text-gray-600">
                    <span aria-hidden className="mt-0.5 w-5 h-5 shrink-0 rounded-md flex items-center justify-center text-[10px]"
                      style={{ background: ACCENT_SOFT, color: ACCENT }}>✓</span>
                    {p}
                  </li>
                ))}
              </ul>
            </div>
            <Link href={ONE_ACCOUNT.action.href}
              className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: ACCENT }}>
              {ONE_ACCOUNT.action.label} →
            </Link>
          </div>
        </section>

        {/* ── CLOSING CTA ──────────────────────────────────────────────────── */}
        <section id="cta" className={`${container} pb-14`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#141B4D] px-6 py-8 sm:px-10">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative flex flex-col lg:flex-row lg:items-center gap-6">
              <span aria-hidden className="hidden sm:flex w-20 h-20 shrink-0 rounded-2xl bg-white/10 ring-1 ring-white/15 items-center justify-center text-3xl">🚀</span>
              <div className="flex-1">
                <h2 className="text-[1.6rem] font-bold text-white leading-snug text-balance">{CTA_BAND.title}</h2>
                <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/65">{CTA_BAND.body}</p>
              </div>
              {/* A plain anchor: the action is a mailto now (see DEMO_REQUEST), and next/link exists for
                  route transitions, not mail clients. */}
              <a href={CTA_BAND.action.href} className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
                style={{ background: ACCENT }}>{CTA_BAND.action.label} →</a>
            </div>
          </div>

          <ul className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {ASSURANCES.map(a => (
              <li key={a.title} className="flex gap-3">
                <span aria-hidden className="mt-0.5 w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-[11px]"
                  style={{ background: ACCENT_SOFT, color: ACCENT }}>✓</span>
                <span>
                  <span className="block text-[13.5px] font-bold text-gray-900">{a.title}</span>
                  <span className="block text-[12px] leading-snug text-gray-500">{a.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
