"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { INFORMAL_CHECK_LABEL, LEARN_MODE_LABEL, NOT_IN_NOTES_LABEL, PERSONAL_AI_LABEL, QUESTION_MAX, SOURCE_KIND_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import type { SessionView } from "@/lib/individual/scholar/learn-view";
import { evaluationHref, sourceHref } from "./question-view";
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
import {
  DWELL_MS, createJourney, journeyKey, journeyStep, lessonStatus, parseSavedJourney, readCount, savedJourney, shouldSendPosition, startJourney,
  type JourneyEffect, type JourneyEvent, type JourneyState,
} from "@/lib/individual/scholar/learn-journey";
import { DEVICE_KEY, PositionSync, mergeResume, newDeviceId, type PositionDraft, type PositionPut, type ServerPosition, type SyncResult } from "@/lib/individual/scholar/learn-position";
import { LEARN_NOT_COVERED_LABEL, LEARN_NOT_COVERED_NOTE, LEARN_WIDER_LABEL, RECOVERY_EXPLANATION_LABEL, RECOVERY_NOT_USED_LABEL } from "@/lib/individual/scholar/config";
import type { ReadingLink } from "@/lib/individual/scholar/evidence-recovery";
import { STUDY_EVENT, carry } from "./study-active";
import { citationSegments, citedTags, parseTeachAnswer, questionText, replyState, type LearnGrounding } from "@/lib/individual/scholar/teach-format";
import { DepthControl, FollowUpActions, PersonalAiAnswer, askPersonalAi } from "@/app/individual/_components/ai/PersonalAiAnswer";
import { FOLLOW_UP_LABEL, type FollowUp, type FollowUpKind, type PersonalAiDepth, type PersonalAiSourceRef } from "@/lib/individual/personal-ai-options";
import { JourneyBar, JourneyOutline, type NavLesson } from "./learn-journey-nav";
import { ActivityRow, ContinueCard, DEPTH_LABEL, DepthSegment, LessonCard, LessonPlaceholder, ResumeBanner, lessonDomId, lessonHeadingId, type Activity } from "./learn-lesson-card";
import { LessonPractice } from "./learn-practice";
import { TEACHING_AI_ACTIVITY, isTeachingAction } from "@/lib/individual/scholar/config";
import { ApproachControl, offeredApproaches, type Approach, type ApproachResult } from "./learn-approach";

// THE LEARN WORKSPACE -- COMPETEN-SCHOLAR-LEARN-01 (owner GO 2026-10-24). Three regions on a wide screen -- the
// sources (the steps and the student's own sections, the originals one click away), the guided lesson in the
// centre, and the Scholar assistant (Ask) -- and, below md, one column with tabs (the CPR-MOB-001 single md edge).
// Every answer comes from POST /api/individual/scholar/learn/act and is shown as the route says: from the notes
// (cited), governed reference, AI background (apart, labelled), AI flags (to check), or withheld with the reason.
// Switching actions keeps the step and its thread: nothing the student has seen is lost by choosing another way.
//
// SCHOLAR-COMPANION-01 P0b: THE CONTINUOUS SCROLL JOURNEY. The lessons are revealed one after another in ONE column
// (learn-journey.ts is the state model and says the generate rule): scrolling only ever loads what is SAVED; a
// lesson is taught by the learner's own choice (Continue, a Teach button) or, guided, when the workspace opens on it.
// The lesson being read is Current; the server's current_step follows it after a dwell, and this device remembers how
// far the column was revealed (learn-journey.ts says why that is not a server column).

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
/** `extra` and `target`: the request as it was made, so "Explain using approved references" can make it again. `step`: the lesson it belongs to. */
type Card = { id: number; asked?: string; reply: Reply; extra?: Record<string, unknown>; target?: "lesson" | "ask"; step?: number };
type Recover = { request: RecoveryRequestBody; explain: (rec: { id: string; mode: RecoveryRequestBody["mode"]; question: string }) => Promise<ExplainOutcome> };
/** AI operating modes: a clarify question put to the student instead of a refusal, and the request to resend if it is for study. */
type Pending = { prompt: ClarifyPrompt; target: "lesson" | "ask" | "assistant"; action?: string; extra?: Record<string, unknown>; asked?: string; question?: string; followUp?: FollowUp; step?: number };
type Step = SessionView["steps"][number];

/** One request. `signal`: the journey cancels a lesson request it no longer needs (an abort answers { aborted: true }). */
async function call(url: string, body: unknown, method = "POST", headers: Record<string, string> = {}, signal?: AbortSignal): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    if (signal?.aborted) return { ok: false, json: { aborted: true } };
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}
const readSavedJourney = (id: string, count: number) => { try { return parseSavedJourney(window.localStorage.getItem(journeyKey(id)), count); } catch { return null; } };

