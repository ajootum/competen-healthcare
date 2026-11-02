// ── SCHOLAR-CE-2026 CE-06: THE ENGINES BEHIND useReadAloud AND useDictation ───────────────────────────────────────────────
//
// Framework-free classes over an INJECTED browser environment, so they are tested with a mocked speechSynthesis and a mocked
// recognition constructor. The React hooks (app/individual/_components/speech) are thin wrappers. Device-native only: nothing
// here creates a network request, and no audio ever reaches Competen.

import {
  DICTATION_IDLE, DICTATION_SILENCE_MS, chunkForSpeech, dictationReducer, mapRecognitionError, pickVoice,
  type DictationEvent, type DictationState, type ReadRate, type VoiceLike,
} from "./speech";

/* eslint-disable @typescript-eslint/no-explicit-any */

/* ------------------------------------------------------------------ read-aloud */

export type ReadStatus = "idle" | "speaking" | "paused";
export type ReadState = { status: ReadStatus; index: number; total: number };
export const READ_IDLE: ReadState = { status: "idle", index: 0, total: 0 };

export type SynthEnv = {
  synth: {
    speak(u: any): void; cancel(): void; getVoices(): any[];
    addEventListener?(type: string, fn: () => void): void; removeEventListener?(type: string, fn: () => void): void;
  };
  makeUtterance(text: string): any;
  /** The page language (document.documentElement.lang or the browser's language). */
  pageLang(): string;
};

/**
 * Speaks a text one chunk at a time. PAUSE IS "stop here, remember where": the current chunk is cancelled and speaking again
 * restarts that chunk. That is slightly less smooth than a native pause but it behaves the same in every browser (native pause
 * is unreliable on Android and some desktop engines). A generation number makes the end/error events of a cancelled utterance
 * harmless.
 */
export class ReadAloudEngine {
  private chunks: string[] = [];
  private index = 0;
  private gen = 0;
  private state: ReadState = READ_IDLE;
  private rate: ReadRate = 1;
  private voiceURI: string | null = null;
  private listeners = new Set<(s: ReadState) => void>();

  constructor(private env: SynthEnv) {}

  getState() { return this.state; }
  subscribe(fn: (s: ReadState) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private set(next: ReadState) { this.state = next; this.listeners.forEach(l => l(next)); }

  voices(): VoiceLike[] { try { return this.env.synth.getVoices() as VoiceLike[]; } catch { return []; } }

  /** Begin reading `text` from its start. Replaces anything already being read. */
  play(text: string, opts?: { rate?: ReadRate; voiceURI?: string | null }) {
    this.cancelCurrent();
    this.chunks = chunkForSpeech(text);
    this.index = 0;
    if (opts?.rate) this.rate = opts.rate;
    if (opts && "voiceURI" in opts) this.voiceURI = opts.voiceURI ?? null;
    if (!this.chunks.length) { this.set(READ_IDLE); return; }
    this.set({ status: "speaking", index: 0, total: this.chunks.length });
    this.speakCurrent();
  }

  pause() {
    if (this.state.status !== "speaking") return;
    this.cancelCurrent();
    this.set({ ...this.state, status: "paused" });
  }

  resume() {
    if (this.state.status !== "paused") return;
    this.set({ ...this.state, status: "speaking" });
    this.speakCurrent();
  }

  stop() {
    this.cancelCurrent();
    this.chunks = []; this.index = 0;
    if (this.state.status !== "idle") this.set(READ_IDLE);
  }

  /** A new rate or voice takes effect now (the current chunk restarts) while speaking, or on resume while paused. */
  configure(opts: { rate?: ReadRate; voiceURI?: string | null }) {
    if (opts.rate) this.rate = opts.rate;
    if ("voiceURI" in opts) this.voiceURI = opts.voiceURI ?? null;
    if (this.state.status === "speaking") { this.cancelCurrent(); this.speakCurrent(); }
  }

  private cancelCurrent() {
    this.gen++;
    try { this.env.synth.cancel(); } catch { /* nothing was speaking */ }
  }

  private speakCurrent() {
    const gen = ++this.gen;
    const text = this.chunks[this.index];
    if (text === undefined) { this.finish(); return; }
    let u: any;
    try { u = this.env.makeUtterance(text); } catch { this.finish(); return; }
    const lang = this.env.pageLang();
    const voice = pickVoice(this.voices(), lang, this.voiceURI);
    try {
      u.rate = this.rate;
      u.lang = voice?.lang || lang || "en-GB";
      if (voice) u.voice = voice;
    } catch { /* the browser's defaults are used */ }
    u.onend = () => {
      if (gen !== this.gen) return;
      this.index++;
      if (this.index >= this.chunks.length) this.finish();
      else { this.set({ ...this.state, index: this.index }); this.speakCurrent(); }
    };
    u.onerror = () => { if (gen === this.gen) this.finish(); };
    try { this.env.synth.speak(u); } catch { this.finish(); }
  }

  private finish() {
    this.chunks = []; this.index = 0;
    this.set(READ_IDLE);
  }
}

/* ------------------------------------------------------------------ dictation */

export type RecognitionEnv = {
  /** The recognition constructor, or null when the browser has none. */
  ctor: (new () => any) | null;
  lang(): string;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(id: unknown): void;
  silenceMs?: number;
};

/**
 * One dictation session at a time. FINAL words go to `onFinal` (the page inserts them at the cursor; nothing is submitted).
 * INTERIM words are only reported through the state (shown as a live line, never written into the field, so text does not
 * rewrite itself under the learner). Stops itself after silence. Never sends audio anywhere: the browser's own engine does the
 * work and only text comes back.
 */
export class DictationEngine {
  private rec: any = null;
  private timer: unknown = null;
  private emitted = -1;
  private state: DictationState = DICTATION_IDLE;
  private listeners = new Set<(s: DictationState) => void>();
  onFinal: (text: string) => void = () => {};

