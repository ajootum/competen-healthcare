import Link from "next/link";
import SiteHeader from "@/components/marketing/SiteHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import {
  Breadcrumb, ExperienceMark, ExperienceNav, JourneyNote, OperatorNotice, SignaturePanel,
  container, primaryBtn, secondaryBtn,
} from "@/components/marketing/IndividualFamily";
import {
  INDIVIDUAL, enquiryHref, experienceSignIn, siblingOf, type DemoExperience, type ExperienceStep,
} from "@/lib/marketing/individual-family";

// ONE TEMPLATE, TWO BRANDS -- COMPETEN-WEB-IND-001 s3. (Since SCHOLAR-WEB-REDESIGN-01, 29 Oct 2026, it serves
// Competen Professional only: /scholar is ScholarLanding.tsx, a benefits page with no product demonstration.) Competen Scholar (/scholar) and Competen
// Professional (/professional) are distinct public experiences with their own name, accent, navigation
// and conversion journey, and they share one structure for the same reason SolutionPage exists: two
// near-identical pages written out twice stop looking like one family within a week. The differences that
// matter are data in individual-family.ts; the structure is not a difference.
//
// ⚠ CONVERSION IS HONEST. The primary action is the conversation, and "Sign in" is the product's own door
// naming this experience (/individual/sign-in?experience=<key>, COMPETEN-IND-ACCESS-001): coming soon while
// the release gate is off, the one Competen sign-in with the destination preserved when it is on. There
// is no /signup link anywhere on the page -- the disclosure harness (7c, 7l) holds both properties.

