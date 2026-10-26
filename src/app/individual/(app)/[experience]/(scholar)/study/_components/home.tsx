import Link from "next/link";
import { EXPERIENCES, SCHOLAR, experienceHref, type ExperienceKey } from "@/lib/individual/experiences";
import { countDue, listLearningSessions, listMaterials } from "@/lib/individual/scholar/store";
import type { IndividualContext } from "@/lib/individual/guard";
import { PageHeader, Unreadable, focusRing } from "../../../../../_components/chrome";
import HomeNotices from "../../../../../_components/HomeNotices";
import { JourneyButton, linkBtn } from "./shell-pieces";
import { LibraryRows } from "./library-list";
import { libraryRow } from "./library-rows";

// THE SCHOLAR HOME -- the study space (Scholar HFE redesign, 2026-10-26; COMPETEN-IND-003 s2(1) and s3).
//
// Every figure is the person's own and read here: cards due, their latest material, their last learning
// session. A figure that could not be read says so; nothing stands in for it. Suggestions point at a space
// and never lock one -- the eight stages are a guide, not a route. The capabilities Scholar does not have
// yet stay listed with the reason, as the experience registry requires.

const card = "rounded-2xl border border-gray-200 bg-white p-6";
const primary = `inline-flex min-h-[44px] items-center justify-center rounded-[9px] px-4 py-2.5 text-[15px] font-semibold text-white hover:opacity-90 ${focusRing}`;
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-[9px] border border-gray-200 bg-white px-4 py-2.5 text-[15px] font-semibold text-gray-900 hover:bg-[#e9f7f8] ${focusRing}`;

export default async function ScholarHome({ ctx, other }: { ctx: IndividualContext; other: ExperienceKey | undefined }) {
  const x = SCHOLAR;
  const firstName = ctx.profile.fullName?.split(" ")[0] ?? null;
  const [materials, due, sessions] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId), listLearningSessions(ctx.admin, ctx.userId, 1),
  ]);
  const none = materials.ok && materials.data.length === 0;
  const resume = sessions.ok ? sessions.data.find(s => s.status === "active") ?? null : null;
  const recent = materials.ok ? materials.data.slice(0, 3).map(m => libraryRow(m)) : [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="Your study space" title="Make your next session count." intro="Pick up where you left off, or follow your curiosity." />
      {/* Notices in the person's own account (migration 437). Nothing while there are none. */}
      <HomeNotices admin={ctx.admin} userId={ctx.userId} accent={x.accent} />

      <section aria-labelledby="hero-h" className="relative mb-6 overflow-hidden rounded-2xl border border-[#cce4e6] bg-[#e8f4f4] p-6 md:p-[30px]">
        <span aria-hidden className="pointer-events-none absolute -top-[35px] right-[35px] hidden select-none text-[220px] font-extrabold leading-none text-[#d1e9eb] md:block">C</span>
        <div className="relative">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em]" style={{ color: x.accent }}>{firstName ? `Welcome back, ${firstName}` : "Welcome back"}</p>
          <h2 id="hero-h" className="mt-3 text-[28px] font-bold leading-tight tracking-[-0.02em] text-gray-900">A little understanding.<br />A stronger next decision.</h2>
          <p className="mt-2 max-w-[600px] text-[15px] text-gray-600">
            {none ? "Start with your own notes. No programme or competency selection is required."
              : resume ? `Continue “${resume.title}”, with your source alongside you.`
                : "Learn from your own material, with your source alongside you."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2.5">
            {none
              ? <Link href={`${experienceHref("scholar", "study")}#upload`} className={primary} style={{ background: x.accent }}>Upload your first material</Link>
              : <Link href={experienceHref("scholar", resume ? `study/learn?session=${resume.id}` : "study/learn")} className={primary} style={{ background: x.accent }}>Continue learning →</Link>}
            <Link href={experienceHref("scholar", "study")} className={secondary}>Explore my library</Link>
          </div>
        </div>
      </section>

      <div className="mb-5 grid gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
        <section className={card}>
          <p className="text-[12px] text-gray-600">Ready to revisit</p>
          {due === null ? <p className="mt-2 text-[15px] font-semibold text-gray-800">Could not be read just now</p> : (
            <p className="my-2 text-[30px] font-bold leading-tight text-gray-900 tabular-nums">{due} <span className="text-[12px] font-normal text-gray-600">{due === 1 ? "card due" : "cards due"}</span></p>
          )}
          <p className="text-[15px] text-gray-600">A short recall session from your saved questions.</p>
          <Link href={experienceHref("scholar", "study/revise")} className={linkBtn} style={{ color: x.accent }}>Open revision →</Link>
        </section>
        <section className={card}>
          <p className="text-[12px] text-gray-600">Practise your reasoning</p>
          <h2 className="mt-3 text-[21px] font-bold tracking-tight text-gray-900">Work through a case</h2>
          <p className="text-[15px] text-gray-600">A scenario from your notes, with new information at each stage.</p>
          <Link href={experienceHref("scholar", "study/apply")} className={linkBtn} style={{ color: x.accent }}>Open Apply →</Link>
        </section>
        <section className={card}>
          <p className="text-[12px] text-gray-600">Your learning evidence</p>
          <h2 className="mt-3 text-[21px] font-bold tracking-tight text-gray-900">Find the next gap</h2>
          <p className="text-[15px] text-gray-600">What your practice supports, and where evidence is still thin.</p>
          <Link href={experienceHref("scholar", "study/evaluate")} className={linkBtn} style={{ color: x.accent }}>Explore Evaluate →</Link>
        </section>
      </div>

      <div className="grid gap-[22px] lg:grid-cols-[1.7fr_1fr]">
        <section aria-labelledby="recent-h" className={card}>
          <div className="mb-3 flex items-center justify-between gap-4">
            <h2 id="recent-h" className="text-[21px] font-bold tracking-tight text-gray-900">Your recent material</h2>
            <Link href={experienceHref("scholar", "study")} className={linkBtn} style={{ color: x.accent }}>View all</Link>
          </div>
          {!materials.ok ? (materials.notProvisioned
            ? <p className="text-[15px] text-gray-600">My Learning is not set up on this environment yet.</p>
            : <Unreadable what="study materials" />)
            : recent.length === 0 ? <p className="text-[15px] text-gray-600">Nothing yet. Upload your notes to start.</p>
              : <LibraryRows rows={recent} />}
        </section>
        <section className={card}>
          <h3 className="text-[16px] font-bold text-gray-900">A guide, not a fixed route</h3>
          <p className="mt-1.5 text-[15px] text-gray-600">Move freely between learning, revision and cases. Suggestions help you choose; they never lock your next step.</p>
          <JourneyButton label="See the eight-stage journey" />
          <hr className="my-[18px] border-0 border-t border-gray-200" />
          <p className="text-[12px] text-gray-600">Join · Onboarding</p>
          <p className="mt-1 text-[15px] text-gray-600">Your shared Individual identity is ready.</p>
          <Link href={experienceHref("scholar", "profile")} className={linkBtn} style={{ color: x.accent }}>Review your profile</Link>
        </section>
      </div>

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

      <section aria-labelledby="planned-h" className="mt-8">
        <h2 id="planned-h" className="text-[12px] font-extrabold uppercase tracking-[0.14em] text-gray-500">Not yet available in {x.name}</h2>
        <p className="mt-1 text-[13.5px] text-gray-600">These are part of {x.name} and are being built. Each one says what is missing, so nothing here pretends to work.</p>
        <ul className="mt-3 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
          {x.planned.map(p => (
            <li key={p.key} className="p-4 sm:p-5">
              <p className="text-[14.5px] font-semibold text-gray-900">{p.label}</p>
              <p className="text-[13.5px] text-gray-700">{p.summary}</p>
              <p className="mt-1 text-[12.5px] text-gray-600"><span className="font-semibold">Not available yet:</span> {p.reason}</p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
