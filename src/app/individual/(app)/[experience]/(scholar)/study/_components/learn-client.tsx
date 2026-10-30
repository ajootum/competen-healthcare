"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { INFORMAL_CHECK_LABEL, LEARN_MODE_LABEL, NOT_IN_NOTES_LABEL, PERSONAL_AI_LABEL, QUESTION_MAX, SOURCE_KIND_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import type { SessionView } from "@/lib/individual/scholar/learn-view";
import { sourceHref } from "./question-view";
import { AiBadge } from "./client";
import { AiFlagList, GovernedReferenceList } from "./learn-kinds";
import { AiFeedback } from "./ai-feedback";
import ClarifyPurpose from "@/app/individual/_components/ai/ClarifyPurpose";
import { aiReasonCopy, clarifyFrom, type ClarifyPrompt } from "@/lib/individual/ai-availability";
import { useAiAvailabilityOf } from "@/app/individual/_components/ai/AiAvailabilityContext";
import { FormativeAiLabel } from "./edu-notice";

// THE LEARN WORKSPACE -- COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24). Three regions on a wide screen -- the
// sources (the steps and the student's own sections, the originals one click away), the guided lesson in the
// centre, and the Scholar assistant (Ask) -- and, below md, one column with tabs (the CPR-MOB-001 single md edge).
// Every answer comes from POST /api/individual/scholar/learn/act and is shown as the route says: from the notes
// (cited), governed reference, AI background (apart, labelled), AI flags (to check), or withheld with the reason.
// Switching actions keeps the step and its thread: nothing the student has seen is lost by choosing another way.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const chip = `inline-flex items-center rounded-full border px-3 py-1.5 text-[13px] font-semibold disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

export type StartScope =
  | { kind: "section"; chunkId: string } | { kind: "document"; materialId: string } | { kind: "documents"; materialIds: string[] }
  | { kind: "topic"; topic: string } | { kind: "competency"; competencyId: string }
  | { kind: "sources"; materialIds: string[]; chunkIds: string[]; topics: string[]; topic?: string };

type Source = { tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string };
type Reference = { tag: string; title: string; code: string | null; outcome: string | null; status: string; approved?: boolean; library?: boolean };
/** COMPETEN-RESEARCH-01: one external record, exactly as the provider returned it. Untagged = further reading only. */
type ExternalRef = { tag: string | null; provider: string; title: string; journal: string | null; year: number | null; authors: string[]; pmid: string | null; doi: string | null; url: string; evidence: boolean; excerpt: string | null; verified: { pmid: boolean; doi: boolean | null } };
type ResearchReply = { state: string; label: string; message: string | null; query?: string | null; scholarLink?: string | null; references: ExternalRef[]; text?: string; cited?: number[]; withheld?: string };
type LearnMode = "notes" | "library" | "research";
const MODE_KEY = "scholar.learn.mode";
const noSubscribe = () => () => {};
const rememberedMode = (): string | null => { try { return window.localStorage.getItem(MODE_KEY); } catch { return null; } };
/** Stage 3 acceptance item 4: an answer withheld as unsupported -- why, and next steps from the notes only. */
type WithheldNext = { why: string; notInNotes: boolean; nearest: { tag: string; chunkId: string; materialId: string; citation: string }[]; rephrase: boolean; background: { text: string; label: string } | null };
type Reply = {
  action: string; answer?: string; withheld?: boolean; message?: string; next?: WithheldNext; sources: Source[]; references: Reference[]; cited?: number[];
  background?: { text?: string; label?: string; withheld?: string } | null; flags?: { text: string; cited: number[] }[];
  verdict?: { value: string; label: string; informal: string } | null; checkQuestion?: string; informal?: string;
  provenance?: { model: string; promptVersion: string }; error?: string;
  /** COMPETEN-RESEARCH-01: external research, kept apart from the notes. */
  research?: ResearchReply | null;
  /** s8: a saved artefact returned instead of a new AI call. */
  saved?: { at: string; reviewStatus: string } | null; savedForLater?: boolean;
  /** SCHOLAR-AI-OPT-01: what learner feedback is about -- the saved explanation, or the action that wrote it. */
  artefactId?: string; actionId?: string;
  /** s7: no new AI now; what is saved for these sections. */
  continuity?: { message: string; insufficient: boolean }; savedList?: Reply[];
};
type Card = { id: number; asked?: string; reply: Reply };
/** AI operating modes: a clarify question put to the student instead of a refusal, and the request to resend if it is for study. */
type Pending = { prompt: ClarifyPrompt; target: "lesson" | "ask" | "assistant"; action?: string; extra?: Record<string, unknown>; asked?: string; question?: string };

