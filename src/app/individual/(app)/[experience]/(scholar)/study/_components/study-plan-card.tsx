"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { STUDY_PLAN_LIMITS } from "@/lib/individual/scholar/study-plan-input";
import type { PlanSpace, StudyPlanResult, StudyPlanSettings } from "@/lib/individual/scholar/study-plan";

// SCHOLAR-COMPANION-01 -- the study plan card on Progress. A compact form (exam date and name, minutes and days a week, a
// goal, up to ten priority topics) and, once saved, the next seven days of study with the reason for each activity.
// The plan is worked out on the server by fixed rules (src/lib/individual/scholar/study-plan.ts), with no AI.
//
// ⚠ A STUDY PLAN, NOT AN ASSESSMENT. The label says so on the card. Nothing here reaches the Passport.
// ⚠ One column below md, 44px targets (48px on a coarse pointer), a label on every field, errors announced with role=alert,
// and a word beside every colour.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const field = `block w-full min-h-[44px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-[14px] text-gray-900 pointer-coarse:min-h-[48px] ${focusRing}`;
const label = "block text-[13px] font-semibold text-gray-800";
const hint = "mt-0.5 text-[12.5px] text-gray-600";
const secondary = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`;

const SPACE: Record<PlanSpace, { word: string; chip: string }> = {
  learn: { word: "Learn", chip: "border-blue-300 bg-blue-50 text-blue-900" },
  revise: { word: "Revise", chip: "border-green-300 bg-green-50 text-green-900" },
  apply: { word: "Apply", chip: "border-amber-300 bg-amber-50 text-amber-900" },
  evaluate: { word: "Evaluate", chip: "border-gray-300 bg-gray-50 text-gray-800" },
};
const PHASE_WORD: Record<StudyPlanResult["phase"], string> = { build: "Building", consolidate: "Consolidating", final_week: "Final week", no_date: "Rolling plan" };
const dayLabel = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

export type StudyPlanTopic = { label: string };

function PlanForm({ initial, topics, accent, today, onDone }: {
  initial: StudyPlanSettings | null; topics: readonly StudyPlanTopic[]; accent: string; today: string; onDone: () => void;
}) {
  const router = useRouter();
  const uid = useId();
  const [examLabel, setExamLabel] = useState(initial?.examLabel ?? "");
  const [examDate, setExamDate] = useState(initial?.examDate ?? "");
  const [weeklyMinutes, setWeeklyMinutes] = useState(String(initial?.weeklyMinutes ?? 240));
  const [daysPerWeek, setDaysPerWeek] = useState(String(initial?.daysPerWeek ?? 4));
  const [goal, setGoal] = useState(initial?.goal ?? "");
  const [priorities, setPriorities] = useState<string[]>([...(initial?.priorities ?? [])]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const L = STUDY_PLAN_LIMITS;

  // The learner's topics, plus any saved priority that is no longer one of them (so it can still be seen and removed).
  const options = [...topics.map(t => t.label), ...priorities.filter(p => !topics.some(t => t.label.toLowerCase() === p.toLowerCase()))];
  const isChecked = (t: string) => priorities.some(p => p.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => setPriorities(cur => cur.some(p => p.toLowerCase() === t.toLowerCase()) ? cur.filter(p => p.toLowerCase() !== t.toLowerCase()) : cur.length >= L.priorities ? cur : [...cur, t]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/scholar/study-plan", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ examDate, examLabel, weeklyMinutes, daysPerWeek, goal, priorities }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Your study plan could not be saved just now."); return; }
      onDone(); router.refresh();
    } catch {
      setError("Competen could not be reached. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function clear() {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/individual/scholar/study-plan", { method: "DELETE" });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(json.error ?? "Your study plan could not be cleared just now."); return; }
      onDone(); router.refresh();
    } catch {
      setError("Competen could not be reached. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={save} className="mt-3 space-y-4" aria-describedby={error ? `${uid}-err` : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor={`${uid}-label`} className={label}>Exam name <span className="font-normal text-gray-600">(optional)</span></label>
          <input id={`${uid}-label`} className={field} value={examLabel} maxLength={L.labelMax} onChange={e => setExamLabel(e.target.value)} autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${uid}-date`} className={label}>Exam date <span className="font-normal text-gray-600">(optional)</span></label>
          <input id={`${uid}-date`} type="date" className={field} value={examDate} min={today} onChange={e => setExamDate(e.target.value)} aria-describedby={`${uid}-date-h`} />
          <p id={`${uid}-date-h`} className={hint}>Without a date you get a rolling weekly plan.</p>
        </div>
        <div>
          <label htmlFor={`${uid}-min`} className={label}>Minutes you can study each week</label>
          <input id={`${uid}-min`} type="number" inputMode="numeric" className={field} value={weeklyMinutes} min={L.minMinutes} max={L.maxMinutes} step={5} required onChange={e => setWeeklyMinutes(e.target.value)} aria-describedby={`${uid}-min-h`} />
          <p id={`${uid}-min-h`} className={hint}>{L.minMinutes} to {L.maxMinutes}.</p>
        </div>
        <div>
          <label htmlFor={`${uid}-days`} className={label}>Days a week you will study</label>
          <select id={`${uid}-days`} className={field} value={daysPerWeek} required onChange={e => setDaysPerWeek(e.target.value)}>
            {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} {n === 1 ? "day" : "days"}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor={`${uid}-goal`} className={label}>Your goal <span className="font-normal text-gray-600">(optional)</span></label>
        <textarea id={`${uid}-goal`} className={`${field} min-h-[88px]`} value={goal} maxLength={L.goalMax} rows={2} onChange={e => setGoal(e.target.value)} aria-describedby={`${uid}-goal-h`} />
        <p id={`${uid}-goal-h`} className={hint}>In your own words. Do not include anything that identifies a patient.</p>
      </div>
      <fieldset>
        <legend className={label}>Topics to put first <span className="font-normal text-gray-600">(up to {L.priorities}, optional)</span></legend>
        {options.length === 0 ? (
          <p className={hint}>Topics appear once Scholar has looked at your notes. You can add them to your plan later.</p>
        ) : (
          <>
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {options.slice(0, 60).map((t, i) => {
                const on = isChecked(t);
                const full = !on && priorities.length >= L.priorities;
                return (
                  <li key={t}>
                    <label className={`flex min-h-[44px] items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-[13.5px] text-gray-900 pointer-coarse:min-h-[48px] ${full ? "opacity-50" : "hover:bg-gray-50"}`}>
                      <input id={`${uid}-p${i}`} type="checkbox" className="h-5 w-5 shrink-0" checked={on} disabled={full} onChange={() => toggle(t)} />
                      <span className="min-w-0 break-words">{t}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <p className={hint} aria-live="polite">{priorities.length} of {L.priorities} chosen.</p>
          </>
        )}
      </fieldset>
      {error && <p id={`${uid}-err`} role="alert" className="text-[13.5px] font-semibold text-red-800">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={`inline-flex min-h-[44px] items-center justify-center rounded-xl px-5 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[48px] ${focusRing}`} style={{ background: accent }}>
          {busy ? "Saving…" : initial ? "Save changes" : "Make my plan"}
        </button>
        {initial && <button type="button" className={secondary} disabled={busy} onClick={onDone}>Cancel</button>}
        {initial && <button type="button" className={secondary} disabled={busy} onClick={clear}>Clear my plan</button>}
      </div>
    </form>
  );
}

export function StudyPlanCard({ settings, result, topics, accent, today }: {
  /** The saved settings, or null: no plan yet. */
  settings: StudyPlanSettings | null;
  /** The plan worked out from them, or null with no settings. */
  result: StudyPlanResult | null;
  topics: readonly StudyPlanTopic[];
  accent: string;
  today: string;
}) {
  const [editing, setEditing] = useState(false);
  const showForm = editing || !settings || !result;
  return (
    <section aria-labelledby="study-plan-h" className="mb-6 rounded-2xl border border-gray-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="study-plan-h" className="text-[15px] font-bold text-gray-900">Study plan</h2>
        <span className="rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">A study plan — not an assessment of competence</span>
      </div>

      {showForm ? (
        <>
          <p className="mt-1 text-[13px] text-gray-700">
            {settings ? "Change what the plan is built from." : "Tell Scholar when your exam is and how much time you have, and it plans your next seven days from your own practice. No AI is used, and you can change it any time."}
          </p>
          <PlanForm initial={settings} topics={topics} accent={accent} today={today} onDone={() => setEditing(false)} />
        </>
      ) : (
        <>
          <p className="mt-1 text-[13.5px] text-gray-800">{result.summary}</p>
          <p className="mt-1"><span className="inline-flex rounded-full border border-gray-300 bg-gray-50 px-2.5 py-0.5 text-[12px] font-semibold text-gray-800">{PHASE_WORD[result.phase]}</span></p>
          {result.notes.length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[12.5px] text-gray-700">{result.notes.map(n => <li key={n}>{n}</li>)}</ul>
          )}
          {result.thisWeek.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-gray-300 p-3 text-[13.5px] text-gray-700">There are no study days to plan before the exam.</p>
          ) : (
            <ol className="mt-3 space-y-3">
              {result.thisWeek.map(d => (
                <li key={d.day} className="rounded-xl border border-gray-200 p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[14px] font-bold text-gray-900">{dayLabel(d.day)}{d.day === today ? " (today)" : ""}</h3>
                    <span className="text-[12.5px] tabular-nums text-gray-600">{d.minutes} minutes</span>
                  </div>
                  <ul className="mt-2 divide-y divide-gray-100">
                    {d.activities.map((a, i) => (
                      <li key={i} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 md:flex-row md:items-center md:justify-between md:gap-4">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-gray-900">
                            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11.5px] font-semibold ${SPACE[a.space].chip}`}>{SPACE[a.space].word}</span>
                            <span className="min-w-0 break-words">{a.title}</span>
                            <span className="text-[12.5px] font-normal tabular-nums text-gray-600">{a.minutes} min</span>
                          </p>
                          <p className="mt-0.5 text-[13px] text-gray-700">{a.reason}</p>
                        </div>
                        <Link href={a.href} className={`inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-xl px-4 py-2 text-[13.5px] font-semibold text-white hover:opacity-90 pointer-coarse:min-h-[48px] ${focusRing}`} style={{ background: accent }}>
                          Open<span className="sr-only">: {a.title}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3">
            <button type="button" className={secondary} onClick={() => setEditing(true)}>Change my plan</button>
          </div>
        </>
      )}
    </section>
  );
}
