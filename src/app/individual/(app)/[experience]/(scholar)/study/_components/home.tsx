import Link from "next/link";
import { headers } from "next/headers";
import { EXPERIENCES, SCHOLAR, experienceHref, type ExperienceKey } from "@/lib/individual/experiences";
import { countDue, listLearningSessions, listMaterials } from "@/lib/individual/scholar/store";
import type { IndividualContext } from "@/lib/individual/guard";
import { PageHeader, focusRing } from "../../../../../_components/chrome";
import HomeNotices from "../../../../../_components/HomeNotices";
import { continueStudy } from "@/lib/individual/scholar/study-context";
import { loadIndividualPolicy } from "@/lib/individual/policy";
import { learnerTimeZone, learnerToday } from "@/lib/individual/scholar/learning-definitions";
import HomeActivity, { readHomeExtras } from "./home-activity";
import { scholarModulesOnce } from "@/lib/individual/scholar/module-access";
import { competenciesHref, continueTarget, coursesExploreHref, failedPart, HOME_CARDS, offPart, okPart, visibleHomeCards } from "./home-model";

// THE SCHOLAR HOME -- the study space (Scholar HFE redesign, 2026-10-26; COMPETEN-IND-003 s2(1) and s3), now the
// door to the three modules (modular restructuring S3): My Learning, Courses & Training, My Competencies.
//
// Every figure is the person's own and read here, in parallel, each read failing on its own: cards due, their latest
// material, their last learning session, their open study session, and the rows in home-activity.tsx. A figure that
// could not be read says so; nothing stands in for it. The capabilities Scholar does not have yet stay listed with
// the reason, as the experience registry requires.

const card = "flex flex-col rounded-2xl border border-gray-200 bg-white p-6";
const primary = `inline-flex min-h-[44px] w-full items-center justify-center rounded-[9px] px-4 py-2.5 text-[15px] font-semibold text-white hover:opacity-90 sm:w-auto ${focusRing}`;

const firstNameOf = (ctx: IndividualContext) => ctx.profile.fullName?.split(" ")[0] ?? null;

export default async function ScholarHome({ ctx, other }: { ctx: IndividualContext; other: ExperienceKey | undefined }) {
  const x = SCHOLAR;
  const hdrs = await headers();
  const tz = learnerTimeZone(hdrs), today = learnerToday(hdrs);
  // Policy first, as the other reads need it; it runs alongside the reads that do not.
  const policyP = loadIndividualPolicy(ctx.admin);
  // Private module development access: the modules this person may see (any failure: none). Asked before the reads that depend on it.
  const modules = [...(await scholarModulesOnce(ctx.admin, ctx.userId))];
  // SCHOLAR-SESSION-AI-02: an open study session takes the Continue slot, reopened in its last stage (null where off).
  const [materials, due, sessions, study, extras] = await Promise.all([
    listMaterials(ctx.admin, ctx.userId), countDue(ctx.admin, ctx.userId), listLearningSessions(ctx.admin, ctx.userId, 1),
    policyP.then(p => continueStudy(ctx.admin, ctx.userId, p)),
    policyP.then(p => readHomeExtras(ctx, p, { now: new Date(), tz, today, modules })),
  ]);
  const none = materials.ok && materials.data.length === 0;
  const resume = sessions.ok ? sessions.data.find(s => s.status === "active") ?? null : null;
  const go = continueTarget({ noMaterial: none, study, resumeSessionId: resume?.id ?? null });
  const hrefOf = { learning: go.href, courses: coursesExploreHref(), competencies: competenciesHref() } as const;
  const labelOf = { learning: go.label, courses: HOME_CARDS[1].cta, competencies: HOME_CARDS[2].cta } as const;
  const cards = visibleHomeCards(modules);

  return (
    <>
      <PageHeader accent={x.accent} eyebrow={firstNameOf(ctx) ? `Welcome back, ${firstNameOf(ctx)}` : "Welcome back"} title="Make your next session count." intro="Pick up where you left off, or follow your curiosity." />
      {/* Notices in the person's own account (migration 437). Nothing while there are none. */}
      <HomeNotices admin={ctx.admin} userId={ctx.userId} accent={x.accent} />

      <div className={`mb-6 grid gap-[18px] ${cards.length >= 3 ? "md:grid-cols-3" : cards.length === 2 ? "md:grid-cols-2" : ""}`}>
        {cards.map(c => (
          <section key={c.key} aria-labelledby={`card-${c.key}`} data-testid={`home-card-${c.key}`} className={card}>
            <h2 id={`card-${c.key}`} className="text-[21px] font-bold tracking-tight text-gray-900">{c.title}</h2>
            <p className="mb-5 mt-1 text-[15px] text-gray-600">{c.line}</p>
            <div className="mt-auto">
              <Link href={hrefOf[c.key]} className={primary} style={{ background: x.accent }}>{labelOf[c.key]}</Link>
            </div>
          </section>
        ))}
      </div>

      <HomeActivity
        accent={x.accent}
        modules={modules}
        input={{
          study: study ? { id: study.id, title: study.title, space: study.space } : null,
          ...extras,
          due,
          materials: materials.ok ? okPart(materials.data.slice(0, 1).map(m => ({ id: m.id, title: m.title }))) : materials.notProvisioned ? offPart : failedPart,
        }}
      />

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
