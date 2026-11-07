import type { GenerateArgs, GenerateResult } from "@/lib/ai/client";
import { ASSERTION_MARKERS, SAFETY_CONTEXT, type PhrasingViolation } from "@/lib/ai/grounding";
import { findPatientIdentifiers } from "./extract";
import { PROMPT_VERSIONS, type ExplanationDepth } from "./config";
import {
  LEARN_RESEARCH_OPERATION, RESEARCH_DOSING, RESEARCH_METHOD_EXAMINED, checkBackgroundText, groundingViolations, learnPromptVersion, lessonBriefBlock, normaliseCitations, passageCitation, passageTag, scholarNamedTerms,
  type AiRun, type ExplainCheck, type GovernedReference, type LearnFlag, type LearnResult, type LessonBrief, type Passage,
} from "./generation";
import { CONTEXT_PREAMBLE } from "./learner-context";
import { TAGS, TEACH_LABEL, TEACH_MAX_QUESTIONS, composeTeachAnswer, isIntegratedVersion, parseTeachAnswer, questionText, sentencesOf, tagsOf, type SentenceTags, type TeachParts } from "./teach-format";

export { isIntegratedVersion, sentencesOf, tagsOf };
export type { SentenceTags };

// ── TEACH ME WITH EVIDENCE ── SCHOLAR-RESEARCH-TEACH-001 P1 ─────────────────────────────────────────────────────────────
//
// One lesson written from THREE identified sources, every sentence saying which:
//   [S n]  A, the learner's notes: the foundation, and what sets the lesson's scope
//   [E n]  B, a published record's abstract, from the evidence pack
//   [AI]   C, Scholar's own educational explanation: connecting ideas, general principles, never a finding
// The notes-only lesson (generation.ts) is untouched: this has its own prompt, its own version and its own check.
//
// ⚠ A PROMPT IS A REQUEST, THE CHECK IS THE CONTROL. checkIntegrated reads the lesson SENTENCE BY SENTENCE, against the source
// that sentence names and only that source: a [S n] sentence against the notes, a [E n] sentence against that abstract, an [AI]
// sentence by the background rules (no figures, no doses) and it may not claim evidence. A sentence that fails is left out, so
// one bad sentence costs that sentence. The lesson is withheld only if an identifier appears anywhere, an invented number
// sits in a safety context in what claims to be the notes, or too little of the notes survives to be a lesson on them.
//
// ⚠ THE WORD CHECK CANNOT READ MEANING, so the claim check does: a second model call asks of each cited sentence whether what it
// cites supports it. A sentence claiming research that its abstract does not support is left out. A sentence claiming the NOTES that
// the notes do not support is not presented as the notes: it becomes Scholar's own explanation ([AI]) if it can meet those rules, and
// goes otherwise, so a definition the notes only name is still taught and is never put in the notes' mouth. If the check fails, nothing
// cited to research is shown (fail closed), because a citation nobody checked is what the owner ruled out. Both calls are metered and counted.

export const INTEGRATED_PROMPT_SUFFIX = `+${PROMPT_VERSIONS.researchTeach}`;
export const integratedPromptVersion = () => `${learnPromptVersion("teach")}${INTEGRATED_PROMPT_SUFFIX}`;

/** What the model is shown of one record of the pack. An abstract only, and it is told so. */
export type PackEvidence = { title: string; journal: string | null; year: number | null; kind: string; abstract: string };

const WORDS: Record<ExplanationDepth, number> = { brief: 420, standard: 850, detailed: 1200 };
const MAX_TOKENS: Record<ExplanationDepth, number> = { brief: 1800, standard: 3400, detailed: 4600 };
/** At least this share of what is kept must be from the notes: they stay the foundation. */
export const MIN_NOTES_SHARE = 0.2;
const AI_TAG = "[AI]";

