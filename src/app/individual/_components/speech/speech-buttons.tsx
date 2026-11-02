"use client";

import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";
import {
  DICTATION_ERROR_TEXT, READ_RATES, SPEECH_PRIVACY_NOTE, chunkForSpeech, type ReadRate,
} from "@/lib/individual/scholar/speech";
import {
  useDictation, usePrivacyNote, type TextField, useReadAloud, useReadRate, useSpeechEnabled, useSpeechSupport, useVoiceChoice, useVoices,
} from "./speech-client";

// SCHOLAR-CE-2026 CE-06: the two shared controls. ReadAloudButton ("Listen") speaks a text with the browser's own voice;
// DictateButton fills a text field from the browser's own speech recognition. Both are device-native: Competen receives and
// keeps no audio. Both render NOTHING when the browser cannot do it or the learner has turned the setting off (no error, no
// dead button), and reserve their space until the page has hydrated so they do not move the layout when they appear.

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gray-900";
const touch = "min-h-[40px] pointer-coarse:min-h-[var(--cmp-touch-min)]";
const baseLayout = `inline-flex ${touch} items-center justify-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold disabled:opacity-50 ${focusRing}`;
const base = `${baseLayout} border-gray-300 bg-white text-gray-800 hover:bg-gray-50`;
const recording = `${baseLayout} border-[var(--cmp-color-critical)] bg-[var(--cmp-surface-critical)] text-[var(--cmp-text-critical)]`;
const square = `inline-flex ${touch} min-w-[40px] pointer-coarse:min-w-[var(--cmp-touch-min)] items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-50 ${focusRing}`;

