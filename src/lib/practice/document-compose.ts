import type { FactCategory, SelectableFact } from "@/lib/practice/document-facts";

// CPR-DOC-AUTO-001 sections 4, 10 and 17 -- COMPOSITION, AND WHY IT IS A PURE FUNCTION.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// GROUNDING IS ENFORCED BY THE SIGNATURE, NOT BY CARE.
//
// Section 10 forbids inventing clinical facts and section 17 makes "every clinical assertion is
// supported by selected source data or explicit practitioner input" a PASS condition. A composer that
// could read the database would have to be trusted not to. This one cannot: it takes facts and typed
// input and returns text. No client, no patient id, no fetch, no clock.
//
// So the acceptance test is not "did we remember to only use selected facts" -- it is "here are three
// facts, here is the output, does anything clinical appear that is not one of them". That question is
// answerable, and a future edit that reaches for the record has to change this file's signature to do
// it, which is exactly the moment somebody should be asked why.
//
// THE CLOCK IS PASSED IN. `today` arrives already resolved in the practice's timezone. Calling a date
// function here would put the SERVER's day on a letter that is signed and cannot be edited -- the bug
// this codebase already fixed once in buildMergeContext, one merge field at a time.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// MISSING IS OMITTED, NEVER GUESSED. Section 17: "Missing facts are omitted rather than fabricated." A
// patient with no recorded identifier gets a letter with no identifier on it, not a blank after a
// label and not a placeholder. This differs from the template engine's visible-marker rule for good
// reason: a merge field is a hole somebody authored and must be told about, whereas here the composer
// owns the sentence and can simply not write it.

export type RecipientKind = "clinician" | "specialty" | "facility" | "other";

export type Recipient = {
  kind: RecipientKind;
  displayName: string;
  specialty?: string | null;
  facility?: string | null;
  address?: string | null;
};

export type ComposedDocument = {
  title: string;
  body: string;
  /**
   * The facts the composer actually consumed. Provenance is written from THIS, never from what the
   * caller selected -- so practice_document_fact can never claim a document disclosed something that
   * does not appear in it.
   */
  usedFactKeys: string[];
};

export type ReferralLetterInput = {
  today: string | null;
  /** Verified AI prose standing in for the fact lists. See factSections. */
  narrative?: string | null;
  recipient: Recipient;
  patient: { name: string | null; identifier: string | null; sex: string | null; age: string | null };
  /** Practitioner-typed. Section 17 counts this as grounding: it is explicit practitioner input. */
  reason: string;
  requestedAction: string | null;
  facts: SelectableFact[];
  practitionerName: string | null;
  practiceName: string | null;
};

const clean = (v: string | null | undefined): string | null => {
  const t = (v ?? "").trim();
  return t.length ? t : null;
};

/**
 * The recipient as one line of text.
 *
 * Shared deliberately: the letter's address block and practice_referral.referred_to are rendered by the
 * same function, so a structured destination cannot say one thing in the letter and another in the
 * referral record. Migration 352 keeps referred_to as the rendered recipient precisely so every existing
 * reader keeps working, and that promise is only true if exactly one renderer exists.
 */
export function recipientLine(r: Recipient): string {
  const parts = [clean(r.displayName)];
  if (r.kind !== "specialty") parts.push(clean(r.specialty ?? null));
  if (r.kind !== "facility") parts.push(clean(r.facility ?? null));
  return parts.filter(Boolean).join(", ");
}

function addressBlock(r: Recipient): string[] {
  const lines = [recipientLine(r)];
  const address = clean(r.address ?? null);
  if (address) lines.push(...address.split("\n").map(l => l.trim()).filter(Boolean));
  return lines;
}

/** "Dear Dr Okello," for a person; "Dear Colleague," for a service, which is what a service is sent. */
function salutation(r: Recipient): string {
  const name = clean(r.displayName);
  return r.kind === "clinician" && name ? `Dear ${name},` : "Dear Colleague,";
}

/** "Jane Doe - 26-000141 - female, 34" -- only the parts that are recorded. */
function patientLine(p: ReferralLetterInput["patient"]): string | null {
  const name = clean(p.name);
  if (!name) return null;
  const demographics = [clean(p.sex), clean(p.age)].filter(Boolean).join(", ");
  return [name, clean(p.identifier), demographics || null].filter(Boolean).join(" - ");
}

const SECTION_ORDER: FactCategory[] = [
  "encounter", "diagnosis", "procedure", "investigation", "treatment", "medication", "follow_up",
];

/**
 * Headings for a letter to a clinician.
 *
 * Clinical register, because the reader is a colleague: "Diagnoses" means what it says and does not
 * need softening.
 */
