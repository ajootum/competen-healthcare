// ── SCHOLAR-CE-2026 CE-06: THE ENGINES BEHIND useReadAloud AND useDictation ───────────────────────────────────────────────
//
// Framework-free classes over an INJECTED browser environment, so they are tested with a mocked speechSynthesis and a mocked
// recognition constructor. The React hooks (app/individual/_components/speech) are thin wrappers. Device-native only: nothing
// here creates a network request, and no audio ever reaches Competen.

import {
  DICTATION_IDLE, DICTATION_SILENCE_MS, chunkForSpeech, dictationReducer, insertAtCursor, mapRecognitionError, mergeFinalSegments, pickVoice,
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
 * Speaks a text one chunk (one sentence) at a time. PAUSE IS "stop here, remember where": the current utterance is cancelled and
 * speaking again continues from the last word the browser reported (a boundary event) inside that chunk; if it reported none,
 * the current sentence restarts. That is slightly less smooth than a native pause but it behaves the same in every browser
 * (native pause is unreliable on Android and some desktop engines). A generation number makes the end/error/boundary events of a
 * cancelled utterance harmless.
 */
export class ReadAloudEngine {
  private chunks: string[] = [];
  private index = 0;
  /** Characters of the current chunk already spoken (the last word boundary, or where this utterance began). */
  private pos = 0;
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
    this.index = 0; this.pos = 0;
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
    this.chunks = []; this.index = 0; this.pos = 0;
    if (this.state.status !== "idle") this.set(READ_IDLE);
  }

  /** A new rate or voice takes effect now (the current chunk continues from the last spoken word) while speaking, or on resume while paused. */
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
    const chunk = this.chunks[this.index];
    if (chunk === undefined) { this.finish(); return; }
    // Continue from the remembered word. A boundary's charIndex is relative to the text this utterance speaks, so `start` turns
    // it back into a position in the chunk.
    const text = chunk.slice(Math.min(this.pos, chunk.length)).trimStart();
    if (!text) { this.advance(); return; }
    const start = chunk.length - text.length;
    this.pos = start;
    let u: any;
    try { u = this.env.makeUtterance(text); } catch { this.finish(); return; }
    const lang = this.env.pageLang();
    const voice = pickVoice(this.voices(), lang, this.voiceURI);
    try {
      u.rate = this.rate;
      u.lang = voice?.lang || lang || "en-GB";
      if (voice) u.voice = voice;
    } catch { /* the browser's defaults are used */ }
    u.onboundary = (ev: any) => {
      if (gen !== this.gen || (ev?.name && ev.name !== "word")) return;
      const at = Number(ev?.charIndex);
      if (Number.isFinite(at) && at >= 0 && start + at < chunk.length) this.pos = Math.max(this.pos, start + at);
    };
    u.onend = () => { if (gen === this.gen) this.advance(); };
    u.onerror = () => { if (gen === this.gen) this.finish(); };
    try { this.env.synth.speak(u); } catch { this.finish(); }
  }

  /** The current chunk is done: on to the next, or finish. */
  private advance() {
    this.index++; this.pos = 0;
    if (this.index >= this.chunks.length) this.finish();
    else { this.set({ ...this.state, index: this.index }); this.speakCurrent(); }
  }

  private finish() {
    this.chunks = []; this.index = 0; this.pos = 0;
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
  /** This session's final transcripts by result index (rebuilt from every event's full result list). */
  private finals: string[] = [];
  /** The merged text this session has already handed out (via onFinal / onRevise). */
  private inserted = "";
  private state: DictationState = DICTATION_IDLE;
  private listeners = new Set<(s: DictationState) => void>();
  /** New words to add after what this session has already delivered. */
  onFinal: (text: string) => void = () => {};
  /** The engine revised words it had already delivered: replace `previous` (this session's delivered text) with `next`. */
  onRevise: (previous: string, next: string) => void = () => {};
  /** A new session begins (the page forgets where the previous one wrote). */
  onSessionStart: () => void = () => {};

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
    this.finals = []; this.inserted = "";
    this.onSessionStart();
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
      const results = ev?.results;
      const interims: string[] = [];
      for (let i = 0; i < (results?.length ?? 0); i++) {
        const r = results[i];
        const t = String(r?.[0]?.transcript ?? "");
        if (r?.isFinal) this.finals[i] = t; else interims.push(t);
      }
      // Android Chrome reports each growing hypothesis as its own final, so the session's finals are merged, and only what is
      // new against what was already delivered goes out.
      const merged = mergeFinalSegments(this.finals.filter(t => t !== undefined));
      const had = this.inserted;
      if (merged && merged.toLowerCase() !== had.toLowerCase()) {
        this.dispatch({ type: "final" });
        this.inserted = merged;
        if (merged.toLowerCase().startsWith(had.toLowerCase())) {
          const delta = merged.slice(had.length).trim();
          if (delta) this.onFinal(delta);
        } else this.onRevise(had, merged);
      }
      this.dispatch({ type: "interim", text: mergeFinalSegments(interims) });
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

/* ------------------------------------------------------------------ writing a dictation session into a field */

export type DictationField = {
  value: string; selectionStart: number | null; selectionEnd: number | null; maxLength: number;
  setSelectionRange(start: number, end: number): void;
};

/**
 * Writes one dictation session's words into a text field, remembering the span they occupy so that when the engine REVISES words it
 * already delivered, that span is replaced (never appended again) and the learner's other text, before and after, is untouched.
 */
export class DictationFieldWriter {
  private span: { start: number; end: number } | null = null;
  constructor(
    private getField: () => DictationField | null,
    private onValue: (next: string) => void,
    private schedule: (fn: () => void) => void = fn => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(fn); },
  ) {}

  /** A new session: forget the previous span. */
  reset() { this.span = null; }

  private write(el: DictationField, value: string, caret: number) {
    this.onValue(value);
    // Keep the DOM current so a following result reads the right value before React has re-rendered.
    try { el.value = value; el.setSelectionRange(caret, caret); } catch { /* not a text field */ }
    // The caret follows the words once React has written the value back.
    this.schedule(() => { try { el.setSelectionRange(caret, caret); } catch { /* not a text field */ } });
  }

  append(text: string) {
    const el = this.getField();
    if (!el) return;
    const max = el.maxLength > 0 ? el.maxLength : undefined;
    const s = el.selectionStart ?? el.value.length, e = el.selectionEnd ?? el.value.length;
    const r = insertAtCursor(el.value, s, e, text, max);
    if (r.value === el.value) return;
    const start = Math.min(s, e);
    // Contiguous with the previous words (the caret sits at their end): the span grows; otherwise a new span starts here.
    this.span = this.span && this.span.end === start && s === e ? { start: this.span.start, end: r.caret } : { start, end: r.caret };
    this.write(el, r.value, r.caret);
  }

  revise(previous: string, next: string) {
    const el = this.getField();
    if (!el) return;
    const norm = (t: string) => t.replace(/\s+/g, " ").trim();
    let span = this.span;
    if (!span || norm(el.value.slice(span.start, span.end)) !== norm(previous)) {
      // The learner edited or moved things: find the old words as they stand, else just add the new words at the caret.
      const at = previous ? el.value.indexOf(previous) : -1;
      if (at < 0) { this.span = null; this.append(next); return; }
      span = { start: at, end: at + previous.length };
    }
    const old = el.value.slice(span.start, span.end);
    const lead = old.length - old.trimStart().length;
    const trail = old.length - old.trimEnd().length;
    const innerStart = span.start + lead, innerEnd = Math.max(innerStart, span.end - trail);
    let ins = norm(next);
    const max = el.maxLength > 0 ? el.maxLength : undefined;
    if (max) { const room = max - (el.value.length - (innerEnd - innerStart)); ins = ins.slice(0, Math.max(0, room)); }
    const value = el.value.slice(0, innerStart) + ins + el.value.slice(innerEnd);
    const caret = innerStart + ins.length;
    this.span = { start: span.start, end: caret + trail };
    this.write(el, value, caret + trail);
  }
}
