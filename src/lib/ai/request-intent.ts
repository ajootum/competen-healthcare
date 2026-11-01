// ── SCHOLAR-RISK-01: WHAT A LEARNER'S REQUEST IS FOR ── owner GO "education-first, risk-sensitive", 31 Oct 2026 ─────
//
// Pure and deterministic. No model call, nothing kept: the learner's own request words are read here, in memory, for a
// handful of INTENT FEATURES, beside the configured keyword rules (clinical-risk.ts). The rules say what a request is
// ABOUT (a body system, a medicine, an emergency); the features say what it is FOR:
//
//   real-patient evidence   my patient, bed 4, I am caring for, identifiers, a named person given a medicine, a
//                           definite person deteriorating now, "right now" with a clinical action, personal safety.
//                           ALWAYS category 4: no study phrase, "hypothetically" or confirmed purpose lowers it.
//   administration          should I give, how much should I give, is it safe to give: a decision about giving.
//   study framing           explain, differentiate, compare, calculate, OSCE, case study, "in a patient with" ...
//   case framing            the narrower set that makes a person in the text a simulated one (a case, a scenario).
//
// ⚠ THE FEATURES ONLY EVER ADD CAUTION. Real-patient evidence can only raise a request to category 4. Framing can only
// decide between "clarify" and "answer as clinical education" for a request that has NO real-patient evidence; it never
// lowers a configured high-risk rule other than one the published policy itself names as ambiguous (clinical-risk.ts
// ambiguousRules, which may never name a real-patient, emergency, identifiable or personal-safety rule).

// Item 8 (1 Nov 2026): the features are read over the corrected reading of the request as well as what was typed
// (cautiousIntentFeatures), so "shuld i giv" is a giving decision and "expalin" is a study verb. The normaliser is pure and
// dependency-free (src/lib/individual/scholar/spelling.ts); it never changes what is stored or marked.
import { classificationReadings, type NormalisedText } from "../individual/scholar/spelling";

/** Why a request is category 4, in the learner's terms (operating-mode.ts REFUSAL words). */
export type RefusalKind = "personal_safety" | "emergency" | "identifiable" | "administration" | "real_patient" | "clinical_high" | "unrecognised";
export const REFUSAL_KINDS: readonly RefusalKind[] = ["personal_safety", "emergency", "identifiable", "administration", "real_patient", "clinical_high", "unrecognised"];
/** Most serious first: the words a learner sees when several apply. */
export const refusalPrecedence = (k: RefusalKind) => REFUSAL_KINDS.indexOf(k);
export const firstKind = (ks: readonly (RefusalKind | null | undefined)[]): RefusalKind | null =>
  ks.filter((k): k is RefusalKind => !!k).sort((a, b) => refusalPrecedence(a) - refusalPrecedence(b))[0] ?? null;

export type IntentFeatures = {
  /** Category-4 evidence in the learner's own words, with the reason it gives. Null: none. */
  realPatient: RefusalKind | null;
  /** A decision about giving a medicine (first-person or "what dose should"). */
  administration: boolean;
  /** First-person administration ("should I give", "how much do I give"): with a named person it is category 4. */
  firstPersonAdministration: boolean;
  /** A named person (Mr/Mrs/Ms/Miss + name, "a patient called ..."), a family member, or him/her as the one given to. */
  namedPerson: boolean;
  /** Explicit study framing: a study verb, a study context or a calculation. */
  studyFraming: boolean;
  /** Any question a learner might ask while studying (what is, how does ...), or explicit framing. */
  questionFraming: boolean;
  /** A simulated person: case study, scenario, OSCE, hypothetical, "in a patient with", "a 70-year-old". */
  caseFraming: boolean;
  /** Item 5: asked inside a lesson or material whose words it shares (contextOverlap). False without a context. */
  contextFraming: boolean;
};

const norm = (s: string) => ` ${s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, "\"").replace(/\s+/g, " ")} `;
const any = (t: string, res: readonly RegExp[]) => res.some(re => re.test(t));

