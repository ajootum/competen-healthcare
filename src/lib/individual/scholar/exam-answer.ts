import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";
import { CONTENT_STATUS_LABEL } from "./config";
import { findPatientIdentifiers } from "./extract";
import { groundingViolations, passageCitation, type Passage } from "./generation";
import type { ResearchSource } from "./exam-research";
import type { PhrasingViolation } from "@/lib/ai/grounding";
import { feedbackPartsFrom, feedbackText, type FeedbackParts } from "./question-intel";

// ── SUGGESTED ANSWERS TO EXAMINATION QUESTIONS ── COMPETEN-SCHOLAR-EXAM-PAPERS-01 (570) ──────────────────
//
// THE SAME ENGINE AS LEARN. Every call goes through Scholar's metered runner and generate(); the output is checked
// by the Holdings grounding verifier against the EVIDENCE it was given, and an answer that cites nothing, cites a
// tag it was not given, or carries a number, month or clinical finding the evidence and question do not contain is
// WITHHELD, not shown with a warning (generation.ts, the hard rule: a grounding failure is an answer, not an outage).
//
// THREE KINDS OF EVIDENCE, tagged so the student always sees where each sentence came from:
//   [N n]  the student's own notes (their other materials; never the paper itself)
//   [L n]  the governed Competen library: CFCA competencies and learning outcomes, with their review status
//   [W n]  public web sources the research returned, with publisher, date and the text cited from each
//
// EXAMINATION CONTEXT IS NOT CURRENT GUIDANCE. The answer says what the question expects (examAnswer), and
// separately what current dated sources say (currentGuidance), whether they agree, and where sources conflict. With
// no current source the guidance part says so -- it is never written from memory.
//
// UNCERTAINTY IS SAID. The model lists what it could not support and what it is unsure of; the check adds anything
// it finds (a guidance claim citing no current source). Nothing here is an answer key, a mark or competence.

// v2 (SCHOLAR-SQIE-01): with an attempt, five-part formative feedback on it (attemptFeedback), checked on its own.
export const ANSWER_PROMPT_VERSION = "exam-answer-v2";
export const FOLLOW_UP_PROMPT_VERSION = "exam-follow-up-v1";
export const GUIDE_PROMPT_VERSION = "exam-guide-v1";

export type EvidenceKind = "notes" | "library" | "web";
export type Evidence = {
  tag: string; kind: EvidenceKind; title: string; citation: string; text: string;
  url?: string | null; published?: string | null; retrievedAt?: string | null; status?: string | null;
  chunkId?: string | null; materialId?: string | null;
};

/** A governed library entry, as the Competen library holds it (CFCA). */
export type LibraryEntry = { id: string; code: string | null; title: string; outcome: string | null; contentStatus: string };

export const EVIDENCE_LABEL: Record<EvidenceKind, string> = { notes: "Your notes", library: "Competen library", web: "Web research" };

/** Pure. The evidence, tagged by kind and order. Each source is cited by its tag, and only by its tag. */
export function buildEvidence(passages: readonly Passage[], library: readonly LibraryEntry[], web: readonly ResearchSource[]): Evidence[] {
  return [
    ...passages.map((p, i) => ({ tag: `N${i + 1}`, kind: "notes" as const, title: p.materialTitle, citation: passageCitation(p), text: p.content, chunkId: p.chunkId, materialId: p.materialId })),
    ...library.map((e, i) => ({
      tag: `L${i + 1}`, kind: "library" as const, title: `${e.code ? `${e.code} ` : ""}${e.title}`,
      citation: `Competen library (${CONTENT_STATUS_LABEL[e.contentStatus as keyof typeof CONTENT_STATUS_LABEL] ?? e.contentStatus})`,
      text: [e.title, e.outcome].filter(Boolean).join(": "), status: e.contentStatus,
    })),
    ...web.map((s, i) => ({
      tag: `W${i + 1}`, kind: "web" as const, title: s.title, citation: `${s.publisher}${s.published ? `, ${s.published}` : ""}`,
      text: s.excerpt || s.title, url: s.url, published: s.published, retrievedAt: s.retrievedAt,
    })),
  ];
}