export function integratedSystem(depth: ExplanationDepth): string {
  return [
    "You are the teacher in Competen Scholar, teaching a healthcare student one complete lesson. Scholar must teach beyond the notes without losing the notes, and research beyond your own memory without inventing evidence.",
    "",
    "You are given three things, and every sentence you write must say which it rests on, by ending with its tag:",
    "[S n] THE STUDENT'S NOTES. They are the foundation and they set the scope. Teach every heading and every listed idea in them, in their order. Say only what that passage says.",
    "[E n] PUBLISHED EVIDENCE. Abstracts of published records. Use them to add what the notes lack: mechanisms, findings, limits and contemporary understanding. Say only what that abstract says, about what it studied. Your own connection to the lesson never goes in an [E n] sentence: end the sentence at what the abstract says, and write the connection as its own sentence tagged [AI].",
    `${AI_TAG} YOUR OWN TEACHING. Your own explanation that connects the ideas, defines a word or gives a general principle. General understanding only: never a finding, a study, a statistic, a number or a word for a number (two, three, twice), a dose, an instruction about what to do (no 'should' or 'must'), a promised outcome (no 'always', 'never', 'permanent', 'irreversible'), and never words such as 'research shows' or 'evidence suggests'.`,
    "",
    "RULES, in order of importance:",
    "1. Every sentence ends with its tags, before the full stop, for example: 'Each stage has its own window [S4].' Use only tags you were given. A sentence may carry [S n] and [E n] together only if each really supports it. Never put [AI] on a sentence with another tag: split it into two sentences.",
    "2. Never tag [S n] on something that came from an abstract or from you. If the notes do not say it, it is not from the notes.",
    "3. You have seen abstracts only, never the full papers. Never imply you read more. Say what kind of work it is in plain words (a systematic review, a trial), from what you were given. Citation counts and a journal's name prove nothing: do not lean on them.",
    "4. Keep the source's own caution. Association is not cause. Do not write that something always, inevitably or permanently follows unless the source says so. Say plainly where evidence is limited, mixed or missing, including where the abstracts given do not cover a concept.",
    "5. Where the notes only name or list something without explaining it (a heading, a word in a list), that is what this lesson is for: give each listed idea its own short sentences: first that the notes name it, tagged [S n], then what it means and how it works, tagged [AI] or [E n]. For example: 'The notes name homeostasis [S1]. It means the body keeps its internal conditions steady [AI].' Never leave a listed idea as a bare name, and never tag your explanation of it [S n] even when the word itself is in the notes.",
    "6. Teach, do not stack. Never paraphrase the notes slide by slide and never recite abstracts one after another. Weave the sources into one coherent explanation: foundations, how and why it works, how the ideas relate, what was found, how it applies in caring for patients, what remains uncertain, and the misconceptions a student may hold.",
    "7. Use an abstract only where it adds understanding to a concept in these notes. Never cite merely to have a citation. An abstract that does not bear on the lesson is left out.",
    "8. Never write a number, in digits or in words, that the source you cite does not contain. No doses, drug regimens or advice about any real patient. No names.",
    "",
    "Reply in exactly these labelled parts, each label at the start of its own line:",
    `${TEACH_LABEL.overview} two or three sentences: what this lesson is about and why it matters in caring for patients.`,
    `${TEACH_LABEL.understanding} the teaching itself, in connected paragraphs separated by a blank line (not a list), building from simple to more detailed, and ending with what this means when caring for patients and their families.`,
    `${TEACH_LABEL.distinctions} ONLY where the evidence you were given shows a statement in the notes is oversimplified or has been refined: one '- ' line each, saying what the notes say with its [S n], then what the published evidence adds or changes with its [E n], and why the difference matters. The notes are not wrong to have said it and are never rewritten: never present the refinement as being in the notes. If there is nothing to say, leave this part out entirely.`,
    `${TEACH_LABEL.points} then the essential points for revision, one line each starting '- ', each a different idea, each ending with its tags.`,
    `${TEACH_LABEL.example} one or two sentences showing an idea applied in the care of 'a child', 'a patient' or 'the person caring for them'. It is your own illustration, so tag it [AI], unless a source states exactly that. No names, ages or numbers.`,
    `${TEACH_LABEL.check} then one or two short open questions, each starting '- ', asking the student to explain, apply or reason, each answerable from the notes, each ending with '?' and then the [S n] that answers it. Never ask for a number.`,
    "",
    `Keep the whole lesson under ${WORDS[depth]} words.`,
    `LAST, before you reply: these words are read as clinical findings and are checked against the source you cite, so do not write one unless that source contains it: ${[...ASSERTION_MARKERS].join(", ")}. And never say how many of something there are unless the source you cite gives that number. The word 'one' is read as a number too: write 'a' or 'a single' instead.`,
  ].join("\n");
}

