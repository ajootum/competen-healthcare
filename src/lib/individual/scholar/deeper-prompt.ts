// SCHOLAR-GO-DEEPER-001: what the model is asked to write for a structured Go deeper round, and the rules a section is held to beyond
// the existing checks. Pure, no I/O. generation.ts learnSystem appends this to EXPLAIN_SYSTEM; generation.ts checkDeeperAnswer applies the rules.
//
// ONE MODEL CALL A ROUND, as before. The decision about what adds value is made inside that call, from TAUGHT SO FAR and the passages;
// there is no planning call and no verification call, and the checks that follow are code.

import type { ExplanationDepth } from "./config";
import { DEEPER_LABEL, DEEPER_MAX_QUESTIONS, DEEPER_MAX_SECTIONS } from "./deeper-format";

/** The room a round has, notes and Scholar's explanation together. "Understand" is plainer, not thinner: it stays well above a lesson's brief 240 words. */
export const DEEPER_WORDS: Record<ExplanationDepth, number> = { brief: 430, standard: 620, detailed: 860 };
export const DEEPER_MAX_TOKENS: Record<ExplanationDepth, number> = { brief: 1600, standard: 2300, detailed: 3100 };
/** A Scholar section's own limit: a section is short by design, and a very long one is what a check should stop. */
export const SCHOLAR_SECTION_CHARS = 1500;

const LEVEL_INSTRUCTION: Record<ExplanationDepth, string> = {
  brief: "LEVEL: UNDERSTAND. Simplify the presentation, never the science: the true principle and the mechanism that explains it, in short plain sentences, every technical term explained where it first appears. Do not leave out a mechanism because it is hard; explain it more plainly.",
  standard: "LEVEL: EXPLORE. Scientific mechanisms and how they relate, a meaningful comparison where one helps, and what they mean in practice.",
  detailed: "LEVEL: ADVANCED. Finer mechanisms, competing explanations, the boundary of what is known, and application that takes judgement. Assume the principle is understood; still explain each technical term in context, and put the most specialised detail in an 'advanced' section.",
};