/** Pure. Library entries whose words overlap the question most (the student's programme or the reference collections). */
export function matchLibrary(question: string, entries: readonly { id: string; code: string | null; title: string; outcomes: string[]; contentStatus: string }[], limit = 3): LibraryEntry[] {
  const words = new Set(question.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  if (!words.size) return [];
  const scored = entries.flatMap(e => {
    const options = [{ outcome: null as string | null, text: e.title }, ...e.outcomes.map(o => ({ outcome: o, text: `${e.title} ${o}` }))];
    return options.map(o => ({ e, outcome: o.outcome, score: [...new Set(o.text.toLowerCase().match(/[a-z]{4,}/g) ?? [])].filter(w => words.has(w)).length }));
  }).filter(x => x.score >= 2).sort((a, b) => b.score - a.score);
  const out: LibraryEntry[] = [];
  for (const x of scored) {
    if (out.some(o => o.id === x.e.id)) continue;
    out.push({ id: x.e.id, code: x.e.code, title: x.e.title, outcome: x.outcome, contentStatus: x.e.contentStatus });
    if (out.length >= limit) break;
  }
  return out;
}

function evidenceBlock(evidence: readonly Evidence[]): string {
  if (!evidence.length) return "EVIDENCE: none was found.";
  return `EVIDENCE:\n\n${evidence.map(e => `[${e.tag}] ${EVIDENCE_LABEL[e.kind]}: ${e.title} (${e.citation})\n${e.text}`).join("\n\n")}`;
}

export const ANSWER_SYSTEM = [
  "You help a healthcare student study a past or practice examination paper. You write a SUGGESTED answer to one question, with an explanation, from the evidence you are given.",
  "Evidence is tagged: [N n] the student's own notes, [L n] the governed Competen library (competencies and outcomes), [W n] current public sources with dates.",
  "",
  "RULES, in order of importance:",
  "1. Use ONLY the evidence and the question. Do not add any fact, number, dose, value, date or finding that is not in them, even if you know it. If the evidence does not support an answer, say so in examAnswer and list what is missing.",
  "2. Cite the tags you rely on, in square brackets, after the sentence that uses them, for example [N2] or [W1]. Cite only tags you were given.",
  "3. examAnswer is the answer the examination question expects, in its own framing. currentGuidance is what CURRENT dated sources ([W n], or approved [L n]) say, and may differ: an older paper can expect an answer current guidance has changed. If no current source is given, currentGuidance is null and guidanceStatus is no_current_source.",
  "4. For a choice question, option is the label of the best supported option (or null if the evidence cannot decide), and optionNotes says briefly why each option is or is not supported, with citations.",
  "5. List in unsupported every part of the expected answer the evidence does not support, and in uncertainty anything you are unsure of. List in conflicts any claim on which the sources disagree, with the tags of each side.",
  "6. Keep every number, unit and clinical term exactly as the evidence writes it. This is study, not advice about any real patient.",
  "",
  "7. Only when the student's own attempt is given: attemptFeedback is formative feedback on it, from the evidence only -- right (what it got right), missing (concepts it missed), misconceptions (any mistaken idea in it), why (one sentence on why the suggested answer holds), next (one thing to revise next). Accept clinically equivalent wording. Never give a mark or a score. If the evidence does not let you judge the attempt reliably, attemptFeedback is null and you say so in uncertainty. With no attempt, attemptFeedback is null.",
  "",
  "Reply with ONE JSON object and nothing else:",
  '{"option": "B" | null, "examAnswer": "...", "explanation": "...", "optionNotes": [{"label": "A", "note": "..."}], "currentGuidance": "..." | null, "guidanceStatus": "agrees" | "differs" | "no_current_source" | "not_applicable", "conflicts": [{"claim": "...", "tags": ["W1", "N2"]}], "unsupported": ["..."], "uncertainty": ["..."], "attemptFeedback": {"right": ["..."], "missing": ["..."], "misconceptions": [], "why": "...", "next": "..."} | null}',
  "Keep examAnswer under 150 words and explanation under 250 words.",
].join("\n");

export function answerUserPrompt(question: string, evidence: readonly Evidence[], attempt: string | null): string {
  return [
    evidenceBlock(evidence),
    `THE QUESTION:\n${question}`,
    attempt ? `THE STUDENT'S OWN ATTEMPT (compare with it in the explanation, kindly; it is not evidence):\n${attempt}` : null,
  ].filter(Boolean).join("\n\n");
}

export type GuidanceStatus = "agrees" | "differs" | "no_current_source" | "not_applicable";
export type AnswerContent = {
  option: string | null;
  examAnswer: string;
  explanation: string;
  optionNotes: { label: string; note: string }[];
  currentGuidance: string | null;
  guidanceStatus: GuidanceStatus;
  conflicts: { claim: string; tags: string[] }[];
  unsupported: string[];
  uncertainty: string[];
  /** The tags the answer actually cited. */
  cited: string[];
  /** SCHOLAR-SQIE-01: formative feedback on the student's attempt, when there was one and it passed its own check. */
  attemptFeedback?: FeedbackParts | null;
};

export type AnswerCheck =
  | { ok: true; content: AnswerContent }
  | { ok: false; reason: "malformed" | "no_citation" | "bad_citation" | "ungrounded" | "identifier"; violations?: PhrasingViolation[] };

export const ANSWER_WITHHELD: Record<Exclude<AnswerCheck, { ok: true }>["reason"], string> = {
  malformed: "The suggested answer came back in a form that could not be read, so it was not shown. Try again.",
  no_citation: "The suggested answer did not say which evidence it came from, so it was not shown.",
  bad_citation: "The suggested answer cited evidence it was not given, so it was not shown.",
  ungrounded: "The suggested answer included details the evidence does not contain, so it was not shown.",
  identifier: "The suggested answer looked like it identified a patient, so it was not shown.",
};

const TAG_RE = /\[([NLW])(\d+)\]/g;
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map(x => str(x, max)).filter(Boolean).slice(0, n) : []);

