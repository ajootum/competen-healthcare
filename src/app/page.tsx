import Link from "next/link";
import { PatternBand, PatternField, PatternRule, PhotoSlot } from "@/components/marketing/Pattern";
import {
  BRAND, HERO, TRUST, CAPABILITIES, LIFECYCLE, JOURNEY, AUDIENCES, METRICS, CLOSING, NAV, FOOTER, FOOTER_LEGAL, PHOTOS,
} from "@/lib/marketing/home-content";

// COMP-HOME-001 — public homepage.
//
// Positions Competen as a Healthcare Workforce Intelligence Platform: white ground, brand teal and blue,
// African geometric motifs in the separators, generous whitespace, rounded cards. Every string comes from
// src/lib/marketing/home-content.ts so copy edits never touch this file.
//
// STATIC BY DESIGN. Nothing here reads the database. A marketing page that awaits Supabase is a slow one,
// and worse, one that can fail to render because of an outage in a system its visitors have no account on.

export const metadata = {
  title: "Competen — Healthcare Competency & Workforce Platform",
  description:
    "Competen connects competency management, assessments, workforce operations, learning, quality and AI " +
    "into one configurable platform for healthcare organisations.",
};

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

function Logo({ dark = false }: { dark?: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label={`${BRAND.name} home`}>
      <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-[var(--cmp-color-primary)] to-[var(--cmp-color-information)] flex items-center justify-center text-white font-bold">C</span>
      <span className="leading-tight">
        <span className={`block font-bold tracking-tight ${dark ? "text-white" : "text-gray-900"}`}>{BRAND.name.toLowerCase()}</span>
        <span className={`block text-[10px] ${dark ? "text-white/50" : "text-gray-500"}`}>{BRAND.tagline}</span>
      </span>
    </Link>
  );
}

/* ── Hero dashboard preview ───────────────────────────────────────────────────
   A drawn abstraction of the Executive Command Centre, not a screenshot: a screenshot of a seeded demo
   tenant would put invented patient numbers on the public internet and would go stale the moment the
   workspace changed. The figures are illustrative and the panel is labelled "Preview" so it says so. */