// ── Category-4 evidence ──────────────────────────────────────────────────────────────────────────────────────
const PERSONAL_SAFETY = [
  /\b(kill|hurt|harm|cut|injure) (myself|my self)\b/, /\bend(ing)? (my|my own) life\b/, /\btake (my|my own) (own )?life\b/,
  /\bi (want|wanna|wish|need) to die\b/, /\bi('m| am) (feeling |so )?suicidal\b/, /\bi (feel|have felt|have been feeling) suicidal\b/,
  /\bi (have been|keep|am|'ve been|started) (self[- ]harming|cutting myself|harming myself)\b/, /\bdon'?t want to (live|be alive|be here anymore)\b/,
  /\bthoughts of (killing|harming|hurting) myself\b/,
];
const POSSESSIVE_CARE = /\b(my|our) (patients?|clients?|residents?|service users?|ward|bay|unit|shift|caseload)\b/;
const FAMILY = /\bmy (mum|mom|mother|dad|father|husband|wife|partner|boyfriend|girlfriend|son|daughter|child|kid|kids|baby|toddler|brother|sister|grandma|grandad|grandpa|granny|grandmother|grandfather|grandson|granddaughter|friend|flatmate|roommate|neighbour|neighbor|aunt|auntie|uncle|cousin|nan|nana)\b/;
const FIRST_PERSON_CARE = [
  /\bi('m| am) (currently |now |just )?(caring for|looking after|nursing|treating|assessing|seeing|admitting|with|working with|handing over) (a|an|the|my|this|one)? ?(\d{1,3}[- ](year|yr)[- ]old )?(patient|man|woman|lady|gentleman|child|boy|girl|baby|infant|toddler|resident|client|elderly|person)\b/,
  /\bi('ve| have)( just)?( got)? (a|this|one) (patient|resident|client)\b/, /\bi('ve| have) been (allocated|assigned|given) (a|this) patient\b/,
  /\b(under|in) my care\b/, /\bon my (ward|shift|unit|placement today)\b/, /\bat the bedside\b/, /\bcurrently caring\b/, /\bon shift (now|today|tonight)\b/,
  /\b(we|i) have a patient (who|with|that)\b/,
];
const BED_NUMBER = /\b(bed|bay|cubicle|side room|resus bay|trolley)\s*(no\.?\s*|number\s*)?(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/;
const IDENTIFIER = [
  /\b\d{3}[ -]?\d{3}[ -]?\d{4}\b/, // a ten-digit (NHS-style) number
  /\b(nhs|hospital|patient|mrn|medical record|record|chi|ip|inpatient|unit)\s*(no\.?|number|num|#|id)\s*:?\s*[a-z]{0,3}\d{3,}/,
  /\b(dob|d\.o\.b\.?|born( on)?)\s*:?\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/,
];
const HARD_NOW = /\b(right now|at the moment|just now|as we speak|at this moment|this minute|this second)\b/;
const SOFT_URGENT = /\b(urgent|urgently|immediately|asap|quickly|quick|emergency)\b|(^|\s)help!/;
/** Urgency a simulated case does not explain: a cry for help, "urgently", being alone with it. */
const ALONE_URGENT = /(^|\s)help[,!]|\burgent[,!:]|\b(urgently|asap|i'm on my own|i am on my own|i'm alone|i am alone|on my own here|nobody (is )?(here|around)|no one (is )?(here|around))\b/;
const DETERIORATION = "(not breathing|stopped breathing|isn't breathing|is not breathing|can'?t breathe|cannot breathe|struggling to breathe|gasping|unresponsive|unconscious|collapsed|collapsing|fitting|seizing|having (a )?(seizure|fit|cardiac arrest|heart attack|stroke|reaction|hypo)|choking|bleeding( heavily| a lot| profusely| out)?|haemorrhaging|hemorrhaging|turning blue|going blue|blue lips|cyanosed|cyanotic|desaturating|deteriorating|crashing|arrested|in cardiac arrest|anaphylactic|swelling up|overdosed|taken an overdose|not responding|unrousable)";
/** Worrying but not by itself an arrest: with a first-person "what do I do", a family member or "right now", still now. */
const CONCERNING = /\b(chest pain|crushing pain|hypotensive|tachycardic|bradycardic|high temperature|temperature of \d|fever of \d|sats (are |is )?(dropping|low|\d)|saturations (are |is )?(dropping|low|\d)|bp (is )?(dropping|low|\d)|blood pressure (is )?(dropping|low)|vomiting blood|coughing up blood|very drowsy|really drowsy|confused|can'?t wake|won'?t wake|pain score of \d|pain is \d)\b/;
const DEFINITE = "(he|she|they|the patient|patient|pt|the resident|the client|my \\w+|the (man|woman|lady|gentleman|child|kid|baby|boy|girl|infant|toddler))";
const ACUTE_NOW = new RegExp(`\\b${DEFINITE} (is|are|has|have|'s|'re|keeps|kept|just|started|now|has been|have been|is now|suddenly|went)? ?(\\w+ )?${DETERIORATION}\\b`);
const DETERIORATION_ANY = new RegExp(`\\b${DETERIORATION}\\b`);
const FIRST_PERSON_ACTION = [
  /\bwhat (should|shall|do|can|must|would) (i|we) do\b/, /\bwhat do i do\b/, /\bwhat (should|shall|do) (i|we) (give|try|check)\b/,
  /\b(should|do|must|can) (i|we) (call|escalate|stop|start|treat|ring|bleep|move|turn|lie|sit|leave)\b/, /\bwhat now\b/,
];

// ── Administration ────────────────────────────────────────────────────────────────────────────────────────────
const ADMIN_VERBS = "(give|administer|prescribe|push|hang|start|restart|stop|hold|withhold|omit|increase|decrease|reduce|double|halve|titrate|bolus|repeat|top up|crush|inject|draw up|put up|run|switch)";
const FIRST_PERSON_ADMIN = [
  new RegExp(`\\b(should|can|could|shall|do|must|may|would) (i|we) (still |just |now )?${ADMIN_VERBS}\\b`),
  new RegExp(`\\bhow (much|many|fast)\\b[^.?!]{0,50}\\b(should|do|can|shall|would|must) (i|we) ${ADMIN_VERBS}\\b`),
  /\bwhat (dose|amount|rate|volume|strength)\b[^.?!]{0,40}\b(should|do|shall|can|would|must) (i|we)\b/,
  /\bis it (safe|ok|okay|alright|all right|fine) (for me |for us )?to (give|administer|prescribe|crush|push|inject|start|stop)\b/,
  /\bam i (allowed|able|ok|okay) to (give|administer|prescribe|crush|push|inject)\b/,
];
const OTHER_ADMIN = [/\bwhat dose should\b/, /\bhow much (should|to) (be )?(give|given)\b/, /\bhow much to give\b/];
const PRONOUN_RECIPIENT = /\b(to|for|give|giving|administer|administering|prescribe|inject) (him|her|them)\b/;
const NAMED = [/\b(mr|mrs|ms|miss|mx|master)\.? [a-z][a-z'-]{1,}/, /\b(patient|resident|client|lady|man|woman|gentleman) (called|named) [a-z]{2,}/];

// ── Framing ───────────────────────────────────────────────────────────────────────────────────────────────────
const STUDY_FRAMING = [
  /\b(explain|explaining|describe|define|definition of|differentiate|differentiating|differentiation|distinguish|distinguishing|compare|comparing|comparison|contrast|classify|classification of|categori[sz]e|outline|summari[sz]e|summary of|discuss|list|identify|evaluate|analy[sz]e|critique|critically|justify|interpret|illustrate|elaborate|overview of|key points|teach me|quiz me|test me|revise|revising|revision|calculate|calculation|calculating|work out|worked example|mnemonic|rationale|pathophysiology|mechanism of action)\b/,
  /\bhelp me (understand|learn|revise|remember|study|prepare|practise|practice)\b/, /\bcheck my (understanding|answer|working|calculation)\b/,
  /\bgive me (an |some )?(example|examples|overview|summary|questions|practice)\b/, /\b(difference|differences|distinction) between\b/, /\bvs\.?\b|\bversus\b/,
  /\bfor (my|the|an|our) (studies|study|exam|exams|course|module|assignment|essay|revision|osce|test|quiz|lecture|class|tutorial|placement assessment|dissertation)\b/,
  /\b(i'm|i am) (studying|revising|learning|preparing for)\b/,
  /\b(osce|exam question|exam|exams|mcq|sba|viva|practice question|past paper|textbook|lecture|module|syllabus|curriculum|in theory|theoretically|theoretical|according to (the )?(bnf|nice|guideline|guidelines|resuscitation council))\b/,
];
const CASE_FRAMING = [
  /\b(case study|case studies|case scenario|clinical scenario|scenario|vignette|simulation|simulated|sim lab|osce|exam question|practice question|mcq|sba|hypothetical|hypothetically|imagine|suppose|supposing|role[- ]play|mock)\b/,
  /\bin (a|an) (patient|adult|child|infant|neonate|person|man|woman|elderly)\b/, /\b(a|an) (patient|adult|child|man|woman|person|resident) (with|who|presents|presenting|is admitted|admitted|has|aged)\b/,
  /\b(a|an) \d{1,3}[- ]?(year|yr|month|week|day)s?[- ]old\b/, /\b(aged|age) \d{1,3}\b/, /\bthis case\b/, /\bcase \d\b|\bcase:/, /\bin the (case|scenario)\b/,
  /\b\d{1,3} ?kg (adult|patient|child|man|woman)\b/, /\bfor (a|an) \d{1,3} ?kg\b/,
  /\b(if|when|whenever) (a|an|your|someone|somebody|one)\b/,
];
const QUESTION_FRAMING = /\b(what|how|why|when|which|where|who|is|are|does|do|can|could|tell me|teach me|give me)\b/;

// ── Context (owner instruction 1 Nov 2026 item 5, educational intent recognition, P0) ─────────────────────────
//
// Where the learner is when they ask. A request INSIDE an active lesson or material whose content words overlap that
// lesson's own words (its title, objective, topics, activity) is a study request even without a study verb ("what about
// the outcome bit?" in a Donabedian lesson). ⚠ It is a framing signal ONLY: it never touches real-patient evidence
// (my patient, bed 3, right now, identifiers, personal safety), and operating-mode.ts decideIntent uses it only for a
// request no rule recognised -- never to turn a giving decision or a named person into study.

export type IntentSurface = "learn" | "personal_ai" | "revise" | "apply" | "evaluate";
export const INTENT_SURFACES: readonly IntentSurface[] = ["learn", "personal_ai", "revise", "apply", "evaluate"];
export type IntentContext = {
  surface: IntentSurface;
  lessonTitle?: string | null;
  objective?: string | null;
  materialTopics?: readonly string[] | null;
  activity?: string | null;
};
/** Words that say nothing about WHAT is being studied: never an overlap on their own. Includes the person and action
 *  words of a clinical request, so "the patient" or "give" in a lesson never counts as study framing. */
const NOT_CONTENT = new Set(`a about above after again all also am an and any are as at be been before being between both but by can could did do does
doing done each for from had has have he her here him his how i if in into is it its just me more most my no nor not now of off on once only or other
our out over own same she should so some such than that the their them then there these they this those through to too under until up very was we were
what when where which while who whom why will with would you your bit bits part parts thing things one ones lot again please thanks ok okay yes
explain describe tell show teach help understand mean means meant say said know about like also really just more less
patient patients person people man woman child baby resident client give given giving dose doses dosing now today tonight urgent help bed bay ward
nurse doctor care caring should need needs needed do does what happen happens happened`.split(/\s+/));
const contentWords = (s: string | null | undefined): string[] =>
  (s ?? "").toLowerCase().replace(/[‘’ʼ]/g, "'").match(/[a-z][a-z'-]{2,}/g)?.map(w => w.replace(/'s$/, "").replace(/(ss|x|z|ch|sh)es$/, "$1").replace(/ies$/, "y").replace(/([^s])s$/, "$1")).filter(w => w.length >= 3 && !NOT_CONTENT.has(w)) ?? [];
/** Pure: whether the request's content words overlap the lesson or material it was asked in. */
export function contextOverlap(requestText: string, ctx: IntentContext | null | undefined): boolean {
  if (!ctx || !(INTENT_SURFACES as readonly string[]).includes(ctx.surface)) return false;
  const lesson = new Set([ctx.lessonTitle, ctx.objective, ctx.activity, ...(ctx.materialTopics ?? []).slice(0, 100)].flatMap(contentWords));
  if (!lesson.size) return false;
  return contentWords(requestText).some(w => lesson.has(w));
}

/** Pure: the intent features of a learner's own request words. With `context`, `contextFraming` says whether the
 *  request is about the lesson or material it was asked in. */
export function intentFeatures(requestText: string, context?: IntentContext | null): IntentFeatures {
  const t = norm(requestText ?? "");
  const studyFraming = any(t, STUDY_FRAMING);
  const caseFraming = any(t, CASE_FRAMING);
  const firstPersonAdministration = any(t, FIRST_PERSON_ADMIN);
  const administration = firstPersonAdministration || any(t, OTHER_ADMIN);
  const family = FAMILY.test(t);
  const pronounRecipient = PRONOUN_RECIPIENT.test(t);
  const namedPerson = any(t, NAMED) || family || pronounRecipient;
  const deteriorating = DETERIORATION_ANY.test(t);
  const concerning = deteriorating || CONCERNING.test(t);
  const action = any(t, FIRST_PERSON_ACTION);

  const kinds: (RefusalKind | null)[] = [];
  if (any(t, PERSONAL_SAFETY)) kinds.push("personal_safety");
  if (any(t, IDENTIFIER)) kinds.push("identifiable");
  // Possessive or first-person care, or a bed number, is a real patient whatever the framing.
  const realCare = POSSESSIVE_CARE.test(t) || any(t, FIRST_PERSON_CARE) || BED_NUMBER.test(t);
  if (realCare) kinds.push(concerning && (HARD_NOW.test(t) || action || SOFT_URGENT.test(t)) ? "emergency" : administration ? "administration" : "real_patient");
  // "Right now" with a clinical action, a decision about giving, or someone deteriorating: happening now, never a study.
  if (HARD_NOW.test(t) && (concerning || action)) kinds.push("emergency");
  else if (HARD_NOW.test(t) && administration) kinds.push("administration");
  // A definite person deteriorating, or an urgent "what do I do": active emergency, unless the text is a simulated case.
  if (!caseFraming && ACUTE_NOW.test(t)) kinds.push("emergency");
  if (!caseFraming && !studyFraming && action && (SOFT_URGENT.test(t) || concerning)) kinds.push("emergency");
  // A cry for help, "urgently" or being alone with someone unwell: happening now, whatever framing is added.
  if (ALONE_URGENT.test(t) && concerning && (action || /(^|\s)help[,!]/.test(t))) kinds.push("emergency");
  // A family member unwell now, or being given a medicine, is a real person.
  if (family && (concerning || administration)) kinds.push(concerning ? "emergency" : "administration");
  // Giving a medicine to a NAMED person in the first person ("should I give X to Mrs ..."): real, even in a "case".
  if (firstPersonAdministration && any(t, NAMED)) kinds.push("administration");
  // Giving to him / her in the first person ("should I give him ..."): a specific person, whatever framing is added.
  if (firstPersonAdministration && pronounRecipient) kinds.push("administration");

  return {
    realPatient: firstKind(kinds), administration, firstPersonAdministration, namedPerson,
    studyFraming, caseFraming, questionFraming: studyFraming || caseFraming || QUESTION_FRAMING.test(t),
    contextFraming: contextOverlap(requestText ?? "", context),
  };
}

/**
 * Pure: intent features over every READING of the request (spelling.ts classificationReadings: as typed, as corrected,
 * and with asked-about words beside their candidates), taking the MORE CAUTIOUS result: the most serious real-patient
 * reason any reading shows, and any reading's giving decision or named person. Framing is any reading's, which only
 * decides between asking and answering a request with NO real-patient evidence in any reading.
 */
export function cautiousIntentFeatures(requestText: string, opts: { context?: IntentContext | null; vocabulary?: readonly string[] } = {}): IntentFeatures & { normalised: NormalisedText } {
  const { readings, normalised } = classificationReadings(requestText ?? "", { vocabulary: opts.vocabulary });
  const fs = readings.map(r => intentFeatures(r, opts.context));
  const or = (k: keyof Omit<IntentFeatures, "realPatient">) => fs.some(f => f[k]);
  return {
    realPatient: firstKind(fs.map(f => f.realPatient)), administration: or("administration"), firstPersonAdministration: or("firstPersonAdministration"),
    namedPerson: or("namedPerson"), studyFraming: or("studyFraming"), questionFraming: or("questionFraming"), caseFraming: or("caseFraming"),
    contextFraming: or("contextFraming"), normalised,
  };
}