export function integratedUser(question: string, passages: readonly Passage[], references: readonly GovernedReference[], evidence: readonly PackEvidence[], learnerContext: string | null, lesson: LessonBrief | null | undefined): string {
  const about = (learnerContext ? `${CONTEXT_PREAMBLE}\n${learnerContext}\n\n` : "") + lessonBriefBlock(lesson ?? null);
  const notes = passages.map((p, i) => `[${passageTag(i)}] (${passageCitation(p)})\n${p.content}`).join("\n\n");
  const refs = references.length ? `\n\nWHAT I AM WORKING TOWARDS (programme outcomes, never a source of clinical facts):\n${references.map(r => `- ${r.title}${r.outcome ? `: ${r.outcome}` : ""}`).join("\n")}` : "";
  const ext = evidence.map((e, i) => `[E${i + 1}] ${e.title}${e.journal ? `. ${e.journal}` : ""}${e.year ? ` (${e.year})` : ""}. Kind: ${e.kind}. You have the abstract only.\nAbstract: ${e.abstract}`).join("\n\n");
  return `${about}MY NOTES:\n\n${notes}${refs}\n\nPUBLISHED EVIDENCE (not my notes):\n\n${ext}\n\nMY REQUEST: ${question}`;
}

// ── sentences ──────────────────────────────────────────────────────────────────────────────────────────────────────────

const plainOf = (sentence: string) => sentence.replace(TAGS, "").replace(/\s+([.,;:!?])/g, "$1").trim();

/** Words only a source may say. An [AI] sentence that uses them is presenting a finding it has no source for. */
const CLAIMS_EVIDENCE = /\b(stud(?:y|ies)|trials?|research(?:ers)?|evidence|meta-?analys[ie]s|systematic reviews?|reviews?|cohorts?|published|literature|et al|according to|findings?|data (?:show|suggest)|(?:this|that|which|it) (?:supports?|confirms?|refines?|corrects?|proves?|demonstrates?|shows?)|refines? the notes|corrects? the notes)\b/i;
/** A claim to have read more than an abstract. Never true here. */
/**
 * Scholar's own explanation teaches an idea. It does not tell anyone what to do with a patient, and it does not promise an outcome: both need
 * a source. An instruction or a certainty in an [AI] sentence goes, where the same words from a cited source would be read against that source.
 */
const AI_DIRECTIVE = /\b(should|must|ought to|need to|needs to|less alarmed|do not worry|no need to)\b/i;
const AI_CERTAINTY = /\b(irreversibl\w*|inevitabl\w*|permanent\w*|always|never|cannot be undone|for life|for the rest of|guarantee\w*|not optional)\b/i;
const CLAIMS_FULL_TEXT = /\b(full[- ]text|full paper|the whole (?:paper|article)|read the (?:paper|article) in full)\b/i;

/** A clause that connects a finding to the lesson. In a sentence citing research it is the writer's own conclusion, put in the source's mouth. */
const OWN_CONCLUSION = /[,;:\u2014-]\s*(which is consistent with|consistent with (?:this|the)|illustrating|this (?:shows|means|suggests)|supporting (?:this|the)|underscoring|reinforcing)\b/i;

export type DropReason = "evidence_own_conclusion" | "unknown_tag" | "notes_ungrounded" | "evidence_ungrounded" | "evidence_dosing" | "ai_rules" | "ai_claims_evidence" | "ai_directive" | "ai_certainty" | "claims_full_text" | "unsupported" | "unverified" | "risk_raised";
export type Dropped = { reason: DropReason; violations?: PhrasingViolation[] };

/** Pure. Whether a sentence can stand as Scholar's own explanation: the [AI] rules, on its words alone. */
const fitsAi = (plain: string) => checkBackgroundText(plain, 900).ok && !CLAIMS_EVIDENCE.test(plain) && !AI_DIRECTIVE.test(plain) && !AI_CERTAINTY.test(plain);
/** Pure. The sentence, with its source tags replaced by [AI]. */
const asAi = (sentence: string) => { const p = plainOf(sentence); return /[.!?]$/.test(p) ? `${p.slice(0, -1)} ${AI_TAG}${p.slice(-1)}` : `${p} ${AI_TAG}`; };

