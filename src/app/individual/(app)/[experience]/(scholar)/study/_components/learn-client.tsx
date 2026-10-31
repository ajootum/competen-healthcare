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
import { RecoveryFlow, type Expansion, type ExplainOutcome, type RecoveryRequestBody } from "./evidence-recovery";
import {
  EXPANSION_LABEL, GUIDED_KEY, LessonRequests, expansionChoices, groupActions, guidedValue, isGuided, isOpenable, lessonKey, lessonPhase, preparingText, shouldAutoTeach,
  type LearnMode, type LessonSettings,
} from "@/lib/individual/scholar/guided-learn";
import { LEARN_NOT_COVERED_LABEL, LEARN_NOT_COVERED_NOTE, LEARN_WIDER_LABEL, RECOVERY_EXPLANATION_LABEL, RECOVERY_NOT_USED_LABEL } from "@/lib/individual/scholar/config";
import type { ReadingLink } from "@/lib/individual/scholar/evidence-recovery";
import { STUDY_EVENT } from "./study-active";
import { citationSegments, citedTags, parseTeachAnswer, questionText, replyState, type LearnGrounding } from "@/lib/individual/scholar/teach-format";

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

/** `excerpt`: the start of the section, shown only behind "View sources" (absent on some older replies). */
type Source = { tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string; excerpt?: string };
type Reference = { tag: string; title: string; code: string | null; outcome: string | null; status: string; approved?: boolean; library?: boolean };
/** COMPETEN-RESEARCH-01: one external record, exactly as the provider returned it. Untagged = further reading only. */
type ExternalRef = { tag: string | null; provider: string; title: string; journal: string | null; year: number | null; authors: string[]; pmid: string | null; doi: string | null; url: string; evidence: boolean; excerpt: string | null; verified: { pmid: boolean; doi: boolean | null };
  /** SCHOLAR-SOURCE-QUALITY-01: why it is reading only (absent on answers saved before it). */
  notUsed?: keyof typeof RECOVERY_NOT_USED_LABEL | null };
type ResearchReply = { state: string; label: string; message: string | null; query?: string | null; scholarLink?: string | null; references: ExternalRef[]; text?: string; cited?: number[]; withheld?: string };
const MODE_KEY = "scholar.learn.mode";
const noSubscribe = () => () => {};
const rememberedMode = (): string | null => { try { return window.localStorage.getItem(MODE_KEY); } catch { return null; } };
// SCHOLAR-GUIDED-LEARNING-01: Guided (the default) or Manual, on this device (guided-learn.ts says why not the 414 row).
const rememberedGuided = (): string | null => { try { return window.localStorage.getItem(GUIDED_KEY); } catch { return null; } };
const ACT_URL = "/api/individual/scholar/learn/act";
const requestId = () => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } };
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
  reason?: string;
  /** SCHOLAR-SQIE-02: an answer asked for from the learning resources found after a withheld one. */
  recovered?: { shown: boolean; label: string; unanswered: string[]; reading: ReadingLink[] };
  /** SCHOLAR-LEARN-FIX-01: the lesson this answer teaches, and how well its passages hold the lesson's key terms (absent on older replies). */
  lesson?: { title: string; objective: string } | null;
  grounding?: (LearnGrounding & { related?: { sameMaterial: number; otherMaterials: number } }) | null;
  /** SCHOLAR-GUIDED-LEARNING-01: a lesson shown with its unsupported statements left out (a count, never which). */
  salvage?: { removed: number; note: string } | null;
  cached?: boolean;
};
/** `extra` and `target`: the request as it was made, so "Explain using approved references" can make it again. */
type Card = { id: number; asked?: string; reply: Reply; extra?: Record<string, unknown>; target?: "lesson" | "ask" };
type Recover = { request: RecoveryRequestBody; explain: (rec: { id: string; mode: RecoveryRequestBody["mode"]; question: string }) => Promise<ExplainOutcome> };
/** AI operating modes: a clarify question put to the student instead of a refusal, and the request to resend if it is for study. */
type Pending = { prompt: ClarifyPrompt; target: "lesson" | "ask" | "assistant"; action?: string; extra?: Record<string, unknown>; asked?: string; question?: string };