export default function ExperiencePage({ e }: { e: DemoExperience }) {
  const sibling = siblingOf(e.key);
  // ⚠ ONE template string, not adjacent JSX text: server rendering puts a comment node between a text
  // node and an expression, which splits the phrase the disclosure harness searches the HTML for.
  const talk = `Talk to us about ${e.name}`;

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <SiteHeader />
      <ExperienceNav e={e} />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section id="overview" className="relative overflow-hidden scroll-mt-36"
          style={{ background: `linear-gradient(180deg, ${e.accentSoft}, #fff 80%)` }}>
          <div className={`${container} pt-6`}>
            <Breadcrumb trail={[
              { label: "Home", href: "/" },
              { label: "Individual", href: INDIVIDUAL.href },
              { label: e.name.replace("Competen ", "") },
            ]} />
          </div>

          <div className={`${container} grid xl:grid-cols-[1.25fr_1fr] gap-10 items-center py-10 lg:py-14`}>
            <div>
              {/* Phone only: from sm up the product bar above already carries the wordmark. */}
              <div className="mb-6 sm:hidden"><ExperienceMark wordmark={e.wordmark} accent={e.accent} /></div>
              <p className="text-[12px] font-bold uppercase tracking-[0.16em]" style={{ color: e.accent }}>{e.eyebrow}</p>
              <h1 className="mt-3 text-[2.2rem] sm:text-[3.1rem] font-bold tracking-tight text-gray-900 leading-[1.06] text-balance">
                {e.headline.map(line => <span key={line} className="block">{line}</span>)}
              </h1>
              <p className="mt-5 max-w-xl text-[15.5px] leading-relaxed text-gray-600">{e.body}</p>
              <p className="mt-3 text-[12.5px] font-semibold text-gray-500">{e.tagline}</p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a href={enquiryHref(e.contact)} className={primaryBtn} style={{ background: e.accent }}>{talk}</a>
                <Link href={experienceSignIn(e.key)} className={secondaryBtn} style={{ color: e.accent }}>
                  Sign in <span aria-hidden>→</span>
                </Link>
              </div>
            </div>

            <SignaturePanel title={e.signatureTitle} flow={e.steps.map(s => s.label)} accent={e.accent}
              accentSoft={e.accentSoft} image={e.image} imageAlt={e.imageAlt} imagePosition={e.imagePosition} />
          </div>
        </section>

        {/* ── HOW IT WORKS: THE PRODUCT DEMONSTRATION (refinement items 5-6) ─────────────────────
            One row per step of the hero flow: what the person does, and a DRAWN illustration of the
            step. Illustrations are labelled as such and carry no figures -- the product is pre-launch,
            and a mock that read as a screenshot of live data would be a claim nothing supports.
            Outcomes, never internal module names -- the disclosure rule. */}
        <section id="features" aria-labelledby="features-title" className={`${container} scroll-mt-36 pt-14 lg:pt-16`}>
          <div className="max-w-2xl">
            <h2 id="features-title" className="text-[1.6rem] font-bold tracking-tight text-gray-900">{e.stepsTitle}</h2>
            <p className="mt-2 text-[14.5px] leading-relaxed text-gray-600">{e.stepsBody}</p>
            <p className="mt-2 text-[12px] font-medium text-gray-600">{`Illustrations show how each step will look. ${e.name} is in development.`}</p>
          </div>
          <ol className="mt-8 space-y-4">
            {e.steps.map((s, i) => (
              <li key={s.id} id={s.id}
                className="grid gap-5 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
                <div className="flex items-start gap-4">
                  <span aria-hidden className="flex w-11 h-11 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold"
                    style={{ background: e.accentSoft, color: e.accent }}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p className="text-[11.5px] font-bold uppercase tracking-[0.14em]" style={{ color: e.accent }}>{s.label}</p>
                    <h3 className="mt-0.5 text-[17px] font-bold text-gray-900">{s.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{s.body}</p>
                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
                      {s.points.map(p => (
                        <li key={p} className="flex gap-1.5 text-[13px] text-gray-700">
                          <span aria-hidden style={{ color: e.accent }}>✓</span>{p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
                <StepMock e={e} step={s} />
              </li>
            ))}
          </ol>
        </section>

        <JourneyNote e={e} />

        {/* ── THE SIBLING ──────────────────────────────────────────────────────
            Both experiences may coexist (s4), so each page introduces the other rather than hiding it. */}
        <section aria-labelledby="sibling-title" className={`${container} pb-14`}>
          <Link href={sibling.href}
            className="group flex flex-col gap-4 rounded-3xl border border-gray-200 p-6 sm:flex-row sm:items-center sm:p-8 hover:shadow-lg transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900"
            style={{ background: `linear-gradient(120deg, ${sibling.accentSoft}, #fff 70%)` }}>
            <ExperienceMark wordmark={sibling.wordmark} accent={sibling.accent} />
            <div className="flex-1 sm:pl-4">
              <h2 id="sibling-title" className="text-[1.15rem] font-bold text-gray-900">
                {e.key === "scholar" ? "Practising, or about to? Meet Competen Professional." : "Studying again? Meet Competen Scholar."}
              </h2>
              <p className="mt-1 text-[13.5px] text-gray-600">{sibling.micro} {sibling.tagline}</p>
            </div>
            <span className="text-[14px] font-semibold" style={{ color: sibling.accent }}>
              {`Explore ${sibling.name.replace("Competen ", "")}`} <span aria-hidden className="inline-block transition-transform group-hover:translate-x-0.5">→</span>
            </span>
          </Link>
        </section>

        {/* ── GET STARTED ──────────────────────────────────────────────────── */}
        <section id="start" className={`${container} scroll-mt-36 pb-16`}>
          <div className="relative overflow-hidden rounded-3xl px-6 py-8 sm:px-9 flex flex-col lg:flex-row lg:items-center gap-5"
            style={{ background: `color-mix(in srgb, ${e.accent} 8%, white)` }}>
            <PatternField className="absolute inset-0" tone={e.accent} opacity={0.10} />
            <div className="relative flex-1">
              <h2 className="text-[1.3rem] font-bold text-gray-900">{e.closing.title}</h2>
              <p className="mt-1 text-[14px] leading-relaxed text-gray-600">{e.closing.body}</p>
            </div>
            <div className="relative flex flex-wrap gap-3">
              <a href={enquiryHref(e.contact)} className={primaryBtn} style={{ background: e.accent }}>Talk to us</a>
              <Link href={experienceSignIn(e.key)} className={`${secondaryBtn} bg-white`} style={{ color: e.accent }}>Sign in</Link>
            </div>
          </div>
        </section>

        <OperatorNotice e={e} />
      </main>

      <SiteFooter />
    </div>
  );
}

/**
 * The drawn illustration for one demonstration step: a small product-shaped card with the step's heading
 * and two lines. aria-hidden as a whole would hide real example text, so it is a labelled figure instead.
 */
function StepMock({ e, step }: { e: DemoExperience; step: ExperienceStep }) {
  return (
    <figure aria-label={`Illustration: ${step.label}`}
      className="relative overflow-hidden rounded-xl p-4 sm:p-5"
      style={{ background: `linear-gradient(140deg, ${e.accentSoft}, #fff 85%)` }}>
      <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-black/5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12.5px] font-bold text-gray-900">{step.mock.heading}</span>
          <span aria-hidden className="flex gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
            <span className="w-1.5 h-1.5 rounded-full bg-gray-200" />
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: e.accent }} />
          </span>
        </div>
        <ul className="mt-3 space-y-2">
          {step.mock.lines.map(l => (
            <li key={l.text} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2">
              <span className="text-[13px] leading-snug text-gray-700">{l.text}</span>
              {l.tag && (
                <span className="rounded-full bg-white px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-black/5" style={{ color: e.accent }}>
                  {l.tag}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="mt-2 text-[11.5px] text-gray-600">Illustrative</figcaption>
    </figure>
  );
}