/** Pure. One sentence against the source it names. Null: it stands. `fatal`: it may not simply be left out. */
function judge(sentence: string, ctx: { passages: readonly Passage[]; references: readonly GovernedReference[]; evidence: readonly PackEvidence[]; asked: string }): (Dropped & { fatal?: boolean; retag?: boolean }) | null {
  const t = tagsOf(sentence), plain = plainOf(sentence);
  if (t.s.some(n => n < 1 || n > ctx.passages.length) || t.e.some(n => n < 1 || n > ctx.evidence.length) || t.r.some(n => n < 1 || n > ctx.references.length)) return { reason: "unknown_tag" };
  if (CLAIMS_FULL_TEXT.test(plain)) return { reason: "claims_full_text" };
  const cited = [...t.s.map(n => { const p = ctx.passages[n - 1]; return `${passageCitation(p)}\n${p.content}`; }), ...t.e.map(n => { const e = ctx.evidence[n - 1]; return `${e.title}\n${e.journal ?? ""} ${e.year ?? ""}\n${e.abstract}`; })];
  if (t.e.length) {
    if (RESEARCH_DOSING.test(plain)) return { reason: "evidence_dosing" };
    if (OWN_CONCLUSION.test(plain)) return { reason: "evidence_own_conclusion" };
    const vs = groundingViolations(plain.replace(RESEARCH_METHOD_EXAMINED, "$1 looked at"), [...cited, ctx.asked]);
    return vs.length ? { reason: "evidence_ungrounded", violations: vs } : null;
  }
  if (t.s.length) {
    // The notes' own words are read against the whole of the notes, as every notes lesson is: a slide can restate another.
    const vs = groundingViolations(scholarNamedTerms(plain), [...ctx.passages.map(p => `${passageCitation(p)}\n${p.content}`), ...ctx.references.map(x => `${x.code ?? ""} ${x.title} ${x.outcome ?? ""}`), ctx.asked]);
    if (!vs.length) return null;
    const unsafe = RESEARCH_DOSING.test(plain) || (vs.some(v => v.kind === "ungrounded_number") && SAFETY_CONTEXT.test(plain));
    return { reason: "notes_ungrounded", violations: vs, fatal: unsafe, retag: !unsafe && !t.e.length && fitsAi(plain) };
  }
  // [AI], or a sentence with no tag at all: it is Scholar's own, and it is labelled as such.
  if (!checkBackgroundText(plain, 900).ok) return { reason: "ai_rules" };
  if (CLAIMS_EVIDENCE.test(plain)) return { reason: "ai_claims_evidence" };
  if (AI_DIRECTIVE.test(plain)) return { reason: "ai_directive" };
  if (AI_CERTAINTY.test(plain)) return { reason: "ai_certainty" };
  return null;
}

/** A sentence with no tag is Scholar's own: it says so. */
const labelled = (sentence: string) => {
  const t = tagsOf(sentence);
  if (t.s.length || t.e.length) return sentence.replace(/\s*\[AI\]/g, "");
  if (t.ai) return sentence;
  return /[.!?]$/.test(sentence) ? `${sentence.slice(0, -1)} ${AI_TAG}${sentence.slice(-1)}` : `${sentence} ${AI_TAG}`;
};

export type IntegratedOutcome = {
  check: ExplainCheck;
  /** Every sentence left out, by rule, in the rule's own words. Never the text. */
  dropped: Dropped[];
  /** Sentences shown, by what they rest on. */
  shown: { notes: number; evidence: number; ai: number };
  /** Sentences that claimed the notes and were re-labelled as Scholar's own, because the notes do not say them. */
  relabelled: number;
  /** The [E n] the shown lesson cites. */
  citedEvidence: number[];
};

const notFound = (reason: Extract<ExplainCheck, { ok: false }>["reason"], dropped: Dropped[] = [], violations?: PhrasingViolation[]): IntegratedOutcome =>
  ({ check: { ok: false, reason, ...(violations ? { violations } : {}) }, dropped, shown: { notes: 0, evidence: 0, ai: 0 }, relabelled: 0, citedEvidence: [] });

type Unit = { sentences: string[] };
type Lesson = { overview: Unit; understanding: Unit[]; distinctions: Unit[]; points: Unit[]; example: Unit | null; questions: string[] };

const unit = (text: string): Unit => ({ sentences: sentencesOf(text) });
function lessonOf(parts: TeachParts): Lesson {
  return { overview: unit(parts.overview), understanding: (parts.understanding ?? []).map(unit), distinctions: (parts.distinctions ?? []).map(unit), points: parts.points.map(unit), example: parts.example ? unit(parts.example) : null, questions: parts.questions };
}
const allUnits = (l: Lesson) => [l.overview, ...l.understanding, ...l.distinctions, ...l.points, ...(l.example ? [l.example] : [])];
/** A distinction has to show both sides. Without both it is not one, so it goes. */
const wholeDistinction = (u: Unit) => { const t = u.sentences.map(tagsOf); return t.some(x => x.s.length > 0) && t.some(x => x.e.length > 0); };

