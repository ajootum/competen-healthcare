import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import { PRODUCT_PAGES } from "@/lib/marketing/products";
import { pageMetadata } from "@/lib/marketing/site";

// ── THE COMPETEN INDIVIDUAL PUBLIC GATEWAY ── COMP-IND-UX-001 s6 ────────────────────────────────────
//
// Layer 2 of the spec's model: explain Individual and provide entry/acquisition actions. The layers
// behind it -- shared identity (s7), entitlement resolution (s8), the authenticated workspace (s10+)
// -- are SEPARATE ARCS THAT DO NOT EXIST YET for Individual, and this page does not pretend they do:
// its only doors are the conversation CTA and /individual/sign-in, whose being_built truth is pinned
// in src/lib/access-doors.ts ("no password field; the door says the product is being built first").
//
// CONTENT is s6.1's approved direction verbatim, single-sourced from PRODUCT_PAGES.individual (the
// same strings the homepage products section and the Products menu already publish): the headline,
// the supporting proposition and the four capabilities. s6.2 forbids organisation selection, employer
// selection and tenant discovery here -- there is none, and none may be added.
//
// ⚠ HARNESS PINS (scripts/public-disclosure-harness.ts, assertion 7k): this page must never carry
// href="/signup", must always contain the string "Talk to us about Competen", and must always link
// href="/individual/sign-in". Both CTA modes below keep all three true by construction.

const s = PRODUCT_PAGES.individual;
const t = s.template;

// ── CTA CONFIGURATION ── COMP-IND-UX-001 s6.1 ───────────────────────────────────────────────────────
//
// The spec's own interim clause: "If self-registration is not yet enabled, the current 'Talk to us
// about Competen Individual' CTA may remain as an interim acquisition action... configuration-driven
// so it can later switch to self-service without redesigning the page."
//
// "talk_to_us"    ACTIVE. Self-registration is CLOSED by the owner's standing decision (Supabase
//                 signups are off -- see the signup-stays-closed record), so the primary action is
//                 the conversation, exactly as the site's other not-yet-live product pages do it.
// "self_service"  INERT until the owner flips this constant. Renders "Create your account" wired to
//                 the product's own door (/individual/sign-in); product-aware registration (s6.2,
//                 /auth/register?product=individual) is a future identity-layer arc, and the door is
//                 the only honest destination that exists today. In this mode the conversation link
//                 is RETAINED as a quieter action: the disclosure harness (7k) pins it, and an open
//                 conversation stays true in either mode.
//
// ⚠ Flipping this constant is an OWNER decision, not a drift: it must accompany the identity /
// entitlement arcs actually existing (spec s7-s8) and a re-read of harness assertion 7k.
type GatewayCtaMode = "talk_to_us" | "self_service";
const GATEWAY_CTA_MODE: GatewayCtaMode = "talk_to_us";

/** The product's own access door -- status "being_built", pinned in src/lib/access-doors.ts. */
const SIGN_IN_DOOR = "/individual/sign-in";

const SELF_SERVICE_CTA = { label: "Create your account", href: SIGN_IN_DOOR };

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

// s14: every interactive target at least 44x44px, visible focus, state carried by text not colour.
const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 py-3 text-[15px] font-semibold "
  + "text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 "
  + "focus-visible:outline-gray-900";
const secondaryBtn =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-current px-5 py-3 text-[15px] "
  + "font-semibold transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 "
  + "focus-visible:outline-gray-900";

export const metadata = pageMetadata({
  title: `Competen Individual — ${s.body}`,
  description: s.body,
  path: "/individual",
  imageAlt: t.imageAlt,
});