  constructor(private env: RecognitionEnv) {}

  getState() { return this.state; }
  subscribe(fn: (s: DictationState) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  private dispatch(e: DictationEvent) {
    const next = dictationReducer(this.state, e);
    if (next === this.state) return;
    this.state = next;
    this.listeners.forEach(l => l(next));
  }

  start() {
    if (this.state.status === "starting" || this.state.status === "listening") return;
    if (!this.env.ctor) { this.dispatch({ type: "error", code: "not_supported" }); return; }
    this.dispatch({ type: "start" });
    this.emitted = -1;
    let rec: any;
    try { rec = new this.env.ctor(); } catch { this.dispatch({ type: "error", code: "not_supported" }); return; }
    this.rec = rec;
    try {
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = this.env.lang();
    } catch { /* the engine's defaults */ }
    rec.onstart = () => { if (this.rec !== rec) return; this.dispatch({ type: "started" }); this.arm(); };
    rec.onresult = (ev: any) => {
      if (this.rec !== rec) return;
      this.arm();
      let interim = "", final = "";
      const results = ev?.results;
      for (let i = Number(ev?.resultIndex) || 0; i < (results?.length ?? 0); i++) {
        const r = results[i];
        const t = String(r?.[0]?.transcript ?? "");
        if (r?.isFinal) { if (i > this.emitted) { final += t; this.emitted = i; } } else interim += t;
      }
      if (final.trim()) { this.dispatch({ type: "final" }); this.onFinal(final.trim()); }
      this.dispatch({ type: "interim", text: interim.trim() });
    };
    rec.onerror = (ev: any) => {
      if (this.rec !== rec) return;
      const code = mapRecognitionError(ev?.error);
      if (code) { this.clearTimer(); this.dispatch({ type: "error", code }); }
    };
    rec.onend = () => {
      if (this.rec !== rec) return;
      this.clearTimer(); this.rec = null;
      this.dispatch({ type: "end" });
    };
    try { rec.start(); this.arm(); } catch { this.rec = null; this.clearTimer(); this.dispatch({ type: "error", code: "failed" }); }
  }

  /** The learner stops it. The engine's last final result may still arrive before it ends. */
  stop() {
    this.clearTimer();
    const rec = this.rec;
    this.dispatch({ type: "stop" });
    if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
  }

  /** Leaving the page: release the microphone at once and drop any late events. */
  dispose() {
    this.clearTimer();
    const rec = this.rec; this.rec = null;
    if (rec) { try { if (rec.abort) rec.abort(); else rec.stop(); } catch { /* already stopped */ } }
    this.listeners.clear();
  }

  /** Clears an error back to idle (the learner dismissed it, or tries again). */
  reset() { if (this.state.status === "error") { this.state = DICTATION_IDLE; this.listeners.forEach(l => l(this.state)); } }

  private arm() {
    this.clearTimer();
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      const rec = this.rec;
      this.dispatch({ type: "silence" });
      if (rec) { try { rec.stop(); } catch { /* already stopped */ } }
    }, this.env.silenceMs ?? DICTATION_SILENCE_MS);
  }
  private clearTimer() { if (this.timer != null) { this.env.clearTimer(this.timer); this.timer = null; } }
}