const CLINICIAN_HEADING: Record<FactCategory, string> = {
  encounter: "Clinical context",
  diagnosis: "Diagnoses",
  procedure: "Procedures",
  investigation: "Investigations",
  treatment: "Treatment given",
  medication: "Current medication",
  follow_up: "Follow-up arranged",
};

/**
 * Headings for a document the PATIENT reads.
 *
 * ⚠ ONLY THE HEADINGS CHANGE. The facts underneath print exactly as recorded, here as everywhere --
 * a diagnosis recorded as provisional still says provisional under "What we found". Rewriting a
 * clinical label into gentler words would be the composer making a clinical judgement about what the
 * patient should be told, which section 10 forbids and which is the practitioner's call, not this
 * function's. The heading is the frame around the facts, not a translation of them.
 */
const PATIENT_HEADING: Record<FactCategory, string> = {
  encounter: "Your visit",
  diagnosis: "What we found",
  procedure: "What was done",
  investigation: "Tests",
  treatment: "Treatment",
  medication: "Your medication",
  follow_up: "Next steps",
};

/**
 * One fact as one line.
 *
 * The label and detail are printed as recorded. Nothing is rephrased, expanded or inferred -- a
 * certainty of "provisional" prints as "provisional" and does not become "likely".
 */
function factLine(f: SelectableFact): string {
  const detail = clean(f.detail);
  const label = clean(f.label) ?? "";
  return detail ? `- ${label} (${detail})` : `- ${label}`;
}

/**
 * The section grouping, exported so the AI phrasing layer sends the model the SAME structure this
 * composer would otherwise have printed. Two groupings would let the model return headings the
 * deterministic fallback does not have, and a fallback that changes the document's shape is not a
 * fallback.
 */
export function sectionsFor(audience: "clinician" | "patient", facts: SelectableFact[]):
  { heading: string; facts: SelectableFact[] }[] {
  const headings = audience === "patient" ? PATIENT_HEADING : CLINICIAN_HEADING;
  return SECTION_ORDER
    .map(category => ({ heading: headings[category], facts: facts.filter(f => f.category === category) }))
    .filter(s => s.facts.length > 0);
}

/**
 * Group facts into the document's sections, in a fixed order.
 *
 * A section with no selected facts is not printed. An empty heading tells a reader something was
 * considered and found absent, which is a clinical claim this function is not entitled to make.
 *
 * NARRATIVE REPLACES THE FACT BLOCKS AND NOTHING ELSE.
 *
 * When the phrasing layer has produced VERIFIED prose it stands in for the labelled lists, and only
 * for those. The date, the address, the salutation, the practitioner's typed text and the sign-off
 * are composed here as they always were. Section 10 requires the practitioner's own words to stay
 * "clearly separate" from generated narrative, and the way to guarantee that is for the generated
 * part never to reach them.
 *
 * The used-key list is still computed from the FACTS, never from the prose. verifyGrounded has
 * already established that every fact appears in it.
 */
function factSections(facts: SelectableFact[], headings: Record<FactCategory, string>, narrative?: string | null): {
  blocks: string[]; used: string[];
} {
  const blocks: string[] = [];
  const used: string[] = [];
  for (const category of SECTION_ORDER) {
    const inSection = facts.filter(f => f.category === category);
    if (!inSection.length) continue;
    blocks.push([headings[category], ...inSection.map(factLine)].join("\n"));
    used.push(...inSection.map(f => f.key));
  }
  const prose = (narrative ?? "").trim();
  return { blocks: prose ? [prose] : blocks, used };
}

/**
 * A referral letter, from selected facts and what the practitioner typed.
 *
 * Section 13's minimum inputs for a referral are recipient/destination, reason, relevant clinical
 * context and requested action. The first, second and fourth are practitioner input. The third is the
 * selected facts, and nothing else.
 */