async function call(url: string, body: unknown, method = "POST", headers: Record<string, string> = {}): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
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
  /** SCHOLAR-SESSION-AI-02: start the scope as a connected study session (the server decides whether it may). */
  connect?: boolean;
  /** SCHOLAR-SESSION-AI-02: the learner's own typed objective for a study session whose focus has no competency outcome (D2). */
  objectiveText?: string;
  /** SCHOLAR-SESSION-AI-02: opened from the study session bar's Ask: the Ask panel first. */
  openAsk?: boolean;
  /** SCHOLAR-GUIDED-LEARNING-01: policy scholar_learn_prepare_next (default off). Off: no prepare request is ever made. */
  prepareNext?: boolean;
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
  const [tab, setTab] = useState<"lesson" | "sources" | "ask">(props.openAsk ? "ask" : "lesson");
  const [progress, setProgress] = useState(props.initialProgress);
  const [check, setCheck] = useState<{ question: string; answer: string } | null>(null);
  const [ask, setAsk] = useState("");
  const [askThread, setAskThread] = useState<Card[]>([]);
  // Owner D3: the shared personal AI on this step. Its own thread, never mixed into a Learn answer, never saved.
  const [assist, setAssist] = useState<{ id: number; asked: string; answer?: string; error?: string }[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  // SCHOLAR-GUIDED-LEARNING-01: Guided by default (opening a lesson teaches it); Manual is the learner's own choice.
  const rememberedG = useSyncExternalStore(noSubscribe, rememberedGuided, () => null);
  const [chosenGuided, setChosenGuided] = useState<boolean | null>(null);
  const guided = chosenGuided ?? isGuided(rememberedG);
  const setGuided = (on: boolean) => { setChosenGuided(on); try { window.localStorage.setItem(GUIDED_KEY, guidedValue(on)); } catch { /* this visit only */ } };
  const requests = useRef(new LessonRequests());
  /** Lessons being opened or written, by lesson key: the progress line shows for the step the learner is on. */
  const [loading, setLoading] = useState<Record<string, { step: number; mode: LearnMode }>>({});
  /** A lesson that could not be opened (or a duplicate twin asked to wait): said plainly, with Try again. */
  const [lessonNote, setLessonNote] = useState<Record<number, { message: string; settings: LessonSettings }>>({});
  /** The settings each step's lesson was last taught with (Lesson settings offers to teach it again with new ones). */
  const [taught, setTaught] = useState<Record<number, LessonSettings>>({});
  const seq = useRef(0);
  const started = useRef(false);
  const opened = useRef(false);
  /** A new scope in Manual: its first lesson is still opened once, as it always was. */
  const firstLesson = useRef(false);
  const step = session?.steps.find(s => s.step === at) ?? session?.steps[0] ?? null;
  // SCHOLAR-EDU-AI-01 s6: an action whose activity the standing says is not available is shown disabled, with why.
  const aiOf = useAiAvailabilityOf();
  const offReason = useCallback((a: string) => { const v = aiOf(a); return v && !v.available ? v.reason : null; }, [aiOf]);
  // The latest shown Teach Me answer's check questions that cite only this step's own sections (see startCheck).
  const ownIds = new Set(step?.sections.map(x => x.chunkId) ?? []);
  const answerable = (r: Reply, q: string) => { const tags = citedTags(q); return tags.length > 0 && tags.every(n => ownIds.has(r.sources.find(s => s.tag === `S${n}`)?.chunkId ?? "")); };
  const lastTeach = [...(cards[step?.step ?? -1] ?? [])].reverse().find(c => c.reply.action === "teach" && !!c.reply.answer && !c.reply.withheld);
  const teachQuestions = lastTeach ? (parseTeachAnswer(lastTeach.reply.answer!)?.questions ?? []).filter(q => answerable(lastTeach.reply, q)) : [];

  // One request body for every Learn action: the step, its depth and (beyond notes) its Learn-from mode, and the
  // session by id (or, held in the browser, its sections).
  const bodyFor = useCallback((st: NonNullable<typeof step>, action: string, s: LessonSettings, extra: Record<string, unknown> = {}) => {
    if (!session) return {};
    const scopeIds = session.steps.flatMap(x => x.sections.map(y => y.chunkId));
    return {
      action, step: st.step, depth: s.depth, ...(s.mode !== "notes" && action !== "check" && action !== "clarify" ? { mode: s.mode } : {}), ...extra,
      ...(session.id ? { sessionId: session.id } : { chunkIds: action === "ask" ? scopeIds : st.sections.map(x => x.chunkId) }),
    };
  }, [session]);
  // A reply into its own step's thread (or the Ask thread), and the step's progress. A reply that arrives after the
  // learner moved on still belongs to the step it teaches, so going back shows it (no second AI call).
  const record = useCallback((stepNo: number, json: Record<string, any>, action: string, extra: Record<string, unknown> | undefined, target: "lesson" | "ask", asked?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const reply = (json.continuity ? { ...json, savedList: json.saved, saved: null, sources: [], references: [] } : json) as Reply;
    const card: Card = { id: ++seq.current, asked, reply, extra, target };
    if (target === "ask") setAskThread(t => [card, ...t]);
    else setCards(c => ({ ...c, [stepNo]: [...(c[stepNo] ?? []), card] }));
    if (!json.withheld && !json.continuity) setProgress(p => ({ ...p, [stepNo]: { actions: [...new Set([...(p[stepNo]?.actions ?? []), action])], verdict: json.verdict?.value ?? p[stepNo]?.verdict ?? null } }));
    return reply;
  }, []);

  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}, target: "lesson" | "ask" = "lesson", asked?: string) => {
    if (!session || !step) return null;
    setBusy(action); setError(""); setPending(null);
    const s: LessonSettings = { mode: (extra.mode as LearnMode | undefined) ?? mode, depth };
    const r = await call(ACT_URL, bodyFor(step, action, { mode, depth }, extra));
    setBusy("");
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target, action, extra, asked }); return null; }
    if (!r.ok && !r.json.withheld) { setError(r.json.error ?? "Scholar could not answer just now."); return null; }
    record(step.step, r.json, action, extra, target, asked);
    if (target === "lesson" && action === props.startAction) setTaught(t => ({ ...t, [step.step]: s }));
    return r.json as Reply;
  }, [session, step, depth, mode, bodyFor, record, props.startAction]);

  // SCHOLAR-GUIDED-LEARNING-01: OPEN A LESSON. First open:true -- a saved lesson comes back at once with no AI; only
  // when nothing is saved (or its twin is being written) is the same request sent as a Teach, which the route dedupes.
  // One request per lesson key at a time; a reply for a lesson the learner has left goes to its own step, quietly.
  const teachLesson = useCallback(async (stepNo: number, s: LessonSettings) => {
    if (!session) return;
    const st = session.steps.find(x => x.step === stepNo);
    if (!st) return;
    const action = props.startAction, k = lessonKey(session.id ?? session.title, stepNo, action, s);
    if (!requests.current.begin(k)) return;
    setLoading(l => ({ ...l, [k]: { step: stepNo, mode: s.mode } }));
    setLessonNote(n => { const rest = { ...n }; delete rest[stepNo]; return rest; });
    const body = bodyFor(st, action, s);
    try {
      let r = await call(ACT_URL, { ...body, open: true });
      let phase = lessonPhase("open", r.ok, r.json);
      if (phase.kind === "generate") {
        // The learner moved on while it was being opened: nothing is written for a lesson they skipped past.
        if (!requests.current.isCurrent(k)) { requests.current.release(k); return; }
        // AI not available now: nothing is generated; the lesson's "Not available yet" line says why.
        if (offReason(action)) return;
        r = await call(ACT_URL, body);
        phase = lessonPhase("generate", r.ok, r.json);
      }
      const prompt = r.ok ? null : clarifyFrom(r.json);
      if (prompt) { if (requests.current.isCurrent(k)) setPending({ prompt, target: "lesson", action, extra: {} }); return; }
      if (phase.kind === "error" || phase.kind === "retry") { setLessonNote(n => ({ ...n, [stepNo]: { message: phase.message, settings: s } })); return; }
      if (phase.kind === "show") { record(stepNo, r.json, action, {}, "lesson"); setTaught(t => ({ ...t, [stepNo]: s })); }
    } finally {
      requests.current.end(k);
      setLoading(l => { const rest = { ...l }; delete rest[k]; return rest; });
    }
  }, [session, props.startAction, bodyFor, record, offReason]);
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
  // SCHOLAR-SQIE-02: a withheld answer offers evidence recovery beneath it, in the learner's own source mode. "Explain
  // using approved references" makes the SAME request again (same action, same question) with only the recovery's id,
  // mode and question; the server finds the evidence again and runs the same checks. Nothing the student typed is cleared.
  const recoveryMode = (): RecoveryRequestBody["mode"] => (mode === "research" ? "notes_and_references" : mode === "library" ? "notes_and_library" : "notes_only");
  const recoverFor = (c: Card): Recover | undefined => {
    const r = c.reply;
    if (!r.withheld || r.recovered || r.action === "check" || r.action === "clarify" || !step) return undefined;
    return recovery(c, recoveryMode(), c.asked || step.title || "", r.reason ?? null);
  };
  // SCHOLAR-LEARN-FIX-01 L-B: a partly grounded answer that WAS shown offers the next wider tier the server named
  // (grounding.wider), for the terms the notes did not cover -- the same evidence recovery, asked for by the learner.
  const widerFor = (c: Card): Recover | undefined => {
    const r = c.reply, g = r.grounding;
    if (replyState(r) !== "partial" || !g?.wider || r.recovered || !step) return undefined;
    return recovery(c, g.wider as RecoveryRequestBody["mode"], g.uncoveredTerms.join(" "), null);
  };
  const recovery = (c: Card, recMode: RecoveryRequestBody["mode"], question: string, withheldReason: string | null): Recover | undefined => {
    const r = c.reply;
    if (!step || !session) return undefined;
    const first = step.sections[0];
    return {
      // SCHOLAR-LEARN-FIX-01: the session's selected materials scope My notes only (a recorded session by id, read on the server).
      request: { question: question.slice(0, QUESTION_MAX), mode: recMode, materialId: first?.materialId ?? null, sectionId: first?.chunkId ?? null, withheldReason,
        ...(session.id ? { sessionId: session.id } : { materialIds: [...new Set(session.steps.flatMap(s => s.sections.map(x => x.materialId)))].slice(0, 10) }) },
      explain: async rec => {
        const x = await act(r.action, { ...(c.extra ?? {}), recovery: rec }, c.target ?? "lesson", c.asked);
        if (!x) return { error: "Scholar could not explain this just now. Try again shortly." };
        if (x.withheld || x.continuity) return { shown: false, message: x.continuity?.message ?? null, unanswered: x.recovered?.unanswered, reading: x.recovered?.reading };
        return { shown: true };
      },
    };
  };
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
      const r = await call("/api/individual/scholar/learn/sessions", { scope: props.start, ...(props.connect ? { connected: true, ...(props.objectiveText ? { objectiveText: props.objectiveText } : {}) } : {}) });
      setBusy("");
      if (!r.ok) { setError(r.json.error ?? "This session could not be started."); return; }
      // SCH-LEARN-UX-01: the address becomes the session's, so a reload or a return resumes it instead of starting again.
      // SCHOLAR-SESSION-AI-02: a study session also carries ?study=, and the tab bar shows its session bar at once.
      const study = r.json.study?.id && r.json.study.id === r.json.session?.id ? r.json.study : null;
      if (r.json.session?.id) try { window.history.replaceState(null, "", `${window.location.pathname}?session=${r.json.session.id}${study ? `&study=${study.id}` : ""}`); } catch { /* the address stays */ }
      if (study) try { window.dispatchEvent(new CustomEvent(STUDY_EVENT, { detail: study })); } catch { /* the bar shows on the next page */ }
      if (r.json.resumed) {
        // Already being learned: carried on where it was left, recorded as a resume, nothing generated unasked.
        opened.current = true;
        setProgress(r.json.progress ?? {});
        void call(`/api/individual/scholar/learn/sessions/${r.json.session.id}`, { move: "resume", currentStep: r.json.session.currentStep }, "PATCH");
      }
      setSession(r.json.session); setNote(r.json.note ?? null); setAt(r.json.resumed ? r.json.session.currentStep : 0);
    })();
  }, [props.start, props.connect, props.objectiveText, session]);
  useEffect(() => {
    if (opened.current || !session || !props.start || !props.consent) return;
    opened.current = true;
    // Guided: the lesson effect below opens every lesson. Manual: it opens this first one only, as before (saved first now).
    firstLesson.current = true;
  }, [session, props.start, props.consent]);
  // SCHOLAR-GUIDED-LEARNING-01: GUIDED BY DEFAULT. Opening a lesson -- the first load, a resume, a step chosen, Next
  // lesson -- opens it (saved -> shown with no AI) and, if nothing is saved, teaches it. Never twice by itself, never
  // over a lesson already in the thread, never in Manual, and never the next lesson: moving on is the learner's act.
  // The preference is read from the device here (not only from state), so a Manual learner's first render cannot teach.
  const stepNo = step?.step ?? null;
  useEffect(() => {
    if (!session || stepNo === null) return;
    const s: LessonSettings = { mode, depth };
    const k = lessonKey(session.id ?? session.title, stepNo, props.startAction, s);
    const has = (cards[stepNo] ?? []).some(c => c.target !== "ask" && c.reply.action === props.startAction);
    if (!shouldAutoTeach({ guided: firstLesson.current || (chosenGuided ?? isGuided(rememberedGuided())), consent: props.consent, startAction: props.startAction, actions: props.actions,
      hasLesson: has, asked: requests.current.wasAsked(k), inFlight: requests.current.pending(k) })) return;
    firstLesson.current = false;
    void teachLesson(stepNo, s);
  }, [session, stepNo, mode, depth, cards, chosenGuided, props.consent, props.startAction, props.actions, teachLesson]);
  // Prepare-next (policy scholar_learn_prepare_next, default OFF: then no request is made at all). Once a lesson is
  // shown, the NEXT one only -- never further -- once per lesson key, with its own request id. The route decides the rest.
  useEffect(() => {
    if (!props.prepareNext || !props.consent || !session?.id || stepNo === null) return;
    const i = session.steps.findIndex(x => x.step === stepNo);
    if (i < 0 || i >= session.steps.length - 1) return;
    if (!(cards[stepNo] ?? []).some(c => c.target !== "ask" && c.reply.action === "teach" && !!c.reply.answer && !c.reply.withheld)) return;
    if (!requests.current.claimPrepare(lessonKey(session.id, stepNo, "teach", { mode, depth }))) return;
    void call(ACT_URL, { action: "teach", sessionId: session.id, step: stepNo, depth, ...(mode !== "notes" ? { mode } : {}), prepare: true }, "POST", { "x-request-id": requestId() });
  }, [props.prepareNext, props.consent, session, stepNo, cards, mode, depth]);
  // A resumed session: recorded as a resume, and waiting for the student (nothing is generated unasked).
  useEffect(() => {
    if (props.initial?.id && !opened.current) { opened.current = true; void call(`/api/individual/scholar/learn/sessions/${props.initial.id}`, { move: "resume", currentStep: props.initial.currentStep }, "PATCH"); }
  }, [props.initial]);

  async function goTo(next: number, move: "skip" | "revisit" | null) {
    if (!session) return;
    requests.current.focus(null); // a reply still on its way for the lesson being left is no longer the current one
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
  // SCHOLAR-LEARN-FIX-01 L-B: Check my understanding answers a question the Teach Me answer already wrote and the engine
  // checked (teach-format.ts), when it cites only this step's own sections -- the clarification is judged against exactly
  // those. Otherwise the existing check action writes one. Either way the answer goes to clarify, which records the verdict.
  async function startCheck(q?: string) {
    const own = q ?? teachQuestions[0];
    if (own) {
      setCheck({ question: questionText(own), answer: "" });
      setTimeout(() => document.getElementById("check-answer")?.focus(), 0);
      return;
    }
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
  const canCheck = offerCheck && !check && !busy && !offReason("check");
  // A verdict this visit or recorded before (progress): the check is done.
  const checked = !!progress[step?.step ?? -1]?.verdict || thread.some(c => !!c.reply.verdict);
  const panel = (name: typeof tab) => (tab === name ? "block" : "hidden md:block");
  // SCHOLAR-GUIDED-LEARNING-01: the lesson as the learner meets it.
  const group = groupActions(props.actions, props.startAction);
  const preparing = Object.values(loading).find(l => l.step === step?.step) ?? null;
  const hasLesson = thread.some(c => c.target !== "ask" && c.reply.action === props.startAction);
  const showPrimary = !!group.primary && (!guided || (!hasLesson && !preparing));
  const lessonMsg = step ? lessonNote[step.step] : undefined;
  const taughtWith = step ? taught[step.step] : undefined;
  const settingsChanged = !!taughtWith && (taughtWith.mode !== mode || taughtWith.depth !== depth);
  const busyHere = !!busy || !!preparing;
  // Wider Learn-from modes the learner may choose, beneath a lesson the notes could not fully support. Choosing one
  // switches Learn from (remembered like the selector) and teaches the lesson again from it. Never chosen for them.
  const expansionsFor = (c: Card): Expansion[] => {
    const r = c.reply;
    if (!step || c.target === "ask" || !isOpenable(r.action) || !props.consent) return [];
    if (!(r.withheld || r.salvage || replyState(r) === "partial")) return [];
    return expansionChoices(mode, modes).map(m => ({
      label: EXPANSION_LABEL[m],
      onChoose: () => { setMode(m); if (r.action === props.startAction) void teachLesson(step.step, { mode: m, depth }); else void act(r.action, { mode: m }); },
    }));
  };
  // The check, answered where its question is: under the lesson's own question, or (a written check) after the lesson.
  const checkInline = !!check && !!lastTeach && teachQuestions.some(q => questionText(q) === check.question);
  const checkForm = () => check && (
    <form onSubmit={submitCheck} className="mt-2 rounded-xl border border-violet-200 bg-white p-3">
      {!checkInline && <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-violet-900">Check your understanding</p>}
      {!checkInline && <p className="mt-1 text-[14.5px] font-semibold text-gray-900">{check.question}</p>}
      <label htmlFor="check-answer" className={`${checkInline ? "" : "mt-2 "}block text-[12.5px] font-semibold text-gray-700`}>Your answer</label>
      <textarea id="check-answer" rows={3} maxLength={QUESTION_MAX} value={check.answer} onChange={e => setCheck({ ...check, answer: e.target.value })}
        className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
      <p className="mt-1 text-[12px] text-gray-600">{INFORMAL_CHECK_LABEL}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !check.answer.trim()}>{busy === "clarify" ? "Checking…" : "Check my answer"}</button>
        <button type="button" className={ghost} onClick={() => setCheck(null)}>Skip the check</button>
      </div>
    </form>
  );

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

        {/* ── THE LESSON: the explanation first; the other ways to learn, the settings and the check after it ── */}
        <section aria-labelledby="lesson-h" className={`${panel("lesson")} rounded-2xl border border-gray-200 bg-white p-4 sm:p-5`}>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em]" style={{ color: accent }}>Lesson {idx + 1} of {session.steps.length}</p>
          <h3 id="lesson-h" className="break-words text-[17px] font-bold text-gray-900">{step?.title || lastTeach?.reply.lesson?.title || `Lesson ${idx + 1}`}</h3>
          {/* SCHOLAR-LEARN-FIX-01 L-B: the lesson's objective (learn.lessonOutline, no AI). An older reply's or session's missing one is simply not shown. */}
          {(step?.objective || lastTeach?.reply.lesson?.objective) && (
            <p className="mt-1 break-words text-[14px] leading-relaxed text-gray-700"><span className="font-semibold text-gray-900">In this lesson: </span>{step?.objective || lastTeach?.reply.lesson?.objective}</p>
          )}
          {/* Manual: the starting action, as before. Guided: only when nothing has been taught here yet (it failed, or AI was off). */}
          {showPrimary && group.primary && (
            <div className="mt-3">
              <button type="button" disabled={busyHere || !props.consent || !!offReason(group.primary)} aria-describedby={offReason(group.primary) ? "learn-ai-why" : undefined} onClick={() => step && (guided ? void teachLesson(step.step, { mode, depth }) : void act(group.primary!))}
                className={btn} style={{ background: accent }}>
                {busy === group.primary ? "Working…" : props.labels[group.primary as LearnAction]}
              </button>
            </div>
          )}

          {pending?.target === "lesson" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-4" onEducation={() => void answerEducation()} />}
          <div aria-live="polite" className="mt-4 space-y-4">
            {thread.length === 0 && !busy && !preparing && !lessonMsg && pending?.target !== "lesson" && (
              <p className="text-[13.5px] text-gray-600">{!props.consent ? "Learning needs AI help, which is off."
                : guided && group.primary ? "This lesson has not been taught yet." : `Choose ${props.labels[props.startAction]} to begin this lesson, or ask Scholar anything.`}</p>
            )}
            {thread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} onFresh={c.reply.saved && props.consent ? () => act(c.reply.action, { fresh: true }) : undefined}
              onRephrase={props.actions.includes("ask") ? () => rephrase("") : undefined} recover={recoverFor(c)} wider={widerFor(c)} expansions={expansionsFor(c)}
              onAnswer={canCheck && c === lastTeach ? q => void startCheck(q) : undefined} canAnswer={q => answerable(c.reply, q)}
              renderCheck={c === lastTeach && checkInline ? q => (questionText(q) === check?.question ? checkForm() : null) : undefined} />)}
            {preparing && (
              <div role="status" className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
                <span aria-hidden="true" className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full motion-safe:animate-pulse" style={{ background: accent }} />
                <span className="min-w-0">
                  <span className="block text-[14px] font-semibold text-gray-900">{preparingText(preparing.mode)}</span>
                  {step?.title && <span className="block break-words text-[13px] text-gray-700">{step.title}</span>}
                </span>
              </div>
            )}
            {lessonMsg && !preparing && (
              <div role="status" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13.5px] text-gray-800">
                <p>{lessonMsg.message}</p>
                {step && <button type="button" className={`${ghost} mt-2`} disabled={busyHere} onClick={() => void teachLesson(step.step, lessonMsg.settings)}>Try again</button>}
              </div>
            )}
            {busy && busy !== "ask" && busy !== "clarify" && <p role="status" className="text-[13px] text-gray-500">{mode === "research" ? "Scholar is reading your notes and searching published research…" : "Scholar is reading your notes…"}</p>}
          </div>

          {check && !checkInline && <div className="mt-4">{checkForm()}</div>}
          {/* The check, informal and never required: from the lesson's own questions, or one Scholar writes. */}
          {offerCheck && !check && (
            <div className="mt-4">
              <button type="button" className={ghost} disabled={busyHere || !!offReason("check")} aria-describedby={offReason("check") ? "learn-check-why" : undefined} onClick={() => void startCheck()}>
                {busy === "check" ? "Writing a check…" : checked ? "Check again" : "Check my understanding"}
              </button>
              {offReason("check") && <p id="learn-check-why" className="mt-1 text-[12.5px] text-gray-600">{aiReasonCopy(offReason("check")!, "scholar").text}</p>}
            </div>
          )}

          {/* More learning options (Simplify, Go deeper, Examples, Summarise...), behind one disclosure; Ask Scholar stays in view. */}
          <div className="mt-4 flex flex-wrap items-start gap-2">
            {group.more.length > 0 && (
              <details className="group min-w-0 flex-1 basis-[220px] rounded-xl border border-gray-200">
                <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
                  <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>More learning options
                </summary>
                <div className="flex flex-wrap gap-2 border-t border-gray-200 px-3 py-2.5" role="group" aria-label="More learning options">
                  {group.more.map(a => (
                    <button key={a} type="button" disabled={busyHere || !props.consent || !!offReason(a)} aria-describedby={offReason(a) ? "learn-ai-why" : undefined} onClick={() => act(a)}
                      className={`${chip} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                      {busy === a ? "Working…" : props.labels[a as LearnAction]}
                    </button>
                  ))}
                </div>
              </details>
            )}
            {group.ask && <button type="button" onClick={() => rephrase("")} className={`${chip} min-h-[44px] border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>{props.labels.ask}</button>}
          </div>
          {(() => {
            const off = props.actions.filter(a => a !== "ask" && offReason(a));
            return props.consent && off.length > 0 && (
              <p id="learn-ai-why" className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">
                <span className="font-semibold">Not available yet: {off.map(a => props.labels[a]).join(", ")}.</span> {aiReasonCopy(offReason(off[0])!, "scholar").text}
              </p>
            );
          })()}

          {/* Lesson settings: secondary, collapsed, and still in force for every request. */}
          <details className="group mt-3 rounded-xl border border-gray-200">
            <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
              <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>Lesson settings
              <span className="min-w-0 truncate text-[12px] font-normal text-gray-600">· {LEARN_MODE_LABEL[mode]} · {depth === "brief" ? "Brief" : depth === "detailed" ? "Detailed" : "Standard"}</span>
            </summary>
            <div className="space-y-3 border-t border-gray-200 px-3 py-3">
              <label className="flex items-start gap-2 text-[13.5px] text-gray-900">
                <input type="checkbox" checked={guided} onChange={e => setGuided(e.target.checked)} className={`mt-0.5 h-4 w-4 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
                <span><span className="font-semibold">Teach each lesson automatically</span>
                  <span className="block text-[12px] text-gray-600">Off: choose {props.labels[props.startAction]} for each lesson yourself. Saved on this device. Scholar never moves to the next lesson for you.</span></span>
              </label>
              <label className="flex flex-wrap items-center gap-1.5 text-[13px] text-gray-700">Depth
                <select value={depth} onChange={e => setDepth(e.target.value as typeof depth)} className={`rounded-lg border border-gray-300 px-2 py-1 text-[13px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  <option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option>
                </select>
              </label>
              {modes.length > 1 && (
                <fieldset className="rounded-xl border border-gray-200 px-3 py-2">
                  <legend className="px-1 text-[12px] font-bold text-gray-700">Learn from</legend>
                  <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Learn from">
                    {modes.map(m => (
                      <button key={m} type="button" role="radio" aria-checked={mode === m} disabled={busyHere} onClick={() => setMode(m)}
                        className={`${chip} ${mode === m ? "border-transparent text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"}`} style={mode === m ? { background: accent } : undefined}>
                        {LEARN_MODE_LABEL[m]}
                      </button>
                    ))}
                  </div>
                  {mode === "research" && <p className="mt-1.5 text-[12px] text-gray-600">Scholar searches published research (PubMed, OpenAlex) for this topic. Only a few topic words are sent, never your notes or who you are. What it finds is shown apart from your notes, with its real source.</p>}
                  {mode === "library" && <p className="mt-1.5 text-[12px] text-gray-600">Adds the Competen library entries that match this topic, labelled as library.</p>}
                </fieldset>
              )}
              {settingsChanged && step && group.primary && props.consent && (
                <button type="button" className={ghost} disabled={busyHere || !!offReason(group.primary)} onClick={() => void teachLesson(step.step, { mode, depth })}>Teach this lesson again with these settings</button>
              )}
            </div>
          </details>

          {/* Next lesson: the one primary action at the end (kept in reach above the phone tab bar). Never automatic. */}
          <div className="sticky bottom-[calc(70px_+_env(safe-area-inset-bottom))] z-10 mt-5 flex flex-wrap items-center gap-2 border-t border-gray-100 bg-white py-3 md:static md:pb-0 md:pt-4">
            {idx > 0 && <button type="button" className={ghost} onClick={() => goTo(session.steps[idx - 1].step, "revisit")}>Previous</button>}
            {session.status === "completed" && <span className="text-[13px] font-semibold text-emerald-800">Session completed. You can still revisit any lesson.</span>}
            {!last ? <button type="button" className={`${btn} ml-auto`} style={{ background: accent }} onClick={() => goTo(session.steps[idx + 1].step, thread.length ? null : "skip")}>Next lesson</button>
              : session.status !== "completed" && <button type="button" className={`${btn} ml-auto`} style={{ background: accent }} onClick={finish}>Finish session</button>}
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
            {askThread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} compact onRephrase={() => rephrase(c.asked ?? "")} recover={recoverFor(c)} />)}
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
function ReplyCard({ card, labels, compact = false, onFresh, onRephrase, recover, wider, onAnswer, canAnswer, expansions = [], renderCheck }: {
  card: Card; labels: Record<LearnAction, string>; compact?: boolean; onFresh?: () => void; onRephrase?: () => void; recover?: Recover;
  /** SCHOLAR-LEARN-FIX-01 L-B: the wider tier offered under a partly grounded answer; answering one of its check questions. */
  wider?: Recover; onAnswer?: (q: string) => void; canAnswer?: (q: string) => boolean;
  /** SCHOLAR-GUIDED-LEARNING-01: wider Learn-from modes the learner may choose; the inline check under a lesson question. */
  expansions?: Expansion[]; renderCheck?: (q: string) => React.ReactNode;
}) {
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
          {r.recovered?.shown && <p className="mt-1.5 inline-flex rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[12px] font-semibold text-gray-900">{RECOVERY_EXPLANATION_LABEL}</p>}
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
          {r.answer && <AnswerBody text={r.answer} action={r.action} sources={r.sources} onAnswer={onAnswer} canAnswer={canAnswer} renderCheck={renderCheck} />}
          {/* SCHOLAR-GUIDED-LEARNING-01: a salvaged lesson -- shown, and said calmly what was left out (a count, never which). */}
          {r.salvage && (
            <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5">
              <p className="text-[13.5px] text-gray-900">{r.salvage.note}</p>
              {replyState(r) !== "partial" && <ExpansionRow expansions={expansions} />}
            </div>
          )}
          {replyState(r) === "partial" && r.grounding && <NotCovered terms={r.grounding.uncoveredTerms} wider={wider} expansions={expansions} />}
        </>
      )}
      {r.sources.length > 0 && !r.next && <SourcesDisclosure sources={r.sources.filter((_, i) => !r.answer || cited.has(i + 1))} />}
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
      {r.withheld && recover && <RecoveryFlow request={recover.request} explain={recover.explain} expansions={expansions} />}
      {r.withheld && !recover && <ExpansionRow expansions={expansions} />}
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

/** SCHOLAR-LEARN-FIX-01 L-B: an [S n] citation, inline, as a link to that section of the learner's own notes. */
function CiteLink({ n, sources }: { n: number; sources: Source[] }) {
  const s = sources.find(x => x.tag === `S${n}`);
  if (!s) return <span className="font-mono text-[12.5px]">[S{n}]</span>;
  return (
    <Link href={sourceHref(s.materialId, s.chunkId)} title={s.citation} aria-label={`Source ${s.tag}: ${s.citation}`}
      className={`rounded font-mono text-[12.5px] font-bold underline underline-offset-2 pointer-coarse:px-1 pointer-coarse:py-1 ${focusRing}`} style={{ color: accent }}>[{s.tag}]</Link>
  );
}
function Cited({ text, sources }: { text: string; sources: Source[] }) {
  return <>{citationSegments(text).map((x, i) => ("tag" in x ? <CiteLink key={i} n={x.tag} sources={sources} /> : <span key={i}>{x.text}</span>))}</>;
}

/**
 * The notes part of an answer. A Teach Me answer in the structured form (teach-format.ts) is shown as its parts: the
 * overview, the key points, an example from the notes (only when the engine kept one) and the understanding check.
 * Anything else -- every other action, and a Teach Me answer saved before the structure -- is shown as written. Either
 * way each [S n] is a link to its section.
 */
function AnswerBody({ text, action, sources, onAnswer, canAnswer, renderCheck }: { text: string; action: string; sources: Source[]; onAnswer?: (q: string) => void; canAnswer?: (q: string) => boolean; renderCheck?: (q: string) => React.ReactNode }) {
  const parts = action === "teach" ? parseTeachAnswer(text) : null;
  if (!parts) return <div className="mt-1 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-gray-800"><Cited text={text} sources={sources} /></div>;
  const sub = "text-[12px] font-bold uppercase tracking-[0.1em]";
  return (
    <div className="mt-1 space-y-3 break-words text-[14.5px] leading-relaxed text-gray-800">
      {parts.overview && <p className="text-[15px] text-gray-900"><Cited text={parts.overview} sources={sources} /></p>}
      {parts.points.length > 0 && (
        <div>
          <h4 className={`${sub} text-gray-600`}>Key points</h4>
          <ul className="mt-1 list-disc space-y-1.5 pl-5">{parts.points.map((p, i) => <li key={i}><Cited text={p} sources={sources} /></li>)}</ul>
        </div>
      )}
      {parts.example && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <h4 className={`${sub} text-gray-600`}>Example from your notes</h4>
          <p className="mt-0.5"><Cited text={parts.example} sources={sources} /></p>
        </div>
      )}
      {parts.questions.length > 0 && (
        <div className="rounded-lg border border-violet-200 bg-violet-50/60 px-3 py-2">
          <h4 className={`${sub} text-violet-900`}>Check your understanding</h4>
          <ul className="mt-1 space-y-2">
            {parts.questions.map((q, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1"><Cited text={q} sources={sources} /></span>
                {onAnswer && canAnswer?.(q) && (
                  <button type="button" onClick={() => onAnswer(q)} className={`${chip} border-violet-300 bg-white text-violet-950 hover:bg-violet-50`}>Answer this</button>
                )}
                {renderCheck && <div className="w-full">{renderCheck(q)}</div>}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[12px] text-gray-600">{INFORMAL_CHECK_LABEL}</p>
        </div>
      )}
    </div>
  );
}

/** A partly grounded lesson: after what the notes support, the terms they did not cover, and the next wider tier if offered. */
function NotCovered({ terms, wider, expansions = [] }: { terms: string[]; wider?: Recover; expansions?: Expansion[] }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5">
      <p className="break-words text-[14px] text-gray-900"><span className="font-semibold">{LEARN_NOT_COVERED_LABEL}:</span> {terms.join(", ")}.</p>
      <p className="mt-0.5 text-[12.5px] text-gray-700">{LEARN_NOT_COVERED_NOTE}</p>
      <ExpansionRow expansions={expansions} />
      {wider && !open && (
        <button type="button" onClick={() => setOpen(true)} className={`${chip} mt-2 border-gray-300 bg-white text-gray-900 hover:bg-gray-50`}>{LEARN_WIDER_LABEL}</button>
      )}
      {wider && open && <RecoveryFlow request={wider.request} explain={wider.explain} onDismiss={() => setOpen(false)} />}
    </div>
  );
}

/**
 * SCHOLAR-GUIDED-LEARNING-01: the wider Learn-from modes the learner may choose for this lesson, as plain buttons.
 * Nothing when none is offered: the page never asks a question it cannot answer.
 */
function ExpansionRow({ expansions }: { expansions: Expansion[] }) {
  if (!expansions.length) return null;
  return (
    <div className="mt-2">
      <p className="text-[12.5px] text-gray-700">You can learn this lesson from wider sources:</p>
      <div className="mt-1.5 flex flex-wrap gap-2" role="group" aria-label="Learn from wider sources">
        {expansions.map(x => <button key={x.label} type="button" onClick={x.onChoose} className={`${chip} border-gray-900 bg-white text-gray-900 hover:bg-gray-50`}>{x.label}</button>)}
      </div>
    </div>
  );
}

/**
 * The sources an answer cites, collapsed by default: a native disclosure, so it opens from the keyboard and is announced
 * as expandable. Each source keeps its link to the original section; its excerpt is shown only here.
 */
function SourcesDisclosure({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="group mt-3 rounded-lg border border-gray-200">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>View sources ({sources.length})
      </summary>
      <ul className="space-y-2.5 border-t border-gray-200 px-3 py-2.5">
        {sources.map(s => (
          <li key={s.tag} className="break-words text-[12.5px] text-gray-700">
            <span className="font-mono font-bold" style={{ color: accent }}>[{s.tag}]</span>{" "}
            <Link href={sourceHref(s.materialId, s.chunkId)} className={`underline underline-offset-2 ${focusRing}`}>{s.citation}</Link>
            {s.excerpt && <p className="mt-1 whitespace-pre-wrap border-l-2 border-gray-200 pl-2 text-[12.5px] leading-relaxed text-gray-700">{s.excerpt}{s.excerpt.length >= 400 ? "…" : ""}</p>}
          </li>
        ))}
      </ul>
    </details>
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
      {r.notUsed && RECOVERY_NOT_USED_LABEL[r.notUsed] && <span className="block text-[11.5px] text-gray-700">Reading only: {RECOVERY_NOT_USED_LABEL[r.notUsed]}.</span>}
      {r.excerpt && <span className="mt-0.5 block text-[12px] italic text-gray-700">Abstract excerpt: {r.excerpt}</span>}
    </div>
  );
}
