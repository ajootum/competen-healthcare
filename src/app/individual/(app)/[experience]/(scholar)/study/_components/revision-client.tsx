"use client";

import Link from "next/link";
import { AiFeedback } from "./ai-feedback";
import { FormativeAiLabel } from "./edu-notice";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { LearningCallout, LearningIcon, LearningSectionHead, ProgressMark, learnAction, learnBox, type ProgressState } from "@/components/ui/scholar-learning";
import { sourceHref, studyHref } from "./question-view";
import {
  CALCULATION_LABEL, EXTENDED_LABEL, EXTENDED_RESPONSE_MAX, MARKED_AGAINST_NOTES, MOCK_LABEL, SCENARIO_LABEL, TRUE_FALSE_LABEL, REVISION_DIFFICULTIES, REVISION_FORMAT_LABEL, REVISION_MODE_HELP, REVISION_MODE_LABEL,
  type RevisionFormat, type RevisionMode,
} from "@/lib/individual/scholar/config";
import type { RevisionFeedback, RevisionItemView } from "@/lib/individual/scholar/revision-view";
import type { ScenarioStageView } from "@/lib/individual/scholar/scenario";
import { MakeEvaluation } from "./evaluation-client";
import { RecoveryFlow, type ExplainOutcome } from "./evidence-recovery";
import { RECOVERY_EXPLANATION_LABEL } from "@/lib/individual/scholar/config";
import { FEEDBACK_HEADINGS, GROUNDING_LABEL, UNSAFE_NOTE } from "@/lib/individual/scholar/config";
import type { FeedbackParts, SourceMode } from "@/lib/individual/scholar/question-intel";
import { carry, studyField } from "./study-active";
import { SpellingNote } from "./spelling-note";
import type { AnswerSpelling } from "@/lib/individual/scholar/spelling";
import { readSpellingChoice, spellingField } from "@/lib/individual/scholar/spelling-variant";
import { CLOZE_LABEL } from "@/lib/individual/scholar/cloze";
import { SourcePictureButton } from "./learn-visuals";
import type { RevisePrefill } from "@/lib/individual/scholar/study-carry";
import { askPrefill } from "@/lib/individual/scholar/ask-context";
import { AskAbout } from "./ask-panel";
import { DictateButton } from "@/app/individual/_components/speech/speech-buttons";
import { ROLE_LABEL, VARIANT_LABEL, isReasoningPart, roundingText, type Finding } from "@/lib/individual/scholar/scoring-rules";

// THE REVISION WORKSPACE -- COMPETEN-SCHOLAR-REVISION-01 R1 and R4 (owner GO 2026-10-24).
// Revise -> Answer -> Understand mistakes -> Reinforce -> Revisit -> Improve. Every answer goes to
// /api/individual/scholar/revision/answer and is shown as the route says: marked by code, by the student, or by AI
// evaluation, each labelled. A wrong answer offers Explain the answer, Show the source, Teach me this, Try another.
// Leaving for Teach Me keeps the session: Learn links back to it, and it resumes at the same question.
// One column below md (the CPR-MOB-001 single md edge); touch targets grow on coarse pointers.
// SCHOLAR-SQIE-CLOSE-01: a structured question is its parts, each with its own answer box and marks, marked part by part
// and totalled as practice marks (formative). A governed library question is labelled as such and cites the library.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
// Scholar learning design system (DS rollout, Revise): the actions read --learn-* from the tone of the section they sit in.
const btn = learnAction.primary;
const ghost = learnAction.secondary;
const whiteCard = "rounded-xl bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)]";
const smallCaps = "text-[12px] font-semibold uppercase tracking-wide text-gray-700";
const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

const revisionHref = (sessionId?: string | null) => `${studyHref("revise")}${sessionId ? `?session=${sessionId}` : ""}`;
const learnHref = (chunkId: string, sessionId: string | null, action?: string) =>
  `${studyHref("learn")}?section=${chunkId}${sessionId ? `&revision=${sessionId}` : ""}${action ? `&action=${action}` : ""}`;

// ── START: Today's Revision, the modes, and the student's own choice ──

export type ScopeOption = { kind: "library" } | { kind: "document"; materialId: string } | { kind: "topic"; topic: string } | { kind: "competency"; competencyId: string };

