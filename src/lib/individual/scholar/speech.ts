// ── SCHOLAR-CE-2026 CE-06: THE PURE PART OF READ-ALOUD AND DICTATION ──────────────────────────────────────────────────────
//
// DEVICE-NATIVE. Read-aloud is the browser's speech synthesis; dictation is the browser's speech recognition. There is no
// server audio, no new AI call and no audio kept by Competen. This file holds only what can be tested without a browser:
// cleaning text for the voice, splitting it into speakable chunks, choosing a voice, detecting support, the dictation state
// machine and the insert-at-cursor rule. Client-safe: no React, no DOM types are required at call sites.
//
// The words below deliberately name no product or vendor in identifiers ("your browser's speech service").

import { parseDiagram, type DiagramBlock, type FlowKind } from "./answer-format";
import { flowOutline, mapOutline } from "./diagram-layout";

/* ------------------------------------------------------------------ support detection */

export type SpeechSupport = { synthesis: boolean; recognition: boolean };

/** Pure. What a window-like object offers. Never throws. Unknown (no window, e.g. the server render) is "none". */
export function detectSpeechSupport(win: unknown): SpeechSupport {
  const w = (win ?? null) as Record<string, unknown> | null;
  if (!w || typeof w !== "object") return { synthesis: false, recognition: false };
  let synthesis = false, recognition = false;
  try {
    synthesis = !!w.speechSynthesis && typeof w.SpeechSynthesisUtterance === "function";
    recognition = typeof w.SpeechRecognition === "function" || typeof w.webkitSpeechRecognition === "function";
  } catch { /* an unreadable property means "not available" */ }
  return { synthesis, recognition };
}

/** The recognition constructor a window offers (standard name first, then the prefixed one), or null. */
export function recognitionCtor(win: unknown): (new () => unknown) | null {
  const w = (win ?? null) as Record<string, unknown> | null;
  if (!w || typeof w !== "object") return null;
  try {
    const c = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    return typeof c === "function" ? (c as new () => unknown) : null;
  } catch { return null; }
}

/* ------------------------------------------------------------------ diagrams, spoken */

