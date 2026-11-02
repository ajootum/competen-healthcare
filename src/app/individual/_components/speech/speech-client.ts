"use client";

// ── SCHOLAR-CE-2026 CE-06: THE BROWSER SIDE OF READ-ALOUD AND DICTATION ──────────────────────────────────────────────────────
//
// Hooks over the framework-free engines in lib/individual/scholar/speech-engine.ts. Device-native: the browser's speech
// synthesis speaks, the browser's speech recognition listens, and nothing here sends audio to Competen.
//
// WHERE THE SETTINGS LIVE: on this device (localStorage), like the spelling choice (spelling-variant.ts). The existing server
// preference stores are CHECKed catalogues that no migration-free change can extend, and a speech choice is a per-device
// matter (voices differ by device). Every read and write is in try/catch: with storage blocked the controls still work for the
// visit, with the defaults (on, 1x, the best voice).

import { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import {
  SPEECH_ENABLED_KEY, SPEECH_RATE_KEY, SPEECH_VOICE_KEY, detectSpeechSupport, parseRate, parseSpeechEnabled,
  recognitionCtor, type ReadRate, type SpeechSupport, type VoiceLike, type DictationError,
} from "@/lib/individual/scholar/speech";
import { DictationEngine, DictationFieldWriter, READ_IDLE, ReadAloudEngine, type ReadState, type RecognitionEnv } from "@/lib/individual/scholar/speech-engine";
import { DICTATION_IDLE, type DictationState } from "@/lib/individual/scholar/speech";

/* ------------------------------------------------------------------ device settings */

const prefListeners = new Set<() => void>();
const readKey = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
function writeKey(k: string, v: string | null) {
  try { if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, v); } catch { /* this visit only */ }
  prefListeners.forEach(l => l());
}
function subscribePrefs(cb: () => void) {
  prefListeners.add(cb);
  window.addEventListener("storage", cb);
  return () => { prefListeners.delete(cb); window.removeEventListener("storage", cb); };
}

/** The "Read-aloud and dictation" setting (on by default), kept on this device. */
export function useSpeechEnabled(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribePrefs, () => parseSpeechEnabled(readKey(SPEECH_ENABLED_KEY)), () => true);
  return [on, useCallback((v: boolean) => writeKey(SPEECH_ENABLED_KEY, v ? null : "off"), [])];
}

export function useReadRate(): [ReadRate, (r: ReadRate) => void] {
  const rate = useSyncExternalStore(subscribePrefs, () => parseRate(readKey(SPEECH_RATE_KEY)), () => 1 as ReadRate);
  return [rate, useCallback((r: ReadRate) => writeKey(SPEECH_RATE_KEY, r === 1 ? null : String(r)), [])];
}

export function useVoiceChoice(): [string | null, (uri: string | null) => void] {
  const uri = useSyncExternalStore(subscribePrefs, () => readKey(SPEECH_VOICE_KEY), () => null);
  return [uri, useCallback((v: string | null) => writeKey(SPEECH_VOICE_KEY, v), [])];
}

const PRIVACY_SEEN_KEY = "scholar.speech.privacy.seen";
export function usePrivacyNote(): [boolean, () => void] {
  const seen = useSyncExternalStore(subscribePrefs, () => readKey(PRIVACY_SEEN_KEY) === "1", () => true);
  return [!seen, useCallback(() => writeKey(PRIVACY_SEEN_KEY, "1"), [])];
}

/* ------------------------------------------------------------------ support */

let supportCache: SpeechSupport | null = null;
const noopSubscribe = () => () => {};

/** What this browser offers, or null until the page has hydrated (the server render cannot know). */
export function useSpeechSupport(): SpeechSupport | null {
  return useSyncExternalStore(
    noopSubscribe,
    () => (supportCache ??= detectSpeechSupport(typeof window === "undefined" ? undefined : window)),
    () => null,
  );
}

/* ------------------------------------------------------------------ read-aloud */

type Active = { owner: string | null; state: ReadState };
let engine: ReadAloudEngine | null = null;
let active: Active = { owner: null, state: READ_IDLE };
const readListeners = new Set<() => void>();
const pageLang = () => (document.documentElement.lang || navigator.language || "en-GB");

function getEngine(): ReadAloudEngine | null {
  if (engine) return engine;
  if (typeof window === "undefined" || !detectSpeechSupport(window).synthesis) return null;
  const w = window as unknown as { speechSynthesis: ConstructorParameters<typeof ReadAloudEngine>[0]["synth"]; SpeechSynthesisUtterance: new (t: string) => unknown };
  engine = new ReadAloudEngine({ synth: w.speechSynthesis, makeUtterance: t => new w.SpeechSynthesisUtterance(t), pageLang });
  engine.subscribe(state => {
    active = { owner: state.status === "idle" ? null : active.owner, state };
    readListeners.forEach(l => l());
  });
  // Leaving the page (a reload, a tab close, a back/forward restore) must not leave the voice running.
  window.addEventListener("pagehide", () => engine?.stop());
  return engine;
}
const subscribeRead = (cb: () => void) => { readListeners.add(cb); return () => { readListeners.delete(cb); }; };

