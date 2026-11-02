"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import type { ScholarPlanSettings } from "@/lib/individual/learning-plan/types";
import { GOAL_CHOICES, SESSION_CHOICES, buildSettingsBody, setupFormFrom, type SetupForm } from "@/lib/individual/scholar/plan-view";
import { cardCls, fieldCls, hintCls, labelCls, primaryBtn, secondaryBtn, summaryCls, focusRing } from "./plan-style";
import { ErrorLine, callJson, errorOf } from "./plan-ui";

// MY PLAN SETUP (PLP-01..04). Three questions: what are you aiming for, how long is one session, how many days a week. The exam date is asked
// only for an exam. Advanced (priority topics, exam name, your own goal words) is folded away. The same form changes an existing plan.
// A raise beyond the weekly maximum is never silent: the server answers 409 and the learner confirms in words.
// Nothing here is AI. Learning never waits for a plan: "Start learning without a plan" is always a link.

type Props = {
  accent: string; today: string;
  /** The saved settings, or null: the first plan. */
  initial: ScholarPlanSettings | null;
  /** Migration 840 present: the goal question and minutes per session are stored. Without it the plan is saved in the older shape. */
  extras: boolean;
  /** Called after a save or cancel (adjusting an existing plan). */
  onDone?: () => void;
  /** Runs after a successful save, before the page is refreshed (the Ready page records its acceptance here). */
  afterSave?: () => Promise<unknown> | void;
  /** The first plan: shows the learner a way to go on without one. */
  startHref?: string;
  /** `initial` is the implicit starting plan, not a saved one: the form personalises it, and Save is what stores a plan. */
  starting?: boolean;
  /** Inside a dialog that already frames it: no border or padding of its own. */
  bare?: boolean;
};