export function RevisionStart(props: {
  modes: RevisionMode[]; formats: RevisionFormat[]; quantity: number; difficulty: string; feedback: "immediate" | "end";
  materials: { id: string; title: string }[]; competencies: { id: string; title: string }[]; aiNote: string | null;
  /** PROGRESS-01 P4: a next step opens Revision on its material (and difficulty), with "choose" open. */
  preset?: { materialId?: string | null; difficulty?: string | null; /** SCHOLAR-INDEPENDENT-LEARNING-01 P1: only these sections of the material (a Learn lesson's), until the learner widens it. */ chunkIds?: readonly string[] | null } | null;
  /** SCHOLAR-SESSION-AI-02: the open study session's focus, chosen in "what to revise" (the learner may change it). */
  scope?: RevisePrefill | null;
}) {
  const router = useRouter();
  const presetMaterial = props.preset?.materialId && props.materials.some(m => m.id === props.preset!.materialId) ? props.preset.materialId : null;
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // Learning Continuity: new questions are not available, which is a state to explain, not an error.
  const [continuity, setContinuity] = useState("");
  const sc = presetMaterial ? null : props.scope ?? null;
  const [open, setOpen] = useState(!!presetMaterial || !!sc);
  // The lesson's own sections, when Revise was opened from a lesson's notes: the scope is those sections, not the whole material.
  const [onlySections, setOnlySections] = useState<string[]>(presetMaterial && props.preset?.chunkIds?.length ? [...props.preset.chunkIds] : []);
  const [scopeKind, setScopeKind] = useState<"library" | "documents" | "topic" | "competency">(presetMaterial ? "documents" : sc?.kind ?? "library");
  const [chosen, setChosen] = useState<string[]>(presetMaterial ? [presetMaterial] : sc?.kind === "documents" ? sc.materialIds : []);
  const [topic, setTopic] = useState(sc?.kind === "topic" ? sc.topic : "");
  const [competency, setCompetency] = useState(sc?.kind === "competency" ? sc.competencyId : "");
  const [formats, setFormats] = useState<RevisionFormat[]>(props.formats);
  const [quantity, setQuantity] = useState(props.quantity);
  const [difficulty, setDifficulty] = useState(props.preset?.difficulty && ["any", "easy", "standard", "harder"].includes(props.preset.difficulty) ? props.preset.difficulty : props.difficulty);
  const [feedback, setFeedback] = useState(props.feedback);
  const [source, setSource] = useState<SourceMode>("notes");
  const [mode, setMode] = useState<RevisionMode>(props.modes.includes("quick") ? "quick" : props.modes[0] ?? "today");
  const [unsaved, setUnsaved] = useState<{ items: RevisionItemView[]; label: string | null } | null>(null);

  const start = useCallback(async (m: RevisionMode, custom: boolean) => {
    setBusy(m); setError(""); setNote(""); setContinuity("");
    const scope = !custom || scopeKind === "library" ? { kind: "library" }
      : scopeKind === "documents" ? (onlySections.length && chosen.length === 1 && chosen[0] === presetMaterial ? { kind: "sources", materialIds: [], chunkIds: onlySections, topics: [] } : { kind: "documents", materialIds: chosen })
        : scopeKind === "topic" ? { kind: "topic", topic } : { kind: "competency", competencyId: competency };
    const r = await call("/api/individual/scholar/revision/sessions", { mode: m, scope, ...(custom ? { formats, quantity, difficulty, feedback, source } : {}), ...studyField() });
    setBusy("");
    if (!r.ok && r.json.continuity) { setContinuity(r.json.error ?? "New questions are not available right now."); return; }
    if (!r.ok) { setError(r.json.error ?? "Revision could not start just now."); return; }
    if (r.json.session?.id) router.push(carry(revisionHref(r.json.session.id)));
    // A session this environment could not keep (417 absent): run here, for this sitting only.
    else { setNote(r.json.note ?? ""); setUnsaved({ items: r.json.items ?? [], label: r.json.label ?? null }); }
  }, [router, scopeKind, chosen, topic, competency, formats, quantity, difficulty, feedback, source, onlySections, presetMaterial]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  if (unsaved) return <RevisionRunner session={null} items={unsaved.items} answered={[]} label={unsaved.label} />;
  return (
    <section aria-labelledby="start-h" className={`${learnBox("next")} p-4 sm:p-5`}>
      <LearningSectionHead icon="target" title="Revise" id="start-h" level={2} caps={false} />
      <p className="mt-2 max-w-[68ch] text-[13.5px] leading-relaxed text-gray-800">From your own notes. Formative practice: not an assessment and not evidence of competence.</p>
      {props.modes.includes("today") && (
        <button type="button" className={`${btn} mt-4 w-full sm:w-auto`} disabled={!!busy} onClick={() => start("today", false)}>
          {busy === "today" ? "Preparing your revision…" : "Start Today's Revision"}
        </button>
      )}
      {props.aiNote && <p className="mt-2 text-[13px] text-gray-800">{props.aiNote}</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.modes.filter(m => m !== "today" && m !== "custom").map(m => (
          <li key={m}>
            <button type="button" disabled={!!busy} onClick={() => start(m, false)}
              className={`w-full ${whiteCard} p-3 text-left hover:bg-[var(--learn-surface)] disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
              <span className="block text-[14px] font-semibold text-gray-900">{busy === m ? "Preparing…" : REVISION_MODE_LABEL[m]}</span>
              <span className="block text-[13px] text-gray-700">{REVISION_MODE_HELP[m]}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${ghost} mt-4`} aria-expanded={open} aria-controls="choose-revision" onClick={() => setOpen(o => !o)}>Choose what and how to revise</button>
      {open && (
        <form id="choose-revision" className={`mt-3 space-y-4 ${whiteCard} p-4`} onSubmit={e => { e.preventDefault(); void start(mode, true); }}>
          <fieldset>
            <legend className="text-[13px] font-semibold text-gray-800">Way of revising</legend>
            <select value={mode} onChange={e => setMode(e.target.value as RevisionMode)} className={`${field} mt-1`} aria-label="Way of revising">
              {props.modes.filter(m => m !== "custom").map(m => <option key={m} value={m}>{REVISION_MODE_LABEL[m]}</option>)}
            </select>
          </fieldset>
          <fieldset>
            <legend className="text-[13px] font-semibold text-gray-800">What to revise</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-[13.5px]">
              {(["library", "documents", "topic", "competency"] as const).filter(k => k !== "competency" || props.competencies.length).map(k => (
                <label key={k} className="inline-flex items-center gap-1.5 pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="radio" name="scope" checked={scopeKind === k} onChange={() => setScopeKind(k)} />
                  {k === "library" ? "All my notes" : k === "documents" ? "Chosen materials" : k === "topic" ? "A topic" : "A competency"}</label>
              ))}
            </div>
            {scopeKind === "documents" && onlySections.length > 0 && chosen.length === 1 && chosen[0] === presetMaterial && (
              <p className="mt-1 text-[12.5px] text-gray-700">Only the {onlySections.length} {onlySections.length === 1 ? "section" : "sections"} of the lesson you came from.{" "}
                <button type="button" onClick={() => setOnlySections([])} className={`font-semibold underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Use the whole material</button></p>
            )}
            {scopeKind === "documents" && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {props.materials.map(m => <li key={m.id}><label className="inline-flex items-center gap-1.5 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="checkbox" checked={chosen.includes(m.id)} onChange={() => setChosen(c => toggle(c, m.id))} />{m.title}</label></li>)}
              </ul>
            )}
            {scopeKind === "topic" && <input aria-label="Topic" maxLength={120} value={topic} onChange={e => setTopic(e.target.value)} placeholder="For example: oxygen therapy" className={`${field} mt-2 w-full`} />}
            {scopeKind === "competency" && (
              <select aria-label="Competency" value={competency} onChange={e => setCompetency(e.target.value)} className={`${field} mt-2 w-full`}>
                <option value="">Choose a competency</option>
                {props.competencies.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
          </fieldset>
          <fieldset>
            <legend className="text-[13px] font-semibold text-gray-800">Question formats</legend>
            <div className="mt-1 flex flex-wrap gap-3 text-[13.5px]">
              {props.formats.map(f => <label key={f} className="inline-flex items-center gap-1.5 pointer-coarse:min-h-[var(--cmp-touch-min)]"><input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats(x => toggle(x, f))} />{REVISION_FORMAT_LABEL[f]}</label>)}
            </div>
            {/* CE-05: structured and scenario questions are answered in steps, so they need feedback after each answer. */}
            {feedback === "end" && formats.some(f => f === "structured" || f === "scenario") && (
              <p className="mt-1 text-[12px] text-gray-600">Structured and scenario questions need feedback after each answer, so they are left out when feedback is at the end.</p>
            )}
          </fieldset>
          <div className="flex flex-wrap gap-4">
            <label className="text-[13px] font-semibold text-gray-800">How many
              <input type="number" min={1} max={50} value={quantity} onChange={e => setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} className={`${field} ml-2 w-20`} />
            </label>
            <label className="text-[13px] font-semibold text-gray-800">Difficulty
              <select value={difficulty} onChange={e => setDifficulty(e.target.value)} className={`${field} ml-2`}>
                {REVISION_DIFFICULTIES.map(d => <option key={d} value={d}>{d === "any" ? "Any" : d === "easy" ? "Easier" : d === "standard" ? "Standard" : "Harder"}</option>)}
              </select>
            </label>
            <label className="text-[13px] font-semibold text-gray-800">Feedback
              <select value={feedback} onChange={e => setFeedback(e.target.value as "immediate" | "end")} className={`${field} ml-2`} disabled={mode === "mock"}>
                <option value="immediate">After each answer</option><option value="end">At the end</option>
              </select>
            </label>
            {/* SCHOLAR-SQIE-01: where new questions come from. Approved references apply to the revision formats. */}
            <label className="text-[13px] font-semibold text-gray-800">New questions from
              <select value={source} onChange={e => setSource(e.target.value as SourceMode)} className={`${field} ml-2`}>
                <option value="notes">{GROUNDING_LABEL.notes.replace(/^From y/, "Y")}</option>
                <option value="notes_and_references">{GROUNDING_LABEL.references.replace(/^From y/, "Y")}</option>
              </select>
            </label>
          </div>
          <button type="submit" className={btn} disabled={!!busy || !formats.length || (scopeKind === "documents" && !chosen.length) || (scopeKind === "topic" && topic.trim().length < 2) || (scopeKind === "competency" && !competency)}>
            {busy ? "Preparing…" : "Start revising"}
          </button>
        </form>
      )}
      {note && <p role="status" className="mt-3 text-[13px] text-gray-700">{note}</p>}
      {continuity && (
        <div role="status" className="mt-3"><LearningCallout tone="aiBeyond" icon="robot" label="No new questions right now"><p>{continuity}</p></LearningCallout></div>
      )}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </section>
  );
}

// ── SAVED REVISION SETS: replayed from stored questions, no AI ──

export function SavedSets({ sets }: { sets: { id: string; title: string; questions: number; lastUsedAt: string | null }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function replay(id: string) {
    setBusy(id); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { mode: "custom", setId: id, ...studyField() });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "That set could not be started."); return; }
    if (r.json.session?.id) router.push(carry(revisionHref(r.json.session.id)));
  }
  async function remove(id: string) {
    setBusy(`d${id}`); setError("");
    const r = await call(`/api/individual/scholar/revision/sets/${id}`, undefined, "DELETE");
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "That set could not be removed."); return; }
    router.refresh();
  }
  return (
    <>
      <ul className="mt-2 space-y-2">
        {sets.map(s => (
          <li key={s.id} className={`flex flex-wrap items-center justify-between gap-2 ${whiteCard} px-3 py-2`}>
            <span className="min-w-0 flex-1 text-[14px]"><span className="font-semibold text-gray-900">{s.title}</span>
              <span className="text-[13px] text-gray-700"> · {s.questions} question{s.questions === 1 ? "" : "s"}{s.lastUsedAt ? ` · last ${new Date(s.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span></span>
            <span className="flex gap-2">
              <button type="button" className={ghost} disabled={!!busy} onClick={() => replay(s.id)}>{busy === s.id ? "Starting…" : "Revise again"}</button>
              <button type="button" className={ghost} disabled={!!busy} onClick={() => remove(s.id)} aria-label={`Remove ${s.title}`}>{busy === `d${s.id}` ? "Removing…" : "Remove"}</button>
            </span>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
    </>
  );
}

// ── ONE SESSION: answer, understand, reinforce, return ──

type SessionState = { id: string | null; mode: string; feedback: "immediate" | "end"; status?: string; total: number; position: number };
/** 425, owner decision R4: a short answer held until the end, then graded by the student against its notes. */
export type HeldGrade = { response: string; accepted: string[]; rationale: string; source: RevisionFeedback["source"]; label: string };
export type Answered = { questionId: string; feedback?: RevisionFeedback; held?: boolean; selfGrade?: HeldGrade };
type Summary = { answered: number; of: number; correct: number; toGrade?: number; byMarking: Record<string, number> };
/** SCHOLAR-SQIE-CLOSE-01: a structured part the student marks themselves, with what code or the AI already said of it. */
type PartToGrade = { prompt: string; marks: number; accepted: string[]; byCode: boolean; ai: { awarded: number; feedback: string | null; label: string } | null };

export function RevisionRunner(props: { session: SessionState | null; items: RevisionItemView[]; answered: Answered[]; label?: string | null;
  /** EVALUATION-01: this sitting is the knowledge check of an evaluation, made from it when it ends. */
  evaluation?: { method: "fresh" | "combined"; scope: Record<string, unknown> } | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ session: SessionState | null; items: RevisionItemView[]; answered: Answered[] } | null>({ session: props.session, items: props.items, answered: props.answered });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [setTitle, setSetTitle] = useState("");
  const [saved, setSaved] = useState("");
  const answeredIds = useMemo(() => new Set(state?.answered.map(a => a.questionId) ?? []), [state]);
  const [at, setAt] = useState(() => Math.max(0, (props.items ?? []).findIndex(i => !props.answered.some(a => a.questionId === i.id))));
  if (!state) return <p className="text-[14px] text-gray-600">This session is not available. <Link href={revisionHref()} className={`underline ${focusRing}`}>Start another</Link>.</p>;
  const items = state.items;
  const done = items.length > 0 && items.every(i => answeredIds.has(i.id));
  const item = items[Math.min(at, items.length - 1)];
  const sid = state.session?.id ?? null;
  const record = (a: Answered) => setState(s => (s ? { ...s, answered: [...s.answered.filter(x => x.questionId !== a.questionId), a] } : s));
  // A held answer graded at the end: it becomes a self-graded answer, and the summary counts it.
  const graded = (a: Answered) => {
    record(a);
    setSummary(m => (m ? { ...m, answered: m.answered + 1, correct: m.correct + (a.feedback?.correct ? 1 : 0), toGrade: Math.max(0, (m.toGrade ?? 1) - 1),
      byMarking: { ...m.byMarking, self_graded: (m.byMarking.self_graded ?? 0) + 1 } } : m));
  };

  async function finish() {
    if (!sid) { setSummary({ answered: state!.answered.length, of: items.length, correct: state!.answered.filter(a => a.feedback?.correct).length, byMarking: {} }); return; }
    const r = await call(`/api/individual/scholar/revision/sessions/${sid}`, { complete: true }, "PATCH");
    if (r.ok) { setState(s => (s ? { ...s, answered: r.json.answered ?? s.answered, session: { ...s.session!, status: "completed" } } : s)); setSummary(r.json.summary); }
  }
  async function saveSet(e: React.FormEvent) {
    e.preventDefault();
    const r = await call("/api/individual/scholar/revision/sets", { sessionId: sid, title: setTitle });
    setSaved(r.ok ? "Saved. Find it under Saved revision sets: replaying it uses no AI." : r.json.error ?? "The set could not be saved.");
    if (r.ok) router.refresh();
  }

  return (
    <section aria-labelledby="run-h" className={`${learnBox("check")} p-4 sm:p-5`}>
      <div className="flex flex-wrap items-center gap-3">
        <LearningSectionHead icon="question" title={REVISION_MODE_LABEL[state.session?.mode as RevisionMode] ?? "Revision"} id="run-h" level={2} caps={false} className="min-w-[10rem] flex-1" />
        <p className="text-[13px] font-semibold text-gray-800 tabular-nums">{answeredIds.size} of {items.length} answered</p>
        <div className="h-1.5 min-w-[120px] flex-1 rounded-full bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)]" aria-hidden><div className="h-1.5 rounded-full bg-[var(--learn-accent)]" style={{ width: `${(answeredIds.size / Math.max(1, items.length)) * 100}%` }} /></div>
        <Link href={revisionHref()} className={learnAction.link}>Leave (it is kept)</Link>
      </div>
      {(props.label || state.session?.mode === "mock") && <p className={`mt-2 ${whiteCard} px-3 py-1.5 text-[13px] text-gray-800`}>{props.label ?? MOCK_LABEL}</p>}
      {!sid && <p className="mt-2 text-[13px] text-gray-800">This session is not kept, so it cannot be resumed later.</p>}

      {summary ? (
        <div className="mt-4 space-y-4">
          <p className="text-[15px] font-semibold text-gray-900">Session finished: {summary.correct} of {summary.of} matched your notes.</p>
          {(summary.toGrade ?? 0) > 0 && <p className="text-[13px] text-gray-700">{summary.toGrade} short answer{summary.toGrade === 1 ? "" : "s"} could not be marked automatically. Compare {summary.toGrade === 1 ? "it" : "each"} with your notes below and mark it yourself.</p>}
          {Object.keys(summary.byMarking).length > 0 && (
            <p className="text-[13px] text-gray-800">Marked by code: {summary.byMarking.deterministic ?? 0} · by you: {summary.byMarking.self_graded ?? 0} · by AI evaluation: {summary.byMarking.ai_evaluation ?? 0}</p>
          )}
          <ol className="space-y-3">
            {items.map((i, n) => { const a = state.answered.find(x => x.questionId === i.id); return (
              <li key={i.id} className={`${whiteCard} p-3`}>
                <p className="text-[14px] font-semibold text-gray-900">{n + 1}. {i.stem}</p>
                {a?.feedback ? <FeedbackPanel f={a.feedback} sessionId={sid} compact questionId={i.id} stem={i.stem} />
                  : a?.selfGrade && sid ? <GradeAtEnd questionId={i.id} sessionId={sid} g={a.selfGrade} onGraded={graded} />
                    : <p className="text-[13px] text-gray-700">Not answered.</p>}
              </li>
            ); })}
          </ol>
          {sid && props.evaluation && <MakeEvaluation sessionId={sid} method={props.evaluation.method} scope={props.evaluation.scope} toGrade={summary.toGrade ?? 0} />}
          {sid && (
            <form onSubmit={saveSet} className="flex flex-wrap items-end gap-2">
              <label className="text-[13px] font-semibold text-gray-800">Save these questions as a set
                <input value={setTitle} onChange={e => setSetTitle(e.target.value)} maxLength={120} placeholder="For example: Respiratory, week 3" className={`${field} mt-1 block w-64 max-w-full`} />
              </label>
              <button type="submit" className={ghost} disabled={!setTitle.trim()}>Save set</button>
              {saved && <p role="status" className="w-full text-[13px] text-gray-700">{saved}</p>}
            </form>
          )}
          <Link href={revisionHref()} className={ghost}>Back to Revision</Link>
        </div>
      ) : item ? (
        <>
          <nav aria-label="Questions" className="mt-3 flex flex-wrap gap-1.5">
            {items.map((i, n) => (
              <button key={i.id} type="button" onClick={() => setAt(n)} aria-current={n === at ? "step" : undefined} aria-label={`Question ${n + 1}${answeredIds.has(i.id) ? ", answered" : ""}`}
                className={`inline-flex h-8 min-w-8 items-center justify-center gap-0.5 rounded-lg border bg-[var(--cmp-app-surface)] px-2 text-[12.5px] font-semibold tabular-nums pointer-coarse:min-h-[var(--cmp-touch-min)] pointer-coarse:min-w-[var(--cmp-touch-min)] ${focusRing} ${n === at ? "border-2 border-[var(--learn-accent)]" : "border-[var(--learn-border)]"} text-gray-900`}>{answeredIds.has(i.id) && <span className="cmp-learn-accent"><LearningIcon name="check" className="h-3 w-3" /></span>}{n + 1}</button>
            ))}
          </nav>
          <QuestionRunner key={item.id} item={item} sessionId={sid} feedbackMode={state.session?.feedback ?? "immediate"}
            answered={state.answered.find(a => a.questionId === item.id) ?? null} onAnswered={record}
            onNext={() => setAt(n => { const next = items.findIndex((i, k) => k > n && !answeredIds.has(i.id) && i.id !== item.id); return next >= 0 ? next : Math.min(items.length - 1, n + 1); })} />
          {done && <button type="button" className={`${btn} mt-4`} onClick={finish}>Finish and see how it went</button>}
        </>
      ) : <p className="mt-3 text-[14px] text-gray-600">No questions in this session.</p>}
    </section>
  );
}

export function QuestionRunner({ item, sessionId, feedbackMode, answered, onAnswered, onNext }: {
  item: RevisionItemView; sessionId: string | null; feedbackMode: "immediate" | "end"; answered: Answered | null;
  onAnswered: (a: Answered) => void; onNext: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [choice, setChoice] = useState<number | null>(null);
  const [set, setSet] = useState<number[]>([]);
  const [text, setText] = useState("");
  const [matches, setMatches] = useState<string[]>(item.options.map(() => ""));
  const [order, setOrder] = useState<number[]>(item.options.map((_, i) => i));
  const [back, setBack] = useState<{ back: string; source: { quote: string; citation: string; materialId: string; chunkId: string }; card?: { origin: "notes" | "library" | "learner"; originLabel: string } } | null>(null);
  const [selfGrade, setSelfGrade] = useState<{ accepted: string[]; reason: string; label: string; extended?: { modelAnswer: string; keyPoints: string[]; marks: number }; spelling?: AnswerSpelling | null } | null>(null);
  // SCHOLAR-SQIE-CLOSE-01: a structured question's answers, one per part, and the student's own marking of each part.
  const [texts, setTexts] = useState<string[]>((item.parts ?? []).map(() => ""));
  // SQIE-CLOSE-2026-11 WS-A: a calculation's number as typed, and the unit chosen (preselected only when there is just one).
  const [calcValue, setCalcValue] = useState("");
  const [calcUnit, setCalcUnit] = useState(item.calculation?.units.length === 1 ? item.calculation.units[0] : "");
  const [partGrade, setPartGrade] = useState<{ reason: string; label: string; parts: PartToGrade[] } | null>(null);
  const [grades, setGrades] = useState<(boolean | null)[]>([]);
  // SCHOLAR-SQIE-02: a withheld AI evaluation opens evidence recovery beneath the student's answer, which is kept as typed.
  const [recovery, setRecovery] = useState<{ key: number; withheldReason: string | null } | null>(null);
  const [recovered, setRecovered] = useState(false);
  // CE-05: an evolving scenario. The server sends one stage at a time: this holds the stage on screen, the stages already answered (the
  // learner's own words, nothing of the key) and the token the next reply needs. The key and later stages never reach the browser early.
  type ScenarioRun = { token: string | null; stage: ScenarioStageView | null; done: { reveal: string; prompt: string; answer: string }[]; needSelf: { accepted: string[]; reason: string; label: string } | null };
  const [sc, setSc] = useState<ScenarioRun>(() => ({ token: null, stage: item.scenario?.stage ?? null, done: [], needSelf: null }));

  async function sendStage(selfGrade?: boolean) {
    const st = sc.stage;
    if (!st) return;
    const response = st.kind === "mcq" ? { index: choice } : st.kind === "mrq" ? { indexes: set } : { text };
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/scenario", { questionId: item.id, sessionId, token: sc.token, response, ...(selfGrade === undefined ? {} : { selfGrade }) });
    setBusy(false);
    if (r.json.needsSelfGrade) { setSc(s => ({ ...s, needSelf: { accepted: r.json.accepted ?? [], reason: r.json.reason ?? "", label: r.json.label ?? "" } })); return; }
    if (r.json.restart) {
      setSc({ token: null, stage: item.scenario?.stage ?? null, done: [], needSelf: null }); setChoice(null); setSet([]); setText("");
      setError(r.json.error ?? "This scenario timed out. Start again from the first stage."); return;
    }
    if (!r.ok) { setError(r.json.error ?? "Your answer could not be saved."); return; }
    if (r.json.feedback) { onAnswered({ questionId: item.id, feedback: r.json.feedback }); return; }
    const said = st.kind === "mcq" ? st.options[choice ?? 0] : st.kind === "mrq" ? set.map(i => st.options[i]).join("; ") : text;
    setSc(s => ({ token: r.json.token ?? null, stage: r.json.next ?? null, done: [...s.done, { reveal: st.reveal, prompt: st.prompt, answer: said }], needSelf: null }));
    setChoice(null); setSet([]); setText("");
  }
  const stageReady = !sc.stage ? false : sc.stage.kind === "mcq" ? choice !== null : sc.stage.kind === "mrq" ? set.length > 0 : text.trim().length > 0;

  async function send(response: unknown, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId: item.id, sessionId, response, ...spellingField(readSpellingChoice()), ...extra });
    setBusy(false);
    if (r.json.needsSelfGrade && item.kind === "structured") {
      const parts = (r.json.parts ?? []) as PartToGrade[];
      setPartGrade({ reason: r.json.reason ?? "", label: r.json.label ?? "", parts });
      setGrades(parts.map(x => (x.byCode ? null : x.ai ? x.ai.awarded > 0 : null)));
      return;
    }
    if (r.json.needsSelfGrade) {
      setSelfGrade({ accepted: r.json.accepted ?? [], reason: r.json.reason ?? "", label: r.json.label ?? "", extended: r.json.extended, spelling: r.json.spelling ?? null });
      if (r.json.withheld && (item.kind === "short" || item.kind === "extended")) setRecovery(x => ({ key: (x?.key ?? 0) + 1, withheldReason: r.json.withheld?.reason ?? null }));
      return;
    }
    if (!r.ok) { setError(r.json.error ?? "Your answer could not be saved."); return; }
    onAnswered({ questionId: item.id, feedback: r.json.feedback });
  }
  /** "Explain using approved references": the SAME evaluation of the same answer, with only the recovery's id, mode and question. */
  async function explainFromRecovery(rec: { id: string; mode: "notes_only" | "notes_and_library" | "notes_and_references"; question: string }): Promise<ExplainOutcome> {
    const r = await call("/api/individual/scholar/revision/answer", { questionId: item.id, sessionId, response: { text }, recovery: rec, ...spellingField(readSpellingChoice()) });
    if (r.json.needsSelfGrade) {
      setSelfGrade({ accepted: r.json.accepted ?? [], reason: r.json.reason ?? "", label: r.json.label ?? "", extended: r.json.extended, spelling: r.json.spelling ?? null });
      const rec = r.json.recovered ?? r.json.withheld?.recovered;
      return { shown: false, message: r.json.reason ?? null, unanswered: rec?.unanswered, reading: rec?.reading };
    }
    if (!r.ok) return { error: r.json.error ?? "Your answer could not be checked just now." };
    setRecovered(!!r.json.recovered?.shown);
    onAnswered({ questionId: item.id, feedback: r.json.feedback });
    return { shown: true };
  }
  async function reveal() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId: item.id, sessionId, reveal: true });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The answer could not be shown."); return; }
    setBack(r.json as typeof back);
  }
  const responseOf = (): unknown => item.kind === "mcq" || item.kind === "case" ? { index: choice } : item.kind === "mrq" ? { indexes: set }
    : item.kind === "short" || item.kind === "cloze" || item.kind === "extended" ? { text } : item.kind === "match" ? { matches } : item.kind === "sequence" ? { order } : item.kind === "structured" ? { texts }
    : item.kind === "calculation" ? { value: calcValue, unit: item.calculation?.unitless ? "" : calcUnit } : null;
  const ready = item.kind === "mcq" || item.kind === "case" ? choice !== null : item.kind === "mrq" ? set.length > 0 : item.kind === "short" || item.kind === "cloze" || item.kind === "extended" ? text.trim().length > 0
    : item.kind === "match" ? matches.every(Boolean) : item.kind === "sequence" ? true : item.kind === "structured" ? texts.some(t => t.trim())
    : item.kind === "calculation" ? !!calcValue.trim() && (!!item.calculation?.unitless || !!calcUnit) : false;
  const partLetter = (i: number) => String.fromCharCode(97 + i);
  const letter = (i: number) => String.fromCharCode(65 + i);
  const fb = answered?.feedback ?? null;

  return (
    <article className={`cmp-learn-check mt-4 ${whiteCard} p-4`}>
      <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-700">
        {REVISION_FORMAT_LABEL[item.kind as RevisionFormat] ?? "Practice case step"}{item.difficulty ? ` · ${item.difficulty === 1 ? "easier" : item.difficulty === 3 ? "harder" : "standard"}` : ""}
        {/* SCHOLAR-SQIE-01: what the question rests on. */}
        <span className="ml-2 inline-block rounded-full border border-[var(--learn-border)] bg-[var(--learn-surface)] px-2 py-0.5 normal-case tracking-normal text-gray-800">{item.grounding ?? GROUNDING_LABEL.notes}</span>
      </p>
      <p className="mt-1 text-[16px] font-semibold leading-relaxed text-gray-900">{item.stem}</p>
      {answered ? (
        fb ? <>{recovered && <p className="mt-3 inline-flex rounded-full border border-gray-300 bg-white px-2.5 py-0.5 text-[12px] font-semibold text-gray-900">{RECOVERY_EXPLANATION_LABEL}</p>}<FeedbackPanel f={fb} sessionId={sessionId} questionId={item.id} stem={item.stem} /></> : <p className="mt-3 rounded-lg bg-[var(--learn-surface)] px-3 py-2 text-[13.5px] text-gray-800">Answer recorded. You will see how it went at the end of the session.</p>
      ) : item.kind === "scenario" ? (
        !sc.stage ? <p className="mt-3 text-[13.5px] text-gray-700">This scenario cannot be shown just now.</p> : (
          <div className="mt-3">
            {sc.done.length > 0 && (
              <ol className="mb-3 space-y-2" aria-label="Stages you have answered">
                {sc.done.map((d, i) => (
                  <li key={i} className="rounded-lg bg-[var(--learn-surface)] px-3 py-2 text-[13px] text-gray-800">
                    {d.reveal && <p>{d.reveal}</p>}
                    <p className="font-semibold">Stage {i + 1}: {d.prompt}</p>
                    <p className="text-gray-700">Your answer: {d.answer}</p>
                  </li>
                ))}
              </ol>
            )}
            {sc.needSelf ? (
              <div className="rounded-xl bg-[var(--learn-surface)] p-4">
                <p className="text-[13.5px] text-gray-800">{sc.needSelf.reason}</p>
                <p className={`mt-2 ${smallCaps}`}>The answers your notes support</p>
                <ul className="mt-1 list-disc pl-5 text-[14px] text-gray-900">{sc.needSelf.accepted.map(a => <li key={a}>{a}</li>)}</ul>
                <p className="mt-2 whitespace-pre-wrap text-[13px] text-gray-700">Your answer: <span className="font-semibold">{text}</span></p>
                <p className="mt-1 text-[12.5px] text-gray-700">{sc.needSelf.label}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className={ghost} disabled={busy} onClick={() => void sendStage(true)}>It says the same</button>
                  <button type="button" className={ghost} disabled={busy} onClick={() => void sendStage(false)}>It does not</button>
                </div>
              </div>
            ) : (
              <form onSubmit={e => { e.preventDefault(); if (stageReady) void sendStage(); }}>
                <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-gray-700">
                  Stage {sc.stage.index + 1} of {item.scenario?.count ?? "?"} · {sc.stage.weight} mark{sc.stage.weight === 1 ? "" : "s"}
                </p>
                {sc.stage.reveal && (
                  <p className="mt-1 rounded-lg border-l-4 border-[var(--learn-accent)] bg-[var(--learn-surface)] px-3 py-2 text-[14px] text-gray-900"><span className="font-semibold">New information:</span> {sc.stage.reveal}</p>
                )}
                <p className="mt-2 text-[15px] font-semibold text-gray-900">{sc.stage.prompt}</p>
                {(sc.stage.kind === "mcq" || sc.stage.kind === "mrq") && (
                  <fieldset className="mt-2">
                    <legend className="sr-only">{sc.stage.kind === "mrq" ? "Choose all that apply" : "Choose one"}</legend>
                    {sc.stage.kind === "mrq" && <p className="mb-2 text-[12.5px] text-gray-600">Choose all that apply.</p>}
                    <div className="grid gap-2 lg:grid-cols-2">
                      {sc.stage.options.map((o, i) => (
                        <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${(sc.stage!.kind === "mrq" ? set.includes(i) : choice === i) ? "border-[var(--learn-accent)] bg-[var(--learn-surface)] ring-1 ring-[var(--learn-accent)]" : "border-[var(--learn-border)] hover:bg-[var(--learn-surface)]"}`}>
                          {sc.stage!.kind === "mrq"
                            ? <input type="checkbox" checked={set.includes(i)} onChange={() => setSet(s => (s.includes(i) ? s.filter(x => x !== i) : [...s, i]))} className="mt-1 h-4 w-4 shrink-0" />
                            : <input type="radio" name={`sc-${item.id}-${sc.stage!.index}`} checked={choice === i} onChange={() => setChoice(i)} className="mt-1 h-4 w-4 shrink-0" />}
                          <span><span className="font-semibold">{letter(i)}.</span> {o}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                )}
                {sc.stage.kind === "cloze" && (
                  <label className="mt-2 block text-[13px] font-semibold text-gray-800">The missing word or term (the blank is _____)
                    <input type="text" value={text} onChange={e => setText(e.target.value)} maxLength={200} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done" className={`${field} mt-1 block w-full`} />
                  </label>
                )}
                {sc.stage.kind === "short" && (
                  <label className="mt-2 block text-[13px] font-semibold text-gray-800">Your answer
                    <textarea rows={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} className={`${field} mt-1 block w-full font-normal`} />
                  </label>
                )}
                <div className="mt-3">
                  <button type="submit" className={btn} disabled={!stageReady || busy}>
                    {busy ? "Checking…" : sc.stage.index + 1 === (item.scenario?.count ?? 0) ? "Check answer and finish" : "Check answer and see what happens next"}
                  </button>
                </div>
              </form>
            )}
          </div>
        )
      ) : item.kind === "flashcard" ? (
        !back ? <button type="button" className={`${btn} mt-4`} disabled={busy} onClick={reveal}>Show the answer</button> : (
          <div className="mt-4">
            <div className="rounded-xl bg-[var(--learn-surface)] p-4">
              {/* SCHOLAR-FLASHCARDS-01: a card the student wrote, or a library card, says so -- never "your notes". */}
              <p className={smallCaps}>{back.card?.origin === "learner" ? "Your card" : back.card?.origin === "library" ? "The Competen library" : "What your notes say"}</p>
              <p className="mt-1 text-[14.5px] font-bold text-gray-900">{back.back}</p>
              {back.card && back.card.origin !== "notes" ? <p className="mt-1 text-[12.5px] text-gray-600">{back.card.originLabel}</p>
                : <p className="mt-1 text-[12.5px] text-gray-600">From your notes: <Link href={sourceHref(back.source.materialId, back.source.chunkId)} className={`underline ${focusRing}`}>{back.source.citation}</Link></p>}
            </div>
            <fieldset className="mt-3" disabled={busy}>
              <legend className="text-[14px] font-semibold text-gray-900">How well did you remember it? (your own judgement)</legend>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[{ q: 0, l: "Blank" }, { q: 2, l: "Hard" }, { q: 3, l: "Okay" }, { q: 4, l: "Good" }, { q: 5, l: "Easy" }].map(g => (
                  <button key={g.q} type="button" className={ghost} onClick={() => send({ quality: g.q })}>{g.l}</button>
                ))}
              </div>
            </fieldset>
          </div>
        )
      ) : partGrade ? (
        <div className="mt-4 rounded-xl bg-[var(--learn-surface)] p-4">
          <p className="text-[13.5px] text-gray-800">{partGrade.reason}</p>
          <ol className="mt-3 space-y-3">
            {partGrade.parts.map((pt, i) => (
              <li key={i} className={`${whiteCard} p-3`}>
                <p className="text-[13.5px] font-semibold text-gray-900">({partLetter(i)}) {pt.prompt} <span className="font-normal text-gray-600">· {pt.marks} mark{pt.marks === 1 ? "" : "s"}</span></p>
                <p className="mt-1 text-[13px] text-gray-700">Your answer: <span className="font-semibold">{texts[i] || "(left blank)"}</span></p>
                <p className="mt-1 text-[13px] text-gray-800"><span className="font-semibold">{item.library ? "The library answer" : "Your notes"}:</span> {pt.accepted.join("; ")}</p>
                {pt.ai?.feedback && <p className="mt-1 rounded border border-dashed border-amber-400 bg-amber-50 px-2 py-1 text-[12.5px] text-amber-950"><span className="font-semibold">{pt.ai.label}</span> {pt.ai.feedback}</p>}
                {pt.byCode ? <p className="mt-1 text-[12px] text-gray-600">Marked against the stored answer.</p> : (
                  <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`Your judgement of part ${partLetter(i)}`}>
                    <button type="button" aria-pressed={grades[i] === true} className={`${ghost} ${grades[i] === true ? "!border-2 !border-[var(--learn-accent)]" : ""}`} disabled={busy} onClick={() => setGrades(g => g.map((x, k) => (k === i ? true : x)))}>It says the same</button>
                    <button type="button" aria-pressed={grades[i] === false} className={`${ghost} ${grades[i] === false ? "!border-2 !border-[var(--learn-accent)]" : ""}`} disabled={busy} onClick={() => setGrades(g => g.map((x, k) => (k === i ? false : x)))}>It does not</button>
                  </div>
                )}
              </li>
            ))}
          </ol>
          <p className="mt-2 text-[12.5px] text-gray-700">{partGrade.label}</p>
          <button type="button" className={`${btn} mt-3`} disabled={busy || partGrade.parts.some((pt, i) => !pt.byCode && grades[i] === null)}
            onClick={() => send({ texts }, { selfGrades: partGrade.parts.map((pt, i) => (pt.byCode ? null : grades[i])) })}>{busy ? "Saving…" : "Save my marking"}</button>
        </div>
      ) : selfGrade ? (
        <div className="mt-4 rounded-xl bg-[var(--learn-surface)] p-4">
          <p className="text-[13.5px] text-gray-800">{selfGrade.reason}</p>
          {selfGrade.extended ? (
            <>
              {/* SCHOLAR-SQIE-LEARNER-01: an extended answer the AI could not mark: the student compares it with the key points and the model answer. */}
              <p className={`mt-2 ${smallCaps}`}>The points a full answer makes</p>
              <ul className="mt-1 list-disc pl-5 text-[14px] text-gray-900">{selfGrade.extended.keyPoints.map(k => <li key={k}>{k}</li>)}</ul>
              <p className={`mt-2 ${smallCaps}`}>The model answer from your notes</p>
              <p className="mt-1 text-[14px] text-gray-900">{selfGrade.extended.modelAnswer}</p>
            </>
          ) : (
            <>
              <p className={`mt-2 ${smallCaps}`}>The answers your notes support</p>
              <ul className="mt-1 list-disc pl-5 text-[14px] text-gray-900">{selfGrade.accepted.map(a => <li key={a}>{a}</li>)}</ul>
            </>
          )}
          <p className="mt-2 whitespace-pre-wrap text-[13px] text-gray-700">Your answer: <span className="font-semibold">{text}</span></p>
          <SpellingNote spelling={selfGrade.spelling} />
          <p className="mt-1 text-[12.5px] text-gray-700">{selfGrade.label}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={ghost} disabled={busy} onClick={() => send({ text }, { selfGrade: true })}>{selfGrade.extended ? "It makes these points" : "It says the same"}</button>
            <button type="button" className={ghost} disabled={busy} onClick={() => send({ text }, { selfGrade: false })}>It does not</button>
          </div>
          {recovery && (
            <RecoveryFlow key={recovery.key} onDismiss={() => setRecovery(null)} explain={explainFromRecovery}
              request={{ question: item.stem.slice(0, 600), mode: "notes_only", materialId: item.materialId, sectionId: item.chunkId, withheldReason: recovery.withheldReason }} />
          )}
        </div>
      ) : (
        <form className="mt-3" onSubmit={e => { e.preventDefault(); if (ready) void send(responseOf()); }}>
          {(item.kind === "mcq" || item.kind === "case" || item.kind === "mrq") && (
            <fieldset>
              <legend className="sr-only">{item.kind === "mrq" ? "Choose all that apply" : "Choose one"}</legend>
              {item.kind === "mrq" && <p className="mb-2 text-[12.5px] text-gray-600">Choose all that apply.</p>}
              <div className="grid gap-2 lg:grid-cols-2">
                {item.options.map((o, i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${(item.kind === "mrq" ? set.includes(i) : choice === i) ? "border-[var(--learn-accent)] bg-[var(--learn-surface)] ring-1 ring-[var(--learn-accent)]" : "border-[var(--learn-border)] hover:bg-[var(--learn-surface)]"}`}>
                    {item.kind === "mrq"
                      ? <input type="checkbox" checked={set.includes(i)} onChange={() => setSet(s => (s.includes(i) ? s.filter(x => x !== i) : [...s, i]))} className="mt-1 h-4 w-4 shrink-0" />
                      : <input type="radio" name={`r-${item.id}`} checked={choice === i} onChange={() => setChoice(i)} className="mt-1 h-4 w-4 shrink-0" />}
                    <span><span className="font-semibold">{letter(i)}.</span> {o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {item.kind === "structured" && item.structured?.variant && <p className="mb-2 text-[12.5px] font-semibold text-gray-700">{VARIANT_LABEL[item.structured.variant]}</p>}
          {/* SQIE-CLOSE-2026-11 WS-C: an interpretation item shows its findings first; the parts ask what they mean. */}
          {item.kind === "structured" && !!item.structured?.findings.length && <FindingsTable findings={item.structured.findings} />}
          {item.kind === "structured" && (
            <ol className="space-y-3">
              {(item.parts ?? []).map((pt, i) => (
                <li key={i}>
                  {pt.options ? (
                    // WS-C: a choice part (answer + justify): one option, marked by code; the next part asks why.
                    <fieldset>
                      <legend className="text-[13.5px] font-semibold text-gray-900">({partLetter(i)}) {pt.prompt} <span className="font-normal text-gray-600">· {pt.marks} mark{pt.marks === 1 ? "" : "s"}</span></legend>
                      <div className="mt-1 grid gap-2 lg:grid-cols-2">
                        {pt.options.map((o, k) => (
                          <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-2.5 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${texts[i] === o ? "border-[var(--learn-accent)] bg-[var(--learn-surface)] ring-1 ring-[var(--learn-accent)]" : "border-[var(--learn-border)] hover:bg-[var(--learn-surface)]"}`}>
                            <input type="radio" name={`rv-part-${item.id}-${i}`} checked={texts[i] === o} onChange={() => setTexts(t => t.map((x, j) => (j === i ? o : x)))} className="mt-1 h-4 w-4 shrink-0" />
                            <span><span className="font-semibold">{letter(k)}.</span> {o}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <>
                      <label className="block text-[13.5px] font-semibold text-gray-900">({partLetter(i)}) {pt.role ? <span className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-gray-700">{ROLE_LABEL[pt.role]}</span> : null}{pt.prompt} <span className="font-normal text-gray-600">· {pt.marks} mark{pt.marks === 1 ? "" : "s"}</span>
                        <textarea id={`rv-part-${item.id}-${i}`} rows={isReasoningPart(pt.role) ? 3 : 2} maxLength={1000} value={texts[i] ?? ""} onChange={e => setTexts(t => t.map((x, k) => (k === i ? e.target.value : x)))} className={`${field} mt-1 block w-full font-normal`} />
                      </label>
                      <DictateButton fieldId={`rv-part-${item.id}-${i}`} onValue={v => setTexts(t => t.map((x, k) => (k === i ? v : x)))} disabled={busy} className="mt-1" />
                    </>
                  )}
                </li>
              ))}
            </ol>
          )}
          {item.kind === "cloze" && (
            // SCHOLAR-COMPANION-01 P1: one blank, one term. Enter checks; "Show the answer" records a miss, honestly.
            <label className="block text-[13px] font-semibold text-gray-800">The missing word or term (the blank is _____)
              <input type="text" value={text} onChange={e => setText(e.target.value)} maxLength={200} autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} enterKeyHint="done"
                className={`${field} mt-1 block w-full`} />
            </label>
          )}
          {item.kind === "true_false" && (
            // SCHOLAR-SQIE-LEARNER-01: two large buttons are the whole answer; marked by code.
            <fieldset disabled={busy}>
              <legend className="sr-only">True or false</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["true", "false"] as const).map(v => (
                  <button key={v} type="button" className={`${ghost} !min-h-[56px] !text-[16px]`} onClick={() => void send({ text: v })}>{v === "true" ? "True" : "False"}</button>
                ))}
              </div>
            </fieldset>
          )}
          {item.kind === "extended" && (
            // SCHOLAR-SQIE-LEARNER-01: a paragraph answer, marked by AI against the item's key points (formative).
            <div>
              <label className="block text-[13px] font-semibold text-gray-800">Your answer
                <textarea id={`rv-ext-${item.id}`} rows={8} maxLength={EXTENDED_RESPONSE_MAX} value={text} onChange={e => setText(e.target.value)} className={`${field} mt-1 block w-full font-normal`} aria-describedby={`ext-${item.id}`} />
              </label>
              <DictateButton fieldId={`rv-ext-${item.id}`} onValue={setText} disabled={busy} className="mt-1" />
              <p id={`ext-${item.id}`} className="mt-1 text-[12px] text-gray-600">
                {text.trim() ? text.trim().split(/\s+/).length : 0} words
                {item.extended ? ` · marked against ${item.extended.points} key points in your notes, up to ${item.extended.marks} practice marks` : ""}. {EXTENDED_LABEL}
              </p>
            </div>
          )}
          {item.kind === "calculation" && (
            // SQIE-CLOSE-2026-11 WS-A: a number and its unit, marked by code (the unit is part of the answer).
            <div className="flex flex-wrap items-end gap-3">
              <label className="block text-[13px] font-semibold text-gray-800">Your answer
                <input type="text" inputMode="decimal" autoComplete="off" maxLength={40} value={calcValue} onChange={e => setCalcValue(e.target.value)} aria-describedby={`calc-${item.id}`}
                  className={`${field} mt-1 block w-40 tabular-nums`} />
              </label>
              {!item.calculation?.unitless && (
                <label className="block text-[13px] font-semibold text-gray-800">Unit
                  <select value={calcUnit} onChange={e => setCalcUnit(e.target.value)} className={`${field} mt-1 block min-w-[9rem]`}>
                    <option value="">Choose…</option>
                    {(item.calculation?.units ?? []).map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </label>
              )}
              <p id={`calc-${item.id}`} className="w-full text-[12px] text-gray-600">{item.calculation?.rounding ? `Give your answer ${roundingText(item.calculation.rounding)}. ` : ""}Write the number with a decimal point (0.5, not .5). {CALCULATION_LABEL}</p>
            </div>
          )}
          {item.kind === "short" && (
            <label className="block text-[13px] font-semibold text-gray-800">Your answer
              <textarea id={`rv-short-${item.id}`} rows={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} className={`${field} mt-1 block w-full`} />
            </label>
          )}
          {item.kind === "short" && <DictateButton fieldId={`rv-short-${item.id}`} onValue={setText} disabled={busy} className="-mt-1" />}
          {item.kind === "match" && (
            <ul className="space-y-2">
              {item.options.map((p, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-[8rem] flex-1 text-[14px] font-semibold text-gray-900">{p}</span>
                  <select aria-label={`Match for ${p}`} value={matches[i]} onChange={e => setMatches(m => m.map((x, k) => (k === i ? e.target.value : x)))} className={`${field} min-w-[12rem] flex-1`}>
                    <option value="">Choose…</option>
                    {(item.choices ?? []).map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </li>
              ))}
            </ul>
          )}
          {item.kind === "sequence" && (
            <ol className="space-y-2" aria-label="Put these in order">
              {order.map((idx, pos) => (
                <li key={idx} className="flex items-center gap-2 rounded-xl border border-[var(--learn-border)] px-3 py-2">
                  <span className="w-6 text-[13px] font-bold text-gray-700 tabular-nums">{pos + 1}.</span>
                  <span className="flex-1 text-[14px] text-gray-900">{item.options[idx]}</span>
                  <button type="button" className={ghost} aria-label={`Move ${item.options[idx]} up`} disabled={pos === 0} onClick={() => setOrder(o => { const n = [...o]; [n[pos - 1], n[pos]] = [n[pos], n[pos - 1]]; return n; })}>↑</button>
                  <button type="button" className={ghost} aria-label={`Move ${item.options[idx]} down`} disabled={pos === order.length - 1} onClick={() => setOrder(o => { const n = [...o]; [n[pos + 1], n[pos]] = [n[pos], n[pos + 1]]; return n; })}>↓</button>
                </li>
              ))}
            </ol>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {item.kind !== "true_false" && <button type="submit" className={btn} disabled={!ready || busy}>{busy ? "Checking…" : feedbackMode === "end" ? "Save answer" : "Check answer"}</button>}
            {item.kind === "cloze" && <button type="button" className={ghost} disabled={busy} onClick={() => void send({}, { giveUp: true })}>Show the answer (counts as a miss)</button>}
          </div>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
      {answered && <button type="button" className={`${btn} mt-3`} onClick={onNext}>{fb && !fb.correct ? "Try another question" : "Next question"}</button>}
      <p className="mt-3 text-[12px] text-gray-700">{item.kind === "cloze" ? CLOZE_LABEL : item.kind === "true_false" ? TRUE_FALSE_LABEL : item.kind === "scenario" ? SCENARIO_LABEL : item.label} · {item.citation}</p>
    </article>
  );
}

/** After an answer: right or not against the notes, how it was marked, the source, and what to do about a mistake. */
/** At the end of the session: a held short answer beside what the notes accept, the explanation and the source, graded by the student. */
export function GradeAtEnd({ questionId, sessionId, g, onGraded }: { questionId: string; sessionId: string; g: HeldGrade; onGraded: (a: Answered) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function grade(selfGrade: boolean) {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId, sessionId, response: { text: g.response }, selfGrade });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your mark could not be saved."); return; }
    onGraded({ questionId, feedback: r.json.feedback });
  }
  return (
    <div className="cmp-learn-check mt-2 rounded-xl bg-[var(--learn-surface)] p-3">
      <p className="text-[13px] text-gray-800">Your answer: <span className="font-semibold">{g.response}</span></p>
      <p className={`mt-2 ${smallCaps}`}>The answers your notes support</p>
      <ul className="mt-1 list-disc pl-5 text-[14px] text-gray-900">{g.accepted.map(x => <li key={x}>{x}</li>)}</ul>
      <p className="mt-2 text-[13px] leading-relaxed text-gray-800">{g.rationale}</p>
      <blockquote className="mt-2 border-l-4 border-[var(--learn-accent)] pl-3 text-[13px] italic text-gray-800">“{g.source.quote}”</blockquote>
      <p className="mt-1 text-[12.5px] text-gray-700">{g.label}. <Link href={sourceHref(g.source.materialId, g.source.chunkId)} className={`underline ${focusRing}`}>{g.source.citation}</Link></p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" className={ghost} disabled={busy} onClick={() => grade(true)}>It says the same</button>
        <button type="button" className={ghost} disabled={busy} onClick={() => grade(false)}>It does not</button>
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
    </div>
  );
}

/** SCHOLAR-QUESTION-INTELLIGENCE-01: the five parts of formative feedback, each only where it has something. */
export function FeedbackPartsView({ parts, tone = "amber" }: { parts: FeedbackParts; tone?: "amber" | "plain" }) {
  const ink = tone === "amber" ? "text-amber-950" : "text-gray-900";
  const rows: [string, string[]][] = [
    [FEEDBACK_HEADINGS.right, parts.right], [FEEDBACK_HEADINGS.missing, parts.missing], [FEEDBACK_HEADINGS.misconceptions, parts.misconceptions],
    [FEEDBACK_HEADINGS.why, parts.why ? [parts.why] : []], [FEEDBACK_HEADINGS.next, parts.next ? [parts.next] : []],
  ];
  return (
    <dl className={`mt-1 space-y-1 text-[13.5px] ${ink}`}>
      {/* SQIE-CLOSE-2026-11 WS-B: an unsafe statement first, in the learner's own words, apart from the five parts. */}
      {parts.unsafe?.length ? (
        <div role="note" className="cmp-learn-caution rounded-lg border-2 border-l-[6px] border-[var(--learn-accent)] bg-[var(--learn-surface)] px-3 py-2 text-gray-900">
          <dt className="font-semibold">{FEEDBACK_HEADINGS.unsafe}</dt>
          <dd>{parts.unsafe.length > 1 ? <ul className="list-disc pl-5">{parts.unsafe.map(x => <li key={x}>{x}</li>)}</ul> : parts.unsafe[0]}</dd>
          <dd className="mt-1 text-[12.5px]">{UNSAFE_NOTE}</dd>
        </div>
      ) : null}
      {rows.filter(([, xs]) => xs.length).map(([h, xs]) => (
        <div key={h}><dt className="font-semibold">{h}</dt><dd>{xs.length > 1 ? <ul className="list-disc pl-5">{xs.map(x => <li key={x}>{x}</li>)}</ul> : xs[0]}</dd></div>
      ))}
    </dl>
  );
}

const OUTCOME_WORD = { correct: "correct", partial: "partly correct", incorrect: "not correct" } as const;
const shortDate = (iso: string) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "an earlier date"; };

/** SCHOLAR-CONTINUITY-01 (791): the question as it was answered, where it has changed since, and any correction of the result -- the original beside it. */
function AttemptRecordNotes({ f }: { f: RevisionFeedback }) {
  if (!f.questionChanged && !f.corrections) return null;
  return (
    <div className="mt-2 space-y-2">
      {f.questionChanged && (
        <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900">
          <p className="font-semibold">{f.questionChanged.note}</p>
          <p className="mt-1">{f.questionChanged.asAnswered.stem}</p>
          {f.questionChanged.asAnswered.options.length > 0 && <ol className="mt-1 list-[upper-alpha] pl-5">{f.questionChanged.asAnswered.options.map((o, i) => <li key={i}>{o}</li>)}</ol>}
        </div>
      )}
      {f.corrections && (
        <div className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-[13px] text-gray-900">
          <p className="font-semibold">This result was corrected.</p>
          <ul className="mt-1 space-y-1">
            {f.corrections.entries.map((c, i) => (
              <li key={i}><span className="font-semibold">{c.basis}</span> ({shortDate(c.at)}): {OUTCOME_WORD[c.from]} changed to {OUTCOME_WORD[c.to]}. {c.reason}</li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-gray-700">Original result, kept as it was: {OUTCOME_WORD[f.corrections.original.outcome]}{f.corrections.original.score !== null ? ` (${Math.round(f.corrections.original.score * 100)}%)` : ""}.</p>
        </div>
      )}
    </div>
  );
}

/** SQIE-CLOSE-2026-11 WS-C: an interpretation item's findings, as a table (label, value, unit). */
function FindingsTable({ findings }: { findings: Finding[] }) {
  return (
    <div className="mb-3 overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-left text-[13.5px]">
        <caption className="sr-only">Findings</caption>
        <thead className="bg-gray-50 text-[12px] uppercase tracking-[0.06em] text-gray-600"><tr><th scope="col" className="px-3 py-1.5">Finding</th><th scope="col" className="px-3 py-1.5">Value</th></tr></thead>
        <tbody>{findings.map((x, i) => <tr key={i} className="border-t border-gray-100"><th scope="row" className="px-3 py-1.5 font-semibold text-gray-900">{x.label}</th><td className="px-3 py-1.5 tabular-nums text-gray-900">{x.value}{x.unit ? ` ${x.unit}` : ""}</td></tr>)}</tbody>
      </table>
    </div>
  );
}

/** SQIE-CLOSE-2026-11 WS-B: an unsafe answer, or a safety-critical point missed: said plainly, with what, and that the marks were capped. */
function SafetyBlock({ s }: { s: NonNullable<RevisionFeedback["safety"]> }) {
  return (
    <div data-testid="safety-outcome" className="mt-2"><LearningCallout tone="caution" icon="warn" label={s.label} emphasis="safety">
      <p className="text-[13.5px] text-gray-900">{s.explainer}</p>
      {s.statement && s.by === "code" && <p className="mt-1 text-[13px] text-gray-900"><span className="font-semibold">Unsafe in your answer:</span> &ldquo;{s.statement}&rdquo;</p>}
      {s.missed.length > 0 && <div className="mt-1 text-[13px] text-gray-900"><span className="font-semibold">Missed:</span><ul className="list-disc pl-5">{s.missed.map(m => <li key={m}>{m}</li>)}</ul></div>}
      <p className="text-[12px] text-gray-700">{s.byLabel}</p>
    </LearningCallout></div>
  );
}

/** The shape beside the verdict's words: whole, part, or not yet. Marks count as part when some were given and not all. */
function verdictMark(f: RevisionFeedback): ProgressState {
  const marks = f.scenario?.practiceMarks ?? f.structured?.practiceMarks ?? f.extended?.marks ?? null;
  if (marks) return marks.awarded >= marks.total && marks.total > 0 ? "checked" : marks.awarded > 0 ? "read" : "none";
  return f.correct ? "checked" : f.score !== null && f.score > 0 ? "read" : "none";
}

export function FeedbackPanel({ f, sessionId, compact = false, questionId, stem }: { f: RevisionFeedback; sessionId: string | null; compact?: boolean; questionId?: string; stem?: string | null }) {
  const basis = f.library ? "the Competen library answer" : "your notes";
  return (
    <div aria-live="polite" className={`${learnBox("check")} mt-3 p-4`}>
      {/* The verdict is a shape and words, never a red or green box: formative, never punitive. */}
      <p className="flex items-start gap-2 text-[14.5px] font-bold"><span className="cmp-learn-accent mt-0.5"><ProgressMark state={verdictMark(f)} /></span><span className="cmp-learn-ink min-w-0">
        {f.scenario ? `${f.scenario.practiceMarks.awarded} of ${f.scenario.practiceMarks.total} practice marks`
          : f.structured ? `${f.structured.practiceMarks.awarded} of ${f.structured.practiceMarks.total} practice marks`
          : f.extended ? `${f.extended.marks.awarded} of ${f.extended.marks.total} practice marks`
          : f.correct ? `That matches ${basis}.` : f.score !== null && f.score > 0 ? `Partly: ${Math.round(f.score * 100)}% matched ${basis}.` : `That does not match ${basis}.`}
      </span></p>
      {f.scenario && <p className="text-[12px] text-gray-700">{f.scenario.practiceMarks.label}</p>}
      {f.structured && <p className="text-[12px] text-gray-700">{f.structured.practiceMarks.label}</p>}
      {f.extended && <p className="text-[12px] text-gray-700">{f.extended.marks.label}</p>}
      {f.rubricNote && <p className="mt-1 text-[12px] text-gray-700">{f.rubricNote}</p>}
      {f.safety && <SafetyBlock s={f.safety} />}
      {f.calculation && (
        // SQIE-CLOSE-2026-11 WS-A: what was given, the answer, and why (a wrong unit is said plainly).
        <div data-testid="calculation-outcome" className="mt-2 rounded-lg bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)] px-3 py-2 text-[13.5px] text-gray-900">
          <p><span className="font-semibold">Your answer:</span> {f.calculation.given.value ?? "—"}{f.calculation.given.unit ? ` ${f.calculation.given.unit}` : ""} · <span className="font-semibold">The answer:</span> {f.calculation.expected.value}{f.calculation.expected.unit ? ` ${f.calculation.expected.unit}` : ""}</p>
          <p className="mt-0.5">{f.calculation.feedback}</p>
          {f.calculation.warnings.map(w => <p key={w} className="mt-0.5 text-[12.5px] text-amber-900">{w}</p>)}
          {!compact && f.calculation.working && <p className="mt-1"><span className="font-semibold">Working from your notes:</span> {f.calculation.working}</p>}
          <p className="mt-1 text-[12px] text-gray-700">Tolerance: {f.calculation.tolerance}. {f.calculation.unitRule}</p>
        </div>
      )}
      <AttemptRecordNotes f={f} />
      {f.library &&<p className="mt-1 inline-flex rounded-full border border-gray-300 bg-[var(--cmp-app-surface)] px-2.5 py-0.5 text-[12px] font-semibold text-gray-900">{f.library.label} · version {f.library.versionNo}</p>}
      <p className="text-[12px] text-gray-700"><span className="font-semibold">{f.markingLabel}.</span> {f.marking === "deterministic" ? MARKED_AGAINST_NOTES : ""}</p>
      {/* SCHOLAR-CE-2026 CE-05: one honest line, on every format, saying what this was marked against. */}
      {f.markedAgainst && <p data-testid="marked-against" className="text-[12px] text-gray-700">{f.markedAgainst}</p>}
      {f.evaluation && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{f.evaluation.label}</p>
          {f.evaluation.parts ? <FeedbackPartsView parts={f.evaluation.parts} /> : <p className="mt-1 text-[13.5px] text-amber-950">{f.evaluation.feedback}</p>}
          <FormativeAiLabel className="mt-1" />
          {f.evaluation.formative && <p className="mt-0.5 text-[12px] text-amber-900">{f.evaluation.formative}</p>}
        </div>
      )}
      {f.scenario ? (
        <ol className="mt-2 space-y-2">
          {f.scenario.stages.map(st => (
            <li key={st.index} className="rounded-lg bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)] p-2.5 text-[13.5px] text-gray-900">
              {st.reveal && <p className="text-gray-700">{st.reveal}</p>}
              <p className="font-semibold">Stage {st.index + 1}: {st.prompt} <span className="font-normal text-gray-700">· {st.awarded === null ? "—" : st.awarded} of {st.weight} mark{st.weight === 1 ? "" : "s"}</span></p>
              {st.yourAnswer !== null && <p className="mt-0.5"><span className="font-semibold">Your answer:</span> {st.yourAnswer}{st.by ? <span className="text-gray-600"> ({st.by === "code" ? "marked by code" : st.by === "ai" ? "judged by AI" : "marked by you"})</span> : null}</p>}
              <p className="mt-0.5"><span className="font-semibold">{f.library ? "The library answer" : "Your notes"}:</span> {st.key}</p>
              <p className="mt-0.5"><span className="font-semibold">Key point:</span> {st.keyPoint}</p>
              {st.source && <p className="mt-0.5 text-[12.5px] italic text-gray-700">Source: “{st.source}”</p>}
              {st.evaluation && (
                <div className="mt-1 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
                  <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{st.evaluation.label}</p>
                  <p className="mt-1 text-[13.5px] text-amber-950">{st.evaluation.feedback}</p>
                  <p className="mt-0.5 text-[12px] text-amber-900">{st.evaluation.formative}</p>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : f.structured ? (
        <>
        {!compact && !!f.structured.findings?.length && <FindingsTable findings={f.structured.findings} />}
        <ol className="mt-2 space-y-2">
          {f.structured.parts.map((pt, i) => (
            <li key={i} className="rounded-lg bg-[var(--cmp-app-surface)] ring-1 ring-[var(--learn-border)] p-2.5 text-[13.5px] text-gray-900">
              <p className="font-semibold">({String.fromCharCode(97 + i)}) {pt.roleLabel ? <span className="mr-1 rounded bg-gray-100 px-1.5 py-0.5 text-[11.5px] text-gray-700">{pt.roleLabel}</span> : null}{pt.prompt} <span className="font-normal text-gray-700">· {pt.awarded === null ? "—" : pt.awarded} of {pt.marks} mark{pt.marks === 1 ? "" : "s"}</span>
                {pt.safetyCritical && <span className="cmp-learn-caution ml-1 rounded border border-[var(--learn-accent)] bg-[var(--learn-surface)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--learn-ink)]">Safety-critical</span>}</p>
              <p className="mt-0.5"><span className="font-semibold">{pt.options ? "The answer:" : "Your notes:"}</span> {pt.accepted}</p>
              {/* WS-C: rubric-based partial credit: each weighted criterion, and whether the answer met it (formative). */}
              {pt.criteria && (
                <ul className="mt-1 space-y-0.5 text-[13px] text-gray-800" aria-label="Marking criteria">
                  {pt.criteria.map((c, k) => (
                    <li key={k} className="flex gap-2">
                      <span aria-hidden className="w-4 shrink-0 font-bold">{c.met === null ? "·" : c.met ? "✓" : "✗"}</span>
                      <span>{c.text} <span className="text-gray-600">(weight {c.weight}{c.safetyCritical ? ", safety-critical" : ""}{c.met === null ? "" : c.met ? ", met" : ", not met"})</span></span>
                    </li>
                  ))}
                </ul>
              )}
              {!compact && pt.keyPoints.length > 0 && <ul className="mt-1 list-disc pl-5 text-[13px] text-gray-800">{pt.keyPoints.map(k => <li key={k}>{k}</li>)}</ul>}
              {pt.evaluation && (
                <div className="mt-1 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
                  <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{pt.evaluation.label}</p>
                  {pt.evaluation.parts ? <FeedbackPartsView parts={pt.evaluation.parts} /> : <p className="mt-1 text-[13.5px] text-amber-950">{pt.evaluation.feedback}</p>}
                  {pt.evaluation.formative && <p className="mt-0.5 text-[12px] text-amber-900">{pt.evaluation.formative}</p>}
                </div>
              )}
            </li>
          ))}
        </ol>
        </>
      ) : f.extended ? (
        <div className="mt-2 text-[13.5px] text-gray-900">
          <p className="font-semibold">The points a full answer makes</p>
          <ul className="mt-1 space-y-1">
            {f.extended.points.map(pt => (
              <li key={pt.text} className="flex gap-2">
                <span aria-hidden className="w-4 shrink-0 font-bold">{pt.matched === null ? "•" : pt.matched ? "✓" : "✗"}</span>
                <span>{pt.text}{pt.matched === null ? "" : <span className="sr-only">{pt.matched ? " (your answer made this point)" : " (your answer missed this point)"}</span>}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2"><span className="font-semibold">Model answer from your notes:</span> {f.extended.modelAnswer}</p>
          <p className="mt-1 text-[12px] text-gray-700">{f.extended.label}</p>
        </div>
      ) : <p className="mt-2 text-[13.5px] text-gray-900"><span className="font-semibold">{f.library ? "The library answer" : "Your notes"}:</span> {f.answer}</p>}
      {!compact && <p className="mt-1 text-[13.5px] leading-relaxed text-gray-800">{f.rationale}</p>}
      {/* SCHOLAR-QUESTION-INTELLIGENCE-01: after answering -- what it checks, at what level, and its key points. */}
      {!compact && f.rubric && (f.rubric.objective || f.rubric.keyPoints.length > 0) && (
        <div className="mt-2 text-[13px] text-gray-800">
          <p><span className="font-semibold">Checks:</span> {f.rubric.objective ?? "—"} <span className="text-gray-600">({f.rubric.level} · {f.rubric.grounding})</span></p>
          {f.rubric.keyPoints.length > 0 && <ul className="mt-1 list-disc pl-5">{f.rubric.keyPoints.map(k => <li key={k}>{k}</li>)}</ul>}
        </div>
      )}
      {f.source.quote && <blockquote className="mt-2 border-l-4 border-[var(--learn-accent)] pl-3 text-[13px] italic text-gray-800">“{f.source.quote}”</blockquote>}
      {f.practises && (
        <p className="mt-2 text-[12.5px] text-gray-700">
          <span className="font-semibold">Practises:</span> {f.practises.competency}{f.practises.outcome ? <> · <span className="font-semibold">outcome:</span> {f.practises.outcome}</> : null}. <span className="text-gray-600">{f.practises.label}</span>
        </p>
      )}
      {f.card === "created" && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Added to your review cards: it comes back today.</p>}
      {f.card === "reset" && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Its review card has gone back to the start of its schedule.</p>}
      {f.card === "reviewed" && f.nextReviewAt && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Reviewed: it comes back {new Date(`${f.nextReviewAt}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}.</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        {!f.correct && <Link href={learnHref(f.source.chunkId, sessionId, "explain")} className={ghost}>Explain the answer</Link>}
        <Link href={sourceHref(f.source.materialId, f.source.chunkId)} className={ghost}>{f.library ? "Show my notes on this" : "Show the source"}</Link>
        {/* SCHOLAR-LESSON-VISUALS-01: the original picture of the cited slide / page (asked for on the click; no AI). */}
        {!f.library && <SourcePictureButton materialId={f.source.materialId} citation={f.source.citation} className={ghost} />}
        {!f.correct && <Link href={learnHref(f.source.chunkId, sessionId)} className={ghost}>Teach me this</Link>}
        {/* CLINICAL-REASONING-01 CR1: from Revision, a case written from the same section. */}
        <Link href={`${studyHref("apply")}?section=${f.source.chunkId}&from=revision`} className={ghost}>Practise in a case</Link>
        {/* SCHOLAR-SQIE-01: more on the same material, a step easier after a miss and harder after a right answer. */}
        {f.nextDifficulty && <Link href={`${studyHref("revise")}?material=${f.source.materialId}&difficulty=${f.nextDifficulty}`} className={ghost}>{f.correct ? "Try harder questions on this" : "More practice on this"}</Link>}
        {/* SCHOLAR-CE-2026 CE-01: ask about this question in place -- the question's own section, no leaving the page. */}
        <AskAbout surface="revise" chunkIds={f.library ? [] : [f.source.chunkId]} materialId={f.library ? null : f.source.materialId} refLabel={`Question feedback: ${f.source.citation}`}
          prefill={askPrefill("revise", { stem, correct: f.correct })} />
      </div>
      {/* SCHOLAR-AI-OPT-01 s7: optional, one tap, about the AI-written question itself (not the student's answer). */}
      {!f.library && <AiFeedback kind="question" target="question" refId={questionId} />}
    </div>
  );
}
