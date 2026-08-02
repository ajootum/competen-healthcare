import Link from "next/link";
import JourneyPage from "@/components/marketing/JourneyPage";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { START_PRACTICE } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";

// "Start Your Practice" -- the destination for LP-PRA-001's first primary CTA.
//
// There is no specification for this page; what it needed was a real place to go, since the CTA previously
// landed on /signup, which creates a generic Competen account with the nurse role and no practice. Its six
// steps are CPR-000A's tenant lifecycle, rewritten from the administrator's point of view to the clinic
// owner's -- "we create your practice" rather than "super administrator provisions tenant".
//
// No trial offer, no pricing. The comps show "free 14-day trial, no credit card required" and a Pricing
// menu; neither exists in any specification, and inventing a commercial commitment on a public page is not
// a copy decision to make on somebody's behalf.

export const metadata = pageMetadata({
  title: "Start your practice — Competen Practice",
  description: START_PRACTICE.body,
  path: "/practice/start",
  image: "/images/og/practice.jpg",
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function Page() {
  return (
    <JourneyPage
      journeyKey="start"
      eyebrow={START_PRACTICE.eyebrow}
      title={START_PRACTICE.title}
      body={START_PRACTICE.body}
      subject="Competen Practice - start a practice"
    >
      {/* ── THE SIX STEPS ────────────────────────────────────────────────── */}
      <section className={`${container} py-12 lg:py-14`}>
        <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">From conversation to open diary</h2>
        <ol className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
          {START_PRACTICE.steps.map((s, i) => (
            <li key={s.title} className="flex gap-4">
              <span aria-hidden className="flex w-9 h-9 shrink-0 rounded-full items-center justify-center text-[13px] font-bold text-white tabular-nums"
                style={{ background: PRACTICE_ACCENT }}>{i + 1}</span>
              <span>
                <h3 className="text-[15.5px] font-bold text-gray-900">{s.title}</h3>
                <p className="mt-1 text-[13.5px] leading-relaxed text-gray-600">{s.body}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>

      {/* ── WHAT TO HAVE READY ───────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,#FAFAFA)]">
        <div className={`${container} py-12 lg:py-14 grid lg:grid-cols-2 gap-10`}>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">What to have ready</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
              Nothing technical. If you can describe how your clinic runs, you can set it up.
            </p>
            <ul className="mt-5 space-y-2.5">
              {START_PRACTICE.bring.map(b => (
                <li key={b} className="flex gap-2.5 text-[14px] leading-snug text-gray-700">
                  <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                    style={{ background: PRACTICE_ACCENT }}>✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">What you will not have to do</h2>
            <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
              Security policy, password rules, backups, retention and the licence itself are held by the
              platform. You can see all of it; none of it is yours to maintain.
            </p>
            <Link href="/practice/setup"
              className="mt-5 inline-block text-[14px] font-semibold transition-opacity hover:opacity-80"
              style={{ color: PRACTICE_ACCENT }}>
              See exactly what you control, and what you do not →
            </Link>
          </div>
        </div>
      </section>
    </JourneyPage>
  );
}
