import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import {
  Breadcrumb, ExperienceMark, FlowChips, LifecycleJourney, PassportBand, SignaturePanel,
  container, primaryBtn, secondaryBtn,
} from "@/components/marketing/IndividualFamily";
import { EXPERIENCE_LIST, INDIVIDUAL, INDIVIDUAL_SIGN_IN, enquiryHref } from "@/lib/marketing/individual-family";
import { pageMetadata } from "@/lib/marketing/site";

// ── THE COMPETEN INDIVIDUAL PUBLIC GATEWAY ── COMP-IND-UX-001 s6, redesigned by COMPETEN-WEB-IND-001 s2 ─
//
// Layer 2 of COMP-IND-UX-001's model: explain Individual and provide entry/acquisition actions. WEB-IND-001
// (COMPETEN-IND-001 Option B) makes the explanation the FAMILY: Individual is the lifelong personal product,
// presented through two independently branded experiences -- Competen Scholar and Competen Professional --
// joined by one identity, one learning history and one Competen Passport. Content is single-sourced from
// src/lib/marketing/individual-family.ts, which the experience pages, header and homepage also read.
//
// The layers behind this page -- shared identity (s7), entitlement resolution (s8), the authenticated
// workspace (s10+) -- are SEPARATE ARCS that do not exist yet for Individual, and this page does not
// pretend they do: its only doors are the conversation CTA and /individual/sign-in, whose being_built
// truth is pinned in src/lib/access-doors.ts. s6.2 forbids organisation selection, employer selection and
// tenant discovery here -- there is none, and none may be added.
//
// ⚠ HARNESS PINS (scripts/public-disclosure-harness.ts, assertion 7k): this page must never carry
// href="/signup", must always contain the string "Talk to us about Competen", and must always link
// href="/individual/sign-in". Both CTA modes below keep all three true by construction.

// ── CTA CONFIGURATION ── COMP-IND-UX-001 s6.1 ───────────────────────────────────────────────────────
//
// "talk_to_us"    ACTIVE. Self-registration is CLOSED by the owner's standing decision, so the primary
//                 action is the conversation, exactly as the site's other not-yet-live product pages do it.
// "self_service"  INERT until the owner flips this constant. Renders "Create your account" wired to the
//                 product's own door; the conversation link is RETAINED as a quieter action because the
//                 disclosure harness (7k) pins it and an open conversation stays true in either mode.
//
// ⚠ Flipping this constant is an OWNER decision, not a drift: it must accompany the identity /
// entitlement arcs actually existing (spec s7-s8) and a re-read of harness assertion 7k.
type GatewayCtaMode = "talk_to_us" | "self_service";
const GATEWAY_CTA_MODE: GatewayCtaMode = "talk_to_us";

const SELF_SERVICE_CTA = { label: "Create your account", href: INDIVIDUAL_SIGN_IN };
// ⚠ ONE template string -- see ExperiencePage: adjacent JSX text splits the phrase the harness searches for.
const TALK = `Talk to us about ${INDIVIDUAL.name}`;

export const metadata = pageMetadata({
  title: `${INDIVIDUAL.name} — ${INDIVIDUAL.tagline}`,
  description: INDIVIDUAL.body,
  path: INDIVIDUAL.href,
  imageAlt: "Competen Scholar and Competen Professional, one continuous journey",
});

export default function IndividualGatewayPage() {
  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />

      <main id="main">
        <IndividualGatewayHero />
        <ExperienceChooser />
        <LifecycleJourney />
        <PassportBand line="One account for every stage. Whenever you add Professional, your learning record stays connected." />

        {/* ── CLOSING ACTION ──────────────────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 flex flex-col sm:flex-row sm:items-center gap-5"
            style={{ background: `color-mix(in srgb, ${INDIVIDUAL.accent} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={INDIVIDUAL.accent} opacity={0.10} />
            <span aria-hidden className="relative hidden sm:flex w-14 h-14 shrink-0 rounded-2xl bg-white items-center justify-center text-2xl shadow-sm">✦</span>
            <div className="relative flex-1">
              <h2 className="text-[17px] font-bold text-gray-900">{INDIVIDUAL.closing.title}</h2>
              <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{INDIVIDUAL.closing.body}</p>
            </div>
            {GATEWAY_CTA_MODE === "self_service" ? (
              <Link href={SELF_SERVICE_CTA.href} className={`relative shrink-0 ${primaryBtn}`} style={{ background: INDIVIDUAL.accent }}>
                {SELF_SERVICE_CTA.label}
              </Link>
            ) : (
              <a href={enquiryHref(INDIVIDUAL.contact)} className={`relative shrink-0 ${primaryBtn}`} style={{ background: INDIVIDUAL.accent }}>
                Talk to us
              </a>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

// ── IndividualGatewayHero ── the s2 proposition, one screen ─────────────────────────────────────────
function IndividualGatewayHero() {
  return (
    <section className="relative overflow-hidden"
      style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${INDIVIDUAL.accent} 9%, white), #fff)` }}>
      <div className={`${container} pt-6`}>
        <Breadcrumb trail={[{ label: "Home", href: "/" }, { label: "Individual" }]} />
      </div>

      {/* Two columns only at >=1280px (COMP-IND-UX-001 s15); below that the panel follows the content in
          one column, and nothing scrolls sideways down to 320px. */}
      <div className={`${container} grid xl:grid-cols-[1.25fr_1fr] gap-10 items-center py-10 lg:py-14`}>
        <div>
          <ExperienceMark wordmark={INDIVIDUAL.wordmark} accent={INDIVIDUAL.accent} />
          <p className="mt-6 text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: INDIVIDUAL.accent }}>
            {INDIVIDUAL.eyebrow}
          </p>
          <h1 className="mt-3 text-[2.2rem] sm:text-[3.1rem] font-bold tracking-tight text-gray-900 leading-[1.06] text-balance">
            {INDIVIDUAL.headline.map(line => <span key={line} className="block">{line}</span>)}
          </h1>
          <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-gray-600">{INDIVIDUAL.body}</p>
          <IndividualGatewayActions />
        </div>

        <SignaturePanel title={INDIVIDUAL.signature.title} flow={INDIVIDUAL.signature.flow}
          accent={INDIVIDUAL.accent} accentSoft={INDIVIDUAL.accentSoft} />
      </div>
    </section>
  );
}

