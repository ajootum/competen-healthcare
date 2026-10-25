import Link from "next/link";
import { EXPERIENCES, experienceHref } from "@/lib/individual/experiences";
import { loadIndividualPassport } from "@/lib/individual/passport";
import { experiencePage } from "../../_components/shell-context";
import { PageHeader, focusRing } from "../../_components/chrome";
import HomeReminders from "../../_components/professional/HomeReminders";
import HomeNotices from "../../_components/HomeNotices";
import { loadRegistration, RegistrationScreen } from "../../_components/professional/registration";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// THE EXPERIENCE HOME -- COMPETEN-IND-003 s2(1) and s3.
//
// What it shows is what exists: the foundation modules (Passport, personal AI, profile and history) with
// REAL figures from the person's own record, and the experience's planned capabilities as a governed
// "not yet available" list with the reason for each. No figure here is invented, and none stands in for
// a missing one: an unreadable Passport says so, and a person with no evidence sees "none yet", not 0%.

export default async function ExperienceHome({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experiencePage((await params).experience);
  if (!page) return null;
  const { ctx, experience } = page;
  const x = EXPERIENCES[experience];
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? null;
  // COMPETEN-PROFESSIONAL-PROFILE-01: until professional identity is established, the Professional home is the
  // registration form. null (registered, migration 450 absent, or unreadable) shows the workspace unchanged.
  const registration = experience === "professional" ? await loadRegistration(ctx.admin, ctx.userId) : null;
  if (registration)
    return (
      <>
        <PageHeader accent={x.accent} eyebrow={x.tagline} title={firstName ? `Welcome to ${x.name}, ${firstName}` : `Welcome to ${x.name}`}
          intro="Before your workspace opens, tell us about your practice. It takes a minute, and only three answers are needed." />
        <RegistrationScreen model={registration} accent={x.accent} />
      </>
    );
  const passport = await loadIndividualPassport(ctx.admin, ctx.userId, new Date().toISOString().slice(0, 10));
  const other = ctx.live.find(k => k !== experience);

  const currentCount = passport.competencies?.filter(c => c.current).length ?? null;
  const credCount = passport.credentials?.length ?? null;
  const passportLine =
    currentCount === null || credCount === null ? "Part of your Passport could not be read just now."
      : currentCount === 0 && credCount === 0 ? "No assessed competencies or credentials on your record yet."
        : `${currentCount} current assessed ${currentCount === 1 ? "competency" : "competencies"} · ${credCount} ${credCount === 1 ? "credential" : "credentials"} on record`;

  const cards = [
    { href: experienceHref(experience, "passport"), title: "Competen Passport", body: passportLine },
    { href: experienceHref(experience, "assistant"), title: "Personal AI", body: experience === "scholar" ? "Ask about a topic, your revision or your record." : "Ask about your development, CPD planning or your record." },
    { href: experienceHref(experience, "profile"), title: "Profile & history", body: "Your Competen identity and the history that stays with you." },
  ];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={x.tagline} title={firstName ? `Hello, ${firstName}` : x.name} intro={x.homeIntro} />
      {/* Notices in the person's own account (migration 437), for every experience. Nothing while there are none. */}
      <HomeNotices admin={ctx.admin} userId={ctx.userId} accent={x.accent} />
      {/* Competen Professional: renewals due, while the person's in-app reminder switch is on (migration 374). */}
      {experience === "professional" && <HomeReminders admin={ctx.admin} userId={ctx.userId} />}

      {x.modules.some(m => m.nav !== false) && (
        <section aria-labelledby="modules-h" className="mb-8">
          <h2 id="modules-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">In {x.name}</h2>
          <ol className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {x.modules.filter(m => m.nav !== false).map((m, i) => (
              <li key={m.key}>
                <Link href={experienceHref(experience, m.segment)} className={`flex h-full gap-3 rounded-2xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm ${focusRing}`}>
                  <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[13px] font-bold" style={{ background: x.accentSoft, color: x.accent }}>{i + 1}</span>
                  <span className="min-w-0">
                    <span className="block text-[14.5px] font-bold text-gray-900">{m.label}</span>
                    {m.summary && <span className="mt-0.5 block text-[13px] leading-relaxed text-gray-600">{m.summary}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section aria-labelledby="foundation-h">
        <h2 id="foundation-h" className="sr-only">Your foundation</h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {cards.map(c => (
            <li key={c.href}>
              <Link href={c.href} className={`block h-full rounded-2xl border border-gray-200 bg-white p-5 hover:border-gray-300 hover:shadow-sm ${focusRing}`}>
                <span className="block text-[15px] font-bold text-gray-900">{c.title}</span>
                <span className="mt-1 block text-[13.5px] leading-relaxed text-gray-600">{c.body}</span>
                <span className="mt-3 block text-[13px] font-semibold" style={{ color: x.accent }}>Open →</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {other && (
        <section className="mt-6 rounded-2xl p-5" style={{ background: EXPERIENCES[other].accentSoft }}>
          <p className="text-[14px] text-gray-800">
            <span className="font-semibold" style={{ color: EXPERIENCES[other].accent }}>{EXPERIENCES[other].name}</span> is also active on your account. It shares this Passport, profile and personal AI.
          </p>
          <Link href={experienceHref(other)} className={`mt-2 inline-flex min-h-[44px] items-center text-[14px] font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: EXPERIENCES[other].accent }}>
            Switch to {EXPERIENCES[other].name} →
          </Link>
        </section>
      )}

      <section aria-labelledby="planned-h" className="mt-10">
        <h2 id="planned-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Not yet available in {x.name}</h2>
        <p className="mt-1 text-[13.5px] text-gray-600">These are part of {x.name} and are being built. Each one says what is missing, so nothing here pretends to work.</p>
        <ul className="mt-4 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
          {x.planned.map(p => (
            <li key={p.key} className="p-4 sm:p-5">
              <p className="text-[14.5px] font-semibold text-gray-900">{p.label}</p>
              <p className="text-[13.5px] text-gray-700">{p.summary}</p>
              <p className="mt-1 text-[12.5px] text-gray-500"><span className="font-semibold">Not available yet:</span> {p.reason}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