async function call(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

export function LearnWorkspace(props: {
  initial: SessionView | null; initialProgress: Record<number, { actions: string[]; verdict: string | null }>; start: StartScope | null;
  actions: LearnAction[]; startAction: LearnAction; labels: Record<LearnAction, string>; consent: boolean; offMessage: string | null;
  checks: "offer" | "prompt" | "off"; depth: "brief" | "standard" | "detailed"; maxTurns: number; materials: { id: string; title: string }[];
  /** s7: when new AI is limited, the plain message from the student's standing. Saved learning stays available. */
  standingMessage?: string | null;
  /** COMPETEN-RESEARCH-01: the Learn modes policy offers. "notes" is always first and the default. */
  modes?: LearnMode[];
}) {
  const [session, setSession] = useState<SessionView | null>(props.initial);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [at, setAt] = useState(props.initial?.currentStep ?? 0);
  const [cards, setCards] = useState<Record<number, Card[]>>({});
  const [busy, setBusy] = useState<string>("");
  const [depth, setDepth] = useState(props.depth);
  // COMPETEN-RESEARCH-01: the learner's own choice, remembered on this device only (a clear saved preference). Notes
  // only unless they choose otherwise; a remembered mode policy no longer offers falls back to notes only.
  const modes = props.modes?.length ? props.modes : (["notes"] as LearnMode[]);
  const remembered = useSyncExternalStore(noSubscribe, rememberedMode, () => null);
  const [chosen, setChosen] = useState<LearnMode | null>(null);
  const pick = (chosen ?? remembered) as LearnMode | null;
  const mode: LearnMode = pick && modes.includes(pick) ? pick : "notes";
  const setMode = (m: LearnMode) => { setChosen(m); try { window.localStorage.setItem(MODE_KEY, m); } catch { /* not remembered */ } };
  const [tab, setTab] = useState<"lesson" | "sources" | "ask">("lesson");
  const [progress, setProgress] = useState(props.initialProgress);
  const [check, setCheck] = useState<{ question: string; answer: string } | null>(null);
  const [ask, setAsk] = useState("");
  const [askThread, setAskThread] = useState<Card[]>([]);
  // Owner D3: the shared personal AI on this step. Its own thread, never mixed into a Learn answer, never saved.
  const [assist, setAssist] = useState<{ id: number; asked: string; answer?: string; error?: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const seq = useRef(0);
  const started = useRef(false);
  const opened = useRef(false);
  const step = session?.steps.find(s => s.step === at) ?? session?.steps[0] ?? null;
  // SCHOLAR-EDU-AI-01 s6: an action whose activity the standing says is not available is shown disabled, with why.
  const aiOf = useAiAvailabilityOf();
  const offReason = (a: string) => { const v = aiOf(a); return v && !v.available ? v.reason : null; };

  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}, target: "lesson" | "ask" = "lesson", asked?: string) => {
    if (!session || !step) return null;
    setBusy(action); setError(""); setPending(null);
    const scopeIds = session.steps.flatMap(s => s.sections.map(x => x.chunkId));
    const r = await call("/api/individual/scholar/learn/act", {
      action, step: step.step, depth, ...(mode !== "notes" && action !== "check" && action !== "clarify" ? { mode } : {}), ...extra,
      ...(session.id ? { sessionId: session.id } : { chunkIds: action === "ask" ? scopeIds : step.sections.map(x => x.chunkId) }),
    });
    setBusy("");
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target, action, extra, asked }); return null; }
    if (!r.ok && !r.json.withheld) { setError(r.json.error ?? "Scholar could not answer just now."); return null; }
    const reply = (r.json.continuity ? { ...r.json, savedList: r.json.saved, saved: null, sources: [], references: [] } : r.json) as Reply;
    const card: Card = { id: ++seq.current, asked, reply };
    if (target === "ask") setAskThread(t => [card, ...t]);
    else setCards(c => ({ ...c, [step.step]: [...(c[step.step] ?? []), card] }));
    if (!r.json.withheld && !r.json.continuity) setProgress(p => ({ ...p, [step.step]: { actions: [...new Set([...(p[step.step]?.actions ?? []), action])], verdict: r.json.verdict?.value ?? p[step.step]?.verdict ?? null } }));
    return r.json as Reply;
  }, [session, step, depth, mode]);
  // Owner D3: the step, handed to the shared personal AI (Teach Me). Shown apart under PERSONAL_AI_LABEL, never saved.
  const continueWithAssistant = useCallback(async (question: string, purpose?: "education") => {
    if (!session || !step) return;
    setBusy("assistant"); setPending(null);
    const r = await call("/api/individual/scholar/learn/assistant", {
      question, mode: "teach", step: step.step, ...(purpose ? { purpose } : {}),
      ...(session.id ? { sessionId: session.id } : { chunkIds: step.sections.map(x => x.chunkId) }),
    });
    setBusy("");
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target: "assistant", question }); return; }
    setAssist(list => [{ id: ++seq.current, asked: question, ...(r.ok ? { answer: String(r.json.answer ?? "") } : { error: r.json.error ?? "Your assistant could not answer just now." }) }, ...list]);
  }, [session, step]);
  // Item 4: a withheld answer's rephrase -- to Ask, with the student's own question back in the box to change.
  const rephrase = useCallback((q: string) => {
    setTab("ask");
    if (q) setAsk(q);
    setTimeout(() => document.getElementById("ask-q")?.focus(), 0);
  }, []);

  // A new scope: start the session, then open it with the policy's starting action (Teach Me by default).
  useEffect(() => {
    if (started.current || !props.start || session) return;
    started.current = true;
    (async () => {
      setBusy("start");
      const r = await call("/api/individual/scholar/learn/sessions", { scope: props.start });
      setBusy("");
      if (!r.ok) { setError(r.json.error ?? "This session could not be started."); return; }
      // SCH-LEARN-UX-01: the address becomes the session's, so a reload or a return resumes it instead of starting again.
      if (r.json.session?.id) try { window.history.replaceState(null, "", `${window.location.pathname}?session=${r.json.session.id}`); } catch { /* the address stays */ }
      if (r.json.resumed) {
        // Already being learned: carried on where it was left, recorded as a resume, nothing generated unasked.
        opened.current = true;
        setProgress(r.json.progress ?? {});
        void call(`/api/individual/scholar/learn/sessions/${r.json.session.id}`, { move: "resume", currentStep: r.json.session.currentStep }, "PATCH");
      }
      setSession(r.json.session); setNote(r.json.note ?? null); setAt(r.json.resumed ? r.json.session.currentStep : 0);
    })();
  }, [props.start, session]);
  useEffect(() => {
    if (opened.current || !session || !props.start || !props.consent) return;
    opened.current = true;
    void act(props.startAction);
  }, [session, props.start, props.consent, props.startAction, act]);
  // A resumed session: recorded as a resume, and waiting for the student (nothing is generated unasked).
  useEffect(() => {
    if (props.initial?.id && !opened.current) { opened.current = true; void call(`/api/individual/scholar/learn/sessions/${props.initial.id}`, { move: "resume", currentStep: props.initial.currentStep }, "PATCH"); }
  }, [props.initial]);

  async function goTo(next: number, move: "skip" | "revisit" | null) {
    if (!session) return;
    setAt(next); setCheck(null); setPending(null); setTab("lesson");
    if (session.id) await call(`/api/individual/scholar/learn/sessions/${session.id}`, { currentStep: next, ...(move ? { move } : {}) }, "PATCH");
  }
  async function finish() {
    if (session?.id) await call(`/api/individual/scholar/learn/sessions/${session.id}`, { status: "completed" }, "PATCH");
    setSession(s => (s ? { ...s, status: "completed" } : s));
  }
  // The student says the clarified question is for study: the SAME request, resent with purpose "education".
  async function answerEducation() {
    const p = pending;
    if (!p) return;
    if (p.target === "assistant") { await continueWithAssistant(p.question ?? "", "education"); return; }
    const r = await act(p.action ?? "", { ...p.extra, purpose: "education" }, p.target, p.asked);
    if (!r) return;
    // SCHOLAR-EDU-AI-01 s6: no new AI (continuity) keeps what the student typed, so they can try again or carry on.
    if (p.action === "ask") { if (!r.continuity) setAsk(""); }
    else if (p.action === "check" && r.checkQuestion) setCheck({ question: r.checkQuestion, answer: "" });
    else if (p.action === "clarify" && !r.error && !r.continuity) setCheck(null);
  }
  async function startCheck() {
    const r = await act("check");
    if (r?.checkQuestion) setCheck({ question: r.checkQuestion, answer: "" });
  }
  async function submitCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!check?.answer.trim()) return;
    const r = await act("clarify", { checkQuestion: check.question, answer: check.answer.trim() }, "lesson", `Your answer: ${check.answer.trim()}`);
    if (r && !r.error && !r.continuity) setCheck(null); // no new AI: the answer stays in the box
  }
  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = ask.trim();
    if (!q) return;
    const history = askThread.slice(0, props.maxTurns).reverse().flatMap(c => [{ speaker: "student", text: c.asked ?? "" }, ...(c.reply.answer ? [{ speaker: "tutor", text: c.reply.answer }] : [])]);
    const r = await act("ask", { question: q, history }, "ask", q);
    if (r && !r.continuity) setAsk(""); // no new AI: the question stays in the box
  }

  if (!session) {
    return (
      <div aria-live="polite" className="rounded-2xl border border-gray-200 bg-white p-6 text-[14px] text-gray-700">
        {error ? <p role="alert" className="font-medium text-red-700">{error}</p> : "Preparing your learning session from your notes…"}
      </div>
    );
  }
  const idx = session.steps.findIndex(s => s.step === at);
  const last = idx === session.steps.length - 1;
  const thread = cards[step?.step ?? -1] ?? [];
  const offerCheck = props.checks !== "off" && props.consent && thread.some(c => c.reply.answer && c.reply.action !== "clarify");
  const panel = (name: typeof tab) => (tab === name ? "block" : "hidden md:block");

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-gray-900">{session.title}</h2>
        <p className="text-[12.5px] text-gray-600">
          {session.recorded ? "Saved: you can leave and resume this session." : (note ?? "Not saved.")}
          {session.coverage && session.coverage.sections < session.coverage.of ? ` Suggested steps cover ${session.coverage.sections} of ${session.coverage.of} sections; ask about any of them.` : ""}
        </p>
      </div>
      {!props.consent && <p className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">{props.offMessage} <Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`}>Go to My Learning</Link></p>}
      {props.standingMessage && (
        <p className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13.5px] text-sky-950">
          {props.standingMessage} Your saved explanations, questions, cards, cases and progress are all still here. <Link href={experienceHref("scholar", "study/saved")} className={`font-semibold underline ${focusRing}`}>Saved learning</Link>
        </p>
      )}
      {error && <p role="alert" className="mb-3 text-[13.5px] font-medium text-red-700">{error}</p>}

      <div role="tablist" aria-label="Workspace" className="mb-3 flex gap-2 md:hidden">
        {(["lesson", "sources", "ask"] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`${chip} ${tab === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800"}`}>{t === "lesson" ? "Lesson" : t === "sources" ? "Sources" : "Ask Scholar"}</button>
        ))}
      </div>

      <div className="md:grid md:grid-cols-[240px_minmax(0,1fr)_300px] md:items-start md:gap-5">
        {/* ── SOURCES: the suggested steps and the student's own sections ── */}
        <aside aria-label="Steps and sources" className={`${panel("sources")} rounded-2xl border border-gray-200 bg-white p-4`}>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Suggested steps</p>
          <ol className="mt-2 space-y-1">
            {session.steps.map((s, i) => (
              <li key={s.step}>
                <button type="button" onClick={() => goTo(s.step, i > idx ? "skip" : i < idx ? "revisit" : null)} aria-current={s.step === at ? "step" : undefined}
                  className={`w-full rounded-lg px-2 py-1.5 text-left text-[13px] ${s.step === at ? "bg-gray-900 text-white" : "text-gray-800 hover:bg-gray-50"} ${focusRing}`}>
                  <span className="font-semibold">{i + 1}.</span> {s.title}
                  {progress[s.step]?.verdict ? <span className={s.step === at ? "text-gray-300" : "text-gray-500"}> · {progress[s.step]!.verdict === "understood" ? "understood" : progress[s.step]!.verdict === "partly" ? "partly" : "not yet"}</span>
                    : progress[s.step]?.actions.length ? <span className={s.step === at ? "text-gray-300" : "text-gray-500"}> · visited</span> : null}
                </button>
              </li>
            ))}
          </ol>
          {step && (
            <>
              <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">This step&apos;s sources</p>
              <ul className="mt-1.5 space-y-1">
                {step.sections.map(x => <li key={x.chunkId}><Link href={sourceHref(x.materialId, x.chunkId)} className={`text-[13px] underline underline-offset-2 ${focusRing}`}>{x.citation}</Link></li>)}
              </ul>
              {/* CLINICAL-REASONING-01 CR1: from Teach Me, a case written from this step's own section. */}
              <p className="mt-3 text-[12.5px]"><Link href={`/individual/scholar/study/apply?section=${step.sections[0].chunkId}&from=teach`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>Practise this in a clinical case</Link></p>
              <p className="mt-3 text-[12px] text-gray-600">Originals: {[...new Map(step.sections.map(x => [x.materialId, x.materialTitle])).entries()].map(([id, t], i) => (
                <span key={id}>{i ? ", " : ""}<a href={`/api/individual/scholar/materials/${id}`} className={`underline ${focusRing}`}>{t}</a></span>
              ))}</p>
            </>
          )}
        </aside>

        {/* ── THE LESSON: the guided cycle, any action, the informal check ── */}
        <section aria-labelledby="lesson-h" className={`${panel("lesson")} rounded-2xl border border-gray-200 bg-white p-4 sm:p-5`}>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Step {idx + 1} of {session.steps.length}</p>
          <h3 id="lesson-h" className="text-[16px] font-bold text-gray-900">{step?.title}</h3>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Ways of learning">
            {props.actions.filter(a => a !== "ask").map(a => (
              <button key={a} type="button" disabled={!!busy || !props.consent || !!offReason(a)} aria-describedby={offReason(a) ? "learn-ai-why" : undefined} onClick={() => act(a)}
                className={`${chip} ${a === "teach" ? "border-transparent text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`} style={a === "teach" ? { background: accent } : undefined}>
                {busy === a ? "Working…" : props.labels[a]}
              </button>
            ))}
            <label className="ml-auto inline-flex items-center gap-1.5 text-[12.5px] text-gray-700">Depth
              <select value={depth} onChange={e => setDepth(e.target.value as typeof depth)} className={`rounded-lg border border-gray-300 px-2 py-1 text-[13px] ${focusRing}`}>
                <option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option>
              </select>
            </label>
          </div>
          {(() => {
            const off = props.actions.filter(a => a !== "ask" && offReason(a));
            return props.consent && off.length > 0 && (
              <p id="learn-ai-why" className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">
                <span className="font-semibold">Not available yet: {off.map(a => props.labels[a]).join(", ")}.</span> {aiReasonCopy(offReason(off[0])!, "scholar").text}
              </p>
            );
          })()}

          {modes.length > 1 && (
            <fieldset className="mt-3 rounded-xl border border-gray-200 px-3 py-2">
              <legend className="px-1 text-[12px] font-bold text-gray-700">Learn from</legend>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Learn from">
                {modes.map(m => (
                  <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={!!busy} onClick={() => setMode(m)}
                    className={`${chip} ${mode === m ? "border-transparent text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`} style={mode === m ? { background: accent } : undefined}>
                    {LEARN_MODE_LABEL[m]}
                  </button>
                ))}
              </div>
              {mode === "research" && <p className="mt-1.5 text-[12px] text-gray-600">Scholar searches published research (PubMed, OpenAlex) for this topic. Only a few topic words are sent, never your notes or who you are. What it finds is shown apart from your notes, with its real source.</p>}
              {mode === "library" && <p className="mt-1.5 text-[12px] text-gray-600">Adds the Competen library entries that match this topic, labelled as library.</p>}
            </fieldset>
          )}

          {pending?.target === "lesson" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-4" onEducation={() => void answerEducation()} />}
          <div aria-live="polite" className="mt-4 space-y-4">
            {thread.length === 0 && !busy && pending?.target !== "lesson" && <p className="text-[13.5px] text-gray-600">{props.consent ? `Choose ${props.labels[props.startAction]} to begin this step, or ask Scholar anything.` : "Learning needs AI help, which is off."}</p>}
            {thread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} onFresh={c.reply.saved && props.consent ? () => act(c.reply.action, { fresh: true }) : undefined}
              onRephrase={props.actions.includes("ask") ? () => rephrase("") : undefined} />)}
            {busy && busy !== "ask" && <p className="text-[13px] text-gray-500">{mode === "research" ? "Scholar is reading your notes and searching published research…" : "Scholar is reading your notes…"}</p>}
          </div>

          {check && (
            <form onSubmit={submitCheck} className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
              <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-violet-900">Check your understanding</p>
              <p className="mt-1 text-[14.5px] font-semibold text-gray-900">{check.question}</p>
              <label htmlFor="check-answer" className="mt-2 block text-[12.5px] font-semibold text-gray-700">Your answer</label>
              <textarea id="check-answer" rows={3} maxLength={QUESTION_MAX} value={check.answer} onChange={e => setCheck({ ...check, answer: e.target.value })}
                className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
              <p className="mt-1 text-[12px] text-gray-600">{INFORMAL_CHECK_LABEL}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !check.answer.trim()}>{busy === "clarify" ? "Checking…" : "Check my answer"}</button>
                <button type="button" className={ghost} onClick={() => setCheck(null)}>Skip the check</button>
              </div>
            </form>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
            {offerCheck && !check && (
              <button type="button" className={props.checks === "prompt" ? btn : ghost} style={props.checks === "prompt" ? { background: accent } : undefined} disabled={!!busy || !!offReason("check")} aria-describedby={offReason("check") ? "learn-check-why" : undefined} onClick={startCheck}>
                {busy === "check" ? "Writing a check…" : "Check my understanding"}
              </button>
            )}
            {offerCheck && !check && offReason("check") && <p id="learn-check-why" className="order-last w-full text-[12.5px] text-gray-600">{aiReasonCopy(offReason("check")!, "scholar").text}</p>}
            {idx > 0 && <button type="button" className={ghost} onClick={() => goTo(session.steps[idx - 1].step, "revisit")}>Previous step</button>}
            {!last ? <button type="button" className={ghost} onClick={() => goTo(session.steps[idx + 1].step, thread.length ? null : "skip")}>{thread.length ? "Continue" : "Skip this step"}</button>
              : session.status !== "completed" && <button type="button" className={ghost} onClick={finish}>Finish session</button>}
            {session.status === "completed" && <span className="text-[13px] font-semibold text-emerald-800">Session completed. You can still revisit any step.</span>}
          </div>
        </section>

        {/* ── THE SCHOLAR ASSISTANT: ask anything about these notes, at any point ── */}
        <aside aria-labelledby="ask-h" className={`${panel("ask")} rounded-2xl border border-gray-200 bg-white p-4`}>
          <h3 id="ask-h" className="text-[14px] font-bold text-gray-900">Ask Scholar</h3>
          <p className="mt-0.5 text-[12.5px] text-gray-600">About anything in this session&apos;s notes. Answers cite the section they came from.</p>
          {props.actions.includes("ask") ? (
            <form onSubmit={submitAsk} className="mt-2">
              <label htmlFor="ask-q" className="sr-only">Your question</label>
              <textarea id="ask-q" rows={2} maxLength={QUESTION_MAX} value={ask} onChange={e => setAsk(e.target.value)} placeholder="For example: why is oxygen given to a target range?"
                className={`w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} disabled={!props.consent} />
              <button type="submit" className={`${ghost} mt-2`} disabled={!!busy || !ask.trim() || !props.consent || !!offReason("ask")} aria-describedby={offReason("ask") ? "learn-ask-why" : undefined}>{busy === "ask" ? "Reading your notes…" : "Ask"}</button>
              {props.consent && offReason("ask") && <p id="learn-ask-why" className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">{aiReasonCopy(offReason("ask")!, "scholar").text}</p>}
            </form>
          ) : <p className="mt-2 text-[13px] text-gray-600">Asking is switched off here.</p>}
          {pending?.target === "ask" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-3" onEducation={() => void answerEducation()} />}
          <div aria-live="polite" className="mt-3 space-y-3">
            {askThread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} compact onRephrase={() => rephrase(c.asked ?? "")} />)}
          </div>
          {props.consent && step && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <button type="button" className={ghost} disabled={!!busy} onClick={() => void continueWithAssistant(ask.trim() || `Teach me: ${step.title}`)}>
                {busy === "assistant" ? "Asking your assistant…" : "Continue with your personal assistant"}
              </button>
              <p className="mt-1 text-[12px] text-gray-600">Your general personal AI, given this step&apos;s sections. Its answers are not checked against your notes.</p>
              {pending?.target === "assistant" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-3" onEducation={() => void answerEducation()} />}
              <div aria-live="polite" className="mt-3 space-y-3">
                {assist.map(a => (
                  <article key={a.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3">
                    <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{PERSONAL_AI_LABEL}</p>
                    <p className="mt-1 text-[12.5px] text-gray-600"><span className="font-semibold">You:</span> {a.asked}</p>
                    {a.error ? <p className="mt-1 text-[13px] text-red-800">{a.error}</p> : <div className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{a.answer}</div>}
                  </article>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

/** Stage 3 acceptance item 4: a withheld answer says why, and offers only what comes from the student's own notes. */
function Withheld({ r, asked, onRephrase }: { r: Reply; asked?: string; onRephrase?: () => void }) {
  const n = r.next;
  if (!n) return <p className="mt-1.5 rounded-lg bg-gray-50 px-3 py-2 text-[14px] text-gray-800">{r.message}</p>;
  return (
    <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
      {n.notInNotes && <p className="text-[14.5px] font-semibold text-gray-900">{NOT_IN_NOTES_LABEL}</p>}
      <p className="text-[14px] text-gray-800">{n.why}</p>
      <p className="mt-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-600">What you can do</p>
      <ul className="mt-1 list-disc space-y-1.5 pl-5 text-[13.5px] text-gray-800">
        {n.nearest.length > 0 && (
          <li>Read the parts of your notes nearest {asked ? "your question" : "this step"}:
            <ul className="mt-0.5 space-y-0.5">{n.nearest.map(s => (
              <li key={s.chunkId}><Link href={sourceHref(s.materialId, s.chunkId)} className={`underline underline-offset-2 ${focusRing}`}>{s.citation}</Link></li>
            ))}</ul>
          </li>
        )}
        {n.rephrase && onRephrase && (
          <li><button type="button" onClick={onRephrase} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{asked ? "Rephrase your question" : "Ask about it in your own words"}</button></li>
        )}
        {n.notInNotes && <li>If your course covers it, add the material that does, then ask again.</li>}
      </ul>
      {n.background && (
        <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-sky-900">{SOURCE_KIND_LABEL.interpretation}</p>
          <p className="mt-1 text-[13.5px] text-gray-800">{n.background.text}</p>
        </div>
      )}
    </div>
  );
}

/** One reply, its four kinds of content kept apart and labelled (owner GO s7). */
function ReplyCard({ card, labels, compact = false, onFresh, onRephrase }: { card: Card; labels: Record<LearnAction, string>; compact?: boolean; onFresh?: () => void; onRephrase?: () => void }) {
  const r = card.reply;
  if (r.continuity) {
    return (
      <article className="rounded-xl border border-sky-200 bg-sky-50/60 p-4">
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">No new AI answer right now</p>
        <p className="mt-1 text-[14px] text-gray-800">{r.continuity.message}</p>
        {r.savedList?.length ? (
          <div className="mt-3 space-y-3">
            <p className="text-[13px] font-semibold text-gray-800">What you saved for these sections:</p>
            {r.savedList.map((s, i) => <ReplyCard key={i} card={{ id: i, reply: s }} labels={labels} compact />)}
          </div>
        ) : <p className="mt-2 text-[13px] text-gray-600">Nothing is saved for these sections yet. Your notes, questions, cards and progress are still available.</p>}
      </article>
    );
  }
  const name = r.action === "clarify" ? "Clarification" : r.action === "check" ? "Check question" : labels[r.action as LearnAction] ?? r.action;
  if (r.action === "check" && r.checkQuestion) return null; // shown in the check form
  const cited = new Set(r.cited ?? []);
  return (
    <article className={`rounded-xl border border-gray-200 ${compact ? "p-3" : "p-4"}`}>
      {card.asked && <p className="mb-1 text-[12.5px] text-gray-600"><span className="font-semibold">You:</span> {card.asked}</p>}
      <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-500">{name}</p>
      {r.withheld ? <Withheld r={r} asked={card.asked} onRephrase={onRephrase} /> : (
        <>
          {r.verdict && (
            <p className="mt-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-[13px] text-violet-950">
              <span className="font-semibold">{r.verdict.label}.</span> {r.verdict.informal}
            </p>
          )}
          {r.verdict && (
            <FormativeAiLabel className="mt-1" />
          )}
          <div className="mt-2"><AiBadge /></div>
          <p className="mt-2 text-[11.5px] font-bold uppercase tracking-[0.1em] text-gray-500">{SOURCE_KIND_LABEL.notes}</p>
          <div className="mt-1 whitespace-pre-wrap text-[14.5px] leading-relaxed text-gray-800">{r.answer}</div>
        </>
      )}
      {r.sources.length > 0 && !r.next && (
        <ul className="mt-2 space-y-0.5">
          {r.sources.filter((_, i) => !r.answer || cited.has(i + 1)).map(s => (
            <li key={s.tag} className="text-[12.5px] text-gray-700"><span className="font-mono font-bold" style={{ color: accent }}>[{s.tag}]</span>{" "}
              <Link href={sourceHref(s.materialId, s.chunkId)} className={`underline underline-offset-2 ${focusRing}`}>{s.citation}</Link></li>
          ))}
        </ul>
      )}
      {!r.withheld && r.references.length > 0 && r.answer && /\[R\d+\]/.test(r.answer) && (
        <GovernedReferenceList refs={r.references.filter(x => r.answer!.includes(`[${x.tag}]`))} />
      )}
      {r.background && (
        r.background.text ? (
          <div className="mt-2 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-sky-900">{SOURCE_KIND_LABEL.interpretation}</p>
            <p className="mt-1 text-[13.5px] text-gray-800">{r.background.text}</p>
          </div>
        ) : r.background.withheld ? <p className="mt-2 text-[12.5px] text-gray-600">{r.background.withheld}</p> : null
      )}
      {r.research && <ResearchBlock x={r.research} />}
      {r.flags && r.flags.length > 0 && <AiFlagList flags={r.flags} />}
      {r.saved && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
          <span>Saved {new Date(r.saved.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · private, for your own study · no new AI was used</span>
          {onFresh && <button type="button" onClick={onFresh} className={`rounded-lg border border-gray-300 bg-white px-2 py-0.5 font-semibold text-gray-800 hover:bg-gray-50 ${focusRing}`}>Explain it a new way</button>}
        </p>
      )}
      {r.savedForLater && <p className="mt-2 text-[12px] text-gray-500">Saved to your learning, so you can come back to it without using AI again.</p>}
      {r.provenance && <p className="mt-2 text-[11px] text-gray-400">Model {r.provenance.model} · prompt {r.provenance.promptVersion}</p>}
      {!r.withheld && r.answer && r.action !== "check" && !compact && (
        <AiFeedback kind="explanation" target={r.artefactId ? "artefact" : "action"} refId={r.artefactId ?? r.actionId} />
      )}
    </article>
  );
}

/** COMPETEN-RESEARCH-01: external research, apart from the notes, labelled, every record with its real link. */
/**
 * RESEARCH-02: two lists that never mix. "Sources cited" appears only beside a SHOWN research summary and holds exactly
 * the records it cites. Everything else the server returned -- all of it identity-verified (learn-research.ts) -- is
 * "Further reading": listed, linked, never presented as support for an answer. So a withheld summary still leaves the
 * verified sources in view, and no message says they are there unless they are.
 */
function ResearchBlock({ x }: { x: ResearchReply }) {
  const cited = new Set(x.cited ?? []);
  const support = x.text ? x.references.filter(r => r.tag && (!x.cited || cited.has(Number(r.tag.slice(1))))) : [];
  const further = x.references.filter(r => !support.includes(r));
  return (
    <section aria-label="External research" className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/70 px-3 py-2.5">
      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{x.label}</p>
      {x.text && <div className="mt-1 whitespace-pre-wrap text-[14px] leading-relaxed text-gray-800">{x.text}</div>}
      {x.withheld && <p className="mt-1 text-[13px] text-gray-700">{x.withheld}</p>}
      {x.message && <p className="mt-1 text-[13px] text-gray-700">{x.message}</p>}
      {support.length > 0 && (
        <div className="mt-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-indigo-900">Sources cited in this research summary</p>
          <ul className="mt-1 space-y-2">{support.map(r => <li key={r.url}><ExternalRefLine r={r} /></li>)}</ul>
        </div>
      )}
      {further.length > 0 && (
        <div className="mt-3 border-t border-indigo-200 pt-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-gray-700">Further reading ({further.length})</p>
          <p className="text-[12px] text-gray-600">{x.text ? "Other verified sources found for this topic. They do not support the summary above." : "Verified sources found for this topic. No research summary is shown, so none of these supports an answer."}</p>
          <ul className="mt-1 space-y-2">{further.map(r => <li key={r.url}><ExternalRefLine r={{ ...r, tag: null, excerpt: null }} /></li>)}</ul>
        </div>
      )}
      {x.scholarLink && (
        <p className="mt-2 text-[12px] text-gray-700">
          <a href={x.scholarLink} target="_blank" rel="noopener noreferrer" className={`font-semibold underline underline-offset-2 ${focusRing}`}>Search Google Scholar for this topic</a> (opens Google Scholar; Competen does not search it)
        </p>
      )}
    </section>
  );
}

function ExternalRefLine({ r }: { r: ExternalRef }) {
  const ids = [r.pmid ? { label: `PMID ${r.pmid}`, href: `https://pubmed.ncbi.nlm.nih.gov/${r.pmid}/` } : null, r.doi ? { label: `DOI ${r.doi}`, href: `https://doi.org/${r.doi}` } : null].filter((v): v is { label: string; href: string } => !!v);
  const checked = [r.verified.pmid ? "PMID from PubMed" : null, r.verified.doi === true ? "DOI confirmed by Crossref" : null].filter(Boolean).join(" · ");
  return (
    <div className="text-[12.5px] text-gray-800">
      {r.tag && <span className="mr-1 font-mono font-bold text-indigo-900">[{r.tag}]</span>}
      <a href={r.url} target="_blank" rel="noopener noreferrer" className={`font-semibold underline underline-offset-2 ${focusRing}`}>{r.title}</a>
      <span className="text-gray-700">{r.authors.length ? ` ${r.authors.join(", ")}${r.authors.length >= 3 ? " et al." : ""}.` : ""}{r.journal ? ` ${r.journal}` : ""}{r.year ? ` (${r.year})` : ""}. Found via {r.provider}.</span>
      {ids.length > 0 && <span> {ids.map((i, n) => <span key={i.href}>{n ? " · " : ""}<a href={i.href} target="_blank" rel="noopener noreferrer" className={`underline ${focusRing}`}>{i.label}</a></span>)}</span>}
      {checked && <span className="block text-[11.5px] text-gray-600">Verified: {checked}</span>}
      {r.excerpt && <span className="mt-0.5 block text-[12px] italic text-gray-700">Abstract excerpt: {r.excerpt}</span>}
    </div>
  );
}
