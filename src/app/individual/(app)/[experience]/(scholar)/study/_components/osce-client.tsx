"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import type { RecoveryMode } from "@/lib/individual/policy";
import { studyHref } from "./question-view";
import { FormativeAiLabel } from "./edu-notice";
import { RecoveryFlow, type RecoveryRequestBody } from "./evidence-recovery";
import {
  DEFAULT_OSCE_SECTIONS, LIBRARY_STATION_LABEL, OSCE_AUTOSAVE, OSCE_DIFFICULTY_LABEL, OSCE_FEEDBACK_LABEL, OSCE_FEEDBACK_PARTS, OSCE_GUIDELINES_NOTE, OSCE_MARKS, OSCE_MARK_LABEL,
  OSCE_PRACTICE_LABEL, formatClock, readFeedbackParts, timerAnnouncement, timerState,
  type OsceFeedbackParts, type OsceGap, type OsceGuidance, type OsceMark, type OsceRemedy, type OsceResult,
} from "@/lib/individual/scholar/osce";
import type { OsceStationView } from "@/lib/individual/scholar/osce-service";

// OSCE PRACTICE -- SCHOLAR-PRACTICE-EXAMS-01 (720) and SCHOLAR-OSCE-01 (721), the learner's side. Create a station (the
// Competen station library, a practice template, a competency, or from notes), then run it in a focused workspace: the
// brief, a timer and the answer fields. Written work is autosaved to the server while the timer runs (debounced), and a
// run left by navigation or a reload is resumed with the server's clock. Then the self-check against the checklist, with
// optional AI feedback whose suggested marks the learner confirms, and the result: critical items missed first and apart,
// how the score is made, strengths, gaps, guidance and where to go next. Simulated practice only: every step says so.
// One md breakpoint (CPR-MOB-001); touch targets grow on coarse pointers. Critical items carry a word and a symbol, never
// colour alone. The timer is announced politely and rarely (halfway, one minute, time up), never every second.

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const field = `w-full rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;
const card = "rounded-2xl border border-[var(--cmp-app-border)] bg-white p-4 md:p-5";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
async function call(url: string, body?: unknown, method = "POST", keepalive = false): Promise<{ ok: boolean; status: number; json: Json }> {
  try {
    const res = await fetch(url, { method, keepalive, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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

/** A critical item's marker: a symbol and a word, so it never rests on colour alone. */
export function CriticalTag() {
  return <span className="ml-2 inline-flex items-center gap-1 rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-[11.5px] font-bold uppercase tracking-wide text-red-900"><span aria-hidden="true">▲</span>Critical</span>;
}

// ── CREATE A STATION ──

type Source = "library" | "template" | "competency" | "ai";
export type LibraryChoice = { versionId: string; title: string; detail: string };
export function OsceCreate(props: {
  library: LibraryChoice[]; templates: { key: string; title: string }[]; competencies: { id: string; title: string; status: string }[];
  materials: { id: string; title: string }[]; aiNote: string | null; competencyNote: string | null; recoveryMode: RecoveryMode;
}) {
  const router = useRouter();
  const [source, setSource] = useState<Source>(props.library.length ? "library" : "template");
  const [libraryPick, setLibraryPick] = useState(props.library[0]?.versionId ?? "");
  const [template, setTemplate] = useState(props.templates[0]?.key ?? "");
  const [competency, setCompetency] = useState(props.competencies[0]?.id ?? "");
  const [material, setMaterial] = useState(props.materials[0]?.id ?? "");
  const [headings, setHeadings] = useState(DEFAULT_OSCE_SECTIONS.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{ key: number; body: RecoveryRequestBody; note: string } | null>(null);

  async function create() {
    setBusy(true); setError(""); setRecovery(null);
    const sections = headings.split("\n");
    const body = source === "library" ? { source, versionId: libraryPick } : source === "template" ? { source, templateKey: template, sections }
      : source === "competency" ? { source, competencyId: competency, sections } : { source, materialId: material, sections };
    const r = await call("/api/individual/scholar/osce/stations", body);
    setBusy(false);
    if (!r.ok) {
      setError(r.json.error ?? "The station could not be made.");
      // Notes too thin, or the station was withheld: offer the evidence-recovery workflow (reading only, no new AI).
      if (r.json.recovery?.question) setRecovery({ key: Date.now(), note: r.json.recoveryNote ?? "", body: { ...r.json.recovery, mode: props.recoveryMode } });
      return;
    }
    router.push(osceHref(r.json.id));
  }
  const choices: { v: Source; label: string; note: string | null; disabled: boolean }[] = [
    { v: "library", label: LIBRARY_STATION_LABEL, note: props.library.length ? "Published stations, clinically reviewed and approved. No AI." : "No clinically approved station has been published yet.", disabled: !props.library.length },
    { v: "template", label: "Practice template", note: "Competen practice template, not clinically reviewed. No AI.", disabled: !props.templates.length },
    { v: "competency", label: "From a competency", note: props.competencyNote ?? "Checklist built from the competency's learning outcomes. Its content status is shown. No AI.", disabled: !props.competencies.length },
    { v: "ai", label: "Generate from my notes", note: props.aiNote ?? "Written by AI from one of your materials, each item checked against your notes.", disabled: !props.materials.length || !!props.aiNote },
  ];
  const ready = source === "library" ? !!libraryPick : source === "template" ? !!template : source === "competency" ? !!competency : !!material && !props.aiNote;
  return (
    <section aria-labelledby="osce-new-h" className={card}>
      <h2 id="osce-new-h" className="text-[16px] font-bold text-gray-900">New practice station</h2>
      <fieldset className="mt-3">
        <legend className="text-[13px] font-semibold text-gray-800">Where the station comes from</legend>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {choices.map(c => (
            <label key={c.v} className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-[13.5px] ${source === c.v ? "border-gray-900" : "border-gray-200"} ${c.disabled ? "opacity-60" : ""}`}>
              <input type="radio" name="osce-source" value={c.v} checked={source === c.v} onChange={() => setSource(c.v)} className={`mt-1 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
              <span><span className="block font-semibold text-gray-900">{c.label}</span><span className="block text-[12.5px] text-gray-600">{c.note}</span></span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="mt-3">
        {source === "library" && (props.library.length ? (
          <label className="block text-[13px] font-semibold text-gray-800">Station
            <select value={libraryPick} onChange={e => setLibraryPick(e.target.value)} className={`mt-1 ${field}`}>
              {props.library.map(l => <option key={l.versionId} value={l.versionId}>{l.title} ({l.detail})</option>)}
            </select>
          </label>
        ) : <p className="text-[13.5px] text-gray-600">No clinically approved station has been published yet. Use a practice template, a competency or your notes.</p>)}
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
      {source !== "library" && (
        <details className="mt-3">
          <summary className={`cursor-pointer text-[13px] font-semibold text-gray-800 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Response headings</summary>
          <label className="mt-2 block text-[12.5px] text-gray-600">One per line, up to six. You write under each during the station.
            <textarea value={headings} onChange={e => setHeadings(e.target.value)} rows={4} className={`mt-1 ${field}`} />
          </label>
        </details>
      )}
      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-700">{error}</p>}
      {recovery && (
        <div className="mt-3">
          {recovery.note && <p className="text-[13px] text-gray-700">{recovery.note}</p>}
          <RecoveryFlow key={recovery.key} request={recovery.body} onDismiss={() => setRecovery(null)} />
        </div>
      )}
      <button type="button" onClick={create} disabled={busy || !ready} className={`mt-4 ${btn}`} style={{ background: accent }}>{busy ? "Preparing…" : "Make the station"}</button>
    </section>
  );
}

