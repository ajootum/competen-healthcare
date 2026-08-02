import Link from "next/link";
import PracticeHeader from "@/components/marketing/PracticeHeader";
import SiteFooter from "@/components/marketing/SiteFooter";
import { PatternField } from "@/components/marketing/Pattern";
import {
  PRACTICE_ACCENT, PRACTICE_ACCENT_DARK, PRACTICE_HERO, PRACTICE_PROMISES, NOT_AN_EMR, PATIENT_JOURNEY,
  PRACTICE_AREAS, PRACTICE_ROLES, TENANT_MODEL, INTEGRATIONS, INTEGRATION_NOTE, PRACTICE_CTA, PREVIEW_NOTE,
} from "@/lib/marketing/practice-content";
import { JOURNEYS, HOW_IT_WORKS, TRUST, FAQS, contactFor } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";

// LP-PRA-001 — the Competen Practice public landing page.
//
// The specification's page structure is hero, how it works, benefits, high-level capabilities, trust, FAQs
// and a footer CTA, with FOUR journeys rather than one demo button: start a practice, practice sign-in,
// book an appointment, patient sign-in. That last part is the substantive change -- this page previously
// sent everybody to /signup, which creates a generic Competen account with the nurse role and no practice.
//
// "Minimal disclosure" is a constraint the page has to hold against its own detail: no architecture, no
// internal module list, outcomes rather than mechanics. The six capability pages behind it are written to
// the same rule and are reached from one section here rather than enumerated.
//
// What the design comp asks for and this page does NOT say is set out at the top of practice-site.ts --
// briefly: a worldwide trust claim, hundreds of practices, HIPAA compliance and a free trial, none of
// which is supported by anything.

