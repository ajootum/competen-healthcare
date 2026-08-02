import Link from "next/link";
import PracticeHeader from "@/components/marketing/PracticeHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import { createAdminClient } from "@/lib/supabase/server";
import { platformFlag } from "@/lib/practice/provisioning";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { AVAILABILITY, JOURNEY_GATES, JOURNEYS, contactFor } from "@/lib/marketing/practice-site";

// Shell for the four LP-* journey pages: practice sign-in, patient sign-in, booking and starting a
// practice. Each describes a flow that is specified but not yet open.
//
// THE AVAILABILITY NOTICE IS PART OF THE SHELL, NOT THE PAGE. It sits above the fold, before any of the
// journey detail, because a visitor who has read three screens about booking an appointment and only then
// discovers they cannot has been wasted, not informed. Putting it in the component means a fifth journey
// page cannot be added without it -- which is exactly what would happen if it were a paragraph each page
// had to remember.
//
// There is STILL deliberately no sign-in form ON THIS PAGE. The form lives at /practice/sign-in, which is
// the IAM-001 entry point and knows how to route a person by the membership they actually hold. What this
// panel does when a journey opens is LINK to it -- so there is exactly one door per journey, and no
// second credential field to keep in step with the first.
//
// THE PANEL IS FLAG-DRIVEN (JOURNEY_GATES, read at request time). IAM-001 s14's last line asks for the
// "not open yet" panel to be replaced with live actions at cutover; doing that by editing these pages
// would mean the launch ladder needs a deploy to move, and three header buttons would keep pointing at
// dead ends until someone remembered. A gated journey whose flag is off is indistinguishable from before.

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default async function JourneyPage({
  journeyKey, eyebrow, title, body, subject, children,
}: {
  journeyKey: string;
  eyebrow: string;
  title: string;
  body: string;
  /** Pre-filled enquiry subject, so a reply knows which journey the person came from. */
  subject: string;
  children: React.ReactNode;
}) {
  const others = JOURNEYS.filter(j => j.key !== journeyKey);

  // A journey with no gate can never open here, so it never reads the database.
  const gate = JOURNEY_GATES[journeyKey] ?? null;
  const open = gate ? await platformFlag(createAdminClient(), gate.flag) : false;

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <PracticeHeader />

      <main id="main">
        {/* ── HERO + AVAILABILITY ──────────────────────────────────────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${PRACTICE_ACCENT} 7%, white), #fff)` }}>
          <div className={`${container} pt-6`}>
            <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
              <Link href="/practice" className="hover:text-gray-800">Competen Practice</Link>
              <span aria-hidden className="mx-1.5 text-gray-300">›</span>
              <span className="text-gray-700">{title}</span>
            </nav>
          </div>

          <div className={`${container} py-10 lg:py-12 max-w-3xl`}>
            <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: PRACTICE_ACCENT }}>{eyebrow}</p>
            <h1 className="mt-3 text-[2.1rem] sm:text-[2.8rem] font-bold tracking-tight text-gray-900 leading-[1.08] text-balance">{title}</h1>
            <p className="mt-4 text-[16px] leading-relaxed text-gray-600">{body}</p>

            {/* Above the fold, before any journey detail. See the note at the top of this file. */}
            {open && gate ? (
              <div className="mt-8 rounded-2xl border border-emerald-200 bg-emerald-50 p-5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-emerald-900">
                  {gate.label}
                </span>
                <p className="mt-2.5 text-[15px] font-bold text-emerald-950">{gate.headline}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-emerald-900">{gate.body}</p>
                <div className="mt-4 flex flex-wrap items-center gap-4">
                  <Link href={gate.action.href}
                    className="inline-block rounded-xl px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: PRACTICE_ACCENT }}>
                    {gate.action.label} →
                  </Link>
                  {/* Kept when the journey is open: a clinic owner may still want a conversation before
                      an account, and removing the only human route at launch would be a downgrade. */}
                  <a href={contactFor(subject)} className="text-[13px] font-semibold text-emerald-900 underline underline-offset-2 hover:opacity-80">
                    {AVAILABILITY.action.label}
                  </a>
                </div>
              </div>
            ) : (
              <div className="mt-8 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-[10.5px] font-bold uppercase tracking-wide text-amber-900">
                  {AVAILABILITY.label}
                </span>
                <p className="mt-2.5 text-[15px] font-bold text-amber-950">{AVAILABILITY.headline}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-amber-900">{AVAILABILITY.body}</p>
                <a href={contactFor(subject)}
                  className="mt-4 inline-block rounded-xl px-5 py-3 text-[14px] font-semibold text-white transition-opacity hover:opacity-90"
                  style={{ background: PRACTICE_ACCENT }}>
                  {AVAILABILITY.action.label} →
                </a>
              </div>
            )}
          </div>
        </section>

        {children}

        {/* ── THE OTHER JOURNEYS ───────────────────────────────────────────── */}
        <section className={`${container} py-12 lg:py-14`}>
          <h2 className="text-[1.35rem] font-bold tracking-tight text-gray-900">Looking for something else?</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-3">
            {others.map(j => (
              <li key={j.key}>
                <Link href={j.href}
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
                  <span aria-hidden className="flex w-10 h-10 rounded-xl items-center justify-center text-xl"
                    style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 10%, white)` }}>{j.icon}</span>
                  <h3 className="mt-3 text-[15px] font-bold text-gray-900">{j.label}</h3>
                  <p className="mt-1 text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">{j.who}</p>
                  <p className="mt-2 flex-1 text-[12.5px] leading-snug text-gray-600">{j.blurb}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── CLOSING ──────────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#141B4D] px-6 py-8 sm:px-10 flex flex-col lg:flex-row lg:items-center gap-6">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative flex-1">
              <h2 className="text-[1.5rem] font-bold text-white leading-snug text-balance">Want to be among the first?</h2>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/65">
                Tell us about your practice and we will come back to you when it can be set up.
              </p>
            </div>
            <a href={contactFor(subject)}
              className="relative shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: PRACTICE_ACCENT }}>Get in touch →</a>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
