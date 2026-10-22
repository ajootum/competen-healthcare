import Link from "next/link";
import { PatternField } from "@/components/marketing/Pattern";
import {
  EXPERIENCES, INDIVIDUAL, INDIVIDUAL_SIGN_IN, LIFECYCLE, PASSPORT, siblingOf,
  type Experience, type ExperienceKey,
} from "@/lib/marketing/individual-family";

// The shared pieces of the Competen Individual family (COMPETEN-WEB-IND-001): the gateway at /individual
// and the two experience pages, Scholar and Professional. One file so the lifecycle band, the Passport
// band and the wordmark are the SAME component on all three pages -- the journey from student to
// professional is the family's central message, and three hand-copies of it would drift within a week.
//
// s14 of COMP-IND-UX-001 still governs: every interactive target at least 44x44px, visible focus, and
// state carried by text rather than colour alone.

export const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export const primaryBtn =
  "inline-flex min-h-[44px] items-center justify-center rounded-xl px-6 py-3 text-[15px] font-semibold "
  + "text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 "
  + "focus-visible:outline-gray-900";
export const secondaryBtn =
  "inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-current px-5 py-3 text-[15px] "
  + "font-semibold transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 "
  + "focus-visible:outline-gray-900";
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";

/** competen + SUB-BRAND, the shape /practice and the coming-soon screens already use. */
export function ExperienceMark({ wordmark, accent, size = "md" }: { wordmark: string; accent: string; size?: "sm" | "md" }) {
  const sm = size === "sm";
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden className={`${sm ? "w-7 h-7 text-[13px]" : "w-9 h-9 text-base"} shrink-0 rounded-full flex items-center justify-center text-white font-bold`}
        style={{ background: accent }}>C</span>
      <span className="leading-none">
        <span className={`block ${sm ? "text-[13px]" : "text-[15px]"} font-bold tracking-tight text-gray-900`}>competen</span>
        <span className={`block ${sm ? "text-[9.5px]" : "text-[10.5px]"} mt-0.5 font-bold uppercase tracking-[0.18em]`} style={{ color: accent }}>
          {wordmark}
        </span>
      </span>
    </span>
  );
}