/** Pure. The whole instruction for a structured round. `scholar`: policy allows Scholar's own explanation beyond the notes (scholar_beyond_notes). */
export function deeperInstruction(opts: { depth: ExplanationDepth; scholar: boolean; taught: boolean; depthReached: string }): string {
  const sources = opts.scholar
    ? [
      "EVERY SECTION SAYS WHERE IT COMES FROM. This is the rule that matters most.",
      "- source 'notes': rules 1 to 3 above hold exactly. Every sentence states only what the passages say and ends with its [S n]. Do not put anything into a notes section because you know it to be true.",
      "- source 'scholar': your own explanation of well-established general science that the notes leave out, so the student understands WHY. This is where a mechanism beyond the notes belongs. It carries no [S n] tag, not one digit, no count, no unit, dose, drug name, value, threshold or date. It must never claim research: never write 'studies show', 'research shows', 'the evidence shows', 'trials', 'guidelines say' or a name and year. State established science plainly, as a good teacher would, without apologising for it or asking the student to check each sentence; say so only where the science is truly debated or the explanation is a simplification.",
      "If a sentence needs the notes and your own explanation, split it across sections. Include at least one 'notes' section, and keep notes sections to the few statements the new explanation builds on: the student has already read the notes taught back once, so do not walk through them again. Go beyond them: a round that only rearranges the notes has failed. The mechanisms the notes leave out are the point of this round.",
    ]
    : [
      "EVERY SECTION USES source 'notes': rules 1 to 3 above hold exactly, and every sentence ends with its [S n]. Where the notes state something without explaining it, say the reason is not in these notes.",
    ];
  return [
    "MODE: GO DEEPER, one structured teaching round. It must deepen understanding, not lengthen the answer: scientific understanding, clinical reasoning and application.",
    opts.taught
      ? `The student has ALREADY been taught this lesson: see TAUGHT SO FAR. Before writing, decide what has been explained, what their answers show, and which ONE major concept the lesson has not yet given adds the most value. Ground TAUGHT SO FAR lists as still open is a candidate, not a list to cover: everything else waits for a later round. Do not repeat the introduction, a definition or an explanation it already gives unless the new idea cannot be followed without it, and then in one clause. A round that re-teaches earlier ground in other words is a failure. If there is genuinely nothing of value to add, do not write a round: reply with exactly ${opts.depthReached} on the first line, then one or two sentences, cited, on what the student could apply or practise next.`
      : "Choose the ONE major concept in this lesson whose explanation adds the most understanding. Everything else waits for a later round.",
    "ONE MAJOR CONCEPT. Every section serves the focus question. A section that could be removed without weakening the answer to that question does not belong in this round, however true it is.",
    LEVEL_INSTRUCTION[opts.depth],
    ...sources,
    "Reply in exactly these labelled lines, each label at the start of its own line, with no markdown headings or bold:",
    "WRITE ABOUT THE SUBJECT, never about the material: no 'slide', 'page', 'the notes list', 'your notes say' or 'this lesson' anywhere except a limits section. A passage with no teaching content (a bare heading, a test line) is ignored, not discussed.",
    `${DEEPER_LABEL.focus} one real question about the subject this round answers, asking why or how, in plain words, for example 'Why does X happen before Y?'. Not a restatement of the lesson title. No citation.`,
    `${DEEPER_LABEL.covers} one short line on what the round covers. No citation.`,
    `${DEEPER_LABEL.section} kind | source | heading, then its text on the lines below. Between three and ${DEEPER_MAX_SECTIONS} sections, in the order that teaches best, and only the kinds this topic earns: never force one. Most science has a tempting wrong idea and an honest limit, so expect to need a misconception section and a limits section, and an application section whenever the topic touches care. The heading says what the section teaches ('Why the head comes first'), never just its kind.`,
    "  kinds: principle (the core concept) · science (mechanisms and relationships) · compare (a comparison, as a table) · application (what the person caring for the patient assesses, how they interpret it alongside what else, and what would prompt further assessment) · misconception (a mistaken belief students hold, why it is tempting, and what is actually so) · safety (safety-critical information, ONLY from the passages, source notes) · limits (what is uncertain, what the notes do not say, where an explanation is a simplification) · advanced (optional finer detail a student may skip)",
    "HOW TO WRITE A SECTION. Short paragraphs of at most three sentences, a blank line between them. One idea per paragraph. Explain each technical term in the sentence that first uses it. A comparison is a table, each row starting and ending with '|', the first row its header, no more than four columns. A chain of cause and effect is one line: 'FLOW: first -> then -> finally', short phrases, each step on the same source rules. Tables and FLOW lines are the only formatting allowed beyond '- ' lists. Cite at most once per sentence; no strings of tags.",
    "CLINICAL REASONING. Connect the science to what is assessed, how it is interpreted and what is decided. Never draw a firm conclusion from one isolated finding: say what else must be considered. Keep apart what is established, what is uncertain, and what is your own educational inference, and say which is which. No recommendation about any particular patient.",
    `${DEEPER_LABEL.check} ${DEEPER_MAX_QUESTIONS === 2 ? "one or two" : "up to " + DEEPER_MAX_QUESTIONS} questions, each on a line starting '- ', that test reasoning or application on this round's new ground, not recall. Every question, with or without options, ends with '?' and then the [S n] of the passage it rests on. Never ask for a number or how many of anything. A question may be followed by three or four plausible answer options, each on its own line starting 'a) ', 'b) ' and so on, with no option marked correct and no tag on an option, when choosing would make the student reason. Options are short, and hold no number the passages do not contain.`,
    `${DEEPER_LABEL.takeaways} two to four lines starting '- ', each a different idea that is NEW in this round, never a key point TAUGHT SO FAR already gave, in the same wording rules: end with [S n] if it comes from the passages, no tag if it comes from your own explanation.`,
    `Keep the whole round under ${DEEPER_WORDS[opts.depth]} words. Do not pad it to reach that: a round that says it clearly in fewer words is better. Write nothing else.`,
  ].join("\n");
}

// ── THE RULES A SECTION IS HELD TO, beyond checkLearnMain and checkBackgroundText ──

