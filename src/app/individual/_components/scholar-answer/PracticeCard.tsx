"use client";

// SCHOLAR-PERSONAL-AI-EXPERIENCE-01: the optional "Practise this topic" card under a Personal AI answer. Collapsed by
// default. Everything is checked locally from the data in the answer (nothing is sent anywhere); the only outgoing call
// is the learner pressing Save, handled by onSaveFlashcard (returns an error message, or null on success).

import { useId, useState } from "react";
import type { Practice } from "@/lib/individual/scholar/answer-format";
import { PRACTICE_CAPS } from "@/lib/individual/scholar/answer-format";

type Save = (card: { front: string; back: string }) => Promise<string | null>;
type Part = "flashcard" | "mcq" | "reasoning";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const btn = `inline-flex ${touch} items-center justify-center rounded-lg border border-gray-300 bg-white px-3.5 text-[14px] font-semibold text-gray-900 hover:bg-gray-50 disabled:opacity-60 ${focusRing}`;
const LETTERS = "ABCDE";

const clip = (s: string, cap: number) => (s.length > cap ? s.slice(0, cap - 1).trimEnd() + "…" : s);

function SaveButton({ label, card, onSave }: { label: string; card: { front: string; back: string }; onSave: Save }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setState("saving"); setErr(null);
    try {
      const e = await onSave({ front: clip(card.front, PRACTICE_CAPS.front), back: clip(card.back, PRACTICE_CAPS.back) });
      if (e) { setErr(e); setState("error"); } else setState("saved");
    } catch { setErr("Could not save this card. Try again."); setState("error"); }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button type="button" className={btn} onClick={go} disabled={state === "saving" || state === "saved"}>
        {state === "saving" ? "Saving…" : state === "saved" ? "Saved to my flashcards" : label}
      </button>
      <span role="status" className="text-[13px] text-gray-700">{state === "error" && err ? err : ""}</span>
    </div>
  );
}

function Flashcard({ card, onSave }: { card: NonNullable<Practice["flashcard"]>; onSave?: Save }) {
  const [back, setBack] = useState(false);
  return (
    <div className="space-y-3">
      <button type="button" aria-pressed={back} onClick={() => setBack(b => !b)}
        className={`block w-full rounded-2xl border border-gray-300 bg-white p-4 text-left hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] md:p-5 ${focusRing}`}>
        <span className="block text-[12px] font-bold uppercase tracking-[0.1em] text-gray-700">{back ? "Back" : "Front"}</span>
        <span aria-live="polite" className="mt-1.5 block whitespace-pre-line break-words text-[16px] leading-[1.55] text-gray-900">{back ? card.back : card.front}</span>
        <span className="mt-3 block text-[13px] text-gray-700">{back ? "Press to see the question again" : "Press to see the answer"}</span>
      </button>
      {onSave && <SaveButton label="Save to my flashcards" card={card} onSave={onSave} />}
    </div>
  );
}

