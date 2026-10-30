"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { studyHref } from "./question-view";
import { FeedbackPanel, GradeAtEnd, QuestionRunner, type Answered, type HeldGrade } from "./revision-client";
import {
  ADAPTIVE_LENGTH_MIN, ADAPTIVE_TIME_LIMITS, GROUNDING_LABEL, REVISION_FORMAT_LABEL, type AdaptiveFormat,
} from "@/lib/individual/scholar/config";
import type { AdaptiveReport } from "@/lib/individual/scholar/adaptive";
import type { RevisionFeedback, RevisionItemView } from "@/lib/individual/scholar/revision-view";
import type { GenerationDifficulty, SourceMode } from "@/lib/individual/scholar/question-intel";

// ADAPTIVE EXAMS -- SCHOLAR-PRACTICE-EXAMS-01 (owner, 30 Oct 2026). The blueprint form, one exam question at a time, and
// the formative report. Every answer goes to /api/individual/scholar/revision/answer (QuestionRunner, unchanged); the next
// question comes from /api/individual/scholar/revision/adaptive/next. The rule is always on screen, in words.
// One column below md (the CPR-MOB-001 single md edge); touch targets grow on coarse pointers.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const WORD: Record<GenerationDifficulty, string> = { easy: "Easier", standard: "Standard", harder: "Harder" };

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

export const adaptiveHref = (sessionId?: string | null) => `${studyHref("revise/adaptive")}${sessionId ? `?session=${sessionId}` : ""}`;

/** The rule, as the student reads it beside every exam. */
export function RuleNote({ rule, className = "" }: { rule: string; className?: string }) {
  return <p className={`rounded-lg bg-[var(--cmp-theme-soft)] px-3 py-2 text-[13px] text-gray-800 ${className}`}><span className="font-semibold">How it adapts: </span>{rule}</p>;
}

// ── THE BLUEPRINT ──

