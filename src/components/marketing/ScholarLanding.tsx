import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import {
  Breadcrumb, ExperienceMark, ExperienceNav, OperatorNotice, container, primaryBtn, secondaryBtn,
} from "@/components/marketing/IndividualFamily";
import {
  INDIVIDUAL, PROFESSIONAL, SCHOLAR, enquiryHref, experienceSignIn, scholarGetStarted, type ScholarIcon,
} from "@/lib/marketing/individual-family";
import { productTheme } from "@/lib/design/tokens";

// THE COMPETEN SCHOLAR LANDING PAGE -- SCHOLAR-WEB-REDESIGN-01 (owner, 29 Oct 2026), replacing the
// step-by-step ExperiencePage template for /scholar. Five sections: hero, benefits, learning that grows with
// you, audiences, get started. It SELLS THE VALUE: every word comes from SCHOLAR.landing, written under the
// content classes recorded there, and nothing here shows how the product works inside.
//
// ⚠ GET STARTED IS AVAILABILITY-AWARE. `joinOpen` is the server's selfRegistrationEnabled answer, read by
// the page per request; scholarGetStarted() turns it into an href that is never a sign-up the gates refuse.
// ⚠ md IS THE LAYOUT EDGE (CPR-MOB-001); lg only raises the type scale and lays wider rows out denser. Every target is
// 44px+ (primaryBtn / secondaryBtn), focus is visible on both light and dark grounds.

const S = SCHOLAR;
const L = S.landing;
const indigo = productTheme.professional;
const teal = productTheme.scholar;
const onDark = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