export default function IndividualGatewayPage() {
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />

      <main id="main">
        <IndividualGatewayHero />

        {/* ── OUTCOMES, NOT MODULES (the disclosure rule) ─────────────────────────────────────── */}
        <section aria-labelledby="individual-outcomes" className={`${container} py-14 lg:py-16`}>
          <h2 id="individual-outcomes" className="text-center text-[1.6rem] font-bold tracking-tight text-gray-900">
            {t.featuresTitle}
          </h2>
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

        {/* ── CLOSING ACTION ──────────────────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 flex flex-col sm:flex-row sm:items-center gap-5"
            style={{ background: `color-mix(in srgb, ${s.accent} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={s.accent} opacity={0.10} />
            <span aria-hidden className="relative hidden sm:flex w-14 h-14 shrink-0 rounded-2xl bg-white items-center justify-center text-2xl shadow-sm">✦</span>
            <div className="relative flex-1">
              <p className="text-[17px] font-bold text-gray-900">{t.closing.title}</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{t.closing.body}</p>
            </div>
            {GATEWAY_CTA_MODE === "self_service" ? (
              <Link href={SELF_SERVICE_CTA.href} className={`relative shrink-0 ${primaryBtn}`} style={{ background: s.accent }}>
                {SELF_SERVICE_CTA.label}
              </Link>
            ) : (
              <a href={t.primary.href} className={`relative shrink-0 ${primaryBtn}`} style={{ background: s.accent }}>
                {t.closing.action}
              </a>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

// ── s16: IndividualGatewayHero ── the s6.1 primary content, one screen ──────────────────────────────
function IndividualGatewayHero() {
  return (
    <section className="relative overflow-hidden"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${s.accent} 9%, white), #fff)` }}>
      <div className={`${container} pt-6`}>
        <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
          {/* s14: the 44px target, without changing the site-wide breadcrumb's visual height --
              padding grows the hit area, the negative margin gives the space back to the layout. */}
          <Link href="/" className="inline-block px-1.5 -mx-1.5 py-3.5 -my-3.5 hover:text-gray-800">Home</Link>
          <span aria-hidden className="mx-1.5 text-gray-300">›</span>
          <span className="text-gray-700">{s.eyebrow}</span>
        </nav>
      </div>

      {/* s15: two-column with supporting visual only at >=1280px; below that the image follows the
          content in one column at a shorter aspect, so it never dominates; never any horizontal
          scroll down to 320px. */}
      <div className={`${container} grid xl:grid-cols-2 gap-10 items-center py-10 lg:py-14`}>
        <div>
          <h1 className="text-[2.2rem] sm:text-[3rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
            {t.headline.map(line => <span key={line} className="block">{line}</span>)}
          </h1>
          <p className="mt-4 max-w-md text-[15.5px] leading-relaxed text-gray-600">{s.body}</p>

          <IndividualCapabilityList />
          <IndividualGatewayActions />
        </div>

        <div className="relative rounded-3xl overflow-hidden bg-[var(--cmp-neutral-100)] aspect-[16/7] xl:aspect-[4/3]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={t.image} alt={t.imageAlt} className="w-full h-full object-cover object-top" />
        </div>
      </div>
    </section>
  );
}

// ── s16: IndividualCapabilityList ── the four s6.1 capabilities, check-marked not colour-coded ──────
function IndividualCapabilityList() {
  return (
    <ul aria-label="What Competen Individual holds for you" className="mt-6 space-y-2.5">
      {t.points.map(p => (
        <li key={p} className="flex gap-2.5 text-[14px] text-gray-700">
          <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
            style={{ background: s.accent }}>✓</span>
          {p}
        </li>
      ))}
    </ul>
  );
}

// ── s16: IndividualGatewayActions ── one obvious primary action per state (s14) ─────────────────────
//
// talk_to_us:   primary = the conversation (mailto, the site's standing pattern); secondary = Sign in
//               to the product's own door.
// self_service: primary = Create your account, wired to the same door (the only real destination
//               until the identity arc exists); secondary = Sign in; the conversation stays as a
//               quieter third link -- see the CTA CONFIGURATION note above.
function IndividualGatewayActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {GATEWAY_CTA_MODE === "self_service" ? (
        <>
          <Link href={SELF_SERVICE_CTA.href} className={primaryBtn} style={{ background: s.accent }}>
            {SELF_SERVICE_CTA.label}
          </Link>
          <Link href={SIGN_IN_DOOR} className={secondaryBtn} style={{ color: s.accent }}>
            Sign in <span aria-hidden>→</span>
          </Link>
          <a href={t.primary.href}
            className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-gray-600 underline underline-offset-4 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
            {t.primary.label}
          </a>
        </>
      ) : (
        <>
          <a href={t.primary.href} className={primaryBtn} style={{ background: s.accent }}>
            {t.primary.label}
          </a>
          <Link href={SIGN_IN_DOOR} className={secondaryBtn} style={{ color: s.accent }}>
            Sign in <span aria-hidden>→</span>
          </Link>
        </>
      )}
    </div>
  );
}
