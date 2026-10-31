import { EXPERIENCES, type ExperienceKey } from "./experiences";
import type { IndividualPassport } from "./passport";
import { summariseOwn } from "./professional/passport-records";
import { DIAGRAM_FORMAT_GUIDE } from "./scholar/answer-format";

// ── THE PERSONAL AI, COMPETEN INDIVIDUAL'S ENTRY POINT ── COMPETEN-IND-003 s2(6) ───────────────────────
//
// ⚠ NOT A NEW AI SERVICE. Every call goes through the existing gateway, generate() in src/lib/ai/client.ts:
// the provider-neutral adapter, plat_ai_requests usage and cost logging (migration 055), and the per-user
// hourly quota in src/lib/ai/quota.ts. This file only builds the prompt -- the persona each experience
// speaks with and the person's own record it may ground on.
//
// ⚠ ONE AI, TWO VOICES. COMPETEN-IND-001 D5 asks for one personal AI. The record it reads is the same in
// both experiences. Only the persona changes: a study companion in Scholar, a development companion in
// Professional.
//
// ⚠ NO MEMORY, AND IT SAYS SO. Nothing is stored between questions. Conversation memory needs a consent
// design (COMPETEN-IND-002 s3.3) that does not exist yet, and an assistant that silently remembered would
// be making that decision on the person's behalf.
//
// ⚠ GROUNDING IS THE PERSON'S OWN RECORD ONLY -- counts and names from their Passport, read by their own
// id. No other person's data, no organisation's aggregate, and no patient data is ever in the context.

import { QUESTION_MAX } from "./assistant-limits";
export { QUESTION_MAX };

const PERSONA: Record<ExperienceKey, string[]> = {
  scholar: [
    "You are the personal AI in Competen Scholar, a study companion for one healthcare student.",
    "Help them understand concepts, plan revision and think through clinical reasoning in general, educational terms.",
    "When you explain clinical content, say that it is general education and that they should check it against their course materials and lecturers.",
  ],
  professional: [
    "You are the personal AI in Competen Professional, a development companion for one healthcare professional.",
    "Help them plan continuing professional development, reflect on their practice in general terms, and think about their career.",
    "Do not give patient-specific clinical advice. For a real patient they must follow their organisation's protocols and senior colleagues.",
  ],
};

const SHARED_RULES = [
  "Rules:",
  "- Speak directly to the person ('you'). Be clear, kind and brief.",
  "- Write plain text: short paragraphs and simple lists starting with '- '. No markdown headings, no bold or italics, no tables, no emoji -- the answer is shown as plain text.",
  "- Use ONLY the record in the user message for anything about the person. Never invent competencies, credentials, dates, employers or achievements.",
  "- If the record does not contain what they ask about, say so plainly.",
  "- Keep three things apart: VERIFIED evidence (independently verified records, marked as verified in their record), the learner's OWN goals and records (marked as recorded by them, not verified), and YOUR suggestions (always called suggestions). Never present a suggestion as their goal, or an unverified record as verified. If something is not recorded, say so instead of guessing.",
  "- You do not make, change or verify any competency or credential. Only an authorised assessor or organisation can.",
  "- You cannot see their uploaded files, courses or past conversations. This conversation is not saved.",
  "- Never ask for or repeat patient-identifiable information.",
  "- This is guidance, not clinical advice. In an emergency or for a deteriorating patient, they must escalate to a clinician, not use this tool.",
];

export function systemPrompt(experience: ExperienceKey): string {
  return [...PERSONA[experience], ...SHARED_RULES].join("\n");
}

