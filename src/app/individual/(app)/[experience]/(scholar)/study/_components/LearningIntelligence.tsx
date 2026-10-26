import Link from "next/link";
import type { LearningIntelligence as LI, Insufficient, NotMeasured } from "@/lib/individual/scholar/intelligence";
import { focusRing } from "../../../../../_components/chrome";

// LEARNING INTELLIGENCE -- COMPETEN-SCHOLAR-01 S5. Four measures, each in its own panel, never one blended
// score. A measure without the data to support it says so, in its own words: "Not measured" with the reason,
// or "Too little practice to say" with how much there is and how much is needed. Never a blank, never a 0.
//
// Presentational only: everything is computed by src/lib/individual/scholar/intelligence.ts.

const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function Absent({ m }: { m: Insufficient | NotMeasured }) {
  return m.state === "insufficient" ? (
    <div>
      <p className="text-[14px] font-semibold text-gray-700">Too little practice to say</p>
      <p className="mt-1 text-[13px] text-gray-600">{m.reason} You have {m.have} so far.</p>
    </div>
  ) : (
    <div>
      <p className="text-[14px] font-semibold text-gray-700">Not measured</p>
      <p className="mt-1 text-[13px] text-gray-600">{m.reason}</p>
    </div>
  );
}

function Panel({ id, title, what, accent, children }: { id: string; title: string; what: string; accent: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <h3 id={id} className="text-[15px] font-bold" style={{ color: accent }}>{title}</h3>
      <p className="mt-0.5 text-[12.5px] text-gray-500">{what}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

const Fig = ({ k, v }: { k: string; v: string }) => (
  <div><dt className="text-[12px] font-semibold text-gray-500">{k}</dt><dd className="text-[18px] font-bold tabular-nums text-gray-900">{v}</dd></div>
);

export default function LearningIntelligence({ li, accent }: { li: LI; accent: string }) {
  const { coverage, engagement, knowledge, reasoning } = li;
  return (
    <section aria-labelledby="li-h" className="mt-8">
      <h2 id="li-h" className="text-[13px] font-bold uppercase tracking-[0.14em] text-gray-500">Learning intelligence</h2>
      <p className="mt-1 text-[13px] text-gray-600">Four separate views of your own study. They are not combined into a score, and none of them is a measure of competence.</p>

      {li.recommendations.length > 0 && (
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
          <h3 className="text-[15px] font-bold text-gray-900">What to do next</h3>
          <ol className="mt-2 space-y-2">
            {li.recommendations.map(r => (
              <li key={r.id} className="text-[14px]">
                {r.href
                  ? <Link href={r.href} className={`font-semibold underline-offset-2 hover:underline ${focusRing}`} style={{ color: accent }}>{r.title}</Link>
                  : <span className="font-semibold text-gray-900">{r.title}</span>}
                <span className="block text-[13px] text-gray-600">{r.reason}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {li.insights.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-2xl border border-gray-200 bg-white p-4 text-[13.5px] text-gray-800 sm:p-5">
          {li.insights.map(s => <li key={s}>{s}</li>)}
        </ul>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Panel id="li-eng" title="Learning engagement" accent={accent} what="How regularly you study: days with practice or revision, answers and reviews.">
          {engagement.state === "measured" ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Fig k={`Study days, last ${engagement.windowDays}`} v={String(engagement.studyDays)} />
                <Fig k={`Active weeks, last ${engagement.weeks}`} v={String(engagement.activeWeeks)} />
                <Fig k={`Answers, last ${engagement.windowDays} days`} v={String(engagement.answered)} />
                <Fig k={`Reviews, last ${engagement.windowDays} days`} v={engagement.reviews === null ? "Not measured" : String(engagement.reviews)} />
              </dl>
              <p className="mt-2 text-[12.5px] text-gray-600">
                {engagement.lastStudied ? `Last studied ${fmt(engagement.lastStudied)}.` : "No study recorded yet."}{" "}
                {engagement.reviews === null ? "Revision reviews are not recorded here yet." : engagement.reviewsSince ? `Revision reviews are recorded from ${fmt(engagement.reviewsSince)}.` : "Revision reviews are recorded from your next review."}
              </p>
            </>
          ) : <Absent m={engagement} />}
        </Panel>

        <Panel id="li-know" title="Knowledge performance" accent={accent} what="How your practice questions go, and how well you recall revision cards. Practice on your own notes, not an assessment.">
          {knowledge.state === "measured" ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Fig k="Right on latest try" v={`${knowledge.accuracy}%`} />
                <Fig k="Right first time" v={`${knowledge.firstTryAccuracy}%`} />
                <Fig k="Put right later" v={String(knowledge.corrected)} />
                <Fig k="Recall (0 to 5)" v={knowledge.recall.state === "measured" ? String(knowledge.recall.meanQuality) : knowledge.recall.state === "insufficient" ? "Too few" : "Not measured"} />
              </dl>
              <p className="mt-2 text-[12.5px] text-gray-600">
                From {knowledge.answered} practice questions answered.{" "}
                {knowledge.recall.state === "measured" ? `Recall is the average of your own grades over ${knowledge.recall.reviews} recent reviews.` : knowledge.recall.reason}
              </p>
            </>
          ) : <Absent m={knowledge} />}
        </Panel>

        <Panel id="li-reason" title="Clinical reasoning" accent={accent} what="How your practice scenarios go, tracked apart from practice questions. Scenarios from your notes, not clinically reviewed cases.">
          {reasoning.state === "measured" ? (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <Fig k="Right on latest try" v={`${reasoning.accuracy}%`} />
                <Fig k="Right first time" v={`${reasoning.firstTryAccuracy}%`} />
                <Fig k="Put right later" v={String(reasoning.corrected)} />
              </dl>
              <p className="mt-2 text-[12.5px] text-gray-600">From {reasoning.answered} practice scenarios worked through.</p>
            </>
          ) : <Absent m={reasoning} />}
        </Panel>

        <Panel id="li-cov" title="Competency coverage" accent={accent} what="Which competencies in your framework your practice has touched. Practised, not achieved.">
          {coverage.state === "measured" ? (
            <>
              <dl className="grid grid-cols-2 gap-3">
                <Fig k="Practised" v={`${coverage.covered} of ${coverage.total}`} />
                <Fig k="Practised with a right answer" v={`${coverage.coveredPositive} of ${coverage.total}`} />
              </dl>
              <p className="mt-2 text-[12.5px] text-gray-600">{coverage.framework}.{coverage.gaps.length ? ` Not yet practised: ${coverage.gaps.slice(0, 5).map(g => g.expected ? `${g.name} (expected: ${g.expected})` : g.name).join(", ")}${coverage.gaps.length > 5 ? ` and ${coverage.gaps.length - 5} more` : ""}.` : " Every competency has been practised."}</p>
            </>
          ) : <Absent m={coverage} />}
        </Panel>
      </div>
    </section>
  );
}
