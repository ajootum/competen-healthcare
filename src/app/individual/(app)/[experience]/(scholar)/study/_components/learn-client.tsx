"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { ResizeHandle } from "@/components/ui/resizable";
import { SCHOLAR, experienceHref } from "@/lib/individual/experiences";
import { INFORMAL_CHECK_LABEL, LEARN_MODE_LABEL, NOT_IN_NOTES_LABEL, PERSONAL_AI_LABEL, QUESTION_MAX, SOURCE_KIND_LABEL, type LearnAction } from "@/lib/individual/scholar/config";
import type { SessionView } from "@/lib/individual/scholar/learn-view";
import { evaluationHref, sourceHref } from "./question-view";
import { AiBadge } from "./client";
import { AiFlagList, GovernedReferenceList } from "./learn-kinds";
import { AiFeedback } from "./ai-feedback";
import ClarifyPurpose from "@/app/individual/_components/ai/ClarifyPurpose";
import { aiReasonCopy, clarifyFrom, type AiUnavailableReason, type ClarifyPrompt } from "@/lib/individual/ai-availability";
import { useAiAvailabilityOf } from "@/app/individual/_components/ai/AiAvailabilityContext";
import { FormativeAiLabel } from "./edu-notice";
import { RecoveryFlow, type Expansion, type ExplainOutcome, type RecoveryRequestBody } from "./evidence-recovery";
import {
  EXPANSION_LABEL, GUIDED_KEY, LessonRequests, expansionChoices, groupActions, guidedValue, isGuided, isOpenable, lessonKey, lessonPhase, preparingText, shouldAutoTeach,
  type LearnMode, type LessonSettings,
} from "@/lib/individual/scholar/guided-learn";
import {
  PRIMARY_LABEL, createJourney, journeyFacts, journeyKey, journeyStep, lessonFacts, lessonStatus, parseSavedJourney, primaryAction, progressiveSplit, readCount, savedJourney, startJourney,
  type JourneyEffect, type JourneyEvent, type JourneyState, type LessonFacts, type LessonRecord,
} from "@/lib/individual/scholar/learn-journey";
import { DEVICE_KEY, PositionSync, mergeResume, newDeviceId, type PositionDraft, type PositionPut, type ServerPosition, type SyncResult } from "@/lib/individual/scholar/learn-position";
import { PlaceScheduler, cardIdFor, choosePlace, lessonAnchorId, lessonAnchorPrefix, offsetPercent, parseCardId, parseLocalPlaces, pickAnchor, placeKey, placeScrollTop, withLocalPlace, type Place } from "@/lib/individual/scholar/learn-place";
import { SPELLING_CHOICES, SPELLING_CHOICE_LABEL, readSpellingChoice, spellingField, writeSpellingChoice, type SpellingChoice } from "@/lib/individual/scholar/spelling-variant";
import { LEARN_NOT_COVERED_LABEL, LEARN_NOT_COVERED_NOTE, LEARN_WIDER_LABEL, RECOVERY_EXPLANATION_LABEL, RECOVERY_NOT_USED_LABEL } from "@/lib/individual/scholar/config";
import type { ReadingLink } from "@/lib/individual/scholar/evidence-recovery";
import { STUDY_EVENT, carry } from "./study-active";
import { citationSegments, citedTags, parseTeachAnswer, questionText, replyState, type LearnGrounding } from "@/lib/individual/scholar/teach-format";
import { draftOwnCard } from "@/lib/individual/scholar/own-card-draft";
import { DepthControl, FollowUpActions, PersonalAiAnswer, askPersonalAi } from "@/app/individual/_components/ai/PersonalAiAnswer";
import { FOLLOW_UP_LABEL, type FollowUp, type FollowUpKind, type PersonalAiDepth, type PersonalAiSourceRef } from "@/lib/individual/personal-ai-options";
import { JourneyBar, JourneyOutline, type NavLesson } from "./learn-journey-nav";
import { usePaneGrid } from "@/components/ui/pane-grid";
import { LibraryNotes } from "./library-notes-client";
import { LearnVisuals } from "./learn-visuals";
import { GoDeeperCard, type GoDeeperLevels } from "./go-deeper-view";
import { GUIDE_FRESH, GuideMePanel, type GuideState } from "./guide-me-panel";
import { guideVerdictOf } from "@/lib/individual/scholar/guide-me";
import { GO_DEEPER_COPY, deeperSourcedText, parseDeeperAnswer } from "@/lib/individual/scholar/deeper-format";
import { ReadAloudButton, SpeechSetting } from "@/app/individual/_components/speech/speech-buttons";
import { AskAbout, type AskAboutProps } from "./ask-panel";
import { ASK_CHUNK_MAX, askPrefill } from "@/lib/individual/scholar/ask-context";
import { ActivityRow, ContinueCard, DEPTH_LABEL, DepthSegment, DownloadLink, LessonCard, LessonList, LessonPlaceholder, ResumeBanner, lessonDomId, lessonExportHref, lessonHeadingId, materialExportHref, type Activity, type LessonRow } from "./learn-lesson-card";
import { LessonPractice } from "./learn-practice";
import { LessonReader } from "./learn-reader";
import { RecutPanel } from "./learn-recut-panel";
import { WORKS_WITHOUT_AI } from "@/lib/individual/scholar/learn-reader";
import { ApplyCard, QuickCheck, RecallBlock, type BlockCard } from "./learn-inline-check";
import { INLINE_DEFAULTS, RECALL_WAIT_REASON, applicationAfter, applyEligible, blockPending, checkBlocks, inlineCheckPlacement, lessonCanContinue, marksFromActivities, quickFromCode, recallContent, recallFromCode, wordCount, type CheckBlock, type InlinePolicy } from "@/lib/individual/scholar/learn-inline";
import { TEACHING_AI_ACTIVITY, isTeachingAction } from "@/lib/individual/scholar/config";
import { ApproachControl, type ApproachMemory, type ApproachResult } from "./learn-approach";
import { STYLE_DEFAULTS, effectiveStyle, mistakeOffer, moreItems, styleChoices, styleCode, type StylePolicy, type TeachingStyle } from "@/lib/individual/scholar/learn-style";
import { CHECK_BUTTON, CHECK_FEEDBACK_HEADING, CHECK_NO_AI_WHY, CHECK_PROCESSING, CHECK_SELF_REVIEW_LABEL, CHECK_SELF_REVIEW_NOTE, parseCheckFeedback, referenceAnswer, type CheckFeedbackParts, type CheckNoAiReason } from "@/lib/individual/scholar/learn-check";
import { CHECK_MARKING_LABEL, CHECK_NOT_SAVED_NOTE, CHECK_SAVED_NOTE, SELF_GRADE_LABEL, SELF_GRADE_SAID, checkOutcomeLabel, isCheckVerdict, placeChecks, type CheckHistoryItem, type CheckPlacement, type SelfGrade } from "@/lib/individual/scholar/learn-check-record";
import { CHECK_VERDICT_LABEL } from "@/lib/individual/scholar/config";
import { AdaptiveNext, type AdaptiveUi, type AdaptiveView } from "./learn-adaptive";
import { CONFIDENCE_LABEL, CONFIDENCE_VALUES, NEED_LABEL, pickDifferentQuestion, type StatedConfidence } from "@/lib/individual/scholar/learning-need";
import { DisclaimerBadge, ActionRow, CitationChip, FeedbackParts, InlineNote, LearningDisclosure, LearningIcon, LearningSection, LearningSectionHead, NotesText, QuestionCard, RefChip, SectionCard, SourceLink, VerdictLine, learnAction, learnBox, learnTone, type FeedbackKind } from "@/components/ui/scholar-learning";
import { shortRef } from "@/lib/individual/scholar/notes-layout";
import type { CognitiveLevel } from "@/lib/individual/scholar/question-intel";
// SCHOLAR-SEARCH-HISTORY-01: an answered Ask Scholar question is kept in the learner's own history (their words and where, never the answer).
import { recordHistory } from "@/lib/individual/scholar/search-history-capture";
import { HistoryNotice, useSearchHistoryChoice } from "@/app/individual/_components/SearchHistoryChoice";

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
//
// SCHOLAR-PERSISTENT-LEARNING-01 (owner, 1 Nov): ONE ACTIVE LESSON. The active lesson is shown in full; every other lesson
// is a compact row (title, state in words and an icon, its one way in) -- tap to make it active. The active lesson is the
// learner's choice (a tap, Next lesson, Previous, Resume), never the lesson scrolled into view, and only that choice moves
// the server's current_step and the 790 position. Each lesson's state (read / taught / completed / assessed) comes from
// the server records (learn-journey.ts lessonFacts), so nothing learned is hidden by where the position stands. Saved
// teaching -- under any prompt version, depth or mode -- opens with no AI call; restoring a session never generates.

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
/** `aiRead` / `aiReadNote`: the section's text was read from a slide or page picture by AI (extract.ts aiReadLabel), set by the server. */
type Source = { tag: string; chunkId: string; materialId: string; materialTitle: string; citation: string; excerpt?: string; aiRead?: boolean; aiReadNote?: string };
type Reference = { tag: string; title: string; code: string | null; outcome: string | null; status: string; approved?: boolean; library?: boolean };
/** COMPETEN-RESEARCH-01: one external record, exactly as the provider returned it. Untagged = further reading only. */
type ExternalRef = { tag: string | null; provider: string; title: string; journal: string | null; year: number | null; authors: string[]; pmid: string | null; doi: string | null; url: string; evidence: boolean; excerpt: string | null; verified: { pmid: boolean; doi: boolean | null };
  /** SCHOLAR-SOURCE-QUALITY-01: why it is reading only (absent on answers saved before it). */
  notUsed?: keyof typeof RECOVERY_NOT_USED_LABEL | null };
type ResearchReply = { state: string; label: string; message: string | null; query?: string | null; scholarLink?: string | null; references: ExternalRef[]; text?: string; cited?: number[]; withheld?: string; excludedCount?: number };
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
  /** SCHOLAR-PERSISTENT-LEARNING-01: a lesson saved under another prompt version or depth, opened with no AI call. */
  savedEarlier?: { label: string; promptVersion: string; depth: string } | null;
  /** Item 8: an Ask question's everyday-word slips corrected on the server (spelling.ts, deterministic); `original` as typed. */
  spelling?: { original: string; display: string; corrections: { from: string; to: string }[] } | null;
  /** LEARNING-CLOSE-2026-11 D01: a judged check answer was kept in the learner's learning record (its attempt), or null. */
  kept?: { attemptId: string; answeredAt: string; questionId: string; marking: string; chunkId: string; materialId: string } | null;
  /** SALE-2026-11 R1: the next teaching step for a kept check, with its reason (kept on the same attempt). */
  adaptive?: AdaptiveView | null;
  /** SCHOLAR-CUMULATIVE-TEACHING-01: Go deeper found nothing further of value in the notes (or its round limit): no lesson, the next activity suggested. */
  depthReached?: { message: string; suggestion: string | null; next: readonly { key: string; label: string }[]; rounds?: number; cap?: boolean } | null;
  /** SCHOLAR-CUMULATIVE-TEACHING-01: on an open, the lesson's other saved teaching (Go deeper rounds, examples ...), oldest first, no AI. */
  alsoSaved?: Reply[];
  /** SCHOLAR-GO-DEEPER-001: policy offers structured rounds, so the level control is drawn. A saved structured round shows whatever this says. */
  goDeeperLevels?: boolean;
  /** The depth this reply was written at: a Go deeper round's level. */
  depth?: string;
};
/** `extra` and `target`: the request as it was made, so "Explain using approved references" can make it again. `step`: the lesson it belongs to. */
type Card = { id: number; asked?: string; reply: Reply; extra?: Record<string, unknown>; target?: "lesson" | "ask"; step?: number };
type Recover = { request: RecoveryRequestBody; explain: (rec: { id: string; mode: RecoveryRequestBody["mode"]; question: string }) => Promise<ExplainOutcome> };
/** AI operating modes: a clarify question put to the student instead of a refusal, and the request to resend if it is for study. */
type Pending = { prompt: ClarifyPrompt; target: "lesson" | "ask" | "assistant"; action?: string; extra?: Record<string, unknown>; asked?: string; question?: string; followUp?: FollowUp; step?: number };
type Step = SessionView["steps"][number];
/** SCHOLAR-UNDERSTANDING-CHECKS-01: one open understanding check (learn-check.ts). */
type CheckState = {
  step: number; question: string; raw: string | null; answer: string; feedback: Reply | null; cardId: number | null; noAi: CheckNoAiReason | null; reviewing: boolean;
  /** LEARNING-CLOSE-2026-11 D01: whether this answer is kept in the learning record (the act route keeps a judged one; the checks route a self-graded or unmarked one). */
  saved: "saving" | "saved" | "failed" | null; selfGrade: SelfGrade | null;
  /** SALE-2026-11 R1: how sure the learner said they were (optional), and the question's level where a Challenge set it. */
  confidence?: StatedConfidence | null; level?: CognitiveLevel | null;
};
const openCheck = (step: number, raw: string, answer = "", level: CognitiveLevel | null = null): CheckState => ({ step, question: questionText(raw), raw, answer, feedback: null, cardId: null, noAi: null, reviewing: false, saved: null, selfGrade: null, confidence: null, level });

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
/** The nearest scrolling ancestor of an element (the app shell may scroll rather than the window), or null for the window. */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let p = el?.parentElement ?? null; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}
/**
 * SCHOLAR-LEARN-GAPS-02 item 2: WHERE in the active lesson the reading band (35% down the screen) is: the nearest section's
 * anchor (the fixed ids in the lesson card, learn-place.ts) and a coarse 0-100. Read only when a write is made.
 */
function readPlace(stepNo: number): { anchor: string | null; offset: number | null } {
  try {
    const card = document.getElementById(lessonDomId(stepNo));
    if (!card) return { anchor: null, offset: null };
    const sc = scrollParent(card);
    const frame = sc ? sc.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const band = frame.top + frame.height * 0.35;
    const prefix = lessonAnchorPrefix(stepNo);
    const tops = [...card.querySelectorAll<HTMLElement>(`[id^="${prefix}"]`)].map(el => ({ anchor: el.id.slice(prefix.length), top: el.getBoundingClientRect().top }));
    const r = card.getBoundingClientRect();
    return { anchor: pickAnchor(tops, band), offset: offsetPercent({ top: r.top, height: r.height }, band) };
  } catch { return { anchor: null, offset: null }; }
}
/** A flashcard's starting words from the lesson's own text: [S n] tags removed, within the card limits. The learner edits them. */