export function composeReferralLetter(input: ReferralLetterInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, CLINICIAN_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  parts.push(addressBlock(input.recipient).join("\n"));
  parts.push(salutation(input.recipient));

  const re = patientLine(input.patient);
  if (re) parts.push(`Re: ${re}`);

  const reason = clean(input.reason);
  if (reason) parts.push(["Reason for referral", reason].join("\n"));

  parts.push(...blocks);

  const action = clean(input.requestedAction);
  if (action) parts.push(["Requested action", action].join("\n"));

  parts.push("Yours sincerely,");
  const signature = [clean(input.practitionerName), clean(input.practiceName)].filter(Boolean);
  if (signature.length) parts.push(signature.join("\n"));

  const who = clean(input.patient.name);
  return {
    title: who ? `Referral letter - ${who}` : "Referral letter",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

// ── PATIENT-FACING DOCUMENTS (Phase 2) ──────────────────────────────────────────────────────────────
//
// Sections 3 and 5 make the visit summary and patient instructions the second and third documents to
// automate, and section 7 groups them as "Patient documents" -- a different audience from the referral
// letter, not a different pipeline.
//
// WHAT CHANGES FOR A PATIENT AUDIENCE, and it is less than it looks: there is no recipient to address,
// no salutation to a colleague, and the section headings come from PATIENT_HEADING. What does NOT
// change is the fact lines themselves. See the comment on PATIENT_HEADING for why.

export type PatientDocumentInput = {
  today: string | null;
  /** Verified AI prose standing in for the fact lists. See factSections. */
  narrative?: string | null;
  patient: { name: string | null; identifier: string | null; sex: string | null; age: string | null };
  facts: SelectableFact[];
  practitionerName: string | null;
  practiceName: string | null;
};

export type VisitSummaryInput = PatientDocumentInput & {
  /** The day the consultation happened, already resolved in the practice's timezone. */
  visitDate: string | null;
};

export type PatientInstructionsInput = PatientDocumentInput & {
  /** Practitioner-typed. Section 13: the practitioner confirms the instructions. */
  instructions: string | null;
};

/** "Aisha Nakato - 26-000141" -- the patient's own document names them, without the demographics. */
function patientHeading(p: PatientDocumentInput["patient"]): string | null {
  const name = clean(p.name);
  if (!name) return null;
  return [name, clean(p.identifier)].filter(Boolean).join(" - ");
}

function signOff(who: string, input: PatientDocumentInput): string[] {
  const name = clean(input.practitionerName);
  const practice = clean(input.practiceName);
  if (!name && !practice) return [];
  return [[`${who} ${name ?? practice}`, name && practice ? practice : null].filter(Boolean).join("\n")];
}

/**
 * A visit summary, for the patient.
 *
 * Section 3's automation mode is "One-click / review": CP already holds the facts, so nothing is asked
 * for. Section 17's PASS condition is "Current encounter generates without manual re-entry", which is
 * why this takes no typed input at all -- every line comes from the record.
 */
export function composeVisitSummary(input: VisitSummaryInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, PATIENT_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  const who = patientHeading(input.patient);
  const header = [who ? `Visit summary for ${who}` : "Visit summary"];
  const visit = clean(input.visitDate);
  if (visit) header.push(`Date of visit: ${visit}`);
  parts.push(header.join("\n"));

  parts.push(...blocks);
  parts.push(...signOff("Seen by", input));

  const name = clean(input.patient.name);
  return {
    title: name ? `Visit summary - ${name}` : "Visit summary",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

/**
 * Patient instructions, for the patient.
 *
 * Section 3's mode is "Decision + generation" from treatment, plan and follow-up. The decision is what
 * the practitioner types plus what they tick, and this composes the two.
 *
 * THE TYPED INSTRUCTIONS LEAD. What the practitioner wants the patient to DO is the point of the
 * document, so it is the first thing under the heading rather than a note appended after a list of
 * recorded facts.
 */
export function composePatientInstructions(input: PatientInstructionsInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, PATIENT_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  const who = patientHeading(input.patient);
  parts.push(who ? `Instructions for ${who}` : "Instructions");

  const instructions = clean(input.instructions);
  if (instructions) parts.push(["What to do", instructions].join("\n"));

  parts.push(...blocks);
  parts.push(...signOff("Prepared by", input));

  const name = clean(input.patient.name);
  return {
    title: name ? `Patient instructions - ${name}` : "Patient instructions",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

// ── PHASE 3: PRIORITIES 4 TO 7 ──────────────────────────────────────────────────────────────────────
//
// Two more for a clinician (clinical summary, investigation request) and two more for the patient
// (follow-up instructions, medication list). Nothing new is invented here -- each is the same three
// ingredients as the first three documents: a heading, what the practitioner typed, and the selected
// facts under the heading set for their audience.

export type ClinicalSummaryInput = PatientDocumentInput & {
  recipient: Recipient;
  /** Section 13: "Purpose/recipient; date range; disclosure selection." */
  purpose: string;
  /** The practice days the practitioner chose, if they chose any. */
  periodFrom: string | null;
  periodTo: string | null;
};

export type InvestigationRequestInput = PatientDocumentInput & {
  /** Optional: an investigation may be requested without naming where it is being sent. */
  recipient: Recipient | null;
  /** Section 13: "Investigation/order; clinical indication; destination if needed." */
  clinicalIndication: string;
};

export type FollowUpInstructionsInput = PatientDocumentInput & {
  /** Section 13: "Timing/action/location; patient instructions." */
  instructions: string | null;
};

export type MedicationListInput = PatientDocumentInput;

/**
 * A clinical summary, for a colleague.
 *
 * Section 3's mode is "Select + summarise" over the longitudinal record, so unlike every other
 * document here the practitioner chooses a window as well as a selection.
 *
 * ⚠ THE PERIOD LINE IS PRINTED ONLY WHEN A PERIOD WAS CHOSEN, and never replaced with a claim of
 * completeness. "Covering the full record" would be a false statement: the registry offers at most
 * CATEGORY_LIMIT facts per category, so a long record is already partial before the practitioner
 * selects anything. A summary that lists what it contains and claims nothing more is honest. One that
 * says "full record" is not, and a colleague would rely on it.
 */
export function composeClinicalSummary(input: ClinicalSummaryInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, CLINICIAN_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  parts.push(addressBlock(input.recipient).join("\n"));
  parts.push(salutation(input.recipient));

  const re = patientLine(input.patient);
  if (re) parts.push(`Re: ${re}`);

  const purpose = clean(input.purpose);
  if (purpose) parts.push(["Purpose of this summary", purpose].join("\n"));

  const from = clean(input.periodFrom);
  const to = clean(input.periodTo);
  if (from || to) {
    const period = from && to ? `${from} to ${to}` : from ? `from ${from}` : `up to ${to}`;
    parts.push(`Period covered: ${period}`);
  }

  parts.push(...blocks);
  parts.push("Yours sincerely,");
  const signature = [clean(input.practitionerName), clean(input.practiceName)].filter(Boolean);
  if (signature.length) parts.push(signature.join("\n"));

  const name = clean(input.patient.name);
  return {
    title: name ? `Clinical summary - ${name}` : "Clinical summary",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

/**
 * An investigation request.
 *
 * THE RECIPIENT IS OPTIONAL AND THE SALUTATION FOLLOWS IT. Section 13 says "destination if needed" --
 * a request handed to the patient to take wherever they choose has no destination, and printing
 * "Dear Colleague," at the top of a page addressed to nobody is the kind of small wrongness that makes
 * a document look automated.
 */
export function composeInvestigationRequest(input: InvestigationRequestInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, CLINICIAN_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  if (input.recipient) {
    parts.push(addressBlock(input.recipient).join("\n"));
    parts.push(salutation(input.recipient));
  }

  const re = patientLine(input.patient);
  if (re) parts.push(`Re: ${re}`);

  parts.push(...blocks);

  const indication = clean(input.clinicalIndication);
  if (indication) parts.push(["Clinical indication", indication].join("\n"));

  const signature = [clean(input.practitionerName), clean(input.practiceName)].filter(Boolean);
  if (signature.length) parts.push([`Requested by ${signature[0]}`, ...signature.slice(1)].join("\n"));

  const name = clean(input.patient.name);
  return {
    title: name ? `Investigation request - ${name}` : "Investigation request",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

/**
 * Follow-up instructions, for the patient.
 *
 * Section 3's mode is "One-click / review" over the follow-up plan. The typed field is optional and
 * carries what the record cannot: where to come, who to ask for, what to bring.
 */
export function composeFollowUpInstructions(input: FollowUpInstructionsInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, PATIENT_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  const who = patientHeading(input.patient);
  parts.push(who ? `Follow-up for ${who}` : "Follow-up");

  parts.push(...blocks);

  const instructions = clean(input.instructions);
  if (instructions) parts.push(["Please note", instructions].join("\n"));

  parts.push(...signOff("Prepared by", input));

  const name = clean(input.patient.name);
  return {
    title: name ? `Follow-up instructions - ${name}` : "Follow-up instructions",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}

/**
 * The current medication list, for the patient.
 *
 * Section 3's mode is "One-click", section 17's PASS condition is "matches authoritative current
 * treatments", and section 13 asks only that the practitioner confirm it. So there is no typed input
 * at all -- the document is the list.
 *
 * ⚠ IT STATES THE DAY IT WAS CORRECT ON, and that line is not decoration. A medication list is the
 * document a patient hands to the next clinician, and one with no date is read as current whenever it
 * is found. The date is the generation day, which is a fact about this document rather than a claim
 * about the patient.
 */
export function composeMedicationList(input: MedicationListInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts, PATIENT_HEADING, input.narrative);
  const parts: string[] = [];

  const today = clean(input.today);
  if (today) parts.push(today);

  const who = patientHeading(input.patient);
  parts.push(who ? `Medication list for ${who}` : "Medication list");
  if (today) parts.push(`Correct as at ${today}`);

  parts.push(...blocks);
  parts.push(...signOff("Prepared by", input));

  const name = clean(input.patient.name);
  return {
    title: name ? `Medication list - ${name}` : "Medication list",
    body: parts.join("\n\n"),
    usedFactKeys: used,
  };
}