export type ReadAloud = {
  /** idle unless THIS button's text is the one being read. */
  state: ReadState;
  play(text: string): void; pause(): void; resume(): void; stop(): void;
};

/** One shared voice for the whole page: starting one reading stops any other. Stops on unmount (navigation, a closed dialog). */
export function useReadAloud(): ReadAloud {
  const id = useId();
  const [rate] = useReadRate();
  const [voice] = useVoiceChoice();
  const snap = useSyncExternalStore(subscribeRead, () => active, () => active);
  const mine = snap.owner === id;
  // A changed rate or voice takes effect now.
  const cfg = useRef({ rate, voice });
  useEffect(() => {
    if (cfg.current.rate === rate && cfg.current.voice === voice) return;
    cfg.current = { rate, voice };
    if (active.owner === id) getEngine()?.configure({ rate, voiceURI: voice });
  }, [rate, voice, id]);
  useEffect(() => () => { if (active.owner === id) getEngine()?.stop(); }, [id]);
  return {
    state: mine ? snap.state : READ_IDLE,
    play: text => { const e = getEngine(); if (!e) return; e.stop(); active = { owner: id, state: READ_IDLE }; e.play(text, { rate, voiceURI: voice }); },
    pause: () => { if (active.owner === id) getEngine()?.pause(); },
    resume: () => { if (active.owner === id) getEngine()?.resume(); },
    stop: () => { if (active.owner === id) getEngine()?.stop(); },
  };
}

/* The voices this device offers. They load asynchronously in several browsers: the list is refreshed when they arrive. */
let voiceCache: VoiceLike[] = [];
const voiceListeners = new Set<() => void>();
function refreshVoices() {
  try { voiceCache = ((window.speechSynthesis?.getVoices() ?? []) as unknown as VoiceLike[]).slice(); } catch { voiceCache = []; }
  voiceListeners.forEach(l => l());
}
function subscribeVoices(cb: () => void) {
  if (voiceListeners.size === 0) {
    refreshVoices();
    try { window.speechSynthesis?.addEventListener?.("voiceschanged", refreshVoices); } catch { /* the list stays as it is */ }
  }
  voiceListeners.add(cb);
  return () => {
    voiceListeners.delete(cb);
    if (voiceListeners.size === 0) { try { window.speechSynthesis?.removeEventListener?.("voiceschanged", refreshVoices); } catch { /* nothing to remove */ } }
  };
}
const NO_VOICES: VoiceLike[] = [];
export function useVoices(): VoiceLike[] {
  return useSyncExternalStore(subscribeVoices, () => voiceCache, () => NO_VOICES);
}

/* ------------------------------------------------------------------ dictation */

export type Dictation = { state: DictationState; start(): void; stop(): void; reset(): void };

/**
 * Dictation into a text field. Final words are inserted at the caret (or over the selection) of the field `getField` returns, through
 * `onValue`; nothing is submitted. Stops on unmount, after silence, and when the field is disabled.
 */
export type TextField = HTMLTextAreaElement | HTMLInputElement;
export function useDictation(getField: () => TextField | null, onValue: (next: string) => void): Dictation {
  const engineRef = useRef<DictationEngine | null>(null);
  const stateRef = useRef<DictationState>(DICTATION_IDLE);
  const latest = useRef({ onValue, getField });
  useEffect(() => { latest.current = { onValue, getField }; });

  const get = useCallback((): DictationEngine => {
    if (engineRef.current) return engineRef.current;
    const e = new DictationEngine({
      ctor: recognitionCtor(window) as RecognitionEnv["ctor"],
      lang: pageLang,
      setTimer: (fn, ms) => window.setTimeout(fn, ms),
      clearTimer: id => window.clearTimeout(id as number),
    });
    const writer = new DictationFieldWriter(() => latest.current.getField(), v => latest.current.onValue(v));
    e.onSessionStart = () => writer.reset();
    e.onFinal = text => writer.append(text);
    e.onRevise = (previous, next) => writer.revise(previous, next);
    engineRef.current = e;
    return e;
  }, []);

  const snap = useSyncExternalStore(
    useCallback((cb: () => void) => {
      const e = get();
      const un = e.subscribe(s => { stateRef.current = s; cb(); });
      return un;
    }, [get]),
    () => stateRef.current,
    () => DICTATION_IDLE,
  );

  useEffect(() => () => { engineRef.current?.dispose(); engineRef.current = null; }, []);
  const start = useCallback(() => get().start(), [get]);
  const stop = useCallback(() => engineRef.current?.stop(), []);
  const reset = useCallback(() => engineRef.current?.reset(), []);
  return { state: snap, start, stop, reset };
}

export type { DictationError };
