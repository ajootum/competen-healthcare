import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import { PRODUCTS } from "@/lib/marketing/products";
import { pageMetadata } from "@/lib/marketing/site";
import {
  CANDIDATE_CTA, CANDIDATE_CTA_MODE, EMPLOYER_CTA, RECRUITMENT_ENQUIRY,
} from "./gateway-config";

// ── THE RECRUITMENT GATEWAY ── COMP-REC-UX-001 s6/s7 ────────────────────────────────────────────
//
// One gateway, two audiences as immediately distinguishable PATHWAYS -- no modal, no questionnaire
// (s7). This page supersedes the SolutionPage marketing template on this route: the template sold
// one proposition to one audience, and Recruitment is two-sided by architecture (s2). The
// propositions below are the spec's own, verbatim where s6 gives them.
//
// WHAT THIS PAGE DELIBERATELY IS NOT (s6/s7): not a job board -- no vacancies, no listings; not an
// admin screen -- no employer names, no candidate lists, no internal Recruitment data.
//
// HOW INTENT TRAVELS (s7/s8). The sign-in door is PATH-BASED (src/lib/access-doors.ts:
// RECRUITMENT -> /recruitment/sign-in), so the path itself carries product=recruitment; the
// pathway links add only persona. Query parameters communicate intent and grant nothing (s2) --
// today the door honestly says the product is being built (status "being_built", no password
// field), and the persona survives in the URL for the day the resolver exists.
//
// ACQUISITION IS CLOSED-MODE (owner's standing decision -- signup stays off): both pathways
// acquire through the honest mailto pattern. The candidate CTA reads ./gateway-config.ts so
// candidate self-service (the spec's s13 phasing) opens by flipping one constant, not redesigning.
//
// ⚠ PINNED BY scripts/public-disclosure-harness.ts -- do not break while editing copy:
//   7k: no href="/signup"; raw HTML contains `Talk to us about Competen` (the closing CTA) and
//       the exact string `href="/recruitment/sign-in"` (the hero's neutral sign-in -- the persona
//       links carry queries, so they alone cannot satisfy the needle);
//   2b/2d: no forbidden product vocabulary in visible text or metadata;
//   2g: no numeric adoption claims;  2e/2f: pageMetadata() keeps canonical and og:title its own.

const REC_ACCENT = PRODUCTS.find(p => p.key === "recruitment")?.accent ?? "#7C3AED";
const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export const metadata = pageMetadata({
  title: "Competen Recruitment — for healthcare talent and employers",
  description:
    "One gateway, two journeys: healthcare professionals carry verified capability into "
    + "opportunities, and employers find and assess talent using structured capability evidence, "
    + "not CVs alone.",
  path: "/recruitment",
});

// 44×44 minimum targets (s18) built into the shared button shapes rather than remembered per CTA.
const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 py-3 text-[15px] "
  + "font-semibold text-white transition-opacity hover:opacity-90";
const secondaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 px-5 "
  + "py-3 text-[14px] font-semibold text-gray-700 hover:bg-gray-50";

/** A CTA that may be a mailto (today's closed mode) or an internal route (a flipped mode). */
function PrimaryCta({ label, href }: { label: string; href: string }) {
  return href.startsWith("/")
    ? <Link href={href} className={primaryBtn} style={{ background: REC_ACCENT }}>{label}</Link>
    : <a href={href} className={primaryBtn} style={{ background: REC_ACCENT }}>{label}</a>;
}

/**
 * RecruitmentAudiencePathCard (s19). The two cards share one Recruitment brand (s6) and are told
 * apart by WORDS -- eyebrow, heading, proposition -- never by colour alone (s18).
 */
function RecruitmentAudiencePathCard(props: {
  id: string;
  eyebrow: string;
  title: string;
  proposition: string;
  points: string[];
  primary: { label: string; href: string };
  secondary: { label: string; href: string };
}) {
  return (
    <section aria-labelledby={`${props.id}-title`}
      className="relative flex flex-col rounded-3xl border border-gray-200 bg-white p-6 sm:p-8 shadow-sm">
      <p className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: REC_ACCENT }}>
        {props.eyebrow}
      </p>
      <h3 id={`${props.id}-title`} className="mt-2 text-[1.4rem] font-bold tracking-tight text-gray-900">
        {props.title}
      </h3>
      <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">{props.proposition}</p>
      <ul className="mt-4 space-y-2">
        {props.points.map(pt => (
          <li key={pt} className="flex gap-2.5 text-[13.5px] text-gray-700">
            <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
              style={{ background: REC_ACCENT }}>✓</span>
            {pt}
          </li>
        ))}
      </ul>
      {/* ONE primary CTA per pathway (s17); the sign-in stays secondary and outlined. */}
      <div className="mt-auto pt-6 flex flex-wrap items-center gap-3">
        <PrimaryCta {...props.primary} />
        <Link href={props.secondary.href} className={secondaryBtn}>{props.secondary.label}</Link>
      </div>
    </section>
  );
}