export function LearnWorkspace(props: {
  initial: SessionView | null; initialProgress: Record<number, { actions: string[]; verdict: string | null }>; start: StartScope | null;
  /** SCHOLAR-CONTINUITY-01 (790): where the learner stopped on any device (null: none, or 790 absent). */
  initialPosition?: ServerPosition | null;
  /** SCHOLAR-PERSISTENT-LEARNING-01: each lesson's server records (saved teaching, attempts), read with no AI. */
  initialRecords?: LessonRecord[];
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
  /** SCHOLAR-LIBRARY-01 (820, policy scholar_learning_library): the learner's own notes, bookmark and highlights on each lesson. */
  notesOn?: boolean;
  /** SCHOLAR-INLINE-CHECKS-01: the six scholar_learn_inline_* policy values (absent: the code fallbacks). */
  inline?: InlinePolicy;
  /** SCHOLAR-INLINE-CHECKS-01: sections with an accepted competency mapping -- the clinical-relevance signal for Apply (learn-inline.ts applyEligible). */
  applyChunkIds?: string[];
  /** SCHOLAR-GUIDE-ME-001: policy scholar_guide_me_adaptive (absent: off, Guide me as it was). */
  guideAdaptive?: boolean;
  /** SCHOLAR-LEARN-STYLE-01: scholar_learn_style_guide / _challenge / scholar_learn_more_menu (absent: all on). Explain is always on. */
  styleOn?: StylePolicy;
  /** SCHOLAR-LESSON-VISUALS-01: policy scholar_lesson_visuals and scholar_lesson_visuals_max_per_section -- the learner's own slide / page pictures under a lesson. */
  visuals?: { on: boolean; max: number };
  /** LEARNING-CLOSE-2026-11 D01 (CYU-03/04): the session's kept understanding checks, per lesson step (the server's, so any device). */
  initialChecks?: Record<number, CheckHistoryItem[]>;
  /** CYU-01: policy scholar_learn_check_placement (absent: distributed). */
  checkPlacement?: CheckPlacement;
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
  // LESSON REDESIGN: below 66rem the lesson, sources and Ask Scholar are panels behind the tabs. Switching panel keeps each
  // panel's own scroll place, so opening Ask Scholar and coming back returns the learner to where they were reading. Only
  // while the tabs are shown (the wide layout shows all three at once and is never scrolled by this).
  const tabRef = useRef(tab);
  const tabScroll = useRef<Partial<Record<"lesson" | "sources" | "ask", number>>>({});
  const tabsShown = () => { const bar = document.getElementById("learn-tabs"); return !!bar && bar.offsetParent !== null; };
  // The lesson's reading place: where the learner last was in the lesson with the tab bar scrolled away (tapping a tab
  // means scrolling up to it first, so the place at the moment of the tap is not where they were reading).
  const readingY = useRef<number | null>(null);
  useEffect(() => {
    const onReadScroll = () => {
      if (tabRef.current !== "lesson" || !tabsShown()) return;
      const bar = document.getElementById("learn-tabs");
      if (bar && bar.getBoundingClientRect().bottom < 0) readingY.current = window.scrollY;
    };
    window.addEventListener("scroll", onReadScroll, { passive: true });
    return () => window.removeEventListener("scroll", onReadScroll);
  }, []);
  const showTab = useCallback((t: "lesson" | "sources" | "ask") => {
    if (t !== tabRef.current && tabsShown()) tabScroll.current[tabRef.current] = tabRef.current === "lesson" && readingY.current !== null ? readingY.current : window.scrollY;
    setTab(t);
  }, []);
  useLayoutEffect(() => {
    if (tabRef.current === tab) return;
    tabRef.current = tab;
    if (!tabsShown()) return;
    const y = tabScroll.current[tab];
    if (y !== undefined) window.scrollTo({ top: y });
    else { const bar = document.getElementById("learn-tabs"); if (bar && bar.getBoundingClientRect().top < 0) bar.scrollIntoView({ block: "start" }); }
  }, [tab]);
  // Drag-to-resize (owner, 1 Nov): the lessons+sources column and Ask Scholar, in the three-column layout only. Today's
  // 240px / 300px are the defaults; each side is at least 200px and the lesson keeps 420px (+ the two 20px dividers).
  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const [, cols] = usePaneGrid({ container: rootEl, minMain: 460, start: { storageKey: "scholar.learn.sources.w", defaultPx: 240 }, end: { storageKey: "scholar.learn.ask.w", defaultPx: 300 } });
  const [progress, setProgress] = useState(props.initialProgress);
  // SCHOLAR-PERSISTENT-LEARNING-01: the server records behind each lesson's state (a resumed scope brings its own).
  const [records, setRecords] = useState<LessonRecord[]>(props.initialRecords ?? []);
  /** Lessons whose saved teaching is being opened (open:true, never AI). */
  const [opening, setOpening] = useState<Record<number, boolean>>({});
  /** The informal check, answered in its own lesson. `lastCheck`: the latest answered one per lesson (Explain my mistake). */
  // SCHOLAR-UNDERSTANDING-CHECKS-01: the check keeps the learner's answer through every outcome. `raw`: the question as the engine
  // wrote it (its [S n] tags name the sections to review). `feedback`: the judgement shown beneath the answer; `cardId`: that reply's
  // card in the thread, hidden while the panel shows it and visible as history after Try again / Continue. `noAi`: why no AI judgement
  // is shown (the self-review takes its place). `reviewing`: Review source is open.
  const [check, setCheck] = useState<CheckState | null>(null);
  /** The latest request's error, with the action and lesson it belongs to, so it is shown where the learner is (the check panel). */
  const [errorAt, setErrorAt] = useState<{ action: string; step: number } | null>(null);
  /** LEARNING-CLOSE-2026-11 D01: the kept checks per lesson, newest first -- the server's at open, plus what this visit keeps. */
  const [checks, setChecks] = useState<Record<number, CheckHistoryItem[]>>(props.initialChecks ?? {});
  const [lastCheck, setLastCheck] = useState<Record<number, { question: string; answer: string }>>({});
  /** SALE-2026-11 R1 (SALE-06/07): the next teaching step per lesson after a kept check, until the learner skips or closes it. */
  const [adaptive, setAdaptive] = useState<Record<number, AdaptiveUi>>({});
  const [ask, setAsk] = useState("");
  const [askThread, setAskThread] = useState<Card[]>([]);
  // Owner D3: the shared personal AI on this step. Its own thread, never mixed into a Learn answer, never saved.
  // SCHOLAR-PAI-EXPERIENCE-01: streamed in as it is written (`streaming`), shown structured, with its depth and follow-ups.
  const [assist, setAssist] = useState<{ id: number; asked: string; answer?: string; error?: string; streaming?: boolean; followUp?: FollowUpKind; sources?: PersonalAiSourceRef[]; label?: string }[]>([]);
  const [paDepth, setPaDepth] = useState<PersonalAiDepth>("standard");
  const [pending, setPending] = useState<Pending | null>(null);
  // SCHOLAR-GUIDED-LEARNING-01: Guided by default (opening a lesson teaches it); Manual is the learner's own choice.
  const rememberedG = useSyncExternalStore(noSubscribe, rememberedGuided, () => null);
  const [chosenGuided, setChosenGuided] = useState<boolean | null>(null);
  const guided = chosenGuided ?? isGuided(rememberedG);
  const setGuided = (on: boolean) => { setChosenGuided(on); try { window.localStorage.setItem(GUIDED_KEY, guidedValue(on)); } catch { /* this visit only */ } };
  // SCHOLAR-LEARN-GAPS-02 item 4: British, American or leave as typed, on this device (spelling-variant.ts says why not the server).
  const rememberedSpelling = useSyncExternalStore(noSubscribe, readSpellingChoice, () => "none" as SpellingChoice);
  const [chosenSpelling, setChosenSpelling] = useState<SpellingChoice | null>(null);
  const spelling: SpellingChoice = chosenSpelling ?? rememberedSpelling;
  const setSpelling = (c: SpellingChoice) => { setChosenSpelling(c); writeSpellingChoice(c); };
  const requests = useRef(new LessonRequests());
  /** Lessons being opened or written, by lesson key: the progress line shows in that lesson. */
  const [loading, setLoading] = useState<Record<string, { step: number; mode: LearnMode }>>({});
  /** A lesson that could not be opened (or a duplicate twin asked to wait): said plainly, with Try again. */
  const [lessonNote, setLessonNote] = useState<Record<number, { message: string; settings: LessonSettings }>>({});
  /** The settings each step's lesson was last taught with (a lesson offers to teach it again with new ones). */
  const [taught, setTaught] = useState<Record<number, LessonSettings>>({});
  /** SCHOLAR-LEARN-STYLE-01: the teaching style chosen for this session (kept in the 790 position, `unfinished.style`), and what each approach last showed in each lesson (switching style costs no AI call). */
  const [styleChosen, setStyleChosen] = useState<TeachingStyle>("explain");
  const styleRef = useRef<TeachingStyle>("explain");
  const [styleMem, setStyleMem] = useState<Record<string, ApproachMemory>>({});
  const [guideStates, setGuideStates] = useState<Record<number, GuideState>>({});
  const remember = useCallback((k: string, m: ApproachMemory) => setStyleMem(o => ({ ...o, [k]: m })), []);
  /** Per lesson: whether Practise is open. */
  const [practiceOpen, setPracticeOpen] = useState<Record<number, boolean>>({});
  // SCHOLAR-INLINE-CHECKS-01: the recall check is open for this lesson (its text is collapsed while the learner recalls), the missed-card saves
  // waiting for the learner to continue (the required recall block, learn-inline.ts).
  const [recalling, setRecalling] = useState<Record<number, boolean>>({});
  const pendingSaves = useRef(new Map<number, () => Promise<void>>());
  const registerSave = useCallback((step: number, fn: (() => Promise<void>) | null) => { if (fn) pendingSaves.current.set(step, fn); else pendingSaves.current.delete(step); }, []);
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
  // SCHOLAR-LEARN-GAPS-02 item 2: the reading place within the active lesson. `pendingPlace`: a saved place to return to once the
  // lesson's content is on the page (until then the writer reports it, so a write never replaces it with the lesson's top).
  const placerRef = useRef<PlaceScheduler | null>(null);
  const pendingPlace = useRef<{ step: number; place: Place; since: number } | null>(null);
  // SCHOLAR-INDEPENDENT-LEARNING-01: the lesson's own notes are on the page (their section anchors exist), so a saved place inside
  // them can be found; and what the last "Mark as read" answered, per lesson.
  const [readerTick, setReaderTick] = useState(0);
  const readerLoaded = useCallback(() => setReaderTick(t => t + 1), []);
  const [markedNote, setMarkedNote] = useState<Record<number, string>>({});
  const sessionRef = useRef(session);
  const practiceRef = useRef(practiceOpen);
  const chooseStyle = useCallback((st: TeachingStyle) => { styleRef.current = st; setStyleChosen(st); if (engaged.current) syncRef.current?.event("activity"); }, []);
  useEffect(() => { sessionRef.current = session; }, [session]);
  const dispatch = useCallback((e: JourneyEvent) => {
    const s = jRef.current;
    if (!s) return;
    const r = journeyStep(s, e, { prepareNext: !!props.prepareNext && props.consent });
    if (r.state !== s) { jRef.current = r.state; setJourney(r.state); }
    for (const f of r.effects) fxRef.current(f);
    // A learning mark (an activity done, a check answered, a practice question answered) is a meaningful event: written at once.
    if (e.type === "activity" || e.type === "verdict" || e.type === "mark") {
      const stepNo = sessionRef.current?.steps[e.index]?.step;
      if (stepNo !== undefined) lastDone.current = { activity: `${e.type === "verdict" ? "checked" : e.type === "mark" ? (e.quickChecked ? "quick" : "recalled") : e.kind}:${stepNo}`, at: new Date().toISOString() };
      if (engaged.current) syncRef.current?.event("activity");
    }
  }, [props.prepareNext, props.consent]);
  const indexOf = useCallback((stepNo: number) => session?.steps.findIndex(x => x.step === stepNo) ?? -1, [session]);
  // The lessons a required recall block covers are read from their SAVED teaching (open:true, never a teach), so each has its card. No AI.
  const inlineIn = props.inline ?? INLINE_DEFAULTS;
  const blockKey = journey && session ? `${journey.current}:${journey.hasSaved.join("")}` : "";
  useEffect(() => {
    const j = jRef.current;
    if (!session || !j || inlineIn.recall !== "on" || inlineIn.required !== "required") return;
    const b = checkBlocks(session.steps.map(x => x.step), inlineIn.every).find(x => x.closesAt === j.current);
    if (!b) return;
    for (const k of b.covers) if (k !== j.current && j.hasSaved[k]) dispatch({ type: "nearView", index: k });
  }, [blockKey, session, inlineIn.recall, inlineIn.required, inlineIn.every, dispatch]);

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
  // SCHOLAR-CUMULATIVE-TEACHING-01: the checks the learner answered in this lesson during this visit (the question, their answer, the
  // verdict and the clarification), sent with every lesson action but Teach me and Ask so the next teaching responds to them. Held
  // only in the page's thread; never stored by the server.
  const priorChecksOf = useCallback((stepNo: number) => (cardsRef.current[stepNo] ?? [])
    .filter(c => c.reply.action === "clarify" && !c.reply.withheld && !c.reply.continuity && typeof c.extra?.checkQuestion === "string")
    .slice(-4).map(c => ({ question: String(c.extra!.checkQuestion), answer: typeof c.extra?.answer === "string" ? c.extra.answer : null, verdict: c.reply.verdict?.value ?? null, feedback: c.reply.answer ?? null })), []);
  const bodyFor = useCallback((st: Step, action: string, s: LessonSettings, extra: Record<string, unknown> = {}) => {
    if (!session) return {};
    const scopeIds = session.steps.flatMap(x => x.sections.map(y => y.chunkId));
    const checks = action !== "teach" && action !== "ask" && action !== "clarify" ? priorChecksOf(st.step) : [];
    return {
      action, step: st.step, depth: s.depth, ...(s.mode !== "notes" && action !== "check" && action !== "clarify" ? { mode: s.mode } : {}), ...extra,
      ...(action === "ask" ? spellingField(spelling) : {}),
      ...(checks.length ? { priorChecks: checks } : {}),
      ...(session.id ? { sessionId: session.id } : { chunkIds: action === "ask" ? scopeIds : st.sections.map(x => x.chunkId) }),
    };
  }, [session, spelling, priorChecksOf]);
  // A reply into its own step's thread (or the Ask thread), and the step's progress. A reply that arrives after the
  // learner moved on still belongs to the step it teaches, so it shows in that lesson (no second AI call).
  const record = useCallback((stepNo: number, json: Record<string, any>, action: string, extra: Record<string, unknown> | undefined, target: "lesson" | "ask", asked?: string) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const reply = (json.continuity ? { ...json, savedList: json.saved, saved: null, sources: [], references: [] } : json) as Reply;
    const card: Card = { id: ++seq.current, asked, reply, extra, target, step: stepNo };
    // SCHOLAR-CUMULATIVE-TEACHING-01: an opened lesson brings its other saved teaching (Go deeper rounds, examples), each its own card after it.
    const more: Card[] = (Array.isArray(json.alsoSaved) ? (json.alsoSaved as Reply[]) : []).filter(s => s && s.answer).map(s => ({ id: ++seq.current, reply: s, extra: {}, target: "lesson" as const, step: stepNo }));
    if (target === "ask") setAskThread(t => [card, ...t]);
    else setCards(c => ({ ...c, [stepNo]: [...(c[stepNo] ?? []), card, ...more] }));
    if (!json.withheld && !json.continuity) setProgress(p => ({ ...p, [stepNo]: { actions: [...new Set([...(p[stepNo]?.actions ?? []), action, ...more.map(m => m.reply.action)])], verdict: json.verdict?.value ?? p[stepNo]?.verdict ?? null } }));
    return reply;
  }, []);

  /** A Learn action on a lesson (the current one unless `onStep` names another). */
  const act = useCallback(async (action: string, extra: Record<string, unknown> = {}, target: "lesson" | "ask" = "lesson", asked?: string, onStep?: number) => {
    const st = onStep === undefined ? step : session?.steps.find(x => x.step === onStep) ?? null;
    if (!session || !st) return null;
    setBusy(action); setBusyAt(st.step); setError(""); setErrorAt(null); setPending(null);
    const s: LessonSettings = { mode: (extra.mode as LearnMode | undefined) ?? mode, depth };
    const r = await call(ACT_URL, studyBody(bodyFor(st, action, { mode, depth }, extra)));
    setBusy(""); setBusyAt(null);
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target, action, extra, asked, step: st.step }); return null; }
    if (!r.ok && !r.json.withheld) { setError(r.json.error ?? "Scholar could not answer just now."); setErrorAt({ action, step: st.step }); return null; }
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
    setOpening(o => ({ ...o, [stepNo]: true }));
    const r = await call(ACT_URL, { ...studyBody(bodyFor(st, props.startAction, s)), open: true });
    setOpening(o => { const rest = { ...o }; delete rest[stepNo]; return rest; });
    const found = r.ok && r.json.cached === true && !!r.json.answer;
    if (found && !has(cardsRef.current)) { record(stepNo, r.json, props.startAction, {}, "lesson"); setTaught(t => ({ ...t, [stepNo]: s })); }
    // Answered "nothing saved" (not merely unreachable): the lesson offers Start learning instead of Review.
    dispatch({ type: "savedLoaded", index: i, found, missing: r.ok && !found && (r.json.open === "generate" || r.json.open === "in_flight") });
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

  // SCHOLAR-INDEPENDENT-LEARNING-01: the learner's own "Mark as read" (PATCH sessions/[id] { move: "read", at }, event action read, 920).
  // No AI. The mark is a live activity at once (and so in the 790 position); the server says whether it was recorded.
  const markRead = useCallback(async (stepNo: number) => {
    const id = sessionRef.current?.id;
    const i = indexOf(stepNo);
    if (!id || i < 0) return;
    engaged.current = true;
    dispatch({ type: "activity", index: i, kind: "marked" });
    const r = await call(`/api/individual/scholar/learn/sessions/${encodeURIComponent(id)}`, { move: "read", at: stepNo }, "PATCH");
    if (r.ok && r.json.recorded === true) {
      setProgress(p => ({ ...p, [stepNo]: { actions: [...new Set([...(p[stepNo]?.actions ?? []), "read"])], verdict: p[stepNo]?.verdict ?? null } }));
      setMarkedNote(m => ({ ...m, [stepNo]: "Marked as read. A learning record for you, not an assessment." }));
    } else setMarkedNote(m => ({ ...m, [stepNo]: "Marked on this device. It could not be recorded in your learning history just now." }));
  }, [indexOf, dispatch]);

  const scrollToLesson = useCallback((stepNo: number) => {
    showTab("lesson");
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
  }, [showTab]);

  // SCHOLAR-LEARN-GAPS-02 item 2: RETURNING TO A SAVED PLACE. The place is the server's when newer than this device's copy
  // (learn-place.ts choosePlace). It is applied once the lesson's saved teaching is on the page (the anchor exists), else after
  // a few seconds by its coarse percentage. The learner's own wheel, touch or key press cancels it. Never moves current_step.
  const liveRef = useRef({ cards, opening, loading, lessonNote });
  useEffect(() => { liveRef.current = { cards, opening, loading, lessonNote }; });
  const applyPlace = useCallback((): boolean => {
    const pp = pendingPlace.current, s = sessionRef.current, j = jRef.current;
    if (!pp || !s || !j) return false;
    if (s.steps[j.current]?.step !== pp.step) { pendingPlace.current = null; return false; }
    const card = document.getElementById(lessonDomId(pp.step));
    if (!card) return false;
    const live = liveRef.current;
    const parsed = parseCardId(pp.place.cardId);
    const anchorEl = parsed?.anchor ? document.getElementById(lessonAnchorId(pp.step, parsed.anchor)) : null;
    const waiting = !!live.opening[pp.step] || Object.values(live.loading).some(l => l.step === pp.step);
    const hasContent = (live.cards[pp.step]?.length ?? 0) > 0;
    if (anchorEl) {
      pendingPlace.current = null;
      anchorEl.scrollIntoView({ behavior: "auto", block: "start" });
      return true;
    }
    if (waiting || (!hasContent && !live.lessonNote[pp.step] && Date.now() - pp.since < 4000)) return false;
    pendingPlace.current = null;
    const cr = card.getBoundingClientRect(), sc = scrollParent(card);
    if (pp.place.offset === null) { card.scrollIntoView({ behavior: "auto", block: "start" }); return true; }
    if (sc) { const f = sc.getBoundingClientRect(); sc.scrollTop = placeScrollTop({ cardTop: cr.top - f.top, cardHeight: cr.height, offset: pp.place.offset, viewportHeight: sc.clientHeight, scrollY: sc.scrollTop }); }
    else window.scrollTo(0, placeScrollTop({ cardTop: cr.top, cardHeight: cr.height, offset: pp.place.offset, viewportHeight: window.innerHeight, scrollY: window.scrollY }));
    return true;
  }, []);
  /** A place worth returning to in this lesson (not merely its top) is now pending. */
  const wantPlace = useCallback((stepNo: number): boolean => {
    const sp = serverPos.current, id = sessionRef.current?.id ?? null;
    let local: Place | null = null;
    if (id) { try { local = parseLocalPlaces(window.localStorage.getItem(placeKey(id)))[String(stepNo)] ?? null; } catch { /* the server's copy only */ } }
    const place = choosePlace({ step: stepNo, local, server: sp ? { step: sp.step, cardId: sp.cardId, offsetHint: sp.offsetHint, clientUpdatedAt: sp.clientUpdatedAt } : null });
    const anchor = parseCardId(place?.cardId)?.anchor ?? null;
    if (!place || ((!anchor || anchor === "h") && (place.offset ?? 0) < 3)) { pendingPlace.current = null; return false; }
    pendingPlace.current = { step: stepNo, place, since: Date.now() };
    window.setTimeout(() => { if (pendingPlace.current?.step === stepNo) applyPlace(); }, 4200);
    return true;
  }, [applyPlace]);
  useEffect(() => { if (pendingPlace.current) applyPlace(); }, [cards, opening, loading, lessonNote, journey, readerTick, applyPlace]);

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
      else if (f.kind === "scrollTo") { if (pendingPlace.current?.step !== st.step) scrollToLesson(st.step); }
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
      question, mode: "teach", step: step.step, depth: paDepth, ...(purpose ? { purpose } : {}), ...(followUp ? { followUp } : {}), ...spellingField(spelling),
      ...(session.id ? { sessionId: session.id } : { chunkIds: step.sections.map(x => x.chunkId) }),
    }), soFar => {
      if (!shown) { shown = true; setAssist(list => [{ id, asked: question, answer: soFar, streaming: true, followUp: followUp?.kind }, ...list]); }
      else setAssist(list => list.map(a => (a.id === id ? { ...a, answer: soFar } : a)));
    });
    setBusy("");
    const failed = (error: string) => setAssist(list => [{ id, asked: question, error, followUp: followUp?.kind }, ...list.filter(a => a.id !== id)]);
    if (r.kind === "stream") {
      if (r.error) { failed(r.error.message); return; }
      setAssist(list => list.map(a => (a.id === id ? { ...a, answer: r.text, streaming: false, sources: r.done?.sources, label: r.done?.label } : a)));
      return;
    }
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) { setPending({ prompt, target: "assistant", question, followUp }); return; }
    if (r.ok) setAssist(list => [{ id, asked: question, answer: String(r.json.answer ?? ""), followUp: followUp?.kind, sources: Array.isArray(r.json.sources) ? r.json.sources : undefined, label: typeof r.json.label === "string" ? r.json.label : undefined }, ...list]);
    else failed(String(r.json.error ?? "Your assistant could not answer just now."));
  }, [session, step, studyBody, paDepth, spelling]);
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
    showTab("ask");
    if (q) setAsk(q);
    setTimeout(() => document.getElementById("ask-q")?.focus({ preventScroll: !tabsShown() }), 0); // wide: the panel is beside the lesson, so the reading place stays
  }, [showTab]);

  // A new scope: start the session; the journey then opens it (guided: teaches its first lesson).
  useEffect(() => {
    if (started.current || !props.start || session) return;
    started.current = true;
    (async () => {
      setBusy("start");
      const r = await call("/api/individual/scholar/learn/sessions", { scope: props.start, lessonAction: props.startAction, ...(props.connect ? { connected: true, ...(props.objectiveText ? { objectiveText: props.objectiveText } : {}) } : {}) });
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
        setRecords(Array.isArray(r.json.lessons) ? r.json.lessons : []);
        void call(`/api/individual/scholar/learn/sessions/${r.json.session.id}`, { move: "resume", currentStep: r.json.session.currentStep }, "PATCH");
        // SCHOLAR-CONTINUITY-01: where it was left on any device, before the journey opens.
        serverPos.current = await fetchPosition(r.json.session.id);
      }
      setSession(r.json.resumed ? r.json.session : { ...r.json.session, currentStep: r.json.session.steps?.[0]?.step ?? 0 }); setNote(r.json.note ?? null);
    })();
  }, [props.start, props.connect, props.objectiveText, props.startAction, session]);
  // A resumed session: recorded as a resume.
  useEffect(() => {
    if (props.initial?.id && !opened.current) { opened.current = true; void call(`/api/individual/scholar/learn/sessions/${props.initial.id}`, { move: "resume", currentStep: props.initial.currentStep }, "PATCH"); }
  }, [props.initial]);

  // THE JOURNEY OPENS, once per session. Revealed: as far as this device remembers, the server's current step, or the
  // furthest lesson with a learning mark or saved teaching. Active: where this device or the server (the newer) says the
  // learner stopped. A NEW scope (Guided, and as always its first lesson even in Manual) teaches its first lesson if
  // nothing is saved; a RESUME only opens the active lesson's saved teaching -- restoring history never costs AI.
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
    const savedOf = session.steps.map(x => !!records.find(r => r.step === x.step)?.saved);
    // SCHOLAR-INLINE-CHECKS-01: the recall ratings and quick-check results the server position holds (any device) join this device's marks.
    const sm = merged?.marks ?? {};
    const acts = session.steps.map((x, i) => {
      const a = { ...(saved?.activities?.[i] ?? {}) };
      const rc = recallFromCode(sm.recall?.[String(x.step)]), qc = quickFromCode(sm.quick?.[String(x.step)]);
      if (rc && (!a.recalled || (a.recalled === "skipped" && rc !== "skipped"))) a.recalled = rc;
      if (qc && !a.quickChecked) a.quickChecked = qc;
      return a;
    });
    const j = createJourney({ count, current, revealedUpTo: merged ? merged.revealedUpTo : saved?.revealedUpTo, progress: session.steps.map(x => progress[x.step]), activities: acts, saved: savedOf });
    if (merged?.practiceOpen != null) { const p = merged.practiceOpen; setPracticeOpen(m => ({ ...m, [p]: true })); }
    if (merged && merged.style !== "explain") { styleRef.current = merged.style; setStyleChosen(merged.style); }
    serverAt.current = serverIdx; anchor.current = current;
    // Resume: the furthest lesson taught (from the records) when the stored position is behind it -- a position pulled
    // back by an older version of this page hides nothing; choosing it is the learner's (one tap, saved: no AI).
    const furthest = session.steps.reduce((m, x, i) => (savedOf[i] || (progress[x.step]?.actions ?? []).some(a => isOpenable(a)) ? i : m), -1);
    if (resumed.current && furthest > current) setBanner(furthest);
    else if (resumed.current && current > 0) setBanner(current);
    else engaged.current = true;
    if (resumed.current) wantPlace(session.steps[current]?.step ?? -1);
    const r = startJourney(j, !resumed.current || (chosenGuided ?? isGuided(rememberedGuided())), resumed.current);
    jRef.current = r.state; setJourney(r.state);
    for (const f of r.effects) fxRef.current(f);
  }, [session, progress, records, chosenGuided, wantPlace]);

  // SCHOLAR-PERSISTENT-LEARNING-01: no scroll observer. Scrolling never changes the active lesson, never moves the
  // position and never asks for anything; the 790 writer below only notes a scroll as an interaction (touch).
  // The learner's own input marks them as reading (a page merely loaded never moves their saved position).
  useEffect(() => {
    const on = () => { engaged.current = true; pendingPlace.current = null; };
    const opts = { passive: true } as const;
    window.addEventListener("wheel", on, opts); window.addEventListener("touchmove", on, opts); window.addEventListener("keydown", on);
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
      // The ACTIVE lesson (the learner's choice), never the one scrolled into view; furthest only grows (790 keeps the maximum).
      const at = s.steps[j.current];
      if (!at) return null;
      const far = s.steps[Math.max(j.revealedUpTo, j.current)] ?? at;
      const practice = !!practiceRef.current[at.step];
      const marks = marksFromActivities(s.steps.map(x => x.step), j.activities);
      // WHERE in the active lesson (a saved place still on its way back is reported as it is, never replaced by the lesson's top).
      const pend = pendingPlace.current?.step === at.step ? pendingPlace.current.place : null;
      const pl = pend ? { anchor: parseCardId(pend.cardId)?.anchor ?? null, offset: pend.offset } : readPlace(at.step);
      return {
        step: at.step, furthestStep: Math.max(far.step, at.step), cardId: cardIdFor(at.step, pl.anchor ?? (practice ? "practice" : null)), sectionChunkId: at.sections[0]?.chunkId ?? null,
        offsetHint: pl.offset, lastCompletedActivity: lastDone.current?.activity ?? null, lastCompletedAt: lastDone.current?.at ?? null,
        unfinished: practice || marks.recall || marks.quick || styleCode(styleRef.current) ? { v: 1, ...(practice ? { practiceOpen: at.step } : {}), ...marks, ...(styleCode(styleRef.current) ? { style: styleCode(styleRef.current) } : {}) } : null,
      };
    };
    const sync = new PositionSync({ deviceId: deviceIdOf(), read, send: (p, o) => sendPosition(syncSession, p, o.keepalive) });
    sync.adopt(serverPos.current);
    syncRef.current = sync;
    // Scrolling only NOTES a place; it is committed once the scrolling has stopped (2 s) and at most once per 15 s, and at once on
    // hide / pagehide with keepalive (learn-place.ts PlaceScheduler). It never changes the active lesson or current_step.
    const keepPlace = () => {
      try {
        const s = sessionRef.current, j = jRef.current, at = s && j ? s.steps[j.current] : null;
        if (!s?.id || !at) return;
        const pl = readPlace(at.step), key = placeKey(s.id);
        window.localStorage.setItem(key, JSON.stringify(withLocalPlace(parseLocalPlaces(window.localStorage.getItem(key)), at.step, { cardId: cardIdFor(at.step, pl.anchor), offset: pl.offset, at: new Date().toISOString() })));
      } catch { /* this visit only */ }
    };
    const placer = new PlaceScheduler({ commit: keepalive => { if (pendingPlace.current) return; keepPlace(); sync.touch(); if (keepalive) sync.hide(); } });
    placerRef.current = placer;
    const onVisibility = () => { if (document.visibilityState === "hidden") { placer.hide(); sync.hide(); } };
    const onHide = () => { placer.hide(); sync.hide(); };
    const onScroll = () => { if (engaged.current && !pendingPlace.current) placer.note(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    document.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("scroll", onScroll, { capture: true });
      placer.hide(); placer.stop(); if (placerRef.current === placer) placerRef.current = null;
      sync.hide(); sync.disable();
      if (syncRef.current === sync) syncRef.current = null;
    };
  }, [syncSession]);
  // A practice panel opened or closed changes where the learner is in the lesson: written with the next write.
  useEffect(() => { practiceRef.current = practiceOpen; if (engaged.current) syncRef.current?.touch(); }, [practiceOpen]);
  /**
   * THE POSITION RULE: the learner makes a lesson ACTIVE (a tap in the list or navigator, Next, Previous, Resume). Saved
   * teaching opens with no AI; Guided learning teaches only a lesson with nothing saved. Only this moves current_step and
   * the 790 position (furthest_step only ever grows).
   */
  const select = useCallback((i: number, how: "select" | "next" = "select") => {
    const j = jRef.current;
    if (!session || !j) return;
    const st = session.steps[i];
    if (!st) return;
    engaged.current = true; setBanner(null);
    placerRef.current?.cancel();
    // Coming back to this lesson: its saved place (the server's if newer than this device's), else its start.
    if (i === j.current) { if (wantPlace(st.step)) requestAnimationFrame(() => { applyPlace(); }); else scrollToLesson(st.step); return; }
    wantPlace(st.step);
    const hadThread = (cardsRef.current[session.steps[j.current]?.step ?? -1] ?? []).length > 0;
    const move = i < j.current ? "revisit" : i > j.current + 1 || !hadThread ? "skip" : null;
    anchor.current = i; serverAt.current = i;
    dispatch(how === "next" ? { type: "next", guided } : { type: "select", index: i, guided });
    if (session.id) void call(`/api/individual/scholar/learn/sessions/${session.id}`, { currentStep: st.step, ...(move ? { move } : {}) }, "PATCH");
    syncRef.current?.event(how === "next" ? "continue" : "jump");
  }, [session, dispatch, guided, scrollToLesson, wantPlace, applyPlace]);
  /** Next lesson: the one after the ACTIVE lesson, opened (saved) or taught (Guided, nothing saved) in one action. */
  const next = useCallback(() => { const j = jRef.current; if (j && j.current < j.count - 1) select(j.current + 1, "next"); }, [select]);
  const previous = useCallback(() => { const j = jRef.current; if (j && j.current > 0) select(j.current - 1); }, [select]);
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
    if (p.action === "ask") { if (!r.continuity) setAsk(""); if (p.asked) keepAsked(p.asked, p.step); }
    else if (p.action === "check" && r.checkQuestion && p.step !== undefined) setCheck(openCheck(p.step, r.checkQuestion));
    else if (p.action === "clarify") applyCheckResult(r);
  }
  // SCHOLAR-LEARN-FIX-01 L-B: Check my understanding answers a question the Teach Me answer already wrote and the engine
  // checked (teach-format.ts), when it cites only this lesson's own sections -- the clarification is judged against
  // exactly those. Otherwise the existing check action writes one. Either way the answer goes to clarify (the verdict).
  async function startCheck(st: Step, q?: string) {
    const own = q ?? teachQuestionsOf(st)[0];
    if (own) {
      setCheck(openCheck(st.step, own));
      setTimeout(() => document.getElementById("check-answer")?.focus(), 0);
      return;
    }
    const r = await act("check", {}, "lesson", undefined, st.step);
    if (r?.checkQuestion) setCheck(openCheck(st.step, r.checkQuestion));
  }
  // SCHOLAR-GO-DEEPER-001: Go deeper, at the level asked for (a depth), and the new round brought into view. Choosing an answer option opens the
  // lesson's own check beneath the question with that choice written in: the reasons are the learner's, and clarify judges them as for any check.
  const goDeeper = async (st: Step, depth?: string) => {
    const r = await act("deeper", depth ? { depth } : {}, "lesson", undefined, st.step);
    if (r?.goDeeperLevels && r.answer) window.setTimeout(() => { const all = document.querySelectorAll('[data-testid="go-deeper-round"]'); all[all.length - 1]?.scrollIntoView({ block: "start" }); }, 60);
  };
  const chooseOption = (st: Step, q: string, option: string) => {
    const written = `I chose: ${option}\nBecause: `;
    // A different choice keeps the reasons already written: only the choice line changes.
    setCheck(c => (c && c.step === st.step ? (c.question !== questionText(q) || c.feedback ? c : { ...c, answer: `${written}${c.answer.replace(/^I chose: [^\n]*\n(?:Because: ?)?/, "")}` }) : openCheck(st.step, q, written)));
    setTimeout(() => document.getElementById("check-answer")?.focus(), 0);
  };
  /** An Ask me / Challenge question, answered in the lesson's own check (clarify records the informal verdict). */
  const checkThis = (st: Step, q: string) => { setCheck(openCheck(st.step, q)); setTimeout(() => document.getElementById("check-answer")?.focus(), 0); };
  // SCHOLAR-UNDERSTANDING-CHECKS-01: EVERY outcome of Check my answer is shown beneath the answer, which is kept:
  //   a judgement        -> the verdict and its parts (the thread's card is hidden while the panel shows it);
  //   withheld           -> why, then the self-review (the lesson's key points and the question's sections, no AI);
  //   no new AI          -> the continuity message, then the self-review;
  //   a clarify question -> put HERE (ClarifyPurpose in the panel), with the self-review one click away;
  //   an error           -> the error here, then the self-review.
  // Nothing clears the box until the learner chooses Try again, Continue learning or Skip.
  function applyCheckResult(r: Reply | null) {
    setCheck(c => {
      if (!c) return c;
      if (!r) return c; // the clarify question (pending) or an error (errorAt): both render in the panel from their own state
      const cardId = seq.current; // the card `record` just added for this reply
      if (r.continuity) return { ...c, feedback: r, cardId, noAi: "continuity" };
      if (r.withheld) return { ...c, feedback: r, cardId, noAi: "withheld" };
      return { ...c, feedback: r, cardId, noAi: null, saved: r.kept ? "saved" : null };
    });
    if (r && !r.error && !r.continuity && !r.withheld && check) setLastCheck(m => ({ ...m, [check.step]: { question: check.question, answer: check.answer.trim() } }));
    // SALE-2026-11 R1: the next teaching step the server kept with this answer replaces the lesson's previous one.
    if (r?.kept && r.adaptive && check) { const c = check, d = r.adaptive, k = r.kept; setAdaptive(m => ({ ...m, [c.step]: { decision: d, attemptId: k.attemptId, question: c.question, answer: c.answer.trim(), ran: false, running: false, asked: false } })); }
    // D01: a judged answer the server kept joins this lesson's history at once (the server's own row, by id).
    if (r?.kept && check && r.answer) {
      const k = r.kept, c = check, verdict = r.verdict?.value;
      setChecks(m => ({ ...m, [c.step]: [{
        attemptId: k.attemptId, questionId: k.questionId, answeredAt: k.answeredAt, question: c.question, marking: "ai_evaluation", correct: verdict === "understood", score: null,
        model: r.provenance?.model ?? null, promptVersion: r.provenance?.promptVersion ?? null, contentVersion: null, sessionId: session?.id ?? null, step: c.step, chunkId: k.chunkId, materialId: k.materialId,
        response: { kind: "check", text: c.answer.trim(), question: c.question, verdict: isCheckVerdict(verdict) ? verdict : null, selfGrade: null, feedback: parseCheckFeedback(r.answer!), summary: parseCheckFeedback(r.answer!) ? null : r.answer! },
      }, ...(m[c.step] ?? []).filter(x => x.attemptId !== k.attemptId)] }));
    }
  }
  async function submitCheck(e: React.FormEvent) {
    e.preventDefault();
    if (!check?.answer.trim()) return;
    const c = check, answer = c.answer.trim();
    // D01: the section the question cites (its first [S n]), so the kept question is filed under it.
    const cited = citedTags(c.raw ?? "")[0];
    const r = await act("clarify", { checkQuestion: c.question, answer, ...(cited ? { checkCited: cited } : {}), ...adaptiveBody(c) }, "lesson", `Your answer: ${answer}`, c.step);
    applyCheckResult(r);
  }
  /** SALE-2026-11 R1: what a check answer carries for the next-step decision -- the stated confidence, the Challenge level, the step it follows, and whether Apply exists here. */
  function adaptiveBody(c: CheckState): Record<string, unknown> {
    const a = adaptive[c.step], st = session?.steps.find(x => x.step === c.step);
    return {
      ...(c.confidence ? { confidence: c.confidence } : {}), ...(c.level ? { checkLevel: c.level } : {}),
      ...(a ? { followUp: { afterAttemptId: a.attemptId, approach: a.ran ? a.decision.approach : "skipped" } } : {}),
      applyAvailable: !!st && !!session && applyEligible(session.scopeKind, st.sections.map(x => x.chunkId), new Set(props.applyChunkIds ?? [])),
    };
  }
  /** D01 (CYU-03), the self-review path: keep the answer with the learner's own grade against the key points (or without a mark). No AI. */
  async function saveCheck(st: Step, grade: SelfGrade | null) {
    const c = check;
    if (!c || c.step !== st.step || !session?.id || !c.answer.trim()) return;
    setCheck(x => (x ? { ...x, saved: "saving", selfGrade: grade } : x));
    const cited = citedTags(c.raw ?? "")[0];
    const r = await call("/api/individual/scholar/learn/checks", { sessionId: session.id, step: st.step, question: c.question, answer: c.answer.trim(), selfGrade: grade, ...(cited ? { checkCited: cited } : {}), ...adaptiveBody(c), aiAvailable: props.consent && !offReason("clarify") });
    const k = r.ok && r.json.kept ? r.json.kept as { attemptId: string; answeredAt: string; questionId: string; chunkId: string; materialId: string } : null;
    setCheck(x => (x ? { ...x, saved: k ? "saved" : "failed" } : x));
    if (k && r.json.adaptive) { const d = r.json.adaptive as AdaptiveView; setAdaptive(m => ({ ...m, [st.step]: { decision: d, attemptId: k.attemptId, question: c.question, answer: c.answer.trim(), ran: false, running: false, asked: false } })); }
    if (k) setChecks(m => ({ ...m, [st.step]: [{
      attemptId: k.attemptId, questionId: k.questionId, answeredAt: k.answeredAt, question: c.question, marking: grade ? "self_graded" : "unmarked", correct: grade === "covered", score: null,
      model: null, promptVersion: null, contentVersion: null, sessionId: session.id, step: st.step, chunkId: k.chunkId, materialId: k.materialId,
      response: { kind: "check", text: c.answer.trim(), question: c.question, verdict: null, selfGrade: grade, feedback: null, summary: null },
    }, ...(m[st.step] ?? [])] }));
  }
  /** Try again: the answer stays in the box, the judgement moves to the lesson's thread as a previous check. */
  const retryCheck = () => { setCheck(c => (c ? { ...c, feedback: null, cardId: null, noAi: null, reviewing: false } : c)); setErrorAt(null); setPending(null); setTimeout(() => document.getElementById("check-answer")?.focus(), 0); };
  /** Continue learning: the check closes, its judgement stays in the lesson's thread, and the page moves to What next? (the lesson, its sources and the session are unchanged). */
  const continueAfterCheck = (st: Step) => {
    setCheck(null); setErrorAt(null); setPending(null);
    setTimeout(() => (document.getElementById("journey-next-h") ?? document.getElementById(lessonAnchorId(st.step, "act")))?.scrollIntoView({ block: "start", behavior: "smooth" }), 0);
  };
  // ── SALE-2026-11 R1 (SALE-06/07): the next teaching step. The learner runs it (an existing Learn action), then answers a DIFFERENT
  // question, or skips. Nothing runs by itself, and the different question is the lesson's own or an earlier one before any new one.
  const patchAdaptive = (stepNo: number, p: Partial<AdaptiveUi>) => setAdaptive(m => (m[stepNo] ? { ...m, [stepNo]: { ...m[stepNo], ...p } } : m));
  const closeAdaptive = (stepNo: number) => setAdaptive(m => { const n = { ...m }; delete n[stepNo]; return n; });
  async function runAdaptive(st: Step) {
    const a = adaptive[st.step];
    if (!a || !session) return;
    const d = a.decision.approach;
    if (d === "continue" || d === "review") { closeAdaptive(st.step); continueAfterCheck(st); return; }
    if (d === "foundation") { const prev = [...session.steps].reverse().find(x => x.step < st.step); patchAdaptive(st.step, { ran: true }); if (prev) select(indexOf(prev.step)); return; }
    if (d === "apply") { const first = st.sections[0]; patchAdaptive(st.step, { ran: true }); if (first) router.push(carry(`/individual/scholar/study/apply?section=${first.chunkId}&from=teach`)); return; }
    patchAdaptive(st.step, { running: true });
    setCheck(null);
    const extra = d === "mistake" ? { question: a.question, learnerAnswer: a.answer } : d === "guide" ? { hintLevel: 1, attempt: a.answer, question: a.question } : d === "challenge" ? { level: "application" } : {};
    const r = await act(d, extra, "lesson", undefined, st.step);
    const ok = !!r && !r.withheld && !r.error && !r.continuity;
    patchAdaptive(st.step, { running: false, ran: ok });
    // Challenge me writes the harder question itself: it opens as the lesson's next check, at its level.
    if (d === "challenge" && r?.checkQuestion) { patchAdaptive(st.step, { asked: true }); setCheck(openCheck(st.step, r.checkQuestion, "", "application")); setTimeout(() => document.getElementById("check-answer")?.focus(), 0); }
  }
  const differentFor = (st: Step) => {
    const a = adaptive[st.step];
    if (!a) return null;
    const own = teachQuestionsOf(st);
    return { own, pick: pickDifferentQuestion({ lessonQuestions: own.map(questionText), answered: [a.question, ...(checks[st.step] ?? []).map(c => c.question)], earlier: a.decision.earlierQuestions }) };
  };
  async function adaptiveDifferent(st: Step) {
    const f = differentFor(st);
    if (!f) return;
    patchAdaptive(st.step, { asked: true });
    if (f.pick) { checkThis(st, f.pick.source === "lesson" ? f.own.find(q => questionText(q) === f.pick!.stem) ?? f.pick.stem : f.pick.stem); return; }
    // None left: the existing Ask me action writes one (the learner's click, the same route, metering and model routing).
    patchAdaptive(st.step, { running: true });
    const r = await act("ask_me", { level: "understanding" }, "lesson", undefined, st.step);
    patchAdaptive(st.step, { running: false, asked: !!r?.checkQuestion });
    if (r?.checkQuestion) checkThis(st, r.checkQuestion);
  }
  // SCHOLAR-SEARCH-HISTORY-01: a question Scholar replied to (even "this isn't in your notes") is one entry in the learner's own history:
  // their words and where they asked, never the reply. A clarify prompt is no reply yet: it is kept when the learner answers it (answerEducation).
  const historyChoice = useSearchHistoryChoice();
  function keepAsked(q: string, onStep?: number) {
    if (!historyChoice.on) return;
    const st = onStep === undefined ? step : session?.steps.find(x => x.step === onStep) ?? step;
    if (st) void recordHistory({ activity: "ask", query: q, sessionId: session?.id ?? null, step: session?.id ? st.step : null, chunkId: st.sections[0]?.chunkId ?? null });
  }
  async function submitAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = ask.trim();
    if (!q) return;
    const history = askThread.slice(0, props.maxTurns).reverse().flatMap(c => [{ speaker: "student", text: c.asked ?? "" }, ...(c.reply.answer ? [{ speaker: "tutor", text: c.reply.answer }] : [])]);
    const r = await act("ask", { question: q, history }, "ask", q);
    if (r && !r.continuity) setAsk(""); // no new AI: the question stays in the box
    if (r) keepAsked(q);
  }
  /** A teaching approach's request, through the same route and body as every Learn action (allowance, grounding, dedupe). */
  // SCHOLAR-GUIDE-ME-001: the same request as any approach, with the clinical-risk gate's question handed to the panel, so it is answered where the learner is and the panel carries on.
  const runGuide = (st: Step) => async (body: Record<string, unknown>): Promise<ApproachResult> => {
    if (!session) return null;
    const { action, ...extra } = body;
    const a = String(action);
    setBusy(a); setBusyAt(st.step); setError(""); setPending(null);
    const r = await call(ACT_URL, studyBody(bodyFor(st, a, { mode, depth }, extra)));
    setBusy(""); setBusyAt(null);
    const prompt = r.ok ? null : clarifyFrom(r.json);
    if (prompt) return { ok: false, json: { clarify: prompt } };
    if (r.json.continuity) return { ok: false, json: { error: r.json.continuity.message } };
    // Progress is what happened: a real teach, explanation or judged answer. Opening what is saved, a hint and an example are none of those.
    const guided = extra.guide as { turn?: string } | undefined;
    const learned = r.ok && !r.json.withheld && !extra.open && (a === "clarify" || guided?.turn === "teach" || guided?.turn === "explain") && !!r.json.answer;
    if (learned) setProgress(p => ({ ...p, [st.step]: { actions: [...new Set([...(p[st.step]?.actions ?? []), "guide"])], verdict: r.json.verdict?.value ?? p[st.step]?.verdict ?? null } }));
    if (r.json.verdict?.value) dispatch({ type: "verdict", index: indexOf(st.step), value: String(r.json.verdict.value) });
    return r;
  };
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
  // SCHOLAR-INLINE-CHECKS-01: the recall cards, from the SAVED lessons only (a check question or key points): no AI, ever.
  const inlinePolicy = inlineIn;
  const mappedChunks = new Set(props.applyChunkIds ?? []);
  const recallDefs = session.steps.map(st => {
    const t = lastTeachOf(st), parts = t ? parseTeachAnswer(t.reply.answer!) : null, q = teachQuestionsOf(st)[0];
    const content = t ? recallContent({ title: st.title, question: q ? questionText(q) : null, points: parts?.points ?? [], overview: parts?.overview ?? null, objective: st.objective }) : null;
    return { content, taught: !!t, words: t ? wordCount(t.reply.answer) : 0, cited: t && parts ? citedTags([...parts.points, parts.overview, ...(q ? [questionText(q)] : [])].join(" ")) : [], sources: t?.reply.sources ?? [] };
  });
  const requiredMode = inlinePolicy.recall === "on" && inlinePolicy.required === "required";
  // Required: a block after every N lessons and after the last (checkBlocks). Optional: a one-lesson group wherever the placement rule says.
  const optionalPlaced = inlineCheckPlacement(recallDefs.map(d => ({ words: d.words, hasRecall: !!d.content, taught: d.taught })), inlinePolicy);
  const blocks: CheckBlock[] = inlinePolicy.recall !== "on" ? []
    : requiredMode ? checkBlocks(session.steps.map(x => x.step), inlinePolicy.every)
      : session.steps.flatMap((st, k) => (optionalPlaced[k] ? [{ closesAt: k, covers: [k], steps: [st.step] }] : []));
  const markOf = (k: number) => j?.activities[k]?.recalled ?? null;
  const coveredWithCard = (b: CheckBlock) => b.covers.filter(k => !!recallDefs[k].content);
  const blockCards = (b: CheckBlock): BlockCard[] => coveredWithCard(b).map(k => {
    const st = session.steps[k], d = recallDefs[k], f = st.sections[0];
    return {
      step: st.step, label: `Lesson ${k + 1}: ${st.title || "this lesson"}`, front: d.content!.front, back: d.content!.back, why: d.content!.why,
      sources: (d.cited.length ? d.sources.filter(x => d.cited.includes(Number(x.tag.replace(/\D/g, "")))) : d.sources).slice(0, 3).map(x => ({ citation: x.citation })),
      mark: markOf(k), materialId: f?.materialId ?? null, chunkId: f?.chunkId ?? null,
    };
  });
  // A lesson in a required block waits (is not counted complete) while any card of its block is unrated. Lessons with no card add none.
  const recallPending = session.steps.map((_, k) => requiredMode && !!recallDefs[k].content && blocks.some(b => b.covers.includes(k) && blockPending(coveredWithCard(b).map(markOf))));
  const blockHere = blocks.find(b => b.closesAt === curIdx) ?? null;
  const canContinue = lessonCanContinue(inlinePolicy.required, blockHere ? coveredWithCard(blockHere).map(markOf) : []);
  // Continue: any missed-card save the learner left ticked is made now (their own card, no AI). A failed save never holds them back.
  const continueNext = () => {
    if (!canContinue) return;
    const fns = [...pendingSaves.current.values()];
    void Promise.all(fns.map(f => f().catch(() => undefined))).then(() => next());
  };
  // SCHOLAR-PERSISTENT-LEARNING-01: each lesson's state from the server records plus this visit (learn-journey.ts lessonFacts).
  const visited = new Set([props.initialPosition?.step, props.initialPosition?.furthestStep].filter((x): x is number => typeof x === "number"));
  const facts: LessonFacts[] = session.steps.map((s, i) => j
    ? journeyFacts(j, i, { progress: progress[s.step], record: records.find(r => r.step === s.step) ?? null, visited: visited.has(s.step), check: props.checks, recallPending: recallPending[i] })
    : lessonFacts({ check: props.checks }));
  const navLessons: NavLesson[] = session.steps.map((s, i) => ({
    index: i, title: s.title || `Lesson ${i + 1}`, revealed: i <= shownUpTo,
    status: j ? lessonStatus(j, i, facts[i]) : { label: "Not started", icon: "none", current: i === curIdx },
  }));
  const read = readCount(facts);
  // SCHOLAR-LEARN-GAPS-02 items 1 and 5: all saved lessons of a single-material session as one PDF; the AI-read mark on a source.
  const materialIds = new Set(session.steps.flatMap(s => s.sections.map(x => x.materialId)));
  const oneMaterial = materialIds.size === 1 ? [...materialIds][0] : null;
  const anySaved = records.some(r => !!r.saved) || Object.values(cards).some(cs => cs.some(c => c.target !== "ask" && !!(c.reply.saved || c.reply.artefactId)));
  const aiReadNote = new Map<string, string>();
  for (const c of cards[at] ?? []) for (const s of c.reply.sources ?? []) if (s.aiRead && s.aiReadNote) aiReadNote.set(s.chunkId, s.aiReadNote);
  const rows: LessonRow[] = navLessons.map(l => ({ index: l.index, title: l.title, status: l.status, action: PRIMARY_LABEL[primaryAction(facts[l.index], false)] }));
  // Three columns only when the content area is wide enough (a container query, not a new viewport breakpoint): on a
  // tablet beside the app sidebar the 240px + 300px columns left the lesson too narrow and pushed Ask Scholar off-screen.
  const panel = (name: typeof tab) => (tab === name ? "block" : "hidden @min-[66rem]:block");
  // SCHOLAR-GUIDED-LEARNING-01: the lesson as the learner meets it. Go deeper and Examples sit in the activity row.
  const group = groupActions(props.actions, props.startAction);
  const more = group.more.filter(a => a !== "deeper" && a !== "examples");
  const off = props.actions.filter(a => a !== "ask" && offReason(a));
  const active = session.steps[curIdx];
  const lastLesson = curIdx >= count - 1;
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
  // SCHOLAR-UNDERSTANDING-CHECKS-01: the panel owns the question, the answer (kept), the processing state, the clarify question,
  // the error, the judgement with its parts, the self-review and Try again | Review source | Continue learning.
  const checkPanel = (st: Step, inline: boolean) => {
    if (!check || check.step !== st.step) return null;
    const c = check;
    const working = busy === "clarify" && busyAt === c.step;
    const clarifyHere = pending?.action === "clarify" && pending.target === "lesson" && pending.step === c.step ? pending : null;
    const errorHere = errorAt?.action === "clarify" && errorAt.step === c.step ? error : "";
    const unavailable = offReason("clarify");
    const answered = !!c.feedback || !!errorHere || !!clarifyHere;
    const fb = c.feedback;
    const judged = !!fb && !c.noAi && !!fb.answer;
    const noAi: CheckNoAiReason | null = c.noAi ?? (errorHere ? "error" : clarifyHere ? "clarify" : unavailable ? "unavailable" : null);
    // The self-review's reference: the saved lesson's key points and the sections the question cites (learn-check.ts, no AI).
    // SCHOLAR-GO-DEEPER-001: a question of a Go deeper round is reviewed against that round's own takeaways and sources.
    const fromRound = (cards[st.step] ?? []).find(x => x.reply.action === "deeper" && !!x.reply.answer && !!c.raw && !!parseDeeperAnswer(x.reply.answer)?.questions.some(q => q.text === c.raw));
    const teach = fromRound ?? lastTeachOf(st);
    const ref = referenceAnswer({ rawQuestion: c.raw, lessonPoints: fromRound ? parseDeeperAnswer(fromRound.reply.answer!)?.takeaways.filter(t => citedTags(t).length > 0) ?? [] : teach ? parseTeachAnswer(teach.reply.answer!)?.points ?? [] : [], sources: teach?.reply.sources ?? [] });
    // The self-review stands in for a judgement that is not shown; beside a judgement, Review source shows only the sources.
    const showSelfReview = (answered && !!noAi && noAi !== "clarify") || (c.reviewing && !judged);
    const parts = judged ? parseCheckFeedback(fb!.answer!) : null;
    const sources = fb?.sources?.length ? fb.sources : teach?.reply.sources ?? [];
    const bullets = (items: readonly string[]) => <ul className="mt-1 list-disc space-y-1 pl-5">{items.map((p, i) => <li key={i}><Cited text={p} sources={sources} /></li>)}</ul>;
    // LESSON REDESIGN: inline, the answer opens under its own question (no box in a box); a written check after the lesson is
    // its own lavender card. The feedback is a separate panel with its parts headed, each with an icon (FeedbackParts).
    return (
      <form onSubmit={submitCheck} className={`${learnTone("check")} ${inline ? "mt-3 border-t border-[var(--learn-border)] pt-3" : "cmp-learn-box mt-2 p-4"}`} aria-busy={working}>
        {!inline && <LearningSectionHead level={4} icon="question" title="Check your understanding" />}
        {!inline && <p className="mt-2 text-[14.5px] font-semibold text-gray-900">{c.question}</p>}
        <label htmlFor="check-answer" className={`${inline ? "" : "mt-2 "}block text-[12.5px] font-semibold text-gray-700`}>Your answer</label>
        <textarea id="check-answer" rows={3} maxLength={QUESTION_MAX} value={c.answer} onChange={e => setCheck({ ...c, answer: e.target.value })} readOnly={working || answered}
          className={`mt-1 w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${answered ? "bg-gray-50 text-gray-800" : ""} ${focusRing}`} />
        {!answered && <p className="mt-1 text-[12px] text-gray-600">{INFORMAL_CHECK_LABEL}</p>}
        {!answered && unavailable && <p className="mt-1 text-[12.5px] text-gray-700">{aiReasonCopy(unavailable, "scholar").text}</p>}
        {working && <p role="status" aria-live="polite" className="mt-2 flex items-center gap-2 text-[13px] text-gray-700"><span aria-hidden="true" className="inline-block h-2 w-2 rounded-full motion-safe:animate-pulse" style={{ background: accent }} />{CHECK_PROCESSING}</p>}
        {/* SALE-2026-11 R1: the learner may say how sure they are. Optional, kept beside the answer, never counted as understanding. */}
        {!answered && !working && (
          <div className="mt-2" role="group" aria-label="How sure are you? Optional">
            <p className="text-[12.5px] text-gray-700">How sure are you? Optional. It is kept beside your answer and never counted as understanding.</p>
            <div className="mt-1 flex flex-wrap gap-2">
              {CONFIDENCE_VALUES.map(v => (
                <button key={v} type="button" aria-pressed={c.confidence === v} onClick={() => setCheck({ ...c, confidence: c.confidence === v ? null : v })}
                  className={`${chip} ${c.confidence === v ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900 hover:bg-gray-100"}`}>{CONFIDENCE_LABEL[v]}</button>
              ))}
            </div>
          </div>
        )}
        {!answered && !working && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !c.answer.trim() || /^I chose: [^\n]*\nBecause:\s*$/.test(c.answer) || !!unavailable}>{CHECK_BUTTON.submit}</button>
            {unavailable && c.answer.trim() && <button type="button" className={ghost} onClick={() => setCheck({ ...c, reviewing: true, feedback: null })}>{CHECK_SELF_REVIEW_LABEL}</button>}
            <button type="button" className={ghost} onClick={() => setCheck(null)}>{CHECK_BUTTON.skip}</button>
          </div>
        )}
        {/* The clarify question, HERE where the learner is (it used to render at the top of the lesson card, out of view). */}
        {clarifyHere && !working && (
          <div className="mt-3">
            <p className="text-[13px] text-gray-800">{CHECK_NO_AI_WHY.clarify}</p>
            <ClarifyPurpose key={clarifyHere.asked ?? "clarify"} clarify={clarifyHere.prompt} busy={!!busy} accent={accent} className="mt-2" onEducation={() => void answerEducation()} onPatient={() => confirmStudy(false)} />
            {!c.reviewing && <button type="button" className={`${ghost} mt-2`} onClick={() => setCheck({ ...c, reviewing: true })}>{CHECK_SELF_REVIEW_LABEL}</button>}
          </div>
        )}
        {errorHere && !working && <p role="alert" className="mt-3 text-[13.5px] font-medium text-red-700">{CHECK_NO_AI_WHY.error} {errorHere}</p>}
        {fb && c.noAi === "continuity" && <p role="status" className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2 text-[13.5px] text-gray-800"><span className="font-semibold">{CHECK_NO_AI_WHY.continuity}</span> {fb.continuity?.message}</p>}
        {fb && c.noAi === "withheld" && <p role="status" className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800"><span className="font-semibold">{CHECK_NO_AI_WHY.withheld}</span> {fb.next?.why ?? fb.message}</p>}
        {/* (b) THE AI JUDGEMENT: the verdict, then its parts, each cited into the learner's own notes. Formative, never competence. */}
        {judged && (
          <section aria-label="Feedback on your answer" className="mt-3 rounded-xl bg-[var(--learn-surface)] p-3.5 ring-1 ring-[var(--learn-border)]">
            {fb!.verdict && <VerdictLine value={fb!.verdict.value} label={fb!.verdict.label} informal={fb!.verdict.informal} />}
            <FormativeAiLabel className="mt-1.5" />
            <div className="mt-3 text-[14px] leading-relaxed text-gray-800">
              {parts ? <CheckFeedback parts={parts} sources={sources} level={5} />
                : <div className="whitespace-pre-wrap"><Cited text={fb!.answer!} sources={sources} /></div>}
            </div>
            {fb!.flags && fb!.flags.length > 0 && <AiFlagList flags={fb!.flags} />}
            {fb!.provenance && <p className="mt-2 text-[11.5px] text-gray-600">Model {fb!.provenance.model} · prompt {fb!.provenance.promptVersion}</p>}
            {/* D01: kept, or honestly not (a session the browser holds, history off, or the store refusing). */}
            <p role="status" className="mt-2 text-[12.5px] text-gray-700">{fb!.kept ? CHECK_SAVED_NOTE : session?.id && session.recorded ? CHECK_NOT_SAVED_NOTE : "Not kept: this session is not recorded, so nothing is saved to your learning record."}</p>
          </section>
        )}
        {/* (a) THE SELF-REVIEW, no AI: the lesson's own key points and the sections the question rests on. Never a verdict. */}
        {showSelfReview && (
          <section aria-label="Compare with your notes" className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">{CHECK_SELF_REVIEW_LABEL}</p>
            <p className="mt-1 text-[13px] text-gray-700">{CHECK_SELF_REVIEW_NOTE}</p>
            {ref.points.length > 0
              ? <div className="mt-2 text-[14px] leading-relaxed text-gray-800"><h5 className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">Key points from your notes</h5>{bullets(ref.points)}</div>
              : <p className="mt-2 text-[13px] text-gray-700">This lesson has no saved key points yet. Read the sections below and compare your answer with them.</p>}
            {/* D01 (CYU-03): the learner keeps the answer with their OWN judgement, or without a mark. No AI, never a verdict. */}
            {session?.id && session.recorded && c.answer.trim() && (
              <div className="mt-2.5" role="group" aria-label="Keep this answer with your own judgement">
                <p className="text-[12.5px] text-gray-700">Keep this answer in your learning record with your own judgement (no AI):</p>
                <div className="mt-1.5 flex flex-wrap gap-2 pointer-coarse:flex-col">
                  {(["covered", "partly", "missed"] as const).map(g => (
                    <button key={g} type="button" aria-pressed={c.selfGrade === g} disabled={c.saved === "saving" || c.saved === "saved"} onClick={() => void saveCheck(st, g)}
                      className={`${chip} ${c.selfGrade === g ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-900 hover:bg-gray-100"}`}>{SELF_GRADE_LABEL[g]}</button>
                  ))}
                  <button type="button" disabled={c.saved === "saving" || c.saved === "saved"} onClick={() => void saveCheck(st, null)} className={`${chip} border-gray-300 bg-white text-gray-700 hover:bg-gray-100`}>Keep without a mark</button>
                </div>
                {c.saved === "saving" && <p role="status" className="mt-1.5 text-[12.5px] text-gray-600">Saving…</p>}
                {c.saved === "saved" && <p role="status" className="mt-1.5 text-[12.5px] text-gray-800">{c.selfGrade ? `${SELF_GRADE_SAID[c.selfGrade]}. ` : ""}{CHECK_SAVED_NOTE}</p>}
                {c.saved === "failed" && <p role="alert" className="mt-1.5 text-[12.5px] text-red-700">{CHECK_NOT_SAVED_NOTE}</p>}
              </div>
            )}
          </section>
        )}
        {/* Review source: the sections the question rests on, with their excerpts, and a link to each in your notes. */}
        {answered && c.reviewing && (
          <section aria-label="Sources for this check" className="mt-3 rounded-lg border border-gray-200 px-3 py-2.5">
            <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">{SOURCE_KIND_LABEL.notes}</p>
            {ref.sources.length ? (
              <ul className="mt-1.5 space-y-2">
                {ref.sources.map(s => (
                  <li key={s.chunkId} className="text-[13.5px] text-gray-800">
                    <Link href={sourceHref(s.materialId, s.chunkId)} className={`font-semibold underline underline-offset-2 ${focusRing}`}>[{s.tag}] {s.citation}</Link>
                    {s.excerpt && <p className="mt-0.5 whitespace-pre-wrap text-[13px] text-gray-700">{s.excerpt}{s.excerpt.length >= 400 ? "…" : ""}</p>}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-1 text-[13px] text-gray-700">Open this lesson&apos;s sources from the Sources list.</p>}
          </section>
        )}
        {answered && !working && (
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="After this check">
            <button type="button" className={ghost} onClick={retryCheck}>{CHECK_BUTTON.again}</button>
            <button type="button" className={ghost} aria-pressed={c.reviewing} onClick={() => setCheck({ ...c, reviewing: !c.reviewing })}>{CHECK_BUTTON.source}</button>
            <button type="button" className={btn} style={{ background: accent }} onClick={() => continueAfterCheck(st)}>{CHECK_BUTTON.continue}</button>
          </div>
        )}
      </form>
    );
  };

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
    // SCHOLAR-GO-DEEPER-001: a structured round's questions are answered under the question, as a lesson's are.
    const deeperRounds = thread.filter(c => c.reply.action === "deeper" && !!c.reply.answer && !c.reply.withheld && !!parseDeeperAnswer(c.reply.answer));
    const deeperQuestions = deeperRounds.flatMap(c => (parseDeeperAnswer(c.reply.answer!)?.questions ?? []).filter(q => answerable(st, c.reply, q.text)).map(q => q.text));
    const newestRound = deeperRounds[deeperRounds.length - 1] ?? null;
    const roundsByDepth: Partial<Record<string, string>> = {};
    thread.forEach((c, k) => { if (deeperRounds.includes(c) && c.reply.depth) roundsByDepth[c.reply.depth] = lessonAnchorId(st.step, `a${k}`); });
    const checkInline = !!myCheck && ((!!lastTeach && teachQuestions.some(q => questionText(q) === myCheck.question)) || deeperQuestions.some(q => questionText(q) === myCheck.question));
    const acts = j?.activities[i] ?? {};
    const canTeach = !!group.primary && props.consent && !offReason(group.primary);
    const first = st.sections[0];
    // Apply only where the content is clinically relevant (a competency studied, or an accepted competency mapping on a section).
    const applyHref = first && applyEligible(session.scopeKind, st.sections.map(x => x.chunkId), mappedChunks) ? `/individual/scholar/study/apply?section=${first.chunkId}&from=teach` : null;
    // SCHOLAR-LEARN-STYLE-01: three teaching styles (Explain, Guide me, Challenge me), the More menu, and Explain my mistake only after a wrong check.
    const av = { actions: props.actions, consent: props.consent, reasonOf: offReason };
    const stylePolicy = props.styleOn ?? STYLE_DEFAULTS;
    const styleList = styleChoices(stylePolicy, av);
    const moreList = moreItems(stylePolicy, av, more);
    const mistake = mistakeOffer(av, verdict, !!lastCheck[st.step]);
    // SALE-2026-11 R1: the lesson's next teaching step, what its different question will be, and why an AI step cannot run now.
    const adaptiveHere = adaptive[st.step] ?? null;
    const different = adaptiveHere ? pickDifferentQuestion({ lessonQuestions: teachQuestions.map(questionText), answered: [adaptiveHere.question, ...(checks[st.step] ?? []).map(c => c.question)], earlier: adaptiveHere.decision.earlierQuestions }) : null;
    const differentLabel = different ? (different.source === "lesson" ? "Try a different question from this lesson" : "Try a question from an earlier lesson")
      : props.actions.includes("ask_me") && props.consent && !offReason("ask_me") ? "Ask me a different question" : null;
    const adaptiveOff = !adaptiveHere ? null : !props.consent ? (props.offMessage ?? "AI help is off.") : offReason(adaptiveHere.decision.approach) ? aiReasonCopy(offReason(adaptiveHere.decision.approach)!, "scholar").text : null;
    const style = effectiveStyle(styleChosen, styleList);
    const parts = lastTeach ? parseTeachAnswer(lastTeach.reply.answer!) : null;
    // The draft card's front and back must belong together. A check question has no answer in the lesson (only the AI
    // judgement gives one), so it is never paired with the key points: the front asks for the key points and the back
    // lists them one per line, cut at a whole point within 600 characters. With no key points, the lesson's objective.
    const draft = draftOwnCard(st.title, parts?.points ?? [], st.objective);
    const items: Activity[] = [
      ...(group.primary ? [{ key: "understand", label: "Understand", done: hasLesson, disabled: hasLesson || busyHere || !canTeach,
        onClick: () => dispatch({ type: "requestTeach", index: i }) }] : []),
      // SCHOLAR-CUMULATIVE-TEACHING-01: Go deeper is a contextual action that may be chosen again: each round extends the last (the server knows the rounds).
      ...(props.actions.includes("deeper") ? [{ key: "deeper", label: working("deeper") ? "Working…" : acts.deeper ? "Go deeper again" : "Go deeper", done: !!acts.deeper, disabled: busyHere || !props.consent || !!offReason("deeper"),
        describedBy: offReason("deeper") ? "learn-ai-why" : undefined, onClick: () => void goDeeper(st) }] : []),
      ...(props.actions.includes("examples") ? [{ key: "examples", label: working("examples") ? "Working…" : "Examples", done: !!acts.examples, disabled: busyHere || !props.consent || !!offReason("examples"),
        describedBy: offReason("examples") ? "learn-ai-why" : undefined, onClick: () => void act("examples", {}, "lesson", undefined, st.step) }] : []),
      ...(offerCheck ? [{ key: "check", label: working("check") ? "Writing a check…" : checked ? "Check again" : "Check", done: checked, disabled: !canCheck || busyHere,
        describedBy: offReason("check") ? `learn-check-why-${st.step}` : undefined, onClick: () => void startCheck(st) }] : []),
      { key: "practise", label: "Practise", pressed: !!practiceOpen[st.step], done: !!acts.practised, onClick: () => setPracticeOpen(m => ({ ...m, [st.step]: !m[st.step] })) },
      ...(applyHref ? [{ key: "apply", label: "Apply", done: !!acts.applied, onClick: () => { dispatch({ type: "activity", index: i, kind: "applied" }); router.push(carry(applyHref)); } }] : []),
      { key: "evaluate", label: "Evaluate", onClick: () => router.push(carry(evaluationHref())) },
    ];
    // SCHOLAR-LEARN-GAPS-02 item 1: a lesson with saved teaching can be downloaded (learn/export, no AI).
    const savedHere = !!records.find(r => r.step === st.step)?.saved || thread.some(c => c.target !== "ask" && c.reply.action === props.startAction && !!(c.reply.saved || c.reply.artefactId));
    const status = navLessons[i].status.label;
    return (
      <LessonCard key={st.step} step={st.step} index={i} count={count} title={st.title || lastTeach?.reply.lesson?.title || ""} objective={st.objective || lastTeach?.reply.lesson?.objective || ""} status={status} accent={accent}>
        {/* SCHOLAR-INDEPENDENT-LEARNING-01: the lesson's own notes first (no AI), with their competencies, what exists to practise with, and Mark as read. */}
        {session.id && session.recorded && (
          <LessonReader hidePictures={!!recalling[st.step]} sessionId={session.id} step={st.step} index={i} current={j?.current === i} hasLesson={hasLesson} aiAvailable={props.consent && !offReason(props.startAction)} marked={!!facts[i]?.marked}
            markedNote={markedNote[st.step] ?? null} accent={accent} onLoaded={readerLoaded} onMarkRead={markRead} ownCards={!!props.ownCards && !!first?.materialId} />
        )}
        {/* Nothing here yet: a calm line and the one way in (the learner's choice). Manual: the starting action, as before. */}
        {/* SCHOLAR-PERSISTENT-LEARNING-01: the one way in -- Review saved lesson (no AI), else Continue / Start learning. */}
        {!hasLesson && !preparing && !lessonMsg && pending?.step !== st.step && (
          opening[st.step] ? <p role="status" className="mt-3 text-[13.5px] text-gray-700">Opening your saved lesson…</p>
            : primaryAction(facts[i], true) === "review" ? <LessonPlaceholder note="You have saved teaching for this lesson. Opening it uses no AI." label={PRIMARY_LABEL.review} onTeach={() => void openLesson(st.step)} />
            : !props.consent ? <LessonPlaceholder label="" note="AI teaching is off. Your notes above are this lesson; everything saved still opens." />
            : group.primary ? <LessonPlaceholder note={primaryAction(facts[i], true) === "continue" ? "You started this lesson. Carry on where you left it." : "Not started yet."}
                label={working(group.primary) ? "Working…" : PRIMARY_LABEL[primaryAction(facts[i], true)]}
                disabled={busyHere || !canTeach} describedBy={offReason(group.primary) ? "learn-ai-why" : undefined}
                onTeach={() => (guided ? dispatch({ type: "requestTeach", index: i }) : void act(group.primary!, {}, "lesson", undefined, st.step))} />
              : <LessonPlaceholder label="" note="Ask Scholar anything about this lesson." />
        )}
        {/* SCHOLAR-UNDERSTANDING-CHECKS-01: a clarify question for an open check is shown in the check panel, where the learner is. */}
        {pending?.target === "lesson" && (pending.step ?? at) === st.step && !(pending.action === "clarify" && myCheck) && <ClarifyPurpose key={pending.question ?? pending.asked ?? pending.action} clarify={pending.prompt} busy={!!busy} accent={accent} className="mt-4" onEducation={() => void answerEducation()} onPatient={() => confirmStudy(false)} />}
        <div className="mt-4 space-y-4">
          {recalling[st.step] ? (
            <p role="status" className="flex flex-wrap items-center gap-x-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800">
              Lesson text hidden while you recall
              <button type="button" onClick={() => setRecalling(m => ({ ...m, [st.step]: false }))} className={`inline-flex min-h-[44px] items-center font-semibold underline pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Show it</button>
            </p>
          ) : thread.map((c, k) => (c.id === myCheck?.cardId ? null : <ReplyCard key={c.id} card={c} labels={props.labels} anchorId={lessonAnchorId(st.step, `a${k}`)} onFresh={c.reply.saved && props.consent ? () => act(c.reply.action, { fresh: true, ...(c.reply.action === "deeper" && c.reply.depth ? { depth: c.reply.depth } : {}) }, "lesson", undefined, st.step) : undefined}
            onRephrase={props.actions.includes("ask") ? () => rephrase("") : undefined} recover={recoverFor(c, st)} wider={widerFor(c, st)} expansions={expansionsFor(c, st)}
            onAnswer={canCheck && (c === lastTeach || deeperRounds.includes(c)) ? q => void startCheck(st, q) : undefined} canAnswer={q => answerable(st, c.reply, q)}
            onChoose={deeperRounds.includes(c) && offerCheck && !busy && !offReason("check") ? (q, option) => { if (!myCheck || myCheck.question === questionText(q)) chooseOption(st, q, option); } : undefined}
            deeperLevels={c === newestRound && c.reply.goDeeperLevels ? { saved: roundsByDepth, busy: !!busy, onLevel: props.consent && !offReason("deeper") ? depth => void goDeeper(st, depth) : undefined } : null}
            renderCheck={(c === lastTeach || deeperRounds.includes(c)) && checkInline ? q => (questionText(q) === myCheck?.question ? checkPanel(st, true) : null) : undefined}
            answered={c === lastTeach || deeperRounds.includes(c) ? q => { const h = (checks[st.step] ?? []).filter(x => x.question === questionText(q)).at(-1); return h ? checkOutcomeLabel(h, CHECK_VERDICT_LABEL) : null; } : undefined}
            placement={props.checkPlacement ?? "distributed"} ask={lessonAsk(st, session, c.reply)} />))}
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
        {myCheck && !checkInline && <div className="mt-4">{checkPanel(st, false)}</div>}
        {/* SALE-2026-11 R1 (SALE-06/07): the next teaching step after a kept check, with its reason. Skippable; nothing runs by itself. */}
        {adaptiveHere && (
          <div id={`adaptive-next-${st.step}`} className="scroll-mt-4"><AdaptiveNext ui={adaptiveHere} step={st.step} accent={accent} offReason={adaptiveOff} differentLabel={differentLabel}
            onRun={() => void runAdaptive(st)} onDifferent={() => void adaptiveDifferent(st)} onSkip={() => closeAdaptive(st.step)} /></div>
        )}
        {offerCheck && offReason("check") && <p id={`learn-check-why-${st.step}`} className="mt-2 text-[12.5px] text-gray-600">{aiReasonCopy(offReason("check")!, "scholar").text}</p>}
        {settingsChanged && group.primary && props.consent && (
          <button type="button" className={`${ghost} mt-3`} disabled={busyHere || !!offReason(group.primary)} onClick={() => void teachLesson(st.step, { mode, depth })}>Teach this lesson again with these settings</button>
        )}

        {/* SCHOLAR-LESSON-VISUALS-01: the original pictures of the slides / pages this lesson cites (no AI), after its teaching and before its
            actions. Hidden while the learner recalls the lesson, so a picture cannot give the answer away. */}
        {props.visuals?.on && hasLesson && !recalling[st.step] && (
          <LearnVisuals enabled max={props.visuals.max}
            sections={st.sections.map(x => ({ chunkId: x.chunkId, materialId: x.materialId, materialTitle: x.materialTitle, unit: x.unit, pageFrom: x.pageFrom, pageTo: x.pageTo }))} />
        )}

        {/* SCHOLAR-INLINE-CHECKS-01: short checks inside the lesson, after its teaching and before its actions. Additive; every one is optional
            and none blocks scrolling. The recall rating is the learner's own word, the quick check is marked by code, neither is competence. */}
        {blockHere && blockHere.closesAt === i && blockCards(blockHere).length > 0 && hasLesson && (
          <RecallBlock cards={blockCards(blockHere)} required={requiredMode} skippable={inlinePolicy.skippable === "on"} saveMissed={inlinePolicy.saveMissed === "on"}
            ownCards={!!props.ownCards} accent={accent} registerSave={registerSave}
            onMark={(stepNo, m) => dispatch({ type: "mark", index: indexOf(stepNo), recalled: m })}
            onStart={() => setRecalling(m => ({ ...m, [st.step]: true }))} onEnd={() => setRecalling(m => (m[st.step] ? { ...m, [st.step]: false } : m))} />
        )}
        {inlinePolicy.checks === "on" && first?.chunkId && hasLesson && (
          <QuickCheck chunkId={first.chunkId} aiAllowed={props.consent && !offReason("questions")} result={acts.quickChecked ?? null} accent={accent}
            onResult={m => dispatch({ type: "mark", index: i, quickChecked: m })} onPractised={() => dispatch({ type: "activity", index: i, kind: "practised" })} />
        )}
        {applyHref && hasLesson && applicationAfter(i, count, inlinePolicy, true) && <ApplyCard href={applyHref} skippable={inlinePolicy.skippable === "on"} onApplied={() => dispatch({ type: "activity", index: i, kind: "applied" })} />}

        {/* LEARNING-CLOSE-2026-11 D01 (CYU-04): the lesson's kept checks, revisitable on any device, each attempt its own; Try again reopens the check with the answer. */}
        {(checks[st.step]?.length ?? 0) > 0 && (
          <LearningDisclosure tone="check" icon="question" title={`Your previous checks (${checks[st.step].length})`} className="mt-4" bodyClassName="py-0">
            {/* LEARN SECTIONS HFE: each kept check is its own light card -- when, the outcome in words, how it was marked, the
                question, the learner's answer, the feedback in its parts, and one action row. */}
            <ul className="space-y-3 py-1">
              {checks[st.step].map(h => (
                <SectionCard as="li" key={h.attemptId} className="text-[14px]">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-gray-700">
                    <span className="cmp-learn-ink inline-flex items-center gap-1 rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2 py-0.5 font-semibold">{checkOutcomeLabel(h, CHECK_VERDICT_LABEL)}</span>
                    <span>{new Date(h.answeredAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                  </p>
                  <p className="mt-1 text-[12.5px] text-gray-700">{CHECK_MARKING_LABEL[h.marking]}</p>
                  <p className="mt-2 break-words text-[15px] font-semibold leading-snug text-gray-900">{h.question}</p>
                  <p className="mt-2 break-words border-l-2 border-[var(--learn-accent)] pl-3 leading-relaxed text-gray-800"><span className="font-semibold">You:</span> {h.response.text}</p>
                  {h.response.feedback && <CheckFeedbackList parts={h.response.feedback} sources={lastTeach?.reply.sources ?? []} />}
                  {h.response.summary && <p className="mt-2 whitespace-pre-wrap text-[13.5px] leading-relaxed text-gray-800"><Cited text={h.response.summary} sources={lastTeach?.reply.sources ?? []} /></p>}
                  <ActionRow label="This check">
                    <button type="button" disabled={!!myCheck || busyHere} className={learnAction.secondary}
                      onClick={() => { setCheck(openCheck(st.step, teachQuestions.find(q => questionText(q) === h.question) ?? h.question, h.response.text)); setTimeout(() => document.getElementById("check-answer")?.focus(), 0); }}>Try again</button>
                  </ActionRow>
                </SectionCard>
              ))}
            </ul>
          </LearningDisclosure>
        )}
        <ActivityRow id={lessonAnchorId(st.step, "act")} label={`Activities for lesson ${i + 1}`} items={items} />
        {session.id && savedHere && <p className="mt-1"><DownloadLink href={lessonExportHref(session.id, st.step)}>Download this lesson (PDF)</DownloadLink></p>}
        {/* SCHOLAR-LIBRARY-01: Add a note, Bookmark lesson, select text then Highlight -- the learner's own words (820), never AI. */}
        {props.notesOn && session.recorded && session.id && (
          <LibraryNotes target={{ targetKind: "lesson", sessionId: session.id, step: st.step, materialId: first?.materialId ?? null, chunkId: first?.chunkId ?? null }}
            containerId={lessonDomId(st.step)} label="Your notes on this lesson" tone="notes" />
        )}

        {/* SCHOLAR-LEARN-STYLE-01: ONE teaching-style choice of three (Explain, Guide me, Challenge me), a discreet More menu, and Explain my
            mistake after a wrong check. Every choice is the learner's click and runs the same request as before; Ask Scholar stays in view. */}
        <div className="mt-4">
          <div id={lessonAnchorId(st.step, "style")} className="min-w-0 scroll-mt-4">
            <ApproachControl step={st.step} style={style} choices={styleList} more={moreList} mistake={mistake}
              onStyle={x => { chooseStyle(x); if (x === "explain" && hasLesson) scrollToLesson(st.step); }}
              onClassic={a => void act(a, {}, "lesson", undefined, st.step)} working={working}
              onExplain={props.actions.includes("explain") ? () => void act("explain", {}, "lesson", undefined, st.step) : undefined}
              verdict={verdict} checks={thread.filter(c => !!c.reply.verdict).length}
              run={runApproach(st)} onQuestion={q => checkThis(st, q)} lastCheck={lastCheck[st.step] ?? null} depth={depth} disabled={busyHere || !props.consent} accent={accent}
              memory={styleMem} remember={remember}
              guidePanel={props.guideAdaptive ? (
                <GuideMePanel key={st.step} state={guideStates[st.step] ?? GUIDE_FRESH}
                  setState={u => setGuideStates(m => ({ ...m, [st.step]: typeof u === "function" ? u(m[st.step] ?? GUIDE_FRESH) : u }))}
                  run={runGuide(st)} busy={!!busy} disabled={busyHere || !props.consent || !!offReason("deeper")} checkDisabled={busyHere || !props.consent || !!offReason("clarify") || props.checks === "off"}
                  offNote={offReason("deeper") ? aiReasonCopy(offReason("deeper") as AiUnavailableReason, "scholar").text : null}
                  renderFlags={f => <AiFlagList flags={f} />}
                  renderClarify={(p, retry) => <ClarifyPurpose clarify={p as ClarifyPrompt} busy={!!busy} accent={accent} onEducation={() => { confirmStudy(true); retry(); }} onPatient={() => confirmStudy(false)} />}
                  cite={(t, srcs) => <Cited text={t} sources={srcs as Source[]} />}
                  answeredOf={q => guideVerdictOf(q, (checks[st.step] ?? []).map(x => ({ question: x.question, verdict: x.response?.verdict ?? null, next: x.response?.feedback?.next ?? null })))}
                  renderResearch={x => <ResearchBlock x={x as ResearchReply} />} />
              ) : undefined}
              askAction={group.ask ? <button type="button" onClick={() => rephrase("")} className={`${chip} min-h-[44px] gap-1.5 border-[var(--cmp-learn-next-border)] bg-[var(--cmp-app-surface)] text-[var(--cmp-learn-next-ink)] hover:bg-[var(--cmp-learn-next-surface)]`}><LearningIcon name="chat" className="h-4 w-4" />{props.labels.ask}</button> : undefined} />
          </div>
        </div>

        <div id={lessonAnchorId(st.step, "practice")} className="scroll-mt-4">
        <LessonPractice open={!!practiceOpen[st.step]} onToggle={o => setPracticeOpen(m => (!!m[st.step] === o ? m : { ...m, [st.step]: o }))}
          chunkId={first?.chunkId ?? null} materialId={first?.materialId ?? null} draft={draft} ownCards={!!props.ownCards}
          aiAllowed={props.consent && !offReason("questions")} applyHref={applyHref} accent={accent}
          onPractised={() => dispatch({ type: "activity", index: i, kind: "practised" })} onApplied={() => dispatch({ type: "activity", index: i, kind: "applied" })} />
        </div>
      </LessonCard>
    );
  };

  return (
    <div ref={setRootEl} className="@container">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[17px] font-bold text-gray-900">{session.title}</h2>
        <p className="text-[12.5px] text-gray-600">
          {session.recorded ? "Saved: you can leave and resume this session." : (note ?? "Not saved.")}
          {session.coverage && session.coverage.sections < session.coverage.of ? ` Suggested steps cover ${session.coverage.sections} of ${session.coverage.of} sections; ask about any of them.` : ""}
        </p>
      </div>
      {!props.consent && <p className="mb-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-[13.5px] text-gray-700">{WORKS_WITHOUT_AI} {props.offMessage} <Link href={experienceHref("scholar", "study")} className={`font-semibold underline ${focusRing}`}>Go to My Learning</Link></p>}
      {props.standingMessage && (
        <p className="mb-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-[13.5px] text-sky-950">
          {props.standingMessage} Your saved explanations, questions, cards, cases and progress are all still here. <Link href={experienceHref("scholar", "study/saved")} className={`font-semibold underline ${focusRing}`}>Saved learning</Link>
        </p>
      )}
      {error && <p role="alert" className="mb-3 text-[13.5px] font-medium text-red-700">{error}</p>}
      <p aria-live="polite" className="sr-only">{announce}</p>

      {/* LESSON REDESIGN: below 66rem of content width, Lessons & sources and Ask Scholar open as panels in place of the lesson
          (each keeps its scroll place: showTab). The selected tab is filled AND underlined, not colour alone. */}
      <div id="learn-tabs" role="tablist" aria-label="Workspace" className="mb-3 flex flex-wrap gap-1.5 rounded-2xl border border-gray-200 bg-white p-1.5 @min-[66rem]:hidden">
        {(["lesson", "sources", "ask"] as const).map(t => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => showTab(t)}
            className={`inline-flex min-h-[44px] flex-1 basis-[6.5rem] items-center justify-center gap-1.5 rounded-xl px-3 text-[13.5px] font-semibold ${tab === t ? "bg-[var(--cmp-learn-next-ink)] text-[var(--cmp-learn-next-surface)] underline decoration-2 underline-offset-4" : "text-gray-800 hover:bg-gray-50"} ${focusRing}`}>
            <LearningIcon name={t === "lesson" ? "teach" : t === "sources" ? "list" : "chat"} className="h-4 w-4" />{t === "lesson" ? "Lesson" : t === "sources" ? "Lessons & sources" : "Ask Scholar"}</button>
        ))}
      </div>

      {/* The two dividers are 20px columns (the old gap-5); the Ask column also yields to the lesson's 420px if the container narrows. */}
      <div className="@min-[66rem]:grid @min-[66rem]:grid-cols-[var(--l-w,240px)_auto_minmax(0,1fr)_auto_var(--r-w,300px)] @min-[66rem]:items-start @min-[66rem]:gap-0"
        style={{ "--l-w": `${cols.start.size ?? 240}px`, "--r-w": `min(${cols.end.size ?? 300}px, max(200px, calc(100cqw - 460px - var(--l-w))))` } as CSSProperties}>
        {/* ── THE NAVIGATOR AND SOURCES: the lessons with their marks, and the current lesson's own sections ── */}
        <aside aria-label="Lessons and sources" className={`${panel("sources")} rounded-2xl border border-gray-200 bg-white p-4 @min-[66rem]:sticky @min-[66rem]:top-4 @min-[66rem]:max-h-[calc(100vh-2rem)] @min-[66rem]:overflow-y-auto`}>
          {/* LESSON REDESIGN: the lessons first, then the current lesson's sources in their own lavender-grey block. */}
          <div className="cmp-learn-next"><LearningSectionHead level={3} icon="teach" title="Your lessons" /></div>
          <p className="mt-1.5 text-[12.5px] text-gray-700"><span className="font-semibold text-gray-900">{read} of {count} read.</span> A learning record for you, not an assessment.</p>
          {oneMaterial && anySaved && <p className="mt-1"><DownloadLink href={materialExportHref(oneMaterial)}>Download all saved lessons (PDF)</DownloadLink></p>}
          <div className="mt-2"><JourneyOutline lessons={navLessons} onJump={select} /></div>
          {step && (
            <div className={`${learnBox("sources")} mt-4 p-3`}>
              <LearningSectionHead level={3} icon="library" title="This lesson&apos;s sources" />
              {/* LEARN SECTIONS HFE: the material named once, its slides or pages as chips that open them (the full citation is
                  each chip's name), and the original file under the title. An AI-read source keeps its note. */}
              {[...new Map(step.sections.map(x => [x.materialId, x.materialTitle])).entries()].map(([mid, mtitle]) => {
                const mine = step.sections.filter(x => x.materialId === mid);
                const read = mine.filter(x => aiReadNote.get(x.chunkId));
                return (
                  <div key={mid} className="mt-2.5">
                    <p className="break-words text-[13px] font-semibold leading-snug text-gray-900">{mtitle}</p>
                    <ul className="mt-1.5 flex flex-wrap gap-1.5">
                      {mine.map(x => <li key={x.chunkId}><RefChip href={sourceHref(x.materialId, x.chunkId)} text={shortRef(x.unit, x.pageFrom, x.pageTo) ?? x.citation} citation={x.citation} /></li>)}
                    </ul>
                    {read.map(x => <InlineNote key={x.chunkId} kind="ai" className="mt-1.5 text-[12px]">{shortRef(x.unit, x.pageFrom, x.pageTo) ?? x.citation}: {aiReadNote.get(x.chunkId)}</InlineNote>)}
                    <p className="mt-1.5 text-[12.5px]"><a href={`/api/individual/scholar/materials/${mid}`} className={`inline-flex min-h-[32px] items-center text-gray-800 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Original: {mtitle}</a></p>
                  </div>
                );
              })}
              {/* SCHOLAR-APPLY-CONNECTED-01: practice from this learning stays findable in My Practice Library. */}
              <p className="mt-3 text-[12.5px]"><Link href="/individual/scholar/study/apply?view=library" className={`cmp-learn-ink inline-flex min-h-[32px] items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>My Practice Library</Link></p>
              {/* CLINICAL-REASONING-01 CR1: from Teach Me, a case written from this step's own section. */}
              <p className="mt-3 text-[12.5px]"><Link href={`/individual/scholar/study/apply?section=${step.sections[0].chunkId}&from=teach`} className={`cmp-learn-ink inline-flex min-h-[32px] items-center font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Practise this in a clinical case</Link></p>
            </div>
          )}
        </aside>

        <ResizeHandle {...cols.start.handleProps} label="Resize the lessons and sources column" className="hidden @min-[66rem]:block @min-[66rem]:self-stretch" />

        {/* ── THE JOURNEY: the lessons revealed so far, one after another; the settings once, above them ── */}
        <div ref={column} className={`${panel("lesson")} min-w-0 space-y-4`} onPointerDown={() => { engaged.current = true; }}>
          {banner !== null && session.steps[banner] && (
            <ResumeBanner lesson={banner + 1} title={session.steps[banner].title} onGo={() => { const b = banner; setBanner(null); select(b); }} onDismiss={() => setBanner(null)} />
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
                <span><span className="font-semibold">Guided learning: teach a lesson when I open it</span>
                  <span className="block text-[12px] text-gray-600">On by default. A lesson you have saved teaching for always opens it, with no AI. Off: choose Start learning for each lesson yourself. Saved on this device. Scholar never moves to the next lesson for you, and scrolling never asks it to write anything.</span></span>
              </label>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700"><span id="learn-depth-l">Depth</span>
                <DepthSegment value={depth} onChange={setDepth} disabled={!!busy} accent={accent} />
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-gray-700">
                <label htmlFor="learn-spelling">Spelling</label>
                <select id="learn-spelling" value={spelling} onChange={e => setSpelling(e.target.value as SpellingChoice)}
                  className={`rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
                  {SPELLING_CHOICES.map(c => <option key={c} value={c}>{SPELLING_CHOICE_LABEL[c]}</option>)}
                </select>
                <span className="basis-full text-[12px] text-gray-600">Used to read what you type in Ask Scholar, the assistant, Revise and Apply. Only obvious typing slips are fixed; clinical words, numbers and your notes are never changed, and your answers are marked exactly as you typed them. Saved on this device.</span>
              </div>
              <SpeechSetting />
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

          {/* SCHOLAR-PERSISTENT-LEARNING-01: ONE active lesson in full; the others as compact rows, in order, tap to make active. */}
          <LessonList rows={rows.slice(0, curIdx)} onSelect={select} label="Earlier lessons" />
          {session.steps.slice(curIdx, curIdx + 1).map(st => lesson(st, curIdx))}

          {/* After the active lesson: Previous / Next lesson -- the learner's choice, never reached by scrolling. */}
          {active && (
            <ContinueCard accent={accent} last={lastLesson} completed={session.status === "completed"} disabled={!!busy}
              next={!lastLesson ? { number: curIdx + 2, title: session.steps[curIdx + 1].title || `Lesson ${curIdx + 2}` } : null}
              blockedReason={canContinue ? undefined : RECALL_WAIT_REASON} onContinue={continueNext} onPrevious={curIdx > 0 ? previous : undefined} onFinish={() => void finish()} onReview={() => select(0)}
              onDeeper={props.actions.includes("deeper") && props.consent && !offReason("deeper") ? () => void goDeeper(active) : undefined}
              onPractise={() => { setPracticeOpen(m => ({ ...m, [active.step]: true })); scrollToLesson(active.step); }}
              otherTopicHref={experienceHref("scholar", "study/learn")}
              suggestion={adaptive[active.step] ? { label: NEED_LABEL[adaptive[active.step]!.decision.need], why: adaptive[active.step]!.decision.reason, href: `#adaptive-next-${active.step}` } : null} />
          )}
          <LessonList rows={rows.slice(curIdx + 1)} onSelect={select} label="Later lessons" />

          {/* LEARNING-CLOSE-2026-11 D03 / LE-03: a recorded session's lessons can be renamed, merged or split (955), progress re-pointed by containment. */}
          {session.recorded && session.id && session.steps.length > 0 && (
            <RecutPanel sessionId={session.id} steps={session.steps} titles={session.lessonTitles ?? null} accent={accent} disabled={!!busy} />
          )}

          {/* Below 66rem of content width: the compact sticky navigator; it reflects the ACTIVE lesson. */}
          <JourneyBar lessons={navLessons} current={curIdx} read={read} onJump={select}
            trailing={<>
              {props.actions.includes("ask") && <button type="button" className={`${ghost} gap-1.5 px-3`} onClick={() => rephrase("")} aria-label="Ask Scholar"><LearningIcon name="chat" className="h-4 w-4" /><span aria-hidden="true" className="hidden @min-[30rem]:inline">Ask Scholar</span></button>}
              {!lastLesson && <button type="button" className={`${btn} px-3`} style={{ background: accent }} onClick={continueNext} disabled={!!busy || !canContinue} title={canContinue ? undefined : RECALL_WAIT_REASON}>Next lesson</button>}
            </>} />
        </div>
        <ResizeHandle {...cols.end.handleProps} label="Resize the Ask Scholar column" className="hidden @min-[66rem]:block @min-[66rem]:self-stretch" />
        {/* ── THE SCHOLAR ASSISTANT: ask anything about these notes, at any point ── */}
        {/* LESSON REDESIGN: on the wide layout Ask Scholar stays in view beside the lesson (sticky, its own scroll), so asking
            never moves the reading place. */}
        <aside aria-labelledby="ask-h" className={`${panel("ask")} rounded-2xl border border-gray-200 bg-white p-4 @min-[66rem]:sticky @min-[66rem]:top-4 @min-[66rem]:max-h-[calc(100vh-2rem)] @min-[66rem]:overflow-y-auto`}>
          <div className="cmp-learn-next"><LearningSectionHead level={3} id="ask-h" icon="chat" title="Ask Scholar" /></div>
          <p className="mt-1.5 text-[12.5px] text-gray-700">About anything in this session&apos;s notes. Answers cite the section they came from.</p>
          {props.actions.includes("ask") ? (
            <form onSubmit={submitAsk} className="mt-2">
              <label htmlFor="ask-q" className="sr-only">Your question</label>
              <textarea id="ask-q" rows={2} maxLength={QUESTION_MAX} value={ask} onChange={e => setAsk(e.target.value)} placeholder="For example: why is oxygen given to a target range?"
                className={`w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] ${focusRing}`} disabled={!props.consent} />
              <button type="submit" className={`${ghost} mt-2`} disabled={!!busy || !ask.trim() || !props.consent || !!offReason("ask")} aria-describedby={offReason("ask") ? "learn-ask-why" : undefined}>{busy === "ask" ? "Reading your notes…" : "Ask"}</button>
              {props.consent && offReason("ask") && <p id="learn-ask-why" className="mt-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-700">{aiReasonCopy(offReason("ask")!, "scholar").text}</p>}
              <HistoryNotice />
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
                        <span className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{a.label ?? PERSONAL_AI_LABEL}</span>
                        <span className="min-w-0 flex-1 truncate"><span className="font-semibold">You:</span> {asked}</span>
                      </summary>
                      <div className="px-3 pb-3">{body}</div>
                    </details>
                  );
                  return (
                    <article key={a.id} className="rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-3">
                      <p className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-indigo-900">{a.label ?? PERSONAL_AI_LABEL}</p>
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
/**
 * SCHOLAR-CE-2026 CE-01 (Learn lesson): the "Ask about this" context of one lesson reply -- the sections the lesson cites (else the
 * step's own sections), at most ASK_CHUNK_MAX, with the material, the session and the step. The server reads every id again by the
 * caller's own id; these are claims. Same builder inputs as the Library, Revise, flashcards and case surfaces.
 */
function lessonAsk(st: { step: number; title: string; sections: { chunkId: string; materialId: string }[] }, session: { id: string | null }, r: Reply): Omit<AskAboutProps, "className"> {
  const cited = new Set(r.cited ?? []);
  const fromCited = r.sources.filter((x, i) => cited.has(i + 1)).map(x => x.chunkId);
  const ids = [...new Set((fromCited.length ? fromCited : st.sections.map(x => x.chunkId)).filter(Boolean))].slice(0, ASK_CHUNK_MAX);
  const title = st.title || "this lesson";
  return {
    surface: "learn", chunkIds: ids, materialId: st.sections[0]?.materialId ?? null, sessionId: session.id, step: session.id ? st.step : null,
    refLabel: `This lesson: ${title}`, prefill: askPrefill("library", { title }),
  };
}

function ReplyCard({ card, labels, compact = false, onFresh, onRephrase, recover, wider, onAnswer, canAnswer, expansions = [], renderCheck, anchorId, ask, placement, answered, onChoose, deeperLevels = null }: {
  /** SCHOLAR-GO-DEEPER-001: choosing an answer option of a round's question; the level control, on the lesson's newest round only. */
  onChoose?: (q: string, option: string) => void; deeperLevels?: GoDeeperLevels | null;
  /** LESSON REDESIGN: a lesson question's answered state (the latest kept attempt's outcome), or null when not answered yet. */
  answered?: (q: string) => string | null;
  /** The lesson-level "Ask about this" (the lesson thread only; not the short Ask replies or a saved list). */
  ask?: Omit<AskAboutProps, "className">;
  /** LEARNING-CLOSE-2026-11 CYU-01: where a Teach Me lesson's check questions are shown (learn-check-record.ts placeChecks). */
  placement?: CheckPlacement;
  /** SCHOLAR-LEARN-GAPS-02 item 2: the fixed DOM id of this reply in its lesson (the reading place is saved against it). */
  anchorId?: string;
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
  // SCHOLAR-CUMULATIVE-TEACHING-01: Go deeper found nothing further of value in the notes. Said plainly, with what to do instead (existing activities).
  if (r.depthReached) {
    return (
      <article id={anchorId} className={`${anchorId ? "scroll-mt-4 " : ""}rounded-xl border border-sky-200 bg-sky-50/60 p-4`}>
        <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">{name} · depth reached</p>
        <p className="mt-1 text-[14px] text-gray-800">{r.depthReached.message}</p>
        {r.depthReached.suggestion && <p className="mt-1.5 text-[14px] text-gray-900">{r.depthReached.suggestion}</p>}
        <p className="mt-2 text-[12.5px] text-gray-700">Next: {r.depthReached.next.map(n => n.label).join(" · ")} (the activities below).</p>
      </article>
    );
  }
  const cited = new Set(r.cited ?? []);
  // SCHOLAR-GO-DEEPER-001: a structured round has its own card (go-deeper-view.tsx). An earlier round has none of its labels and is shown as it was.
  const round = r.action === "deeper" && r.answer && !r.withheld ? parseDeeperAnswer(r.answer) : null;
  const deep = compact ? null : round;
  // LESSON REDESIGN: a lesson's teaching is the Teach me card (sage); its end-of-lesson checks are their own card (lavender),
  // then its sources, the AI background beyond the notes (sky) and the saved line. A check's feedback in the thread is
  // lavender. Short Ask replies (compact) keep the plain card.
  const teachCard = !compact && r.action !== "clarify" && !r.verdict;
  const checkCard = !compact && !teachCard;
  const head = (
    <>
      {card.asked && (
        <p className="mb-1 break-words text-[12.5px] text-gray-600"><span className="font-semibold">You:</span> {r.spelling && r.spelling.original === card.asked ? r.spelling.display : card.asked}
          {/* Item 8: the reading Scholar used (spelling.ts, no AI), with what was typed kept beside it. */}
          {r.spelling && r.spelling.original === card.asked && <span className="ml-1 text-[11.5px] text-gray-500">(corrected from &ldquo;{r.spelling.original}&rdquo;)</span>}
        </p>
      )}
      {teachCard || checkCard
        ? <LearningSectionHead level={4} icon={teachCard ? "teach" : "question"} title={name} />
        : <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-gray-600">{name}</p>}
      {r.withheld ? <Withheld r={r} asked={card.asked} onRephrase={onRephrase} /> : (
        <>
          {r.recovered?.shown && <p className="mt-1.5 inline-flex rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[12px] font-semibold text-gray-900">{RECOVERY_EXPLANATION_LABEL}</p>}
          {r.verdict && <div className="mt-2.5"><VerdictLine value={r.verdict.value} label={r.verdict.label} informal={r.verdict.informal} /></div>}
          {r.verdict && (
            <FormativeAiLabel className="mt-1" />
          )}
          <div className={teachCard ? "mt-3" : "mt-2"}>{round ? <DisclaimerBadge>{GO_DEEPER_COPY.ai}</DisclaimerBadge> : <AiBadge />}</div>
          <p className={`mt-3 text-[11.5px] font-bold uppercase tracking-[0.1em] ${teachCard ? "cmp-learn-ink" : "text-gray-600"}`}>{round ? GO_DEEPER_COPY.subtitle : SOURCE_KIND_LABEL.notes}</p>
          {/* CE-06: the lesson read aloud by the browser's own voice (citation markers and markdown are not spoken). LESSON REDESIGN:
              the listening and asking tools sit on their own row, apart from the reading text. */}
          {r.answer && (
            <div role="group" aria-label="Lesson tools" className={`mt-2 flex flex-wrap items-start gap-2 ${teachCard ? "rounded-xl bg-[var(--cmp-app-surface)] p-2 ring-1 ring-[var(--learn-border)]" : ""}`}>
              <ReadAloudButton text={round ? deeperSourcedText(round) : r.answer} about="this lesson" />
              {ask && <AskAbout {...ask} />}
            </div>
          )}
          {r.answer && <AnswerBody idPrefix={anchorId} text={r.answer} action={r.action} sources={r.sources} onAnswer={onAnswer} canAnswer={canAnswer} renderCheck={renderCheck} placement={placement} answered={answered} only={teachCard ? "lesson" : undefined} />}
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
    </>
  );
  const endChecks = teachCard && !r.withheld && r.answer
    ? <AnswerBody idPrefix={anchorId} text={r.answer} action={r.action} sources={r.sources} onAnswer={onAnswer} canAnswer={canAnswer} renderCheck={renderCheck} placement={placement} answered={answered} only="checks" />
    : null;
  const tail = (
    <>
      {r.sources.length > 0 && !r.next && <SourcesDisclosure sources={r.sources.filter((_, i) => !r.answer || cited.has(i + 1))} />}
      {!r.withheld && r.references.length > 0 && r.answer && /\[R\d+\]/.test(r.answer) && (
        <GovernedReferenceList refs={r.references.filter(x => r.answer!.includes(`[${x.tag}]`))} />
      )}
      {r.background && (
        r.background.text ? (
          <LearningSection tone="aiBeyond" icon="robot" level={5} ariaLabel="AI explanation beyond your notes" title={SOURCE_KIND_LABEL.interpretation} className="mt-3">
            <p className="mt-2 text-[14px] leading-relaxed text-gray-800">{r.background.text}</p>
          </LearningSection>
        ) : r.background.withheld ? <p className="mt-2 text-[12.5px] text-gray-600">{r.background.withheld}</p> : null
      )}
      {r.research && !(deep && r.research.text) && <ResearchBlock x={r.research} />}
      {r.withheld && recover && <RecoveryFlow request={recover.request} explain={recover.explain} expansions={expansions} />}
      {r.withheld && !recover && <ExpansionRow expansions={expansions} />}
      {r.flags && r.flags.length > 0 && <AiFlagList flags={r.flags} />}
      {r.saved && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-600">
          <span>Saved {new Date(r.saved.at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })} · private, for your own study · no new AI was used</span>
          {onFresh && !r.savedEarlier && <button type="button" onClick={onFresh} className={`rounded-lg border border-gray-300 bg-white px-2 py-0.5 font-semibold text-gray-800 hover:bg-gray-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Explain it a new way</button>}
        </p>
      )}
      {/* SCHOLAR-PERSISTENT-LEARNING-01: saved under another prompt version or depth -- shown as it is; rewriting is the learner's click. */}
      {r.savedEarlier && (
        <p className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[12.5px] text-gray-800">
          <span className="min-w-0 break-words">{r.savedEarlier.label}</span>
          {onFresh && <button type="button" onClick={onFresh} className={`${chip} border-gray-300 bg-white text-gray-900 hover:bg-gray-100`}>Refresh lesson</button>}
        </p>
      )}
      {r.savedForLater && <p className="mt-2 text-[12px] text-gray-500">Saved to your learning, so you can come back to it without using AI again.</p>}
      {r.provenance && <p className="mt-2 text-[11.5px] text-gray-600">Model {r.provenance.model} · prompt {r.provenance.promptVersion}</p>}
      {!r.withheld && r.answer && r.action !== "check" && !compact && (
        <AiFeedback kind="explanation" target={r.artefactId ? "artefact" : "action"} refId={r.artefactId ?? r.actionId} />
      )}
    </>
  );
  if (deep) return (
    <GoDeeperCard parts={deep} depth={r.depth} anchorId={anchorId} sources={r.sources} cite={t => <Cited text={t} sources={r.sources} />} levels={deeperLevels}
      onAnswer={onAnswer} onChoose={onChoose} canAnswer={canAnswer} renderCheck={renderCheck} answered={answered}
      research={r.research?.text ? <ResearchBlock x={r.research} /> : null} researchState={r.research?.text ? "shown" : r.research ? "looked" : "none"}
      tools={(
        <div role="group" aria-label="Lesson tools" className="flex flex-wrap items-center gap-2">
          <ReadAloudButton text={deeperSourcedText(deep)} about="this round" />
          {ask && <AskAbout {...ask} />}
        </div>
      )}
      salvage={(
        <>
          {r.salvage && <div className="mt-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-2.5"><p className="text-[13.5px] text-gray-900">{r.salvage.note}</p></div>}
          {replyState(r) === "partial" && r.grounding && <NotCovered terms={r.grounding.uncoveredTerms} wider={wider} expansions={expansions} />}
        </>
      )}
      sourcesAndMore={tail} />
  );
  if (teachCard) return (
    <article id={anchorId} className={anchorId ? "scroll-mt-4" : undefined}>
      <div className={`${learnBox("teach")} p-4 sm:p-5`}>{head}</div>
      {endChecks}
      {tail}
    </article>
  );
  return (
    <article id={anchorId} className={`${anchorId ? "scroll-mt-4 " : ""}${checkCard ? `${learnBox("check")} p-4` : `rounded-xl border border-gray-200 ${compact ? "p-3" : "p-4"}`}`}>
      {head}
      {tail}
    </article>
  );
}

/**
 * SCHOLAR LEARNING DESIGN SYSTEM: a check's feedback in its parts (the same headings and order as before: learn-check.ts),
 * drawn by the shared FeedbackParts -- correct, missing, misconceptions, key points and next action, each with its icon.
 */
function CheckFeedback({ parts, sources, level = 5, compact = false }: { parts: CheckFeedbackParts; sources: Source[]; level?: 4 | 5; compact?: boolean }) {
  const list = (items: readonly string[]) => <ul className={`${compact ? "mt-0.5 space-y-0.5" : "mt-1 space-y-1"} list-disc pl-5`}>{items.map((p, i) => <li key={i}><Cited text={p} sources={sources} /></li>)}</ul>;
  const rows: { kind: FeedbackKind; heading: string; body: React.ReactNode }[] = [
    ...(["right", "missing", "misconceptions", "keyPoints"] as const).filter(k => parts[k].length > 0).map(k => ({ kind: k, heading: CHECK_FEEDBACK_HEADING[k], body: list(parts[k]) })),
    ...(parts.next ? [{ kind: "next" as const, heading: CHECK_FEEDBACK_HEADING.next, body: <p className={compact ? "mt-0.5" : "mt-1"}><Cited text={parts.next} sources={sources} /></p> }] : []),
  ];
  return <FeedbackParts parts={rows} level={level} compact={compact} />;
}

/** LEARNING-CLOSE-2026-11 D01: a kept check's feedback parts (the same headings as the live panel), each point cited into the notes. */
function CheckFeedbackList({ parts, sources }: { parts: CheckFeedbackParts; sources: Source[] }) {
  return <div className="mt-2 text-[13px] leading-relaxed text-gray-800"><CheckFeedback parts={parts} sources={sources} level={5} compact /></div>;
}

/** SCHOLAR-LEARN-FIX-01 L-B: an [S n] citation, inline, as a link to that section of the learner's own notes (the shared CitationChip). */
function CiteLink({ n, sources }: { n: number; sources: Source[] }) {
  const s = sources.find(x => x.tag === `S${n}`);
  if (!s) return <span className="font-mono text-[12.5px]">[S{n}]</span>;
  return <CitationChip tag={s.tag} href={sourceHref(s.materialId, s.chunkId)} label={`${s.citation}${s.aiRead && s.aiReadNote ? `. ${s.aiReadNote}` : ""}`} aiRead={!!s.aiRead} />;
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
function AnswerBody({ idPrefix, text, action, sources, onAnswer, canAnswer, renderCheck, placement = "distributed", answered, only }: { idPrefix?: string; text: string; action: string; sources: Source[]; onAnswer?: (q: string) => void; canAnswer?: (q: string) => boolean; renderCheck?: (q: string) => React.ReactNode; placement?: CheckPlacement;
  /** LESSON REDESIGN: a question's answered state; and which part to render -- the lesson (without its end checks) or only the end checks (their own card). */
  answered?: (q: string) => string | null; only?: "lesson" | "checks" }) {
  // SCHOLAR-CUMULATIVE-TEACHING-01: a Go deeper written in the lesson's parts (v2) is shown as a lesson too; an older free-text one as written.
  const parts = action === "teach" || action === "deeper" ? parseTeachAnswer(text) : null;
  // SCHOLAR-UNDERSTANDING-CHECKS-01: a clarification in the thread (a previous check) shows its labelled parts (learn-check.ts).
  const checkParts = action === "clarify" ? parseCheckFeedback(text) : null;
  if (only === "checks" && (checkParts || !parts)) return null;
  if (checkParts) {
    return (
      <div id={idPrefix ? `${idPrefix}-tx` : undefined} className="mt-2 break-words text-[14.5px] leading-relaxed text-gray-800">
        <CheckFeedback parts={checkParts} sources={sources} level={4} />
      </div>
    );
  }
  // SCHOLAR-PERSISTENT-LEARNING-01 item 4: PROGRESSIVE -- the start first, the rest one click away (no new AI call).
  if (!parts) {
    // SCHOLAR-GO-DEEPER-001: where a structured round is shown in brief (a saved list), it reads as plain text, never its labels.
    const round = action === "deeper" ? parseDeeperAnswer(text) : null;
    const { lead, more } = progressiveSplit(round ? deeperSourcedText(round) : text);
    return (
      <div id={idPrefix ? `${idPrefix}-tx` : undefined} className="mt-1 break-words text-[14.5px] leading-relaxed text-gray-800">
        <div className="whitespace-pre-wrap"><Cited text={lead} sources={sources} /></div>
        {more && <ShowMore label="Show more"><div className="whitespace-pre-wrap"><Cited text={more} sources={sources} /></div></ShowMore>}
      </div>
    );
  }
  const sub = "text-[12px] font-bold uppercase tracking-[0.1em]";
  // LEARNING-CLOSE-2026-11 CYU-01: the lesson's checks follow its teaching sequence (learn-check-record.ts placeChecks): on a
  // substantial lesson the first comes after the teaching paragraphs, the rest after the lesson; every check is optional.
  const placed = action === "teach" ? placeChecks(parts, { placement }) : { mid: [], end: parts.questions.map((_, i) => i) };
  // LESSON REDESIGN: the checks are a lavender card -- each question on its own white row with its Answer this; an answered
  // question also says so (a tick and its last outcome, in words) and its button steps back to outlined; the open answer
  // and its feedback follow under the question (renderCheck).
  const questionBlock = (idxs: number[], id: string | undefined, note: string | null) => idxs.length > 0 && (
    <div id={id} className={`${learnBox("check")} ${note ? "my-4" : "mt-3"} p-4 sm:p-5`}>
      <LearningSectionHead level={4} icon="question" title="Check your understanding" />
      {note && <p className="mt-1.5 text-[12.5px] text-gray-700">{note}</p>}
      <ul className="mt-3 space-y-2.5">
        {idxs.map(i => { const q = parts.questions[i]; const done = answered?.(q) ?? null; return (
          <QuestionCard key={i} question={<Cited text={q} sources={sources} />} answered={done}
            action={onAnswer && canAnswer?.(q) ? { label: "Answer this", onClick: () => onAnswer(q) } : null}>
            {renderCheck && <div className="w-full">{renderCheck(q)}</div>}
          </QuestionCard>
        ); })}
      </ul>
      <p className="mt-2.5 text-[12.5px] text-gray-700">{INFORMAL_CHECK_LABEL}</p>
    </div>
  );
  if (only === "checks") return <>{questionBlock(placed.end, idPrefix ? `${idPrefix}-q` : undefined, null)}</>;
  return (
    <div className="cmp-reading mt-3 break-words text-gray-800">
      {parts.overview && <p id={idPrefix ? `${idPrefix}-ov` : undefined} className="text-[16px] text-gray-900"><Cited text={parts.overview} sources={sources} /></p>}
      {/* SCHOLAR-CUMULATIVE-TEACHING-01: the teaching itself -- connected paragraphs, shown in full (no click to see the lesson). */}
      {!!parts.understanding?.length && (
        <div id={idPrefix ? `${idPrefix}-un` : undefined} className="mt-3">
          {parts.understanding.map((p, i) => <p key={i}><Cited text={p} sources={sources} /></p>)}
        </div>
      )}
      {questionBlock(placed.mid, idPrefix ? `${idPrefix}-qm` : undefined, "A quick check on what you have just read, before the key points. Optional.")}
      {parts.points.length > 0 && (
        <div id={idPrefix ? `${idPrefix}-kp` : undefined} className="mt-4 rounded-xl bg-[var(--cmp-app-surface)] px-4 py-3 ring-1 ring-[var(--learn-border)]">
          <h4 className={`${sub} cmp-learn-ink flex items-center gap-2`}><LearningIcon name="list" className="cmp-learn-accent h-4 w-4" />Key points</h4>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 marker:text-[var(--learn-accent)]">{parts.points.map((p, i) => <li key={i}><Cited text={p} sources={sources} /></li>)}</ul>
        </div>
      )}
      {parts.example && (
        <ShowMore label="Show more: an example from your notes">
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <h4 className={`${sub} text-gray-600`}>Example from your notes</h4>
            <p className="mt-0.5"><Cited text={parts.example} sources={sources} /></p>
          </div>
        </ShowMore>
      )}
      {only !== "lesson" && questionBlock(placed.end, idPrefix ? `${idPrefix}-q` : undefined, null)}
    </div>
  );
}

/** A native disclosure for the rest of an answer: opens from the keyboard, announced as expandable, nothing fetched. */
function ShowMore({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group mt-2 rounded-lg border border-gray-200">
      <summary className={`flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-3 text-[13px] font-semibold text-gray-900 pointer-coarse:min-h-[var(--cmp-touch-min)] [&::-webkit-details-marker]:hidden ${focusRing}`}>
        <span aria-hidden="true" className="text-[10px] text-gray-500 transition-transform group-open:rotate-90">▶</span>{label}
      </summary>
      <div className="border-t border-gray-200 px-3 py-2.5">{children}</div>
    </details>
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
    <LearningDisclosure tone="sources" icon="library" title={`View sources (${sources.length})`} className="mt-3" bodyClassName="py-3">
      {/* LEARN SECTIONS HFE: each cited source its own light card -- its tag and citation, then the passage in readable type. */}
      <ul className="space-y-2.5">
        {sources.map(s => (
          <SectionCard as="li" key={s.tag} className="p-3.5">
            <SourceLink tag={s.tag} href={sourceHref(s.materialId, s.chunkId)} citation={s.citation}
              note={s.aiRead && s.aiReadNote ? <InlineNote kind="ai" className="mt-1.5 text-[12.5px]">{s.aiReadNote}</InlineNote> : null}>
              {s.excerpt && <div className="mt-2 border-l-2 border-[var(--learn-accent)] pl-3"><NotesText text={`${s.excerpt}${s.excerpt.length >= 400 ? "…" : ""}`} className="text-[14px] leading-relaxed text-gray-800" /></div>}
            </SourceLink>
          </SectionCard>
        ))}
      </ul>
    </LearningDisclosure>
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
      {!!x.excludedCount && <p className="mt-1 text-[12px] text-gray-600">{x.excludedCount === 1 ? "1 source was found but excluded as not relevant to this lesson." : `${x.excludedCount} sources were found but excluded as not relevant to this lesson.`}</p>}
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
