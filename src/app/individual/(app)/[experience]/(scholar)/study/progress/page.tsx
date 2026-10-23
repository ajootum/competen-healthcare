import Link from "next/link";
import type { Metadata } from "next";
import { SCHOLAR } from "@/lib/individual/experiences";
import { experienceModulePage, gatedMetadata } from "../../../../../_components/shell-context";
import { experienceHref } from "@/lib/individual/experiences";
import { listPassportChoices, progressRows } from "@/lib/individual/scholar/store";
import { eligibleAchievements } from "@/lib/individual/scholar/passport-items";
import { EVIDENCE_LABEL } from "@/lib/individual/passport";
import { PassportChoices } from "../_components/passport-choice";
import { buildProgress } from "@/lib/individual/scholar/progress";
import { SELF_DIRECTED_LABEL } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import StudyNav from "../_components/StudyNav";

// Request-time only: it reads the release gate and the session, and must never be prerendered at build
// (a build-time render would fail without the service key, or freeze the gate into static HTML).
export const dynamic = "force-dynamic";

// IMPROVE -- COMPETEN-IND-004 s6. Per-material mastery, cards due and the weekly trend, built from the
// person's own rows (src/lib/individual/scholar/progress.ts).
//
// ⚠ SELF-DIRECTED STUDY, AND LABELLED SO. Nothing here is verified, assessed or visible to an employer.
// Nothing reaches the Passport unless the person chooses it, one achievement at a time, in "Your Passport"
// below (migration 375). What can be chosen is a count of practice answered, never accuracy.
// ⚠ NOT MEASURED IS SHOWN AS NOT MEASURED. A material with no answers has no mastery figure, and a week
// with no answers has no accuracy bar -- never a 0.

