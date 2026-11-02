import Link from "next/link";
import type { Insights } from "@/lib/individual/scholar/plan-insights";
import { cardCls, linkBtn } from "./plan-style";

// MY PLAN -> INSIGHTS (PLP-01..04). Three plain indicators of how the learner is studying, each with the figure and its basis, or "Not measured
// yet" and the reason. NEVER a zero for missing evidence. Self-reported study (sessions the learner marked done in their calendar) is a separate,
// labelled line and is not counted in the indicators. Insights describe study; they are not an assessment of competence.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Indicator({ title, value, basis, caution }: { title: string; value: string | null; basis: string; caution?: string | null }) {
  return (
    <li className={cardCls}>
      <h3 className="text-[14px] font-bold text-gray-900">{title}</h3>
      {value ? <p className="mt-1 text-[26px] font-bold leading-tight text-gray-900 tabular-nums">{value}</p> : <p className="mt-1 text-[18px] font-bold text-gray-800">Not measured yet</p>}
      <p className="mt-1 text-[13.5px] text-gray-700">{basis}</p>
      {caution && <p className="mt-1 text-[12.5px] font-semibold text-gray-800">{caution}</p>}
    </li>
  );
}

export function InsightsView({ insights, progressHref }: { insights: Insights; progressHref: string }) {
  const { consistency: c, practice: p, retention: r } = insights;
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 md:grid-cols-3" aria-label="Study indicators">
        <Indicator title="Study consistency"
          value={c.state === "measured" ? `${c.studyDays} of ${c.windowDays} days` : null}
          basis={c.state === "measured" ? `Days with recorded learning in the last ${c.windowDays} days, and ${c.activeWeeks} of the last ${c.weeks} weeks with some.${c.lastStudied ? ` Last studied ${day(c.lastStudied)}.` : ""}` : c.reason} />
        <Indicator title="Practice performance"
          value={p.state === "measured" ? `${p.percent}%` : null}
          basis={p.state === "measured" ? `Of your last ${p.answered} answers marked by the app, the share that were right.` : p.reason}
          caution={p.state === "measured" && p.lowEvidence ? "Only a few answers so far, so treat this with care." : null} />
        <Indicator title="Retention evidence"
          value={r.state === "measured" ? `${r.rememberedPercent}%` : null}
          basis={r.state === "measured" ? `Of ${r.reviews} spaced reviews in the last ${r.windowDays} days, the share you rated as remembered.` : r.reason} />
      </ul>
      {insights.selfReported && (
        <p className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13.5px] text-gray-800" data-testid="self-reported">
          <span className="font-semibold">Self-reported study sessions: </span>
          {insights.selfReported.sessions} session{insights.selfReported.sessions === 1 ? "" : "s"}{insights.selfReported.minutes !== null ? `, ${insights.selfReported.minutes} minutes` : ""}. {insights.selfReported.label}
        </p>
      )}
      {insights.recommendations.length > 0 && (
        <section aria-labelledby="insight-rec-h" className={cardCls}>
          <h3 id="insight-rec-h" className="text-[14px] font-bold text-gray-900">What might help</h3>
          <ul className="mt-2 space-y-2">
            {insights.recommendations.map(x => (
              <li key={x.id}><p className="text-[14px] font-semibold text-gray-900">{x.text}</p><p className="text-[13px] text-gray-600">{x.basis}</p></li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[12.5px] text-gray-600">These describe how you study. They are not an assessment of competence and are not added to your Passport.</p>
      <Link href={progressHref} className={linkBtn}>See detail in Progress</Link>
    </div>
  );
}
