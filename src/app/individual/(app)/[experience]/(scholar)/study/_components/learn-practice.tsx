"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { carry } from "./study-active";
import { studyHref } from "./question-view";

// SCHOLAR-COMPANION-01 P0b: PRACTISE THIS LESSON, inline and collapsed. No new engine: it reuses what exists.
//   Quiz           GET  /api/individual/scholar/questions (the learner's own unanswered questions on this section: a
//                  read, no AI) first; only if none is waiting, and only on the learner's click, POST the same route
//                  (which itself reuses unanswered questions first, and writes through the quality checks). Answered with
//                  POST /attempts (no AI): right or wrong, the rationale and the quoted source sentence.
//   Flashcards     the learner's OWN card, drafted from the lesson's own words, edited and confirmed, then POST
//                  /flashcards (no AI). Recorded as written by the learner -- not AI-made, not clinically reviewed.
//   Apply          the existing Apply preset (?section=&from=teach), carrying the study session. Offered ONLY for clinically relevant
//                  content (learn-inline.ts applyEligible); the caller passes null otherwise.
//   Teach back     no longer here (owner GO "Teaching Style & Practice HFE Redesign"): the teach_back action and its handler remain.
// A practice answer is a learning aid. Nothing here is assessment evidence, verified competence or a Passport record.

export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
export const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
export const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;

/** SCHOLAR-INLINE-CHECKS-01: where "Study flashcards from this lesson" lands (the Flashcards page reads ?material= and ?section=). */
export const lessonFlashcardsHref = (materialId: string, chunkId: string | null) =>
  `${studyHref("revise/flashcards")}?material=${encodeURIComponent(materialId)}${chunkId ? `&section=${encodeURIComponent(chunkId)}` : ""}`;

type Q = { id: string; stem: string; options: string[]; citation: string };
type Feedback = { correct: boolean; correctIndex: number; rationale: string; source: { quote: string; citation: string } };

export async function req(url: string, init?: { method?: string; body?: unknown }): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, init?.body !== undefined ? { method: init.method ?? "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.body) } : { method: init?.method ?? "GET" });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch { return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } }; }
}

export function LessonPractice({ open, onToggle, chunkId, materialId, draft, ownCards, aiAllowed, applyHref, onPractised, onApplied, accent }: {
  open: boolean; onToggle: (open: boolean) => void; chunkId: string | null; materialId: string | null;
  /** The card's starting words, from the lesson itself (its check question and key points). The learner edits them. */
  draft: { front: string; back: string }; ownCards: boolean;
  /** New questions may be written (consent and AI available). Off: only questions already written are offered. */
  aiAllowed: boolean;
  /** The Apply case link, or null where the content is not clinically relevant (learn-inline.ts applyEligible): then no case is offered. */
  applyHref: string | null; onPractised: () => void; onApplied: () => void; accent: string;
}) {
  const [mode, setMode] = useState<"quiz" | "cards" | null>(null);
  const cards = ownCards && !!materialId;
  return (
    <details open={open} onToggle={e => onToggle((e.currentTarget as HTMLDetailsElement).open)} className="group mt-3 rounded-xl border border-gray-200">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>Practise this lesson
      </summary>
      <div className="border-t border-gray-200 px-3 py-3">
        {/* Three choices at most: Flashcards, Quiz, Apply (only for clinically relevant content). Stacked on a phone. */}
        <div role="group" aria-label="Ways to practise" className="grid gap-2 @sm:grid-cols-3">
          {cards && <Choice label="Flashcards" hint="Quick recall and spaced revision" selected={mode === "cards"} onClick={() => setMode(m => (m === "cards" ? null : "cards"))} />}
          {chunkId && <Choice label="Quiz" hint="Short knowledge check" selected={mode === "quiz"} onClick={() => setMode(m => (m === "quiz" ? null : "quiz"))} />}
          {applyHref && <CaseLink href={applyHref} onApplied={onApplied} />}
        </div>
        {mode === "quiz" && chunkId && <PracticeQuestion chunkId={chunkId} aiAllowed={aiAllowed} onPractised={onPractised} accent={accent} />}
        {mode === "cards" && materialId && (
          <>
            <OwnCard materialId={materialId} chunkId={chunkId} draft={draft} onPractised={onPractised} accent={accent} />
            <p className="mt-3"><Link href={lessonFlashcardsHref(materialId, chunkId)} className={`font-semibold underline ${focusRing}`}>Study flashcards from this lesson</Link></p>
          </>
        )}
        <p className="mt-3 text-[12px] text-gray-600">Practice is for your own learning. It is not an assessment and does not change your competence record.</p>
      </div>
    </details>
  );
}

const choiceCls = (selected: boolean) => `flex w-full min-h-[44px] flex-col items-start justify-center rounded-xl border-2 bg-white px-3 py-2 text-left hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${selected ? "border-gray-900" : "border-gray-300"} ${focusRing}`;

