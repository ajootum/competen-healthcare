// ── CAN THESE NOTES CARRY A CLINICAL CASE? ── COMPETEN-SCHOLAR-AI-OPT-01 (Wave 2, directive s5) ──────────────────
//
// A proportionate check BEFORE the expensive case generations (case_steps, the Apply case blueprint), so material
// that plainly cannot carry a progressive case is redirected before a model is paid to fail the grounding check.
//
// ⚠ CONTENT, NOT LENGTH. A progressive case moves a patient on: what they present with, what that means, what is
// done, and what happens next. The check reads which of those the passages actually describe, by the words they use
// for each. It never counts words or pages: a short note that describes a presentation, an action and a reassessment
// is ready; a long glossary of definitions is not.
//
// ⚠ IT GATES NOTHING CLINICAL AND WEAKENS NOTHING. Every case that IS written still passes every grounding,
// verification and safety check in generation.ts and clinical.ts, unchanged. This decides only whether to spend:
//   sufficient    proceed
//   simpler       the notes support a single case question, not a step-by-step case: offered first, and the
//                 learner may still ask for the case (a governed attempt, recorded as such)
//   insufficient  the notes describe neither what a patient presents with nor what is done: say what is missing
//                 and suggest material or another way of learning. No case is attempted.
//   uncertain     not clear either way: a governed attempt proceeds
// Pure, no AI call, no I/O.

import type { Sufficiency } from "@/lib/ai/outcomes";

export type CaseDimension = "presentation" | "interpretation" | "action" | "reassessment";

const CUES: Record<CaseDimension, RegExp> = {
  presentation: /\b(signs?|symptoms?|present(s|ed|ing|ation)?|observations?|findings?|complain(s|ed|ing)?|vital signs|respiratory rate|heart rate|pulse|blood pressure|temperature|saturations?|spo2|pain|confus(ed|ion)|consciousness|drows(y|iness)|breathless(ness)?|short(ness)? of breath|cough|fever|rash|swelling|oedema|edema|bleeding|vomiting|nausea|dizz(y|iness)|skin|urine output|wheez(e|ing)|tachycardi\w*|bradycardi\w*|hypotensi\w*|hypoxi\w*|pallor|clammy|sweating)\b/i,
  interpretation: /\b(indicat(es?|ing|ion)|suggests?|sign of|due to|caused by|causes?|means|score|criteria|threshold|diagnos\w*|differential|assess(ment|ed|ing)?|interpret\w*|risk|severity|red flags?|warning signs?|likely|consistent with|life-threatening)\b/i,
  action: /\b(escalat\w*|call(ing)?|refer\w*|give|giv(en|ing)|administer\w*|start(ed|ing)?|stop(ped|ping)?|commenc\w*|prescrib\w*|treat\w*|manag(e|ed|ement|ing)|review|request\w*|inform\w*|notify|document\w*|position\w*|insert\w*|prioriti[sz]\w*|alert\w*|contact\w*|hand over|handover|act|intervention|protocol)\b/i,
  reassessment: /\b(reassess\w*|re-assess\w*|recheck\w*|re-check\w*|monitor\w*|repeat(ed|ing)?|trend|response to|after (any|the|an) intervention|re-?evaluat\w*|follow[- ]up|does not improve|did not improve|gets worse|deteriorat\w*|frequency of observations|call back)\b/i,
};

/** A step that depends on another: if, when, then, after, until, unless. A case needs the notes to say what follows what. */
const SEQUENCE = /\b(if|when|then|after|before|until|unless|once|following)\b/i;

const sentences = (s: string) => s.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(Boolean);

export type CaseReadiness = {
  outcome: Exclude<Sufficiency, "not_assessed">;
  covered: CaseDimension[];
  missing: CaseDimension[];
  /** What to offer instead, when the case is not the right activity for these notes. */
  alternative: "case_question" | "teach" | null;
  /** Plain words for the learner, or null when the case goes ahead. */
  message: string | null;
};

const MISSING_WORDS: Record<CaseDimension, string> = {
  presentation: "what a patient presents with (signs, symptoms or observations)",
  interpretation: "what those findings mean",
  action: "what is done about it (for example escalation or treatment)",
  reassessment: "what happens next (reassessment, monitoring or response)",
};

/**
 * Pure. Which parts of a clinical case the passages describe. A dimension counts when at least one sentence uses its
 * words; a single stray word in a passage about something else is weaker evidence than several sentences, so two
 * sentences are needed for "sufficient", one is enough to stop "insufficient".
 */
export function caseReadiness(passages: readonly string[], kind: "case_steps" | "case_blueprint"): CaseReadiness {
  const all = passages.flatMap(sentences);
  const hits = (d: CaseDimension) => all.filter(s => CUES[d].test(s)).length;
  const count = { presentation: hits("presentation"), interpretation: hits("interpretation"), action: hits("action"), reassessment: hits("reassessment") };
  const dims = Object.keys(count) as CaseDimension[];
  const covered = dims.filter(d => count[d] > 0);
  const missing = dims.filter(d => count[d] === 0);
  const sequenced = all.some(s => SEQUENCE.test(s));
  const strong = (d: CaseDimension) => count[d] >= 2;
  const what = kind === "case_steps" ? "a step-by-step case" : "a clinical case";

  // Neither a presentation nor an action: there is no patient to follow and nothing to decide.
  if (!count.presentation && !count.action)
    return {
      outcome: "insufficient", covered, missing, alternative: "teach",
      message: `These notes do not describe ${MISSING_WORDS.presentation} or ${MISSING_WORDS.action}, so ${what} cannot be written from them without adding things they do not say. Learn from them with Teach me or revision questions, or add notes that describe a patient's care.`,
    };

  // A presentation, an action, and either what it means or what happens next, in an order: a case can progress.
  if (strong("presentation") && count.action && (count.interpretation || count.reassessment) && sequenced)
    return { outcome: "sufficient", covered, missing, alternative: null, message: null };

  // Something to recognise or interpret, but no progression to follow: one case question fits better.
  if (!count.action || (!count.interpretation && !count.reassessment))
    return {
      outcome: "simpler", covered, missing, alternative: "case_question",
      message: `These notes support a single case question better than ${what}: they do not say ${missing.map(d => MISSING_WORDS[d]).join(", or ")}. A case question uses the same notes and is more likely to be kept.`,
    };

  return { outcome: "uncertain", covered, missing, alternative: null, message: null };
}

/** The words for an identical retry against material that was already tried and rejected, unchanged since. */
export const REPEAT_REJECTED =
  "A case was already tried from exactly these notes and could not be written without adding things they do not say. Nothing has changed since, so it was not tried again. Try a case question, choose other sections, or add more of your notes.";
