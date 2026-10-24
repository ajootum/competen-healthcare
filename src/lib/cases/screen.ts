/* eslint-disable @typescript-eslint/no-explicit-any */
import { findPatientIdentifiers, isValidNhsNumber } from "@/lib/privacy/patient-identifiers";

// ── THE CASE IDENTIFIER SCREEN ── COMPETEN-HOLDINGS-AI-CONSUMPTION-01 s7 (C1), IND-004 C-b, migration 423 ──────
//
// ⚠ A DETERMINISTIC ELIGIBILITY GATE, NOT AN AI VERDICT (owner Stage 5 case interface approval). Before any case enters
// the shared pipeline -- a student's offered candidate, or an educator's library version at submission -- every text
// field is screened here. Any finding makes it ineligible. Nothing an AI says about the content ("de-identified")
// is read at all.
//
// ⚠ TWO LAYERS, ONE LIST. STRUCTURED_KINDS are the identifiers with a shape a pattern can be sure of. The database
// checks the same kinds with the same patterns (case_identifier_kinds, migration 423), so a bypassed screen still
// cannot store one. This module adds what only an application can judge -- a titled name, a street address, a named
// facility, an exact age over 89, a patient age that is not a band -- and so is STRICTER than the database, never
// looser. CASE_SCREEN_CORPUS below is run against both (blueprint tests here, the staging harness there).
//
// It reports the KIND found, never the value.

export const CASE_SCREEN_VERSION = "case-screen/1";

export type StructuredKind = "nhs_number" | "date_of_birth" | "hospital_number" | "email" | "phone" | "calendar_date" | "postcode" | "national_id";
export type ScreenKind = StructuredKind | "written_date" | "titled_name" | "street_address" | "named_facility" | "exact_age_over_89" | "age_not_banded" | "source_refs";
export const STRUCTURED_KINDS: readonly StructuredKind[] = ["nhs_number", "date_of_birth", "hospital_number", "email", "phone", "calendar_date", "postcode", "national_id"];

const UUID_G = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

/** Pure: the structured kinds in a text, as case_identifier_kinds() finds them. Record ids (uuids) are blanked first. */
export function structuredKinds(text: string): StructuredKind[] {
  const t = text.replace(UUID_G, " ");
  const found: StructuredKind[] = [];
  for (const m of t.matchAll(/(?:^|[^0-9])([0-9]{3})[ -]?([0-9]{3})[ -]?([0-9]{4})(?=$|[^0-9])/g)) {
    if (isValidNhsNumber(m[1] + m[2] + m[3])) { found.push("nhs_number"); break; }
  }
  if (/(?:^|[^a-z])(?:dob|d\.o\.b\.?|date of birth)\s*[:-]?\s*[0-9]{1,2}[/.-][0-9]{1,2}[/.-][0-9]{2,4}/i.test(t)) found.push("date_of_birth");
  if (/(?:^|[^a-z])(?:mrn|hospital\s+(?:no|number)|patient\s+(?:id|number)|unit\s+number)\s*[:#.]?\s*[a-z]{0,3}[0-9]{5,}/i.test(t)) found.push("hospital_number");
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(t)) found.push("email");
  if (/(\+[0-9]{1,3}[ -]?[0-9]{2,4}[ -]?[0-9]{3}[ -]?[0-9]{3,4})|((?:^|[^0-9])0[0-9]{2,4}[ -]?[0-9]{3,4}[ -]?[0-9]{3,4}(?=$|[^0-9]))/.test(t)) found.push("phone");
  if (/(?:^|[^0-9])(?:[0-2]?[0-9]|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-](?:19|20)[0-9]{2}(?=$|[^0-9])/.test(t)
    || /(?:^|[^0-9])(?:19|20)[0-9]{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])(?=$|[^0-9])/.test(t)) found.push("calendar_date");
  if (/(?:^|[^A-Za-z0-9])[A-Z]{1,2}[0-9][A-Z0-9]?\s+[0-9][A-Z]{2}(?=$|[^A-Za-z0-9])/.test(t)) found.push("postcode");
  if (/(?:^|[^A-Z0-9])C[MF][A-Z0-9]{12}(?=$|[^A-Z0-9])/.test(t)) found.push("national_id");
  return found;
}

