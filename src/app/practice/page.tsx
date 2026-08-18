import Link from "next/link";
import { redirect } from "next/navigation";
import PracticeHeader from "@/components/marketing/PracticeHeader";
import { resolvedJourneys } from "@/lib/marketing/journey-gates";
import SiteFooter from "@/components/marketing/SiteFooter";
import {
  PRACTICE_INDIGO, PRACTICE_INDIGO_DEEP, PRACTICE_CANVAS,
  LP3_HERO, LP3_BENEFITS, LP3_AI, LP3_WORKSPACE, LP3_CTA,
  PRACTICE_AREAS, NOT_AN_EMR, TENANT_MODEL, PREVIEW_NOTE, OVERVIEW_SCREEN, AREA_COUNT_WORD,
} from "@/lib/marketing/practice-content";
import { FAQS, contactFor } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";
import { hasPracticeMembership } from "@/lib/practice/shell";
import { createAdminClientOrNull } from "@/lib/supabase/server";
import { platformFlag } from "@/lib/practice/provisioning";

// CPR-V2-001 v3 — the Competen Practice homepage.
//
// SHORT ON PURPOSE. The previous page ran twelve sections deep because it was carrying the whole product
// story; v3 asks for a landing page, and the user asked for it short. What survived the cut is what a
// visitor needs to decide: what it is, what it does, what it looks like, what it is not, and how to
// start. The detail did not vanish -- the capability pages behind /practice still hold it.
//
// WHAT THIS PAGE REFUSES TO SAY is documented where the content lives (practice-content.ts, CPR-V2-001 v3
// block). Briefly: no named hospitals as customers, no invented testimonials, no app-store badges for an
// app that does not exist, and no price. Two of those four were the user's decision; the first two were
// not, because they are false statements about identifiable real parties.