// The fence the answer parser recognises: ```flow / ```map / ```timeline on a line of its own, closed by a bare ``` line.
const DIAGRAM_FENCE_RE = /^[ \t]*```[ \t]*(flow|map|timeline)[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gim;

const KIND_WORD: Record<FlowKind, string> = { start: "Start", step: "Step", decision: "Decision", end: "End" };
const asSentence = (s: string, mark = ".") => { const t = s.trim(); return /[.!?…]["')\]]*$/.test(t) ? t : t + mark; };
// "Yes" -> "yes", but an acronym ("ICU admitted") keeps its capitals.
const lowerFirst = (s: string) => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pure. A diagram as plain sentences, built from flowOutline / mapOutline (the same text alternative the Diagram gives a screen
 * reader): "Flowchart: Title. Step 1, Start: ... Step 2, Decision: ...? If yes, go to step 3; if no, go to step 5." No symbols.
 */
export function spokenDiagram(d: DiagramBlock): string {
  if (d.type === "flow") {
    const steps = flowOutline(d).map(s => {
      const head = `Step ${s.n}, ${KIND_WORD[s.kind]}: ${asSentence(s.label, s.kind === "decision" ? "?" : ".")}`;
      const goes = s.goes.map(g => `${g.label ? `${s.kind === "decision" ? "if " : ""}${lowerFirst(g.label)}, ` : ""}${g.loop ? "go back to" : "go to"} step ${g.to}`);
      return goes.length ? `${head} ${upperFirst(goes.join("; "))}.` : head;
    });
    return [`Flowchart: ${asSentence(d.title)}`, ...steps].join(" ");
  }
  if (d.type === "map") {
    const o = mapOutline(d);
    const rel = o.relations.map(r => asSentence(`${r.from} ${r.label ? lowerFirst(r.label) : "is linked to"} ${r.to}`));
    return [`Concept map: ${asSentence(d.title)}`, `Centre: ${asSentence(o.center)}`, ...rel, ...(o.alone.length ? [`Not linked: ${asSentence(o.alone.join("; "))}`] : [])].join(" ");
  }
  return [`Timeline: ${asSentence(d.title)}`, ...d.events.map(e => `${e.at}: ${asSentence(e.label)}`)].join(" ");
}

/* ------------------------------------------------------------------ cleaning text for the voice */

/**
 * Pure. Plain, speakable text from lesson or answer text: citation markers ([S1], [S1, S2], [R2], [E3], [1]), markdown
 * (headings, bold, italics, code, links, images, lists, quotes, tables, rules), callout tags and fenced blocks are removed or
 * reduced to their words. Paragraph breaks are kept as blank lines so the chunker can pause at them. A valid flow, map or
 * timeline fence is not dropped: it is spoken as the same outline the Diagram gives a screen reader (see spokenDiagram).
 */
export function stripForSpeech(input: string): string {
  let t = String(input ?? "").replace(/\r\n?/g, "\n");
  t = t.replace(DIAGRAM_FENCE_RE, (whole: string, kind: string, body: string) => {  // a valid diagram fence: spoken as its outline
    const d = parseDiagram(kind.toLowerCase() as "flow" | "map" | "timeline", body);
    return d ? `\n\n${spokenDiagram(d)}\n\n` : whole;                       // an invalid one is left for the fence rule below
  });
  t = t.replace(/```[\s\S]*?(```|$)/g, "\n");                       // other fenced blocks (code, the practice JSON, an invalid diagram): not spoken
  t = t.replace(/<[^>]{1,200}>/g, " ");                               // stray tags
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");                      // images: the alt text only
  t = t.replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1");                   // links: the words only
  t = t.replace(/\[\s*(?:[SRE]\s*\d+(?:\s*[,;–-]\s*[SRE]?\s*\d+)*)\s*\]/gi, ""); // [S1] [S1, S2] [R2] [E3]
  t = t.replace(/\[\s*\d+(?:\s*[,–-]\s*\d+)*\s*\]/g, "");              // [1] [1, 2] [1-3]
  t = t.replace(/\[!\w+\]\s*/g, "");                                   // > [!KEY] callout tags
  t = t.split("\n").map((line): string | null => {
    let l = line;
    if (/^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && /-/.test(l)) return null;  // a table's divider row
    if (/^\s*([-*_])\1{2,}\s*$/.test(l)) return null;                    // a horizontal rule
    l = l.replace(/^\s{0,3}#{1,6}\s+/, "");                             // headings
    l = l.replace(/^\s*>+\s?/, "");                                      // quotes
    l = l.replace(/^\s*[-*+•]\s+/, "");                                  // bullets
    l = l.replace(/^\s*\d{1,3}[.)]\s+/, "");                            // numbers
    if (l.includes("|")) l = l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(c => c.trim()).filter(Boolean).join(", ");
    return l;
  }).filter((l): l is string => l !== null).join("\n");
  t = t.replace(/(\*\*|__)(.+?)\1/g, "$2");                            // bold
  t = t.replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, "$1$2"); // italics
  t = t.replace(/`([^`\n]*)`/g, "$1");                                  // inline code
  t = t.replace(/[*~`#]+/g, "").replace(/(^|\s)_+|_+(?=\s|$)/g, "$1"); // leftover markers (an underscore inside a word stays)
  t = t.replace(/[ \t ]+/g, " ").replace(/ +\n/g, "\n").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n");
  t = t.replace(/\s+([,.;:!?])/g, "$1");                                // a space left in front of punctuation by a removed marker
  return t.trim();
}

/* ------------------------------------------------------------------ chunking */

export const CHUNK_MAX = 240;

// A full stop after one of these does not end a sentence.
const ABBREV = new Set(["e.g", "i.e", "etc", "vs", "dr", "mr", "mrs", "ms", "prof", "fig", "no", "approx", "ca", "cf", "st", "mg", "ml", "kg"]);

function sentencesOf(paragraph: string): string[] {
  const out: string[] = [];
  const re = /[.!?…]+["')\]]*(\s+|$)/g;
  let start = 0, m: RegExpExecArray | null;
  while ((m = re.exec(paragraph))) {
    const end = m.index + m[0].length;
    const before = paragraph.slice(start, m.index);
    const lastWord = (before.match(/([A-Za-z.]+)$/)?.[1] ?? "").toLowerCase();
    const isAbbrev = m[0].startsWith(".") && !m[0].startsWith("..") && (ABBREV.has(lastWord) || /^[a-z]$/.test(lastWord));
    if (isAbbrev && end < paragraph.length) continue;
    out.push(paragraph.slice(start, end).trim());
    start = end;
  }
  const rest = paragraph.slice(start).trim();
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/** A sentence longer than `max` is cut at a clause mark, else at a space, never inside a word. */
function cutLong(s: string, max: number): string[] {
  if (s.length <= max) return [s];
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    const win = rest.slice(0, max);
    let cut = Math.max(win.lastIndexOf(", "), win.lastIndexOf("; "), win.lastIndexOf(": "));
    if (cut < max * 0.4) cut = win.lastIndexOf(" ");
    if (cut < 1) cut = max;
    else cut += 1;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.filter(Boolean);
}

/**
 * Pure. Speakable chunks of a text: cleaned (stripForSpeech), split at paragraphs and sentences, ONE SENTENCE PER CHUNK, so that
 * pausing and resuming repeats at most one sentence. A sentence longer than `max` characters is cut at a clause mark, else at a
 * space. A paragraph never shares a chunk with the next, so a pause falls there.
 */
export function chunkForSpeech(input: string, max: number = CHUNK_MAX): string[] {
  const cleaned = stripForSpeech(input);
  if (!cleaned) return [];
  const limit = Math.max(40, Math.floor(max));
  const chunks: string[] = [];
  for (const para of cleaned.split(/\n{2,}/)) {
    const flat = para.replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (!flat) continue;
    for (const piece of sentencesOf(flat).flatMap(x => cutLong(x, limit))) chunks.push(piece);
  }
  return chunks;
}

/* ------------------------------------------------------------------ rate and voice */

export const READ_RATES = [0.8, 1, 1.2, 1.5] as const;
export type ReadRate = (typeof READ_RATES)[number];

/** Pure. One of the four offered rates, else 1. */
export function parseRate(v: unknown): ReadRate {
  const n = typeof v === "string" ? Number(v) : v;
  return (READ_RATES as readonly unknown[]).includes(n) ? (n as ReadRate) : 1;
}

export type VoiceLike = { name: string; lang: string; voiceURI: string; localService?: boolean; default?: boolean };

const normLang = (l: string) => String(l ?? "").replace(/_/g, "-").toLowerCase();
const primary = (l: string) => normLang(l).split("-")[0];

/**
 * Pure. The voice to use: the learner's choice (by voiceURI) if it is still offered; otherwise the best match for the page
 * language -- the exact locale, then (for English) en-GB, then any voice of the same language, then English en-GB, then any
 * English. Ties go to the browser's default voice, then to a voice on this device (it works offline). null = let the browser
 * choose, which is correct when nothing matches.
 */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], pageLang: string | null | undefined, preferredURI?: string | null): V | null {
  if (!voices.length) return null;
  if (preferredURI) { const chosen = voices.find(v => v.voiceURI === preferredURI); if (chosen) return chosen; }
  const want = normLang(pageLang || "en-GB") || "en-gb";
  const wantPrimary = primary(want);
  const tiers: Array<(v: V) => boolean> = [
    v => normLang(v.lang) === want,
    ...(wantPrimary === "en" ? [(v: V) => normLang(v.lang) === "en-gb"] : []),
    v => primary(v.lang) === wantPrimary,
    v => normLang(v.lang) === "en-gb",
    v => primary(v.lang) === "en",
  ];
  const better = (a: V, b: V) => (b.default ? 1 : 0) - (a.default ? 1 : 0) || (b.localService ? 1 : 0) - (a.localService ? 1 : 0);
  for (const test of tiers) {
    const hit = voices.filter(test).sort(better)[0];
    if (hit) return hit;
  }
  return null;
}

/* ------------------------------------------------------------------ dictation state machine */

export type DictationError = "not_supported" | "denied" | "no_speech" | "no_microphone" | "network" | "failed";
export type DictationState = { status: "idle" | "starting" | "listening" | "error"; interim: string; error: DictationError | null };
export type DictationEvent =
  | { type: "start" } | { type: "started" } | { type: "interim"; text: string } | { type: "final" }
  | { type: "end" } | { type: "stop" } | { type: "silence" } | { type: "error"; code: DictationError };

export const DICTATION_IDLE: DictationState = { status: "idle", interim: "", error: null };

/** Pure. The dictation state machine. A stop, a silence time-out and the engine's own end all return to idle (not an error). */
export function dictationReducer(s: DictationState, e: DictationEvent): DictationState {
  switch (e.type) {
    case "start": return s.status === "starting" || s.status === "listening" ? s : { status: "starting", interim: "", error: null };
    case "started": return s.status === "starting" ? { ...s, status: "listening" } : s;
    case "interim": return s.status === "listening" || s.status === "starting" ? { status: "listening", interim: e.text, error: null } : s;
    case "final": return s.status === "listening" ? { ...s, interim: "" } : s;
    case "stop": case "silence": case "end": return s.status === "error" ? s : DICTATION_IDLE;
    case "error": return { status: "error", interim: "", error: e.code };
  }
}

/** Pure. A recognition engine's error name as one of our states; null for ones that are not errors (the learner or page stopped it). */
export function mapRecognitionError(name: unknown): DictationError | null {
  switch (String(name ?? "")) {
    case "not-allowed": case "service-not-allowed": return "denied";
    case "no-speech": return "no_speech";
    case "audio-capture": return "no_microphone";
    case "network": return "network";
    case "aborted": return null;
    case "language-not-supported": case "bad-grammar": return "failed";
    default: return "failed";
  }
}

export const DICTATION_ERROR_TEXT: Record<DictationError, string> = {
  not_supported: "Dictation is not available in this browser.",
  denied: "Your browser did not allow the microphone. Allow it for this site in the browser's site settings, then try again.",
  no_speech: "No speech was heard. Press Dictate and speak when you are ready.",
  no_microphone: "No microphone was found on this device.",
  network: "Your browser's speech service could not be reached. Check your connection and try again.",
  failed: "Dictation stopped. You can try again, or type instead.",
};

/** Silence after the last words (or after starting) before dictation stops itself. */
export const DICTATION_SILENCE_MS = 6000;

/* ------------------------------------------------------------------ insert at the cursor */

/**
 * Pure. `text` placed at the caret (or over the selection) of `value`, with a space added only where the neighbouring text needs one.
 * Returns the new value and where the caret goes (just after what was inserted). Respects `maxLength` by dropping what does not fit.
 */
export function insertAtCursor(value: string, start: number, end: number, text: string, maxLength?: number): { value: string; caret: number } {
  const v = String(value ?? "");
  const s = Math.min(Math.max(0, Number.isFinite(start) ? start : v.length), v.length);
  const e = Math.min(Math.max(s, Number.isFinite(end) ? end : s), v.length);
  let ins = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!ins) return { value: v, caret: s };
  const before = v.slice(0, s), after = v.slice(e);
  if (before && !/\s$/.test(before)) ins = " " + ins;
  if (after && !/^[\s.,;:!?)]/.test(after)) ins += " ";
  if (maxLength && maxLength > 0) {
    const room = maxLength - (before.length + after.length);
    if (room <= 0) return { value: v, caret: s };
    if (ins.length > room) ins = ins.slice(0, room);
  }
  return { value: before + ins + after, caret: before.length + ins.length };
}

/* ------------------------------------------------------------------ merging a session's final results */

const collapse = (t: string) => String(t ?? "").replace(/\s+/g, " ").trim();

/**
 * Pure. The intended text of ALL the final transcripts one dictation session has produced, in order. Some engines (Android Chrome)
 * report each growing hypothesis as its own "final" result -- "teach", "teach me", "teach me about" -- or repeat one; appending
 * every final would repeat the words. So: a final that extends (or equals) the last segment REPLACES it; a final that is a shorter
 * repeat of the last segment is ignored; anything else is a new segment (desktop Chrome's distinct sentences simply append).
 * Prefix tests are case-insensitive; the text kept is the latest, longest form. Segments are joined by single spaces.
 */
export function mergeFinalSegments(finals: readonly string[]): string {
  const segs: string[] = [];
  for (const raw of finals) {
    const t = collapse(raw);
    if (!t) continue;
    const last = segs[segs.length - 1];
    if (last !== undefined) {
      const lo = last.toLowerCase(), tl = t.toLowerCase();
      if (tl.startsWith(lo)) { segs[segs.length - 1] = t; continue; }
      if (lo.startsWith(tl)) continue;
    }
    segs.push(t);
  }
  return segs.join(" ");
}

/* ------------------------------------------------------------------ preference ("Read-aloud and dictation") */

export const SPEECH_ENABLED_KEY = "scholar.speech.enabled";
export const SPEECH_RATE_KEY = "scholar.speech.rate";
export const SPEECH_VOICE_KEY = "scholar.speech.voice";

/** Pure. On unless the stored value is exactly "off". Anything unreadable is the default (on). */
export const parseSpeechEnabled = (raw: unknown): boolean => raw !== "off";

export const SPEECH_PRIVACY_NOTE =
  "Dictation uses your browser's speech service. Some browsers send audio to their provider (for example Google in Chrome). Competen does not receive or keep the audio.";