export const metadata = pageMetadata({
  title: "Competen Practice — run your practice, delight your patients",
  description: PRACTICE_HERO.body,
  path: "/practice",
  image: "/images/og/practice.jpg",
  imageAlt: PRACTICE_HERO.imageAlt,
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function Page() {
  const primary = JOURNEYS.filter(j => j.kind === "primary");
  const secondary = JOURNEYS.filter(j => j.kind === "secondary");

  return (
    <div className="flex flex-col min-h-full bg-white font-[family-name:var(--font-geist-sans)]">
      <a href="#main" className="cmp-skip-link">Skip to main content</a>
      <PracticeHeader />

      <main id="main">
        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section className="relative overflow-hidden"
          style={{ background: `linear-gradient(180deg, color-mix(in srgb, ${PRACTICE_ACCENT} 7%, white), #fff 75%)` }}>
          <div className={`${container} py-12 lg:py-16`}>
            <div className="max-w-2xl">
              <span className="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold"
                style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 12%, white)`, color: PRACTICE_ACCENT_DARK }}>
                ✦ {PRACTICE_HERO.eyebrow}
              </span>
              <h1 className="mt-6 text-[2.4rem] sm:text-[3.2rem] font-bold tracking-tight text-gray-900 leading-[1.06] text-balance">
                {PRACTICE_HERO.headline.map(l => <span key={l} className="block">{l}</span>)}
              </h1>
              <p className="mt-5 text-[16px] leading-relaxed text-gray-600">{PRACTICE_HERO.body}</p>

              {/* Two primary journeys side by side -- the clinic owner and the patient are different
                  people arriving for different reasons, and a single button cannot serve both. */}
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {primary.map((j, i) => (
                  <Link key={j.key} href={j.href}
                    className={`rounded-xl px-6 py-3.5 text-[15px] font-semibold transition-opacity hover:opacity-90 ${i === 0 ? "text-white" : "border-2 hover:bg-white"}`}
                    style={i === 0
                      ? { background: PRACTICE_ACCENT }
                      : { borderColor: `${PRACTICE_ACCENT}44`, color: PRACTICE_ACCENT }}>
                    {j.label} →
                  </Link>
                ))}
              </div>
              <p className="mt-4 text-[13.5px] text-gray-600">
                Already with us?{" "}
                {secondary.map((j, i) => (
                  <span key={j.key}>
                    {i > 0 && <span className="text-gray-300"> · </span>}
                    <Link href={j.href} className="font-semibold transition-opacity hover:opacity-80" style={{ color: PRACTICE_ACCENT }}>
                      {j.label}
                    </Link>
                  </span>
                ))}
              </p>
            </div>

            <figure className="mt-10">
              <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-sm">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={PRACTICE_HERO.image} alt={PRACTICE_HERO.imageAlt} width={1400} height={933}
                  fetchPriority="high" className="w-full h-auto" />
              </div>
              <figcaption className="mt-3 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</figcaption>
            </figure>
          </div>
        </section>

        {/* ── THE FOUR JOURNEYS ────────────────────────────────────────────
            LP-PRA-001 serves doctors, specialists, private clinics, existing patients and new patients on
            one page. Naming who each route is for is what stops a patient ending up in a practice sign-up
            and a clinic owner ending up in a booking form. */}
        <section className={`${container} pb-14`}>
          <h2 className="text-[1.35rem] font-bold tracking-tight text-gray-900">Where are you going?</h2>
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {JOURNEYS.map(j => (
              <li key={j.key}>
                <Link href={j.href}
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white p-5 transition-all hover:shadow-md hover:-translate-y-0.5">
                  <span aria-hidden className="flex w-10 h-10 rounded-xl items-center justify-center text-xl"
                    style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 10%, white)` }}>{j.icon}</span>
                  <h3 className="mt-3 text-[15px] font-bold text-gray-900">{j.label}</h3>
                  <p className="mt-1 text-[11.5px] font-semibold uppercase tracking-wide text-gray-500">{j.who}</p>
                  <p className="mt-2 flex-1 text-[12.5px] leading-snug text-gray-600">{j.blurb}</p>
                  <span className="mt-3 text-[12.5px] font-semibold" style={{ color: PRACTICE_ACCENT }}>Go →</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {/* ── BENEFITS ─────────────────────────────────────────────────────── */}
        <section className={`${container} pb-14`}>
          <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {PRACTICE_PROMISES.map(p => (
              <li key={p.title}>
                <span aria-hidden className="block w-7 h-1 rounded-full" style={{ background: PRACTICE_ACCENT }} />
                <h2 className="mt-3 text-[16px] font-bold text-gray-900">{p.title}</h2>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">{p.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ── THE EMR BOUNDARY ─────────────────────────────────────────────
            Near the top on purpose. A clinic that buys this expecting an EMR churns in month three, and
            that is worse for everybody than a visitor who leaves in minute two. */}
        <section className={`${container} pb-14`}>
          <div className="rounded-3xl border border-gray-200 bg-white p-6 sm:p-9">
            <div className="grid lg:grid-cols-3 gap-8">
              <div>
                <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900 text-balance">{NOT_AN_EMR.title}</h2>
                <p className="mt-3 text-[14px] leading-relaxed text-gray-600">{NOT_AN_EMR.body}</p>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: PRACTICE_ACCENT }}>What it does</p>
                <ul className="mt-3 space-y-2.5">
                  {NOT_AN_EMR.is.map(i => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-gray-700">
                      <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                        style={{ background: PRACTICE_ACCENT }}>✓</span>
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-500">What it does not</p>
                <ul className="mt-3 space-y-2.5">
                  {NOT_AN_EMR.isNot.map(i => (
                    <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug text-gray-500">
                      <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-[9px] text-gray-400">–</span>
                      {i}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────
            Three moves for the practice, then the same story told from the patient's side. Both are
            numbered because each step is genuinely the trigger for the next. */}
        <section id="how-it-works" className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-16`}>
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">{HOW_IT_WORKS.title}</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">{HOW_IT_WORKS.body}</p>
            <ol className="mt-8 grid gap-8 lg:grid-cols-3">
              {HOW_IT_WORKS.steps.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span aria-hidden className="flex w-9 h-9 shrink-0 rounded-full items-center justify-center text-[13px] font-bold text-white tabular-nums"
                    style={{ background: PRACTICE_ACCENT }}>{i + 1}</span>
                  <span>
                    <h3 className="text-[16px] font-bold text-gray-900">{s.title}</h3>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{s.body}</p>
                  </span>
                </li>
              ))}
            </ol>

            <div className="mt-12 border-t border-gray-200 pt-10">
              <h3 className="text-[1.15rem] font-bold tracking-tight text-gray-900">The same day, from your patient&rsquo;s side</h3>
              <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-gray-600">
                Every step hands off to the next automatically. The practice does not have to remember any of them.
              </p>
              <ol className="mt-7 grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
                {PATIENT_JOURNEY.map((s, i) => (
                  <li key={s.step}>
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: PRACTICE_ACCENT }}>
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <h4 className="mt-1 text-[15px] font-bold text-gray-900">{s.step}</h4>
                    <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ── CAPABILITIES ─────────────────────────────────────────────────── */}
        <section id="capabilities" className={`${container} py-12 lg:py-16`}>
          <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">What is inside</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
            Six areas, one product. Nothing below is a separate purchase.
          </p>
          <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {PRACTICE_AREAS.map(a => (
              <li key={a.slug}>
                <Link href={`/practice/${a.slug}`}
                  className="group flex h-full flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden transition-all hover:shadow-lg hover:-translate-y-0.5">
                  <div className="overflow-hidden bg-[var(--cmp-neutral-100)] border-b border-gray-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={a.screens[0].src} alt="" width={1400} height={933} loading="lazy" decoding="async"
                      className="w-full h-auto transition-transform group-hover:scale-[1.02]" />
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <span aria-hidden className="flex w-10 h-10 rounded-xl items-center justify-center text-xl"
                      style={{ background: `color-mix(in srgb, ${a.accent} 12%, white)` }}>{a.icon}</span>
                    <h3 className="mt-3 text-[16px] font-bold text-gray-900">{a.nav}</h3>
                    <p className="mt-1.5 flex-1 text-[13px] leading-snug text-gray-600">{a.blurb}</p>
                    <span className="mt-3 text-[13px] font-semibold" style={{ color: a.accent }}>Explore →</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 text-[11.5px] text-gray-500">{PREVIEW_NOTE}</p>
        </section>

        {/* ── ROLES ────────────────────────────────────────────────────────── */}
        <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-14`}>
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">Everyone in the practice, on the right screen</h2>
            <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {PRACTICE_ROLES.map(r => (
                <li key={r.role} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <span aria-hidden className="flex w-11 h-11 rounded-xl items-center justify-center text-xl"
                    style={{ background: `color-mix(in srgb, ${PRACTICE_ACCENT} 10%, white)` }}>{r.icon}</span>
                  <h3 className="mt-3 text-[15px] font-bold text-gray-900">{r.role}</h3>
                  <p className="mt-1.5 text-[13px] leading-snug text-gray-600">{r.body}</p>
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[12.5px] text-gray-500">
              Larger groups can add an organisation administrator across multiple practices.
            </p>
          </div>
        </section>

        {/* ── TRUST ────────────────────────────────────────────────────────
            LP-PRA-001 asks for a trust section. Everything here is true because of how the product is
            built, rather than because of who is claimed to be using it -- which is the only kind of trust
            claim a product with no customers yet is entitled to make. */}
        <section className={`${container} py-12 lg:py-16`}>
          <div className="max-w-2xl">
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">{TRUST.title}</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">{TRUST.body}</p>
          </div>

          <ul className="mt-8 grid gap-5 lg:grid-cols-3">
            {TENANT_MODEL.pillars.map(p => (
              <li key={p.title} className="flex flex-col rounded-2xl border border-gray-200 bg-white p-6">
                <h3 className="text-[16px] font-bold text-gray-900">{p.title}</h3>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-gray-600">{p.body}</p>
                <ul className="mt-4 space-y-2 border-t border-gray-100 pt-4">
                  {p.points.map(pt => (
                    <li key={pt} className="flex gap-2.5 text-[12.5px] leading-snug text-gray-700">
                      <span aria-hidden className="mt-0.5 w-3.5 h-3.5 shrink-0 rounded-full flex items-center justify-center text-[8px] text-white"
                        style={{ background: PRACTICE_ACCENT }}>✓</span>
                      {pt}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>

          <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
            {TRUST.points.map(t => (
              <li key={t.title}>
                <h3 className="text-[14.5px] font-bold text-gray-900">{t.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{t.body}</p>
              </li>
            ))}
          </ul>

          <p className="mt-8 max-w-3xl text-[13px] leading-relaxed text-gray-600">
            <span className="font-semibold text-gray-900">Who can change what.</span>{" "}
            {TENANT_MODEL.boundary}
          </p>
        </section>

        {/* ── INTEGRATIONS ─────────────────────────────────────────────────
            The roadmap items are LABELLED. A clinic choosing this because it "connects to our laboratory"
            would be buying something the specifications do not promise for Version 1. */}
        <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
          <div className={`${container} py-12 lg:py-16`}>
            <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">Connects to what you already run</h2>
            <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">{INTEGRATION_NOTE}</p>
            <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {INTEGRATIONS.map(i => (
                <li key={i.name} className="rounded-2xl border border-gray-200 bg-white p-5">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[14.5px] font-bold text-gray-900">{i.name}</h3>
                    {!i.inV1 && (
                      <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                        Roadmap
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 text-[12.5px] leading-snug text-gray-600">{i.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ── FAQs ─────────────────────────────────────────────────────────
            Plain <details>, so every answer is in the DOM and findable by search and by Ctrl-F, and so it
            works with JavaScript off. The last question is the one about availability -- the question a
            visitor definitely has by this point, and the easiest one to leave out. */}
        <section id="faqs" className={`${container} py-12 lg:py-16`}>
          <h2 className="text-[1.6rem] font-bold tracking-tight text-gray-900">Questions clinicians ask</h2>
          <ul className="mt-8 max-w-3xl divide-y divide-gray-200 border-y border-gray-200">
            {FAQS.map(f => (
              <li key={f.q}>
                {/* The padding lives on the SUMMARY, not the details. On the details it only spaces the
                    block out; the clickable target stays one line of text tall -- 23px, which is under
                    the 24px minimum and a miserable thing to hit with a thumb. */}
                <details className="group">
                  <summary className="flex cursor-pointer items-start justify-between gap-4 py-4 text-[15.5px] font-semibold text-gray-900 marker:content-none [&::-webkit-details-marker]:hidden">
                    {f.q}
                    <span aria-hidden className="mt-0.5 shrink-0 text-[13px] text-gray-400 transition-transform group-open:rotate-45">＋</span>
                  </summary>
                  <p className="-mt-1 pb-4 pr-8 text-[14px] leading-relaxed text-gray-600">{f.a}</p>
                </details>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-[13.5px] text-gray-600">
            Something else on your mind?{" "}
            <a href={contactFor("Competen Practice question")} className="font-semibold transition-opacity hover:opacity-80" style={{ color: PRACTICE_ACCENT }}>
              Ask us directly
            </a>.
          </p>
        </section>

        {/* ── FOOTER CTA ───────────────────────────────────────────────────── */}
        <section className={`${container} pb-16`}>
          <div className="relative overflow-hidden rounded-3xl bg-[#141B4D] px-6 py-9 sm:px-10 flex flex-col lg:flex-row lg:items-center gap-6">
            <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.10} />
            <div className="relative flex-1">
              <h2 className="text-[1.7rem] font-bold text-white leading-snug text-balance">{PRACTICE_CTA.title}</h2>
              <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-white/65">{PRACTICE_CTA.body}</p>
            </div>
            <Link href="/practice/start"
              className="relative shrink-0 rounded-xl px-6 py-3.5 text-[15px] font-semibold text-white text-center transition-opacity hover:opacity-90"
              style={{ background: PRACTICE_ACCENT }}>Start Your Practice →</Link>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