/** Pure. The model's JSON → the answer shown, or withheld with the reason. */
export function checkAnswer(raw: string, evidence: readonly Evidence[], question: string, optionLabels: readonly string[], attempt: string | null = null): AnswerCheck {
  const m = raw.match(/\{[\s\S]*\}/);
  let j: Record<string, unknown>;
  try { j = m ? JSON.parse(m[0]) : null; } catch { return { ok: false, reason: "malformed" }; }
  if (!j || typeof j !== "object") return { ok: false, reason: "malformed" };
  const examAnswer = str(j.examAnswer, 3000);
  const explanation = str(j.explanation, 4000);
  if (!examAnswer) return { ok: false, reason: "malformed" };
  const optionNotes = Array.isArray(j.optionNotes)
    ? (j.optionNotes as unknown[]).flatMap(n => { const o = n as { label?: unknown; note?: unknown }; const label = str(o?.label, 3).toUpperCase(); const note = str(o?.note, 800); return label && note && optionLabels.includes(label) ? [{ label, note }] : []; }).slice(0, 10)
    : [];
  const rawOption = str(j.option, 3).toUpperCase();
  const option = rawOption && optionLabels.includes(rawOption) ? rawOption : null;
  let currentGuidance = str(j.currentGuidance, 3000) || null;
  let guidanceStatus = (["agrees", "differs", "no_current_source", "not_applicable"] as const).find(s => s === j.guidanceStatus) ?? "no_current_source";
  const conflicts = Array.isArray(j.conflicts)
    ? (j.conflicts as unknown[]).flatMap(c => { const o = c as { claim?: unknown; tags?: unknown }; const claim = str(o?.claim, 600); const tags = strs(o?.tags, 6, 4).map(t => t.replace(/[[\]]/g, "").toUpperCase()); return claim ? [{ claim, tags }] : []; }).slice(0, 6)
    : [];
  const unsupported = strs(j.unsupported, 8, 400);
  const uncertainty = strs(j.uncertainty, 8, 400);

  const prose = [examAnswer, explanation, ...optionNotes.map(n => n.note), currentGuidance ?? "", ...conflicts.map(c => c.claim)].join("\n");
  const tags = [...prose.matchAll(TAG_RE)].map(x => `${x[1]}${x[2]}`);
  const known = new Set(evidence.map(e => e.tag));
  if (!tags.length) return { ok: false, reason: "no_citation" };
  if (tags.some(t => !known.has(t)) || conflicts.some(c => c.tags.some(t => !known.has(t)))) return { ok: false, reason: "bad_citation" };
  if (findPatientIdentifiers(prose).length) return { ok: false, reason: "identifier" };
  const violations = groundingViolations(prose.replace(TAG_RE, " "), [...evidence.map(e => `${e.title}\n${e.citation}\n${e.text}`), question]);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };

  // Current guidance must rest on a current source: a web source, or a clinically approved library entry. A guidance
  // claim citing neither is not shown as guidance, and the student is told none was found.
  const current = new Set(evidence.filter(e => e.kind === "web" || (e.kind === "library" && e.status === "approved")).map(e => e.tag));
  const guidanceTags = currentGuidance ? [...currentGuidance.matchAll(TAG_RE)].map(x => `${x[1]}${x[2]}`) : [];
  if (currentGuidance && !guidanceTags.some(t => current.has(t))) {
    currentGuidance = null;
    guidanceStatus = "no_current_source";
    uncertainty.push("A statement about current guidance cited no current source, so it is not shown.");
  }
  if (!currentGuidance && (guidanceStatus === "agrees" || guidanceStatus === "differs")) guidanceStatus = "no_current_source";
  // SCHOLAR-SQIE-01: feedback on the attempt is checked on its own -- nothing the evidence, the question or the attempt
  // lacks, nothing identifying, no citation it was not given. Failing, it is not shown and the answer still is.
  let attemptFeedback: FeedbackParts | null = null;
  const parts = attempt ? feedbackPartsFrom(j.attemptFeedback) : null;
  if (parts) {
    const fb = feedbackText(parts);
    const fbTags = [...fb.matchAll(TAG_RE)].map(x => `${x[1]}${x[2]}`);
    const fine = !fbTags.some(t => !known.has(t)) && !findPatientIdentifiers(fb).length
      && !groundingViolations(fb.replace(TAG_RE, " "), [...evidence.map(e => `${e.title}\n${e.citation}\n${e.text}`), question, attempt ?? ""]).length
      && !/\b\d+(?:\.\d+)?\s*(?:out of\s*\d+|marks?)\b/i.test(fb); // never a mark
    if (fine) attemptFeedback = parts;
    else uncertainty.push("Feedback on your attempt included details the evidence does not support, so it is not shown. Compare your attempt with the suggested answer yourself.");
  } else if (attempt) uncertainty.push("Your attempt could not be judged reliably against the evidence. Compare it with the suggested answer yourself.");
  return { ok: true, content: { option, examAnswer, explanation, optionNotes, currentGuidance, guidanceStatus, conflicts, unsupported, uncertainty, cited: [...new Set(tags)], attemptFeedback } };
}

