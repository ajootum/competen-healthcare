import Link from "next/link";
import JourneyPage from "@/components/marketing/JourneyPage";
import { PRACTICE_ACCENT } from "@/lib/marketing/practice-content";
import { PRACTICE_LOGIN } from "@/lib/marketing/practice-site";
import { pageMetadata } from "@/lib/marketing/site";

// LP-DOC-001 Practice Login Experience.
//
// NO SIGN-IN FORM. The specification's post-login routing sends a doctor to a Practice Dashboard, a
// receptionist to a Reception Workspace, a practice administrator to Practice Administration and an
// enterprise administrator to an Enterprise Overview. None of those four workspaces exists, and neither do
// the roles: this application knows nurse, hospital_admin and super_admin. A form here would collect a
// password and then have nowhere to send the person who typed it.
//
// So the page describes where each role WILL land, and points people who already hold a Competen account
// at the sign-in that genuinely works. That link matters -- a clinician who does hospital shifts on
// Competen today would otherwise sit on this page assuming their account is broken.

export const metadata = pageMetadata({
  title: "Practice sign-in — Competen Practice",
  description: PRACTICE_LOGIN.body,
  path: "/practice/login",
});

// PER-REQUEST, because the availability panel reads practice_sign_in. Statically rendered, the flag
// would be baked in at build time and the launch ladder would need a deploy to move -- which is not a
// flag, it is a constant with extra steps. The page is light and the correctness is worth the cache.
export const dynamic = "force-dynamic";

const container = "mx-auto w-full max-w-7xl px-5 sm:px-8";

export default function Page() {
  return (
    <JourneyPage
      journeyKey="practice-login"
      eyebrow={PRACTICE_LOGIN.eyebrow}
      title={PRACTICE_LOGIN.title}
      body={PRACTICE_LOGIN.body}
      subject="Competen Practice - practice access enquiry"
    >
      {/* ── WHERE EACH ROLE LANDS ────────────────────────────────────────── */}
      <section className={`${container} py-12 lg:py-14`}>
        <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Everyone lands where their job starts</h2>
        <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-gray-600">
          One sign-in for the whole practice. What you see afterwards depends on the role you hold, not on
          which link you clicked.
        </p>
        <ul className="mt-8 grid gap-5 sm:grid-cols-2">
          {PRACTICE_LOGIN.audiences.map(a => (
            <li key={a.role} className="rounded-2xl border border-gray-200 bg-white p-5">
              <h3 className="text-[15.5px] font-bold text-gray-900">{a.role}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-gray-600">{a.lands}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* ── SECURITY ─────────────────────────────────────────────────────── */}
      <section className="border-y border-gray-100 bg-[var(--cmp-neutral-50,var(--cp-slate-100))]">
        <div className={`${container} py-12 lg:py-14 grid lg:grid-cols-2 gap-10`}>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">How access is protected</h2>
            <ul className="mt-5 space-y-2.5">
              {PRACTICE_LOGIN.security.map(s => (
                <li key={s} className="flex gap-2.5 text-[14px] leading-snug text-gray-700">
                  <span aria-hidden className="mt-0.5 w-4 h-4 shrink-0 rounded-full flex items-center justify-center text-[9px] text-white"
                    style={{ background: PRACTICE_ACCENT }}>✓</span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-[1.5rem] font-bold tracking-tight text-gray-900">Planned, not yet available</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-gray-600">
              Named in the specification as configurable or future. Listed here rather than shown as
              controls that would not work.
            </p>
            <ul className="mt-5 space-y-2.5">
              {PRACTICE_LOGIN.planned.map(p => (
                <li key={p} className="flex items-center gap-2.5 text-[14px] text-gray-500">
                  <span aria-hidden className="w-4 h-4 shrink-0 rounded-full bg-gray-200" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── THE SIGN-IN THAT DOES WORK ───────────────────────────────────── */}
      <section className={`${container} py-12`}>
        <div className="rounded-2xl border border-gray-200 bg-white p-6 sm:p-8 max-w-3xl">
          <h2 className="text-[1.15rem] font-bold text-gray-900">Already use Competen for something else?</h2>
          <p className="mt-2 text-[14px] leading-relaxed text-gray-600">
            If you work on a Competen workspace today, your existing account still signs in as it always
            has. Competen Practice is separate and is not open yet -- the account you have is not broken.
          </p>
          <Link href="/login"
            className="mt-5 inline-block rounded-xl border-2 px-5 py-3 text-[14px] font-semibold transition-colors hover:bg-gray-50"
            style={{ borderColor: "var(--cp-primary-border)", color: PRACTICE_ACCENT }}>
            Go to Competen sign-in →
          </Link>
        </div>
      </section>
    </JourneyPage>
  );
}