export function AdaptiveStart(props: {
  formats: AdaptiveFormat[]; length: number; maxLength: number; feedback: "immediate" | "end";
  materials: { id: string; title: string }[]; competencies: { id: string; title: string }[];
  programme: string | null; levelDefault: GenerationDifficulty | null; rule: string; aiNote: string | null;
}) {
  const router = useRouter();
  const [scopeKind, setScopeKind] = useState<"programme" | "library" | "documents" | "topic" | "competencies">(props.programme && props.competencies.length ? "programme" : "library");
  const [chosen, setChosen] = useState<string[]>([]);
  const [comps, setComps] = useState<string[]>([]);
  const [topic, setTopic] = useState("");
  const [formats, setFormats] = useState<AdaptiveFormat[]>(props.formats);
  const [length, setLength] = useState(props.length);
  const [start, setStart] = useState<"auto" | GenerationDifficulty>("auto");
  const [feedback, setFeedback] = useState(props.feedback);
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [source, setSource] = useState<SourceMode>("notes");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [continuity, setContinuity] = useState("");
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const shown = props.formats.filter(f => f !== "structured" || feedback === "immediate");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(""); setContinuity("");
    const scope = scopeKind === "documents" ? { kind: "documents", materialIds: chosen } : scopeKind === "topic" ? { kind: "topic", topic }
      : scopeKind === "competencies" ? { kind: "competencies", competencyIds: comps } : { kind: scopeKind };
    const r = await call("/api/individual/scholar/revision/adaptive", { scope, formats: formats.filter(f => shown.includes(f)), length, start, feedback, timeLimitMinutes: timeLimit, source });
    setBusy(false);
    if (!r.ok && r.json.continuity) { setContinuity(r.json.error ?? "There are no questions for this yet."); return; }
    if (!r.ok) { setError(r.json.error ?? "The exam could not start just now."); return; }
    router.push(adaptiveHref(r.json.session.id));
  }

  const ready = formats.some(f => shown.includes(f)) && (scopeKind !== "documents" || chosen.length > 0) && (scopeKind !== "topic" || topic.trim().length >= 2) && (scopeKind !== "competencies" || comps.length > 0);
  return (
    <section aria-labelledby="adaptive-start-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <h2 id="adaptive-start-h" className="text-[16px] font-bold text-gray-900">Set up an adaptive exam</h2>
      <p className="mt-0.5 text-[13.5px] text-gray-600">Practice from the Competen library and your own notes. Formative: not an examination and not evidence of competence.</p>
      <RuleNote rule={props.rule} className="mt-3" />
      {props.aiNote && <p className="mt-2 text-[12.5px] text-gray-600">{props.aiNote}</p>}
      <form className="mt-4 space-y-4" onSubmit={submit}>
        <fieldset>
          <legend className="text-[13px] font-semibold text-gray-800">What it covers</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-2 text-[13.5px]">
            {props.programme && props.competencies.length > 0 && <label className="inline-flex items-center gap-1.5"><input type="radio" name="ascope" checked={scopeKind === "programme"} onChange={() => setScopeKind("programme")} />My programme’s competencies</label>}
            <label className="inline-flex items-center gap-1.5"><input type="radio" name="ascope" checked={scopeKind === "library"} onChange={() => setScopeKind("library")} />All my notes</label>
            {props.materials.length > 0 && <label className="inline-flex items-center gap-1.5"><input type="radio" name="ascope" checked={scopeKind === "documents"} onChange={() => setScopeKind("documents")} />Chosen materials</label>}
            <label className="inline-flex items-center gap-1.5"><input type="radio" name="ascope" checked={scopeKind === "topic"} onChange={() => setScopeKind("topic")} />A topic</label>
            {props.competencies.length > 0 && <label className="inline-flex items-center gap-1.5"><input type="radio" name="ascope" checked={scopeKind === "competencies"} onChange={() => setScopeKind("competencies")} />Chosen competencies</label>}
          </div>
          {scopeKind === "programme" && <p className="mt-1.5 text-[12.5px] text-gray-600">Sections of your notes you have linked, and accepted, to a competency of {props.programme}. Library questions on those competencies come first.</p>}
          {scopeKind === "documents" && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {props.materials.map(m => <li key={m.id}><label className="inline-flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={chosen.includes(m.id)} onChange={() => setChosen(c => toggle(c, m.id))} />{m.title}</label></li>)}
            </ul>
          )}
          {scopeKind === "topic" && <input aria-label="Topic" maxLength={120} value={topic} onChange={e => setTopic(e.target.value)} placeholder="For example: oxygen therapy" className={`${field} mt-2 w-full`} />}
          {scopeKind === "competencies" && (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {props.competencies.map(c => <li key={c.id}><label className="inline-flex items-center gap-1.5 text-[13.5px]"><input type="checkbox" checked={comps.includes(c.id)} onChange={() => setComps(x => toggle(x, c.id))} />{c.title}</label></li>)}
            </ul>
          )}
        </fieldset>
        <fieldset>
          <legend className="text-[13px] font-semibold text-gray-800">Question formats</legend>
          <div className="mt-1 flex flex-wrap gap-3 text-[13.5px]">
            {shown.map(f => <label key={f} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={formats.includes(f)} onChange={() => setFormats(x => toggle(x, f))} />{REVISION_FORMAT_LABEL[f]}</label>)}
          </div>
          {props.formats.includes("structured") && feedback === "end" && <p className="mt-1 text-[12px] text-gray-600">Structured questions need feedback after each answer.</p>}
        </fieldset>
        <div className="flex flex-wrap gap-4">
          <label className="text-[13px] font-semibold text-gray-800">Questions
            <input type="number" min={ADAPTIVE_LENGTH_MIN} max={props.maxLength} value={length} onChange={e => setLength(Math.max(ADAPTIVE_LENGTH_MIN, Math.min(props.maxLength, Number(e.target.value) || ADAPTIVE_LENGTH_MIN)))} className={`${field} ml-2 w-20`} />
          </label>
          <label className="text-[13px] font-semibold text-gray-800">Start at
            <select value={start} onChange={e => setStart(e.target.value as typeof start)} className={`${field} ml-2`}>
              <option value="auto">{props.levelDefault ? `Automatic: ${WORD[props.levelDefault].toLowerCase()}, from my programme level` : "Automatic"}</option>
              <option value="easy">Easier</option><option value="standard">Standard</option><option value="harder">Harder</option>
            </select>
          </label>
          <label className="text-[13px] font-semibold text-gray-800">Feedback
            <select value={feedback} onChange={e => setFeedback(e.target.value as "immediate" | "end")} className={`${field} ml-2`}>
              <option value="end">At the end, like an exam</option><option value="immediate">After each answer</option>
            </select>
          </label>
          <label className="text-[13px] font-semibold text-gray-800">Time limit
            <select value={timeLimit ?? ""} onChange={e => setTimeLimit(e.target.value ? Number(e.target.value) : null)} className={`${field} ml-2`}>
              <option value="">None</option>
              {ADAPTIVE_TIME_LIMITS.map(t => <option key={t} value={t}>{t} minutes</option>)}
            </select>
          </label>
          <label className="text-[13px] font-semibold text-gray-800">New questions from
            <select value={source} onChange={e => setSource(e.target.value as SourceMode)} className={`${field} ml-2`}>
              <option value="notes">{GROUNDING_LABEL.notes.replace(/^From y/, "Y")}</option>
              <option value="notes_and_references">{GROUNDING_LABEL.references.replace(/^From y/, "Y")}</option>
            </select>
          </label>
        </div>
        <button type="submit" className={btn} style={{ background: accent }} disabled={busy || !ready}>{busy ? "Preparing your exam…" : "Start the exam"}</button>
      </form>
      {continuity && (
        <div role="status" className="mt-3 rounded-xl border border-sky-200 bg-sky-50/60 p-4">
          <p className="text-[12px] font-bold uppercase tracking-[0.1em] text-sky-900">No questions yet</p>
          <p className="mt-1 text-[14px] text-gray-800">{continuity}</p>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error}</p>}
    </section>
  );
}

