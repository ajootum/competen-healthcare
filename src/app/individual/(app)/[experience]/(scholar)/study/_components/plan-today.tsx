"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState, useSyncExternalStore } from "react";
import { experienceHref } from "@/lib/individual/experiences";
import type { ScholarPlanSettings } from "@/lib/individual/learning-plan/types";
import type { PlanRecommendation } from "@/lib/individual/scholar/plan-recommend";
import type { TodayNote } from "@/lib/individual/scholar/plan-data";
import type { MissedItem } from "@/lib/individual/scholar/plan-carry";
import type { ExamOffer } from "@/lib/individual/scholar/plan-calendar";
import type { ReflectionOffer } from "@/lib/individual/scholar/plan-reflection";
import { addDay, settingsWithSessionMinutes } from "@/lib/individual/scholar/plan-view";
import { dayWord, type ComingUpItem, type DoneItem } from "@/lib/individual/scholar/plan-today-view";
import { groupCompleted } from "@/lib/individual/scholar/plan-workspace";
import { cardCls, fieldCls, hintCls, labelCls, linkBtn, pillOutline, pillPrimary, primaryBtn, quietBtn, secondaryBtn, summaryCls, tagCls } from "./plan-style";
import { CheckIcon, ErrorLine, PersonIcon, PlanDialog, SparkleIcon, callJson, errorOf } from "./plan-ui";
import { DoneGroup } from "./plan-agenda-rows";
import { PlanSetup } from "./plan-setup";

// MY PLAN -> TODAY (PLP-01..04). ONE next activity, with the reason in the learner's own numbers; "why" is visible, "why now" and "if you
// postpone it" fold away. Every control is a real button or link with a text label. Nothing here is AI and nothing is an assessment.
// A choice that cannot be remembered (migration 840 absent) is simply not offered. The server remembers each choice as an append-only event.

const API = "/api/individual/scholar/plan";

