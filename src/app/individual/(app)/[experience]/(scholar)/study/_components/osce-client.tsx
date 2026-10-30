"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { studyHref } from "./question-view";
import { FormativeAiLabel } from "./edu-notice";
import {
  DEFAULT_OSCE_SECTIONS, OSCE_MARKS, OSCE_MARK_LABEL, OSCE_PRACTICE_LABEL, formatClock, timerAnnouncement, timerState,
  type OsceMark, type OsceRemedy,
} from "@/lib/individual/scholar/osce";
import type { OsceStationView } from "@/lib/individual/scholar/osce-service";

// OSCE PRACTICE -- SCHOLAR-PRACTICE-EXAMS-01 (720), the learner's side. Create a station (template, competency, or from
// notes), then run it: brief, timer, written responses under the station's headings, then the self-check against the
// checklist with optional AI feedback whose suggested ticks the learner confirms. Simulated practice only: every step
// says so (OSCE_PRACTICE_LABEL). One column below md (CPR-MOB-001); touch targets grow on coarse pointers. The timer is
// announced politely and rarely (halfway, one minute, time up), never every second.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const field = `w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const card = "rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4 sm:p-5";

async function call(url: string, body?: unknown, method = "POST"): Promise<{ ok: boolean; status: number; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}
export const osceHref = (stationId?: string) => studyHref(stationId ? `apply/osce/${stationId}` : "apply/osce");
const remedyHref = (r: OsceRemedy) => { const q = new URLSearchParams(r.query).toString(); return `${studyHref(r.segment)}${q ? `?${q}` : ""}`; };

export function OsceLabel() {
  return <p className="text-[12.5px] font-semibold text-[var(--cmp-app-text-secondary)]">{OSCE_PRACTICE_LABEL}</p>;
}

// ── CREATE A STATION ──

