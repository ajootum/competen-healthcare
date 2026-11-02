"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InsightsView as InsightsData } from "@/lib/individual/scholar/plan-data";
import { adjustmentRef, planTile, practiceCaption, type Adjustment, type AdjustmentIcon } from "@/lib/individual/scholar/plan-insights";
import { cardCls, linkBtn, primaryBtn, quietBtn } from "./plan-style";
import { BulbIcon, CalendarIcon, CardsIcon, ClipboardCheckIcon, ErrorLine, PlanDialog, PracticeIcon, RestartIcon, callJson, errorOf } from "./plan-ui";
import { EntryEditor } from "./plan-entries";
import { PlanSetup } from "./plan-setup";

// MY PLAN -> INSIGHTS (PLP-01..04, My Plan correction CE-03). "Last 28 days": four tiles (study days, flashcards due, practice answered, plan
// completed), then the adjustments Scholar suggests, each with Do it now, Add to plan (where that means something) and Not now. Measured figures
// (practice performance, retention) appear only as secondary lines and only when they were measured: NEVER a zero for missing evidence. "Practice
// answered" is a count of answers, so 0 is a true count, captioned "Not measured yet". "Plan completed" has no figure when nothing was planned.
// Self-reported study (sessions the learner marked done in their calendar) stays a separate, labelled line. Insights describe study; they are not an
// assessment of competence. ONE formative note, at the bottom.

type Ready = Extract<InsightsData, { ok: true }>;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Tile({ label, value, caption, testId }: { label: string; value: string; caption: string; testId: string }) {
  return (
    <li className="rounded-2xl bg-gray-100 p-4" data-testid={testId}>
      <p className="text-[13.5px] text-gray-700">{label}</p>
      <p className="mt-1 text-[32px] font-bold leading-tight tabular-nums text-gray-900">{value}</p>
      <p className="mt-0.5 text-[12.5px] text-gray-700">{caption}</p>
    </li>
  );
}

const ICON: Record<AdjustmentIcon, React.ReactNode> = {
  cards: <CardsIcon size={20} />, check: <ClipboardCheckIcon size={20} />, calendar: <CalendarIcon size={20} />, restart: <RestartIcon size={20} />, practice: <PracticeIcon size={20} />,
};

function AdjustmentRow({ a, v, accent, onDeclined }: { a: Adjustment; v: Ready; accent: string; onDeclined: (id: string) => void }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function notNow() {
    setBusy(true); setError("");
    const r = await callJson("/api/individual/scholar/plan/decision", "POST", { kind: "recommendation_declined", ref: adjustmentRef(a.id), fingerprint: a.fingerprint });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r)); return; }
    onDeclined(a.id);
    router.refresh();
  }
  const plan = a.addToPlan;
  return (
    <li className="py-3 first:pt-0 last:pb-0" data-testid={`adjustment-${a.id}`}>
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-gray-700">{ICON[a.icon] ?? <BulbIcon size={20} />}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-gray-900">{a.title}</p>
          <p className="text-[13.5px] text-gray-700">{a.text}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {a.doNow && <Link href={a.doNow.href} className={primaryBtn} style={{ background: accent }}>Do it now<span className="sr-only">: {a.title}</span></Link>}
            {plan && <button type="button" className={quietBtn} onClick={() => setAdding(true)}>Add to plan<span className="sr-only">: {a.title}</span></button>}
            {v.features.decisions && <button type="button" className={quietBtn} disabled={busy} onClick={() => void notNow()}>Not now<span className="sr-only">: {a.title}</span></button>}
          </div>
          <ErrorLine text={error} />
        </div>
      </div>
      {adding && plan?.kind === "entry" && (
        <EntryEditor mode={{ kind: "create", date: plan.date, prefill: { title: plan.title, entryType: "study_session", duration: String(plan.minutes), date: plan.date } }} today={v.today} links={[]} accent={accent} onClose={() => setAdding(false)} />
      )}
      {adding && plan?.kind === "settings" && (
        <PlanDialog title="Study on more days" onClose={() => setAdding(false)} wide>
          <p className="mb-3 text-[13.5px] text-gray-700">Your plan changes only if you save. It now asks for {plan.daysPerWeek} days a week.</p>
          <PlanSetup accent={accent} today={v.today} extras={v.features.settingsExtras} starting={v.starting} bare onDone={() => setAdding(false)}
            initial={{ ...v.settings, daysPerWeek: plan.daysPerWeek, weeklyMinutes: (v.settings.sessionMinutes ?? Math.max(10, Math.round(v.settings.weeklyMinutes / Math.max(1, v.settings.daysPerWeek)))) * plan.daysPerWeek }} />
        </PlanDialog>
      )}
    </li>
  );
}