// ── the next activity ──
export function TodayNextCard({ accent, today, next, alternatives, canDecide, settings, extras, declinedHidden, about, startHref, resume, starting }: {
  accent: string; today: string;
  next: PlanRecommendation | null; alternatives: PlanRecommendation[];
  /** Migration 840 present: Postpone and Not this can be remembered. */
  canDecide: boolean;
  settings: ScholarPlanSettings; extras: boolean; declinedHidden: number;
  /** What the activity is about (the topic and its material), or null. */
  about: string | null;
  /** Where Start opens (the activity's destination, with the connected study session carried along), or null. */
  startHref: string | null;
  /** The activity is a lesson or revision session already open: Resume, not Start. */
  resume: boolean;
  /** The implicit starting plan stands in: "Adjust plan" is "Personalise". */
  starting: boolean;
}) {
  const router = useRouter();
  const uid = useId();
  const [showAlt, setShowAlt] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");

  async function decide(kind: "postpone" | "decline") {
    if (!next) return;
    setBusy(true); setError(""); setSaid("");
    let r;
    if (kind === "postpone" && next.topics.length) {
      for (const topic of next.topics.slice(0, 3)) {
        r = await callJson(`${API}/decision`, "POST", { kind: "topic_postponed", ref: topic });
        if (!r.ok) break;
      }
    } else {
      r = await callJson(`${API}/decision`, "POST", { kind: "recommendation_declined", ref: next.ref, fingerprint: next.fingerprint });
    }
    setBusy(false);
    if (!r || !r.ok) { setError(r ? errorOf(r) : "That could not be saved just now."); return; }
    setSaid(kind === "postpone" && next.topics.length ? "Put off until tomorrow." : "Got it. This is not offered again unless your evidence changes.");
    router.refresh();
  }

  return (
    <section aria-labelledby={`${uid}-h`} className={cardCls} data-testid="plan-next">
      <div className="flex items-start justify-between gap-3">
        <h2 id={`${uid}-h`} className="text-[16px] font-bold text-gray-900">Your next study session</h2>
        {next && <span className={tagCls}>{resume ? "Started" : "Suggested"}</span>}
      </div>
      {next ? (
        <>
          <p className="mt-3 min-w-0 break-words text-[18px] font-bold leading-snug text-gray-900 sm:text-[20px]">{next.title}</p>
          <p className="mt-1 text-[14.5px] text-gray-700">{next.why}</p>
          {about && <p className="mt-1 text-[13.5px] text-gray-700"><span className="font-semibold">About: </span>{about}</p>}
          <details className="mt-1">
            <summary className={summaryCls}>Why now, and what if you wait</summary>
            <dl className="mt-1 space-y-2 text-[14px] text-gray-800">
              <div><dt className="font-semibold">Why now</dt><dd>{next.whyNow}</dd></div>
              <div><dt className="font-semibold">If you postpone it</dt><dd>{next.ifPostponed}</dd></div>
            </dl>
          </details>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[14px] tabular-nums text-gray-700">{next.minutes !== null ? `${next.minutes} minutes` : ""}</p>
            {startHref && <Link href={startHref} className={primaryBtn} style={{ background: accent }}>{resume ? "Resume" : "Start"}<span className="sr-only">: {next.title}</span></Link>}
          </div>
          <div className="mt-3 border-t border-gray-100 pt-2">
            <button type="button" className={quietBtn} aria-expanded={more} aria-controls={`${uid}-more`} onClick={() => setMore(m => !m)}>{more ? "Fewer options" : "More"}</button>
            <div id={`${uid}-more`} className={`${more ? "mt-2 flex" : "hidden"} flex-wrap gap-2`}>
              {canDecide && <button type="button" className={quietBtn} disabled={busy} onClick={() => void decide("postpone")}>Postpone<span className="sr-only"> to tomorrow</span></button>}
              {alternatives.length > 0 && <button type="button" className={quietBtn} aria-expanded={showAlt} aria-controls={`${uid}-alt`} onClick={() => setShowAlt(s => !s)}>Something else</button>}
              {canDecide && <button type="button" className={quietBtn} disabled={busy} onClick={() => void decide("decline")}>Not this</button>}
              <button type="button" className={quietBtn} aria-expanded={adjusting} onClick={() => setAdjusting(a => !a)}>{starting ? "Personalise plan" : "Adjust plan"}</button>
            </div>
          </div>
          <div className="mt-2 min-h-[1.25rem]" aria-live="polite">{said && <p className="text-[13.5px] font-semibold text-gray-800">{said}</p>}<ErrorLine text={error} /></div>
          {showAlt && (
            <ul id={`${uid}-alt`} className="mt-2 space-y-2">
              {alternatives.map(a => (
                <li key={a.ref} className="rounded-xl border border-gray-200 p-3">
                  <p className="flex flex-wrap items-baseline gap-x-3 text-[15px] font-semibold text-gray-900"><span className="min-w-0 break-words">{a.title}</span>{a.minutes !== null && <span className="text-[13px] font-normal tabular-nums text-gray-700">{a.minutes} min</span>}</p>
                  <p className="mt-0.5 text-[13.5px] text-gray-700">{a.why}</p>
                  {a.href && <Link href={a.href} className={`${secondaryBtn} mt-2`}>Start this instead<span className="sr-only">: {a.title}</span></Link>}
                </li>
              ))}
            </ul>
          )}
          {declinedHidden > 0 && <p className={`${hintCls} mt-2`}>{declinedHidden} suggestion{declinedHidden === 1 ? "" : "s"} you said no to {declinedHidden === 1 ? "is" : "are"} hidden until the evidence changes.</p>}
        </>
      ) : (
        <>
          <p className="mt-3 text-[16px] font-semibold text-gray-900">Nothing is suggested right now.</p>
          <p className="mt-1 text-[14px] text-gray-700">Nothing is waiting on you today. You can still learn from your library whenever you like.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href={experienceHref("scholar", "study/learn")} className={primaryBtn} style={{ background: accent }}>Go to Learn</Link>
            <button type="button" className={quietBtn} aria-expanded={adjusting} onClick={() => setAdjusting(a => !a)}>{starting ? "Personalise plan" : "Adjust plan"}</button>
          </div>
        </>
      )}
      {adjusting && (
        <PlanDialog title={starting ? "Personalise your plan" : "Adjust your plan"} onClose={() => setAdjusting(false)} wide>
          <PlanSetup accent={accent} today={today} initial={settings} starting={starting} extras={extras} bare onDone={() => setAdjusting(false)} />
        </PlanDialog>
      )}
    </section>
  );
}