// ── SCHOLAR-CONTINUITY-01 (790): THE POSITION ON THE SERVER, ACROSS DEVICES (learn-position.ts) ──
const positionUrl = (sessionId: string) => `/api/individual/scholar/learn/sessions/${sessionId}/position`;
/** The server position of a session, or null (none, not provisioned, or not reachable: this device's copy is used). */
async function fetchPosition(sessionId: string): Promise<ServerPosition | null> {
  try { const res = await fetch(positionUrl(sessionId), { method: "GET" }); const j = res.ok ? await res.json() : null; return j?.position ?? null; } catch { return null; }
}
/** One write. 400/404: dropped (not retried). Not reached: null (sent again on the next move). */
async function sendPosition(sessionId: string, p: PositionPut, keepalive: boolean): Promise<SyncResult> {
  try {
    const res = await fetch(positionUrl(sessionId), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p), keepalive });
    if (!res.ok) return res.status === 400 || res.status === 404 ? { provisioned: true, accepted: false, position: null } : null;
    const j = await res.json().catch(() => ({}));
    return { provisioned: j.provisioned !== false, accepted: j.accepted === true, position: j.position ?? null };
  } catch { return null; }
}
/** This browser's device id (kept), or a fresh one for this visit where storage is blocked. */
function deviceIdOf(): string {
  try {
    const v = window.localStorage.getItem(DEVICE_KEY);
    if (v && /^[A-Za-z0-9_-]{8,64}$/.test(v)) return v;
    const id = newDeviceId(); window.localStorage.setItem(DEVICE_KEY, id); return id;
  } catch { return newDeviceId(); }
}
/** 0-100: how far through the lesson the reading band (35% down the screen) is. Read only when a write is made. */
function offsetIn(stepNo: number): number | null {
  try {
    const el = document.getElementById(lessonDomId(stepNo));
    const r = el?.getBoundingClientRect();
    if (!r || r.height <= 0) return null;
    return Math.max(0, Math.min(100, Math.round(((window.innerHeight * 0.35 - r.top) / r.height) * 100)));
  } catch { return null; }
}
/** A flashcard's starting words from the lesson's own text: [S n] tags removed, within the card limits. The learner edits them. */
const plain = (s: string, max: number) => s.replace(/\s*\[[SRE]\d+\]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

export function LearnWorkspace(props: {
  initial: SessionView | null; initialProgress: Record<number, { actions: string[]; verdict: string | null }>; start: StartScope | null;
  /** SCHOLAR-CONTINUITY-01 (790): where the learner stopped on any device (null: none, or 790 absent). */
  initialPosition?: ServerPosition | null;
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
  /** SCHOLAR-PAI-EXPERIENCE-01: flashcards are offered, so a Personal AI practice card may be edited and saved as the learner's own. */
  ownCards?: boolean;
}) {
  const router = useRouter();
  const [session, setSession] = useState<SessionView | null>(props.initial);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [cards, setCards] = useState<Record<number, Card[]>>({});
  const [busy, setBusy] = useState<string>("");
  /** The lesson the busy action is for (its buttons say "Working…"; the others are only disabled). */
  const [busyAt, setBusyAt] = useState<number | null>(null);
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
  /** The informal check, answered in its own lesson. `lastCheck`: the latest answered one per lesson (Explain my mistake). */
  const [check, setCheck] = useState<{ step: number; question: string; answer: string } | null>(null);
  const [lastCheck, setLastCheck] = useState<Record<number, { question: string; answer: string }>>({});
  const [ask, setAsk] = useState("");
  const [askThread, setAskThread] = useState<Card[]>([]);
  // Owner D3: the shared personal AI on this step. Its own thread, never mixed into a Learn answer, never saved.
  // SCHOLAR-PAI-EXPERIENCE-01: streamed in as it is written (`streaming`), shown structured, with its depth and follow-ups.
  const [assist, setAssist] = useState<{ id: number; asked: string; answer?: string; error?: string; streaming?: boolean; followUp?: FollowUpKind; sources?: PersonalAiSourceRef[] }[]>([]);
  const [paDepth, setPaDepth] = useState<PersonalAiDepth>("standard");
  const [pending, setPending] = useState<Pending | null>(null);
  // SCHOLAR-GUIDED-LEARNING-01: Guided by default (opening a lesson teaches it); Manual is the learner's own choice.
  const rememberedG = useSyncExternalStore(noSubscribe, rememberedGuided, () => null);
  const [chosenGuided, setChosenGuided] = useState<boolean | null>(null);
  const guided = chosenGuided ?? isGuided(rememberedG);
  const setGuided = (on: boolean) => { setChosenGuided(on); try { window.localStorage.setItem(GUIDED_KEY, guidedValue(on)); } catch { /* this visit only */ } };
  const requests = useRef(new LessonRequests());
  /** Lessons being opened or written, by lesson key: the progress line shows in that lesson. */
  const [loading, setLoading] = useState<Record<string, { step: number; mode: LearnMode }>>({});
  /** A lesson that could not be opened (or a duplicate twin asked to wait): said plainly, with Try again. */
  const [lessonNote, setLessonNote] = useState<Record<number, { message: string; settings: LessonSettings }>>({});
  /** The settings each step's lesson was last taught with (a lesson offers to teach it again with new ones). */
  const [taught, setTaught] = useState<Record<number, LessonSettings>>({});
  /** Per lesson: the teaching approach chosen, and whether Practise is open. */
  const [approachOf, setApproachOf] = useState<Record<number, Approach | null>>({});
  const [practiceOpen, setPracticeOpen] = useState<Record<number, boolean>>({});
  /** A completed lesson, announced once (the only live region of the journey: saved lessons loading as you scroll are not announced). */
  const [announce, setAnnounce] = useState("");
  const [banner, setBanner] = useState<number | null>(null);
  const seq = useRef(0);
  // SCHOLAR-RISK-01 clarify-once: once the student says this study session is for study, every later request in it
  // carries purpose "education", so the question is not asked again. The server honours it only for an ambiguous
  // request: real-patient evidence is refused whatever the purpose. A new session, or "a patient I'm caring for", ends it.
  const studyConfirmed = useRef<{ session: string | null; on: boolean }>({ session: null, on: false });
  const sessionKey = session ? (session.id ?? session.title) : null;
  const studyBody = useCallback((b: Record<string, unknown>) => (studyConfirmed.current.on && studyConfirmed.current.session === sessionKey ? { ...b, purpose: "education" } : b), [sessionKey]);
  const confirmStudy = (on: boolean) => { studyConfirmed.current = { session: sessionKey, on }; };
  const started = useRef(false);
  const opened = useRef(false);
  /** The session came back as one already being learned (a resume), not a new scope. */
  const resumed = useRef(!!props.initial);

  // ── THE JOURNEY (learn-journey.ts). `jRef` is the state the next event is applied to; effects run at once. ──
  const [journey, setJourney] = useState<JourneyState | null>(null);
  const jRef = useRef<JourneyState | null>(null);
  const fxRef = useRef<(f: JourneyEffect) => void>(() => {});
  const cardsRef = useRef(cards);
  const teachCtl = useRef<{ step: number; ctl: AbortController } | null>(null);
  const prefetchCtl = useRef<AbortController | null>(null);
  /** The lesson index the server's current_step holds, and the one this device remembers as where the learner stopped. */
  const serverAt = useRef(0);
  const anchor = useRef(0);
  /** The learner has scrolled, typed or clicked: until then a lesson merely in view never moves the saved position. */
  const engaged = useRef(false);
  const column = useRef<HTMLDivElement>(null);
  // SCHOLAR-CONTINUITY-01 (790): the server position seen, the latest learning mark, and the writer (learn-position.ts).
  const serverPos = useRef<ServerPosition | null>(props.initialPosition ?? null);
  const lastDone = useRef<{ activity: string; at: string } | null>(null);
  const syncRef = useRef<PositionSync | null>(null);
  const sessionRef = useRef(session);
  const practiceRef = useRef(practiceOpen);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const dispatch = useCallback((e: JourneyEvent) => {
    const s = jRef.current;
    if (!s) return;
    const r = journeyStep(s, e, { prepareNext: !!props.prepareNext && props.consent });
    if (r.state !== s) { jRef.current = r.state; setJourney(r.state); }
    for (const f of r.effects) fxRef.current(f);
    // A learning mark (an activity done, a check answered, a practice question answered) is a meaningful event: written at once.
    if (e.type === "activity" || e.type === "verdict") {
      const stepNo = sessionRef.current?.steps[e.index]?.step;
      if (stepNo !== undefined) lastDone.current = { activity: `${e.type === "verdict" ? "checked" : e.kind}:${stepNo}`, at: new Date().toISOString() };
      if (engaged.current) syncRef.current?.event("activity");
    }
  }, [props.prepareNext, props.consent]);
  const indexOf = useCallback((stepNo: number) => session?.steps.findIndex(x => x.step === stepNo) ?? -1, [session]);

  const at = session && journey ? session.steps[journey.current]?.step ?? session.steps[0]?.step ?? 0 : props.initial?.currentStep ?? 0;
  const step = session?.steps.find(s => s.step === at) ?? session?.steps[0] ?? null;
  // SCHOLAR-EDU-AI-01 s6: an action whose activity the standing says is not available is shown disabled, with why.
  const aiOf = useAiAvailabilityOf();
  const offReason = useCallback((a: string) => { const v = aiOf(isTeachingAction(a) ? TEACHING_AI_ACTIVITY[a] : a); return v && !v.available ? v.reason : null; }, [aiOf]);
  // The latest shown Teach Me answer's check questions that cite only this lesson's own sections (see startCheck).
  const answerable = (st: Step, r: Reply, q: string) => { const own = new Set(st.sections.map(x => x.chunkId)); const tags = citedTags(q); return tags.length > 0 && tags.every(n => own.has(r.sources.find(s => s.tag === `S${n}`)?.chunkId ?? "")); };
  const lastTeachOf = (st: Step) => [...(cards[st.step] ?? [])].reverse().find(c => c.reply.action === "teach" && !!c.reply.answer && !c.reply.withheld);
  const teachQuestionsOf = (st: Step) => { const t = lastTeachOf(st); return t ? (parseTeachAnswer(t.reply.answer!)?.questions ?? []).filter(q => answerable(st, t.reply, q)) : []; };

  // One request body for every Learn action: the step, its depth and (beyond notes) its Learn-from mode, and the
  // session by id (or, held in the browser, its sections).
  const bodyFor = useCallback((st: Step, action: string, s: LessonSettings, extra: Record<string, unknown> = {}) => {
    if (!session) return {};
    const scopeIds = session.steps.flatMap(x => x.sections.map(y => y.chunkId));
    return {
      action, step: st.step, depth: s.depth, ...(s.mode !== "notes" && action !== "check" && action !== "clarify" ? { mode: s.mode } : {}), ...extra,
      ...(session.id ? { sessionId: session.id } : { chunkIds: action === "ask" ? scopeIds : st.sections.map(x => x.chunkId) }),
    };
  }, [session]);
  // A reply into its own step's thread (or the Ask thread), and the step's progress. A reply that arrives after the
  // learner moved on still belongs to the step it teaches, so it shows in that lesson (no second AI call).
  const record = useCallback((stepNo: number, json: Record<string, any>, action: string, extra: Record<string, unknown> | undefined, target: "lesson" | "ask", asked?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const reply = (json.continuity ? { ...json, savedList: json.saved, saved: null, sources: [], references: [] } : json) as Reply;
    const card: Card = { id: ++seq.current, asked, reply, extra, target, step: stepNo };
    if (target === "ask") setAskThread(t => [card, ...t]);
    else setCards(c => ({ ...c, [stepNo]: [...(c[stepNo] ?? []), card] }));
    if (!json.withheld && !json.continuity) setProgress(p => ({ ...p, [stepNo]: { actions: [...new Set([...(p[stepNo]?.actions ?? []), action])], verdict: json.verdict?.value ?? p[stepNo]?.verdict ?? null } }));
    return reply;
  }, []);

  /** A Learn action on a lesson (the current one unless `onStep` names another). */
  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}, target: "lesson" | "ask" = "lesson", asked?: string, onStep?: number) => {
    const st = onStep === undefined ? step : session?.steps.find(x => x.step === onStep) ?? null;
    if (!session || !st) return null;
    setBusy(action); setBusyAt(st.step); setError(""); setPending(null);
    const s: LessonSettings = { mode: (extra.mode as LearnMode | undefined) ?? mode, depth };
    const r = await call(ACT_URL, studyBody(bodyFor(st, action, { mode, depth }, extra)));
    setBusy(""); setBusyAt(null);
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target, action, extra, asked, step: st.step }); return null; }
    if (!r.ok && !r.json.withheld) { setError(r.json.error ?? "Scholar could not answer just now."); return null; }
    record(st.step, r.json, action, extra, target, asked);
    const i = indexOf(st.step);
    if (target === "lesson") setAnnounce(`Scholar answered in lesson ${i + 1}.`);
    if (target === "lesson" && action === props.startAction) setTaught(t => ({ ...t, [st.step]: s }));
    if (target === "lesson" && r.json.answer && !r.json.withheld && isOpenable(action)) {
      if (action === props.startAction) dispatch({ type: "taught", index: i });
      if (action === "deeper" || action === "examples") dispatch({ type: "activity", index: i, kind: action });
    }
    if (r.json.verdict?.value) dispatch({ type: "verdict", index: i, value: String(r.json.verdict.value) });
    return r.json as Reply;
  }, [session, step, depth, mode, bodyFor, record, props.startAction, studyBody, indexOf, dispatch]);

  // SCHOLAR-GUIDED-LEARNING-01: OPEN A LESSON. First open:true -- a saved lesson comes back at once with no AI; only
  // when nothing is saved (or its twin is being written) is the same request sent as a Teach, which the route dedupes.
  // One request per lesson key at a time; a cancelled request (the journey moved on) writes nothing on the page.
  const teachLesson = useCallback(async (stepNo: number, s: LessonSettings) => {
    if (!session) return;
    const st = session.steps.find(x => x.step === stepNo);
    if (!st) return;
    const action = props.startAction, k = lessonKey(session.id ?? session.title, stepNo, action, s);
    if (!requests.current.begin(k)) return;
    const ctl = new AbortController();
    teachCtl.current = { step: stepNo, ctl };
    setLoading(l => ({ ...l, [k]: { step: stepNo, mode: s.mode } }));
    setLessonNote(n => { const rest = { ...n }; delete rest[stepNo]; return rest; });
    const body = studyBody(bodyFor(st, action, s));
    let shown = false;
    try {
      let r = await call(ACT_URL, { ...body, open: true }, "POST", {}, ctl.signal);
      if (r.json.aborted) { requests.current.release(k); return; }
      let phase = lessonPhase("open", r.ok, r.json);
      if (phase.kind === "generate") {
        // Another lesson was asked for while this one was being opened: nothing is written for one left behind.
        if (!requests.current.isCurrent(k) || ctl.signal.aborted) { requests.current.release(k); return; }
        // AI not available now: nothing is generated; the "Not available yet" line says why.
        if (offReason(action)) return;
        r = await call(ACT_URL, body, "POST", {}, ctl.signal);
        if (r.json.aborted) { requests.current.release(k); return; }
        phase = lessonPhase("generate", r.ok, r.json);
      }
      const prompt = r.ok ? null : clarifyFrom(r.json);
      if (prompt) { if (requests.current.isCurrent(k)) setPending({ prompt, target: "lesson", action, extra: {}, step: stepNo }); return; }
      if (phase.kind === "error" || phase.kind === "retry") { setLessonNote(n => ({ ...n, [stepNo]: { message: phase.message, settings: s } })); return; }
      if (phase.kind === "show") {
        record(stepNo, r.json, action, {}, "lesson"); setTaught(t => ({ ...t, [stepNo]: s }));
        if (r.json.answer && !r.json.withheld) { shown = true; setAnnounce(`Lesson ${indexOf(stepNo) + 1} is ready${st.title ? `: ${st.title}` : ""}.`); }
      }
    } finally {
      requests.current.end(k);
      if (teachCtl.current?.ctl === ctl) teachCtl.current = null;
      setLoading(l => { const rest = { ...l }; delete rest[k]; return rest; });
      dispatch({ type: shown ? "taught" : "teachEnded", index: indexOf(stepNo) });
    }
  }, [session, props.startAction, bodyFor, record, offReason, studyBody, indexOf, dispatch]);

  /** Saved only: open:true, which returns a saved lesson or nothing -- never an AI call. Scrolling and jumps use this. */
  const openLesson = useCallback(async (stepNo: number) => {
    if (!session || !isOpenable(props.startAction)) return;
    const st = session.steps.find(x => x.step === stepNo);
    if (!st) return;
    const i = indexOf(stepNo);
    const has = (c: Record<number, Card[]>) => (c[stepNo] ?? []).some(x => x.target !== "ask" && x.reply.action === props.startAction);
    if (has(cardsRef.current)) { dispatch({ type: "savedLoaded", index: i, found: true }); return; }
    const s: LessonSettings = { mode, depth };
    if (requests.current.pending(lessonKey(session.id ?? session.title, stepNo, props.startAction, s))) return;
    const r = await call(ACT_URL, { ...studyBody(bodyFor(st, props.startAction, s)), open: true });
    const found = r.ok && r.json.cached === true && !!r.json.answer;
    if (found && !has(cardsRef.current)) { record(stepNo, r.json, props.startAction, {}, "lesson"); setTaught(t => ({ ...t, [stepNo]: s })); }
    dispatch({ type: "savedLoaded", index: i, found });
  }, [session, props.startAction, mode, depth, bodyFor, studyBody, record, indexOf, dispatch]);

  // Prepare-next (policy scholar_learn_prepare_next, default OFF: then no request is made at all). The journey asks for
  // it only once the FRONTIER lesson is taught, for the one after it only, once per lesson key, cancellable.
  const prefetch = useCallback(async (stepNo: number) => {
    if (!props.prepareNext || !props.consent || !session?.id) { dispatch({ type: "prefetchEnded" }); return; }
    if (!requests.current.claimPrepare(lessonKey(session.id, stepNo, "teach", { mode, depth }))) { dispatch({ type: "prefetchEnded" }); return; }
    const ctl = new AbortController();
    prefetchCtl.current?.abort(); prefetchCtl.current = ctl;
    await call(ACT_URL, { action: "teach", sessionId: session.id, step: stepNo, depth, ...(mode !== "notes" ? { mode } : {}), prepare: true }, "POST", { "x-request-id": requestId() }, ctl.signal);
    if (prefetchCtl.current === ctl) { prefetchCtl.current = null; dispatch({ type: "prefetchEnded" }); }
  }, [props.prepareNext, props.consent, session, mode, depth, dispatch]);

  /** A teach the journey asked for. `auto` (guided, the lesson the workspace opened on) passes shouldAutoTeach first. */
  const runTeach = useCallback((stepNo: number, auto: boolean) => {
    if (!session) return;
    const s: LessonSettings = { mode, depth };
    const k = lessonKey(session.id ?? session.title, stepNo, props.startAction, s);
    const has = (cardsRef.current[stepNo] ?? []).some(c => c.target !== "ask" && c.reply.action === props.startAction);
    const i = indexOf(stepNo);
    if (has) { dispatch({ type: "taught", index: i }); return; }
    const may = auto
      ? shouldAutoTeach({ guided: true, consent: props.consent, startAction: props.startAction, actions: props.actions, hasLesson: has, asked: requests.current.wasAsked(k), inFlight: requests.current.pending(k) })
      : props.consent && isOpenable(props.startAction) && props.actions.includes(props.startAction);
    if (!may) { dispatch({ type: "teachEnded", index: i }); void openLesson(stepNo); return; }
    void teachLesson(stepNo, s);
  }, [session, mode, depth, props.startAction, props.consent, props.actions, indexOf, dispatch, openLesson, teachLesson]);

  const scrollToLesson = useCallback((stepNo: number) => {
    setTab("lesson");
    const go = () => {
      const el = document.getElementById(lessonDomId(stepNo));
      if (!el) return false;
      let reduce = false;
      try { reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { /* default motion */ }
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      document.getElementById(lessonHeadingId(stepNo))?.focus({ preventScroll: true });
      return true;
    };
    // The lesson may only now be revealed: after this render.
    requestAnimationFrame(() => { if (!go()) setTimeout(go, 60); });
  }, []);

  // The journey's effects, against the latest callbacks.
  useEffect(() => {
    cardsRef.current = cards;
    fxRef.current = f => {
      const st = f.kind === "abortPrefetch" ? null : session?.steps[f.index];
      if (f.kind === "abortPrefetch") { prefetchCtl.current?.abort(); prefetchCtl.current = null; return; }
      if (!st) return;
      if (f.kind === "open") void openLesson(st.step);
      else if (f.kind === "teach") runTeach(st.step, f.auto);
      else if (f.kind === "abort") { if (teachCtl.current?.step === st.step) teachCtl.current.ctl.abort(); }
      else if (f.kind === "prefetch") void prefetch(st.step);
      else if (f.kind === "scrollTo") scrollToLesson(st.step);
    };
  });
  // Nothing outlives the workspace: an unneeded lesson or prefetch request is cancelled on leaving.
  useEffect(() => () => { teachCtl.current?.ctl.abort(); prefetchCtl.current?.abort(); }, []);

  // SCHOLAR-PAI-EXPERIENCE-01 / owner D3: the step, handed to the shared personal AI (Teach Me). Shown apart under
  // PERSONAL_AI_LABEL, never saved. Streamed; a follow-up resends the earlier question and answer (the server adds a
  // fixed instruction). A stream that fails part way is discarded and said plainly, never shown as an answer.
  const continueWithAssistant = useCallback(async (question: string, purpose?: "education", followUp?: FollowUp) => {
    if (!session || !step) return;
    setBusy("assistant"); setPending(null);
    const id = ++seq.current;
    let shown = false;
    const r = await askPersonalAi("/api/individual/scholar/learn/assistant", studyBody({
      question, mode: "teach", step: step.step, depth: paDepth, ...(purpose ? { purpose } : {}), ...(followUp ? { followUp } : {}),
      ...(session.id ? { sessionId: session.id } : { chunkIds: step.sections.map(x => x.chunkId) }),
    }), soFar => {
      if (!shown) { shown = true; setAssist(list => [{ id, asked: question, answer: soFar, streaming: true, followUp: followUp?.kind }, ...list]); }
      else setAssist(list => list.map(a => (a.id === id ? { ...a, answer: soFar } : a)));
    });
    setBusy("");
    const failed = (error: string) => setAssist(list => [{ id, asked: question, error, followUp: followUp?.kind }, ...list.filter(a => a.id !== id)]);
    if (r.kind === "stream") {
      if (r.error) { failed(r.error.message); return; }
      setAssist(list => list.map(a => (a.id === id ? { ...a, answer: r.text, streaming: false, sources: r.done?.sources } : a)));
      return;
    }
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target: "assistant", question, followUp }); return; }
    if (r.ok) setAssist(list => [{ id, asked: question, answer: String(r.json.answer ?? ""), followUp: followUp?.kind, sources: Array.isArray(r.json.sources) ? r.json.sources : undefined }, ...list]);
    else failed(String(r.json.error ?? "Your assistant could not answer just now."));
  }, [session, step, studyBody, paDepth]);
  // SCHOLAR-SQIE-02: a withheld answer offers evidence recovery beneath it, in the learner's own source mode. "Explain
  // using approved references" makes the SAME request again (same action, same question) with only the recovery's id,
  // mode and question; the server finds the evidence again and runs the same checks. Nothing the student typed is cleared.
  const recoveryMode = (): RecoveryRequestBody["mode"] => (mode === "research" ? "notes_and_references" : mode === "library" ? "notes_and_library" : "notes_only");
  const recoverFor = (c: Card, st: Step | null): Recover | undefined => {
    const r = c.reply;
    if (!r.withheld || r.recovered || r.action === "check" || r.action === "clarify" || !st) return undefined;
    return recovery(c, st, recoveryMode(), c.asked || st.title || "", r.reason ?? null);
  };
  // SCHOLAR-LEARN-FIX-01 L-B: a partly grounded answer that WAS shown offers the next wider tier the server named
  // (grounding.wider), for the terms the notes did not cover -- the same evidence recovery, asked for by the learner.
  const widerFor = (c: Card, st: Step | null): Recover | undefined => {
    const r = c.reply, g = r.grounding;
    if (replyState(r) !== "partial" || !g?.wider || r.recovered || !st) return undefined;
    return recovery(c, st, g.wider as RecoveryRequestBody["mode"], g.uncoveredTerms.join(" "), null);
  };
  const recovery = (c: Card, st: Step, recMode: RecoveryRequestBody["mode"], question: string, withheldReason: string | null): Recover | undefined => {
    const r = c.reply;
    if (!session) return undefined;
    const first = st.sections[0];
    return {
      // SCHOLAR-LEARN-FIX-01: the session's selected materials scope My notes only (a recorded session by id, read on the server).
      request: { question: question.slice(0, QUESTION_MAX), mode: recMode, materialId: first?.materialId ?? null, sectionId: first?.chunkId ?? null, withheldReason,
        ...(session.id ? { sessionId: session.id } : { materialIds: [...new Set(session.steps.flatMap(s => s.sections.map(x => x.materialId)))].slice(0, 10) }) },
      explain: async rec => {
        const x = await act(r.action, { ...(c.extra ?? {}), recovery: rec }, c.target ?? "lesson", c.asked, c.step ?? st.step);
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

  // A new scope: start the session; the journey then opens it (guided: teaches its first lesson).
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
        // Already being learned: carried on where it was left, recorded as a resume.
        opened.current = true; resumed.current = true;
        setProgress(r.json.progress ?? {});
        void call(`/api/individual/scholar/learn/sessions/${r.json.session.id}`, { move: "resume", currentStep: r.json.session.currentStep }, "PATCH");
        // SCHOLAR-CONTINUITY-01: where it was left on any device, before the journey opens.
        serverPos.current = await fetchPosition(r.json.session.id);
      }
      setSession(r.json.resumed ? r.json.session : { ...r.json.session, currentStep: r.json.session.steps?.[0]?.step ?? 0 }); setNote(r.json.note ?? null);
    })();
  }, [props.start, props.connect, props.objectiveText, session]);
  // A resumed session: recorded as a resume.
  useEffect(() => {
    if (props.initial?.id && !opened.current) { opened.current = true; void call(`/api/individual/scholar/learn/sessions/${props.initial.id}`, { move: "resume", currentStep: props.initial.currentStep }, "PATCH"); }
  }, [props.initial]);

  // THE JOURNEY OPENS, once per session. Revealed: as far as this device remembers, the server's current step, or the
  // furthest lesson with a learning mark. Current: where this device says the learner stopped, else the server's step.
  // Guided (and, as always, the first lesson of a new scope even in Manual): the current lesson is taught if nothing is
  // saved. Every other lesson loads what is saved as it nears the screen.
  const journeyFor = useRef<string | null>(null);
  useEffect(() => {
    if (!session?.steps.length) return;
    const key = session.id ?? session.title;
    if (journeyFor.current === key) return;
    journeyFor.current = key;
    const count = session.steps.length;
    const serverIdx = Math.max(0, session.steps.findIndex(x => x.step === session.currentStep));
    const saved = session.id ? readSavedJourney(session.id, count) : null;
    // SCHOLAR-CONTINUITY-01: this device's copy merged with the server position (learn-position.ts mergeResume): the later wins.
    const merged = resumed.current ? mergeResume({ steps: session.steps.map(x => x.step), fallback: serverIdx, local: saved, server: serverPos.current }) : null;
    const current = merged ? merged.anchor : 0;
    const j = createJourney({ count, current, revealedUpTo: merged ? merged.revealedUpTo : saved?.revealedUpTo, progress: session.steps.map(x => progress[x.step]), activities: saved?.activities });
    if (merged?.practiceOpen != null) { const p = merged.practiceOpen; setPracticeOpen(m => ({ ...m, [p]: true })); }
    serverAt.current = serverIdx; anchor.current = current;
    if (resumed.current && current > 0) setBanner(current); else engaged.current = true;
    const r = startJourney(j, !resumed.current || (chosenGuided ?? isGuided(rememberedGuided())));
    jRef.current = r.state; setJourney(r.state);
    for (const f of r.effects) fxRef.current(f);
  }, [session, progress, chosenGuided]);

  // Scrolling: the lesson crossing the reading band is Current; a lesson nearing the screen loads what is saved; the
  // end of the column shows the Continue card. None of these can ask for a teach (learn-journey.ts).
  const revealed = journey?.revealedUpTo ?? -1;
  useEffect(() => {
    const root = column.current;
    if (!root || revealed < 0 || typeof IntersectionObserver === "undefined") return;
    const idx = (el: Element) => Number((el as HTMLElement).dataset.lessonIndex);
    const band = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) dispatch({ type: "viewed", index: idx(e.target) }); }, { rootMargin: "-35% 0px -55% 0px" });
    const near = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting) dispatch({ type: "nearView", index: idx(e.target) }); }, { rootMargin: "400px 0px" });
    const end = new IntersectionObserver(es => { for (const e of es) dispatch({ type: e.isIntersecting ? "scrollReachedEnd" : "scrollLeftEnd" }); });
    root.querySelectorAll("[data-lesson-index]").forEach(el => { band.observe(el); near.observe(el); });
    const sentinel = root.querySelector("[data-journey-end]");
    if (sentinel) end.observe(sentinel);
    return () => { band.disconnect(); near.disconnect(); end.disconnect(); };
  }, [revealed, dispatch]);
  // The learner's own input marks them as reading (a page merely loaded never moves their saved position).
  useEffect(() => {
    const on = () => { engaged.current = true; };
    const opts = { passive: true, once: true } as const;
    window.addEventListener("wheel", on, opts); window.addEventListener("touchmove", on, opts); window.addEventListener("keydown", on, { once: true });
    return () => { window.removeEventListener("wheel", on); window.removeEventListener("touchmove", on); window.removeEventListener("keydown", on); };
  }, []);
  // This device's copy (indices and marks only: nothing taught or typed is kept in the browser). The position kept is
  // where the learner stopped (the anchor: a dwell, a jump, a Continue), not merely whatever is on screen.
  const sessionId = session?.id ?? null;
  const persist = useCallback(() => {
    const s = jRef.current;
    if (!sessionId || !s) return;
    try { window.localStorage.setItem(journeyKey(sessionId), JSON.stringify(savedJourney(s, new Date(), anchor.current))); } catch { /* this visit only */ }
  }, [sessionId]);
  useEffect(() => { if (journey) persist(); }, [journey, persist]);
  // SCHOLAR-CONTINUITY-01 (790): the position on the server, written on meaningful moves only (learn-position.ts PositionSync):
  // a lesson after its dwell, a jump, Continue, a learning mark -- at once; scrolling -- at most every 15 s; leaving the page
  // (hidden, pagehide) -- what is unsent, with keepalive. Never before the learner engages. 790 absent: nothing is written.
  const syncSession = session?.id ?? null;
  useEffect(() => {
    if (!syncSession) return;
    const read = (): PositionDraft | null => {
      const s = sessionRef.current, j = jRef.current;
      if (!s || !j) return null;
      const at = s.steps[anchor.current] ?? s.steps[j.current];
      if (!at) return null;
      const far = s.steps[Math.max(j.revealedUpTo, anchor.current)] ?? at;
      const practice = !!practiceRef.current[at.step];
      return {
        step: at.step, furthestStep: Math.max(far.step, at.step), cardId: `lesson-${at.step}${practice ? ":practice" : ""}`, sectionChunkId: at.sections[0]?.chunkId ?? null,
        offsetHint: offsetIn(at.step), lastCompletedActivity: lastDone.current?.activity ?? null, lastCompletedAt: lastDone.current?.at ?? null,
        unfinished: practice ? { v: 1, practiceOpen: at.step } : null,
      };
    };
    const sync = new PositionSync({ deviceId: deviceIdOf(), read, send: (p, o) => sendPosition(syncSession, p, o.keepalive) });
    sync.adopt(serverPos.current);
    syncRef.current = sync;
    const onVisibility = () => { if (document.visibilityState === "hidden") sync.hide(); };
    const onHide = () => sync.hide();
    const onScroll = () => { if (engaged.current) sync.touch(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("scroll", onScroll, { capture: true });
      sync.hide(); sync.disable();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [syncSession]);
  // A practice panel opened or closed changes where the learner is in the lesson: written with the next write.
  useEffect(() => { practiceRef.current = practiceOpen; if (engaged.current) syncRef.current?.touch(); }, [practiceOpen]);
  // The server's current_step follows the lesson in view after DWELL_MS (back as well as on: it is where the learner
  // is, so another device resumes there). Never sent before the learner engages, never for the same lesson twice.
  const cur = journey?.current ?? null;
  useEffect(() => {
    if (cur === null || !session?.id) return;
    const t = setTimeout(() => {
      if (!engaged.current || !shouldSendPosition(serverAt.current, cur)) return;
      const st = session.steps[cur];
      if (!st) return;
      serverAt.current = cur; anchor.current = cur; persist();
      void call(`/api/individual/scholar/learn/sessions/${session.id}`, { currentStep: st.step }, "PATCH");
      syncRef.current?.event("lesson");
    }, DWELL_MS);
    return () => clearTimeout(t);
  }, [cur, session, persist]);

  /** The navigator: reveal as far as that lesson, scroll there, load what is saved (never a teach). */
  const jump = useCallback((i: number) => {
    const j = jRef.current;
    if (!session || !j) return;
    const st = session.steps[i];
    if (!st) return;
    engaged.current = true; anchor.current = i; serverAt.current = i; setBanner(null);
    const move = i > j.current ? "skip" : i < j.current ? "revisit" : null;
    dispatch({ type: "jumpTo", index: i });
    if (session.id) void call(`/api/individual/scholar/learn/sessions/${session.id}`, { currentStep: st.step, ...(move ? { move } : {}) }, "PATCH");
    syncRef.current?.event("jump");
  }, [session, dispatch]);
  /** Continue to the next lesson: the learner's own choice. Guided, it is taught; Manual, it opens saved only. */
  const continueOn = useCallback(() => {
    const j = jRef.current;
    if (!session || !j || j.revealedUpTo >= j.count - 1) return;
    const i = j.revealedUpTo + 1, prev = session.steps[j.revealedUpTo];
    const hadThread = (cardsRef.current[prev.step] ?? []).length > 0;
    engaged.current = true; anchor.current = i; serverAt.current = i; setBanner(null);
    dispatch({ type: "chooseContinue", guided });
    if (session.id) void call(`/api/individual/scholar/learn/sessions/${session.id}`, { currentStep: session.steps[i].step, ...(hadThread ? {} : { move: "skip" }) }, "PATCH");
    syncRef.current?.event("continue");
  }, [session, dispatch, guided]);
  async function finish() {
    if (session?.id) await call(`/api/individual/scholar/learn/sessions/${session.id}`, { status: "completed" }, "PATCH");
    setSession(s => (s ? { ...s, status: "completed" } : s));
  }
  // The student says the clarified question is for study: the SAME request, resent with purpose "education".
  async function answerEducation() {
    const p = pending;
    if (!p) return;
    confirmStudy(true);
    if (p.target === "assistant") { await continueWithAssistant(p.question ?? "", "education", p.followUp); return; }
    const r = await act(p.action ?? "", { ...p.extra, purpose: "education" }, p.target, p.asked, p.step);
    if (!r) return;
    // SCHOLAR-EDU-AI-01 s6: no new AI (continuity) keeps what the student typed, so they can try again or carry on.
    if (p.action === "ask") { if (!r.continuity) setAsk(""); }
    else if (p.action === "check" && r.checkQuestion && p.step !== undefined) setCheck({ step: p.step, question: r.checkQuestion, answer: "" });
    else if (p.action === "clarify" && !r.error && !r.continuity) setCheck(null);
  }
  // SCHOLAR-LEARN-FIX-01 L-B: Check my understanding answers a question the Teach Me answer already wrote and the engine
  // checked (teach-format.ts), when it cites only this lesson's own sections -- the clarification is judged against
  // exactly those. Otherwise the existing check action writes one. Either way the answer goes to clarify (the verdict).
  async function startCheck(st: Step, q?: string) {
    const own = q ?? teachQuestionsOf(st)[0];
    if (own) {
      setCheck({ step: st.step, question: questionText(own), answer: "" });
      setTimeout(() => document.getElementById("check-answer")?.focus(), 0);
      return;
    }
    const r = await act("check", {}, "lesson", undefined, st.step);
    if (r?.checkQuestion) setCheck({ step: st.step, question: r.checkQuestion, answer: "" });
  }
  /** An Ask me / Challenge question, answered in the lesson's own check (clarify records the informal verdict). */
  const checkThis = (st: Step, q: string) => { setCheck({ step: st.step, question: q, answer: "" }); setTimeout(() => document.getElementById("check-answer")?.focus(), 0); };
  async function submitCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!check?.answer.trim()) return;
    const c = check, answer = c.answer.trim();
    const r = await act("clarify", { checkQuestion: c.question, answer }, "lesson", `Your answer: ${answer}`, c.step);
    if (r && !r.error && !r.continuity) { setCheck(null); setLastCheck(m => ({ ...m, [c.step]: { question: c.question, answer } })); } // no new AI: the answer stays in the box
  }
  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = ask.trim();
    if (!q) return;
    const history = askThread.slice(0, props.maxTurns).reverse().flatMap(c => [{ speaker: "student", text: c.asked ?? "" }, ...(c.reply.answer ? [{ speaker: "tutor", text: c.reply.answer }] : [])]);
    const r = await act("ask", { question: q, history }, "ask", q);
    if (r && !r.continuity) setAsk(""); // no new AI: the question stays in the box
  }
  /** A teaching approach's request, through the same route and body as every Learn action (allowance, grounding, dedupe). */
  const runApproach = (st: Step) => async (body: Record<string, unknown>): Promise<ApproachResult> => {
    if (!session) return null;
    const { action, ...extra } = body;
    const a = String(action);
    setBusy(a); setBusyAt(st.step); setError(""); setPending(null);
    const r = await call(ACT_URL, studyBody(bodyFor(st, a, { mode, depth }, extra)));
    setBusy(""); setBusyAt(null);
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target: "lesson", action: a, extra, step: st.step }); return null; }
    if (r.json.continuity) return { ok: false, json: { error: r.json.continuity.message } };
    if (r.ok && !r.json.withheld) setProgress(p => ({ ...p, [st.step]: { actions: [...new Set([...(p[st.step]?.actions ?? []), a])], verdict: r.json.verdict?.value ?? p[st.step]?.verdict ?? null } }));
    if (r.json.verdict?.value) dispatch({ type: "verdict", index: indexOf(st.step), value: String(r.json.verdict.value) });
    return r;
  };

  if (!session) {
    return (
      <div aria-live="polite" className="rounded-2xl border border-gray-200 bg-white p-6 text-[14px] text-gray-700">
        {error ? <p role="alert" className="font-medium text-red-700">{error}</p> : "Preparing your learning session from your notes…"}
      </div>
    );
  }
  const count = session.steps.length;
  const j = journey;
  const shownUpTo = j ? j.revealedUpTo : Math.max(0, indexOf(at));
  const curIdx = j ? j.current : Math.max(0, indexOf(at));
  const navLessons: NavLesson[] = session.steps.map((s, i) => ({
    index: i, title: s.title || `Lesson ${i + 1}`, revealed: i <= shownUpTo,
    status: j ? lessonStatus(j, i, progress[s.step]) : { label: "Not started", icon: "none", current: i === curIdx },
  }));
  const read = j ? readCount(j, session.steps.map(s => progress[s.step])) : 0;
  // Three columns only when the content area is wide enough (a container query, not a new viewport breakpoint): on a
  // tablet beside the app sidebar the 240px + 300px columns left the lesson too narrow and pushed Ask Scholar off-screen.
  const panel = (name: typeof tab) => (tab === name ? "block" : "hidden @min-[66rem]:block");
  // SCHOLAR-GUIDED-LEARNING-01: the lesson as the learner meets it. Go deeper and Examples sit in the activity row.
  const group = groupActions(props.actions, props.startAction);
  const more = group.more.filter(a => a !== "deeper" && a !== "examples");
  const off = props.actions.filter(a => a !== "ask" && offReason(a));
  const frontier = session.steps[shownUpTo];
  const lastLesson = shownUpTo >= count - 1;
  const onNext = () => (curIdx < shownUpTo ? jump(curIdx + 1) : continueOn());
  // Wider Learn-from modes the learner may choose, beneath a lesson the notes could not fully support. Choosing one
  // switches Learn from (remembered like the selector) and teaches the lesson again from it. Never chosen for them.
  const expansionsFor = (c: Card, st: Step): Expansion[] => {
    const r = c.reply;
    if (c.target === "ask" || !isOpenable(r.action) || !props.consent) return [];
    if (!(r.withheld || r.salvage || replyState(r) === "partial")) return [];
    return expansionChoices(mode, modes).map(m => ({
      label: EXPANSION_LABEL[m],
      onChoose: () => { setMode(m); if (r.action === props.startAction) void teachLesson(st.step, { mode: m, depth }); else void act(r.action, { mode: m }, "lesson", undefined, st.step); },
    }));
  };
  // The check, answered where its question is: under the lesson's own question, or (a written check) after the lesson.
  const checkForm = (inline: boolean) => check && (
    <form onSubmit={submitCheck} className="mt-2 rounded-xl border border-violet-200 bg-white p-3">
      {!inline && <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-violet-900">Check your understanding</p>}
      {!inline && <p className="mt-1 text-[14.5px] font-semibold text-gray-900">{check.question}</p>}
      <label htmlFor="check-answer" className={`${inline ? "" : "mt-2 "}block text-[12.5px] font-semibold text-gray-700`}>Your answer</label>
      <textarea id="check-answer" rows={3} maxLength={QUESTION_MAX} value={check.answer} onChange={e => setCheck({ ...check, answer: e.target.value })}
        className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} />
      <p className="mt-1 text-[12px] text-gray-600">{INFORMAL_CHECK_LABEL}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !check.answer.trim()}>{busy === "clarify" ? "Checking…" : "Check my answer"}</button>
        <button type="button" className={ghost} onClick={() => setCheck(null)}>Skip the check</button>
      </div>
    </form>
  );

  /** One lesson of the journey: its explanation (or a calm placeholder), then its activities, each on demand. */
  const lesson = (st: Step, i: number) => {
    const thread = cards[st.step] ?? [];
    const lastTeach = lastTeachOf(st);
    const teachQuestions = teachQuestionsOf(st);
    const preparing = Object.values(loading).find(l => l.step === st.step) ?? null;
    const hasLesson = thread.some(c => c.target !== "ask" && c.reply.action === props.startAction);
    const lessonMsg = lessonNote[st.step];
    const taughtWith = taught[st.step];
    const settingsChanged = !!taughtWith && (taughtWith.mode !== mode || taughtWith.depth !== depth);
    const busyHere = !!busy || !!preparing;
    const working = (a: string) => busy === a && busyAt === st.step;
    const myCheck = check?.step === st.step ? check : null;
    const offerCheck = props.checks !== "off" && props.consent && thread.some(c => c.reply.answer && c.reply.action !== "clarify");
    const canCheck = offerCheck && !myCheck && !busy && !offReason("check");
    const verdict = progress[st.step]?.verdict ?? j?.activities[i]?.verdict ?? null;
    const checked = !!verdict || thread.some(c => !!c.reply.verdict);
    const checkInline = !!myCheck && !!lastTeach && teachQuestions.some(q => questionText(q) === myCheck.question);
    const acts = j?.activities[i] ?? {};
    const canTeach = !!group.primary && props.consent && !offReason(group.primary);
    const first = st.sections[0];
    const applyHref = first ? `/individual/scholar/study/apply?section=${first.chunkId}&from=teach` : null;
    const offered = offeredApproaches(props.actions, verdict, !!lastCheck[st.step]);
    const parts = lastTeach ? parseTeachAnswer(lastTeach.reply.answer!) : null;
    const draft = {
      front: plain(teachQuestions[0] ? questionText(teachQuestions[0]) : `What are the key points of ${st.title || "this lesson"}?`, 300),
      back: plain(parts?.points.length ? parts.points.map(p => `- ${p}`).join("\n") : st.objective || "", 600),
    };
    const items: Activity[] = [
      ...(group.primary ? [{ key: "understand", label: "Understand", done: hasLesson, disabled: hasLesson || busyHere || !canTeach,
        onClick: () => dispatch({ type: "requestTeach", index: i }) }] : []),
      ...(props.actions.includes("deeper") ? [{ key: "deeper", label: working("deeper") ? "Working…" : "Mechanisms", done: !!acts.deeper, disabled: busyHere || !props.consent || !!offReason("deeper"),
        describedBy: offReason("deeper") ? "learn-ai-why" : undefined, onClick: () => void act("deeper", {}, "lesson", undefined, st.step) }] : []),
      ...(props.actions.includes("examples") ? [{ key: "examples", label: working("examples") ? "Working…" : "Examples", done: !!acts.examples, disabled: busyHere || !props.consent || !!offReason("examples"),
        describedBy: offReason("examples") ? "learn-ai-why" : undefined, onClick: () => void act("examples", {}, "lesson", undefined, st.step) }] : []),
      ...(offerCheck ? [{ key: "check", label: working("check") ? "Writing a check…" : checked ? "Check again" : "Check", done: checked, disabled: !canCheck || busyHere,
        describedBy: offReason("check") ? `learn-check-why-${st.step}` : undefined, onClick: () => void startCheck(st) }] : []),
      { key: "practise", label: "Practise", pressed: !!practiceOpen[st.step], done: !!acts.practised, onClick: () => setPracticeOpen(m => ({ ...m, [st.step]: !m[st.step] })) },
      ...(applyHref ? [{ key: "apply", label: "Apply", done: !!acts.applied, onClick: () => { dispatch({ type: "activity", index: i, kind: "applied" }); router.push(carry(applyHref)); } }] : []),
      { key: "evaluate", label: "Evaluate", onClick: () => router.push(carry(evaluationHref())) },
    ];
    const status = navLessons[i].status.label;
    return (
      <LessonCard key={st.step} step={st.step} index={i} count={count} title={st.title || lastTeach?.reply.lesson?.title || ""} objective={st.objective || lastTeach?.reply.lesson?.objective || ""} status={status} accent={accent}>
        {/* Nothing here yet: a calm line and the one way in (the learner's choice). Manual: the starting action, as before. */}
        {!hasLesson && !preparing && !lessonMsg && pending?.step !== st.step && (
          !props.consent ? <LessonPlaceholder label="" note="Learning needs AI help, which is off." />
            : group.primary ? <LessonPlaceholder note="Not opened yet." label={working(group.primary) ? "Working…" : `${props.labels[group.primary as LearnAction]} this lesson`}
                disabled={busyHere || !canTeach} describedBy={offReason(group.primary) ? "learn-ai-why" : undefined}
                onTeach={() => (guided ? dispatch({ type: "requestTeach", index: i }) : void act(group.primary!, {}, "lesson", undefined, st.step))} />
              : <LessonPlaceholder label="" note="Ask Scholar anything about this lesson." />
        )}
        {pending?.target === "lesson" && (pending.step ?? at) === st.step && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-4" onEducation={() => void answerEducation()} onPatient={() => confirmStudy(false)} />}
        <div className="mt-4 space-y-4">
          {thread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} onFresh={c.reply.saved && props.consent ? () => act(c.reply.action, { fresh: true }, "lesson", undefined, st.step) : undefined}
            onRephrase={props.actions.includes("ask") ? () => rephrase("") : undefined} recover={recoverFor(c, st)} wider={widerFor(c, st)} expansions={expansionsFor(c, st)}
            onAnswer={canCheck && c === lastTeach ? q => void startCheck(st, q) : undefined} canAnswer={q => answerable(st, c.reply, q)}
            renderCheck={c === lastTeach && checkInline ? q => (questionText(q) === myCheck?.question ? checkForm(true) : null) : undefined} />)}
          {preparing && (
            <div role="status" className="flex items-start gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
              <span aria-hidden="true" className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-full motion-safe:animate-pulse" style={{ background: accent }} />
              <span className="min-w-0">
                <span className="block text-[14px] font-semibold text-gray-900">{preparingText(preparing.mode)}</span>
                {st.title && <span className="block break-words text-[13px] text-gray-700">{st.title}</span>}
              </span>
            </div>
          )}
          {lessonMsg && !preparing && (
            <div role="status" className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-[13.5px] text-gray-800">
              <p>{lessonMsg.message}</p>
              <button type="button" className={`${ghost} mt-2`} disabled={busyHere} onClick={() => void teachLesson(st.step, lessonMsg.settings)}>Try again</button>
            </div>
          )}
          {busy && busyAt === st.step && busy !== "ask" && busy !== "clarify" && <p role="status" className="text-[13px] text-gray-500">{mode === "research" ? "Scholar is reading your notes and searching published research…" : "Scholar is reading your notes…"}</p>}
        </div>
        {myCheck && !checkInline && <div className="mt-4">{checkForm(false)}</div>}
        {offerCheck && offReason("check") && <p id={`learn-check-why-${st.step}`} className="mt-2 text-[12.5px] text-gray-600">{aiReasonCopy(offReason("check")!, "scholar").text}</p>}
        {settingsChanged && group.primary && props.consent && (
          <button type="button" className={`${ghost} mt-3`} disabled={busyHere || !!offReason(group.primary)} onClick={() => void teachLesson(st.step, { mode, depth })}>Teach this lesson again with these settings</button>
        )}

        <ApproachControl offered={offered} value={approachOf[st.step] ?? null} onChange={a => setApproachOf(m => ({ ...m, [st.step]: a }))}
          onTeach={() => (!hasLesson ? dispatch({ type: "requestTeach", index: i }) : props.actions.includes("explain") ? void act("explain", {}, "lesson", undefined, st.step) : scrollToLesson(st.step))}
          onExplain={props.actions.includes("explain") ? () => void act("explain", {}, "lesson", undefined, st.step) : undefined}
          verdict={verdict} checks={thread.filter(c => !!c.reply.verdict).length}
          run={runApproach(st)} onQuestion={q => checkThis(st, q)} lastCheck={lastCheck[st.step] ?? null} depth={depth} disabled={busyHere || !props.consent} accent={accent} />

        <ActivityRow label={`Activities for lesson ${i + 1}`} items={items} />

        {/* More learning options (Simplify, Summarise...), behind one disclosure; Ask Scholar stays in view. */}
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {more.length > 0 && (
            <details className="group min-w-0 flex-1 basis-[220px] rounded-xl border border-gray-200">
              <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
                <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>More learning options
              </summary>
              <div className="flex flex-wrap gap-2 border-t border-gray-200 px-3 py-2.5" role="group" aria-label="More learning options">
                {more.map(a => (
                  <button key={a} type="button" disabled={busyHere || !props.consent || !!offReason(a)} aria-describedby={offReason(a) ? "learn-ai-why" : undefined} onClick={() => act(a, {}, "lesson", undefined, st.step)}
                    className={`${chip} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>
                    {working(a) ? "Working…" : props.labels[a as LearnAction]}
                  </button>
                ))}
              </div>
            </details>
          )}
          {group.ask && <button type="button" onClick={() => rephrase("")} className={`${chip} min-h-[44px] border-gray-300 bg-white text-gray-800 hover:bg-gray-50`}>{props.labels.ask}</button>}
        </div>

        <LessonPractice open={!!practiceOpen[st.step]} onToggle={o => setPracticeOpen(m => (!!m[st.step] === o ? m : { ...m, [st.step]: o }))}
          chunkId={first?.chunkId ?? null} materialId={first?.materialId ?? null} draft={draft} ownCards={!!props.ownCards}
          aiAllowed={props.consent && !offReason("questions")} applyHref={applyHref} accent={accent}
          teachBack={props.actions.includes("teach_back" as LearnAction) ? () => setApproachOf(m => ({ ...m, [st.step]: "teach_back" })) : undefined}
          onPractised={() => dispatch({ type: "activity", index: i, kind: "practised" })} onApplied={() => dispatch({ type: "activity", index: i, kind: "applied" })} />
      </LessonCard>
    );
  };

  return (
    <div className="@container">
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
      <p aria-live="polite" className="sr-only">{announce}</p>

      <div role="tablist" aria-label="Workspace" className="mb-3 flex gap-2 @min-[66rem]:hidden">
        {(["lesson", "sources", "ask"] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
            className={`${chip} ${tab === t ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800"}`}>{t === "lesson" ? "Lesson" : t === "sources" ? "Sources" : "Ask Scholar"}</button>
        ))}
      </div>

      <div className="@min-[66rem]:grid @min-[66rem]:grid-cols-[240px_minmax(0,1fr)_300px] @min-[66rem]:items-start @min-[66rem]:gap-5">
        {/* ── THE NAVIGATOR AND SOURCES: the lessons with their marks, and the current lesson's own sections ── */}
        <aside aria-label="Lessons and sources" className={`${panel("sources")} rounded-2xl border border-gray-200 bg-white p-4 @min-[66rem]:sticky @min-[66rem]:top-4 @min-[66rem]:max-h-[calc(100vh-2rem)] @min-[66rem]:overflow-y-auto`}>
          <p className="text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">Your lessons</p>
          <p className="mt-0.5 text-[12px] text-gray-600">{read} of {count} read. A learning record for you, not an assessment.</p>
          <div className="mt-2"><JourneyOutline lessons={navLessons} onJump={jump} /></div>
          {step && (
            <>
              <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.12em] text-gray-500">This lesson&apos;s sources</p>
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

        {/* ── THE JOURNEY: the lessons revealed so far, one after another; the settings once, above them ── */}
        <div ref={column} className={`${panel("lesson")} min-w-0 space-y-4`} onPointerDown={() => { engaged.current = true; }}>
          {banner !== null && session.steps[banner] && (
            <ResumeBanner lesson={banner + 1} title={session.steps[banner].title} onGo={() => { const b = banner; setBanner(null); jump(b); }} onDismiss={() => setBanner(null)} />
          )}
          {/* Lesson settings: secondary, collapsed, and in force for every lesson's requests. */}
          <details className="group rounded-xl border border-gray-200 bg-white">
            <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13.5px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
              <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>Lesson settings
              <span className="min-w-0 truncate text-[12px] font-normal text-gray-600">· {LEARN_MODE_LABEL[mode]} · {DEPTH_LABEL[depth]}</span>
            </summary>
            <div className="space-y-3 border-t border-gray-200 px-3 py-3">
              <label className="flex items-start gap-2 text-[13.5px] text-gray-900">
                <input type="checkbox" checked={guided} onChange={e => setGuided(e.target.checked)} className={`mt-0.5 h-4 w-4 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
                <span><span className="font-semibold">Teach each lesson when I continue to it</span>
                  <span className="block text-[12px] text-gray-600">Off: choose {props.labels[props.startAction]} for each lesson yourself. Saved on this device. Scholar never moves to the next lesson for you, and scrolling never asks it to write anything.</span></span>
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700"><span id="learn-depth-l">Depth</span>
                <DepthSegment value={depth} onChange={setDepth} disabled={!!busy} accent={accent} />
              </div>
              {modes.length > 1 && (
                <fieldset className="rounded-xl border border-gray-200 px-3 py-2">
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
            </div>
          </details>
          {props.consent && off.length > 0 && (
            <p id="learn-ai-why" className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">
              <span className="font-semibold">Not available yet: {off.map(a => props.labels[a]).join(", ")}.</span> {aiReasonCopy(offReason(off[0])!, "scholar").text}
            </p>
          )}

          {session.steps.slice(0, shownUpTo + 1).map((st, i) => lesson(st, i))}

          {/* The end of the journey so far: reaching it asks for nothing; moving on is the learner's choice. */}
          <div data-journey-end aria-hidden="true" className="h-px" />
          {frontier && (
            <ContinueCard accent={accent} last={lastLesson} completed={session.status === "completed"} disabled={!!busy}
              next={!lastLesson ? { number: shownUpTo + 2, title: session.steps[shownUpTo + 1].title || `Lesson ${shownUpTo + 2}` } : null}
              onContinue={continueOn} onFinish={() => void finish()} onReview={() => jump(0)}
              onDeeper={props.actions.includes("deeper") && props.consent && !offReason("deeper") ? () => void act("deeper", {}, "lesson", undefined, frontier.step) : undefined}
              onPractise={() => { setPracticeOpen(m => ({ ...m, [frontier.step]: true })); scrollToLesson(frontier.step); }}
              otherTopicHref={experienceHref("scholar", "study/learn")} />
          )}

          {/* Below 66rem of content width: the compact navigator (it replaces the old Previous/Next bar). */}
          <JourneyBar lessons={navLessons} current={curIdx} read={read} onJump={jump}
            trailing={!(curIdx >= shownUpTo && lastLesson) && !j?.endVisible ? <button type="button" className={`${btn} px-3`} style={{ background: accent }} onClick={onNext} disabled={!!busy && curIdx >= shownUpTo}>Next lesson</button> : null} />
        </div>
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
          {pending?.target === "ask" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-3" onEducation={() => void answerEducation()} onPatient={() => confirmStudy(false)} />}
          <div aria-live="polite" className="mt-3 space-y-3">
            {askThread.map(c => <ReplyCard key={c.id} card={c} labels={props.labels} compact onRephrase={() => rephrase(c.asked ?? "")} recover={recoverFor(c, step)} />)}
          </div>
          {props.consent && step && (
            <div className="mt-4 border-t border-gray-100 pt-3">
              <button type="button" className={ghost} disabled={!!busy} onClick={() => void continueWithAssistant(ask.trim() || `Teach me: ${step.title}`)}>
                {busy === "assistant" ? "Asking your assistant…" : "Continue with your personal assistant"}
              </button>
              <p className="mt-1 text-[12px] text-gray-600">Your general personal AI, given this step&apos;s sections. Its answers are not checked against your notes.</p>
              <div className="mt-2"><DepthControl value={paDepth} onChange={setPaDepth} disabled={!!busy} /></div>
              {pending?.target === "assistant" && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-3" onEducation={() => void answerEducation()} onPatient={() => confirmStudy(false)} />}
              <div aria-live="polite" className="mt-3 space-y-3">
                {assist.map((a, i) => {
                  const asked = a.followUp ? `${FOLLOW_UP_LABEL[a.followUp]}: ${a.asked}` : a.asked;
                  const body = a.error ? <p className="mt-1 text-[13px] text-red-800">{a.error}</p>
                    : <div className="mt-1.5"><PersonalAiAnswer text={a.answer ?? ""} streaming={a.streaming} sources={a.sources} research={modes.includes("research")}
                        save={props.ownCards && props.materials.length ? { materials: props.materials, materialId: step.sections[0]?.materialId ?? null } : null} /></div>;
                  // SCHOLAR-PAI-EXPERIENCE-01: the newest reply in full; earlier ones fold to their question.
                  if (i > 0) return (
                    <details key={a.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50">
                      <summary className={`flex min-h-[40px] cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-[12.5px] text-gray-700 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                        <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{PERSONAL_AI_LABEL}</span>
                        <span className="min-w-0 flex-1 truncate"><span className="font-semibold">You:</span> {asked}</span>
                      </summary>
                      <div className="px-3 pb-3">{body}</div>
                    </details>
                  );
                  return (
                    <article key={a.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3">
                      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{PERSONAL_AI_LABEL}</p>
                      <p className="mt-1 text-[12.5px] text-gray-600"><span className="font-semibold">You:</span> {asked}</p>
                      {body}
                      {!a.error && !a.streaming && a.answer && (
                        <div className="mt-3 border-t border-indigo-100 pt-2">
                          <FollowUpActions disabled={!!busy} onPick={k => void continueWithAssistant(a.asked, undefined, { kind: k, previousQuestion: a.asked, previousAnswer: a.answer ?? "" })} />
                        </div>
                      )}
                    </article>
                  );
                })}
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