type Source = "template" | "competency" | "ai";
export function OsceCreate(props: {
  templates: { key: string; title: string }[]; competencies: { id: string; title: string; status: string }[];
  materials: { id: string; title: string }[]; aiNote: string | null; competencyNote: string | null;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>("template");
  const [template, setTemplate] = useState(props.templates[0]?.key ?? "");
  const [competency, setCompetency] = useState(props.competencies[0]?.id ?? "");
  const [material, setMaterial] = useState(props.materials[0]?.id ?? "");
  const [headings, setHeadings] = useState(DEFAULT_OSCE_SECTIONS.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function create() {
    setBusy(true); setError("");
    const sections = headings.split("\n");
    const body = source === "template" ? { source, templateKey: template, sections }
      : source === "competency" ? { source, competencyId: competency, sections } : { source, materialId: material, sections };
    const r = await call("/api/individual/scholar/osce/stations", body);
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The station could not be made."); return; }
    router.push(osceHref(r.json.id));
  }
  const choices: { v: Source; label: string; note: string | null; disabled: boolean }[] = [
    { v: "template", label: "Practice template", note: "Competen practice template, not clinically reviewed. No AI.", disabled: !props.templates.length },
    { v: "competency", label: "From a competency", note: props.competencyNote ?? "Checklist built from the competency's learning outcomes. No AI.", disabled: !props.competencies.length },
    { v: "ai", label: "Generate from my notes", note: props.aiNote ?? "Written by AI from one of your materials, each item checked against your notes.", disabled: !props.materials.length || !!props.aiNote },
  ];
  const ready = source === "template" ? !!template : source === "competency" ? !!competency : !!material && !props.aiNote;
  return (
    <section aria-labelledby="osce-new-h" className={card}>
      <h2 id="osce-new-h" className="text-[16px] font-bold text-gray-900">New practice station</h2>
      <fieldset className="mt-3">
        <legend className="text-[13px] font-semibold text-gray-800">Where the station comes from</legend>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          {choices.map(c => (
            <label key={c.v} className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-[13.5px] ${source === c.v ? "border-gray-900" : "border-gray-200"} ${c.disabled ? "opacity-60" : ""}`}>
              <input type="radio" name="osce-source" value={c.v} checked={source === c.v} onChange={() => setSource(c.v)} className={`mt-1 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
              <span><span className="block font-semibold text-gray-900">{c.label}</span><span className="block text-[12.5px] text-gray-600">{c.note}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        {source === "template" && (
          <label className="block text-[13px] font-semibold text-gray-800">Template
            <select value={template} onChange={e => setTemplate(e.target.value)} className={`mt-1 ${field}`}>
              {props.templates.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
            </select>
          </label>
        )}
        {source === "competency" && (props.competencies.length ? (
          <label className="block text-[13px] font-semibold text-gray-800">Competency
            <select value={competency} onChange={e => setCompetency(e.target.value)} className={`mt-1 ${field}`}>
              {props.competencies.map(c => <option key={c.id} value={c.id}>{c.title} ({c.status})</option>)}
            </select>
          </label>
        ) : <p className="text-[13.5px] text-gray-600">{props.competencyNote ?? "No competency is available to build from."}</p>)}
        {source === "ai" && (props.materials.length ? (
          <label className="block text-[13px] font-semibold text-gray-800">Material
            <select value={material} onChange={e => setMaterial(e.target.value)} className={`mt-1 ${field}`} disabled={!!props.aiNote}>
              {props.materials.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
            </select>
          </label>
        ) : <p className="text-[13.5px] text-gray-600">Upload your notes first: a station is written from them.</p>)}
      </div>
      <details className="mt-3">
        <summary className={`cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Response headings</summary>
        <label className="mt-2 block text-[12.5px] text-gray-600">One per line, up to six. You write under each during the station.
          <textarea value={headings} onChange={e => setHeadings(e.target.value)} rows={4} className={`mt-1 ${field}`} />
        </label>
      </details>
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-700">{error}</p>}
      <button type="button" onClick={create} disabled={busy || !ready} className={`mt-4 ${btn}`} style={{ background: accent }}>{busy ? "Preparing…" : "Make the station"}</button>
    </section>
  );
}

// ── RUN A STATION ──

type Phase = "brief" | "running" | "check" | "done";
type Feedback = { parts: { right: string[]; missing: string[]; misconceptions: string[]; why: string | null; next: string | null }; suggested: { itemId: string; mark: OsceMark }[] };
type Result = { summary: string; criticalMissedIds: string[]; marking: string; remediation: OsceRemedy[] };

export function OsceRunner({ station, aiNote, pending }: { station: OsceStationView; aiNote: string | null; pending: { attemptId: string; timeUp: boolean } | null }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>(pending ? "check" : "brief");
  const [attemptId, setAttemptId] = useState(pending?.attemptId ?? "");
  const [startMs, setStartMs] = useState(0);
  const [now, setNow] = useState(0);
  const [responses, setResponses] = useState<Record<string, string>>({});
  const [timeUp, setTimeUp] = useState(pending?.timeUp ?? false);
  const [announce, setAnnounce] = useState("");
  const [ticks, setTicks] = useState<Record<string, OsceMark>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [useAi, setUseAi] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const prev = useRef(station.durationMinutes * 60);
  const finishing = useRef(false);

  const t = phase === "running" ? timerState(startMs, station.durationMinutes, now) : null;

  async function start() {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/osce/attempts", { stationId: station.id });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The station could not be started."); return; }
    // The server's start, on this device's clock: the offset between the two is taken once, here.
    const offset = Date.now() - Date.parse(r.json.serverNow);
    setStartMs(Date.parse(r.json.startedAt) + offset);
    setNow(Date.now());
    prev.current = station.durationMinutes * 60;
    setAttemptId(r.json.attemptId); setResponses({}); setTimeUp(false); setAnnounce(""); setPhase("running");
  }

  async function finish(byTimer: boolean) {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true); setError("");
    const r = await call(`/api/individual/scholar/osce/attempts/${attemptId}`, { action: "finish", responses, timeUp: byTimer });
    setBusy(false);
    finishing.current = false;
    if (!r.ok) { setError(r.json.error ?? "What you wrote could not be saved."); return; }
    setTimeUp(!!r.json.timeUp); setPhase("check");
  }

  useEffect(() => {
    if (phase !== "running") return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [phase]);

  useEffect(() => {
    if (!t) return;
    const said = timerAnnouncement(prev.current, t.remainingSeconds, station.durationMinutes);
    prev.current = t.remainingSeconds;
    if (said) setAnnounce(said);
    if (t.timeUp) void finish(true);
  }, [t?.remainingSeconds]); // eslint-disable-line react-hooks/exhaustive-deps

  async function askFeedback() {
    setBusy(true); setError("");
    const r = await call(`/api/individual/scholar/osce/attempts/${attemptId}`, { action: "feedback" });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "AI feedback is not available. Mark each item yourself."); return; }
    const f = r.json.feedback as Feedback;
    setFeedback(f); setUseAi(true);
    // Suggested ticks fill only items not marked yet: the learner's own marks are never overwritten.
    setTicks(cur => { const next = { ...cur }; for (const s of f.suggested ?? []) if (!next[s.itemId]) next[s.itemId] = s.mark; return next; });
  }

  async function mark() {
    setBusy(true); setError("");
    const r = await call(`/api/individual/scholar/osce/attempts/${attemptId}`, { action: "mark", useAi: useAi && !!feedback, ticks: station.checklist.map(i => ({ itemId: i.id, mark: ticks[i.id] })) });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your marks could not be saved."); return; }
    setResult({ summary: r.json.summary, criticalMissedIds: r.json.criticalMissedIds ?? [], marking: r.json.marking, remediation: r.json.remediation ?? [] });
    setPhase("done");
    router.refresh();
  }

  const unmarked = station.checklist.filter(i => !ticks[i.id]).length;
  const suggestedOf = (id: string) => feedback?.suggested.find(s => s.itemId === id)?.mark ?? null;

  return (
    <section aria-labelledby="osce-run-h" className={card}>
      <h2 id="osce-run-h" className="text-[16px] font-bold text-gray-900">
        {phase === "brief" ? "The station" : phase === "running" ? "In the station" : phase === "check" ? "Check yourself against the checklist" : "Your practice result"}
      </h2>
      <OsceLabel />
      <p aria-live="polite" className="sr-only">{announce}</p>

      {phase === "brief" && (
        <div className="mt-3 space-y-3 text-[14px] leading-relaxed text-gray-800">
          <p><span className="font-semibold">Scenario. </span>{station.scenario}</p>
          <p><span className="font-semibold">Your task. </span>{station.candidateInstructions}</p>
          <p className="text-[13px] text-gray-600">{station.durationMinutes} minutes. You write under: {station.sections.join(", ")}. The checklist is shown after the station, as in an OSCE.</p>
          <button type="button" onClick={start} disabled={busy} className={btn} style={{ background: accent }}>{busy ? "Starting…" : "Start the station"}</button>
        </div>
      )}

      {phase === "running" && t && (
        <div className="mt-3 space-y-4">
          <div className={`sticky top-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2 ${t.warning ? "border-amber-500 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
            <p className="text-[14px] font-semibold text-gray-900">
              <span className="sr-only">Time left: </span><span className="tabular-nums text-[20px]" aria-hidden="true">{formatClock(t.remainingSeconds)}</span>
              <span className="sr-only">{Math.ceil(t.remainingSeconds / 60)} minutes</span>
              {t.warning && <span className="ml-2 text-[13px] text-amber-800">One minute left</span>}
            </p>
            <button type="button" onClick={() => finish(false)} disabled={busy} className={ghost}>Finish now</button>
          </div>
          <details className="text-[13.5px] text-gray-700"><summary className={`cursor-pointer font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>The scenario again</summary><p className="mt-1">{station.scenario}</p><p className="mt-1">{station.candidateInstructions}</p></details>
          {station.sections.map((s, i) => (
            <label key={s} className="block text-[13.5px] font-semibold text-gray-900">{s}
              <textarea value={responses[s] ?? ""} onChange={e => setResponses(r => ({ ...r, [s]: e.target.value }))} rows={i === 1 ? 6 : 4} maxLength={4000}
                className={`mt-1 ${field} font-normal`} placeholder="What you would say and do" />
            </label>
          ))}
          <p className="text-[12.5px] text-gray-600">Do not write anything that could identify a real person.</p>
        </div>
      )}

      {phase === "check" && (
        <div className="mt-3 space-y-4">
          {timeUp && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-[14px] font-semibold text-amber-900">Time is up. What you wrote has been kept.</p>}
          <p className="text-[13.5px] text-gray-700">Mark each item done, partly or missed, honestly, from what you wrote. Critical items are marked as such.</p>
          {aiNote ? <p className="text-[13px] text-gray-600">{aiNote}</p> : !feedback && (
            <button type="button" onClick={askFeedback} disabled={busy} className={ghost}>{busy ? "Reading…" : "Ask for AI feedback on what I wrote"}</button>
          )}
          {feedback && (
            <div className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3 text-[13.5px] text-gray-800">
              <FormativeAiLabel evaluation />
              {feedback.parts.right.length > 0 && <p className="mt-1"><span className="font-semibold">What went well: </span>{feedback.parts.right.join("; ")}</p>}
              {feedback.parts.missing.length > 0 && <p className="mt-1"><span className="font-semibold">Missed: </span>{feedback.parts.missing.join("; ")}</p>}
              {feedback.parts.misconceptions.length > 0 && <p className="mt-1"><span className="font-semibold">Check your understanding: </span>{feedback.parts.misconceptions.join("; ")}</p>}
              {feedback.parts.why && <p className="mt-1"><span className="font-semibold">Why it matters: </span>{feedback.parts.why}</p>}
              {feedback.parts.next && <p className="mt-1"><span className="font-semibold">Practise next: </span>{feedback.parts.next}</p>}
              <p className="mt-2 text-[12.5px] text-gray-600">The AI&rsquo;s suggested marks are filled in below. Change any you disagree with: your marks are what count.</p>
            </div>
          )}
          <ol className="space-y-3">
            {station.checklist.map((item, n) => (
              <li key={item.id} className="rounded-xl border border-gray-200 p-3">
                <fieldset>
                  <legend className="text-[14px] text-gray-900">
                    <span className="font-semibold">{n + 1}. {item.text}</span>
                    {item.critical && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-red-800">Critical</span>}
                  </legend>
                  {item.quote && <p className="mt-1 text-[12.5px] text-gray-600">From your notes: &ldquo;{item.quote}&rdquo;</p>}
                  {suggestedOf(item.id) && <p className="mt-1 text-[12.5px] text-gray-600">AI suggested: {OSCE_MARK_LABEL[suggestedOf(item.id)!]}</p>}
                  <div className="mt-2 flex flex-wrap gap-2">
                    {OSCE_MARKS.map(m => (
                      <label key={m} className={`inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-[13.5px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${ticks[item.id] === m ? "border-gray-900 bg-gray-50 font-semibold" : "border-gray-300"}`}>
                        <input type="radio" name={`tick-${item.id}`} value={m} checked={ticks[item.id] === m} onChange={() => setTicks(cur => ({ ...cur, [item.id]: m }))} className={focusRing} />
                        {OSCE_MARK_LABEL[m]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
          <button type="button" onClick={mark} disabled={busy || unmarked > 0} className={btn} style={{ background: accent }}>
            {unmarked > 0 ? `Mark every item (${unmarked} left)` : busy ? "Saving…" : "Save my marks"}
          </button>
        </div>
      )}

      {phase === "done" && result && (
        <div className="mt-3 space-y-3 text-[14px] text-gray-800">
          <p className="text-[16px] font-bold text-gray-900">{result.summary}</p>
          <p className="text-[12.5px] text-gray-600">{result.marking === "ai_evaluation" ? "Your marks, with AI-suggested marks you confirmed. Not verified." : "Your own marks."} A practice score, not a pass or a fail.</p>
          {result.criticalMissedIds.length > 0 && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="font-semibold text-red-900">Critical items missed</p>
              <ul className="mt-1 list-disc pl-5">{result.criticalMissedIds.map(id => <li key={id}>{station.checklist.find(i => i.id === id)?.text}</li>)}</ul>
            </div>
          )}
          {result.remediation.length > 0 && (
            <div>
              <p className="font-semibold text-gray-900">What to do next</p>
              <ul className="mt-1 space-y-1">{result.remediation.map(r => <li key={r.label}><Link href={remedyHref(r)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>{r.label}</Link></li>)}</ul>
            </div>
          )}
          <button type="button" onClick={() => { setPhase("brief"); setTicks({}); setFeedback(null); setUseAi(false); setResult(null); }} className={ghost}>Practise this station again</button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-700">{error}</p>}
    </section>
  );
}

export function DeleteStation({ stationId }: { stationId: string }) {
  const router = useRouter();
  const [sure, setSure] = useState(false);
  const [error, setError] = useState("");
  async function remove() {
    const r = await call(`/api/individual/scholar/osce/stations/${stationId}`, undefined, "DELETE");
    if (!r.ok) { setError(r.json.error ?? "The station could not be deleted."); return; }
    router.push(osceHref());
  }
  return (
    <div className="mt-2">
      {sure ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px]">
          <span>Delete this station and every run of it?</span>
          <button type="button" onClick={remove} className={ghost}>Delete</button>
          <button type="button" onClick={() => setSure(false)} className={ghost}>Keep it</button>
        </span>
      ) : <button type="button" onClick={() => setSure(true)} className={`text-[13px] font-semibold text-gray-700 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Delete this station</button>}
      {error && <p role="alert" className="mt-1 text-[13px] font-semibold text-red-700">{error}</p>}
    </div>
  );
}