// ── the starting plan, said once, with a way to personalise it ──
export function StartingPlanNote({ accent, today, settings, extras }: { accent: string; today: string; settings: ScholarPlanSettings; extras: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 bg-gray-50 px-4 py-2" data-testid="plan-starting">
      <p className="text-[13.5px] text-gray-800"><span className="font-semibold">Starting plan</span> · {settings.sessionMinutes ?? 30} minutes a session, {settings.daysPerWeek} days a week. Nothing is saved until you set your own.</p>
      <button type="button" className={`${linkBtn} text-[13.5px]`} style={{ color: accent }} onClick={() => setOpen(true)}>Personalise it</button>
      {open && (
        <PlanDialog title="Personalise your plan" onClose={() => setOpen(false)} wide>
          <PlanSetup accent={accent} today={today} initial={settings} starting extras={extras} bare onDone={() => setOpen(false)} />
        </PlanDialog>
      )}
    </div>
  );
}

// ── what comes up next: the plan and the learner's own calendar, one list ──
export function ComingUp({ accent, today, items, calendarHref }: { accent: string; today: string; items: ComingUpItem[]; calendarHref: string }) {
  return (
    <section aria-labelledby="plan-up-h" className={cardCls} data-testid="plan-coming-up">
      <h2 id="plan-up-h" className="text-[16px] font-bold text-gray-900">Coming up</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-[14px] text-gray-700">Nothing else is planned yet. Add an activity in your calendar, or come back tomorrow.</p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100">
          {items.map(i => (
            <li key={i.key} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${i.source === "personal" ? "bg-blue-50 text-blue-900" : "bg-gray-100 text-gray-800"}`}>{i.source === "personal" ? <PersonIcon size={16} /> : <SparkleIcon size={16} />}</span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14.5px] font-semibold text-gray-900">{i.title}</p>
                <p className="text-[13px] text-gray-700">{i.label} · {dayWord(i.date, today)}{i.when ? ` · ${i.when}` : ""}</p>
              </div>
              {i.href
                ? <Link href={i.href} className={quietBtn}>{i.label === "Cards due" ? "Review" : "Start"}<span className="sr-only">: {i.title}</span></Link>
                : <Link href={calendarHref} className={quietBtn}>View<span className="sr-only">: {i.title} in your calendar</span></Link>}
            </li>
          ))}
        </ul>
      )}
      <Link href={calendarHref} className={`${linkBtn} mt-1 text-[13.5px]`} style={{ color: accent }}>Open the calendar</Link>
    </section>
  );
}

// ── what was done today, so Today visibly updates after the learner studies (records of one material fold into one row) ──
export function DoneToday({ items, studyId = null }: { items: DoneItem[]; studyId?: string | null }) {
  const rows = groupCompleted(items);
  return (
    <section aria-labelledby="plan-done-h" className={cardCls} data-testid="plan-done-today">
      <h2 id="plan-done-h" className="text-[16px] font-bold text-gray-900">Completed today</h2>
      {items.length === 0 ? (
        <p className="mt-1 text-[14px] text-gray-700">Nothing recorded yet today. What you study appears here.</p>
      ) : (
        <ul className="mt-1">
          {rows.map(r => r.type === "group" ? <DoneGroup key={r.key} row={r} studyId={studyId} /> : (
            <li key={r.item.key} className="flex items-start gap-3 border-b border-gray-100 py-2.5 last:border-b-0">
              <span className="mt-0.5 text-green-800"><CheckIcon size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="break-words text-[14px] font-semibold text-gray-900">{r.item.href ? <Link href={r.item.href} className="underline underline-offset-2">{r.item.title}</Link> : r.item.title}</p>
                {r.item.detail && <p className="text-[12.5px] text-gray-600">{r.item.detail}{r.item.basis === "self_reported" ? " (your word, not a record)" : ""}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── cards due, and the monthly review that is coming ──
export function DueAndReview({ accent, dueCards, flashcardsHref, review, hideCards = false }: {
  accent: string; dueCards: number; flashcardsHref: string;
  /** Today's schedule already lists the cards due (one row): not said twice. */
  hideCards?: boolean;
  review: { month: string; recommendedDate: string; late: boolean; startHref: string } | null;
}) {
  const showCards = dueCards > 0 && !hideCards;
  if (!showCards && !review) return null;
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  return (
    <section aria-label="Revision and review" className="grid gap-3 sm:grid-cols-2">
      {showCards && (
        <div className={cardCls}>
          <h2 className="text-[15px] font-bold text-gray-900">Revision due</h2>
          <p className="mt-0.5 text-[14px] text-gray-700"><span className="font-semibold tabular-nums">{dueCards}</span> card{dueCards === 1 ? "" : "s"} reached {dueCards === 1 ? "its" : "their"} review date.</p>
          <Link href={flashcardsHref} className={`${secondaryBtn} mt-3`}>Review cards<span className="sr-only"> ({dueCards} due)</span></Link>
        </div>
      )}
      {review && (
        <div className={cardCls}>
          <h2 className="text-[15px] font-bold text-gray-900">Monthly review coming up</h2>
          <p className="mt-0.5 text-[14px] text-gray-700">{review.late ? "Recommended earlier, and still open." : `Recommended around ${day(review.recommendedDate)}.`} Optional: nothing waits on it.</p>
          <Link href={review.startHref} className={`${secondaryBtn} mt-3`} style={{ color: accent }}>Open the review</Link>
        </div>
      )}
    </section>
  );
}

// ── what moved by itself, with an undo ──
export function NotesList({ notes }: { notes: TodayNote[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!notes.length) return null;
  async function undo(ref: string) {
    setBusy(ref); setError("");
    const r = await callJson(`${API}/decision`, "POST", { kind: "auto_adjust", ref, status: "undone" });
    setBusy("");
    if (!r.ok) { setError(errorOf(r)); return; }
    router.refresh();
  }
  return (
    <section aria-labelledby="plan-notes-h" className={cardCls}>
      <h2 id="plan-notes-h" className="text-[15px] font-bold text-gray-900">About your plan</h2>
      <ul className="mt-2 divide-y divide-gray-100">
        {notes.map((n, i) => (
          <li key={`${i}-${n.text.slice(0, 24)}`} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="min-w-0 text-[14px] text-gray-800">{n.text}</p>
            {n.undo && <button type="button" className={`${secondaryBtn} shrink-0`} disabled={busy === n.undo.ref} onClick={() => void undo(n.undo!.ref)}>Undo<span className="sr-only">: {n.text}</span></button>}
          </li>
        ))}
      </ul>
      <div className="mt-1"><ErrorLine text={error} /></div>
    </section>
  );
}

// ── missed, not rescheduled: a calendar move on the learner's say ──
export function MissedList({ accent, today, missed }: { accent: string; today: string; missed: MissedItem[] }) {
  const router = useRouter();
  const uid = useId();
  const [open, setOpen] = useState("");
  const [to, setTo] = useState(addDay(today, 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!missed.length) return null;
  const horizon = addDay(today, 60);
  async function move(m: MissedItem) {
    setBusy(true); setError("");
    const r = await callJson("/api/individual/scholar/study-calendar", "POST", { action: "reschedule", kind: "plan_activity", ref: `${m.ref}|0`, originalDate: m.from, scheduledDate: to });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r, "That could not be moved just now.")); return; }
    setOpen(""); router.refresh();
  }
  return (
    <section aria-labelledby={`${uid}-h`} className={cardCls}>
      <h2 id={`${uid}-h`} className="text-[15px] font-bold text-gray-900">Missed</h2>
      <p className="text-[13px] text-gray-600">Not counted against you. Put it on a day that suits you, or leave it.</p>
      <ul className="mt-2 divide-y divide-gray-100">
        {missed.map(m => (
          <li key={m.key} className="py-2.5 first:pt-0 last:pb-0">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <p className="min-w-0 break-words text-[14px] text-gray-800"><span className="font-semibold">{m.title}</span> · {m.reason}</p>
              <button type="button" className={`${secondaryBtn} shrink-0`} aria-expanded={open === m.key} onClick={() => setOpen(o => (o === m.key ? "" : m.key))}>Reschedule<span className="sr-only">: {m.title}</span></button>
            </div>
            {open === m.key && (
              <form className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 bg-gray-50 p-3" onSubmit={e => { e.preventDefault(); void move(m); }}>
                <div>
                  <label htmlFor={`${uid}-d`} className={labelCls}>Move to</label>
                  <input id={`${uid}-d`} type="date" className={`${fieldCls} w-auto`} value={to} min={today} max={horizon} required onChange={e => setTo(e.target.value)} />
                </div>
                <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : "Save the new day"}</button>
                <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setOpen("")}>Cancel</button>
              </form>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-1"><ErrorLine text={error} /></div>
    </section>
  );
}

// ── an exam in the learner's own calendar, offered as the plan's exam date ──
export function ExamOffers({ accent, offers }: { accent: string; offers: ExamOffer[] }) {
  const router = useRouter();
  const [asking, setAsking] = useState<ExamOffer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = offers.filter(o => !o.applied);
  if (!list.length) return null;
  async function apply(o: ExamOffer) {
    setBusy(true); setError("");
    const r = await callJson(`${API}/settings`, "POST", { applyExamOffer: o.key, confirm: true });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r)); return; }
    setAsking(null); router.refresh();
  }
  const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return (
    <section aria-labelledby="plan-exam-h" className={cardCls}>
      <h2 id="plan-exam-h" className="text-[15px] font-bold text-gray-900">An exam in your calendar</h2>
      <ul className="mt-2 divide-y divide-gray-100">
        {list.map(o => (
          <li key={o.key} className="flex flex-col gap-2 py-2.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="min-w-0 break-words text-[14px] text-gray-800"><span className="font-semibold">{o.title}</span> · {day(o.date)}</p>
            <button type="button" className={`${secondaryBtn} shrink-0`} onClick={() => { setError(""); setAsking(o); }}>Use as my exam date<span className="sr-only">: {o.title}</span></button>
          </li>
        ))}
      </ul>
      {asking && (
        <PlanDialog title="Use this as your exam date?" onClose={() => setAsking(null)}>
          <p className="text-[14px] text-gray-800"><span className="font-semibold">{asking.title}</span> on {day(asking.date)}.</p>
          <p className="mt-2 text-[14px] text-gray-800">{asking.effect}</p>
          <p className="mt-2 text-[13px] text-gray-600">Your plan only changes if you confirm.</p>
          <div className="mt-3"><ErrorLine text={error} /></div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy} onClick={() => void apply(asking)}>{busy ? "Saving…" : "Yes, use it"}</button>
            <button type="button" className={secondaryBtn} disabled={busy} onClick={() => setAsking(null)}>Not now</button>
          </div>
        </PlanDialog>
      )}
    </section>
  );
}

// ── the weekly reflection: private, a question and an offer, never an automatic change ──
const WORKLOAD = [
  { value: "manageable", label: "Manageable" },
  { value: "too_demanding", label: "Too demanding" },
  { value: "too_light", label: "Too light" },
] as const;

function readKept(key: string): boolean { try { return window.localStorage.getItem(key) === "kept"; } catch { return false; } }
function subscribeKept(cb: () => void) { window.addEventListener("storage", cb); return () => window.removeEventListener("storage", cb); }

export function ReflectionCard({ accent, week, answered, offer, settings }: {
  accent: string; week: string; answered: boolean; offer: ReflectionOffer | null; settings: ScholarPlanSettings | null;
}) {
  const router = useRouter();
  const uid = useId();
  const [workload, setWorkload] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState<{ offer: ReflectionOffer | null } | null>(null);
  const [keptNow, setKept] = useState(false);
  const [applied, setApplied] = useState(false);
  const [confirmMsg, setConfirmMsg] = useState("");
  const key = `myplan.offer.${week}`;
  // "Keep my plan" is remembered on this device for the week (a convenience: a private window simply shows the offer again).
  const persistedKept = useSyncExternalStore(subscribeKept, () => readKept(key), () => false);
  const kept = keptNow || persistedKept;

  const shownOffer = sent ? sent.offer : answered ? offer : null;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!workload) { setError("Choose how this week felt."); return; }
    setBusy(true); setError("");
    const r = await callJson(`${API}/reflection`, "POST", { week, workload, ...(note.trim() ? { note: note.trim() } : {}) });
    setBusy(false);
    if (!r.ok) { setError(errorOf(r, "Your reflection could not be saved just now.")); return; }
    setSent({ offer: (r.json.offer as ReflectionOffer | null) ?? null });
  }
  async function applyOffer(o: ReflectionOffer, confirmIncrease = false) {
    if (!settings) return;
    setBusy(true); setError("");
    const r = await callJson(`${API}/settings`, "POST", { ...settingsWithSessionMinutes(settings, o.proposedSessionMinutes), ...(confirmIncrease ? { confirmIncrease: true } : {}) });
    setBusy(false);
    if (r.status === 409 && r.json.needsConfirmation) { setConfirmMsg(String(r.json.error ?? "This raises your study time.")); return; }
    if (!r.ok) { setError(errorOf(r)); return; }
    setConfirmMsg(""); setApplied(true); router.refresh();
  }
  function keep() { setKept(true); try { window.localStorage.setItem(key, "kept"); } catch { /* not kept across visits */ } }

  const showForm = !answered && !sent;
  const showOffer = !!shownOffer && !kept && !applied;
  if (!showForm && !showOffer && !applied && !sent) return null;
  return (
    <section aria-labelledby={`${uid}-h`} className={cardCls} data-testid="plan-reflection">
      <h2 id={`${uid}-h`} className="text-[15px] font-bold text-gray-900">How did this week feel?</h2>
      <p className="text-[13px] text-gray-600">Private to you. It never changes your plan by itself.</p>
      {showForm && (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <fieldset>
            <legend className="sr-only">This week&apos;s workload</legend>
            <ul className="grid gap-2 sm:grid-cols-3">
              {WORKLOAD.map(w => (
                <li key={w.value}>
                  <label className={`flex min-h-[44px] cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-[14px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${workload === w.value ? "border-gray-900 bg-gray-50 ring-2 ring-gray-900" : "border-gray-300 bg-white hover:bg-gray-50"}`}>
                    <input type="radio" name={`${uid}-w`} className="h-5 w-5" checked={workload === w.value} onChange={() => setWorkload(w.value)} />{w.label}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div>
            <label htmlFor={`${uid}-n`} className={labelCls}>A note, if you like <span className="font-normal text-gray-600">(optional)</span></label>
            <textarea id={`${uid}-n`} className={`${fieldCls} min-h-[72px]`} rows={2} maxLength={500} value={note} onChange={e => setNote(e.target.value)} aria-describedby={`${uid}-nh`} />
            <p id={`${uid}-nh`} className={hintCls}>Up to 500 characters. Do not include anything that identifies a patient.</p>
          </div>
          <ErrorLine text={error} />
          <button type="submit" className={primaryBtn} style={{ background: accent }} disabled={busy}>{busy ? "Saving…" : "Save my answer"}</button>
        </form>
      )}
      {sent && !shownOffer && <p className="mt-2 text-[14px] text-gray-800" aria-live="polite">Thank you. Your plan stays as it is.</p>}
      {applied && <p className="mt-2 text-[14px] font-semibold text-gray-800" aria-live="polite">Your plan now uses that session length.</p>}
      {showOffer && shownOffer && (
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3" aria-live="polite">
          <p className="text-[14px] font-semibold text-gray-900">A suggestion, only if you want it</p>
          <p className="mt-0.5 text-[14px] text-gray-800">{shownOffer.message}</p>
          {confirmMsg && <p className="mt-2 text-[13.5px] font-semibold text-amber-950" role="alert">{confirmMsg}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {settings && <button type="button" className={primaryBtn} style={{ background: accent }} disabled={busy} onClick={() => void applyOffer(shownOffer, !!confirmMsg)}>{confirmMsg ? "Yes, use this" : "Use this"}</button>}
            <button type="button" className={secondaryBtn} disabled={busy} onClick={keep}>Keep my plan</button>
          </div>
          <ErrorLine text={error} />
        </div>
      )}
    </section>
  );
}

// ── today's schedule: the same rows as the calendar's selected day ──
export function TodaySchedule({ children }: { children: React.ReactNode }) {
  return (
    <section aria-labelledby="plan-sched-h" className={cardCls} data-testid="plan-schedule">
      <h2 id="plan-sched-h" className="text-[16px] font-bold text-gray-900">Planned for today</h2>
      {children}
    </section>
  );
}

// ── nothing is planned today: three ways forward, never the setup form ──
export function TodayEmpty({ accent, planHref, studyNowHref, calendarHref }: { accent: string; planHref: string; studyNowHref: string; calendarHref: string }) {
  return (
    <section aria-labelledby="plan-empty-h" className={cardCls} data-testid="plan-today-empty">
      <h2 id="plan-empty-h" className="text-[17px] font-bold text-gray-900">Nothing planned for today.</h2>
      <p className="mt-1 text-[14px] text-gray-700">You can plan a session, study now, or leave the day free.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Link href={planHref} className={pillPrimary} style={{ background: accent }}>Plan today</Link>
        <Link href={studyNowHref} className={pillOutline}>Study now</Link>
        <Link href={calendarHref} className={pillOutline}>View calendar</Link>
      </div>
    </section>
  );
}
