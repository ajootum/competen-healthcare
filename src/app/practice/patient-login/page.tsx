import JourneyPage from "@/components/marketing/JourneyPage";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { PATIENT_LOGIN } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";

// LP-PAT-001 Patient Login & My Care Entry.
//
// NO SIGN-IN FORM, for the same reason as the practice sign-in: there is no patient role and no My Care
// workspace to enter. What the page does carry is the privacy statement, because that is the part a patient
// weighs before handing over a phone number -- and it is true today regardless of when the product opens.

export const metadata = pageMetadata({
  title: "Patient sign-in — Competen Practice",
  description: PATIENT_LOGIN.body,
  path: "/practice/patient-login",
});

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function Page() {
  return (
    <JourneyPage
      journeyKey="patient-login"
      eyebrow={PATIENT_LOGIN.eyebrow}
      title={PATIENT_LOGIN.title}
      body={PATIENT_LOGIN.body}
      subject="Competen Practice - patient access enquiry"
    >
      {/* ── WHAT MY CARE HOLDS ───────────────────────────────────────────── */}
      <section className={`${container} py-12 lg:py-14`}>
        <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">What you will find inside</h2>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PATIENT_LOGIN.has.map(h => (
            <li key={h.title} className="rounded-2xl border border-gray-200 bg-white p-5">
              <span aria-hidden className="block w-7 h-1 rounded-full" style={{ background: PRACTICE_ACCENT }} />
              <h3 className="mt-3 text-[15.5px] font-bold text-gray-900">{h.title}</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-gray-600">{h.body}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── PRIVACY ──────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,var(--cp-slate-100))]">
        <div className={`${container} py-12 lg:py-14 grid lg:grid-cols-2 gap-10`}>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Your information, and who sees it</h2>
            <ul className="mt-5 space-y-2.5">
              {PATIENT_LOGIN.privacy.map(p => (
                <li key={p} className="flex gap-2.5 text-[14px] leading-snug text-gray-700">
                  <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                    style={{ background: PRACTICE_ACCENT }}>✓</span>
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-5 max-w-md text-[13px] leading-relaxed text-gray-600">
              Your clinician decides which diagnoses, treatments and documents are shared with you. Nothing
              is released by default, and your own uploads are always clearly marked as yours.
            </p>
          </div>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Planned, not yet available</h2>
            <ul className="mt-5 space-y-2.5">
              {PATIENT_LOGIN.planned.map(p => (
                <li key={p} className="flex items-center gap-2.5 text-[14px] text-gray-500">
                  <span aria-hidden className="w-4 h-4 shrink-0 rounded-full bg-gray-200" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </JourneyPage>
  );
}
