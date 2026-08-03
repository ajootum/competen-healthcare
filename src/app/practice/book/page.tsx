import JourneyPage from "@/components/marketing/JourneyPage";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { BOOKING_JOURNEY } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";

// LP-BOOK-001 Public Clinician Directory & Booking, followed by LP-NEW-001 New Patient Registration &
// Confirmation. Presented as one page because they are one journey: LP-NEW-001's first step, "appointment
// selected", is LP-BOOK-001's last.
//
// NO CLINICIAN DIRECTORY. The design comp shows a populated list -- named doctors with qualifications,
// star ratings and review counts, "we found 24 clinicians". There are no practices on the platform, so
// every one of those entries would be an invented healthcare professional published on the open internet
// under a rating nobody gave them. A search box returning nothing would be no better: it says the product
// is broken rather than not yet open.
//
// What the page does instead is show a patient exactly what the journey will be, which is the honest
// version of the same reassurance the directory was there to provide.

export const metadata = pageMetadata({
  title: "Book an appointment — Competen Practice",
  description: BOOKING_JOURNEY.body,
  path: "/practice/book",
  image: "/images/og/practice-booking.jpg",
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

/** The two halves of the journey, numbered because they genuinely are a sequence. */
function Steps({ steps, from }: { steps: { title: string; body: string }[]; from: number }) {
  return (
    <ol className="mt-7 grid gap-x-6 gap-y-7 sm:grid-cols-2 lg:grid-cols-4">
      {steps.map((s, i) => (
        <li key={s.title}>
          <span className="text-[11px] font-bold tabular-nums" style={{ color: PRACTICE_ACCENT }}>
            {String(from + i).padStart(2, "0")}
          </span>
          <h3 className="mt-1 text-[15.5px] font-bold text-gray-900">{s.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-gray-600">{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

export default function Page() {
  return (
    <JourneyPage
      journeyKey="book"
      eyebrow={BOOKING_JOURNEY.eyebrow}
      title={BOOKING_JOURNEY.title}
      body={BOOKING_JOURNEY.body}
      subject="Competen Practice - patient booking enquiry"
    >
      {/* ── FINDING A CLINICIAN (LP-BOOK-001) ────────────────────────────── */}
      <section className={`${container} py-12 lg:py-14`}>
        <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Finding the right clinician</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
          No account needed to look, and none needed to book. You will see real availability rather than a
          request form that somebody rings you back about.
        </p>
        <Steps steps={BOOKING_JOURNEY.find} from={1} />
      </section>

      {/* ── REGISTERING AND CONFIRMING (LP-NEW-001) ──────────────────────── */}
      <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,var(--cp-slate-100))]">
        <div className={`${container} py-12 lg:py-14`}>
          <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Your first appointment</h2>
          <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
            Registration happens as part of booking, not as a barrier in front of it. Only what is needed to
            see you safely is asked for.
          </p>
          <Steps steps={BOOKING_JOURNEY.register} from={4} />

          <div className="mt-10 rounded-2xl border border-gray-200 bg-white p-6">
            <h3 className="text-[15.5px] font-bold text-gray-900">And then, without you doing anything</h3>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {BOOKING_JOURNEY.after.map(a => (
                <li key={a} className="flex gap-2.5 text-[13px] leading-snug text-gray-700">
                  <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                    style={{ background: PRACTICE_ACCENT }}>✓</span>
                  {a}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── WHY THERE IS NO DIRECTORY HERE ───────────────────────────────
          Stated to the visitor, not only in the source. Someone who arrived expecting to search for a
          doctor deserves to know why they cannot, rather than assuming the search is broken. */}
      <section className={`${container} py-12`}>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 max-w-3xl">
          <h2 className="text-[1.15rem] font-bold text-gray-900">Why there is no list of clinicians yet</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            The directory lists the clinicians of practices that use Competen Practice, and the product is
            not open yet -- so there is nobody to list. We would rather say that than show you a page of
            names you cannot actually book.
          </p>
          <p className="mt-3 text-[14px] leading-relaxed text-gray-600">
            If your own clinic is interested, that is the fastest way for your patients to end up here.
          </p>
        </div>
      </section>
    </JourneyPage>
  );
}
