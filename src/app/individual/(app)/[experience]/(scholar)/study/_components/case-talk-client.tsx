"use client";

import { useEffect, useRef, useState } from "react";
import { SCHOLAR } from "@/lib/individual/experiences";
import { FormativeAiLabel } from "./edu-notice";
import { HANDOVER_HELP, HANDOVER_LABEL, HANDOVER_SECTIONS, HANDOVER_SECTION_MAX, type HandoverResultView, type HandoverSection } from "@/lib/cases/handover";

// SCHOLAR-CE-2026 CE-04. Two pieces of the case player, kept apart so case-client.tsx stays readable:
//   CaseConversation -- "Talk to the patient" while the case is on, and the conversation with a labelled communication note in the debrief.
//   HandoverBoxes / HandoverResult -- the SBAR handover task: four labelled boxes, and its part marks after submitting.
// Only rendered when the case's version defines a patient voice (view.talk) or has a handover decision. Everything the AI
// says is labelled as simulated or formative. A conversation that cannot be had says "Conversation unavailable" and why.
// One column below md; touch targets grow on coarse pointers (CPR-MOB-001).

const accent = SCHOLAR.accent;
const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const btn = `inline-flex min-h-[44px] items-center justify-center rounded-xl px-4 py-2 text-[14px] font-semibold text-white hover:opacity-90 disabled:opacity-50 ${focusRing}`;
const ghost = `inline-flex min-h-[44px] items-center justify-center rounded-xl border border-gray-300 bg-white px-4 py-2 text-[14px] font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;
const field = `rounded-lg border border-gray-300 px-2.5 py-2 text-[14px] pointer-coarse:min-h-[var(--cmp-touch-min)] ${focusRing}`;

const requestId = () => { try { return crypto.randomUUID(); } catch { return `${Date.now()}-${Math.random().toString(36).slice(2)}`; } };
async function send(url: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, any> }> { // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    const res = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "Content-Type": "application/json", "x-request-id": requestId() }, body: JSON.stringify(body) });
    return { ok: res.ok, json: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, json: { error: "Competen could not be reached. Check your connection and try again." } };
  }
}

type Turn = { stageId: string; stageTitle: string; question: string; reply: string };
type Stage = { used: number; cap: number; left: number; full: boolean };
type Talk = {
  speaker: "patient" | "caregiver"; label: string; unavailable: string | null; stage: Stage | null; turns: Turn[];
  debrief: { asked: { id: string; label: string }[]; missed: { id: string; label: string }[]; note: { label: string; text: string } | null } | null;
};

export function CaseConversation({ base, speaker, active }: { base: string; speaker: "patient" | "caregiver"; active: boolean }) {
  const who = speaker === "caregiver" ? "caregiver" : "patient";
  const [talk, setTalk] = useState<Talk | null>(null);
  const [loadError, setLoadError] = useState("");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"unavailable" | "info">("info");
  const log = useRef<HTMLOListElement | null>(null);
  const url = `${base}/talk`;

  useEffect(() => {
    let live = true;
    (async () => {
      const r = await send(url);
      if (!live) return;
      if (r.ok && r.json.talk) setTalk(r.json.talk as Talk); else setLoadError(r.json.error ?? "The conversation could not be loaded.");
    })();
    return () => { live = false; };
  }, [url, active]);

  async function ask(e: React.FormEvent) {
    e.preventDefault();
    const question = q.trim();
    if (!question || busy) return;
    setBusy("ask"); setNotice("");
    const r = await send(url, { action: "ask", question });
    setBusy("");
    // An unavailable conversation or a reached cap is a 200 with the plain reason, never a made-up reply.
    if (!r.ok || !r.json.turn) { setNotice(r.json.unavailable ?? r.json.error ?? "That could not be asked just now."); setNoticeKind(r.json.unavailable ? "unavailable" : "info"); return; }
    setQ("");
    setTalk(t => t ? { ...t, stage: r.json.stage, turns: [...t.turns, { stageId: r.json.turn.stageId, stageTitle: "", question: r.json.turn.question, reply: r.json.turn.reply }] } : t);
    setTimeout(() => log.current?.lastElementChild?.scrollIntoView({ block: "nearest" }), 0);
  }
  async function note() {
    setBusy("note"); setNotice("");
    const r = await send(url, { action: "note" });
    setBusy("");
    if (!r.ok || !r.json.talk) { setNotice(r.json.unavailable ?? r.json.error ?? "The note could not be written just now."); setNoticeKind(r.json.unavailable ? "unavailable" : "info"); return; }
    setTalk(r.json.talk as Talk);
  }

  if (loadError) return (
    <section aria-labelledby="talk-h" className="mt-4 rounded-xl border border-gray-200 p-4">
      <h3 id="talk-h" className="text-[15px] font-bold text-gray-900">Conversation unavailable</h3>
      <p role="status" className="mt-1 text-[13.5px] text-gray-800">{loadError} The case works the same without it.</p>
    </section>
  );
  if (!talk) return <section aria-busy="true" aria-labelledby="talk-h" className="mt-4 rounded-xl border border-gray-200 p-4"><h3 id="talk-h" className="text-[15px] font-bold text-gray-900">Talk to the {who}</h3><p className="mt-1 text-[13px] text-gray-600">Loading…</p></section>;

  // After the case: the conversation, the code review of the key questions, and a labelled AI note on request.
  if (!active) {
    if (!talk.turns.length) return null;
    const d = talk.debrief;
    return (
      <section aria-labelledby="talk-h" className="mt-5 rounded-xl border border-gray-200 p-4">
        <h3 id="talk-h" className="text-[15px] font-bold text-gray-900">Your conversation with the {who}</h3>
        <p className="mt-1 text-[12.5px] text-gray-600">{talk.label}</p>
        <Transcript turns={talk.turns} who={who} />
        {d && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-emerald-50 px-3 py-2"><p className="text-[12px] font-bold uppercase tracking-[0.08em] text-emerald-900">Key questions you asked</p>
              {d.asked.length ? <ul className="mt-1 list-disc pl-5 text-[13.5px] text-emerald-950">{d.asked.map(k => <li key={k.id}>{k.label}</li>)}</ul> : <p className="mt-1 text-[13.5px] text-emerald-950">None of the case&apos;s key questions this time.</p>}</div>
            <div className="rounded-lg bg-amber-50 px-3 py-2"><p className="text-[12px] font-bold uppercase tracking-[0.08em] text-amber-900">Key questions you did not ask</p>
              {d.missed.length ? <ul className="mt-1 list-disc pl-5 text-[13.5px] text-amber-950">{d.missed.map(k => <li key={k.id}>{k.label}</li>)}</ul> : <p className="mt-1 text-[13.5px] text-amber-950">You covered them all.</p>}</div>
          </div>
        )}
        {d?.note ? (
          <div className="mt-3 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
            <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{d.note.label}</p>
            <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-amber-950">{d.note.text}</p>
            <FormativeAiLabel className="mt-1" />
          </div>
        ) : (
          <div className="mt-3">
            <button type="button" className={ghost} disabled={!!busy} onClick={note}>{busy === "note" ? "Writing the note…" : "Get an AI note on my communication"}</button>
            <p className="mt-1 text-[12.5px] text-gray-600">The two lists above come from the case itself. The note is an AI comment on your questions, and is optional.</p>
          </div>
        )}
        {notice && <p role="status" className="mt-2 text-[13px] text-gray-800">{noticeKind === "unavailable" && <span className="font-semibold">Conversation unavailable. </span>}{notice}</p>}
      </section>
    );
  }

  const cap = talk.stage;
  return (
    <section aria-labelledby="talk-h" className="mt-4 rounded-xl border border-gray-200 p-4">
      <h3 id="talk-h" className="text-[15px] font-bold text-gray-900">Talk to the {who}</h3>
      <p className="mt-1 text-[12.5px] text-gray-600">{talk.label} They only know what the case says they know at this point.</p>
      {talk.unavailable ? (
        <div role="status" className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
          <p className="text-[13.5px] font-semibold text-gray-900">Conversation unavailable</p>
          <p className="text-[13.5px] text-gray-800">{talk.unavailable}</p>
          <p className="text-[12.5px] text-gray-600">The case works the same without it.</p>
        </div>
      ) : null}
      <Transcript turns={talk.turns} who={who} log={log} />
      {!talk.unavailable && (
        <form onSubmit={ask} className="mt-3">
          <label className="block text-[13px] font-semibold text-gray-800" htmlFor="talk-q">Ask the {who} a question</label>
          <div className="mt-1 flex flex-wrap gap-2">
            <input id="talk-q" type="text" value={q} maxLength={400} onChange={e => setQ(e.target.value)} disabled={!!busy || !!cap?.full} autoComplete="off"
              placeholder={cap?.full ? "You have used your questions for this stage" : "Type what you would say"} className={`${field} min-w-0 flex-1`} />
            <button type="submit" className={btn} style={{ background: accent }} disabled={!!busy || !q.trim() || !!cap?.full}>{busy === "ask" ? "Asking…" : "Ask"}</button>
          </div>
          {cap && <p className="mt-1 text-[12.5px] text-gray-600" aria-live="polite">{cap.full ? `You have used all ${cap.cap} questions for this stage. Carry on with the case.` : `${cap.left} of ${cap.cap} questions left at this stage.`}</p>}
        </form>
      )}
      {notice && <p role="status" className="mt-2 text-[13px] text-gray-800">{noticeKind === "unavailable" && <span className="font-semibold">Conversation unavailable. </span>}{notice}</p>}
    </section>
  );
}

function Transcript({ turns, who, log }: { turns: Turn[]; who: string; log?: React.RefObject<HTMLOListElement | null> }) {
  if (!turns.length) return <p className="mt-2 text-[13px] text-gray-600">Nothing asked yet.</p>;
  return (
    <ol ref={log} aria-live="polite" aria-label="The conversation so far" className="mt-2 space-y-2">
      {turns.map((t, i) => {
        const head = i > 0 && turns[i - 1].stageId === t.stageId ? null : t.stageTitle || null;
        return (
          <li key={i}>
            {head && <p className="mt-1 text-[11.5px] font-bold uppercase tracking-[0.08em] text-gray-500">{head}</p>}
            <p className="text-[14px] text-gray-900"><span className="font-semibold">You:</span> {t.question}</p>
            <p className="rounded-lg bg-gray-50 px-3 py-1.5 text-[14px] text-gray-900"><span className="font-semibold capitalize">The {who}:</span> {t.reply}</p>
          </li>
        );
      })}
    </ol>
  );
}

// ── THE SBAR HANDOVER TASK ──

export type HandoverValue = Record<HandoverSection, string>;
export const EMPTY_HANDOVER: HandoverValue = { situation: "", background: "", assessment: "", recommendation: "" };
export const handoverReady = (v: HandoverValue | undefined) => !!v && HANDOVER_SECTIONS.some(k => v[k].trim());

export function HandoverBoxes({ id, value, onChange }: { id: string; value: HandoverValue; onChange: (v: HandoverValue) => void }) {
  return (
    <fieldset className="mt-2 grid gap-3 lg:grid-cols-2">
      <legend className="sr-only">Your SBAR handover</legend>
      {HANDOVER_SECTIONS.map(k => (
        <label key={k} htmlFor={`${id}-${k}`} className="block text-[13px] font-semibold text-gray-800">
          {HANDOVER_LABEL[k]} <span className="font-normal text-gray-600">{HANDOVER_HELP[k]}</span>
          <textarea id={`${id}-${k}`} rows={3} maxLength={HANDOVER_SECTION_MAX} value={value[k]} onChange={e => onChange({ ...value, [k]: e.target.value })} className={`${field} mt-1 block w-full`} />
        </label>
      ))}
    </fieldset>
  );
}

/** The part marks of a handover, after submitting: which boxes were written, which key points were found or missed. Practice only. */
export function HandoverResult({ r, note }: { r: HandoverResultView; note: { label: string; text: string } | null }) {
  return (
    <div className="mt-2 text-[13.5px] text-gray-900">
      <p className="font-bold">{r.correct ? "A clear handover." : "A handover to sharpen."} <span className="font-normal text-gray-700">Part marks: {Math.round(r.score * 100)}%.</span></p>
      <p className="mt-1"><span className="font-semibold">Boxes written:</span> {r.sections.map(s => `${s.written ? "✓" : "✗"} ${s.label}`).join("  ")}</p>
      {r.found.length > 0 && <p className="mt-1"><span className="font-semibold">You mentioned:</span> {r.found.join("; ")}</p>}
      {r.missed.length > 0 && <p className="mt-1"><span className="font-semibold">Not mentioned:</span> {r.missed.join("; ")}</p>}
      <p className="mt-1 text-[12.5px] text-gray-700">{r.note}</p>
      {note && (
        <div className="mt-2 rounded-lg border border-dashed border-amber-400 bg-amber-50 px-3 py-2">
          <p className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-amber-900">{note.label}</p>
          <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-amber-950">{note.text}</p>
          <FormativeAiLabel className="mt-1" />
        </div>
      )}
    </div>
  );
}