// ── ONE EXAM ──

type Current = { item: RevisionItemView; number: number; total: number; answered: number; target: GenerationDifficulty; deadline: string | null; note?: string | null; match?: string };

function remaining(deadline: string | null, now: number): string | null {
  if (!deadline) return null;
  const s = Math.max(0, Math.round((Date.parse(deadline) - now) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function AdaptiveRunner(props: { sessionId: string; title: string; feedback: "immediate" | "end"; rule: string; label: string; fallback: string | null; initial: Current | null }) {
  const router = useRouter();
  const [cur, setCur] = useState<Current | null>(props.initial);
  const [answered, setAnswered] = useState<Answered | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());

  const fired = useRef(false);

  // The reply applied in a callback (never synchronously in an effect): the next question, or the report (a refresh).
  const fetchNext = useCallback((finish = false) =>
    call("/api/individual/scholar/revision/adaptive/next", { sessionId: props.sessionId, ...(finish ? { finish: true } : {}) }).then(r => {
      setBusy(false);
      if (!r.ok) { setError(r.json.error ?? "The next question could not be shown just now."); return; }
      if (r.json.done) { router.refresh(); return; }
      setAnswered(null); setCur(r.json as Current);
    }), [props.sessionId, router]);
  const next = (finish = false) => { setBusy(true); setError(""); void fetchNext(finish); };

  // Resumed between questions: ask for the next one once.
  useEffect(() => { if (!props.initial) void fetchNext(); }, [props.initial, fetchNext]);
  const deadline = cur?.deadline ?? null;
  useEffect(() => {
    if (!deadline) return;
    const t = setInterval(() => {
      setNow(Date.now());
      // The time limit ran out: the route stops the exam and the report follows.
      if (Date.now() >= Date.parse(deadline) && !fired.current) { fired.current = true; setBusy(true); void fetchNext(); }
    }, 1000);
    return () => clearInterval(t);
  }, [deadline, fetchNext]);
  const left = remaining(deadline, now);

  return (
    <section aria-labelledby="adaptive-run-h" className="rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="adaptive-run-h" className="text-[16px] font-bold text-gray-900">{props.title}</h2>
        {cur && <p className="text-[12.5px] font-semibold text-gray-500 tabular-nums">Question {cur.number} of {cur.total}</p>}
        {cur && <div className="h-1.5 min-w-[120px] flex-1 rounded-full bg-gray-100" aria-hidden><div className="h-1.5 rounded-full" style={{ width: `${(cur.answered / Math.max(1, cur.total)) * 100}%`, background: accent }} /></div>}
        {left && <p className="text-[13px] font-semibold tabular-nums text-gray-800" aria-live="off"><span className="sr-only">Time left </span>{left}</p>}
        <Link href={studyHref("revise")} className={`text-[13px] underline ${focusRing}`}>Leave (it is kept)</Link>
      </div>
      <p className="mt-2 rounded-lg bg-gray-50 px-3 py-1.5 text-[12.5px] text-gray-700">{props.label}</p>
      {props.fallback && <p className="mt-1 text-[12px] text-gray-600">{props.fallback}</p>}
      <RuleNote rule={props.rule} className="mt-2" />
      {cur && <p className="mt-3 text-[13px] text-gray-800"><span className="font-semibold">Asked for now:</span> {WORD[cur.target]}{cur.note ? <span className="block text-[12.5px] text-gray-600">{cur.note}</span> : null}</p>}
      {cur ? (
        <QuestionRunner key={cur.item.id} item={cur.item} sessionId={props.sessionId} feedbackMode={props.feedback} answered={answered}
          onAnswered={a => setAnswered(a)} onNext={() => void next()} />
      ) : !error && <p className="mt-4 text-[14px] text-gray-600" role="status">{busy ? "Choosing your next question…" : "Loading…"}</p>}
      {answered && busy && <p role="status" className="mt-2 text-[13px] text-gray-600">Choosing your next question…</p>}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-800">{error} <button type="button" className={`underline ${focusRing}`} onClick={() => void next()}>Try again</button></p>}
      <div className="mt-5 border-t border-gray-100 pt-3">
        <button type="button" className={ghost} disabled={busy} onClick={() => { if (window.confirm("End the exam now? Questions you have not reached are left out of the report.")) void next(true); }}>End the exam and see the report</button>
      </div>
    </section>
  );
}

// ── THE REPORT ──

export type ReviewRow = { n: number; questionId: string; stem: string; feedback?: RevisionFeedback; held?: HeldGrade };

function Trajectory({ points }: { points: AdaptiveReport["trajectory"] }) {
  if (!points.length) return null;
  const w = Math.max(160, points.length * 22), h = 64, y = (d: GenerationDifficulty) => (d === "harder" ? 12 : d === "standard" ? 32 : 52);
  const x = (i: number) => 12 + i * ((w - 24) / Math.max(1, points.length - 1));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-2 h-16 w-full max-w-full" preserveAspectRatio="none" aria-hidden>
      {(["harder", "standard", "easy"] as const).map(d => <line key={d} x1={0} x2={w} y1={y(d)} y2={y(d)} stroke="currentColor" className="text-gray-200" strokeWidth={1} />)}
      <polyline fill="none" stroke={accent} strokeWidth={2} points={points.map((p, i) => `${x(i)},${y(p.asked)}`).join(" ")} />
      {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.asked)} r={4} className={p.result === "right" ? "fill-emerald-600" : p.result === "missed" ? "fill-red-600" : "fill-gray-400"} />)}
    </svg>
  );
}