function composed(l: Lesson): string {
  const joined = (u: Unit) => u.sentences.join(" ");
  return composeTeachAnswer({
    overview: joined(l.overview), understanding: l.understanding.map(joined).filter(Boolean), distinctions: l.distinctions.filter(wholeDistinction).map(joined),
    points: l.points.map(joined).filter(Boolean), example: l.example ? joined(l.example) || null : null, questions: l.questions,
  });
}

/** Pure. What is kept, with its counts, and whether it can stand as a lesson on these notes. */
function outcome(l: Lesson, dropped: Dropped[], relabelled = 0): IntegratedOutcome {
  const kept = allUnits({ ...l, distinctions: l.distinctions.filter(wholeDistinction) }).flatMap(u => u.sentences).map(tagsOf);
  const notes = kept.filter(t => t.s.length > 0 && !t.e.length).length, evidence = kept.filter(t => t.e.length > 0).length, ai = kept.filter(t => !t.s.length && !t.e.length).length;
  const fromNotes = kept.filter(t => t.s.length > 0).length;
  // ⚠ Withheld, not thinned: a lesson that has lost its notes is no longer a lesson on the student's notes.
  if (!fromNotes) return notFound("no_citation", dropped);
  if (fromNotes / kept.length < MIN_NOTES_SHARE) return notFound("no_citation", dropped);
  const text = composed(l);
  // Without an overview or a key point left it no longer reads back as a lesson, so it could not be risk-read or reopened: withheld, and taught from the notes instead.
  if (!parseTeachAnswer(text)) return notFound("no_citation", dropped);
  const cited = [...new Set(kept.flatMap(t => t.s))].sort((a, b) => a - b);
  const citedEvidence = [...new Set(kept.flatMap(t => t.e))].sort((a, b) => a - b);
  const violations = dropped.flatMap(d => d.violations ?? []);
  const removed = dropped.length;
  return {
    check: { ok: true, text, cited, ...(removed ? { salvaged: { removed, parts: { overview: false, points: 0, understanding: removed, example: false, questions: 0 }, violations } } : {}) },
    dropped, shown: { notes, evidence, ai }, relabelled, citedEvidence,
  };
}

const keepQuestions = (questions: readonly string[], passages: readonly Passage[]) => questions.filter(q => {
  const tags = tagsOf(q), plain = questionText(q);
  return tags.s.length > 0 && !tags.e.length && !tags.ai && !tags.r.length && tags.s.every(n => n >= 1 && n <= passages.length) && /\?$/.test(plain) && plain.length >= 8 && plain.length <= 300
    && !findPatientIdentifiers(plain).length && !groundingViolations(plain, passages.map(p => p.content)).length;
}).slice(0, TEACH_MAX_QUESTIONS);

/**
 * Pure. The lesson read sentence by sentence, before the claim check. `sentences` is what the claim check is then asked about.
 * An answer without the labelled parts is not this lesson and is withheld.
 */
export function checkIntegrated(raw: string, ctx: { passages: readonly Passage[]; references: readonly GovernedReference[]; evidence: readonly PackEvidence[]; asked: string }): IntegratedOutcome & { lesson: Lesson | null } {
  // "[S1, AI]" names a source: the source stands. [AI] is only for a sentence with none.
  const text = normaliseCitations(raw).replace(/\[((?:[SE])\d+)\s*[,;]\s*AI\]/g, "[$1]").replace(/\[AI\s*[,;]\s*([SE]\d+)\]/g, "[$1]").trim();
  const parts = parseTeachAnswer(text);
  if (!parts) return { ...notFound("no_citation"), lesson: null };
  // ⚠ An identifier anywhere withholds everything: it is never quietly cut out and the rest shown.
  if (findPatientIdentifiers(text).length) return { ...notFound("ungrounded"), lesson: null };
  const dropped: Dropped[] = [];
  const lesson = lessonOf(parts);
  let fatal: Dropped | null = null, relabelled = 0;
  for (const u of allUnits(lesson)) {
    u.sentences = u.sentences.flatMap(s => {
      const j = judge(s, ctx);
      if (!j) return [labelled(s)];
      if (j.fatal) fatal = j;
      if (j.retag) { relabelled++; return [asAi(s)]; }
      dropped.push({ reason: j.reason, ...(j.violations ? { violations: j.violations } : {}) });
      return [];
    });
  }
  if (fatal) return { ...notFound("ungrounded", dropped, (fatal as Dropped).violations), lesson: null };
  lesson.questions = keepQuestions(parts.questions, ctx.passages);
  return { ...outcome(lesson, dropped, relabelled), lesson };
}

