"use client";

import { useId, useState } from "react";
import { ScholarAnswer } from "@/app/individual/_components/scholar-answer/ScholarAnswer";

// SCHOLAR-COMPANION-01 P0b: HOW SCHOLAR TEACHES THIS LESSON. Teach me | Ask me | Guide me | Challenge me | Teach back |
// High-yield (+ Explain my mistake after a partly / not-yet check). Each is shown ONLY when policy offers that action
// (the `actions` the page was given), and every one is a learner's click -- never a scroll, never automatic. "Just
// explain it" (the lesson's Teach) is always there. Every request goes through POST learn/act (`run`, which adds the
// step, depth, mode, session and purpose), so the route's allowance, eligibility, grounding and dedupe all apply.
// Replies are the markdown subset, shown with ScholarAnswer. An Ask me / Challenge question is answered in the
// lesson's existing check (clarify), which records the informal verdict -- a learning mark, not an assessment.
//
// Server contract (learn-teaching.ts; none are cached; every reply has `answer` (markdown), `cited`, `sources`, `label`):
//   { action: "ask_me", level? }                        -> checkQuestion, level, informal; answered in the existing clarify
//   { action: "challenge", level? }                     -> the same + nextLevel { understood, partly, not_yet } (the next
//                                                          rung is picked from the clarify verdict on THIS question)
//   { action: "guide", hintLevel, attempt?, question? } -> a hint only + hintLevel, nextHintLevel, explainDirectly
//   { action: "mistake", question, learnerAnswer }      -> a correction + a quick-check question, no verdict
//   { action: "teach_back", explanation }               -> feedback + verdict
//   { action: "high_yield", depth? }                    -> examEvidence { papers, questions } | null

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;

export const APPROACHES = ["ask_me", "guide", "challenge", "teach_back", "high_yield", "mistake"] as const;
export type Approach = (typeof APPROACHES)[number] | "teach";
export const APPROACH_LABEL: Record<Approach, string> = {
  teach: "Teach me", ask_me: "Ask me", guide: "Guide me", challenge: "Challenge me", teach_back: "Teach back", high_yield: "High-yield", mistake: "Explain my mistake",
};
/** Pure. The approaches policy offers here, in order. Explain my mistake only after a partly / not-yet check with its answer kept. */
export function offeredApproaches(actions: readonly string[], verdict: string | null, hasLastCheck: boolean): Approach[] {
  return APPROACHES.filter(a => actions.includes(a) && (a !== "mistake" || ((verdict === "partly" || verdict === "not_yet") && hasLastCheck)));
}

export type ApproachResult = { ok: boolean; json: Record<string, any> } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shown = { approach: Approach; text: string; label?: string | null; verdict?: string | null; question?: string | null; evidence?: string | null; explain?: boolean };
type Ladder = { understood?: number; partly?: number; not_yet?: number };

const textOf = (j: Record<string, unknown>) => [j.answer, j.text, j.feedback, j.hint].find(v => typeof v === "string" && v.trim()) as string | undefined;
const num = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" && Number.isFinite(v) ? v : 0);
/** high_yield's examEvidence, said plainly: how many of the learner's own papers and questions it drew on. */
function evidenceLine(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const p = num((e as { papers?: unknown }).papers), q = num((e as { questions?: unknown }).questions);
  if (!p && !q) return null;
  return `Drawn from your own exam material: ${p} paper${p === 1 ? "" : "s"}, ${q} question${q === 1 ? "" : "s"}.`;
}