export function InsightsView({ view, progressHref, accent }: { view: Ready; progressHref: string; accent: string }) {
  const { insights, tiles } = view;
  const { consistency: c, practice: p, retention: r } = insights;
  const plan = planTile(tiles.plan);
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const shown = view.adjustments.filter(a => !hidden.includes(a.id));
  return (
    <section aria-labelledby="plan-insights-h" className={`${cardCls} space-y-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="plan-insights-h" className="text-[22px] font-bold text-gray-900">Insights</h2>
        <p className="text-[13.5px] text-gray-700">Last {tiles.windowDays} days</p>
      </div>
      <ul className="grid grid-cols-2 gap-3" aria-label="Last 28 days">
        <Tile testId="tile-study-days" label="Study days" value={String(tiles.studyDays)} caption="Qualifying activity" />
        <Tile testId="tile-flashcards" label="Flashcards due" value={String(tiles.flashcardsDue)} caption="Ready for review" />
        <Tile testId="tile-practice" label="Practice answered" value={String(tiles.practiceAnswered)} caption={practiceCaption(tiles.practiceAnswered)} />
        <Tile testId="tile-plan" label="Plan completed" value={plan.value} caption={plan.caption} />
      </ul>

      {(c.state === "measured" || p.state === "measured" || r.state === "measured" || insights.selfReported) && (
        <ul className="space-y-1 text-[13.5px] text-gray-800" aria-label="More detail" data-testid="insight-detail">
          {c.state === "measured" && <li>{c.activeWeeks} of the last {c.weeks} weeks had recorded learning.{c.lastStudied ? ` Last studied ${day(c.lastStudied)}.` : ""}</li>}
          {p.state === "measured" && <li>Practice performance: {p.percent}% of your last {p.answered} app-marked answers were right.{p.lowEvidence ? " Only a few answers so far, so treat this with care." : ""}</li>}
          {r.state === "measured" && <li>Retention: you rated {r.rememberedPercent}% of {r.reviews} spaced reviews in the last {r.windowDays} days as remembered.</li>}
          {insights.selfReported && (
            <li data-testid="self-reported"><span className="font-semibold">Self-reported study sessions: </span>
              {insights.selfReported.sessions} session{insights.selfReported.sessions === 1 ? "" : "s"}{insights.selfReported.minutes !== null ? `, ${insights.selfReported.minutes} minutes` : ""}. {insights.selfReported.label}
            </li>
          )}
        </ul>
      )}

      <div>
        <h3 className="text-[16px] font-bold text-gray-900">Suggested next adjustments</h3>
        {shown.length === 0
          ? <p className="mt-1 text-[14px] text-gray-700">Nothing to adjust right now. Keep studying and suggestions appear as your evidence grows.</p>
          : <ul className="mt-3 divide-y divide-gray-100">{shown.map(a => <AdjustmentRow key={a.id} a={a} v={view} accent={accent} onDeclined={id => setHidden(h => [...h, id])} />)}</ul>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
        <p className="text-[12.5px] text-gray-600">These describe how you study. They are not an assessment of competence and are not added to your Passport.</p>
        <Link href={progressHref} className={linkBtn}>See detail in Progress</Link>
      </div>
    </section>
  );
}