export default function Page() {
  const candidateCta = CANDIDATE_CTA[CANDIDATE_CTA_MODE];

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />

      <main id="main">
        {/* ── RecruitmentGatewayHero (s19): one Recruitment brand over both journeys ──────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${REC_ACCENT} 8%, white), #fff)` }}>
          <div className={`${container} pt-6`}>
            <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
              {/* The negative margins cancel the padding visually, leaving a ~44px tap target (s18)
                  on a link that still renders as one breadcrumb-sized word. */}
              <Link href="/" className="inline-block px-2 -mx-2 py-3.5 -my-3.5 hover:text-gray-800">Home</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <span className="text-gray-700">Recruitment</span>
            </nav>
          </div>

          <div className={`${container} py-10 lg:py-14 max-w-3xl lg:mx-auto lg:text-center`}>
            <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: REC_ACCENT }}>
              Competen Recruitment
            </p>
            <h1 className="mt-3 text-[2.2rem] sm:text-[3rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">
              <span className="block">Healthcare recruitment,</span>
              <span className="block">on verified ground.</span>
            </h1>
            <p className="mt-4 text-[15.5px] leading-relaxed text-gray-600">
              Two sides of one hire: professionals carrying verified capability into opportunities,
              and the organisations recruiting them. Choose your path below.
            </p>
            {/* The NEUTRAL door -- product context only, no persona claimed. ⚠ Exactly
                href="/recruitment/sign-in": the disclosure harness's 7k needle requires the bare
                path, and the persona-carrying links below append queries. */}
            <p className="mt-5 text-[13.5px] text-gray-600">
              Already have a Competen account?{" "}
              <Link href="/recruitment/sign-in"
                className="inline-flex min-h-[44px] items-center px-1 font-semibold underline underline-offset-4"
                style={{ color: REC_ACCENT }}>
                Sign in
              </Link>
            </p>
          </div>
        </section>

        {/* ── The two pathways (s6/s7): visible, distinct, and both present at every width ────── */}
        <section className={`${container} py-12 lg:py-14`} aria-label="Choose your Recruitment path">
          <h2 className="text-center text-[1.6rem] font-bold tracking-tight text-gray-900">
            Which side are you on?
          </h2>
          <p className="mt-2 text-center text-[13.5px] text-gray-600">
            One product, two journeys — each with its own way in.
          </p>

          {/* Stacks on mobile with BOTH audiences fully visible (s18) -- talent first, the spec's
              own order (s6). */}
          <div className="mt-8 grid gap-5 lg:grid-cols-2">
            <RecruitmentAudiencePathCard
              id="talent"
              eyebrow="Talent · Candidates"
              title="For healthcare professionals seeking opportunities"
              proposition={
                "Carry verified capability into opportunities and make it easier for employers "
                + "to understand readiness."
              }
              points={[
                "A verified record of capability, not just a CV",
                "Opportunities and applications in one place",
                "Your record stays yours between employers",
              ]}
              primary={candidateCta}
              secondary={{ label: "Sign in", href: "/recruitment/sign-in?persona=candidate" }}
            />
            <RecruitmentAudiencePathCard
              id="employer"
              eyebrow="Employers · Organisations"
              title="For hospitals, practices and healthcare organisations recruiting staff"
              proposition={
                "Find and assess healthcare talent using structured capability evidence, "
                + "not CVs alone."
              }
              points={[
                "Assess applicants on structured capability evidence",
                "Interviews and offers in one place",
                "Built for healthcare recruitment",
              ]}
              primary={EMPLOYER_CTA}
              secondary={{ label: "Employer sign in", href: "/recruitment/sign-in?persona=employer" }}
            />
          </div>
        </section>

        {/* ── Closing: the honest state of the product, and the gateway-level conversation ─────
            ⚠ The CTA label carries the harness needle "Talk to us about Competen" (7k). */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-7 sm:px-9 flex flex-col sm:flex-row sm:items-center gap-5"
            style={{ background: `color-mix(in srgb, ${REC_ACCENT} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={REC_ACCENT} opacity={0.10} />
            <div className="relative flex-1">
              <p className="text-[17px] font-bold text-gray-900">Competen Recruitment is being built.</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">
                Today both journeys begin with a conversation. Tell us which side you are on and we
                will walk you through what is coming — and let you know the moment it opens.
              </p>
            </div>
            <a href={RECRUITMENT_ENQUIRY}
              className={`relative shrink-0 ${primaryBtn} px-6 py-3.5 text-center`}
              style={{ background: REC_ACCENT }}>
              Talk to us about Competen Recruitment
            </a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