export const metadata = pageMetadata({
  title: "Competen Practice — build your clinical practice intelligence",
  description: LP3_HERO.body,
  path: "/practice",
  image: "/images/og/practice.jpg",
  imageAlt: LP3_HERO.imageAlt,
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

// ⚠️ FORCE-DYNAMIC, AND THE CTA BELOW IS WHY. This page reads two launch flags, and a statically
// rendered flag is baked at build time -- which is to say, not a flag. The journey pages
// (/practice/login, /practice/start) were given this treatment when their gates were built; THIS PAGE
// WAS MISSED, and the result was live: practice_sign_in was ON in the database while the homepage kept
// offering "Talk to us about your practice", because the closed branch had been frozen into the build.
//
// It was found through the content harness, which uses this CTA as its probe for "can the server read
// flags" -- so a caching bug here presented as a TLS bug and sent the next reader (me) to the wrong
// cause entirely. Nothing else on the page needs request-time data; this line exists solely so the
// launch ladder is real.
export const dynamic = "force-dynamic";

export default async function Page() {
  // IAM-001 s6 lists /practice twice on purpose: the public landing for a visitor, the application entry
  // for a member. The tiebreak is MEMBERSHIP, not authentication.
  if (await hasPracticeMembership()) redirect("/practice/home");

  // THE CTA FOLLOWS THE LAUNCH LADDER. "Start free trial" pointing at /practice/sign-up is a dead end
  // whenever practice_public_signup is off -- the visitor lands on "signup is not open yet", which is an
  // honest page reached by a dishonest button. So the primary action is whatever is actually open:
  // create a practice, else sign in, else talk to us. The trial line only appears when a trial can
  // genuinely be started.
  // COMP-ENG-002 §7: nullable rather than throwing. This is a PUBLIC page and the client exists only to
  // read two launch-flag booleans; platformFlag treats a null client as OFF, which is the same verdict
  // it already reaches for a failed read.
  const admin = createAdminClientOrNull();
  const [signupOpen, signInOpen, journeys] = await Promise.all([
    platformFlag(admin, "practice_public_signup"),
    platformFlag(admin, "practice_sign_in"),
    // The header's buttons follow the same ladder as the hero's CTA below. Resolving them here rather
    // than inside the header keeps the flag read on the server and out of a client component.
    resolvedJourneys(),
  ]);
  const cta = signupOpen
    ? { label: LP3_HERO.cta.label, href: "/practice/sign-up" }
    : signInOpen
      ? { label: "Sign in to your practice", href: "/practice/sign-in" }
      : { label: "Talk to us about your practice", href: contactFor("Competen Practice enquiry") };

  return (
    <div className="cp-surface flex flex-col min-h-full font-[family-name:var(--font-geist-sans)]" style={{ background: PRACTICE_CANVAS }}>
      <a href="#main" className="cmp-skip-link">Skip to main content</a>

      {/* ── ANNOUNCEMENT BAR ─────────────────────────────────────────────
          The comp's bar announces an AI assistant as "now live". It is not. This one carries something
          that is true and is the more useful thing to say anyway. */}
      <p className="px-5 py-2 text-center text-[12.5px] font-medium text-white" style={{ background: PRACTICE_INDIGO_DEEP }}>
        {signupOpen ? "Competen Practice is open for individual practitioners." : "Competen Practice is in private pilot."}{" "}
        <Link href={cta.href} className="underline underline-offset-2 hover:opacity-90">{cta.label} →</Link>
      </p>

      <PracticeHeader journeys={journeys} />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section className="overflow-hidden">
          <div className={`${container} py-12 lg:py-16 grid lg:grid-cols-2 gap-10 lg:gap-14 items-center`}>
            <div>
              <span className="inline-block rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em]"
                style={{ background: `color-mix(in srgb, ${PRACTICE_INDIGO} 12%, white)`, color: PRACTICE_INDIGO_DEEP }}>
                {LP3_HERO.eyebrow}
              </span>
              <h1 className="mt-5 text-[2.3rem] sm:text-[3.1rem] font-bold tracking-tight leading-[1.07] text-balance text-gray-900">
                {LP3_HERO.headline.map((l, i) => (
                  <span key={l} className="block" style={i === 1 ? { color: PRACTICE_INDIGO } : undefined}>{l}</span>
                ))}
              </h1>
              <p className="mt-4 text-[16px] leading-relaxed text-gray-600 max-w-lg">{LP3_HERO.body}</p>

              <ul className="mt-6 flex flex-col gap-2.5">
                {LP3_HERO.points.map(p => (
                  <li key={p} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                    <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: PRACTICE_INDIGO }}>✓</span>
                    {p}
                  </li>
                ))}
              </ul>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href={cta.href}
                  className="rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: PRACTICE_INDIGO }}>
                  {cta.label} →
                </Link>
                <a href={LP3_HERO.secondary.href}
                  className="rounded-xl border-2 bg-white px-6 py-3.5 text-[15px] font-semibold transition-opacity hover:opacity-90"
                  style={{ borderColor: "var(--cp-primary-border)", color: PRACTICE_INDIGO }}>
                  {LP3_HERO.secondary.label}
                </a>
              </div>
              {/* Thirty, not fourteen. See the note in practice-content.ts. */}
              {signupOpen && <p className="mt-3 text-[12.5px] text-gray-500">{LP3_HERO.trialNote}</p>}
            </div>

            <figure className="relative">
              <div className="overflow-hidden rounded-3xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={LP3_HERO.image} alt={LP3_HERO.imageAlt} width={1400} height={933}
                  fetchPriority="high" className="w-full h-auto" />
              </div>
            </figure>
          </div>
        </section>

        {/* ── SIX BENEFITS ─────────────────────────────────────────────── */}
        <section className="bg-white border-y border-gray-100">
          <div className={`${container} py-14 lg:py-16`}>
            <p className="text-center text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PRACTICE_INDIGO }}>
              Built for your professional journey
            </p>
            <h2 className="mt-2 text-center text-[1.7rem] font-bold tracking-tight text-gray-900 text-balance">
              Everything you need in one workspace
            </h2>
            <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {LP3_BENEFITS.map(b => (
                <li key={b.title} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <p className="text-[15px] font-bold text-gray-900">{b.title}</p>
                  <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">{b.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── WORKSPACE PREVIEW ────────────────────────────────────────── */}
        <section id="workspace" className={`${container} py-14 lg:py-16`}>
          <div className="grid lg:grid-cols-2 gap-10 items-center">
            <figure>
              <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={OVERVIEW_SCREEN.src} alt={OVERVIEW_SCREEN.alt} width={1400} height={933}
                  loading="lazy" className="w-full h-auto" />
              </div>
              <figcaption className="mt-3 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</figcaption>
            </figure>
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PRACTICE_INDIGO }}>{LP3_WORKSPACE.eyebrow}</p>
              <h2 className="mt-2 text-[1.7rem] font-bold tracking-tight text-gray-900 text-balance">{LP3_WORKSPACE.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-gray-600">{LP3_WORKSPACE.body}</p>
              <ul className="mt-5 flex flex-col gap-2.5">
                {LP3_WORKSPACE.points.map(p => (
                  <li key={p} className="flex items-start gap-2.5 text-[14px] text-gray-700">
                    <span aria-hidden className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: PRACTICE_INDIGO }}>✓</span>
                    {p}
                  </li>
                ))}
              </ul>
              <Link href="/practice/case-memory" className="mt-6 inline-block text-[14px] font-semibold hover:underline" style={{ color: PRACTICE_INDIGO }}>
                All {AREA_COUNT_WORD} capability areas →
              </Link>
            </div>
          </div>
        </section>

        {/* ── AI ASSISTANT, MARKED AS NOT BUILT ────────────────────────
            Rendered at the user's decision, labelled at mine. A roadmap on a sales page is defensible;
            an unbuilt feature described in the present tense is not. */}
        <section className="bg-white border-y border-gray-100">
          <div className={`${container} py-14 lg:py-16`}>
            <span className="inline-block rounded-full border border-dashed border-gray-300 bg-gray-50 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.1em] text-gray-500">
              {LP3_AI.eyebrow}
            </span>
            <h2 className="mt-3 text-[1.7rem] font-bold tracking-tight text-gray-900 text-balance">{LP3_AI.title}</h2>
            <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-gray-600">{LP3_AI.body}</p>
            <ul className="mt-8 grid gap-5 sm:grid-cols-3">
              {LP3_AI.points.map(p => (
                <li key={p.title} className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-5">
                  <p className="text-[14.5px] font-bold text-gray-800">{p.title}</p>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{p.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── WHAT IT IS NOT + WHO CAN SEE IT ──────────────────────────
            The EMR boundary and the ownership rule are the two things a clinician actually hesitates
            over, and they are the reason this product exists. They stay however short the page gets. */}
        <section className={`${container} py-14 lg:py-16`}>
          <div className="grid lg:grid-cols-2 gap-6">
            <div className="rounded-2xl border p-6" style={{ borderColor: "var(--cp-primary-border)", background: "white" }}>
              <h2 className="text-[1.15rem] font-bold text-gray-900 text-balance">{NOT_AN_EMR.title}</h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-gray-600">{NOT_AN_EMR.body}</p>
            </div>
            <div className="rounded-2xl border border-gray-200 bg-white p-6">
              <h2 className="text-[1.15rem] font-bold text-gray-900 text-balance">{TENANT_MODEL.title}</h2>
              <p className="mt-2.5 text-[14px] leading-relaxed text-gray-600">{TENANT_MODEL.boundary}</p>
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section id="faqs" className="bg-white border-y border-gray-100">
          <div className={`${container} py-14 lg:py-16`}>
            <h2 className="text-[1.7rem] font-bold tracking-tight text-gray-900">Questions clinicians ask</h2>
            <dl className="mt-8 grid gap-6 lg:grid-cols-2">
              {FAQS.map(f => (
                <div key={f.q}>
                  <dt className="text-[15px] font-bold text-gray-900">{f.q}</dt>
                  <dd className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">{f.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────────────
            The comp says "join thousands of healthcare professionals already growing with Competen
            Practice". There are not thousands. The invitation stands on its own without a crowd. */}
        <section className={`${container} py-14`}>
          <div className="rounded-3xl px-6 py-10 sm:px-10 text-center" style={{ background: PRACTICE_INDIGO_DEEP }}>
            <h2 className="text-[1.6rem] font-bold text-white text-balance">{LP3_CTA.title}</h2>
            <p className="mt-2.5 text-[14.5px] text-white/70">{LP3_CTA.body}</p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
              <Link href={cta.href} className="rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold transition-opacity hover:opacity-90"
                style={{ color: PRACTICE_INDIGO_DEEP }}>
                {cta.label} →
              </Link>
              <a href={contactFor("Competen Practice enquiry")}
                className="rounded-xl border-2 border-white/30 px-6 py-3.5 text-[15px] font-semibold text-white transition-opacity hover:opacity-90">
                Talk to us
              </a>
            </div>
            {signupOpen && <p className="mt-4 text-[12.5px] text-white/60">{LP3_HERO.trialNote}</p>}
          </div>
        </section>
      </main>

      <SiteFooter />
      {/* PRACTICE_AREAS is read so the capability count in the workspace section cannot drift from the
          catalogue it describes. */}
      <span className="hidden" aria-hidden data-areas={PRACTICE_AREAS.length} />
    </div>
  );
}