// ── IndividualGatewayActions ── one obvious primary action per state (s14) ──────────────────────────
function IndividualGatewayActions() {
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3">
      {GATEWAY_CTA_MODE === "self_service" ? (
        <>
          <Link href={SELF_SERVICE_CTA.href} className={primaryBtn} style={{ background: INDIVIDUAL.accent }}>
            {SELF_SERVICE_CTA.label}
          </Link>
          <Link href={INDIVIDUAL_SIGN_IN} className={secondaryBtn} style={{ color: INDIVIDUAL.accent }}>
            Sign in <span aria-hidden>→</span>
          </Link>
          <a href={enquiryHref(INDIVIDUAL.contact)}
            className="inline-flex min-h-[44px] items-center text-[14px] font-semibold text-gray-600 underline underline-offset-4 hover:text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
            {TALK}
          </a>
        </>
      ) : (
        <>
          <a href={enquiryHref(INDIVIDUAL.contact)} className={primaryBtn} style={{ background: INDIVIDUAL.accent }}>
            {TALK}
          </a>
          <Link href={INDIVIDUAL_SIGN_IN} className={secondaryBtn} style={{ color: INDIVIDUAL.accent }}>
            Sign in <span aria-hidden>→</span>
          </Link>
        </>
      )}
    </div>
  );
}

// ── ExperienceChooser ── s2: two prominent, independently branded experiences ───────────────────────
function ExperienceChooser() {
  return (
    <section aria-labelledby="experiences-title" className={`${container} pt-14 lg:pt-16`}>
      <div className="max-w-2xl">
        <h2 id="experiences-title" className="text-[1.6rem] font-bold tracking-tight text-gray-900">{INDIVIDUAL.experiencesTitle}</h2>
        <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">{INDIVIDUAL.experiencesBody}</p>
      </div>
      <ul className="mt-8 grid gap-5 lg:grid-cols-2">
        {EXPERIENCE_LIST.map(e => (
          <li key={e.key}>
            <Link href={e.href}
              className="group relative flex h-full flex-col overflow-hidden rounded-3xl border border-gray-200 bg-white hover:shadow-xl hover:-translate-y-0.5 transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900">
              <div className="relative px-6 pt-6 pb-5 sm:px-8 sm:pt-8" style={{ background: `linear-gradient(140deg, ${e.accentSoft}, #fff 80%)` }}>
                <PatternField className="absolute inset-0" tone={e.accent} opacity={0.07} />
                <div className="relative flex items-start justify-between gap-4">
                  <ExperienceMark wordmark={e.wordmark} accent={e.accent} />
                  <span className="text-[11.5px] font-semibold text-gray-500">{e.tagline}</span>
                </div>
                <h3 className="relative mt-6 text-[1.45rem] font-bold leading-tight tracking-tight text-gray-900">{e.name}</h3>
                <p className="relative mt-2 text-[14px] leading-relaxed text-gray-600">{e.body}</p>
              </div>
              <div className="flex flex-1 flex-col px-6 pb-6 pt-5 sm:px-8 sm:pb-8">
                {/* The experience's five demonstration steps -- the same flow its own page opens with. */}
                <FlowChips steps={e.steps.map(s => s.label)} accent={e.accent} />
                <span className="mt-6 inline-flex items-center text-[14.5px] font-semibold" style={{ color: e.accent }}>
                  {`Explore ${e.name.replace("Competen ", "")}`}
                  <span aria-hidden className="ml-1.5 inline-block transition-transform group-hover:translate-x-0.5">→</span>
                </span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
