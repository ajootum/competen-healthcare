"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { sourceHref, studyHref } from "./question-view";
import {
  MARKED_AGAINST_NOTES, MOCK_LABEL, REVISION_DIFFICULTIES, REVISION_FORMAT_LABEL, REVISION_MODE_HELP, REVISION_MODE_LABEL,
  type RevisionFormat, type RevisionMode,
} from "@/lib/individual/scholar/config";
import type { RevisionFeedback, RevisionItemView } from "@/lib/individual/scholar/revision-view";

// THE REVISION WORKSPACE -- COMPETEN-SCHOLAR-REVISION-01 R1 and R4 (owner GO 2026-10-24).
// Revise -> Answer -> Understand mistakes -> Reinforce -> Revisit -> Improve. Every answer goes to
// /api/individual/scholar/revision/answer and is shown as the route says: marked by code, by the student, or by AI
// evaluation, each labelled. A wrong answer offers Explain the answer, Show the source, Teach me this, Try another.
// Leaving for Teach Me keeps the session: Learn links back to it, and it resumes at the same question.
// One column below md (the CPR-MOB-001 single md edge); touch targets grow on coarse pointers.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
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
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  // Learning Continuity: new questions are not available, which is a state to explain, not an error.
  const [continuity, setContinuity] = useState("");
  const [open, setOpen] = useState(false);
  const [scopeKind, setScopeKind] = useState<"library" | "documents" | "topic" | "competency">("library");
  const [chosen, setChosen] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [competency, setCompetency] = useState("");
  const [formats, setFormats] = useState<RevisionFormat[]>(props.formats);
  const [quantity, setQuantity] = useState(props.quantity);
  const [difficulty, setDifficulty] = useState(props.difficulty);
  const [feedback, setFeedback] = useState(props.feedback);
  const [mode, setMode] = useState<RevisionMode>(props.modes.includes("quick") ? "quick" : props.modes[0] ?? "today");
  const [unsaved, setUnsaved] = useState<{ items: RevisionItemView[]; label: string | null } | null>(null);

  const start = useCallback(async (m: RevisionMode, custom: boolean) => {
    setBusy(m); setError(""); setNote(""); setContinuity("");
    const scope = !custom || scopeKind === "library" ? { kind: "library" }
      : scopeKind === "documents" ? { kind: "documents", materialIds: chosen }
        : scopeKind === "topic" ? { kind: "topic", topic } : { kind: "competency", competencyId: competency };
    const r = await call("/api/individual/scholar/revision/sessions", { mode: m, scope, ...(custom ? { formats, quantity, difficulty, feedback } : {}) });
    setBusy("");
    if (!r.ok && r.json.continuity) { setContinuity(r.json.error ?? "New questions are not available right now."); return; }
    if (!r.ok) { setError(r.json.error ?? "Revision could not start just now."); return; }
    if (r.json.session?.id) router.push(revisionHref(r.json.session.id));
    // A session this environment could not keep (417 absent): run here, for this sitting only.
    else { setNote(r.json.note ?? ""); setUnsaved({ items: r.json.items ?? [], label: r.json.label ?? null }); }
  }, [router, scopeKind, chosen, topic, competency, formats, quantity, difficulty, feedback]);

  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  if (unsaved) return <RevisionRunner session={null} items={unsaved.items} answered={[]} label={unsaved.label} />;
  return (
    <section aria-labelledby="start-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="start-h" className="text-[16px] font-bold text-gray-900">Revise</h2>
      <p className="mt-0.5 text-[13.5px] text-gray-600">From your own notes. Formative practice: not an assessment and not evidence of competence.</p>
      {props.modes.includes("today") && (
        <button type="button" className={`${btn} mt-4 w-full sm:w-auto`} style={{ background: accent }} disabled={!!busy} onClick={() => start("today", false)}>
          {busy === "today" ? "Preparing your revision…" : "Start Today's Revision"}
        </button>
      )}
      {props.aiNote && <p className="mt-2 text-[12.5px] text-gray-600">{props.aiNote}</p>}
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.modes.filter(m => m !== "today" && m !== "custom").map(m => (
          <li key={m}>
            <button type="button" disabled={!!busy} onClick={() => start(m, false)}
              className={`w-full rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50 disabled:opacity-50 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>
              <span className="block text-[14px] font-semibold text-gray-900">{busy === m ? "Preparing…" : REVISION_MODE_LABEL[m]}</span>
              <span className="block text-[12.5px] text-gray-600">{REVISION_MODE_HELP[m]}</span>
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className={`${ghost} mt-4`} aria-expanded={open} aria-controls="choose-revision" onClick={() => setOpen(o => !o)}>Choose what and how to revise</button>
      {open && (
        <form id="choose-revision" className="mt-3 space-y-4 rounded-xl border border-gray-200 p-4" onSubmit={e => { e.preventDefault(); void start(mode, true); }}>
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
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" name="scope" checked={scopeKind === k} onChange={() => setScopeKind(k)} />
                  {k === "library" ? "All my notes" : k === "documents" ? "Chosen materials" : k === "topic" ? "A topic" : "A competency"}</label>
              ))}
            </div>
            {scopeKind === "documents" && (
              <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
                {props.materials.map(m => <li key={m.id}><label className="inline-flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={chosen.includes(m.id)} onChange={() => setChosen(c => toggle(c, m.id))} />{m.title}</label></li>)}
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
              {props.formats.map(f => <label key={f} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats(x => toggle(x, f))} />{REVISION_FORMAT_LABEL[f]}</label>)}
            </div>
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
          </div>
          <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !formats.length || (scopeKind === "documents" && !chosen.length) || (scopeKind === "topic" && topic.trim().length < 2) || (scopeKind === "competency" && !competency)}>
            {busy ? "Preparing…" : "Start revising"}
          </button>
        </form>
      )}
      {note && <p role="status" className="mt-3 text-[13px] text-gray-700">{note}</p>}
      {continuity && (
        <div role="status" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">No new questions right now</p>
          <p className="mt-1 text-[14px] text-gray-800">{continuity}</p>
        </div>
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
    const r = await call("/api/individual/scholar/revision/sessions", { mode: "custom", setId: id });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "That set could not be started."); return; }
    if (r.json.session?.id) router.push(revisionHref(r.json.session.id));
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
      <ul className="mt-2 divide-y divide-gray-100 rounded-xl border border-gray-200">
        {sets.map(s => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span className="min-w-0 flex-1 text-[14px]"><span className="font-semibold text-gray-900">{s.title}</span>
              <span className="text-[12.5px] text-gray-500"> · {s.questions} question{s.questions === 1 ? "" : "s"}{s.lastUsedAt ? ` · last ${new Date(s.lastUsedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : ""}</span></span>
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
type Answered = { questionId: string; feedback?: RevisionFeedback };

export function RevisionRunner(props: { session: SessionState | null; items: RevisionItemView[]; answered: Answered[]; label?: string | null }) {
  const router = useRouter();
  const [state, setState] = useState<{ session: SessionState | null; items: RevisionItemView[]; answered: Answered[] } | null>({ session: props.session, items: props.items, answered: props.answered });
  const [summary, setSummary] = useState<{ answered: number; of: number; correct: number; byMarking: Record<string, number> } | null>(null);
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
    <section aria-labelledby="run-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="run-h" className="text-[16px] font-bold text-gray-900">{REVISION_MODE_LABEL[state.session?.mode as RevisionMode] ?? "Revision"}</h2>
        <p className="text-[12.5px] font-semibold text-gray-500 tabular-nums">{answeredIds.size} of {items.length} answered</p>
        <div className="h-1.5 min-w-[120px] flex-1 rounded-full bg-gray-100" aria-hidden><div className="h-1.5 rounded-full" style={{ width: `${(answeredIds.size / Math.max(1, items.length)) * 100}%`, background: accent }} /></div>
        <Link href={revisionHref()} className={`text-[13px] underline ${focusRing}`}>Leave (it is kept)</Link>
      </div>
      {(props.label || state.session?.mode === "mock") && <p className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[12.5px] text-gray-700">{props.label ?? MOCK_LABEL}</p>}
      {!sid && <p className="mt-2 text-[12.5px] text-gray-600">This session is not kept on this environment, so it cannot be resumed later.</p>}

      {summary ? (
        <div className="mt-4 space-y-4">
          <p className="text-[15px] font-semibold text-gray-900">Session finished: {summary.correct} of {summary.of} matched your notes.</p>
          {Object.keys(summary.byMarking).length > 0 && (
            <p className="text-[12.5px] text-gray-600">Marked by code: {summary.byMarking.deterministic ?? 0} · by you: {summary.byMarking.self_graded ?? 0} · by AI evaluation: {summary.byMarking.ai_evaluation ?? 0}</p>
          )}
          <ol className="space-y-3">
            {items.map((i, n) => { const a = state.answered.find(x => x.questionId === i.id); return (
              <li key={i.id} className="rounded-xl border border-gray-200 p-3">
                <p className="text-[14px] font-semibold text-gray-900">{n + 1}. {i.stem}</p>
                {a?.feedback ? <FeedbackPanel f={a.feedback} sessionId={sid} compact /> : <p className="text-[13px] text-gray-500">Not answered.</p>}
              </li>
            ); })}
          </ol>
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
                className={`h-8 min-w-8 rounded-lg border px-2 text-[12.5px] font-semibold tabular-nums pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing} ${n === at ? "border-gray-900" : "border-gray-200"} ${answeredIds.has(i.id) ? "bg-gray-100 text-gray-700" : "bg-white text-gray-900"}`}>{n + 1}</button>
            ))}
          </nav>
          <QuestionRunner key={item.id} item={item} sessionId={sid} feedbackMode={state.session?.feedback ?? "immediate"}
            answered={state.answered.find(a => a.questionId === item.id) ?? null} onAnswered={record}
            onNext={() => setAt(n => { const next = items.findIndex((i, k) => k > n && !answeredIds.has(i.id) && i.id !== item.id); return next >= 0 ? next : Math.min(items.length - 1, n + 1); })} />
          {done && <button type="button" className={`${btn} mt-4`} style={{ background: accent }} onClick={finish}>Finish and see how it went</button>}
        </>
      ) : <p className="mt-3 text-[14px] text-gray-600">No questions in this session.</p>}
    </section>
  );
}

function QuestionRunner({ item, sessionId, feedbackMode, answered, onAnswered, onNext }: {
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
  const [back, setBack] = useState<{ back: string; source: { quote: string; citation: string; materialId: string; chunkId: string } } | null>(null);
  const [selfGrade, setSelfGrade] = useState<{ accepted: string[]; reason: string; label: string } | null>(null);

  async function send(response: unknown, extra: Record<string, unknown> = {}) {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId: item.id, sessionId, response, ...extra });
    setBusy(false);
    if (r.json.needsSelfGrade) { setSelfGrade({ accepted: r.json.accepted ?? [], reason: r.json.reason ?? "", label: r.json.label ?? "" }); return; }
    if (!r.ok) { setError(r.json.error ?? "Your answer could not be saved."); return; }
    onAnswered({ questionId: item.id, feedback: r.json.feedback });
  }
  async function reveal() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/revision/answer", { questionId: item.id, sessionId, reveal: true });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The answer could not be shown."); return; }
    setBack(r.json as typeof back);
  }
  const responseOf = (): unknown => item.kind === "mcq" || item.kind === "case" ? { index: choice } : item.kind === "mrq" ? { indexes: set }
    : item.kind === "short" ? { text } : item.kind === "match" ? { matches } : item.kind === "sequence" ? { order } : null;
  const ready = item.kind === "mcq" || item.kind === "case" ? choice !== null : item.kind === "mrq" ? set.length > 0 : item.kind === "short" ? text.trim().length > 0
    : item.kind === "match" ? matches.every(Boolean) : item.kind === "sequence";
  const letter = (i: number) => String.fromCharCode(65 + i);
  const fb = answered?.feedback ?? null;

  return (
    <article className="mt-4">
      <p className="text-[11.5px] font-semibold uppercase tracking-[0.08em] text-gray-500">{REVISION_FORMAT_LABEL[item.kind as RevisionFormat] ?? "Practice case step"}{item.difficulty ? ` · ${item.difficulty === 1 ? "easier" : item.difficulty === 3 ? "harder" : "standard"}` : ""}</p>
      <p className="mt-1 text-[16px] font-semibold leading-relaxed text-gray-900">{item.stem}</p>
      {answered ? (
        fb ? <FeedbackPanel f={fb} sessionId={sessionId} /> : <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[13.5px] text-gray-700">Answer recorded. You will see how it went at the end of the session.</p>
      ) : item.kind === "flashcard" ? (
        !back ? <button type="button" className={`${btn} mt-4`} style={{ background: accent }} disabled={busy} onClick={reveal}>Show the answer</button> : (
          <div className="mt-4">
            <div className="rounded-xl bg-gray-50 p-4">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-gray-500">What your notes say</p>
              <p className="mt-1 text-[14.5px] font-bold text-gray-900">{back.back}</p>
              <p className="mt-1 text-[12.5px] text-gray-600">From your notes: <Link href={sourceHref(back.source.materialId, back.source.chunkId)} className={`underline ${focusRing}`}>{back.source.citation}</Link></p>
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
      ) : selfGrade ? (
        <div className="mt-4 rounded-xl border border-gray-200 p-4">
          <p className="text-[13.5px] text-gray-800">{selfGrade.reason}</p>
          <p className="mt-2 text-[12px] font-semibold uppercase tracking-wide text-gray-500">The answers your notes support</p>
          <ul className="mt-1 list-disc pl-5 text-[14px] text-gray-900">{selfGrade.accepted.map(a => <li key={a}>{a}</li>)}</ul>
          <p className="mt-2 text-[13px] text-gray-700">Your answer: <span className="font-semibold">{text}</span></p>
          <p className="mt-1 text-[12px] text-gray-500">{selfGrade.label}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className={ghost} disabled={busy} onClick={() => send({ text }, { selfGrade: true })}>It says the same</button>
            <button type="button" className={ghost} disabled={busy} onClick={() => send({ text }, { selfGrade: false })}>It does not</button>
          </div>
        </div>
      ) : (
        <form className="mt-3" onSubmit={e => { e.preventDefault(); if (ready) void send(responseOf()); }}>
          {(item.kind === "mcq" || item.kind === "case" || item.kind === "mrq") && (
            <fieldset>
              <legend className="sr-only">{item.kind === "mrq" ? "Choose all that apply" : "Choose one"}</legend>
              {item.kind === "mrq" && <p className="mb-2 text-[12.5px] text-gray-600">Choose all that apply.</p>}
              <div className="grid gap-2 lg:grid-cols-2">
                {item.options.map((o, i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 text-[14.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${(item.kind === "mrq" ? set.includes(i) : choice === i) ? "border-gray-900" : "border-gray-200 hover:bg-gray-50"}`}>
                    {item.kind === "mrq"
                      ? <input type="checkbox" checked={set.includes(i)} onChange={() => setSet(s => (s.includes(i) ? s.filter(x => x !== i) : [...s, i]))} className="mt-1 h-4 w-4 shrink-0" />
                      : <input type="radio" name={`r-${item.id}`} checked={choice === i} onChange={() => setChoice(i)} className="mt-1 h-4 w-4 shrink-0" />}
                    <span><span className="font-semibold">{letter(i)}.</span> {o}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {item.kind === "short" && (
            <label className="block text-[13px] font-semibold text-gray-800">Your answer
              <textarea rows={2} maxLength={1000} value={text} onChange={e => setText(e.target.value)} className={`${field} mt-1 block w-full`} />
            </label>
          )}
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
                <li key={idx} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2">
                  <span className="w-6 text-[13px] font-bold text-gray-500 tabular-nums">{pos + 1}.</span>
                  <span className="flex-1 text-[14px] text-gray-900">{item.options[idx]}</span>
                  <button type="button" className={ghost} aria-label={`Move ${item.options[idx]} up`} disabled={pos === 0} onClick={() => setOrder(o => { const n = [...o]; [n[pos - 1], n[pos]] = [n[pos], n[pos - 1]]; return n; })}>↑</button>
                  <button type="button" className={ghost} aria-label={`Move ${item.options[idx]} down`} disabled={pos === order.length - 1} onClick={() => setOrder(o => { const n = [...o]; [n[pos + 1], n[pos]] = [n[pos], n[pos + 1]]; return n; })}>↓</button>
                </li>
              ))}
            </ol>
          )}
          <button type="submit" className={`${btn} mt-3`} style={{ background: accent }} disabled={!ready || busy}>{busy ? "Checking…" : feedbackMode === "end" ? "Save answer" : "Check answer"}</button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
      {answered && <button type="button" className={`${ghost} mt-3`} onClick={onNext}>{fb && !fb.correct ? "Try another question" : "Next question"}</button>}
      <p className="mt-3 text-[11.5px] text-gray-500">{item.label} · {item.citation}</p>
    </article>
  );
}

/** After an answer: right or not against the notes, how it was marked, the source, and what to do about a mistake. */
function FeedbackPanel({ f, sessionId, compact = false }: { f: RevisionFeedback; sessionId: string | null; compact?: boolean }) {
  return (
    <div aria-live="polite" className={`mt-3 rounded-xl border p-4 ${f.correct ? "border-emerald-300 bg-emerald-50" : "border-red-300 bg-red-50"}`}>
      <p className={`text-[14.5px] font-bold ${f.correct ? "text-emerald-900" : "text-red-900"}`}>
        {f.correct ? "That matches your notes." : f.score !== null && f.score > 0 ? `Partly: ${Math.round(f.score * 100)}% matched your notes.` : "That does not match your notes."}
      </p>
      <p className="text-[12px] text-gray-700"><span className="font-semibold">{f.markingLabel}.</span> {f.marking === "deterministic" ? MARKED_AGAINST_NOTES : ""}</p>
      {f.evaluation && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{f.evaluation.label}</p>
          <p className="mt-1 text-[13.5px] text-amber-950">{f.evaluation.feedback}</p>
        </div>
      )}
      <p className="mt-2 text-[13.5px] text-gray-900"><span className="font-semibold">Your notes:</span> {f.answer}</p>
      {!compact && <p className="mt-1 text-[13.5px] leading-relaxed text-gray-800">{f.rationale}</p>}
      <blockquote className="mt-2 border-l-4 pl-3 text-[13px] italic text-gray-700" style={{ borderColor: accent }}>“{f.source.quote}”</blockquote>
      {f.card === "created" && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Added to your review cards: it comes back today.</p>}
      {f.card === "reset" && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Its review card has gone back to the start of its schedule.</p>}
      {f.card === "reviewed" && f.nextReviewAt && <p className="mt-2 text-[12.5px] font-semibold text-gray-800">Reviewed: it comes back {new Date(`${f.nextReviewAt}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })}.</p>}
      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        {!f.correct && <Link href={learnHref(f.source.chunkId, sessionId, "explain")} className={ghost}>Explain the answer</Link>}
        <Link href={sourceHref(f.source.materialId, f.source.chunkId)} className={ghost}>Show the source</Link>
        {!f.correct && <Link href={learnHref(f.source.chunkId, sessionId)} className={ghost}>Teach me this</Link>}
        {/* CLINICAL-REASONING-01 CR1: from Revision, a case written from the same section. */}
        <Link href={`${studyHref("apply")}?section=${f.source.chunkId}&from=revision`} className={ghost}>Practise in a case</Link>
      </div>
    </div>
  );
}