function DashboardPreview() {
  const kpis = [
    { label: "Total Competent Staff", value: "1,248", delta: "+12%" },
    { label: "Assessments Completed", value: "3,562", delta: "+18%" },
    { label: "Workforce Coverage", value: "92%", delta: "On target" },
    { label: "Quality Events", value: "37", delta: "-14%" },
  ];
  const bars: [string, number][] = [["Clinical Skills", 96], ["Patient Safety", 93], ["Emergency Care", 91], ["Infection Control", 89]];
  return (
    <div className="rounded-2xl bg-white shadow-2xl ring-1 ring-black/5 overflow-hidden" aria-label="Product preview of the Executive Command Centre" role="img">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <span className="w-6 h-6 rounded-lg bg-[var(--cmp-color-primary)] text-white text-[11px] font-bold flex items-center justify-center">C</span>
        <span className="text-[12px] font-semibold text-gray-800">Executive Command Centre</span>
        <span className="ml-auto text-[10px] text-gray-400">Preview</span>
      </div>
      <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
        {kpis.map(k => (
          <div key={k.label} className="rounded-lg border border-gray-100 p-2.5">
            <p className="text-[9px] text-gray-400 leading-tight">{k.label}</p>
            <p className="text-base font-bold text-gray-900 tabular-nums leading-tight mt-0.5">{k.value}</p>
            <p className="text-[9px] text-[var(--cmp-text-success)]">{k.delta}</p>
          </div>
        ))}
      </div>
      <div className="px-3 pb-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
        <div className="rounded-lg border border-gray-100 p-3 flex flex-col items-center justify-center">
          <p className="text-[9px] text-gray-400 self-start">Workforce Readiness</p>
          <div className="relative w-20 h-20 my-1">
            <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90" aria-hidden="true">
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="#E5E7EB" strokeWidth="3" />
              <circle cx="18" cy="18" r="15.9" fill="none" stroke="var(--cmp-color-primary)" strokeWidth="3"
                strokeDasharray="92 100" strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-lg font-bold text-gray-900">92%</span>
              <span className="text-[8px] text-gray-400">Ready</span>
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-[9px] text-gray-400 mb-1.5">Competency Compliance</p>
          {bars.map(([name, pct]) => (
            <div key={name} className="mb-1.5">
              <div className="flex justify-between text-[9px] text-gray-500"><span>{name}</span><span className="tabular-nums">{pct}%</span></div>
              <div className="h-1 rounded-full bg-gray-100 overflow-hidden">
                <div className="h-full rounded-full bg-[var(--cmp-color-primary)]" style={{ width: `${pct}%` }} />
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-gray-100 p-3">
          <p className="text-[9px] text-gray-400 mb-1.5">Workforce Overview</p>
          <svg viewBox="0 0 100 44" className="w-full h-16" aria-hidden="true">
            <polyline points="0,30 17,22 33,26 50,14 67,19 83,10 100,16" fill="none" stroke="var(--cmp-color-secondary)" strokeWidth="2" />
            <polyline points="0,36 17,33 33,34 50,28 67,30 83,24 100,27" fill="none" stroke="var(--cmp-color-primary)" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
          <div className="flex gap-3 text-[8px] text-gray-400">
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[var(--cmp-color-secondary)] inline-block" />Required</span>
            <span className="flex items-center gap-1"><span className="w-2 h-0.5 bg-[var(--cmp-color-primary)] inline-block" />Available</span>
          </div>
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
        <div className={`${container} flex items-center gap-6 h-16`}>
          <Logo />
          <nav className="hidden lg:flex items-center gap-6 ml-auto" aria-label="Primary">
            {NAV.map(n => (
              <a key={n.label} href={n.href} className="text-[13px] font-medium text-gray-600 hover:text-[var(--cmp-color-primary)] transition-colors">
                {n.label}
              </a>
            ))}
          </nav>
          <div className="flex items-center gap-3 ml-auto lg:ml-0">
            <Link href="/login" className="text-[13px] font-medium text-gray-600 hover:text-gray-900 transition-colors">Login</Link>
            <Link href={HERO.primary.href} className="rounded-lg bg-[var(--cmp-color-primary)] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[var(--cmp-color-primary-dark)] transition-colors">
              {HERO.primary.label}
            </Link>
          </div>
        </div>
      </header>

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden bg-gradient-to-b from-[var(--cmp-color-primary-light)] via-white to-white">
          <PatternField className="absolute inset-0" tone="var(--cmp-color-primary)" opacity={0.10} />
          <div className={`${container} relative grid lg:grid-cols-2 gap-10 lg:gap-12 items-center py-14 lg:py-20`}>
            <div>
              <span className="inline-block rounded-full bg-white/80 ring-1 ring-[var(--cmp-color-primary)]/25 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--cmp-text-success)]">
                {BRAND.eyebrow}
              </span>
              <h1 className="mt-5 text-[2.1rem] sm:text-5xl font-bold tracking-tight text-gray-900 leading-[1.1] text-balance">
                {HERO.headline.map((line, i) => (
                  <span key={line} className={`block ${i === HERO.accentLine ? "text-[var(--cmp-color-primary)]" : ""}`}>{line}</span>
                ))}
              </h1>
              <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-gray-600">{HERO.body}</p>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <Link href={HERO.primary.href} className="rounded-lg bg-[var(--cmp-color-primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-[var(--cmp-color-primary-dark)] transition-colors">
                  {HERO.primary.label} →
                </Link>
                <a href={HERO.secondary.href} className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:border-[var(--cmp-color-primary)] hover:text-[var(--cmp-color-primary)] transition-colors">
                  {HERO.secondary.label} ▸
                </a>
              </div>
              <a href={HERO.tertiary.href} className="mt-3 inline-block text-[13px] font-medium text-[var(--cmp-color-secondary)] hover:underline">
                {HERO.tertiary.label} ▸
              </a>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-5 gap-4 items-stretch">
              <PhotoSlot src={PHOTOS.hero} className="sm:col-span-2 rounded-2xl min-h-[220px]"
                alt="Two nurses reviewing a patient record together on a tablet" />
              <div className="sm:col-span-3"><DashboardPreview /></div>
            </div>
          </div>

          {/* Patterned trust band */}
          <div className="relative border-y border-[var(--cmp-color-primary)]/15 bg-[var(--cmp-color-primary-light)]/60" id="trust">
            <PatternBand className="absolute inset-0" />
            <div className={`${container} relative grid grid-cols-2 lg:grid-cols-4 gap-6 py-5`}>
              {TRUST.map(t => (
                <div key={t.title}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-800">{t.title}</p>
                  <p className="text-[12px] text-gray-600 mt-0.5">{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── PLATFORM CAPABILITIES ─────────────────────────────────────────── */}
        <section id="platform" className={`${container} py-16 lg:py-20`}>
          <div className="text-center max-w-2xl mx-auto">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 text-balance">One Platform. Every Need.</h2>
            <p className="mt-2 text-[15px] text-gray-600">Integrated solutions to build capability, optimise workforce and improve care quality.</p>
          </div>
          <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {CAPABILITIES.map(c => (
              <div key={c.name} className="rounded-2xl border border-gray-200 bg-white p-5 hover:shadow-lg hover:-translate-y-0.5 transition-all">
                <span className="inline-flex w-9 h-9 rounded-xl items-center justify-center mb-3" style={{ backgroundColor: `color-mix(in srgb, ${c.accent} 14%, white)` }}>
                  <span className="w-3.5 h-3.5 rounded-[4px]" style={{ backgroundColor: c.accent }} />
                </span>
                <h3 className="text-[15px] font-bold" style={{ color: c.accent }}>{c.name}</h3>
                <ul className="mt-2.5 space-y-1.5">
                  {c.items.map(i => (
                    <li key={i} className="flex gap-1.5 text-[12px] text-gray-600 leading-snug">
                      <span aria-hidden className="text-gray-300">›</span>{i}
                    </li>
                  ))}
                </ul>
                <a href={c.href} className="mt-3 inline-block text-[12px] font-semibold" style={{ color: c.accent }}>Explore →</a>
              </div>
            ))}
          </div>
        </section>

        <PatternRule />

        {/* ── WORKFORCE LIFECYCLE ───────────────────────────────────────────── */}
        <section id="lifecycle" className="bg-[var(--cmp-neutral-50)]">
          <div className={`${container} py-16 lg:py-20`}>
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-gray-900 text-balance">Manage the Complete Workforce Lifecycle</h2>
              <p className="mt-2 text-[15px] text-gray-600">From recruitment to leadership development — Competen is with you every step.</p>
            </div>

            {/* Numbered because the order is real: you cannot certify before you assess. */}
            <ol className="mt-10 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-x-3 gap-y-8">
              {LIFECYCLE.map((s, i) => (
                <li key={s.stage} className="relative text-center">
                  <span className="mx-auto flex w-14 h-14 rounded-2xl bg-white ring-1 ring-gray-200 items-center justify-center text-[15px] font-bold text-[var(--cmp-color-primary)]">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-2.5 text-[13px] font-bold text-gray-900">{s.stage}</p>
                  <p className="mt-0.5 text-[11px] leading-snug text-gray-500 px-1">{s.body}</p>
                  {i < LIFECYCLE.length - 1 && (
                    <span aria-hidden className="hidden xl:block absolute top-7 -right-2 text-gray-300">→</span>
                  )}
                </li>
              ))}
            </ol>

            <div className="mt-10 rounded-2xl border border-dashed border-[var(--cmp-color-secondary)]/40 bg-[var(--cmp-color-secondary-light)]/50 px-5 py-4 text-center">
              <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--cmp-color-secondary)]">AI &amp; Analytics Layer</p>
              <p className="mt-1 text-[13px] text-gray-600">Intelligence that connects every step of your workforce journey.</p>
            </div>
          </div>
        </section>

        {/* ── PERSONAL TO PROFESSIONAL ──────────────────────────────────────── */}
        <section id="journey" className={`${container} py-16 lg:py-20`}>
          <div className="grid lg:grid-cols-12 gap-6 items-stretch">
            <PhotoSlot src={PHOTOS.nurse} className="hidden lg:block lg:col-span-2 rounded-2xl min-h-[300px]"
              alt="A nurse on the ward reviewing records on a tablet" />

            <div className="lg:col-span-4">
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 text-balance">{JOURNEY.title}</h2>
              <p className="mt-3 text-[14px] leading-relaxed text-gray-600">{JOURNEY.body}</p>
              <ul className="mt-4 space-y-1.5">
                {JOURNEY.points.map(p => (
                  <li key={p} className="flex gap-2 text-[13px] text-gray-700">
                    <span aria-hidden className="text-[var(--cmp-color-primary)]">✓</span>{p}
                  </li>
                ))}
              </ul>
              <Link href={JOURNEY.cta.href} className="mt-5 inline-block rounded-lg bg-[var(--cmp-color-primary)] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[var(--cmp-color-primary-dark)] transition-colors">
                {JOURNEY.cta.label} →
              </Link>
            </div>

            <div className="lg:col-span-4 grid sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 gap-3 items-start relative">
              {/* "Seamless Connection" node from the comp — the visual claim that the two workspaces are one
                  identity. Decorative and hidden from assistive tech; the assurance line below says it in
                  words, which is what a screen reader actually needs. */}
              <span aria-hidden className="hidden xl:flex absolute left-1/2 top-16 -translate-x-1/2 z-10 w-11 h-11 rounded-full bg-white ring-2 ring-[var(--cmp-color-secondary)]/25 shadow-md items-center justify-center text-[var(--cmp-color-secondary)] font-bold">
                C
              </span>
              {[JOURNEY.personal, JOURNEY.organisation].map(w => (
                <div key={w.title} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-[13px] font-bold text-[var(--cmp-color-secondary)]">{w.title}</p>
                  <p className="text-[11px] text-gray-500 mt-0.5">{w.body}</p>
                  <ul className="mt-2.5 space-y-1">
                    {w.items.map(i => (
                      <li key={i} className="flex gap-1.5 text-[12px] text-gray-600">
                        <span aria-hidden className="text-[var(--cmp-color-primary)]">✓</span>{i}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="sm:col-span-2 rounded-xl bg-[var(--cmp-neutral-50)] border border-gray-100 px-3 py-2 text-[11px] text-gray-500">
                🔒 {JOURNEY.assurance}
              </p>
            </div>

            <PhotoSlot src={PHOTOS.team} className="hidden lg:block lg:col-span-2 rounded-2xl min-h-[300px]"
              alt="Two clinical colleagues talking outside a hospital" />
          </div>
        </section>

        {/* ── WHO WE SERVE ──────────────────────────────────────────────────── */}
        <section id="audiences" className={`${container} pb-16 lg:pb-20`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#0B2A3B]">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative grid lg:grid-cols-4 gap-5 p-6 sm:p-8">
              <div className="lg:col-span-1">
                <h2 className="text-xl font-bold text-white text-balance">Who We Serve</h2>
                <p className="mt-2 text-[13px] text-white/60 leading-relaxed">Trusted by healthcare organisations across Africa and beyond.</p>
              </div>
              {/* Photo tiles, per the comp. The label sits BELOW the image rather than over it: the crops
                  already carry a caption baked in at that position in the comp, and overlaying a second one
                  would double it. */}
              <ul className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-7 gap-2">
                {AUDIENCES.map(a => (
                  <li key={a.label} className="rounded-xl overflow-hidden bg-white/10 ring-1 ring-white/15">
                    <PhotoSlot src={a.img} alt={a.label} className="h-16 w-full" />
                    <p className="px-1.5 py-2 text-center text-[11px] font-medium text-white/90 leading-tight">{a.label}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── IMPACT ────────────────────────────────────────────────────────── */}
        <section id="impact" className="bg-[var(--cmp-neutral-50)]">
          <div className={`${container} py-16 lg:py-20 grid lg:grid-cols-4 gap-6`}>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-gray-900 text-balance">Delivering Measurable Impact</h2>
              <p className="mt-2 text-[14px] text-gray-600">Better workforce. Better care. Better outcomes.</p>
            </div>
            <div className="lg:col-span-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
              {METRICS.map(m => (
                <div key={m.label} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <p className="text-[11px] font-semibold text-gray-500 leading-tight">{m.label}</p>
                  <p className="mt-1.5 text-xl font-bold text-[var(--cmp-color-primary)] tabular-nums leading-none">{m.value}</p>
                  <p className="mt-1 text-[11px] text-gray-400 leading-snug">{m.sub}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── CLOSING CTA ───────────────────────────────────────────────────── */}
        <section id="closing" className="relative overflow-hidden bg-[#0B2A3B]">
          {/* The comp puts an African sunset across the right half, fading into the deep navy. Masked with
              a gradient rather than reduced opacity so the copy side stays a solid, legible ground. */}
          <div aria-hidden className="absolute inset-y-0 right-0 w-full sm:w-3/5 lg:w-1/2">
            <PhotoSlot src={PHOTOS.sunset} alt="" className="h-full w-full opacity-70" />
            <div className="absolute inset-0 bg-gradient-to-r from-[#0B2A3B] via-[#0B2A3B]/70 to-transparent" />
          </div>
          <PatternBand className="absolute inset-0" tone="#FFFFFF" />
          <div className={`${container} relative py-14 lg:py-16`}>
            <h2 className="max-w-2xl text-2xl sm:text-3xl font-bold text-white leading-snug text-balance">{CLOSING.title}</h2>
            <p className="mt-3 text-[14px] text-white/70">{CLOSING.body}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href={CLOSING.primary.href} className="rounded-lg bg-[var(--cmp-color-primary)] px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-600 transition-colors">
                {CLOSING.primary.label} →
              </Link>
              <a href={CLOSING.secondary.href} className="rounded-lg border border-white/30 px-5 py-3 text-sm font-semibold text-white hover:bg-white/10 transition-colors">
                {CLOSING.secondary.label} ✆
              </a>
            </div>
          </div>
        </section>
      </main>

      {/* ── FOOTER ───────────────────────────────────────────────────────────── */}
      <footer className="bg-[#08202D] text-white/70">
        <div className={`${container} py-12 grid gap-8 lg:grid-cols-12`}>
          <div className="lg:col-span-3">
            <Logo dark />
            <form className="mt-5 max-w-xs" aria-label="Newsletter signup">
              <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">Stay Updated</p>
              <p className="mt-1 text-[12px] text-white/50">Subscribe for insights and updates.</p>
              <div className="mt-2.5 flex">
                <label htmlFor="newsletter-email" className="cmp-sr-only">Email address</label>
                <input id="newsletter-email" type="email" placeholder="Enter your email" required
                  className="min-w-0 flex-1 rounded-l-lg bg-white/10 ring-1 ring-white/15 px-3 py-2 text-[13px] text-white placeholder:text-white/35 focus:outline-none" />
                <button type="submit" aria-label="Subscribe"
                  className="rounded-r-lg bg-[var(--cmp-color-primary)] px-3 text-white text-sm font-semibold hover:bg-emerald-600 transition-colors">→</button>
              </div>
              {/* No mailing-list backend is wired, so the form does not pretend to have succeeded. */}
              <p className="mt-1.5 text-[10px] text-white/30">Signup is not yet connected — email us and we will add you.</p>
            </form>
          </div>

          <div className="lg:col-span-9 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-6">
            {FOOTER.map(col => (
              <div key={col.heading}>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">{col.heading}</p>
                <ul className="mt-2.5 space-y-1.5">
                  {col.links.map(l => (
                    <li key={col.heading + l.label}>
                      <a href={l.href} className="text-[12px] text-white/55 hover:text-white transition-colors">{l.label}</a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-white/10">
          <div className={`${container} py-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] text-white/40`}>
            <span>© {new Date().getFullYear()} {BRAND.name}. All rights reserved.</span>
            {FOOTER_LEGAL.map(l => (
              <a key={l.label} href={l.href} className="hover:text-white/70 transition-colors">{l.label}</a>
            ))}
            <span className="ml-auto">Built with purpose. Secured by design. 🔒</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