/** The left-to-right flow chips inside a signature panel ("Upload → Understand → ..."). */
export function FlowChips({ steps, accent }: { steps: string[]; accent: string }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-2 text-[12.5px] font-semibold text-gray-700">
      {steps.map((step, i) => (
        <li key={step} className="flex items-center gap-1.5">
          <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-black/5">{step}</span>
          {i < steps.length - 1 && <span aria-hidden style={{ color: accent }}>→</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * The family's hero panel: an image over a tinted card that carries the one-line idea and its flow.
 * Decorative framing around real content -- the image keeps its alt text, the flow is a real list.
 */
export function SignaturePanel({ title, flow, accent, accentSoft, image, imageAlt }: {
  title: string; flow: string[]; accent: string; accentSoft: string; image?: string; imageAlt?: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-3xl ring-1 ring-black/5"
      style={{ background: `linear-gradient(150deg, ${accentSoft}, #fff 75%)` }}>
      {image && (
        <div className="aspect-[16/8] overflow-hidden bg-[var(--cmp-neutral-100)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt={imageAlt ?? ""} className="w-full h-full object-cover object-top" />
        </div>
      )}
      <div className="relative p-6 sm:p-7">
        <PatternField className="absolute inset-0" tone={accent} opacity={0.07} />
        <p className="relative text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: accent }}>The Competen advantage</p>
        <p className="relative mt-2 text-[1.35rem] sm:text-[1.55rem] font-bold leading-snug tracking-tight text-gray-900 text-balance">{title}</p>
        <div className="relative mt-4"><FlowChips steps={flow} accent={accent} /></div>
      </div>
    </div>
  );
}

/**
 * COMPETEN-WEB-IND-001 s4 -- the continuous journey. Stages are coloured by the experience that serves
 * them AND labelled with its name, so the split never rests on colour alone.
 */
export function LifecycleJourney({ current }: { current?: ExperienceKey }) {
  return (
    <section id="journey" aria-labelledby="journey-title" className={`${container} scroll-mt-36 py-14 lg:py-16`}>
      <div className="rounded-3xl border border-gray-200 bg-white px-5 py-8 sm:px-10 sm:py-10">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: INDIVIDUAL.accent }}>
          Your journey
        </p>
        <h2 id="journey-title" className="mt-2 max-w-2xl text-[1.6rem] font-bold leading-tight tracking-tight text-gray-900 text-balance">
          {LIFECYCLE.title}
        </h2>
        <p className="mt-3 max-w-2xl text-[14.5px] leading-relaxed text-gray-600">{LIFECYCLE.body}</p>

        <ol className="mt-8 grid grid-cols-1 gap-2 sm:grid-cols-5" aria-label="Career stages">
          {LIFECYCLE.stages.map((stage, i) => {
            const e = EXPERIENCES[stage.experience];
            const here = current === stage.experience;
            return (
              <li key={stage.label} className="relative rounded-2xl border px-4 py-3.5"
                style={{
                  background: here ? e.accent : e.accentSoft,
                  borderColor: `color-mix(in srgb, ${e.accent} 28%, transparent)`,
                }}>
                {/* Full white / gray-600 at 11px: the softer shades measured under 4.5:1 on these fills. */}
                <span className={`block text-[11px] font-semibold ${here ? "text-white" : "text-gray-600"}`}>
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className={`block text-[15px] font-bold ${here ? "text-white" : "text-gray-900"}`}>{stage.label}</span>
                <span className="block text-[11.5px] font-semibold" style={{ color: here ? "#fff" : e.accent }}>
                  {e.name.replace("Competen ", "")}
                </span>
              </li>
            );
          })}
        </ol>

        <ul className="mt-8 grid gap-5 sm:grid-cols-3">
          {LIFECYCLE.promises.map(p => (
            <li key={p.title} className="flex gap-3">
              <span aria-hidden className="mt-0.5 w-6 h-6 shrink-0 rounded-md flex items-center justify-center text-[11px]"
                style={{ background: INDIVIDUAL.accentSoft, color: INDIVIDUAL.accent }}>✓</span>
              <span>
                <span className="block text-[14px] font-bold text-gray-900">{p.title}</span>
                <span className="block text-[13px] leading-snug text-gray-600">{p.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** COMPETEN-WEB-IND-001 s5 -- what every experience shares, in the visitor's own words. */
export function PassportBand({ line, action }: { line?: string; action?: { label: string; href: string } }) {
  return (
    <section aria-labelledby="passport-title" className={`${container} pb-14`}>
      <div className="relative overflow-hidden rounded-3xl bg-[#0B2E33] px-6 py-8 sm:px-10 sm:py-10">
        <PatternField className="absolute inset-0" tone="#FFFFFF" opacity={0.08} />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-xl">
            <h2 id="passport-title" className="text-[1.5rem] font-bold leading-snug text-white text-balance">{PASSPORT.title}</h2>
            {line && <p className="mt-2 text-[14px] leading-relaxed text-white/70">{line}</p>}
          </div>
          {action && (
            <Link href={action.href}
              className={`shrink-0 inline-flex min-h-[44px] items-center rounded-xl bg-white px-5 py-3 text-[14.5px] font-semibold text-[#0B2E33] hover:bg-white/90 ${focusRing}`}>
              {action.label} <span aria-hidden className="ml-1.5">→</span>
            </Link>
          )}
        </div>
        <ul className="relative mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PASSPORT.points.map(p => (
            <li key={p.title}>
              <span className="block text-[14.5px] font-bold text-white">{p.title}</span>
              <span className="mt-1 block text-[12.5px] leading-snug text-white/60">{p.body}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The experience's own navigation bar, under the shared site header -- the shape PracticeNav set:
 * sticky at 71px (the header's 70px row plus its 1px border), scrolling sideways on a phone rather than
 * wrapping. Anchors are in-page because each experience is ONE public page; the sibling link and the
 * door are what make it a product bar rather than a table of contents.
 */
export function ExperienceNav({ e }: { e: Experience }) {
  const sibling = siblingOf(e.key);
  const anchors = [
    { href: "#overview", label: "Overview" },
    { href: "#features", label: e.key === "scholar" ? "How you learn" : "What it covers" },
    { href: "#journey", label: "Your journey" },
    { href: "#start", label: "Get started" },
  ];
  return (
    <nav aria-label={`${e.name} sections`} className="sticky top-[71px] z-30 border-b border-gray-100 bg-white/95 backdrop-blur">
      <div className={`${container} flex items-center gap-3 sm:gap-5`}>
        <Link href={e.href} aria-label={`${e.name} overview`} className={`hidden sm:inline-flex shrink-0 py-2 rounded-lg ${focusRing}`}>
          <ExperienceMark wordmark={e.wordmark} accent={e.accent} size="sm" />
        </Link>
        <ul className="flex flex-1 min-w-0 items-center gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {anchors.map(a => (
            <li key={a.href} className="shrink-0">
              <a href={a.href}
                className={`inline-flex min-h-[44px] items-center rounded-lg px-3 text-[13px] font-medium whitespace-nowrap text-gray-600 hover:bg-gray-50 hover:text-gray-900 ${focusRing}`}>
                {a.label}
              </a>
            </li>
          ))}
          <li className="shrink-0 lg:hidden">
            <Link href={sibling.href}
              className={`inline-flex min-h-[44px] items-center rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap ${focusRing}`}
              style={{ color: sibling.accent }}>
              {`Meet ${sibling.name.replace("Competen ", "")}`}
            </Link>
          </li>
        </ul>
        <Link href={sibling.href}
          className={`hidden lg:inline-flex shrink-0 min-h-[44px] items-center text-[13px] font-semibold hover:opacity-80 ${focusRing}`}
          style={{ color: sibling.accent }}>
          {`Meet ${sibling.name}`} <span aria-hidden className="ml-1">→</span>
        </Link>
        <Link href={INDIVIDUAL_SIGN_IN}
          className={`shrink-0 inline-flex min-h-[44px] items-center rounded-lg px-4 text-[13.5px] font-semibold text-white hover:opacity-90 ${focusRing}`}
          style={{ background: e.accent }}>
          Sign in
        </Link>
      </div>
    </nav>
  );
}

/** "Home › Individual › Scholar" -- 44px hit areas without changing the breadcrumb's visual height. */
export function Breadcrumb({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="text-[12px] text-gray-500">
      <ol className="flex flex-wrap items-center">
        {trail.map((t, i) => (
          <li key={t.label} className="flex items-center">
            {i > 0 && <span aria-hidden className="mx-1.5 text-gray-300">›</span>}
            {t.href
              ? <Link href={t.href} className={`inline-block px-1.5 -mx-1.5 py-3.5 -my-3.5 hover:text-gray-800 ${focusRing}`}>{t.label}</Link>
              : <span aria-current="page" className="text-gray-700">{t.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * The operating-entity line (COMPETEN-WEB-IND-001 s6). Renders NOTHING while the entity is unset --
 * see `operator` in individual-family.ts: a guessed legal name is worse than none.
 */
export function OperatorNotice({ e }: { e: Experience }) {
  if (!e.operator) return null;
  return (
    <p className={`${container} pb-8 text-[12px] text-gray-500`}>
      {`${e.name} is provided by ${e.operator}.`}
    </p>
  );
}