// ── SCHOLAR-PAI-EXPERIENCE-01: THE SCHOLAR PERSONAL AI WRITES STRUCTURED TEXT ──────────────────────────────────────
//
// ONLY the Scholar Personal AI (personal-ai.ts assistantSystemPrompt for Scholar) swaps the plain-text rule for the
// format Scholar's renderer parses (src/lib/individual/scholar/answer-format.ts). Every other rule stays, word for
// word, in its place; systemPrompt() above -- what Professional and every other caller reads -- is unchanged. No
// citation tags by default: the Personal AI page (route A) hands over no study material, so there is nothing honest to cite.
// SCHOLAR-PAI-RESEARCH-01: ONLY the Learn-step route (route B) numbers the passages it hands over ([S1], [S2], personal-ai-sources.ts),
// and ONLY there (`passages: true`) does the prompt allow [S n] tags, separate notes from background, and say what the notes
// did not cover. Without it the prompt is exactly what it was.
const PLAIN_TEXT_RULE = SHARED_RULES[2];
const SCHOLAR_FORMAT_RULES = [
  "- Format: the answer is shown by a renderer that reads ONLY this markdown: '## ' headings, '### ' sub-headings, '- ' bullets, '1. ' numbered steps, **bold** for key terms, and pipe tables (a header row, then a |---|---| row). No italics, links, images, code, HTML, emoji, citation tags or any other markdown.",
  "- Callouts: a line '> [!CAUTION]', '> [!KEY]', '> [!SUMMARY]', '> [!MEMORY]', '> [!EXAMPLE]' or '> [!RECORD]', then its lines, each starting '> '. CAUTION for a safety point, KEY for the core idea, MEMORY for a memory aid, EXAMPLE for a worked example, RECORD only for facts taken from the person's Competen record in the user message, SUMMARY for the closing summary.",
  "- Shape: lead with the direct answer in one or two sentences, then the structure. Be concise: short sections, no padding, no repetition. A question that compares two or more things gets a table. End the explanation with a one-line key summary in a > [!SUMMARY] callout.",
  "- Practice: after a substantive explanation at standard or deep depth, end with a practice block -- a line ```practice, then ONE compact JSON object on one line, then a line ```. The object: {\"flashcard\":{\"front\":\"...\",\"back\":\"...\"},\"mcq\":{\"stem\":\"...\",\"options\":[\"...\",\"...\",\"...\",\"...\"],\"answer\":0,\"explanation\":\"...\"},\"reasoning\":{\"scenario\":\"...\",\"question\":\"...\",\"model_answer\":\"...\"}}. The flashcard front is a question. The mcq has exactly four options, answer is the 0-based index of the correct one, and explanation always says why it is correct. The reasoning scenario is a fictional educational case, never advice about a real patient. Leave the block out at quick depth, and for refusals, clarifications, and questions about study planning, admin or careers.",
];

// SCHOLAR-PAI-RESEARCH-01 (route B only): the same format with the source tags allowed, and the rules that keep the learner's
// notes apart from the AI's general background. Learn's conventions: [S n] their notes, "BEYOND THE NOTES" for background,
// "Not covered in your notes" for the gaps; and, like Learn, a partly covered question is answered in part, never refused whole.
const GROUNDED_FORMAT_RULES = SCHOLAR_FORMAT_RULES.map((r, i) => i === 0
  ? r.replace("emoji, citation tags or any other markdown.", "emoji or any other markdown, and no tags except the source tags [S1], [S2] and so on described below.")
  : r);
const NOTES_RULES = [
  "- Source tags: the study material in the user message is numbered [S1], [S2] and so on. End a sentence that uses a passage with that passage's tag, for example [S2]. Cite only tags you were given, never invent a tag, and never tag something the passages do not say.",
  "- Notes versus background: what the passages support is shown as coming from their notes, and is cited. Anything else you add -- general knowledge, definitions, mechanisms or examples the passages do not contain -- goes in a callout that starts '> [!BACKGROUND]' (General background, not from your notes), with no source tags inside it. Never present an uncited claim as coming from their notes.",
  "- Partial coverage: if the passages cover only part of the question, answer the supported part first, citing it, then say what is missing: a '> [!BACKGROUND]' callout for what you can explain generally, or a short list. Never refuse the whole question when part of it can be answered. When the passages leave anything the question asks uncovered, end the answer with one final line, exactly 'NOT COVERED: ' then short phrases separated by '; ' that name what their notes do not cover (for example 'NOT COVERED: causes; first-line treatment'). Leave that line out when the passages cover the whole question. The clinical safety rules in this prompt apply unchanged to background.",
];