// ── the claim check ────────────────────────────────────────────────────────────────────────────────────────────────────

export const CLAIM_CHECK_SYSTEM = [
  "You check a lesson's citations. You are given the source texts, tagged, then numbered claims, each naming the tags it cites. For each claim decide one thing: do the texts it cites, and only those, support what the claim says?",
  "A claim is supported if the cited text says it, or says it in other words, or it follows directly. A plain restatement in simpler language is supported.",
  "A claim is NOT supported if it adds a mechanism, a finding, a cause, a population or a certainty the cited text does not give; if it states as fact what the cited text only suggests; or if it attributes to the cited text something that is not there.",
  "Read every clause. A claim that restates the text and then goes on to its own conclusion ('which is consistent with ...', 'illustrating how ...', 'this means ...', 'describes this as ...') is NOT supported unless the cited text itself says that conclusion too.",
  "Do not use your own knowledge. A claim can be true and still not be supported by its cited text.",
  'Reply with ONE line and nothing else: a JSON array of the numbers of the claims that are NOT supported, such as [2, 5], or [] if all are supported. No reasoning, no prose and no code fence.',
].join("\n");

export type Claim = { sentence: string; plain: string; cites: string[] };
type CheckSources = { passages: readonly Passage[]; evidence: readonly PackEvidence[] };

/** Pure. The cited sentences to check, each with exactly what it cites. An [AI] sentence cites nothing, so it is not here. */
export function claimsOf(lesson: Lesson): Claim[] {
  const out: Claim[] = [];
  for (const u of allUnits(lesson)) for (const s of u.sentences) {
    const t = tagsOf(s);
    if (!t.s.length && !t.e.length) continue;
    out.push({ sentence: s, plain: plainOf(s), cites: [...t.s.map(n => `S${n}`), ...t.e.map(n => `E${n}`)] });
  }
  return out;
}

/** Pure. Each cited source once, then the claims naming them, so a source cited ten times is not paid for ten times. */
export function claimCheckUser(claims: readonly Claim[], ctx: CheckSources): string {
  const used = [...new Set(claims.flatMap(c => c.cites))];
  const text = (tag: string) => { const n = Number(tag.slice(1)); return tag[0] === "S" ? ctx.passages[n - 1]?.content ?? "" : (e => (e ? `${e.title}. ${e.abstract}` : ""))(ctx.evidence[n - 1]); };
  return `SOURCE TEXTS:\n\n${used.map(t => `[${t}]\n${text(t)}`).join("\n\n")}\n\nCLAIMS:\n\n${claims.map((c, i) => `${i + 1}. (cites ${c.cites.join(", ")}) ${c.plain}`).join("\n")}`;
}

/**
 * Pure. The model's list, or null when it cannot be read: the array that ENDS the reply, since a model may reason first, and a reply cut off
 * before its answer has none (an earlier "[3]" in the reasoning is not an answer). Numbers outside the list are ignored.
 */