function Icon({ d, fill }: { d: string; fill?: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" className="shrink-0" fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const PLAY = "M6 4l10 6-10 6V4z";
const PAUSE = "M6 4v12M14 4v12";
const STOP = "M5 5h10v10H5z";
const MIC = "M10 2.5a2.5 2.5 0 00-2.5 2.5v5a2.5 2.5 0 005 0V5A2.5 2.5 0 0010 2.5zM4.5 9.5a5.5 5.5 0 0011 0M10 15v2.5M7 17.5h6";

/** Space held until the page knows what the browser can do, so a control appearing never moves what is around it. */
const Placeholder = ({ w }: { w: string }) => <span aria-hidden="true" className={`inline-block ${touch} ${w}`} />;

/* ------------------------------------------------------------------ Listen */

/**
 * "Listen": play / pause / resume the text, stop, and a small menu for the speed (0.8 / 1 / 1.2 / 1.5) and the voice.
 * `text` is the raw lesson or answer text: citation markers and markdown are removed before it is spoken. One reading at a
 * time on the page; reading stops when this control leaves the page.
 */
export function ReadAloudButton({ text, label = "Listen", about, className = "" }: {
  text: string; label?: string;
  /** What is read, in words, for assistive technology ("this lesson"). */
  about?: string; className?: string;
}) {
  const support = useSpeechSupport();
  const [enabled, setEnabled] = useSpeechEnabled();
  const ra = useReadAloud();
  const [rate, setRate] = useReadRate();
  const [voiceURI, setVoice] = useVoiceChoice();
  const voices = useVoices();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const status = ra.state.status;

  // Close on Escape (focus returns to the trigger) and on a press outside.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); trigger.current?.focus(); } };
    const onDown = (e: PointerEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  }, [open]);

  if (support === null) return <Placeholder w="w-[9.5rem]" />;
  if (!support.synthesis || !enabled) return null;

  const speakable = chunkForSpeech(text).length > 0;
  const subject = about ? ` ${about}` : "";
  const main = status === "speaking" ? "Pause" : status === "paused" ? "Resume" : label;
  const onMain = () => (status === "speaking" ? ra.pause() : status === "paused" ? ra.resume() : ra.play(text));
  const english = voices.filter(v => v.lang.toLowerCase().startsWith("en"));
  const shown = english.length ? english : voices;

  return (
    <div ref={wrap} className={`relative inline-flex items-center gap-1.5 ${className}`}>
      {/* An action whose words change (Listen, Pause, Resume), so it is not also a pressed/unpressed toggle. */}
      <button type="button" onClick={onMain} disabled={!speakable}
        aria-label={`${main}${about ? `, ${about}` : ""}`} className={`${base} min-w-[6.25rem]`}>
        <Icon d={status === "speaking" ? PAUSE : PLAY} fill={status !== "speaking"} />{main}
      </button>
      {/* Held in place (hidden, out of the tab order) when nothing is being read, so starting does not shift the row. */}
      <button type="button" onClick={ra.stop} aria-label={`Stop reading${subject}`} className={`${square} ${status === "idle" ? "invisible" : ""}`}>
        <Icon d={STOP} fill />
      </button>
      <button ref={trigger} type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label="Listening options: speed and voice" className={square}>
        <span aria-hidden="true" className="text-[12px]">{"▾"}</span>
      </button>
      <span role="status" aria-live="polite" className="cmp-sr-only">
        {status === "speaking" ? `Reading${subject}.` : status === "paused" ? "Paused." : ""}
      </span>
      {open && (
        <div id={menuId} role="group" aria-label="Listening options"
          className="absolute left-0 top-full z-30 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-gray-300 bg-white p-3 text-left shadow-lg">
          <p id={`${menuId}-s`} className="text-[12.5px] font-bold text-gray-800">Speed</p>
          <div role="group" aria-labelledby={`${menuId}-s`} className="mt-1 flex flex-wrap gap-1.5">
            {READ_RATES.map(r => (
              <button key={r} type="button" aria-pressed={rate === r} onClick={() => setRate(r as ReadRate)}
                className={`${touch} rounded-lg border px-3 text-[13px] font-semibold ${rate === r ? "border-gray-900 bg-gray-900 text-white" : "border-gray-300 bg-white text-gray-800 hover:bg-gray-50"} ${focusRing}`}>
                {r}x
              </button>
            ))}
          </div>
          <label htmlFor={`${menuId}-v`} className="mt-3 block text-[12.5px] font-bold text-gray-800">Voice</label>
          <select id={`${menuId}-v`} value={shown.some(v => v.voiceURI === voiceURI) ? voiceURI ?? "" : ""} onChange={e => setVoice(e.target.value || null)}
            className={`mt-1 w-full rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[13px] text-gray-900 ${touch} ${focusRing}`}>
            <option value="">Best match for this page</option>
            {shown.map(v => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
          </select>
          <p className="mt-2 text-[12px] leading-relaxed text-gray-700">
            The voice is your device&apos;s own. Nothing you listen to is sent to Competen.
          </p>
          <button type="button" onClick={() => { ra.stop(); setEnabled(false); setOpen(false); }}
            className={`mt-2 ${touch} w-full rounded-lg border border-gray-300 bg-white px-3 text-[13px] font-semibold text-gray-800 hover:bg-gray-50 ${focusRing}`}>
            Turn off read-aloud and dictation
          </button>
          <p className="mt-1 text-[12px] text-gray-600">Turn it back on in Learn, under Lesson settings.</p>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ Dictate */

/**
 * "Dictate": speak and the words are inserted at the cursor of `inputRef`'s field, where the learner can edit them. Nothing is
 * ever submitted for them. The words still being worked out (interim) show beside the button and are written into the field only
 * once final. Stops by itself after a few seconds of silence, and when the learner leaves the page.
 */
export function DictateButton({ inputRef, fieldId, onValue, label = "Dictate", disabled, className = "" }: {
  /** The field to fill: a ref to it, or (inside a list, where one ref cannot serve) its element id. */
  inputRef?: RefObject<TextField | null>; fieldId?: string;
  /** Receives the field's new full value, exactly as a typing change would. */
  onValue: (next: string) => void;
  label?: string; disabled?: boolean; className?: string;
}) {
  const support = useSpeechSupport();
  const [enabled] = useSpeechEnabled();
  const getField = useCallback((): TextField | null => inputRef?.current ?? (fieldId ? (document.getElementById(fieldId) as TextField | null) : null), [inputRef, fieldId]);
  const dict = useDictation(getField, onValue);
  const [showPrivacy, dismissPrivacy] = usePrivacyNote();
  const [note, setNote] = useState(false);
  const { status, interim, error } = dict.state;
  const listening = status === "starting" || status === "listening";

  // A field that becomes disabled (a request in flight) ends the dictation.
  const { stop } = dict;
  useEffect(() => { if (disabled) stop(); }, [disabled, stop]);

  if (support === null) return <Placeholder w="w-[7rem]" />;
  if (!support.recognition || !enabled) return null;

  const tail = interim.length > 90 ? "…" + interim.slice(-90) : interim;
  const onClick = () => {
    if (listening) { dict.stop(); return; }
    if (showPrivacy) setNote(true);
    dict.start();
  };

  return (
    <div className={`inline-flex max-w-full flex-wrap items-center gap-2 ${className}`}>
      {/* The name stays "Dictate" and the state is aria-pressed (a toggle); while it records, a plain Stop sits beside it. */}
      <button type="button" onClick={onClick} disabled={disabled && !listening} aria-pressed={listening}
        aria-label={`${label} into this box`} className={`${listening ? recording : base} min-w-[6.5rem]`}>
        {listening && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-[var(--cmp-color-critical)]" />}
        <Icon d={MIC} />{label}
      </button>
      {listening && <button type="button" onClick={dict.stop} className={base}><Icon d={STOP} fill />Stop</button>}
      <span role="status" aria-live="polite"
        className={`min-w-0 text-[12.5px] ${error ? "basis-full text-[var(--cmp-text-critical)]" : "truncate text-gray-700"}`}>
        {error ? DICTATION_ERROR_TEXT[error]
          : status === "starting" ? "Starting the microphone…"
            : listening ? (tail ? `Hearing: ${tail}` : "Listening. Speak now; it stops after a pause.") : ""}
      </span>
      {note && showPrivacy && (
        <p className="basis-full rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-[12.5px] leading-relaxed text-gray-800">
          {SPEECH_PRIVACY_NOTE}{" "}
          <button type="button" onClick={() => { dismissPrivacy(); setNote(false); }} className={`font-semibold underline ${focusRing}`}>Got it</button>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ the setting */

/** "Read-aloud and dictation" on / off, kept on this device. For the Learn lesson settings. */
export function SpeechSetting() {
  const [enabled, setEnabled] = useSpeechEnabled();
  return (
    <label className="flex items-start gap-2 text-[13.5px] text-gray-900">
      <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className={`mt-0.5 h-4 w-4 pointer-coarse:h-5 pointer-coarse:w-5 ${focusRing}`} />
      <span><span className="font-semibold">Read-aloud and dictation</span>
        <span className="block text-[12px] text-gray-600">Shows Listen and Dictate where they are available. Listening uses your device&apos;s own voice. {SPEECH_PRIVACY_NOTE} Saved on this device.</span></span>
    </label>
  );
}