export function PlanSetup({ accent, today, initial, extras, onDone, afterSave, startHref, starting = false, bare = false }: Props) {
  const router = useRouter();
  const uid = useId();
  const [form, setForm] = useState<SetupForm>(() => setupFormFrom(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState<{ message: string } | null>(null);
  const set = <K extends keyof SetupForm>(k: K, v: SetupForm[K]) => setForm(f => ({ ...f, [k]: v }));
  const sessionOptions: number[] = [...SESSION_CHOICES];
  const current = Number(form.sessionMinutes);
  if (Number.isInteger(current) && current > 0 && !sessionOptions.includes(current)) sessionOptions.push(current);
  sessionOptions.sort((a, b) => a - b);
  const exam = extras ? form.goalType === "exam" : false;

  async function save(confirmIncrease = false) {
    const built = buildSettingsBody(form, { extras, today, confirmIncrease });
    if (!built.ok) { setError(built.error); return; }
    setBusy(true); setError("");
    const r = await callJson("/api/individual/scholar/plan/settings", "POST", built.body);
    setBusy(false);
    if (r.status === 409 && r.json.needsConfirmation) { setConfirm({ message: String(r.json.error ?? "This raises your study time. Confirm to go on.") }); return; }
    if (!r.ok) { setConfirm(null); setError(errorOf(r, "Your plan could not be saved just now. Try again shortly.")); return; }
    setConfirm(null);
    await afterSave?.();
    onDone?.();
    router.refresh();
  }

  return (
    <section aria-labelledby={`${uid}-h`} className={bare ? "" : cardCls} data-testid="plan-setup">
      <h2 id={`${uid}-h`} className="text-[17px] font-bold text-gray-900">{starting ? "Personalise your plan" : initial ? "Adjust your plan" : "Set up My Plan"}</h2>
      <p className="mt-0.5 text-[13.5px] text-gray-700">
        {starting ? "Three quick answers replace the starting plan. Nothing is saved until you save." : initial ? "Change what the plan is built from. Nothing changes until you save." : "Three quick answers. Scholar plans your study from your own practice, by fixed rules, with no AI. You can change it any time."}
      </p>
      <form className="mt-4 space-y-5" onSubmit={e => { e.preventDefault(); void save(false); }} aria-describedby={error ? `${uid}-err` : undefined}>
        {extras && (
          <fieldset>
            <legend className={labelCls}>1. What are you aiming for?</legend>
            <ul className="mt-2 grid gap-2 sm:grid-cols-3">
              {GOAL_CHOICES.map(g => {
                const on = form.goalType === g.value;
                return (
                  <li key={g.value}>
                    <label className={`flex h-full min-h-[44px] cursor-pointer items-start gap-2 rounded-xl border p-3 pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "border-gray-900 bg-gray-50 ring-2 ring-gray-900" : "border-gray-300 bg-white hover:bg-gray-50"}`}>
                      <input type="radio" name={`${uid}-goal`} className="mt-0.5 h-5 w-5 shrink-0" checked={on} onChange={() => set("goalType", g.value)} />
                      <span className="min-w-0"><span className="block text-[14px] font-semibold text-gray-900">{g.label}</span><span className="block text-[12.5px] text-gray-600">{g.hint}</span></span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-min`} className={labelCls}>{extras ? "2. " : ""}Minutes in one session</label>
            <select id={`${uid}-min`} className={fieldCls} value={form.sessionMinutes} onChange={e => set("sessionMinutes", e.target.value)}>
              {sessionOptions.map(n => <option key={n} value={n}>{n} minutes</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={`${uid}-days`} className={labelCls}>{extras ? "3. " : ""}Days a week you will study</label>
            <select id={`${uid}-days`} className={fieldCls} value={form.daysPerWeek} onChange={e => set("daysPerWeek", e.target.value)}>
              {[1, 2, 3, 4, 5, 6, 7].map(n => <option key={n} value={n}>{n} {n === 1 ? "day" : "days"}</option>)}
            </select>
          </div>
        </div>
        {(exam || !extras) && (
          <div className="max-w-sm">
            <label htmlFor={`${uid}-date`} className={labelCls}>Exam date{extras ? "" : " (optional)"}</label>
            <input id={`${uid}-date`} type="date" className={fieldCls} value={form.examDate} min={today} required={exam} onChange={e => set("examDate", e.target.value)} aria-describedby={`${uid}-date-h`} />
            <p id={`${uid}-date-h`} className={hintCls}>Your plan works back from this day. Without a date you get a rolling weekly plan.</p>
          </div>
        )}
        <details>
          <summary className={summaryCls}>Advanced (optional)</summary>
          <div className="mt-2 space-y-4">
            {(exam || !extras) && (
              <div>
                <label htmlFor={`${uid}-label`} className={labelCls}>Exam name</label>
                <input id={`${uid}-label`} className={fieldCls} value={form.examLabel} maxLength={120} autoComplete="off" onChange={e => set("examLabel", e.target.value)} />
              </div>
            )}
            <div>
              <label htmlFor={`${uid}-prio`} className={labelCls}>Topics to put first</label>
              <textarea id={`${uid}-prio`} className={`${fieldCls} min-h-[88px]`} rows={3} value={form.priorities} onChange={e => set("priorities", e.target.value)} aria-describedby={`${uid}-prio-h`} />
              <p id={`${uid}-prio-h`} className={hintCls}>Up to 10, one per line.</p>
            </div>
            <div>
              <label htmlFor={`${uid}-goal-text`} className={labelCls}>Your goal, in your own words</label>
              <textarea id={`${uid}-goal-text`} className={`${fieldCls} min-h-[72px]`} rows={2} maxLength={300} value={form.goal} onChange={e => set("goal", e.target.value)} aria-describedby={`${uid}-goal-h`} />
              <p id={`${uid}-goal-h`} className={hintCls}>Do not include anything that identifies a patient.</p>
            </div>
          </div>
        </details>

        {confirm && (
          <div role="alertdialog" aria-labelledby={`${uid}-conf`} className="rounded-xl border border-amber-300 bg-amber-50 p-3">
            <p id={`${uid}-conf`} className="text-[13.5px] font-semibold text-amber-950">{confirm.message}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy} onClick={() => void save(true)}>Yes, raise my study time</button>
              <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setConfirm(null)}>Keep it lower</button>
            </div>
          </div>
        )}
        <div id={`${uid}-err`}><ErrorLine text={error} /></div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : starting ? "Save my plan" : initial ? "Save changes" : "Make my plan"}</button>
          {onDone && <button type="button" className={secondaryBtn} disabled={busy} onClick={onDone}>Cancel</button>}
          {!initial && startHref && <Link href={startHref} className={`inline-flex min-h-[44px] items-center text-[14px] font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Start learning without a plan</Link>}
        </div>
      </form>
    </section>
  );
}