function Mcq({ q, onSave }: { q: NonNullable<Practice["mcq"]>; onSave?: Save }) {
  const name = useId();
  const [pick, setPick] = useState<number | null>(null);
  const [checked, setChecked] = useState(false);
  const correct = checked && pick === q.answer;
  const card = {
    front: `${q.stem}\n${q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join("\n")}`,
    back: `${LETTERS[q.answer]}. ${q.options[q.answer]}\n${q.explanation}`,
  };
  return (
    <div className="space-y-3">
      <fieldset className="min-w-0 space-y-2">
        <legend className="mb-2 text-[15px] font-semibold leading-[1.5] text-gray-900">{q.stem}</legend>
        {q.options.map((o, i) => {
          const isAnswer = checked && i === q.answer, isWrongPick = checked && pick === i && i !== q.answer;
          return (
            <label key={i} className={`flex ${touch} cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-[15px] leading-[1.5] text-gray-900 ${isAnswer ? "border-green-700 bg-green-50" : isWrongPick ? "border-amber-700 bg-amber-50" : "border-gray-300 bg-white"}`}>
              <input type="radio" name={name} value={i} checked={pick === i} disabled={checked} onChange={() => setPick(i)} className="mt-1 h-4 w-4 shrink-0 accent-gray-900" />
              <span className="min-w-0 break-words"><span className="font-semibold">{LETTERS[i]}.</span> {o}
                {isAnswer && <span className="ml-2 text-[13px] font-semibold text-green-800">Correct answer</span>}
                {isWrongPick && <span className="ml-2 text-[13px] font-semibold text-amber-900">Your choice</span>}
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        {!checked
          ? <button type="button" className={btn} disabled={pick === null} onClick={() => setChecked(true)}>Check answer</button>
          : <button type="button" className={btn} onClick={() => { setPick(null); setChecked(false); }}>Try again</button>}
      </div>
      <div role="status" aria-live="polite">
        {checked && (
          <div className="rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-3 text-[15px] leading-[1.6] text-gray-900">
            <p className="font-semibold">{correct ? "Correct" : `Not quite — the answer is ${LETTERS[q.answer]}`}</p>
            <p className="mt-1 whitespace-pre-line break-words">{q.explanation}</p>
          </div>
        )}
      </div>
      {onSave && <SaveButton label="Save as flashcard" card={card} onSave={onSave} />}
    </div>
  );
}

function Reasoning({ r, onSave }: { r: NonNullable<Practice["reasoning"]>; onSave?: Save }) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const card = { front: `${r.question}\n\nCase: ${clip(r.scenario, 140)}`, back: r.modelAnswer };
  return (
    <div className="space-y-3">
      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-700">Practice case (fictional)</p>
      <p className="whitespace-pre-line break-words text-[15px] leading-[1.6] text-gray-900">{r.scenario}</p>
      <p className="whitespace-pre-line break-words text-[15px] font-semibold leading-[1.5] text-gray-900">{r.question}</p>
      <div>
        <label htmlFor={id} className="block text-[14px] font-semibold text-gray-900">Your reasoning</label>
        <p id={`${id}-h`} className="text-[13px] text-gray-700">For you only. It stays on this screen and is not sent or saved.</p>
        <textarea id={id} aria-describedby={`${id}-h`} rows={4} className={`mt-1.5 block w-full rounded-lg border border-gray-300 bg-white p-3 text-[15px] text-gray-900 ${focusRing}`} />
      </div>
      <button type="button" className={btn} aria-expanded={shown} onClick={() => setShown(s => !s)}>{shown ? "Hide model answer" : "Show model answer"}</button>
      {shown && (
        <div className="rounded-lg border border-gray-300 bg-gray-50 px-3.5 py-3">
          <p className="text-[13px] font-bold uppercase tracking-[0.1em] text-gray-700">Model answer</p>
          <p className="mt-1 whitespace-pre-line break-words text-[15px] leading-[1.6] text-gray-900">{r.modelAnswer}</p>
        </div>
      )}
      {onSave && <SaveButton label="Save as flashcard" card={card} onSave={onSave} />}
    </div>
  );
}

const TAB_LABEL: Record<Part, string> = { flashcard: "Flashcard", mcq: "Question", reasoning: "Clinical reasoning" };

export function PracticeCard({ practice, onSaveFlashcard }: { practice: Practice; onSaveFlashcard?: Save }) {
  const parts = (["flashcard", "mcq", "reasoning"] as const).filter(p => practice[p]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Part>(parts[0]);
  const panel = useId();
  if (!parts.length) return null;
  const active = parts.includes(tab) ? tab : parts[0];
  return (
    <section className="mt-6 rounded-2xl border border-gray-300 bg-white" aria-label="Practice">
      <h4 className="m-0 text-[15px] font-semibold">
        <button type="button" aria-expanded={open} aria-controls={panel} onClick={() => setOpen(o => !o)}
          className={`flex w-full ${touch} items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-left text-gray-900 ${focusRing}`}>
          <span>Practise this topic</span>
          <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" className={`shrink-0 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}><path d="M5 8l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </h4>
      <div id={panel} hidden={!open} className="space-y-4 border-t border-gray-200 px-4 py-4">
        {parts.length > 1 && (
          <div role="group" aria-label="Practice type" className="flex flex-wrap gap-2">
            {parts.map(p => (
              <button key={p} type="button" aria-pressed={active === p} onClick={() => setTab(p)}
                className={`inline-flex ${touch} items-center rounded-full border px-3.5 text-[14px] font-semibold ${focusRing} ${active === p ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900 hover:bg-gray-50"}`}>
                {TAB_LABEL[p]}
              </button>
            ))}
          </div>
        )}
        {active === "flashcard" && practice.flashcard && <Flashcard key="f" card={practice.flashcard} onSave={onSaveFlashcard} />}
        {active === "mcq" && practice.mcq && <Mcq key="m" q={practice.mcq} onSave={onSaveFlashcard} />}
        {active === "reasoning" && practice.reasoning && <Reasoning key="r" r={practice.reasoning} onSave={onSaveFlashcard} />}
      </div>
    </section>
  );
}
