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

const SECTION_HEADING: Record<FactCategory, string> = {
  encounter: "Clinical context",
  diagnosis: "Diagnoses",
  procedure: "Procedures",
  investigation: "Investigations",
  treatment: "Treatment given",
  medication: "Current medication",
  follow_up: "Follow-up arranged",
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
 * Group facts into the letter's sections, in a fixed order.
 *
 * A section with no selected facts is not printed. An empty heading tells a reader something was
 * considered and found absent, which is a clinical claim this function is not entitled to make.
 */
function factSections(facts: SelectableFact[]): { blocks: string[]; used: string[] } {
  const blocks: string[] = [];
  const used: string[] = [];
  for (const category of SECTION_ORDER) {
    const inSection = facts.filter(f => f.category === category);
    if (!inSection.length) continue;
    blocks.push([SECTION_HEADING[category], ...inSection.map(factLine)].join("\n"));
    used.push(...inSection.map(f => f.key));
  }
  return { blocks, used };
}

/**
 * A referral letter, from selected facts and what the practitioner typed.
 *
 * Section 13's minimum inputs for a referral are recipient/destination, reason, relevant clinical
 * context and requested action. The first, second and fourth are practitioner input. The third is the
 * selected facts, and nothing else.
 */
export function composeReferralLetter(input: ReferralLetterInput): ComposedDocument {
  const { blocks, used } = factSections(input.facts);
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