/** A CTA: an in-app route goes through Link; an anchor or the enquiry mailto is a plain link. */
function Cta({ href, className, style, children }: { href: string; className: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return href.startsWith("/")
    ? <Link href={href} className={className} style={style}>{children}</Link>
    : <a href={href} className={className} style={style}>{children}</a>;
}

export default function ScholarLanding({ joinOpen }: { joinOpen: boolean }) {
  const talk = enquiryHref(S.contact);
  const school = enquiryHref({ email: S.contact.email, subject: L.subjects.school });

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <ExperienceNav e={S} />

      <main id="main">
        {/* ── A. HERO ─────────────────────────────────────────────────────── */}
        <section id="overview" aria-labelledby="overview-title" className="relative overflow-hidden scroll-mt-36"
          style={{ background: `linear-gradient(180deg, ${S.accentSoft}, #fff 85%)` }}>
          <PatternField className="absolute inset-0" tone={S.accent} opacity={0.05} />
          <div className={`relative ${container} pt-6`}>
            <Breadcrumb trail={[
              { label: "Home", href: "/" },
              { label: "Individual", href: INDIVIDUAL.href },
              { label: S.name.replace("Competen ", "") },
            ]} />
          </div>

          <div className={`relative ${container} grid gap-10 py-10 md:grid-cols-[1fr_1.05fr] md:items-center md:py-14`}>
            <div>
              {/* Phone only: from sm up the product bar above already carries the wordmark. */}
              <div className="mb-6 sm:hidden"><ExperienceMark wordmark={S.wordmark} accent={S.accent} /></div>
              <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: S.accent }}>{S.eyebrow}</p>
              <h1 id="overview-title" className="mt-3 text-[2.2rem] lg:text-[3.2rem] font-bold tracking-tight text-gray-900 leading-[1.06] text-balance">
                {S.headline.map(line => <span key={line} className="block">{line}</span>)}
              </h1>
              <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-gray-600">{S.body}</p>
              <p className="mt-3 text-[12.5px] font-semibold text-gray-600">{S.tagline}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Cta href={scholarGetStarted(joinOpen, "hero")} className={primaryBtn} style={{ background: S.accent }}>
                  {L.hero.primary} <span aria-hidden className="ml-1.5">→</span>
                </Cta>
                <a href={talk} className={`${secondaryBtn} bg-white`} style={{ color: S.accent }}>{L.hero.secondary}</a>
              </div>
            </div>

            {/* The approved photograph. Pre-built AVIF/WebP widths (scripts/build-scholar-images.mjs), the
                repo's convention for static marketing art; eager and high priority because it is the LCP. */}
            <div className="relative">
              <span aria-hidden className="absolute -left-10 -bottom-8 hidden h-56 w-56 rounded-full md:block"
                style={{ background: `color-mix(in srgb, ${S.accent} 14%, transparent)` }} />
              <ScholarPhoto src={S.image} alt={S.imageAlt} eager position="45% 40%"
                className="relative aspect-[16/10] w-full rounded-[2rem] object-cover shadow-xl shadow-black/5 md:aspect-[5/4] md:rounded-l-[9rem] md:rounded-r-[2rem]" />
            </div>
          </div>
        </section>

        {/* ── B. BENEFITS ─────────────────────────────────────────────────── */}
        <section id="benefits" aria-labelledby="benefits-title" className={`${container} scroll-mt-36 py-14 md:py-16`}>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: S.accent }}>{L.benefits.eyebrow}</p>
            <h2 id="benefits-title" className="mt-2 text-[1.7rem] lg:text-[2rem] font-bold tracking-tight text-gray-900 text-balance">{L.benefits.title}</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-gray-600">{L.benefits.body}</p>
          </div>
          <ul className="mt-10 grid gap-8 md:grid-cols-3 md:gap-0 md:divide-x md:divide-gray-200">
            {L.benefits.items.map(b => {
              const tone = b.tone === "indigo" ? indigo : teal;
              return (
                <li key={b.title} className="flex gap-4 md:flex-col lg:flex-row md:px-7 md:first:pl-0 md:last:pr-0">
                  <IconChip icon={b.icon} accent={tone.accent} soft={tone.soft} />
                  <div>
                    <h3 className="text-[17px] font-bold leading-snug text-gray-900">{b.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-gray-600">{b.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ── C. LEARNING THAT GROWS WITH YOU ─────────────────────────────── */}
        <section id="journey" aria-labelledby="journey-title" className={`${container} scroll-mt-36 pb-14 md:pb-16`}>
          <div className="relative grid overflow-hidden rounded-3xl bg-amber-50/70 ring-1 ring-black/5 md:grid-cols-2 md:items-stretch">
            <div className="p-6 sm:p-9 md:py-12">
              <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: S.accent }}>{L.journey.eyebrow}</p>
              <h2 id="journey-title" className="mt-2 text-[1.6rem] lg:text-[1.9rem] font-bold tracking-tight text-gray-900 text-balance">{L.journey.title}</h2>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-gray-700">{L.journey.body}</p>
              <p className="mt-3 max-w-lg text-[15px] leading-relaxed text-gray-700">{L.journey.professionalLine}</p>
              <div className="mt-7">
                <Cta href={L.journey.cta.href} className={primaryBtn} style={{ background: S.accent }}>
                  {L.journey.cta.label} <span aria-hidden className="ml-1.5">→</span>
                </Cta>
              </div>
            </div>
            <JourneyPicture />
          </div>
        </section>

        {/* ── D. AUDIENCES ────────────────────────────────────────────────── */}
        <section aria-labelledby="audiences-title" className={`${container} pb-14 md:pb-16`}>
          <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: S.accent }}>{L.audiences.eyebrow}</p>
          <h2 id="audiences-title" className="mt-2 text-[1.6rem] lg:text-[1.9rem] font-bold tracking-tight text-gray-900 text-balance">{L.audiences.title}</h2>
          <ul className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {L.audiences.items.map(a => (
              <li key={a.key} className="flex gap-4 rounded-2xl border border-gray-200 bg-white p-5">
                <IconChip icon={a.icon} accent={S.accent} soft={S.accentSoft} />
                <div>
                  <h3 className="text-[15.5px] font-bold leading-snug text-gray-900">{a.title}</h3>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{a.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* ── E. GET STARTED ──────────────────────────────────────────────── */}
        <section id="start" aria-labelledby="start-title" className={`${container} scroll-mt-36 pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-9 sm:px-10 sm:py-11" style={{ background: teal.strong }}>
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.07} />
            <div className="relative grid gap-7 md:grid-cols-[1.4fr_1fr] md:items-center">
              <div>
                <p className="text-[12px] font-bold uppercase tracking-[0.16em] text-white/85">{L.start.eyebrow}</p>
                <h2 id="start-title" className="mt-2 text-[1.6rem] lg:text-[2rem] font-bold leading-tight tracking-tight text-white text-balance">{L.start.title}</h2>
                <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-white/90">{L.start.body}</p>
                {!joinOpen && (
                  <p className="mt-4 max-w-xl rounded-xl bg-white/10 px-4 py-3 text-[14px] leading-relaxed text-white">
                    {L.start.closedNote}{" "}
                    <span className="whitespace-nowrap">
                      {L.start.invited}{" "}
                      <Link href={experienceSignIn(S.key)} className={`font-semibold underline underline-offset-2 rounded ${onDark}`}>{L.start.signIn}</Link>
                    </span>
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-3 sm:flex-row md:flex-col md:items-stretch">
                <Cta href={scholarGetStarted(joinOpen, "start")}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white px-6 py-3 text-[15px] font-semibold hover:bg-white/90 ${onDark}`}
                  style={{ color: teal.ink }}>
                  {L.start.primary} <span aria-hidden className="ml-1.5">→</span>
                </Cta>
                <a href={school}
                  className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border border-white/80 px-6 py-3 text-[15px] font-semibold text-white hover:bg-white/10 ${onDark}`}>
                  {L.start.school}
                </a>
              </div>
            </div>
          </div>
        </section>

        <OperatorNotice e={S} />
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The approved photographs as a <picture>: pre-built AVIF and WebP widths (scripts/build-scholar-images.mjs),
 * the repo's convention for static marketing art, with the supplied master as the widest WebP. `src` is the
 * master; the variants sit beside it as <name>-<width>.<ext>. The hero is eager and high priority (the LCP);
 * everything below the fold is lazy.
 */
export const SCHOLAR_PHOTO_WIDTHS = [640, 1024] as const;
const MASTER_WIDTH = 1672, MASTER_HEIGHT = 941;
function ScholarPhoto({ src, alt, className, position, eager = false }: {
  src: string; alt: string; className: string; position?: string; eager?: boolean;
}) {
  const base = src.replace(/\.webp$/, "");
  const sizes = "(min-width: 768px) 50vw, 100vw";
  const set = (ext: "avif" | "webp") => [
    ...SCHOLAR_PHOTO_WIDTHS.map(w => `${base}-${w}.${ext} ${w}w`),
    `${ext === "avif" ? `${base}-${MASTER_WIDTH}.avif` : src} ${MASTER_WIDTH}w`,
  ].join(", ");
  return (
    <picture className="block h-full">
      <source type="image/avif" sizes={sizes} srcSet={set("avif")} />
      <source type="image/webp" sizes={sizes} srcSet={set("webp")} />
      <img src={src} alt={alt} width={MASTER_WIDTH} height={MASTER_HEIGHT} decoding="async"
        loading={eager ? "eager" : "lazy"} fetchPriority={eager ? "high" : "auto"}
        className={className} style={position ? { objectPosition: position } : undefined} />
    </picture>
  );
}

/**
 * Section C's picture: the owner-supplied photograph of a student studying on a laptop (29 Oct). Should
 * L.journey.image ever be unset, a drawn panel stands in -- Scholar leading on to Professional, the
 * relationship and not how it works -- never a crop of the mockup or a stock image.
 */
function JourneyPicture() {
  const img = L.journey.image;
  if (img) {
    return (
      <ScholarPhoto src={img.src} alt={img.alt} position="50% 35%"
        className="aspect-[16/10] h-full w-full object-cover md:aspect-auto md:min-h-[320px] md:rounded-l-[8rem]" />
    );
  }
  const stages = [
    { label: "Study", tone: teal }, { label: "Graduate", tone: teal }, { label: "Practise", tone: indigo },
  ];
  return (
    <div role="img" aria-label={`${S.name} leading on to ${PROFESSIONAL.name}: study, graduate, practise`}
      className="relative flex min-h-[240px] items-center justify-center overflow-hidden p-8 md:rounded-l-[8rem] md:pl-16"
      style={{ background: `linear-gradient(135deg, ${teal.soft}, ${indigo.soft})` }}>
      <PatternField className="absolute inset-0" tone={S.accent} opacity={0.09} />
      <div aria-hidden className="relative flex flex-col items-center gap-6">
        {/* A row, except in the narrow half-width panel between md and lg, where the two marks stack. */}
        <div className="flex items-center gap-3 sm:gap-4 md:flex-col lg:flex-row">
          <span className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5"><ExperienceMark wordmark={S.wordmark} accent={S.accent} size="sm" /></span>
          <span className="w-8 sm:w-14 border-t-2 border-dashed md:h-6 md:w-0 md:border-t-0 md:border-l-2 lg:h-0 lg:w-14 lg:border-l-0 lg:border-t-2" style={{ borderColor: S.accent }} />
          <span className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5"><ExperienceMark wordmark={PROFESSIONAL.wordmark} accent={PROFESSIONAL.accent} size="sm" /></span>
        </div>
        <ol className="flex flex-wrap justify-center gap-2">
          {stages.map(s => (
            <li key={s.label} className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold ring-1 ring-black/5" style={{ color: s.tone.ink }}>
              {s.label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/** A round icon chip. Decorative: every icon sits beside its own text heading. */
function IconChip({ icon, accent, soft }: { icon: ScholarIcon; accent: string; soft: string }) {
  return (
    <span aria-hidden className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full" style={{ background: soft, color: accent }}>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon]}
      </svg>
    </span>
  );
}

const ICONS: Record<ScholarIcon, React.ReactNode> = {
  book: <><path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" /><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z" /></>,
  cap: <><path d="M22 10 12 5 2 10l10 5 10-5z" /><path d="M6 12v5c3 2.5 9 2.5 12 0v-5" /><path d="M22 10v6" /></>,
  stethoscope: <><path d="M6 3H5a1 1 0 0 0-1 1v5a5 5 0 0 0 10 0V4a1 1 0 0 0-1-1h-1" /><path d="M9 14v1a6 6 0 0 0 12 0v-3" /><circle cx="21" cy="10" r="2" /></>,
  people: <><circle cx="9" cy="7" r="4" /><path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>,
  heart: <><path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z" /><path d="M3.5 12h6l.5-1 2 4.5 2-7 1.5 3.5h5" /></>,
  building: <><path d="M3 22h18" /><path d="M6 18v-7" /><path d="M10 18v-7" /><path d="M14 18v-7" /><path d="M18 18v-7" /><path d="M12 2 20 7H4z" /></>,
};