export const GUIDANCE_STATUS_TEXT: Record<GuidanceStatus, string> = {
  agrees: "Current sources agree with the examination answer.",
  differs: "Current sources differ from what the examination expects. Learn both, and follow current guidance in practice.",
  no_current_source: "No current guidance source was found for this question. The answer reflects the examination context only.",
  not_applicable: "Current guidance does not apply to this question.",
};

export type ExamAiRun = (g: GenerateArgs, part?: string) => Promise<GenerateResult>;
type Failure = { ok: false; error: "not_configured" | "refusal" | "failed" };

export async function runAnswer(run: ExamAiRun, userId: string, input: { question: string; evidence: Evidence[]; attempt: string | null; optionLabels: string[] }) {
  const r = await run({
    system: ANSWER_SYSTEM, user: answerUserPrompt(input.question, input.evidence, input.attempt), tier: "reasoning", maxTokens: 1800,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_exam_answer" },
  });
  if (!r.ok) return { ok: false, error: r.error } as Failure;
  return { ok: true as const, check: checkAnswer(r.text, input.evidence, input.question, input.optionLabels, input.attempt), model: r.model, provider: r.provider, promptVersion: ANSWER_PROMPT_VERSION };
}

// ── FOLLOW-UP QUESTIONS ── about a saved answer, on the same evidence. Not stored (as Learn's explanations). ───

export const FOLLOW_UP_SYSTEM = [
  "A healthcare student is studying a suggested answer to an examination question and asks a follow-up question.",
  "Answer ONLY from the evidence (tagged [N n], [L n], [W n]) and the question. Cite the tags you use in square brackets after each sentence. Cite only tags you were given.",
  "Do not add any fact, number, dose, value, date or finding that is not in the evidence. If the evidence does not answer it, say that the evidence does not cover it.",
  "Plain short paragraphs or a list with lines starting '- '. No headings, bold, tables or emoji. Under 200 words. This is study, not advice about any real patient.",
].join("\n");

export type TextCheck = { ok: true; text: string; cited: string[] } | { ok: false; reason: "no_citation" | "bad_citation" | "ungrounded" | "identifier"; violations?: PhrasingViolation[] };

/** Pure. Free text that must cite the evidence and carry nothing it does not. */
export function checkCitedText(raw: string, evidence: readonly Evidence[], grounding: readonly string[]): TextCheck {
  const text = raw.trim();
  const tags = [...text.matchAll(TAG_RE)].map(x => `${x[1]}${x[2]}`);
  if (!tags.length) return { ok: false, reason: "no_citation" };
  const known = new Set(evidence.map(e => e.tag));
  if (tags.some(t => !known.has(t))) return { ok: false, reason: "bad_citation" };
  if (findPatientIdentifiers(text).length) return { ok: false, reason: "identifier" };
  const violations = groundingViolations(text.replace(TAG_RE, " "), [...evidence.map(e => `${e.title}\n${e.citation}\n${e.text}`), ...grounding]);
  if (violations.length) return { ok: false, reason: "ungrounded", violations };
  return { ok: true, text, cited: [...new Set(tags)] };
}

