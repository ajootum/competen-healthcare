"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { learnAction } from "@/components/ui/scholar-learning";
import { experienceHref } from "@/lib/individual/experiences";
import { askPrefill, goalTitleOf } from "@/lib/individual/scholar/personal-notebook";
import { QUESTION_MAX } from "@/lib/individual/scholar/config";
import { AskAbout } from "./ask-panel";
import { useMyPlanOn } from "./plan-nav";

// SCHOLAR-NOTEBOOK-UX-002 items 12 and 13: the optional things a learner may do with a thought. Every one is their own click, and nothing
// happens by itself:
//   Develop this idea, Research this question   the existing Ask panel with the note's words in its box, to edit. Nothing goes to AI until they press its Ask button.
//   Make it a study goal                        a short form with the words to edit and a date. Only "Add to My Plan" adds an entry, through the existing calendar route.
// The note itself is not changed by any of them.

const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };

export function NoteActions({ title, body, chunkIds = [], materialId = null, sessionId = null, step = null }: {
  title: string; body: string; chunkIds?: readonly string[]; materialId?: string | null; sessionId?: string | null; step?: number | null;
}) {
  const planOn = useMyPlanOn();
  const uid = useId();
  const [goal, setGoal] = useState<null | { title: string; date: string; busy: boolean; msg: string | null; added: boolean }>(null);
  if (!body.trim()) return null;
  const ask = { surface: "library" as const, chunkIds: [...chunkIds], materialId, sessionId, step, refLabel: "My Notebook" };
  const add = async () => {
    if (!goal) return;
    setGoal({ ...goal, busy: true, msg: null });
    try {
      const res = await fetch("/api/individual/scholar/plan/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entryType: "study_session", title: goal.title.trim(), entryDate: goal.date }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { setGoal({ ...goal, busy: false, msg: typeof j.error === "string" ? j.error : "That could not be added just now. Your note is unchanged." }); return; }
      setGoal({ ...goal, busy: false, added: true, msg: null });
    } catch { setGoal({ ...goal, busy: false, msg: "That could not be added just now. Your note is unchanged." }); }
  };
  const field = "mt-1 block w-full min-h-[44px] rounded-xl border border-[var(--learn-border)] bg-[var(--cmp-app-surface)] px-3 text-[15px] text-gray-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
  return (
    <div className="mt-3" data-testid="note-actions">
      <div className="flex flex-wrap gap-2">
        <AskAbout {...ask} label="Develop this idea" prefill={askPrefill("develop", body, QUESTION_MAX)} />
        <AskAbout {...ask} label="Research this question" prefill={askPrefill("research", body, QUESTION_MAX)} />
        {planOn && !goal && <button type="button" className={learnAction.secondary} onClick={() => setGoal({ title: goalTitleOf({ title, body }), date: inDays(7), busy: false, msg: null, added: false })}>Make it a study goal</button>}
      </div>
      <p className="mt-1.5 text-[12px] text-gray-700">Your note stays private. Ask opens with your words to edit, and only what you send there goes to AI.</p>
      {goal && (goal.added ? (
        <p role="status" className="mt-2 text-[13.5px] font-semibold text-gray-900" data-testid="note-goal-added">Added to My Plan for {goal.date}. <Link href={experienceHref("scholar", "study/plan")} className={learnAction.link}>Open My Plan</Link></p>
      ) : (
        <div className="mt-2 rounded-xl bg-[var(--cmp-app-surface)] p-3 ring-1 ring-[var(--learn-border)]" data-testid="note-goal-form">
          <p className="text-[13.5px] font-semibold text-gray-900">Add this to My Plan?</p>
          <p className="text-[12.5px] text-gray-700">Nothing is added until you choose Add to My Plan.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_11rem]">
            <label htmlFor={`${uid}-g`} className="text-[12.5px] font-semibold text-gray-800">Study goal
              <input id={`${uid}-g`} value={goal.title} maxLength={120} onChange={e => setGoal({ ...goal, title: e.target.value })} className={field} />
            </label>
            <label htmlFor={`${uid}-d`} className="text-[12.5px] font-semibold text-gray-800">Date
              <input id={`${uid}-d`} type="date" value={goal.date} onChange={e => setGoal({ ...goal, date: e.target.value })} className={field} />
            </label>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={learnAction.primary} disabled={goal.busy || !goal.title.trim() || !goal.date} onClick={() => void add()}>{goal.busy ? "Adding…" : "Add to My Plan"}</button>
            <button type="button" className={learnAction.secondary} disabled={goal.busy} onClick={() => setGoal(null)}>Cancel</button>
          </div>
          {goal.msg && <p role="status" className="mt-2 text-[13px] text-gray-900">{goal.msg}</p>}
        </div>
      ))}
    </div>
  );
}
