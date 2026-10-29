import { EXPERIENCES, type ExperienceKey } from "./experiences";
import type { IndividualPassport } from "./passport";
import { summariseOwn } from "./professional/passport-records";

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