/** Words that present text as verified scholarship. Scholar's own explanation may never use them: the owner's rule, in code. */
const SCHOLARLY_CLAIM = /\b(?:research|stud(?:y|ies)|trials?|meta-analys[ie]s|systematic reviews?|cohort|the (?:literature|evidence)|evidence|data|guidelines?|literature)\b[^.!?\n]{0,80}\b(?:shows?|showed|shown|demonstrat\w+|proves?|proved|proven|confirm\w*|found|finds|establish\w*|indicat\w+|suggest\w*|reports?|reported|recommends?|states?|says?|supports?|supported|links?|linked|concludes?|concluded)\b|\bet al\b|\b(?:published|peer[\s-]reviewed|landmark|randomi[sz]ed)\s+(?:stud|research|trial|evidence|paper)\w*|\b(?:according to|as reported by)\b[^.!?\n]{0,40}\b(?:guidelines?|stud(?:y|ies)|research|who|nice|cdc|journal)\b|\b(?:studies|researchers|scientists|experts)\b|\b(?:a|one|another|several|many|some|recent)\s+stud(?:y|ies)\b|\bshown in (?:trials|studies|research)\b|\b\w+['’]s\s+(?:work|research|stud(?:y|ies)|experiments?)\s+(?:demonstrat|show|prov|found)\w*/i;
/** A firm conclusion from a finding, or a direct instruction about treating someone. */
const DETERMINISTIC = /\b(?:always|definitely|certainly|invariably|necessarily)\s+(?:means?|indicates?|signals?|confirms?|shows?|proves?|reflects?|points? to)\b|\bconfirms? (?:the|a) diagnosis\b|\bis diagnostic of\b|\brules? (?:it |this |that )?out\b|\bproves? that\b|\bmust (?:have|be suffering)\b|\bis a (?:sure|definite|certain) sign\b|(?<!\b(?:may|might|can|could|not|never)\s)\b(?:means?|indicates?|signals?|points? to)\b[^.!?\n]{0,40}\b(?:damage|palsy|lesion|disorder|disease|deficit|infection|syndrome|tumou?r|injury|impairment)\b/i;
const PATIENT_DIRECTIVE = /\byou (?:should|must|need to)\s+(?:give|prescribe|start|stop|administer|treat|diagnose|refer|withhold|discharge)\b|\b(?:prescribe|administer)\b|\b(?:nurses?|clinicians?|doctors?|carers?|staff)\s+(?:should|must)\s+(?:give|withhold|start|stop|refer|treat|diagnose|discharge)\b|\b(?:give|start|stop|withhold|begin)\s+(?:the\s+|a\s+|an\s+|this\s+)?(?:treatment|therapy|medication|medicines?|drugs?|feeds?|oxygen|antibiotics?)\b|\brefer (?:them |the \w+ )?urgently\b/i;

/** A figure in words the shared background check does not list, and an age or time named by an ordinal. Scholar states none: the notes hold the numbers. */
const FIGURE_WORDS = /\b(?:thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|sixty|seventy|eighty|ninety|million|billion|half|dozen|majority)\b|\b(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|twelfth)\s+(?:year|month|week|day|trimester|decade)\b/i;

/** Medicines by name or class, a closed list: Scholar names none (the notes may). Hormones as physiology (insulin, adrenaline, cortisol) are not here, because explaining them is teaching. */
const DRUG_WORDS = /\b(?:paracetamol|acetaminophen|ibuprofen|aspirin|naproxen|diclofenac|morphine|codeine|fentanyl|opioids?|benzodiazepines?|diazepam|midazolam|lorazepam|phenobarbit\w+|antibiotics?|penicillin|amoxicillin|gentamicin|ceftriaxone|antivirals?|steroids?|corticosteroids?|dexamethasone|prednisolone|hydrocortisone|salbutamol|warfarin|heparin|digoxin|furosemide|antidepressants?|antipsychotics?|sedatives?|anticonvulsants?|chemotherapy)\b/i;
/** Urgent action and danger. "Safety only from the notes" means this wording, whatever a section calls itself. */
const URGENT_ACTION = /\bemergency services\b|\bambulance\b|\brescue breath\w*|\bresuscitat\w*|\bCPR\b|\bfatal\b|\blife[\s-]threatening\b|\boverdose\b|\b(?:never|do not|don['’]t|must not)\s+(?:give|feed|leave|delay)\b|\bcontraindicat\w*|\bseek (?:urgent|immediate|emergency)\b|\b(?:act|treat|refer|call|respond|escalate)\s+(?:immediately|urgently|at once)\b|\b(?:immediately|urgently)\s+(?:call|give|treat|refer|stop|start|escalate)\b|\bcan (?:kill|be deadly)\b/i;

export type ClaimViolation = "scholarly_claim" | "deterministic" | "patient_directive" | "figure_word" | "drug_name" | "urgent_action";

/** Pure. What Scholar's own explanation may not say. Every rule, whatever the passages hold: it is not from them. */
export function scholarClaimViolations(text: string): ClaimViolation[] {
  const out: ClaimViolation[] = [];
  if (SCHOLARLY_CLAIM.test(text)) out.push("scholarly_claim");
  if (DETERMINISTIC.test(text)) out.push("deterministic");
  if (PATIENT_DIRECTIVE.test(text)) out.push("patient_directive");
  if (FIGURE_WORDS.test(text)) out.push("figure_word");
  if (DRUG_WORDS.test(text)) out.push("drug_name");
  if (URGENT_ACTION.test(text)) out.push("urgent_action");
  return out;
}

/** Pure. A notes section may say what the notes say, even firmly; it may not ADD a firm conclusion or an instruction the passages do not hold. */
export function notesClaimViolations(text: string, passages: readonly string[]): ClaimViolation[] {
  const all = passages.join("\n");
  const out: ClaimViolation[] = [];
  for (const [re, kind] of [[DETERMINISTIC, "deterministic"], [PATIENT_DIRECTIVE, "patient_directive"]] as const) {
    const m = re.exec(text);
    if (m && !all.toLowerCase().includes(m[0].toLowerCase())) out.push(kind);
  }
  return out;
}

// ── WHETHER "FROM YOUR NOTES" IS TRUE ──
// The grounding verifier reads numbers, finding words and named terms: it cannot see a general statement of science given a citation.
// In a lesson that was enough, because the notes were all there was. In a round whose whole purpose is to go beyond them, a mechanism
// could wear an [S n] it does not rest on. So each sentence of a notes section must carry a tag and share enough of its content words
// with the passages it cites. A sentence that fails is not simply lost: it MOVES to Scholar's explanation (its tags removed), where the
// stricter Scholar rules decide whether it may be shown, and what the notes do hold stays in the notes section.
const STOP = new Set(("about above after again against also among because been before being below between both but can could does doing down during each even from further have having here how into its just more most much must not now off once only other our out over own same should some such than that the their them then there these they this those through too under until very was were what when where which while who whom why will with would you your may might often usually however therefore thus rather instead within without across per is are be and for of in on at to by an as or if it a so do no nor up we he she his her has had").split(" "));
const stemOf = (w: string) => w.toLowerCase().replace(/(?:ing|ed|es|s|ly)$/, "").slice(0, 6);
const contentWords = (s: string) => (s.toLowerCase().match(/[\p{L}][\p{L}'-]+/gu) ?? []).filter(w => !STOP.has(w) && w.length > 2);
/** Below this share of a sentence's content words found in its cited passages, the sentence is not resting on them. */
export const NOTES_SUPPORT_MIN = 0.4;

/** Pure. A text as sentences, each with the tags that follow it. "x [S1]." and "x. [S1]" both read as "x [S1]." */
export const sentencesOf = (text: string) => text.replace(/([.!?])((?:\s*\[[SR]\d+\])+)/g, "$2$1").split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);

/** Words that turn a true statement false or add a cause. Word overlap cannot see them ("comes after" and "comes before" share every other word), so each must be in what is cited. */
const SENSE_WORDS = /\b(?:before|after|not|never|no|because|cause[sd]?|causing|since|therefore|hence|without|unless|only|always|leads?|led|results?|drives?|explains?|due)\b/gi;

/** Pure. Whether one sentence rests on the passages it cites. Under four content words is excused: a flow or table is judged as one unit by the caller, so this excuses only a short phrase. */
export function sentenceSupported(sentence: string, passages: readonly { content: string }[]): boolean {
  const words = contentWords(sentence.replace(/\[[SR]\d+\]/g, " "));
  if (words.length < 4) return true;
  const tags = [...sentence.matchAll(/\[S(\d+)\]/g)].map(m => Number(m[1]));
  if (!tags.length) return false;
  const body = new Set(contentWords(tags.map(t => passages[t - 1]?.content ?? "").join(" ")).map(stemOf));
  const cited = ` ${tags.map(t => passages[t - 1]?.content ?? "").join(" ").toLowerCase().replace(/[^\p{L}]+/gu, " ")} `;
  if ((sentence.replace(/\[[SR]\d+\]/g, " ").match(SENSE_WORDS) ?? []).some(w => !cited.includes(` ${w.toLowerCase()} `))) return false;
  return words.filter(w => body.has(stemOf(w))).length / words.length >= NOTES_SUPPORT_MIN;
}

/** Pure. Whether every sentence of a notes section rests on the passages it cites. */
export const notesSectionSupported = (text: string, passages: readonly { content: string }[]) => sentencesOf(text).every(s => sentenceSupported(s, passages));