/**
 * The Scholar Personal AI's persona and rules: systemPrompt("scholar") with the plain-text rule replaced by the format.
 * `passages: true` (the Learn-step route, which numbers its study material) adds the source-tag and notes-versus-background rules.
 */
export function scholarPersonalAiPrompt(opts?: { passages?: boolean }): string {
  const swap = opts?.passages ? [...GROUNDED_FORMAT_RULES, ...NOTES_RULES, DIAGRAM_FORMAT_GUIDE] : [...SCHOLAR_FORMAT_RULES, DIAGRAM_FORMAT_GUIDE];
  return [...PERSONA.scholar, ...SHARED_RULES.flatMap(r => (r === PLAIN_TEXT_RULE ? swap : [r]))].join("\n");
}

/** Pure: the person's own record as plain lines. Unread sections say so rather than reading as empty. */
export function recordContext(input: {
  name: string | null;
  experience: ExperienceKey;
  live: readonly ExperienceKey[];
  passport: IndividualPassport;
}): string {
  const lines: string[] = [];
  lines.push(`Name: ${input.name ?? "not recorded"}.`);
  lines.push(`Currently using: ${EXPERIENCES[input.experience].name}. Active on their account: ${input.live.map(k => EXPERIENCES[k].name).join(", ")}.`);

  const comp = input.passport.competencies;
  if (comp === null) lines.push("Assessed competencies: could not be read just now.");
  else {
    const current = comp.filter(c => c.current);
    lines.push(`Assessed competencies on record: ${comp.length}, of which ${current.length} current and competent.`);
    if (current.length) lines.push(`Current: ${current.slice(0, 12).map(c => c.name).join("; ")}.`);
    const other = comp.filter(c => !c.current).slice(0, 8);
    if (other.length) lines.push(`Not current: ${other.map(c => `${c.name} (${c.outcome.replace(/_/g, " ")})`).join("; ")}.`);
  }

  const creds = input.passport.credentials;
  if (creds === null) lines.push("Credentials: could not be read just now.");
  else if (!creds.length) lines.push("Credentials on record: none.");
  else lines.push(`Credentials on record: ${creds.slice(0, 10).map(c => `${c.title} (${c.evidence === "institution_verified" ? "verified" : "not verified"}${c.expiryDate ? `, expires ${c.expiryDate}` : ""})`).join("; ")}.`);

  const own = input.passport.own;
  if (own === null) lines.push("Records they added themselves in Competen Professional: could not be read just now.");
  else if (own.length) {
    const s = summariseOwn(own);
    lines.push(`Records they added themselves (self-declared, not verified by anyone): ${s.byKind.registration ? "a professional registration, " : ""}${s.byKind.credential} credentials, ${s.byKind.competency_evidence} competency evidence items, ${s.byKind.cpd} CPD activities. ${s.byClass.source_linked} of them have a document attached.`);
  }

  const jobs = input.passport.employment;
  if (jobs === null) lines.push("Employment history: could not be read just now.");
  else if (jobs.length) lines.push(`Employment history: ${jobs.slice(0, 5).map(j => `${j.roleTitle}${j.organisation ? ` at ${j.organisation}` : ""}`).join("; ")}.`);

  return lines.join("\n");
}

/** Pure: validate a question. Returns the trimmed text, or null when it cannot be sent. */
export function cleanQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const q = raw.trim();
  if (!q || q.length > QUESTION_MAX) return null;
  return q;
}