export async function runFollowUp(run: ExamAiRun, userId: string, input: { question: string; answer: string; ask: string; evidence: Evidence[] }) {
  const r = await run({
    system: FOLLOW_UP_SYSTEM, tier: "reasoning", maxTokens: 700,
    user: `${evidenceBlock(input.evidence)}\n\nTHE EXAMINATION QUESTION:\n${input.question}\n\nTHE SUGGESTED ANSWER:\n${input.answer}\n\nMY FOLLOW-UP QUESTION: ${input.ask}`,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_exam_follow_up" },
  });
  if (!r.ok) return { ok: false, error: r.error } as Failure;
  return { ok: true as const, check: checkCitedText(r.text, input.evidence, [input.question, input.answer, input.ask]), model: r.model, promptVersion: FOLLOW_UP_PROMPT_VERSION };
}

// ── A REVISION GUIDE FOR A PAPER ── from its saved answers' evidence, saved as kind "guide". ─────────────────

export const GUIDE_SYSTEM = [
  "Write a concise revision guide for a healthcare student from the examination questions and the evidence below.",
  "Group the key learning points by topic, as short lists with lines starting '- '. Mark where current guidance differs from what the examination expects.",
  "Use ONLY the evidence (tagged [N n], [L n], [W n]) and the questions. Cite the tags after each point. Cite only tags you were given. Do not add any fact, number, dose, value, date or finding that is not in the evidence.",
  "Topic names on their own line ending with a colon. No markdown headings, bold, tables or emoji. Under 600 words. This is study, not advice about any real patient.",
].join("\n");

export async function runGuide(run: ExamAiRun, userId: string, input: { questions: string[]; evidence: Evidence[] }) {
  const r = await run({
    system: GUIDE_SYSTEM, tier: "reasoning", maxTokens: 1500,
    user: `${evidenceBlock(input.evidence)}\n\nTHE QUESTIONS:\n${input.questions.join("\n\n")}`,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_exam_guide" },
  });
  if (!r.ok) return { ok: false, error: r.error } as Failure;
  return { ok: true as const, check: checkCitedText(r.text, input.evidence, input.questions), model: r.model, provider: r.provider, promptVersion: GUIDE_PROMPT_VERSION };
}

// ── AI TRANSCRIPTION OF SCANNED PAGES ── off by default (policy scholar_exam_scanned_pages). ─────────────────

export const TRANSCRIBE_PROMPT_VERSION = "exam-transcribe-v1";
export const TRANSCRIBE_SYSTEM = [
  "You transcribe pages of a scanned examination paper exactly as printed, for a student's study.",
  "Copy every instruction, section heading, question number, question, answer option and mark allocation exactly, one printed line per line. Keep the numbering as printed.",
  "Do NOT answer any question, correct anything or add anything. Where you cannot read something, write [UNREADABLE] in its place. Where a figure, diagram, table or image appears, write [FIGURE: a few words saying what it is] and do not describe its content further.",
  "Begin each page with a line 'PAGE n' giving its page number.",
].join("\n");

/** Pure. A transcription → its pages' text, by page number. Lines before any PAGE marker are dropped. */
export function splitTranscription(raw: string, wanted: readonly number[]): { page: number; text: string }[] {
  const out = new Map<number, string[]>();
  let cur: number | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*PAGE\s+(\d{1,4})\s*$/i.exec(line);
    if (m) { cur = Number(m[1]); if (!out.has(cur)) out.set(cur, []); continue; }
    if (cur !== null && wanted.includes(cur)) out.get(cur)!.push(line.replace(/\[FIGURE:[^\]]*\]/gi, s => s.slice(0, 120)));
  }
  return [...out.entries()].filter(([p]) => wanted.includes(p)).map(([page, lines]) => ({ page, text: lines.join("\n").trim() })).filter(p => p.text);
}

export async function runTranscription(run: ExamAiRun, userId: string, input: { pdfBase64: string; pages: number[] }) {
  const r = await run({
    system: TRANSCRIBE_SYSTEM, tier: "reasoning", maxTokens: 2000, documents: [{ mediaType: "application/pdf", data: input.pdfBase64 }],
    user: `Transcribe page${input.pages.length === 1 ? "" : "s"} ${input.pages.join(", ")} of this paper.`,
    context: { userId, attribution: { scope: "person" }, operation: "individual_scholar_exam_transcribe" },
  }, `pages-${input.pages.join("-")}`);
  if (!r.ok) return { ok: false, error: r.error } as Failure;
  return { ok: true as const, pages: splitTranscription(r.text, input.pages), model: r.model };
}