function Groups({ title, groups, empty }: { title: string; groups: AdaptiveReport["byTopic"]; empty: string }) {
  return (
    <section className="rounded-xl border border-gray-200 p-4">
      <h3 className="text-[14px] font-bold text-gray-900">{title}</h3>
      {groups.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">{empty}</p> : (
        <ul className="mt-2 space-y-1.5">{groups.map(g => (
          <li key={g.key} className="flex justify-between gap-3 text-[13.5px]"><span className="min-w-0 text-gray-900">{g.label}</span>
            <span className="shrink-0 tabular-nums text-gray-700">{g.percent === null ? "Not measured" : `${g.percent}%`} <span className="text-gray-500">· {g.marked} marked</span></span></li>
        ))}</ul>
      )}
    </section>
  );
}

export function AdaptiveReportView({ report, sessionId, title, review }: { report: AdaptiveReport; sessionId: string; title: string; review: ReviewRow[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function revise(mode: "weak" | "spaced") {
    setBusy(mode); setError("");
    const r = await call("/api/individual/scholar/revision/sessions", { mode, scope: { kind: "library" } });
    setBusy("");
    if (!r.ok) { setError(r.json.error ?? "Revision could not start just now."); return; }
    if (r.json.session?.id) router.push(`${studyHref("revise")}?session=${r.json.session.id}`);
  }
  const s = report.score;
  return (
    <section aria-labelledby="adaptive-report-h" className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 sm:p-6">
      <div>
        <h2 id="adaptive-report-h" className="text-[16px] font-bold text-gray-900">{title}: your report</h2>
        <p className="mt-1 rounded-lg bg-gray-50 px-3 py-1.5 text-[12.5px] font-semibold text-gray-800">{report.label}</p>
        {report.fallback && <p className="mt-1 text-[12px] text-gray-600">{report.fallback}</p>}
        {report.stopped && <p className="mt-1 text-[13px] text-gray-700">{report.stopped}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-gray-200 p-3"><dt className="text-[12px] font-semibold text-gray-500">Practice score</dt>
          <dd className="mt-0.5 text-[20px] font-bold tabular-nums text-gray-900">{s.state === "measured" ? `${s.percent}%` : "Not measured"}</dd>
          <dd className="text-[11.5px] text-gray-600">{s.state === "measured" ? `of ${s.marked} marked answer${s.marked === 1 ? "" : "s"}` : s.reason}</dd></div>
        <div className="rounded-xl border border-gray-200 p-3"><dt className="text-[12px] font-semibold text-gray-500">Answered</dt>
          <dd className="mt-0.5 text-[20px] font-bold tabular-nums text-gray-900">{report.answered} of {report.of}</dd>
          {report.held > 0 && <dd className="text-[11.5px] text-gray-600">{report.held} waiting for your marking</dd>}</div>
        <div className="rounded-xl border border-gray-200 p-3"><dt className="text-[12px] font-semibold text-gray-500">Started at</dt>
          <dd className="mt-0.5 text-[20px] font-bold text-gray-900">{WORD[report.start.difficulty]}</dd>
          <dd className="text-[11.5px] text-gray-600">{report.start.from === "chosen" ? "your choice" : report.start.from === "programme" ? "from your programme level" : "the default"}</dd></div>
        <div className="rounded-xl border border-gray-200 p-3"><dt className="text-[12px] font-semibold text-gray-500">Ended at</dt>
          <dd className="mt-0.5 text-[20px] font-bold text-gray-900">{WORD[report.finish]}</dd>
          <dd className="text-[11.5px] text-gray-600">by the rule, not a level of ability</dd></div>
      </dl>
      <p className="text-[12.5px] text-gray-600">Questions: {report.sources.library} from the Competen library (clinically reviewed) · {report.sources.stored} of your saved questions · {report.sources.generated} written for this exam from your notes.</p>

      <section className="rounded-xl border border-gray-200 p-4">
        <h3 className="text-[14px] font-bold text-gray-900">Difficulty, question by question</h3>
        <RuleNote rule={report.rule} className="mt-2" />
        <Trajectory points={report.trajectory} />
        <ol className="mt-2 grid gap-1 text-[12.5px] text-gray-700 sm:grid-cols-2">
          {report.trajectory.map(p => (
            <li key={p.n} className="tabular-nums">{p.n}. asked {WORD[p.asked].toLowerCase()}{p.offered !== p.asked ? ` (nearest available: ${WORD[p.offered].toLowerCase()})` : ""} · {p.result === "right" ? "right" : p.result === "missed" ? "missed" : p.result === "held" ? "waiting for your marking" : "not answered"}</li>
          ))}
        </ol>
      </section>

      <div className="grid gap-3 md:grid-cols-2">
        <Groups title="By topic" groups={report.byTopic} empty="Not measured: no answer has been marked yet." />
        <Groups title="By competency" groups={report.byCompetency} empty="Not measured: none of these questions is on a section you have linked, and accepted, to a competency." />
        <Groups title="By level of thinking" groups={report.byLevel} empty="Not measured: no answer has been marked yet." />
        <Groups title="By format" groups={report.byFormat} empty="Not measured: no answer has been marked yet." />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-[14px] font-bold text-gray-900">Strengths</h3>
          {report.strengths.length ? <ul className="mt-1 list-disc pl-5 text-[13.5px] text-gray-900">{report.strengths.map(x => <li key={x}>{x}</li>)}</ul>
            : <p className="mt-1 text-[13px] text-gray-600">None yet: a strength needs at least two marked answers on it, 80% or more matching.</p>}
        </section>
        <section className="rounded-xl border border-gray-200 p-4">
          <h3 className="text-[14px] font-bold text-gray-900">Learning gaps</h3>
          {report.gaps.length === 0 ? <p className="mt-1 text-[13px] text-gray-600">No missed questions.</p> : (
            <ul className="mt-1 space-y-2">{report.gaps.map(g => (
              <li key={g.label} className="text-[13.5px] text-gray-900"><span className="font-semibold">{g.label}</span> <span className="text-gray-600">· {g.missed} missed</span>
                {g.keyPoints.length > 0 && <p className="text-[12.5px] text-gray-700"><span className="font-semibold">Key points to revisit:</span> {g.keyPoints.join("; ")}</p>}
                {g.misconceptions.length > 0 && <p className="text-[12.5px] text-gray-700"><span className="font-semibold">Common misconceptions here:</span> {g.misconceptions.join("; ")}</p>}
              </li>
            ))}</ul>
          )}
        </section>
      </div>

      {report.recommendations.length > 0 && (
        <section aria-labelledby="adaptive-rec-h" className="rounded-xl border border-gray-200 p-4">
          <h3 id="adaptive-rec-h" className="text-[14px] font-bold text-gray-900">What to revise next</h3>
          <ul className="mt-2 space-y-2">{report.recommendations.map(r => (
            <li key={r.id} className="text-[13.5px]">
              {"learnSection" in r.action ? <Link href={`${studyHref("learn")}?section=${r.action.learnSection}`} className={`font-semibold underline underline-offset-2 ${focusRing}`}>{r.title}</Link>
                : "revise" in r.action ? <button type="button" disabled={!!busy} className={`font-semibold underline underline-offset-2 ${focusRing}`} onClick={() => void revise((r.action as { revise: "weak" | "spaced" }).revise)}>{busy === r.action.revise ? "Starting…" : r.title}</button>
                  : <a href="#adaptive-review-h" className={`font-semibold underline underline-offset-2 ${focusRing}`}>{r.title}</a>}
              <span className="block text-[12.5px] text-gray-600">{r.reason}</span>
            </li>
          ))}</ul>
          {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-red-800">{error}</p>}
        </section>
      )}

      <section aria-labelledby="adaptive-review-h">
        <h3 id="adaptive-review-h" className="text-[14px] font-bold text-gray-900">Your answers</h3>
        <ol className="mt-2 space-y-3">
          {review.map(r => (
            <li key={r.questionId} className="rounded-xl border border-gray-200 p-3">
              <p className="text-[14px] font-semibold text-gray-900">{r.n}. {r.stem}</p>
              {r.feedback ? <FeedbackPanel f={r.feedback} sessionId={null} compact questionId={r.questionId} />
                : r.held ? <GradeAtEnd questionId={r.questionId} sessionId={sessionId} g={r.held} onGraded={() => router.refresh()} />
                  : <p className="text-[13px] text-gray-500">Not answered.</p>}
            </li>
          ))}
        </ol>
      </section>
      <div className="flex flex-wrap gap-2">
        <Link href={adaptiveHref()} className={ghost}>Another adaptive exam</Link>
        <Link href={studyHref("revise")} className={ghost}>Back to Revision</Link>
      </div>
    </section>
  );
}
