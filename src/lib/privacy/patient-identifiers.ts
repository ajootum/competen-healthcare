// ── THE PATIENT-IDENTIFIER SCREEN ── Holdings, shared by every product that handles a person's own text ──────
//
// COMPETEN-HOLDINGS-SHARED-ENGINES-01. First written for Competen Scholar uploads (COMPETEN-IND-002 s3.3), and
// MOVED here VERBATIM from src/lib/individual/scholar/extract.ts, which re-exports it so Scholar is unchanged.
// Products that may not import Scholar (Competen Professional's AI suggestions) use it from here.
//
// Pure: no I/O. It names the KIND of identifier found, never the value.

// ── PATIENT-IDENTIFIABLE DATA CHECK ── COMPETEN-IND-002 s3.3: "Uploads must not hold patient-identifiable
// data, so this needs a notice and a check." The notice is PII_WARNING plus a required attestation. This is
// the check. It looks for identifiers that have a recognisable SHAPE, and it is not exhaustive: a name next
// to a diagnosis has no shape a pattern can find, which is why the attestation is required as well.
// It reports the KIND of identifier found, never the value.

export type PiiKind = "nhs_number" | "date_of_birth" | "hospital_number";

/**
 * The NHS number modulus-11 check (NHS Data Dictionary). Ten digits, the last is the check digit. A
 * leading 0 is refused: UK telephone numbers start with 0 and about one in eleven would pass the check,
 * while NHS numbers in issue do not start with 0.
 */
export function isValidNhsNumber(digits: string): boolean {
  if (!/^[1-9]\d{9}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(digits[i]) * (10 - i);
  const check = 11 - (sum % 11);
  if (check === 10) return false;
  return (check === 11 ? 0 : check) === Number(digits[9]);
}

export function findPatientIdentifiers(text: string): PiiKind[] {
  const found = new Set<PiiKind>();
  for (const m of text.matchAll(/(?<!\d)(\d{3})[ -]?(\d{3})[ -]?(\d{4})(?!\d)/g)) {
    if (isValidNhsNumber(m[1] + m[2] + m[3])) { found.add("nhs_number"); break; }
  }
  if (/\b(?:dob|d\.o\.b\.?|date of birth)\s*[:\-]?\s*\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b/i.test(text)) found.add("date_of_birth");
  if (/\b(?:mrn|hospital\s+(?:no|number)|patient\s+(?:id|number)|unit\s+number)\s*[:#.]?\s*[A-Z]{0,3}\d{5,}\b/i.test(text)) found.add("hospital_number");
  return [...found];
}

export const PII_LABEL: Record<PiiKind, string> = {
  nhs_number: "an NHS number",
  date_of_birth: "a labelled date of birth",
  hospital_number: "a hospital or patient number",
};