/** One of the practice choices: a title and a one-line description. Selected is a border AND the word "Selected", not colour alone. */
function Choice({ label, hint, selected, onClick }: { label: string; hint: string; selected: boolean; onClick: () => void }) {
  return (
    <button type="button" aria-pressed={selected} onClick={onClick} className={choiceCls(selected)}>
      <span className="text-[14px] font-semibold text-gray-900">{label}{selected && <span className="ml-1.5 text-[12px] font-bold">✓ Selected</span>}</span>
      <span className="text-[12.5px] font-normal text-gray-600">{hint}</span>
    </button>
  );
}

function CaseLink({ href, onApplied }: { href: string; onApplied: () => void }) {
  const router = useRouter();
  // The open study session is read when the link is used, not while rendering (study-active.ts).
  return (
    <a href={href} className={choiceCls(false)} onClick={e => { e.preventDefault(); onApplied(); router.push(carry(href)); }}>
      <span className="text-[14px] font-semibold text-gray-900">Apply</span>
      <span className="text-[12.5px] font-normal text-gray-600">Try it in a case</span>
    </a>
  );
}

/**
 * `variant` "quick" (SCHOLAR-INLINE-CHECKS-01, the inline Quick check): opens by READING the stored question (no AI) and offers
 * "Write a question" (the existing POST) only when none is stored and `aiAllowed`, on the learner's click. `onResult`: the code-marked
 * outcome, so the lesson can keep it. "practice" (the default) is the Practise panel exactly as before.
 */
