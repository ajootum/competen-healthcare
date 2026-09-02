// The relationship vocabulary, in a module that IMPORTS NOTHING.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY IT IS NOT SIMPLY IN relationships.ts, WHICH IS WHERE IT LOOKS LIKE IT BELONGS.
//
// relationships.ts is a SERVICE module: recordConsent, updatePatientAdmin, relationshipGaps, and the
// audit trail behind them. A client component that wants two constant lists from it drags that whole
// graph into the browser bundle -- which is the exact mistake audit.ts's own header records paying for:
// "IT LIVED IN provisioning.ts, AND THAT COST 120.7 kB GZIP ON FOUR SCREENS."
//
// So the data lives here, imports nothing, and relationships.ts re-exports it. Every existing importer
// keeps working; a client component takes the constants without the service.
//
// ⚠ AND THERE IS ONE LIST, NOT THREE. Before migration 364 these values were hand-copied into
// RegistrationForm.tsx as well, and adding 'parent' and 'other_relative' to the canonical list would
// have left that form offering the old fifteen while the booking form offered seventeen -- with nothing
// failing and nobody told. The form now derives its options from this list.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every relationship this product may store, matching the CHECK constraints on
 * practice_patient_relationship.relationship_type and practice_booking_request
 * .representative_relationship (migrations 221, 254, widened by 364).
 *
 * ⚠ ADDING ONE IS A MIGRATION. A value here that the database refuses is a form that fails on submit,
 * and the failure lands on whoever pressed the button rather than on whoever added the value.
 */
export const RELATIONSHIP_TYPES = [
  ["guardian", "Guardian"],
  // CPR-BOOK-FLOW-002 s8.4, migration 364: a parent without mother/father specificity, and a relative
  // the list need not enumerate. Both are ordinary vocabulary; only one of them carries authority.
  ["parent", "Parent"],
  ["mother", "Mother"],
  ["father", "Father"],
  ["spouse", "Spouse"],
  ["partner", "Partner"],
  ["sibling", "Sibling"],
  ["child", "Child"],
  ["grandparent", "Grandparent"],
  ["other_relative", "Other relative"],
  ["emergency_contact", "Emergency contact"],
  ["interpreter", "Interpreter"],
  ["employer", "Employer"],
  ["insurance_contact", "Insurance contact"],
  ["carer", "Carer"],
  ["social_worker", "Social worker"],
  ["other", "Other"],
] as const;

/**
 * The types that can carry legal authority for somebody who cannot decide for themselves.
 * Exported for the patient import, which must judge a CSV guardian by THIS list and no copy of it.
 *
 * ⚠ 'parent' JOINS THIS SET AND 'other_relative' DOES NOT, and the asymmetry is the point. A parent
 * holds exactly the authority a mother or a father holds, so leaving it out would mean a minor with a
 * recorded parent reading as having NO guardian -- the gap these columns exist to close. An aunt is a
 * relative and is not thereby a legal guardian: s8.4 says do not imply verified legal status, and s8.3
 * says do not infer guardianship from a relationship selection.
 */
export const GUARDIAN_TYPES = new Set([
  "guardian", "parent", "mother", "father", "grandparent", "carer", "social_worker",
]);