export function parseUnsupported(raw: string, total: number): Set<number> | null {
  const m = /\[\s*((?:\d+\s*(?:,\s*\d+\s*)*)?)\]\s*(?:```)?\s*$/.exec(raw.trim());
  if (!m) return null;
  return new Set(m[1].split(",").map(x => x.trim()).filter(Boolean).map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= total));
}

/** Pure. The lesson without the given sentences, and the reason each went. */
function without(lesson: Lesson, drop: (sentence: string) => DropReason | "ai" | null): { lesson: Lesson; dropped: Dropped[]; relabelled: number } {
  const dropped: Dropped[] = [];
  let relabelled = 0;
  const copy: Lesson = { ...lesson, overview: { ...lesson.overview }, understanding: lesson.understanding.map(u => ({ ...u })), distinctions: lesson.distinctions.map(u => ({ ...u })), points: lesson.points.map(u => ({ ...u })), example: lesson.example ? { ...lesson.example } : null };
  for (const u of allUnits(copy)) u.sentences = u.sentences.flatMap(s => {
    const r = drop(s);
    if (r === "ai") { relabelled++; return [asAi(s)]; }
    if (r) { dropped.push({ reason: r }); return []; }
    return [s];
  });
  return { lesson: copy, dropped, relabelled };
}

/** Pure. The saved lesson's form with everything but the notes taken out: what is left when research may not be shown. */
export function notesOnlyProjection(text: string): string | null {
  const parts = parseTeachAnswer(text);
  if (!parts) return null;
  const { lesson } = without(lessonOf(parts), s => { const t = tagsOf(s); return t.s.length && !t.e.length ? null : "risk_raised"; });
  return composed({ ...lesson, distinctions: [] }) || null;
}

/** Pure. The [E n] and [AI] sentences of a lesson, as text: what the published risk rules read. */
export const beyondNotes = (text: string): string => {
  const parts = parseTeachAnswer(text);
  // Unreadable as a lesson: all of it is read, so nothing skips the risk rules.
  if (!parts) return text.replace(TAGS, "");
  return allUnits(lessonOf(parts)).flatMap(u => u.sentences).filter(s => { const t = tagsOf(s); return t.e.length > 0 || !t.s.length; }).map(plainOf).join(" ");
};

export type IntegratedResult = Extract<LearnResult, { ok: true }> & { integrated: Omit<IntegratedOutcome, "check"> & { claims: number; unsupported: number; verified: boolean } };

/** One lesson: written, read sentence by sentence, then its citations checked. Two metered calls, no retries. */
export async function runIntegratedTeach(userId: string, args: { question: string; passages: Passage[]; references: GovernedReference[]; depth: ExplanationDepth; learnerContext: string | null; lesson: LessonBrief | null; evidence: readonly PackEvidence[] }, run: AiRun): Promise<IntegratedResult | { ok: false; error: "not_configured" | "refusal" | "failed" }> {
  const context: GenerateArgs["context"] = { userId, attribution: { scope: "person" }, operation: LEARN_RESEARCH_OPERATION };
  const r: GenerateResult = await run({
    system: integratedSystem(args.depth), user: integratedUser(args.question, args.passages, args.references, args.evidence, args.learnerContext, args.lesson),
    tier: "reasoning", maxTokens: MAX_TOKENS[args.depth], context,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const ctx = { passages: args.passages, references: args.references, evidence: args.evidence, asked: args.question };
  const first = checkIntegrated(r.text, ctx);
  let final: IntegratedOutcome = first, claims = 0, unsupported = 0, verified = false;
  if (first.check.ok && first.lesson) {
    const list = claimsOf(first.lesson);
    claims = list.length;
    const v = list.length ? await run({ system: CLAIM_CHECK_SYSTEM, user: claimCheckUser(list, ctx), tier: "cheap", maxTokens: 900, context: { ...context, operation: `${LEARN_RESEARCH_OPERATION}_verify` } }, "verify") : null;
    const bad = v?.ok ? parseUnsupported(v.text, list.length) : null;
    verified = !!bad;
    const unsupportedSentences = new Set(bad ? [...bad].map(n => list[n - 1].sentence) : []);
    unsupported = unsupportedSentences.size;
    // ⚠ FAIL CLOSED: an unread claim check leaves no sentence cited to research standing.
    const next = without(first.lesson, s => {
      const t = tagsOf(s);
      if (!bad) return t.e.length ? "unverified" : null;
      if (!unsupportedSentences.has(s)) return null;
      // What the notes do not say is not presented as the notes. What an abstract does not say is not presented at all.
      return !t.e.length && fitsAi(plainOf(s)) ? "ai" : "unsupported";
    });
    final = outcome(next.lesson, [...first.dropped, ...next.dropped], first.relabelled + next.relabelled);
  }
  return {
    ok: true, action: "teach", model: r.model, provider: r.provider, promptVersion: integratedPromptVersion(),
    check: final.check, background: null, flags: { kept: [] as LearnFlag[], dropped: 0 }, verdict: null, question: null, research: null,
    integrated: { dropped: final.dropped, shown: final.shown, relabelled: final.relabelled, citedEvidence: final.citedEvidence, claims, unsupported, verified },
  };
}