// ── RUN A STATION ──

type Phase = "brief" | "running" | "check" | "done";
type Feedback = { parts: OsceFeedbackParts; suggested: { itemId: string; mark: OsceMark }[] };
type Compared = { itemId: string; text: string; critical: boolean; yours: OsceMark | null; suggested: OsceMark | null };
export type OsceResultView = {
  summary: string; explanation: string[]; marking: string; remediation: OsceRemedy[]; result: OsceResult; marks: Compared[];
  guidance: OsceGuidance | null; expectedActivities: string[]; version: number; feedback?: OsceFeedbackParts | null;
};
type SaveState = { state: "idle" | "saving" | "saved" | "failed"; at: string | null; note?: string };

export function OsceRunner({ station, aiNote, pending, hasOpenRun }: {
  station: OsceStationView; aiNote: string | null; pending: { attemptId: string; timeUp: boolean } | null; hasOpenRun: boolean;
}) {
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
  const [result, setResult] = useState<OsceResultView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [resumed, setResumed] = useState(false);
  const [save, setSave] = useState<SaveState>({ state: "idle", at: null });
  const prev = useRef(station.durationMinutes * 60);
  const finishing = useRef(false);
  const dirty = useRef(false);
  const latest = useRef<Record<string, string>>({});
  const tried = useRef(false);

  const t = phase === "running" ? timerState(startMs, station.durationMinutes, now) : null;
  const url = `/api/individual/scholar/osce/attempts/${attemptId}`;

  const start = useCallback(async () => {
    setBusy(true); setError("");
    const r = await call("/api/individual/scholar/osce/attempts", { stationId: station.id });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The station could not be started."); return; }
    setAttemptId(r.json.attemptId);
    setResumed(!!r.json.resumed);
    const kept = (r.json.responses ?? {}) as Record<string, string>;
    setResponses(kept); latest.current = kept; dirty.current = false;
    if (r.json.finished) { setTimeUp(!!r.json.timeUp); setPhase("check"); return; }
    // The server's start, on this device's clock: the offset between the two is taken once, here.
    const offset = Date.now() - Date.parse(r.json.serverNow);
    const s = Date.parse(r.json.startedAt) + offset;
    setStartMs(s); setNow(Date.now());
    prev.current = timerState(s, station.durationMinutes, Date.now()).remainingSeconds;
    setSave({ state: r.json.lastSavedAt ? "saved" : "idle", at: r.json.lastSavedAt ?? null });
    setTimeUp(false); setAnnounce(r.json.resumed ? "Your run was resumed. The timer kept running while you were away." : ""); setPhase("running");
  }, [station.id, station.durationMinutes]);

  // A run left open (navigation, a reload, a dropped connection) is picked up straight away, on the server's clock.
  useEffect(() => {
    if (hasOpenRun && !pending && !tried.current) { tried.current = true; void start(); }
  }, [hasOpenRun, pending, start]);

  const saveNow = useCallback(async (keepalive = false) => {
    if (!attemptId || !dirty.current) return;
    dirty.current = false;
    setSave(s => ({ ...s, state: "saving" }));
    const r = await call(url, { action: "save", responses: latest.current }, "POST", keepalive);
    if (r.ok) { setSave({ state: "saved", at: r.json.savedAt ?? new Date().toISOString() }); return; }
    if (r.json.closed) { setTimeUp(!!r.json.timeUp); setPhase("check"); return; }
    dirty.current = true;
    setSave(s => ({ state: "failed", at: s.at, note: r.json.error ?? "Not saved just now. Keep writing: it will try again." }));
  }, [attemptId, url]);

  // Autosave: shortly after typing stops, on a slow heartbeat while there are unsaved changes, and when the page is hidden.
  useEffect(() => {
    if (phase !== "running") return;
    const id = setTimeout(() => void saveNow(), OSCE_AUTOSAVE.debounceMs);
    return () => clearTimeout(id);
  }, [responses, phase, saveNow]);
  useEffect(() => {
    if (phase !== "running") return;
    const beat = setInterval(() => void saveNow(), OSCE_AUTOSAVE.heartbeatMs);
    const hide = () => { if (document.visibilityState === "hidden") void saveNow(true); };
    const leave = () => void saveNow(true);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", leave);
    return () => { clearInterval(beat); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", leave); };
  }, [phase, saveNow]);

  function write(section: string, value: string) {
    setResponses(r => { const next = { ...r, [section]: value }; latest.current = next; return next; });
    dirty.current = true;
  }

  async function finish(byTimer: boolean) {
    if (finishing.current) return;
    finishing.current = true;
    setBusy(true); setError("");
    const r = await call(url, { action: "finish", responses: latest.current, timeUp: byTimer });
    setBusy(false);
    finishing.current = false;
    if (!r.ok) { setError(r.json.error ?? "What you wrote could not be saved."); return; }
    dirty.current = false;
    setTimeUp(!!r.json.timeUp); setPhase("check");
  }

  async function abandon() {
    setBusy(true); setError("");
    const r = await call(url, { action: "abandon" });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "The run could not be closed."); return; }
    setPhase("brief"); setResponses({}); latest.current = {}; dirty.current = false; setResumed(false);
    router.refresh();
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
    const r = await call(url, { action: "feedback" });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "AI feedback is not available. Mark each item yourself."); return; }
    const parts = readFeedbackParts(r.json.feedback?.parts);
    if (!parts) { setError("AI feedback could not be read. Mark each item yourself."); return; }
    const f: Feedback = { parts, suggested: r.json.feedback?.suggested ?? [] };
    setFeedback(f); setUseAi(true);
    // Suggested marks fill only items not marked yet: the learner's own marks are never overwritten.
    setTicks(cur => { const next = { ...cur }; for (const s of f.suggested) if (!next[s.itemId]) next[s.itemId] = s.mark; return next; });
  }

  async function mark() {
    setBusy(true); setError("");
    const r = await call(url, { action: "mark", useAi: useAi && !!feedback, ticks: station.checklist.map(i => ({ itemId: i.id, mark: ticks[i.id] })) });
    setBusy(false);
    if (!r.ok) { setError(r.json.error ?? "Your marks could not be saved."); return; }
    setResult({ ...(r.json as OsceResultView), feedback: feedback?.parts ?? null });
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
          {station.objectives.length > 0 && (
            <div><p className="font-semibold">What this station practises</p><ul className="mt-1 list-disc pl-5">{station.objectives.map(o => <li key={o}>{o}</li>)}</ul></div>
          )}
          <p><span className="font-semibold">Scenario. </span>{station.scenario}</p>
          <p><span className="font-semibold">Your task. </span>{station.candidateInstructions}</p>
          <p className="text-[13px] text-gray-600">{station.durationMinutes} minutes. You write under: {station.sections.join(", ")}. Your writing is saved as you go. The checklist and the guidance are shown after the station, as in an OSCE.</p>
          <button type="button" onClick={start} disabled={busy} className={btn} style={{ background: accent }}>{busy ? (hasOpenRun ? "Resuming…" : "Starting…") : hasOpenRun ? "Resume my run" : "Start the station"}</button>
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
            <span className="text-[12.5px] text-gray-600">
              {save.state === "saving" ? "Saving…" : save.state === "failed" ? "Not saved yet, retrying" : save.at ? `Saved ${new Date(save.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : "Saved as you write"}
            </span>
            <button type="button" onClick={() => finish(false)} disabled={busy} className={ghost}>Finish now</button>
          </div>
          {resumed && <p role="status" className="rounded-xl bg-gray-50 px-3 py-2 text-[13.5px] text-gray-800">Your run was resumed with what you had written. The timer kept running while you were away.</p>}
          {save.state === "failed" && save.note && <p role="status" className="text-[13px] font-semibold text-amber-900">{save.note}</p>}
          <details className="text-[13.5px] text-gray-700"><summary className={`cursor-pointer font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>The scenario again</summary><p className="mt-1">{station.scenario}</p><p className="mt-1">{station.candidateInstructions}</p></details>
          {station.sections.map((s, i) => (
            <label key={s} className="block text-[13.5px] font-semibold text-gray-900">{s}
              <textarea value={responses[s] ?? ""} onChange={e => write(s, e.target.value)} rows={i === 1 ? 6 : 4} maxLength={4000}
                className={`mt-1 ${field} font-normal`} placeholder="What you would say and do" />
            </label>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-gray-600">Do not write anything that could identify a real person.</p>
            <button type="button" onClick={abandon} disabled={busy} className={`text-[13px] font-semibold text-gray-700 underline underline-offset-2 pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Discard this run</button>
          </div>
        </div>
      )}

      {phase === "check" && (
        <div className="mt-3 space-y-4">
          {timeUp && <p role="status" className="rounded-xl bg-amber-50 px-3 py-2 text-[14px] font-semibold text-amber-900">Time is up. What you wrote has been kept.</p>}
          <p className="text-[13.5px] text-gray-700">Mark each item done, partly or missed, honestly, from what you wrote. Critical items are marked <span className="font-semibold">▲ Critical</span>.</p>
          {aiNote ? <p className="text-[13px] text-gray-600">{aiNote}</p> : !feedback && (
            <button type="button" onClick={askFeedback} disabled={busy} className={ghost}>{busy ? "Reading…" : "Ask for AI feedback on what I wrote"}</button>
          )}
          {feedback && <FeedbackPanel parts={feedback.parts} />}
          <ol className="space-y-3">
            {station.checklist.map((item, n) => (
              <li key={item.id} className={`rounded-xl border p-3 ${item.critical ? "border-l-4 border-red-300 border-l-red-700" : "border-gray-200"}`}>
                <fieldset>
                  <legend className="text-[14px] text-gray-900">
                    <span className="font-semibold">{n + 1}. {item.text}</span>
                    {item.critical && <CriticalTag />}
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
        <div className="mt-3 space-y-4">
          <ResultView r={result} />
          <button type="button" onClick={() => { setPhase("brief"); setTicks({}); setFeedback(null); setUseAi(false); setResult(null); setResumed(false); }} className={ghost}>Practise this station again</button>
        </div>
      )}

      {error && <p role="alert" className="mt-3 text-[13.5px] font-semibold text-red-700">{error}</p>}
    </section>
  );
}

/** The AI feedback in its six parts, labelled as suggestions, beside (never instead of) the learner's own marks. */
export function FeedbackPanel({ parts }: { parts: OsceFeedbackParts }) {
  const shown = OSCE_FEEDBACK_PARTS.filter(k => parts[k].length);
  return (
    <div className="rounded-xl border border-[var(--cmp-app-border)] bg-[var(--cmp-app-surface)] p-3 text-[13.5px] text-gray-800">
      <FormativeAiLabel evaluation />
      <p className="mt-1 text-[12.5px] font-semibold text-gray-700">AI-suggested feedback, from what you wrote and this station only</p>
      {shown.length === 0 ? <p className="mt-1">The feedback had nothing to add.</p> : shown.map(k => (
        <div key={k} className="mt-2">
          <p className="font-semibold">{k === "safety" && <span aria-hidden="true">▲ </span>}{OSCE_FEEDBACK_LABEL[k]}</p>
          <ul className="list-disc pl-5">{parts[k].map(x => <li key={x}>{x}</li>)}</ul>
        </div>
      ))}
      <p className="mt-2 text-[12.5px] text-gray-600">The AI&rsquo;s suggested marks are filled in where you had not marked yet. Change any you disagree with: your marks are what count. {OSCE_GUIDELINES_NOTE}</p>
    </div>
  );
}

const gapLine = (g: OsceGap) => `${g.text} (${g.mark === "missed" ? "missed" : "partly"})`;

/** A marked run: critical misses FIRST and apart, then the score and how it is made, strengths, gaps, guidance, next steps. */
export function ResultView({ r }: { r: OsceResultView }) {
  const otherGaps = r.result.gaps.filter(g => !(g.critical && g.mark === "missed"));
  const anyAi = r.marks.some(m => m.suggested);
  return (
    <div className="space-y-4 text-[14px] text-gray-800">
      {r.result.criticalMissed.length > 0 ? (
        <div role="status" className="rounded-xl border-2 border-red-700 bg-red-50 p-3">
          <p className="text-[15px] font-bold text-red-900"><span aria-hidden="true">▲ </span>Critical items missed: {r.result.criticalMissed.length}</p>
          <p className="text-[12.5px] text-red-900">Shown first, whatever the score: a high score does not cancel a missed critical item.</p>
          <ul className="mt-1 list-disc pl-5">{r.result.criticalMissed.map(g => <li key={g.itemId}>{g.text}</li>)}</ul>
        </div>
      ) : <p className="rounded-xl border border-gray-300 bg-gray-50 p-3 font-semibold text-gray-900">No critical item missed{r.result.criticalPartly.length ? ` (${r.result.criticalPartly.length} partly done)` : ""}.</p>}

      <div>
        <p className="text-[16px] font-bold text-gray-900">{r.summary}</p>
        <p className="text-[12.5px] text-gray-600">{r.marking === "ai_evaluation" ? "Your marks, with AI-suggested marks you confirmed. Not verified." : "Your own marks."} Station version {r.version}.</p>
        <details className="mt-1">
          <summary className={`cursor-pointer text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>How this practice score is calculated</summary>
          <ul className="mt-1 list-disc pl-5 text-[13px]">{r.explanation.map(e => <li key={e}>{e}</li>)}</ul>
        </details>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <p className="font-semibold text-gray-900">Strengths</p>
          {r.result.strengths.length ? <ul className="mt-1 list-disc pl-5 text-[13.5px]">{r.result.strengths.map(s => <li key={s}>{s}</li>)}</ul> : <p className="text-[13.5px] text-gray-600">No item marked done this time.</p>}
        </div>
        <div>
          <p className="font-semibold text-gray-900">Gaps</p>
          {otherGaps.length ? <ul className="mt-1 list-disc pl-5 text-[13.5px]">{otherGaps.map(g => <li key={g.itemId}>{gapLine(g)}{g.critical && <CriticalTag />}</li>)}</ul> : <p className="text-[13.5px] text-gray-600">None beyond those above.</p>}
        </div>
      </div>

      <details>
        <summary className={`cursor-pointer text-[13px] font-semibold pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`}>Item by item: your marks{anyAi ? " and the AI's suggestions" : ""}</summary>
        <ul className="mt-1 space-y-0.5 text-[13px]">{r.marks.map(m => (
          <li key={m.itemId}>{m.text}{m.critical && <CriticalTag />} · yours: {m.yours ? OSCE_MARK_LABEL[m.yours] : "not marked"}{m.suggested ? ` · AI suggested: ${OSCE_MARK_LABEL[m.suggested]}` : ""}</li>
        ))}</ul>
      </details>

      {r.feedback && <FeedbackPanel parts={r.feedback} />}
      <GuidanceView guidance={r.guidance} expectedActivities={r.expectedActivities} />

      {r.remediation.length > 0 && (
        <div>
          <p className="font-semibold text-gray-900">Next steps</p>
          <ul className="mt-1 space-y-1">{r.remediation.map(x => <li key={x.label}><Link href={remedyHref(x)} className={`font-semibold underline underline-offset-2 ${focusRing}`} style={{ color: accent }}>{x.label}</Link></li>)}</ul>
        </div>
      )}
      <p className="text-[12.5px] text-gray-600">A practice score, not a pass or a fail. {OSCE_GUIDELINES_NOTE}</p>
    </div>
  );
}

/** The station's guidance and expected activities: shown only after a run. */
export function GuidanceView({ guidance, expectedActivities }: { guidance: OsceGuidance | null; expectedActivities: string[] }) {
  if (!guidance && !expectedActivities.length) return <p className="text-[13px] text-gray-600">This station records no assessment guidance or suggested responses.</p>;
  return (
    <div className="rounded-xl border border-gray-200 p-3 text-[13.5px]">
      <p className="font-semibold text-gray-900">Guidance for this station</p>
      {expectedActivities.length > 0 && <><p className="mt-1 text-[12.5px] font-semibold text-gray-700">Expected activities</p><ul className="list-disc pl-5">{expectedActivities.map(a => <li key={a}>{a}</li>)}</ul></>}
      {guidance?.assessmentGuidance && <><p className="mt-1 text-[12.5px] font-semibold text-gray-700">What to look for</p><p>{guidance.assessmentGuidance}</p></>}
      {guidance && guidance.suggestedResponses.length > 0 && <><p className="mt-1 text-[12.5px] font-semibold text-gray-700">Suggested responses</p><ul className="list-disc pl-5">{guidance.suggestedResponses.map(a => <li key={a}>{a}</li>)}</ul></>}
    </div>
  );
}

export const difficultyWord = (d: keyof typeof OSCE_DIFFICULTY_LABEL | null) => (d ? OSCE_DIFFICULTY_LABEL[d] : null);

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
