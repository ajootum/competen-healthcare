import Link from "next/link";
import type { Metadata } from "next";
import { experienceHref } from "@/lib/individual/experiences";
import { progressRows } from "@/lib/individual/scholar/store";
import { buildProgress } from "@/lib/individual/scholar/progress";
import { SELF_DIRECTED_LABEL } from "@/lib/individual/scholar/config";
import { PageHeader, StatePanel, Unreadable, focusRing } from "../../../../../_components/chrome";
import { scholarPage } from "../_components/scholar-page";
import StudyNav from "../_components/StudyNav";

// IMPROVE -- COMPETEN-IND-004 s6. Per-material mastery, cards due and the weekly trend, built from the
// person's own rows (src/lib/individual/scholar/progress.ts).
//
// ⚠ SELF-DIRECTED STUDY, AND LABELLED SO. Nothing here is verified, assessed or visible to an employer,
// and nothing is written to the Passport.
// ⚠ NOT MEASURED IS SHOWN AS NOT MEASURED. A material with no answers has no mastery figure, and a week
// with no answers has no accuracy bar -- never a 0.

export const metadata: Metadata = { title: "Progress" };

const fmtWeek = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function ProgressPage({ params }: { params: Promise<{ experience: string }> }) {
  const page = await scholarPage((await params).experience);
  if (!page) return null;
  const { ctx, x } = page;
  const rows = await progressRows(ctx.admin, ctx.userId);
  const today = new Date().toISOString().slice(0, 10);
  const p = rows.ok ? buildProgress({ ...rows.data, today }) : null;

  return (
    <>
      <PageHeader accent={x.accent} eyebrow="My Learning" title="Progress" intro="How your own study is going, material by material." />
      <StudyNav dueCount={p?.totals.cardsDue ?? null} />
      <p className="mb-6 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">
        <span className="font-semibold">{SELF_DIRECTED_LABEL}</span> It is not added to your Passport and is not shared with anyone.
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
                { k: "Cards mastered", v: `${p.totals.cardsMastered} of ${p.totals.cardsActive + p.totals.cardsMastered}` },
              ].map(s => (
                <div key={s.k} className="rounded-2xl border border-gray-200 bg-white p-4">
                  <dt className="text-[12.5px] font-semibold text-gray-500">{s.k}</dt>
                  <dd className="mt-1 text-[22px] font-bold text-gray-900 tabular-nums">{s.v}</dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="mastery-h" className="mt-8">
              <h2 id="mastery-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">By material</h2>
              <p className="mt-1 text-[13px] text-gray-600">Mastery is the share of a material&apos;s questions you got right the last time you answered them.</p>
              <ul className="mt-3 divide-y divide-gray-200 rounded-2xl border border-gray-200 bg-white">
                {p.materials.map(m => (
                  <li key={m.id} className="p-4 sm:p-5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <Link href={experienceHref("scholar", `study/${m.id}`)} className={`text-[15px] font-semibold text-gray-900 underline-offset-2 hover:underline ${focusRing}`}>{m.title}</Link>
                      <span className="text-[14px] font-bold tabular-nums" style={{ color: m.mastery === null ? undefined : x.accent }}>
                        {m.mastery === null ? <span className="font-semibold text-gray-500">Not measured yet</span> : `${m.mastery}% mastery`}
                      </span>
                    </div>
                    {m.mastery !== null && (
                      <div className="mt-2 h-2 rounded-full bg-gray-100" role="img" aria-label={`${m.mastery}% mastery`}>
                        <div className="h-2 rounded-full" style={{ width: `${m.mastery}%`, background: x.accent }} />
                      </div>
                    )}
                    <p className="mt-2 text-[12.5px] text-gray-600 tabular-nums">
                      {m.questions === 0 ? "No questions written yet" : `${m.answered} of ${m.questions} question${m.questions === 1 ? "" : "s"} answered${m.latestCorrect !== null ? `, ${m.latestCorrect} right on the latest try` : ""}`}
                      {" · "}{m.cardsDue} card{m.cardsDue === 1 ? "" : "s"} due · {m.cardsMastered} mastered
                    </p>
                  </li>
                ))}
              </ul>
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
