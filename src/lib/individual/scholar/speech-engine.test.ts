import { describe, expect, it } from "vitest";
import { DictationEngine, ReadAloudEngine, type RecognitionEnv, type SynthEnv } from "./speech-engine";

/* eslint-disable @typescript-eslint/no-explicit-any */

function mockSynth(voices: any[] = [{ name: "gb", lang: "en-GB", voiceURI: "gb" }, { name: "us", lang: "en-US", voiceURI: "us" }]) {
  const spoken: any[] = [];
  let cancels = 0;
  const env: SynthEnv = {
    synth: { speak: (u: any) => { spoken.push(u); }, cancel: () => { cancels++; }, getVoices: () => voices },
    makeUtterance: (text: string) => ({ text }),
    pageLang: () => "en-GB",
  };
  return { env, spoken, cancels: () => cancels, last: () => spoken[spoken.length - 1] };
}

describe("ReadAloudEngine", () => {
  const long = "First sentence here. Second sentence follows.\n\nThird paragraph begins. And ends.";
  it("speaks chunk by chunk and ends idle", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play(long);
    expect(e.getState()).toEqual({ status: "speaking", index: 0, total: 2 });
    expect(m.spoken).toHaveLength(1);
    m.last().onend();
    expect(e.getState()).toMatchObject({ status: "speaking", index: 1 });
    expect(m.spoken).toHaveLength(2);
    m.last().onend();
    expect(e.getState().status).toBe("idle");
  });
  it("sets rate, the best voice and language on the utterance", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play("Hello there.", { rate: 1.2 });
    expect(m.last().rate).toBe(1.2);
    expect(m.last().voice.voiceURI).toBe("gb");
    expect(m.last().lang).toBe("en-GB");
  });
  it("pause cancels and resume restarts the same chunk", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play(long); m.last().onend();
    e.pause();
    expect(e.getState()).toMatchObject({ status: "paused", index: 1 });
    const stale = m.last();
    e.resume();
    expect(m.spoken).toHaveLength(3);
    expect(m.last().text).toBe(stale.text);
    stale.onend(); // the cancelled utterance's late event must change nothing
    expect(e.getState()).toMatchObject({ status: "speaking", index: 1 });
  });
  it("stop returns to idle and cancels", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play(long); const before = m.cancels();
    e.stop();
    expect(e.getState().status).toBe("idle");
    expect(m.cancels()).toBeGreaterThan(before);
    m.spoken[0].onend();
    expect(e.getState().status).toBe("idle");
  });
  it("a new rate or voice restarts the current chunk while speaking", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play(long);
    e.configure({ rate: 1.5, voiceURI: "us" });
    expect(m.spoken).toHaveLength(2);
    expect(m.last().rate).toBe(1.5);
    expect(m.last().voice.voiceURI).toBe("us");
  });
  it("does nothing audible for text with no words, and an engine error ends it quietly", () => {
    const m = mockSynth(); const e = new ReadAloudEngine(m.env);
    e.play("[S1]");
    expect(m.spoken).toHaveLength(0);
    expect(e.getState().status).toBe("idle");
    e.play("Some words.");
    m.last().onerror({ error: "synthesis-failed" });
    expect(e.getState().status).toBe("idle");
  });
});

function mockRecognition(opts: { startThrows?: boolean } = {}) {
  const timers: Array<{ id: number; fn: () => void; ms: number }> = [];
  let next = 1;
  const instances: any[] = [];
  class Rec {
    continuous = false; interimResults = false; lang = ""; stopped = false; aborted = false;
    onstart: any; onresult: any; onerror: any; onend: any;
    constructor() { instances.push(this); }
    start() { if (opts.startThrows) throw new Error("InvalidStateError"); this.onstart?.(); }
    stop() { this.stopped = true; this.onend?.(); }
    abort() { this.aborted = true; }
  }
  const env: RecognitionEnv = {
    ctor: Rec as any, lang: () => "en-GB",
    setTimer: (fn, ms) => { const id = next++; timers.push({ id, fn, ms }); return id; },
    clearTimer: (id: any) => { const i = timers.findIndex(t => t.id === id); if (i >= 0) timers.splice(i, 1); },
  };
  return { env, timers, instances, rec: () => instances[instances.length - 1] };
}
const result = (items: Array<[string, boolean]>, resultIndex = 0) => ({ resultIndex, results: items.map(([t, f]) => Object.assign([{ transcript: t }], { isFinal: f })) });

describe("DictationEngine", () => {
  it("reports interim text and delivers final text once", () => {
    const m = mockRecognition(); const e = new DictationEngine(m.env); const got: string[] = [];
    e.onFinal = t => got.push(t);
    e.start();
    expect(e.getState().status).toBe("listening");
    expect(m.rec().continuous).toBe(true);
    expect(m.rec().interimResults).toBe(true);
    expect(m.rec().lang).toBe("en-GB");
    m.rec().onresult(result([["patient has a fev", false]]));
    expect(e.getState().interim).toBe("patient has a fev");
    m.rec().onresult(result([["patient has a fever", true]]));
    expect(got).toEqual(["patient has a fever"]);
    expect(e.getState().interim).toBe("");
    // an engine that repeats earlier results with resultIndex 0 must not duplicate text
    m.rec().onresult(result([["patient has a fever", true], ["and a cough", true]]));
    expect(got).toEqual(["patient has a fever", "and a cough"]);
  });
  it("stops itself after silence and returns to idle with no error", () => {
    const m = mockRecognition(); const e = new DictationEngine(m.env);
    e.start();
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0].ms).toBe(6000);
    m.timers[0].fn();
    expect(m.rec().stopped).toBe(true);
    expect(e.getState().status).toBe("idle");
  });
  it("speech restarts the silence timer", () => {
    const m = mockRecognition(); const e = new DictationEngine(m.env);
    e.start();
    const first = m.timers[0].id;
    m.rec().onresult(result([["hi", false]]));
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0].id).not.toBe(first);
  });
  it("maps errors and clears the timer", () => {
    const m = mockRecognition(); const e = new DictationEngine(m.env);
    e.start();
    m.rec().onerror({ error: "not-allowed" });
    expect(e.getState()).toMatchObject({ status: "error", error: "denied" });
    expect(m.timers).toHaveLength(0);
    m.rec().onend?.();
    expect(e.getState().status).toBe("error");
    e.reset();
    expect(e.getState().status).toBe("idle");
  });
  it("is an error state, not a throw, with no recognition constructor or a failing start", () => {
    const e = new DictationEngine({ ...mockRecognition().env, ctor: null });
    e.start();
    expect(e.getState()).toMatchObject({ status: "error", error: "not_supported" });
    const f = new DictationEngine(mockRecognition({ startThrows: true }).env);
    f.start();
    expect(f.getState()).toMatchObject({ status: "error", error: "failed" });
  });
  it("manual stop is idle, still delivers a late final, and dispose releases the microphone", () => {
    const m = mockRecognition(); const e = new DictationEngine(m.env); const got: string[] = [];
    e.onFinal = t => got.push(t);
    e.start();
    const rec = m.rec();
    rec.onresult(result([["last words", true]]));
    e.stop();
    expect(e.getState().status).toBe("idle");
    expect(got).toEqual(["last words"]);
    rec.onresult(result([["after the end", true]]));   // a result after the session ended is dropped
    expect(got).toEqual(["last words"]);
    e.start();
    const second = m.rec();
    e.dispose();
    expect(second.aborted).toBe(true);
    expect(m.timers).toHaveLength(0);
  });
});
