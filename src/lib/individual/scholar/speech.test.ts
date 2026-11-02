import { describe, expect, it } from "vitest";
import {
  CHUNK_MAX, DICTATION_IDLE, chunkForSpeech, detectSpeechSupport, dictationReducer, insertAtCursor, mapRecognitionError,
  parseRate, parseSpeechEnabled, pickVoice, recognitionCtor, stripForSpeech, type DictationEvent, type DictationState,
} from "./speech";

describe("stripForSpeech", () => {
  it("removes citation markers of every kind", () => {
    expect(stripForSpeech("Sepsis is life-threatening [S1]. It needs fluids [S2, S3] and antibiotics [R1][E2] [1] [1-3].")).toBe(
      "Sepsis is life-threatening. It needs fluids and antibiotics.");
  });
  it("reduces markdown to its words", () => {
    const md = "## Heading\n\n**Bold** and *italic* and `code` and [a link](https://x.test) here.\n\n- one\n- two\n1. three\n> quoted";
    const out = stripForSpeech(md);
    expect(out).toBe("Heading\n\nBold and italic and code and a link here.\n\none\ntwo\nthree\nquoted");
    expect(out).not.toMatch(/[*_`#>[\]]/);
  });
  it("drops fenced blocks, callout tags, rules and table dividers", () => {
    const out = stripForSpeech("> [!KEY] Remember this\n\n```practice\n{\"a\":1}\n```\n\n---\n\n| A | B |\n|---|---|\n| 1 | 2 |");
    expect(out).toBe("Remember this\n\nA, B\n1, 2");
  });
  it("is safe on empty and non-string input", () => {
    expect(stripForSpeech("")).toBe("");
    expect(stripForSpeech(undefined as unknown as string)).toBe("");
  });
  it("keeps decimals and underscores inside words", () => {
    expect(stripForSpeech("Give 1.5 mg of snake_case_word")).toBe("Give 1.5 mg of snake_case_word");
  });
});

describe("chunkForSpeech", () => {
  it("splits into sentences packed under the limit and never loses words", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} says something useful.`).join(" ");
    const chunks = chunkForSpeech(text);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(CHUNK_MAX);
    expect(chunks.join(" ")).toBe(text);
  });
  it("does not split after abbreviations or decimals", () => {
    const chunks = chunkForSpeech("Use e.g. 1.5 mg daily with water. Dr. Smith agrees.", 40);
    expect(chunks.join(" ")).toBe("Use e.g. 1.5 mg daily with water. Dr. Smith agrees.");
    expect(chunks[0]).toBe("Use e.g. 1.5 mg daily with water.");
  });
  it("keeps paragraphs apart so a pause falls between them", () => {
    expect(chunkForSpeech("One short.\n\nTwo short.")).toEqual(["One short.", "Two short."]);
  });
  it("cuts one very long sentence at clause marks, then spaces, never inside a word", () => {
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ") + ".";
    const chunks = chunkForSpeech(long, 100);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100);
    expect(chunks.join(" ")).toBe(long);
    const comma = chunkForSpeech(`${"alpha ".repeat(10)}one, ${"beta ".repeat(20)}two.`, 120);
    expect(comma[0].endsWith(",")).toBe(true);
  });
  it("returns nothing for text with only markers", () => {
    expect(chunkForSpeech("[S1] ** ``")).toEqual([]);
    expect(chunkForSpeech("")).toEqual([]);
  });
});

describe("parseRate / parseSpeechEnabled", () => {
  it("accepts only the four rates", () => {
    expect(parseRate(0.8)).toBe(0.8);
    expect(parseRate("1.5")).toBe(1.5);
    expect(parseRate(2)).toBe(1);
    expect(parseRate(null)).toBe(1);
  });
  it("is on unless exactly off", () => {
    expect(parseSpeechEnabled(null)).toBe(true);
    expect(parseSpeechEnabled("on")).toBe(true);
    expect(parseSpeechEnabled("garbage")).toBe(true);
    expect(parseSpeechEnabled("off")).toBe(false);
  });
});

describe("pickVoice", () => {
  const v = (name: string, lang: string, extra: Partial<{ default: boolean; localService: boolean }> = {}) => ({ name, lang, voiceURI: name, ...extra });
  const voices = [v("us", "en-US"), v("au", "en-AU"), v("gb", "en-GB"), v("fr", "fr-FR")];
  it("prefers the exact page locale", () => expect(pickVoice(voices, "en-US")?.name).toBe("us"));
  it("prefers en-GB for other English", () => expect(pickVoice(voices, "en-NZ")?.name).toBe("gb"));
  it("understands underscore locales", () => expect(pickVoice([v("x", "en_GB"), v("us", "en-US")], "en-GB")?.name).toBe("x"));
  it("falls back to en-GB then any English when the page language has no voice", () => {
    expect(pickVoice(voices, "de-DE")?.name).toBe("gb");
    expect(pickVoice([v("us", "en-US")], "de-DE")?.name).toBe("us");
  });
  it("matches by primary language", () => expect(pickVoice(voices, "fr-CA")?.name).toBe("fr"));
  it("honours the learner's choice while it is offered, and ignores it when it is gone", () => {
    expect(pickVoice(voices, "en-GB", "au")?.name).toBe("au");
    expect(pickVoice(voices, "en-GB", "missing")?.name).toBe("gb");
  });
  it("breaks ties on default then on-device voices", () => {
    const tie = [v("a", "en-GB", { localService: false }), v("b", "en-GB", { localService: true }), v("c", "en-GB", { default: true })];
    expect(pickVoice(tie, "en-GB")?.name).toBe("c");
    expect(pickVoice(tie.slice(0, 2), "en-GB")?.name).toBe("b");
  });
  it("returns null with no voices or no usable match", () => {
    expect(pickVoice([], "en-GB")).toBeNull();
    expect(pickVoice([v("fr", "fr-FR")], "de-DE")).toBeNull();
  });
});

describe("detectSpeechSupport / recognitionCtor", () => {
  class U {}
  class R {}
  it("needs both the synth and the utterance for read-aloud", () => {
    expect(detectSpeechSupport({ speechSynthesis: {}, SpeechSynthesisUtterance: U })).toEqual({ synthesis: true, recognition: false });
    expect(detectSpeechSupport({ speechSynthesis: {} }).synthesis).toBe(false);
  });
  it("accepts the standard or the prefixed recognition constructor", () => {
    expect(detectSpeechSupport({ SpeechRecognition: R }).recognition).toBe(true);
    expect(detectSpeechSupport({ webkitSpeechRecognition: R }).recognition).toBe(true);
    expect(recognitionCtor({ webkitSpeechRecognition: R })).toBe(R);
    expect(recognitionCtor({})).toBeNull();
  });
  it("is none for no window and never throws on a hostile object", () => {
    expect(detectSpeechSupport(undefined)).toEqual({ synthesis: false, recognition: false });
    const hostile = new Proxy({}, { get() { throw new Error("no"); } });
    expect(detectSpeechSupport(hostile)).toEqual({ synthesis: false, recognition: false });
    expect(recognitionCtor(hostile)).toBeNull();
  });
});

describe("dictationReducer", () => {
  const run = (...events: DictationEvent[]): DictationState => events.reduce(dictationReducer, DICTATION_IDLE);
  it("goes idle -> starting -> listening", () => {
    expect(run({ type: "start" }).status).toBe("starting");
    expect(run({ type: "start" }, { type: "started" }).status).toBe("listening");
  });
  it("holds interim text and clears it on a final", () => {
    const s = run({ type: "start" }, { type: "started" }, { type: "interim", text: "hello wor" });
    expect(s.interim).toBe("hello wor");
    expect(dictationReducer(s, { type: "final" }).interim).toBe("");
  });
  it("returns to idle on stop, silence and end, without an error", () => {
    for (const type of ["stop", "silence", "end"] as const) {
      expect(run({ type: "start" }, { type: "started" }, { type })).toEqual(DICTATION_IDLE);
    }
  });
  it("keeps an error through the engine's following end, and a new start clears it", () => {
    const err = run({ type: "start" }, { type: "error", code: "denied" }, { type: "end" });
    expect(err).toEqual({ status: "error", interim: "", error: "denied" });
    expect(dictationReducer(err, { type: "start" })).toEqual({ status: "starting", interim: "", error: null });
  });
  it("ignores stray events while idle", () => {
    expect(run({ type: "interim", text: "x" })).toBe(DICTATION_IDLE);
    expect(run({ type: "started" })).toBe(DICTATION_IDLE);
  });
});

describe("mapRecognitionError", () => {
  it("maps the engine's names", () => {
    expect(mapRecognitionError("not-allowed")).toBe("denied");
    expect(mapRecognitionError("service-not-allowed")).toBe("denied");
    expect(mapRecognitionError("no-speech")).toBe("no_speech");
    expect(mapRecognitionError("audio-capture")).toBe("no_microphone");
    expect(mapRecognitionError("network")).toBe("network");
    expect(mapRecognitionError("something-else")).toBe("failed");
  });
  it("treats aborted as not an error", () => expect(mapRecognitionError("aborted")).toBeNull());
});

describe("insertAtCursor", () => {
  it("inserts at the caret with spaces only where needed", () => {
    expect(insertAtCursor("Hello world", 5, 5, "there")).toEqual({ value: "Hello there world", caret: 11 });
    expect(insertAtCursor("", 0, 0, "first words")).toEqual({ value: "first words", caret: 11 });
    expect(insertAtCursor("Done.", 5, 5, "next")).toEqual({ value: "Done. next", caret: 10 });
  });
  it("does not put a space before punctuation that follows", () => {
    expect(insertAtCursor("Fine.", 4, 4, "really")).toEqual({ value: "Fine really.", caret: 11 });
  });
  it("replaces a selection and clamps wild positions", () => {
    expect(insertAtCursor("abc def ghi", 4, 7, "XYZ").value).toBe("abc XYZ ghi");
    expect(insertAtCursor("abc", 99, 120, "d").value).toBe("abc d");
    expect(insertAtCursor("abc", NaN, NaN, "d").value).toBe("abc d");
  });
  it("collapses the dictated text's whitespace and ignores empty text", () => {
    expect(insertAtCursor("a", 1, 1, "  b \n c ").value).toBe("a b c");
    expect(insertAtCursor("a", 1, 1, "   ")).toEqual({ value: "a", caret: 1 });
  });
  it("never exceeds maxLength", () => {
    expect(insertAtCursor("12345", 5, 5, "abcdef", 8).value).toBe("12345 ab");
    expect(insertAtCursor("12345", 5, 5, "abc", 5).value).toBe("12345");
  });
});
