import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";
import {
  BRAND, ACCENT, ACCENT_DARK, ACCENT_SOFT, HERO, HERO_CARDS, TRUSTED, TRUSTED_HEADING,
  WHO_WE_HELP, CTA_BAND, ASSURANCES, NAV, FOOTER, FOOTER_LEGAL,
} from "@/lib/marketing/home-content";

// WEB-HP-002 — Competen corporate homepage.
//
// A GATEWAY, not a brochure of the platform. The spec's governing rule is minimal disclosure: outcomes,
// not internals. That is why this page is short — no module list, no lifecycle diagram, no architecture.
// Its job is to make a visitor curious enough to open a solution page or book a demo.
//
// STATIC BY DESIGN: nothing here reads the database. A marketing page that awaits Supabase is slow, and can
// fail to render because of an outage in a system its visitors have no account on.

export const metadata = {
  title: "Competen — Healthcare. Empowered.",
  description:
    "Competen empowers healthcare organisations and professionals to develop skills, optimise workforce " +
    "performance, and improve outcomes — at every level.",
};

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="Competen home">
      <span className="w-9 h-9 rounded-full flex items-center justify-center text-white text-lg font-bold"
        style={{ background: `linear-gradient(135deg, ${ACCENT}, #7C3AED)` }}>C</span>
      <span className="leading-tight">
        <span className={`block text-lg font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>{BRAND.name}</span>
        <span className={`block text-[10px] ${dark ? "text-white/50" : "text-gray-500"}`}>{BRAND.tagline}</span>
      </span>
    </Link>
  );
}

/* Floating intelligence cards over the hero image. Drawn, not screenshotted: a screenshot of a seeded
   tenant would put invented patient numbers on the public internet and would go stale the moment the
   workspace changed. Marked as a preview so the figures never read as a live customer's. */
function HeroCards() {
  const r = HERO_CARDS.readiness, l = HERO_CARDS.learning;
  return (
    <div className="pointer-events-none absolute inset-0 hidden sm:block" aria-hidden="true">
      <div className="absolute right-0 top-[8%] w-40 rounded-2xl bg-[#0F172A] text-white p-3.5 shadow-xl">
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
        <p className="text-[9px] text-center text-emerald-400">↑ {r.delta}</p>
      </div>

      <div className="absolute right-4 top-[40%] w-44 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-black/5">
        <p className="text-[10px] font-medium text-gray-700">{HERO_CARDS.performance.title}</p>
        <svg viewBox="0 0 100 34" className="mt-1 w-full h-9">
          <polyline points="0,28 12,24 24,26 36,18 48,21 60,13 72,16 84,7 100,4"
            fill="none" stroke={ACCENT} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <p className="text-[9px]" style={{ color: ACCENT }}>↑ {HERO_CARDS.performance.caption}</p>
      </div>

      <div className="absolute right-0 bottom-[6%] w-44 rounded-2xl bg-white p-3.5 shadow-xl ring-1 ring-black/5">
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

      {/* ── HEADER ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur border-b border-gray-100">
        <div className={`${container} flex items-center gap-8 h-[70px]`}>
          <Logo />
          <nav className="hidden lg:flex items-center gap-7 mx-auto" aria-label="Primary">
            {NAV.map(n => (
              <a key={n.label} href={n.href} className="text-[14px] font-medium text-gray-700 hover:text-gray-900 transition-colors">
                {n.label} <span aria-hidden className="text-gray-400 text-[10px]">▾</span>
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-4 ml-auto lg:ml-0">
            <Link href="/login" className="text-[14px] font-medium text-gray-700 hover:text-gray-900 transition-colors">Login</Link>
            <Link href={HERO.primary.href} className="rounded-full px-5 py-2.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
              style={{ background: ACCENT }}>
              {HERO.primary.label}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden">
          <div className={`${container} grid lg:grid-cols-2 gap-10 items-center pt-12 pb-10 lg:pt-16`}>
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-medium"
                style={{ background: ACCENT_SOFT, color: ACCENT_DARK }}>
                ✦ {BRAND.eyebrow}
              </span>
              <h1 className="mt-6 text-[2.4rem] sm:text-[3.3rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
                {HERO.headline}{" "}
                {HERO.headlineAccentLead}
                <span style={{ color: ACCENT }}>{HERO.headlineAccent}</span>
              </h1>
              <p className="mt-5 max-w-md text-[15.5px] leading-relaxed text-gray-600">{HERO.body}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={HERO.primary.href} className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: ACCENT }}>
                  {HERO.primary.label} →
                </Link>
                <a href={HERO.secondary.href} className="rounded-xl border-2 px-6 py-3.5 text-[15px] font-semibold transition-colors hover:bg-[var(--cmp-neutral-50)]"
                  style={{ borderColor: `${ACCENT}55`, color: ACCENT }}>
                  {HERO.secondary.label} →
                </a>
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

          {/* ── TRUSTED ORGANISATIONS ──────────────────────────────────────
              Renders only when there is something that can honestly be claimed. An empty list removes the
              whole band rather than leaving a heading with nothing under it. */}
          {TRUSTED.length > 0 && (
            <div className={container}>
              <div className="rounded-3xl bg-[#FAF9F6] px-6 py-7">
                <p className="text-center text-[14px] text-gray-600">{TRUSTED_HEADING}</p>
                <ul className="mt-5 flex flex-wrap items-center justify-center gap-x-10 gap-y-5">
                  {TRUSTED.map(o => (
                    <li key={o.name} className="flex items-center gap-2.5 text-gray-500">
                      <span aria-hidden className="w-8 h-8 rounded-full bg-gray-200/70 flex items-center justify-center text-[11px] font-bold text-gray-500">
                        {o.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="leading-tight">
                        <span className="block text-[13.5px] font-semibold text-gray-700">{o.name}</span>
                        {o.sub && <span className="block text-[11px] text-gray-400">{o.sub}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* ── WHO WE HELP ──────────────────────────────────────────────────── */}
        <section id="who-we-help" className={`${container} py-16 lg:py-20`}>
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-[2rem] font-bold tracking-tight text-gray-900 text-balance">Who we help</h2>
            <p className="mt-2.5 text-[15px] text-gray-600">Solutions designed for the people and organisations driving healthcare forward.</p>
          </div>
          <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {WHO_WE_HELP.map(a => (
              <div key={a.title} className="rounded-2xl border border-gray-200 bg-white p-6 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                <span className="flex w-12 h-12 rounded-full items-center justify-center text-xl" style={{ background: a.accent }}>
                  <span aria-hidden>{a.icon}</span>
                </span>
                <h3 className="mt-4 text-[17px] font-bold text-gray-900 leading-snug">{a.title}</h3>
                <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{a.body}</p>
                <a href={a.href} className="mt-4 inline-block text-[13.5px] font-semibold" style={{ color: a.accent }}>Learn More →</a>
              </div>
            ))}
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
              <Link href={CTA_BAND.action.href} className="shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
                style={{ background: ACCENT }}>
                {CTA_BAND.action.label} →
              </Link>
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

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="bg-[#0B1020] text-white/70">
        <div className={`${container} py-12 grid gap-8 lg:grid-cols-12`}>
          <div className="lg:col-span-4">
            <Logo dark />
            <p className="mt-4 max-w-xs text-[12.5px] leading-relaxed text-white/45">
              Building a more competent, capable and confident healthcare workforce.
            </p>
            <div className="mt-4 flex gap-2">
              {["in", "X", "▶"].map(s => (
                <span key={s} aria-hidden className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-[11px] text-white/60">{s}</span>
              ))}
            </div>
          </div>
          <div className="lg:col-span-8 grid grid-cols-2 sm:grid-cols-3 gap-6">
            {FOOTER.map(col => (
              <div key={col.heading}>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">{col.heading}</p>
                <ul className="mt-3 space-y-2">
                  {col.links.map(l => (
                    <li key={col.heading + l.label}>
                      <a href={l.href} className="text-[12.5px] text-white/55 hover:text-white transition-colors">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
        <div className="border-t border-white/10">
          <div className={`${container} py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11.5px] text-white/40`}>
            <span>© {new Date().getFullYear()} Competen. All rights reserved.</span>
            {/* Rendered as plain text, not links: neither page exists yet, and a legal "link" to nowhere is
                worse than a label. They become links the moment the routes land. */}
            {FOOTER_LEGAL.map(l => <span key={l.label}>{l.label}</span>)}
            <a href="mailto:gabriel@semacast.com?subject=Competen%20enquiry" className="ml-auto hover:text-white/70 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