export function ApproachControl({ offered, value, onChange, onTeach, onExplain, run, onQuestion, lastCheck, verdict, checks, depth, disabled, accent }: {
  offered: Approach[]; value: Approach | null; onChange: (a: Approach | null) => void; onTeach: () => void;
  /** guide's explainDirectly: the lesson's existing explain action. */
  onExplain?: () => void;
  /** The lesson's latest informal verdict, and how many checks it has had (a new one after a Challenge picks the next rung). */
  verdict: string | null; checks: number;
  run: (body: Record<string, unknown>) => Promise<ApproachResult>;
  /** An Ask me / Challenge question, handed to the lesson's existing check form. */
  onQuestion: (q: string) => void;
  lastCheck: { question: string; answer: string } | null; depth: string; disabled?: boolean; accent: string;
}) {
  const id = useId();
  const [shown, setShown] = useState<Shown | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const [ladder, setLadder] = useState<{ next: Ladder; atChecks: number } | null>(null);
  const [hint, setHint] = useState(1);
  const [typed, setTyped] = useState("");
  if (!offered.length) return null; // nothing beyond Teach me is offered: the lesson's own Teach stays the way in
  async function send(approach: Approach, body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await run(body);
    setBusy(false);
    if (!r) return; // the page shows a clarify question or an error itself
    if (r.json.withheld) { setShown(null); setMsg(String(r.json.message ?? "Scholar could not answer this from your notes.")); return; }
    if (!r.ok) { setMsg(String(r.json.error ?? "Scholar could not answer just now.")); return; }
    const v = r.json.verdict as { label?: string } | string | null | undefined;
    const question = typeof r.json.checkQuestion === "string" && r.json.checkQuestion.trim() ? r.json.checkQuestion : null;
    setShown({ approach, text: textOf(r.json) ?? question ?? "", label: typeof r.json.label === "string" ? r.json.label : null, verdict: typeof v === "string" ? v : v?.label ?? null, question,
      evidence: approach === "high_yield" ? evidenceLine(r.json.examEvidence) : null, explain: approach === "guide" && !!r.json.explainDirectly });
    if ((approach === "ask_me" || approach === "challenge") && Number.isInteger(r.json.level)) setLevel(Number(r.json.level));
    if (approach === "challenge" && r.json.nextLevel && typeof r.json.nextLevel === "object") setLadder({ next: r.json.nextLevel as Ladder, atChecks: checks });
    if (approach === "guide" && Number.isInteger(r.json.nextHintLevel)) setHint(Math.max(1, Math.min(3, Number(r.json.nextHintLevel))));
    if (approach === "teach_back") setTyped("");
  }
  // Challenge: once THIS question has been checked, the next rung is the one the server named for that verdict.
  const challengeLevel = () => {
    const rung = ladder && checks > ladder.atChecks && verdict ? ladder.next[verdict as keyof Ladder] : undefined;
    return Number.isInteger(rung) ? Number(rung) : level;
  };
  const pick = (a: Approach) => { setShown(null); setMsg(null); setTyped(""); setHint(1); onChange(value === a ? null : a); };
  return (
    <div className="mt-3 rounded-xl border border-gray-200 px-3 py-3">
      <p id={`${id}-l`} className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">How should Scholar teach this?</p>
      <div role="group" aria-labelledby={`${id}-l`} className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className={`${ghost} min-h-[40px] px-3 text-[13px]`} onClick={() => { onChange(null); onTeach(); }} disabled={disabled}>Just explain it</button>
        {offered.map(a => (
          <button key={a} type="button" aria-pressed={value === a} onClick={() => pick(a)} disabled={disabled}
            className={`inline-flex min-h-[40px] items-center rounded-xl border px-3 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${value === a ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"} ${focusRing}`}>
            {APPROACH_LABEL[a]}
          </button>
        ))}
      </div>

      {value === "ask_me" && <Go label={busy ? "Writing a question…" : "Ask me a question"} disabled={busy || disabled} accent={accent} onGo={() => void send("ask_me", { action: "ask_me", level })} />}
      {value === "challenge" && <Go label={busy ? "Writing…" : `Challenge me (level ${challengeLevel()})`} disabled={busy || disabled} accent={accent} onGo={() => { const l = challengeLevel(); setLevel(l); void send("challenge", { action: "challenge", level: l }); }} />}
      {value === "high_yield" && <Go label={busy ? "Working…" : "Show the high-yield points"} disabled={busy || disabled} accent={accent} onGo={() => void send("high_yield", { action: "high_yield", depth })} />}
      {value === "mistake" && lastCheck && <Go label={busy ? "Working…" : "Explain my mistake"} disabled={busy || disabled} accent={accent} onGo={() => void send("mistake", { action: "mistake", question: lastCheck.question.slice(0, 600), learnerAnswer: lastCheck.answer.slice(0, 1500) })} />}
      {(value === "guide" || value === "teach_back") && (
        <form className="mt-3" onSubmit={e => { e.preventDefault(); if (value === "guide") void send("guide", { action: "guide", hintLevel: hint, ...(typed.trim() ? { attempt: typed.trim().slice(0, 1500) } : {}), ...(lastCheck ? { question: lastCheck.question.slice(0, 600) } : {}) }); else if (typed.trim()) void send("teach_back", { action: "teach_back", explanation: typed.trim() }); }}>
          <label htmlFor={`${id}-t`} className="block text-[13px] font-semibold text-gray-900">{value === "guide" ? "Your attempt so far (optional)" : "Explain this lesson in your own words"}</label>
          <textarea id={`${id}-t`} rows={3} maxLength={value === "guide" ? 1500 : 3000} value={typed} onChange={e => setTyped(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
          <button type="submit" className={`${btn} mt-2`} style={{ background: accent }} disabled={busy || disabled || (value === "teach_back" && !typed.trim())}>
            {busy ? "Working…" : value === "guide" ? `Give me hint ${hint} of 3` : "Check my explanation"}
          </button>
        </form>
      )}

      {msg && <p role="status" className="mt-2 text-[13.5px] text-gray-700">{msg}</p>}
      <div aria-live="polite">
        {shown && shown.text && (
          <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{APPROACH_LABEL[shown.approach]}{shown.label ? ` · ${shown.label}` : ""}</p>
            {shown.verdict && <p className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[13px] font-semibold text-violet-950">{shown.verdict}. An informal check for your own learning.</p>}
            <div className="mt-1.5"><ScholarAnswer text={shown.text} /></div>
            {shown.question && shown.question !== shown.text && <p className="mt-2 break-words text-[14.5px] font-semibold text-gray-900">{shown.question}</p>}
            {shown.evidence && <p className="mt-2 text-[12.5px] text-gray-600">{shown.evidence}</p>}
            {(shown.approach === "ask_me" || shown.approach === "challenge") && (
              <button type="button" className={`${ghost} mt-2`} onClick={() => onQuestion(shown.question || shown.text)}>Answer it</button>
            )}
            {shown.approach === "guide" && (
              <div className="mt-2 flex flex-wrap gap-2">
                {hint < 3 && <button type="button" className={ghost} onClick={() => setHint(h => Math.min(3, h + 1))}>I need a bigger hint</button>}
                {shown.explain && onExplain && <button type="button" className={ghost} onClick={() => { onChange(null); onExplain(); }} disabled={disabled}>Just explain it</button>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Go({ label, onGo, disabled, accent }: { label: string; onGo: () => void; disabled?: boolean; accent: string }) {
  return <button type="button" className={`${btn} mt-3`} style={{ background: accent }} disabled={disabled} onClick={onGo}>{label}</button>;
}