export function PracticeQuestion({ chunkId, aiAllowed, onPractised, accent, variant = "practice", onResult }: {
  chunkId: string; aiAllowed: boolean; onPractised: () => void; accent: string; variant?: "practice" | "quick"; onResult?: (correct: boolean) => void;
}) {
  const id = useId();
  const [state, setState] = useState<"idle" | "loading" | "writing">("idle");
  const [list, setList] = useState<Q[] | null>(null);
  const [at, setAt] = useState(0);
  const [choice, setChoice] = useState<number | null>(null);
  const [fb, setFb] = useState<Feedback | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const read = async () => {
    const r = await req(`/api/individual/scholar/questions?chunkId=${encodeURIComponent(chunkId)}&kind=mcq`);
    return r.ok ? ((r.json.questions ?? []) as Q[]) : null;
  };
  async function load(write = true) {
    setState("loading"); setMsg(null); setFb(null); setChoice(null); setAt(0);
    let qs = await read();
    if (qs && !qs.length && aiAllowed && write) {
      // Nothing waiting: the learner asked, so the existing route may write one (reuse-first, quality-checked).
      setState("writing");
      const w = await req("/api/individual/scholar/questions", { body: { chunkId, kind: "mcq", count: 1 } });
      if (!w.ok) { setMsg(String(w.json.error ?? "No question could be written just now.")); setState("idle"); setList([]); return; }
      if (!w.json.created && !w.json.reused) { setMsg(String(w.json.message ?? "No question could be written from this section.")); setState("idle"); setList([]); return; }
      qs = await read();
    }
    setState("idle");
    if (!qs) { setMsg("Your questions could not be read just now."); setList([]); return; }
    if (!qs.length && variant === "quick") setMsg(aiAllowed ? "No question is stored for this section yet." : "No question is stored for this section, and new ones need AI help, which is not available now.");
    else if (!qs.length) setMsg(aiAllowed ? "No question is waiting on this section." : "No question is waiting on this section, and new ones need AI help, which is not available now.");
    setList(qs);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = list?.[at];
    if (!q || choice === null || busy) return;
    setBusy(true); setMsg(null);
    const r = await req("/api/individual/scholar/attempts", { body: { questionId: q.id, chosenIndex: choice } });
    setBusy(false);
    if (!r.ok) { setMsg(String(r.json.error ?? "Your answer could not be saved.")); return; }
    setFb(r.json as Feedback); onPractised(); onResult?.(!!(r.json as Feedback).correct);
  }
  // The quick check READS the stored question as soon as it is opened (a GET, no AI), once.
  const started = useRef(false);
  useEffect(() => { if (variant === "quick" && !started.current) { started.current = true; void load(false); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const q = list?.[at];
  return (
    <div className="mt-3">
      {variant === "quick" && list !== null && !list.length && aiAllowed && <button type="button" className={btn} style={{ background: accent }} disabled={state !== "idle"} onClick={() => void load(true)}>{state === "writing" ? "Writing a question…" : state === "loading" ? "Finding a question…" : "Write a question"}</button>}
      {variant === "quick" && list === null && <p role="status" className="text-[13.5px] text-gray-700">Finding your stored question…</p>}
      {variant === "practice" && list === null && <button type="button" className={btn} style={{ background: accent }} disabled={state !== "idle"} onClick={() => void load()}>{state === "writing" ? "Writing a question…" : state === "loading" ? "Finding a question…" : "Show me a question"}</button>}
      {msg && <p role="status" className="mt-2 text-[13.5px] text-gray-700">{msg}</p>}
      {q && (
        <form onSubmit={submit} className="mt-2 rounded-xl border border-gray-200 bg-white p-3">
          <fieldset disabled={!!fb}>
            <legend className="break-words text-[14.5px] font-semibold text-gray-900">{q.stem}</legend>
            <div className="mt-2 grid gap-2">
              {q.options.map((o, i) => {
                const mark = fb ? (i === fb.correctIndex ? "right" : i === choice ? "wrong" : "") : "";
                return (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${mark === "right" ? "border-emerald-600 bg-emerald-50" : mark === "wrong" ? "border-red-500 bg-red-50" : choice === i ? "border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>
                    <input type="radio" name={`${id}-q`} checked={choice === i} onChange={() => setChoice(i)} className="mt-1 h-4 w-4 shrink-0" />
                    <span className="min-w-0 break-words">{o}{mark === "right" && <span className="font-semibold"> — matches your notes</span>}{mark === "wrong" && <span className="font-semibold"> — your answer</span>}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {!fb && <button type="submit" className={`${btn} mt-3`} style={{ background: accent }} disabled={choice === null || busy}>{busy ? "Checking…" : "Check my answer"}</button>}
          {fb && (
            <div aria-live="polite" className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-[13.5px] text-gray-800">
              <p className="font-semibold text-gray-900">{fb.correct ? "That matches your notes." : "That does not match your notes."}</p>
              {fb.rationale && <p className="mt-1 break-words">{fb.rationale}</p>}
              {fb.source?.quote && <p className="mt-1.5 break-words border-l-2 border-gray-300 pl-2 italic">“{fb.source.quote}” <span className="not-italic text-gray-600">— {fb.source.citation}</span></p>}
              {!fb.correct && <p className="mt-1.5 text-[12.5px] text-gray-600">A missed question is added to your spaced review. <Link href={studyHref("revise/mistakes")} className={`font-semibold underline ${focusRing}`}>Review missed questions in Revise</Link></p>}
              <div className="mt-2 flex flex-wrap gap-2">
                {list && at < list.length - 1 && <button type="button" className={ghost} onClick={() => { setAt(a => a + 1); setChoice(null); setFb(null); }}>Next question</button>}
                <button type="button" className={ghost} onClick={() => void load(variant !== "quick")}>Another question</button>
              </div>
            </div>
          )}
          <p className="mt-2 text-[12px] text-gray-600">From {q.citation}</p>
        </form>
      )}
    </div>
  );
}

export function OwnCard({ materialId, chunkId, draft, onPractised, accent }: { materialId: string; chunkId: string | null; draft: { front: string; back: string }; onPractised: () => void; accent: string }) {
  const id = useId();
  const [front, setFront] = useState(draft.front);
  const [back, setBack] = useState(draft.back);
  const [flipped, setFlipped] = useState(false);
  const [state, setState] = useState<"edit" | "saving" | "saved">("edit");
  const [msg, setMsg] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (state !== "edit" || !front.trim() || !back.trim()) return;
    setState("saving"); setMsg(null);
    const r = await req("/api/individual/scholar/flashcards", { body: { materialId, ...(chunkId ? { chunkId } : {}), front: front.trim(), back: back.trim() } });
    if (!r.ok) { setMsg(String(r.json.error ?? "Your card could not be saved just now.")); setState("edit"); return; }
    setMsg(String(r.json.note ?? "Saved to your flashcards as your own card.")); setState("saved"); onPractised();
  }
  return (
    <div className="mt-3 space-y-3">
      <button type="button" aria-pressed={flipped} onClick={() => setFlipped(f => !f)}
        className={`block w-full rounded-xl border border-gray-300 bg-white px-4 py-5 text-left pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
        <span className="block text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{flipped ? "Back" : "Front"} · tap to turn over</span>
        <span className="mt-1 block whitespace-pre-wrap break-words text-[15px] text-gray-900">{(flipped ? back : front) || "(empty)"}</span>
      </button>
      {state === "saved" ? <p role="status" className="text-[14px] font-semibold text-gray-900">{msg}</p> : (
        <form onSubmit={save} className="space-y-2">
          <p className="text-[12.5px] text-gray-700">Drafted from this lesson&apos;s own words. Saving makes it your own card: recorded as written by you, not as made by AI and not as clinically reviewed. Change anything first.</p>
          <label htmlFor={`${id}-f`} className="block text-[13px] font-semibold text-gray-900">Front (a question)</label>
          <textarea id={`${id}-f`} rows={2} maxLength={300} value={front} onChange={e => setFront(e.target.value)} className={`w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
          <label htmlFor={`${id}-b`} className="block text-[13px] font-semibold text-gray-900">Back</label>
          <textarea id={`${id}-b`} rows={3} maxLength={600} value={back} onChange={e => setBack(e.target.value)} className={`w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
          {msg && <p role="alert" className="text-[13px] text-red-800">{msg}</p>}
          <button type="submit" className={btn} style={{ background: accent }} disabled={state !== "edit" || !front.trim() || !back.trim()}>{state === "saving" ? "Saving…" : "Save to my flashcards"}</button>
        </form>
      )}
    </div>
  );
}
