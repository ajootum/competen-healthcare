"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScholarAnswer } from "@/app/individual/_components/scholar-answer/ScholarAnswer";
import { aiReasonCopy, type AiUnavailableReason } from "@/lib/individual/ai-availability";
import { STYLE_LABEL, type FollowOn, type MoreItem, type StyleChoice, type TeachingStyle } from "@/lib/individual/scholar/learn-style";

// SCHOLAR-LEARN-STYLE-01 (owner GO, Teaching Style and Practice HFE redesign): HOW SCHOLAR TEACHES THIS LESSON.
// ONE segmented choice of three styles, shown once per lesson (learn-style.ts decides what is shown and what each runs):
//   Explain (default)  the lesson itself -- the existing standard teaching, no special action
//   Guide me           the existing `guide` action: a hint at a time
//   Challenge me       the existing `challenge` action; "Ask me a question" (`ask_me`) and "Teach it back" (`teach_back`) follow it
// A discreet More menu holds the other actions (High-yield, Simplify, Summarise ...). Explain my mistake appears on its own
// only after a partly / not-yet check. Each is a learner's click, never a scroll, never automatic. Every request goes through
// POST learn/act (`run`, which adds the step, depth, mode, session and purpose), so the route's allowance, eligibility,
// grounding and dedupe all apply, exactly as they did for the old buttons.
//
// Switching style loses nothing: what each approach last showed (and its hint / level) is kept by the page per lesson
// (`memory`), so choosing a style again shows it with NO new AI call. The lesson, its thread, marks and position are untouched.
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
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export type Approach = "ask_me" | "guide" | "challenge" | "teach_back" | "high_yield" | "mistake";
export const APPROACH_LABEL: Record<Approach, string> = {
  ask_me: "Ask me", guide: "Guide me", challenge: "Challenge me", teach_back: "Teach back", high_yield: "High-yield", mistake: "Explain my mistake",
};

export type ApproachResult = { ok: boolean; json: Record<string, any> } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
type Shown = { approach: Approach; text: string; label?: string | null; verdict?: string | null; question?: string | null; evidence?: string | null; explain?: boolean };
type Ladder = { understood?: number; partly?: number; not_yet?: number };
/** What one approach last showed in one lesson, kept by the page so switching away and back costs no AI call. */
export type ApproachMemory = { shown: Shown | null; level: number; hint: number; ladder: { next: Ladder; atChecks: number } | null };
const FRESH: ApproachMemory = { shown: null, level: 1, hint: 1, ladder: null };

const textOf = (j: Record<string, unknown>) => [j.answer, j.text, j.feedback, j.hint].find(v => typeof v === "string" && v.trim()) as string | undefined;
const num = (v: unknown) => (Array.isArray(v) ? v.length : typeof v === "number" && Number.isFinite(v) ? v : 0);
/** high_yield's examEvidence, said plainly: how many of the learner's own papers and questions it drew on. */
function evidenceLine(e: unknown): string | null {
  if (!e || typeof e !== "object") return null;
  const p = num((e as { papers?: unknown }).papers), q = num((e as { questions?: unknown }).questions);
  if (!p && !q) return null;
  return `Drawn from your own exam material: ${p} paper${p === 1 ? "" : "s"}, ${q} question${q === 1 ? "" : "s"}.`;
}
const why = (reason: string | null) => (reason ? aiReasonCopy(reason as AiUnavailableReason, "scholar").text : null);
const Check = () => (
  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5l3.2 3.2L13 4.8" /></svg>
);