/** Pure: everything the application screens a text for -- the structured kinds and the judged ones. */
export function screenText(text: string): ScreenKind[] {
  const found = new Set<ScreenKind>(structuredKinds(text));
  for (const k of findPatientIdentifiers(text)) found.add(k);
  // An exact date the structured pattern does not take: written out, or with a two-digit year. Relative times
  // ("day 2 post-op", "3/7", "1/52", "at 14:00") are clinical and pass.
  if (/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?,?\s+(?:19|20)\d{2}\b/i.test(text)
    || /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+(?:19|20)\d{2}\b/i.test(text)
    || /(?:^|[^0-9/])(?:[0-2]?[0-9]|3[01])[/.-](?:0?[1-9]|1[0-2])[/.-][0-9]{2}(?![0-9/])/.test(text)) found.add("written_date");
  if (/\b(?:Mr|Mrs|Ms|Miss|Mx|Dr|Master)\.?\s+[A-Z][a-z]+/.test(text)) found.add("titled_name");
  if (/\b\d{1,4}[a-z]?\s+(?:[A-Z][a-z]+\s+){1,3}(?:Road|Rd|Street|St|Lane|Ln|Avenue|Ave|Close|Drive|Dr|Way|Crescent|Place|Court|Gardens|Terrace|Plot)\b/.test(text)) found.add("street_address");
  if (/\b(?:St\.?|Saint)\s+[A-Z][a-z]+(?:'s)?\s+(?:Hospital|Clinic|Infirmary|Health Centre)\b|\b[A-Z][a-z]+\s+(?:General|Royal|Teaching|Referral|Regional|District|University)\s+Hospital\b/.test(text)) found.add("named_facility");
  if (/\b(?:9\d|1[01]\d)\s*-?\s*(?:years?|yrs?|y\/o|year-old)\b/i.test(text)) found.add("exact_age_over_89");
  return [...found];
}

const AGE_BAND = /^(?:\d{1,2}\s*-\s*\d{1,2}|under\s+\d{1,2}|\d{2}\+)$/i;

/** Pure: every string inside a value (keys excluded), in order. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v as Record<string, unknown>)) strings(x, out);
  return out;
}

/**
 * Pure: the screen of a whole case-blueprint/1 document. Empty means it may enter the shared pipeline. The patient's
 * age must be a band, and a candidate carries no source references (privateCaseSnapshot strips them, IND-004 B8).
 */
export function screenBlueprint(b: unknown): ScreenKind[] {
  const found = new Set<ScreenKind>();
  for (const s of strings(b)) for (const k of screenText(s)) found.add(k);
  const band = (b as any)?.patient?.ageBand;
  if (band !== undefined && band !== null && !(typeof band === "string" && AGE_BAND.test(band.trim()))) found.add("age_not_banded");
  if (Array.isArray((b as any)?.decisionPoints) && (b as any).decisionPoints.some((d: any) => Array.isArray(d?.sourceRefs) && d.sourceRefs.length)) found.add("source_refs");
  return [...found];
}

export const SCREEN_LABEL: Record<ScreenKind | "verbatim_overlap", string> = {
  nhs_number: "an NHS number", date_of_birth: "a labelled date of birth", hospital_number: "a hospital or patient number",
  email: "an e-mail address", phone: "a telephone number", calendar_date: "a calendar date", postcode: "a postcode",
  national_id: "a national ID number", written_date: "an exact date", titled_name: "a name with a title", street_address: "a street address",
  named_facility: "a named hospital or clinic", exact_age_over_89: "an exact age over 89", age_not_banded: "a patient age that is not a band",
  source_refs: "references to the student's own notes", verbatim_overlap: "text copied from the student's notes",
};

/**
 * The parity corpus: each text, and the STRUCTURED kinds both the database and this module must find in it (in the
 * database's order). The judged kinds are this module's alone and are not part of parity.
 */
export const CASE_SCREEN_CORPUS: readonly { text: string; kinds: StructuredKind[] }[] = [
  { text: "Respiratory rate 30, SpO2 91% on air, BP 120/80, HR 118, temp 38.9 C, day 2 after surgery, B12 5mg, age band 60-69", kinds: [] },
  { text: "Competency 00000000-0000-0000-0000-00000000ac01 and domain 943e4567-e89b-12d3-a456-426614174000", kinds: [] },
  { text: "NHS 943 476 5919", kinds: ["nhs_number"] },
  { text: "ref 943 476 5918", kinds: [] },
  { text: "DOB: 12/03/1961", kinds: ["date_of_birth", "calendar_date"] },
  { text: "MRN 1234567", kinds: ["hospital_number"] },
  { text: "write to j.okello@example.org", kinds: ["email"] },
  { text: "call +256 772 123 456", kinds: ["phone"] },
  { text: "call 020 7946 0958", kinds: ["phone"] },
  { text: "seen 2024-03-12", kinds: ["calendar_date"] },
  { text: "lives at SW1A 1AA", kinds: ["postcode"] },
  { text: "NIN CM12345678ABCD", kinds: ["national_id"] },
  // Relative clinical times pass both layers (the main session's 423 record: educators need them).
  { text: "day 2 post-op, post-operative day 3, 3/7 history of cough, 1/52 ago, at 14:00, 06:00 observations, Q4H, GCS 14/15, NEWS2 7", kinds: [] },
  { text: "observations at 0800, 1200 and 1600", kinds: [] },
  // A KNOWN FALSE REFUSAL, in both layers alike: 24-hour times separated only by spaces read as a telephone number.
  { text: "observations at 0800 1200 1600", kinds: ["phone"] },
];