// The title only when Individual is live: with the release gate off, a 404 must not name the route.
export async function generateMetadata(): Promise<Metadata> {
  return gatedMetadata({ title: "Progress" });
}

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ProgressPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await experienceModulePage((await params).experience, "study");
  if (!page) return null;
  const { ctx } = page;
  const x = SCHOLAR;
  const rows = await progressRows(ctx.admin, ctx.userId);
  const today = new Date().toISOString().slice(0, 10);
  const p = rows.ok ? buildProgress({ ...rows.data, today }) : null;
  const choices = rows.ok ? await listPassportChoices(ctx.admin, ctx.userId) : null;
  const eligible = rows.ok && choices?.ok ? eligibleAchievements({ ...rows.data, choices: choices.data }) : [];

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Progress" intro="How your own study is going, material by material." />
      <StudyNav dueCount={p?.totals.cardsDue ?? null} />
      <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">
        <span className="font-semibold">{SELF_DIRECTED_LABEL}</span> None of it is added to your Passport or shared with anyone unless you choose an achievement below.
      </p>

      {!rows.ok ? (rows.notProvisioned
        ? <StatePanel title="Progress is not set up on this environment yet"><p>The study store it needs has not been installed here.</p></StatePanel>
        : <Unreadable what="study progress" />)
        : p && p.materials.length === 0 ? (
          <StatePanel title="Nothing to measure yet">
            <p>Progress appears once you have uploaded material and answered questions from it.</p>
            <p><Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`} style={{ color: x.accent }}>Go to your materials</Link></p>
          </StatePanel>
        ) : p && (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { k: "Questions answered", v: `${p.totals.answered} of ${p.totals.questions}` },
                { k: "Answers given", v: String(p.totals.attempts) },
                { k: "Cards due now", v: String(p.totals.cardsDue) },
                { k: "Cards on long intervals", v: `${p.totals.cardsLongInterval} of ${p.totals.cardsActive + p.totals.cardsLongInterval}` },
              ].map(s => (
                <div key={s.k} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <dt className="text-[12.5px] font-semibold text-gray-500">{s.k}</dt>
                  <dd className="mt-1 text-[22px] font-bold text-gray-900 tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="accuracy-h" className="mt-8">
              <h2 id="accuracy-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By material</h2>
              <p className="mt-1 text-[13px] text-gray-600">Practice accuracy is the share of a material&apos;s AI-written practice questions you got right the last time you answered them. It reflects how you did on practice questions from your own notes. It is not a measure of competence or of clinical knowledge.</p>
              <ul className="mt-3 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                {p.materials.map(m => (
                  <li key={m.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={experienceHref("scholar", `study/${m.id}`)} className={`text-[15px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{m.title}</Link>
                      <span className="text-[14px] font-bold tabular-nums" style={{ color: m.latestAccuracy === null ? undefined : x.accent }}>
                        {m.latestAccuracy === null ? <span className="font-semibold text-gray-500">Not measured yet</span> : `${m.latestAccuracy}% practice accuracy`}
                      </span>
                    </div>
                    {m.latestAccuracy !== null && (
                      <div className="mt-2 h-2 rounded-full bg-gray-100" role="img" aria-label={`${m.latestAccuracy}% practice accuracy`}>
                        <div className="h-2 rounded-full" style={{ width: `${m.latestAccuracy}%`, background: x.accent }} />
                      </div>
                    )}
                    <p className="mt-2 text-[12.5px] text-gray-600 tabular-nums">
                      {m.questions === 0 ? "No questions written yet" : `${m.answered} of ${m.questions} question${m.questions === 1 ? "" : "s"} answered${m.latestCorrect !== null ? `, ${m.latestCorrect} right on the latest try` : ""}`}
                      {" · "}{m.cardsDue} card{m.cardsDue === 1 ? "" : "s"} due · {m.cardsLongInterval} on long intervals
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="passport-h" className="mt-8">
              <h2 id="passport-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Your Passport</h2>
              <p className="mt-1 text-[13px] text-gray-600">
                You can choose to show what you have practised in your Competen Passport, one achievement at a time. It is labelled
                &ldquo;{EVIDENCE_LABEL.self_directed}&rdquo;. Only the title you give it, the number you answered and when you last studied are shown. Your notes, your answers, whether they were right and anything the AI wrote are never shown.
                It also appears on Passport links you share from Competen Professional, including links already shared. Removing it takes it off them straight away, and your study history stays as it is.
              </p>
              {!choices?.ok ? (choices?.notProvisioned
                ? <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Showing study achievements in your Passport is not available on this environment yet.</p>
                : <div className="mt-3"><Unreadable what="Passport choices" /></div>)
                : eligible.length === 0 ? (
                  <p className="mt-3 rounded-2xl border border-dashed border-gray-300 bg-white p-5 text-[14px] text-gray-600">Nothing to show yet. Answer practice questions or scenarios from a material and it can be shown here.</p>
                ) : <PassportChoices items={eligible} />}
            </section>

            <section aria-labelledby="trend-h" className="mt-8">
              <h2 id="trend-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Last 8 weeks</h2>
              <p className="mt-1 text-[13px] text-gray-600">Answers given each week, and the share that were right. A week with no answers has no bar.</p>
              <table className="mt-3 w-full overflow-hidden rounded-2xl border border-gray-200 bg-white text-left text-[13.5px]">
                <caption className="sr-only">Answers and accuracy by week</caption>
                <thead className="bg-gray-50 text-[12px] font-semibold text-gray-600">
                  <tr><th scope="col" className="px-3 py-2">Week of</th><th scope="col" className="px-3 py-2 text-right">Answers</th><th scope="col" className="px-3 py-2">Right</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {p.trend.map(w => (
                    <tr key={w.weekStart}>
                      <th scope="row" className="whitespace-nowrap px-3 py-2 font-medium text-gray-800">{fmtWeek(w.weekStart)}</th>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-800">{w.attempts}</td>
                      <td className="w-1/2 px-3 py-2">
                        {w.accuracy === null ? <span className="text-gray-400">No answers</span> : (
                          <div className="flex items-center gap-2">
                            <div className="h-2 flex-1 rounded-full bg-gray-100"><div className="h-2 rounded-full" style={{ width: `${w.accuracy}%`, background: x.accent }} /></div>
                            <span className="w-10 text-right tabular-nums text-gray-800">{w.accuracy}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
    </>
  );
}