export function ApproachControl({ step, style, choices, more, mistake, onStyle, onClassic, working, onExplain, run, onQuestion, lastCheck, verdict, checks, depth, disabled, accent, memory, remember }: {
  /** The lesson this control is for (keys its memory). */
  step: number;
  /** The learner's chosen style, and the choices to show (learn-style.ts styleChoices; at most three). */
  style: TeachingStyle; choices: StyleChoice[]; onStyle: (s: TeachingStyle) => void;
  /** The More menu (learn-style.ts moreItems), and a classic Learn action asked of the lesson (Simplify, Summarise ...). */
  more: MoreItem[]; onClassic: (action: string) => void; working: (action: string) => boolean;
  /** Explain my mistake: offered only after a partly / not-yet check (learn-style.ts mistakeOffer). */
  mistake: { show: boolean; disabled: boolean; reason: string | null };
  /** guide's explainDirectly: the lesson's existing explain action. */
  onExplain?: () => void;
  /** The lesson's latest informal verdict, and how many checks it has had (a new one after a Challenge picks the next rung). */
  verdict: string | null; checks: number;
  run: (body: Record<string, unknown>) => Promise<ApproachResult>;
  /** An Ask me / Challenge question, handed to the lesson's existing check form. */
  onQuestion: (q: string) => void;
  lastCheck: { question: string; answer: string } | null; depth: string; disabled?: boolean; accent: string;
  memory: Record<string, ApproachMemory>; remember: (key: string, m: ApproachMemory) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  /** An approach opened from inside Challenge me, the More menu or Explain my mistake (otherwise the style's own panel is open). */
  const [over, setOver] = useState<Approach | null>(null);
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  const challenge = choices.find(c => c.style === "challenge") ?? null;
  const active: Approach | null = over ?? (style === "guide" ? "guide" : style === "challenge" ? "challenge" : null);
  const key = (a: Approach) => `${step}:${a}`;
  const mem = (a: Approach): ApproachMemory => memory[key(a)] ?? FRESH;
  const patch = (a: Approach, p: Partial<ApproachMemory>) => remember(key(a), { ...mem(a), ...p });
  const here = active ? mem(active) : FRESH;
  const shown = here.shown;
  useEffect(() => { if (!menu) return; const on = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenu(false); menuBtn.current?.focus(); } }; document.addEventListener("keydown", on); return () => document.removeEventListener("keydown", on); }, [menu]);

  async function send(approach: Approach, body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await run(body);
    setBusy(false);
    if (!r) return; // the page shows a clarify question or an error itself
    if (r.json.withheld) { patch(approach, { shown: null }); setMsg(String(r.json.message ?? "Scholar could not answer this from your notes.")); return; }
    if (!r.ok) { setMsg(String(r.json.error ?? "Scholar could not answer just now.")); return; }
    const v = r.json.verdict as { label?: string } | string | null | undefined;
    const question = typeof r.json.checkQuestion === "string" && r.json.checkQuestion.trim() ? r.json.checkQuestion : null;
    const next: ApproachMemory = { ...mem(approach), shown: { approach, text: textOf(r.json) ?? question ?? "", label: typeof r.json.label === "string" ? r.json.label : null, verdict: typeof v === "string" ? v : v?.label ?? null, question,
      evidence: approach === "high_yield" ? evidenceLine(r.json.examEvidence) : null, explain: approach === "guide" && !!r.json.explainDirectly } };
    if ((approach === "ask_me" || approach === "challenge") && Number.isInteger(r.json.level)) next.level = Number(r.json.level);
    if (approach === "challenge" && r.json.nextLevel && typeof r.json.nextLevel === "object") next.ladder = { next: r.json.nextLevel as Ladder, atChecks: checks };
    if (approach === "guide" && Number.isInteger(r.json.nextHintLevel)) next.hint = Math.max(1, Math.min(3, Number(r.json.nextHintLevel)));
    remember(key(approach), next);
    if (approach === "teach_back") setTyped("");
  }
  // Challenge: once THIS question has been checked, the next rung is the one the server named for that verdict.
  const challengeLevel = () => {
    const m = mem("challenge");
    const rung = m.ladder && checks > m.ladder.atChecks && verdict ? m.ladder.next[verdict as keyof Ladder] : undefined;
    return Number.isInteger(rung) ? Number(rung) : m.level;
  };
  const choose = (s: TeachingStyle) => { setOver(null); setMsg(null); setTyped(""); setMenu(false); onStyle(s); };
  const open = (a: Approach) => { setMsg(null); setTyped(""); setMenu(false); setOver(o => (o === a ? null : a)); };
  const onKeys = (e: React.KeyboardEvent, i: number) => {
    const usable = choices.map((c, k) => (c.disabled ? -1 : k)).filter(k => k >= 0);
    if (!usable.length) return;
    const at = usable.indexOf(i);
    let to: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") to = usable[(at + 1 + usable.length) % usable.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") to = usable[(at - 1 + usable.length) % usable.length];
    else if (e.key === "Home") to = usable[0];
    else if (e.key === "End") to = usable[usable.length - 1];
    if (to === null) return;
    e.preventDefault(); choose(choices[to].style); radios.current[to]?.focus();
  };

  const followOns: FollowOn[] = challenge && style === "challenge" && (mem("challenge").shown || over === "ask_me" || over === "teach_back") ? challenge.followOns : [];
  const approachMore = (a: string): a is Approach => a === "high_yield" || a === "ask_me" || a === "teach_back";
  const showStyles = choices.length > 1;
  if (!showStyles && !more.length && !mistake.show) return null; // nothing beyond the lesson itself is offered

  return (
    <div className="mt-3 rounded-xl border border-gray-200 px-3 py-3">
      {showStyles && (
        <>
          <p id={`${id}-l`} className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">Teaching style</p>
          <div role="radiogroup" aria-labelledby={`${id}-l`} className="mt-2 grid grid-cols-1 gap-2 @min-[34rem]:grid-cols-3">
            {choices.map((c, i) => {
              const on = c.style === style && !c.disabled;
              return (
                <button key={c.style} ref={el => { radios.current[i] = el; }} type="button" role="radio" aria-checked={on} disabled={c.disabled || (!!busy && !on)}
                  tabIndex={on || (!choices.some(x => x.style === style && !x.disabled) && i === 0) ? 0 : -1}
                  aria-describedby={`${id}-d${i}`} onClick={() => choose(c.style)} onKeyDown={e => onKeys(e, i)}
                  className={`flex min-h-[44px] items-start gap-2 rounded-xl border-2 px-3 py-2 text-left disabled:opacity-60 pointer-coarse:min-h-[var(--cmp-touch-min)] ${on ? "border-gray-900 bg-gray-50" : "border-gray-300 bg-white hover:bg-gray-50"} ${focusRing}`}>
                  <span aria-hidden={!on} className={`mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center text-gray-900 ${on ? "" : "invisible"}`}>{on && <Check />}</span>
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold text-gray-900">{c.label}{on && <span className="sr-only"> (selected)</span>}</span>
                    <span id={`${id}-d${i}`} className="mt-0.5 block text-[12.5px] leading-snug text-gray-700">{c.description}{c.disabled && c.reason ? <span className="mt-1 block text-gray-600">{why(c.reason)}</span> : null}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}

      {active === "challenge" && <Go label={busy ? "Writing…" : `Challenge me (level ${challengeLevel()})`} disabled={busy || disabled} accent={accent} onGo={() => { const l = challengeLevel(); patch("challenge", { level: l }); void send("challenge", { action: "challenge", level: l }); }} />}
      {active === "ask_me" && <Go label={busy ? "Writing a question…" : "Ask me a question"} disabled={busy || disabled} accent={accent} onGo={() => void send("ask_me", { action: "ask_me", level: mem("ask_me").level })} />}
      {active === "high_yield" && <Go label={busy ? "Working…" : "Show the high-yield points"} disabled={busy || disabled} accent={accent} onGo={() => void send("high_yield", { action: "high_yield", depth })} />}
      {(active === "guide" || active === "teach_back") && (
        <form className="mt-3" onSubmit={e => { e.preventDefault(); if (active === "guide") void send("guide", { action: "guide", hintLevel: mem("guide").hint, ...(typed.trim() ? { attempt: typed.trim().slice(0, 1500) } : {}), ...(lastCheck ? { question: lastCheck.question.slice(0, 600) } : {}) }); else if (typed.trim()) void send("teach_back", { action: "teach_back", explanation: typed.trim() }); }}>
          <label htmlFor={`${id}-t`} className="block text-[13px] font-semibold text-gray-900">{active === "guide" ? "Your attempt so far (optional)" : "Explain this lesson in your own words"}</label>
          <textarea id={`${id}-t`} rows={3} maxLength={active === "guide" ? 1500 : 3000} value={typed} onChange={e => setTyped(e.target.value)} className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
          <button type="submit" className={`${btn} mt-2`} style={{ background: accent }} disabled={busy || disabled || (active === "teach_back" && !typed.trim())}>
            {busy ? "Working…" : active === "guide" ? `Give me hint ${mem("guide").hint} of 3` : "Check my explanation"}
          </button>
        </form>
      )}

      {msg && <p role="status" className="mt-2 text-[13.5px] text-gray-700">{msg}</p>}
      <div aria-live="polite">
        {shown && shown.text && active === shown.approach && (
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
                {here.hint < 3 && <button type="button" className={ghost} onClick={() => patch("guide", { hint: Math.min(3, here.hint + 1) })}>I need a bigger hint</button>}
                {shown.explain && onExplain && <button type="button" className={ghost} onClick={() => { choose("explain"); onExplain(); }} disabled={disabled}>Just explain it</button>}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Challenge me's follow-on steps, after its content: Ask me a question / Teach it back. */}
      {followOns.length > 0 && (
        <div role="group" aria-label="Next steps in Challenge me" className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-[12.5px] text-gray-600">Next:</span>
          {followOns.map(f => (
            <button key={f.action} type="button" aria-pressed={over === f.action} aria-describedby={f.reason ? `${id}-f${f.action}` : undefined} disabled={f.disabled || busy}
              onClick={() => open(f.action)} className={`${ghost} min-h-[40px] px-3 text-[13px] ${over === f.action ? "border-gray-900 bg-gray-50" : ""}`}>
              {over === f.action && <span className="mr-1.5"><Check /></span>}{f.label}
            </button>
          ))}
          {followOns.filter(f => f.reason).map(f => <span key={f.action} id={`${id}-f${f.action}`} className="w-full text-[12.5px] text-gray-600">{f.label}: {why(f.reason)}</span>)}
        </div>
      )}

      {/* Explain my mistake: only after a partly / not-yet check, where it is relevant. */}
      {mistake.show && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
          <p className="min-w-0 flex-1 basis-[200px] text-[13px] text-violet-950">{verdict === "not_yet" ? "That check was not quite there yet." : "That check was partly right."} Want to see what went wrong?</p>
          <button type="button" aria-describedby={mistake.reason ? `${id}-m` : undefined} disabled={mistake.disabled || busy || disabled}
            onClick={() => { if (!lastCheck) return; setOver("mistake"); setMenu(false); void send("mistake", { action: "mistake", question: lastCheck.question.slice(0, 600), learnerAnswer: lastCheck.answer.slice(0, 1500) }); }} className={`${ghost} min-h-[40px] px-3 text-[13px]`}>Explain my mistake</button>
          {mistake.reason && <p id={`${id}-m`} className="w-full text-[12.5px] text-gray-700">{why(mistake.reason)}</p>}
        </div>
      )}

      {/* More: the other actions, tucked away until wanted. */}
      {more.length > 0 && (
        <div className="relative mt-3">
          <button ref={menuBtn} type="button" aria-expanded={menu} aria-controls={`${id}-more`} onClick={() => setMenu(m => !m)}
            className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl px-2 text-[13px] font-semibold text-gray-800 underline-offset-2 hover:underline pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
            More<span aria-hidden="true" className={`text-[10px] text-gray-500 transition-transform ${menu ? "rotate-90" : ""}`}>▶</span>
          </button>
          {menu && (
            <div id={`${id}-more`} role="group" aria-label="More ways to learn this" className="mt-1 flex flex-wrap gap-2">
              {more.map(m => (
                <span key={m.key} className="contents">
                  <button type="button" disabled={m.disabled || busy || !!disabled} aria-describedby={m.reason ? `${id}-r${m.key}` : undefined}
                    onClick={() => { if (m.kind === "classic") { setMenu(false); onClassic(m.action); } else if (approachMore(m.action)) open(m.action); }}
                    className={`${ghost} min-h-[40px] px-3 text-[13px]`}>
                    {working(m.action) ? "Working…" : m.label}
                  </button>
                  {m.reason && <span id={`${id}-r${m.key}`} className="sr-only">{why(m.reason)}</span>}
                </span>
              ))}
              {more.some(m => m.disabled && m.reason) && <p className="w-full text-[12.5px] text-gray-600">{why(more.find(m => m.disabled && m.reason)!.reason)}</p>}
            </div>
          )}
        </div>
      )}
      {style === "explain" && showStyles && !over && <p className="mt-2 text-[12.5px] text-gray-600">{STYLE_LABEL.explain} is the lesson above. Choose another style to be guided or challenged instead.</p>}
    </div>
  );
}

function Go({ label, onGo, disabled, accent }: { label: string; onGo: () => void; disabled?: boolean; accent: string }) {
  return <button type="button" className={`${btn} mt-3`} style={{ background: accent }} disabled={disabled} onClick={onGo}>{label}</button>;
}
