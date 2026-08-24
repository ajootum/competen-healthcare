import {
  composeReferralLetter, composeVisitSummary, composePatientInstructions, composeClinicalSummary,
  composeInvestigationRequest, composeFollowUpInstructions, composeMedicationList,
  type ComposedDocument,
} from "@/lib/practice/document-compose";
import type { SelectableFact } from "@/lib/practice/document-facts";

// CPR-DOC-CONFIG-001 section 4 -- THE LIVE PREVIEW.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ SYNTHETIC DATA, AND THIS IS A RULE RATHER THAN A CONVENIENCE. Section 4: "Preview must use
// realistic synthetic data, never another patient's live record merely for theme configuration."
//
// Choosing a font is not a clinical purpose, and a practitioner nudging line spacing for ten minutes
// should not be paging a real patient's diagnoses onto the screen to do it. This module holds no
// client and takes no patient id, so the preview CANNOT show a real record -- the same trick the
// composer uses for grounding, applied to a different risk.
//
// AVA OKELLO DOES NOT EXIST, and the name is chosen to look like a patient rather than to look like
// test data. A preview populated with "Lorem Ipsum" and "Diagnosis 1" tells a practitioner nothing
// about whether their line spacing works on a real letter, which is what they are here to judge.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// THE REAL COMPOSERS RUN. Preview does not reimplement the documents -- it calls the same pure
// functions that generate them, so section 15's "the same resolved style must drive editor preview,
// print preview and final PDF" holds by construction. A preview that drew its own approximation would
// drift from the product the first time a composer changed, and the practitioner would be tuning a
// picture of a document rather than the document.

const fact = (
  key: string, label: string, category: SelectableFact["category"], detail: string | null,
): SelectableFact => ({
  key, category, sourceTable: `preview_${category}`, sourceId: key,
  label, detail, scope: "current_encounter", recordedOn: "2026-08-18", defaultSelected: true,
});

const PATIENT = { name: "Ava Okello", identifier: "26-000318", sex: "female", age: "47" };

const RECIPIENT = {
  kind: "clinician" as const, displayName: "Dr Miriam Ssebunya", specialty: "Respiratory medicine",
  facility: "Mulago National Referral Hospital", address: "PO Box 7051\nKampala",
};

const FACTS: SelectableFact[] = [
  fact("dx1", "Community-acquired pneumonia", "diagnosis", "confirmed - primary"),
  fact("dx2", "Type 2 diabetes mellitus", "diagnosis", "confirmed"),
  fact("rx1", "Amoxicillin with clavulanic acid", "treatment", "625mg - oral - three times daily - 7 days"),
  fact("inv1", "Chest radiograph", "investigation", "requested"),
  fact("med1", "Metformin", "medication", "500mg - oral - twice daily"),
  fact("fu1", "Review response to treatment", "follow_up", "review - due 2026-09-01"),
];

const only = (...categories: SelectableFact["category"][]) =>
  FACTS.filter(f => categories.includes(f.category));

const base = {
  today: "2026-08-24",
  patient: PATIENT,
  practitionerName: "Dr Grace Aine",
  practiceName: "Competen Practice",
};

export const PREVIEW_DOCUMENTS = [
  { key: "referral_letter", label: "Referral letter" },
  { key: "consultation_summary", label: "Visit summary" },
  { key: "patient_instructions", label: "Patient instructions" },
  { key: "clinical_summary", label: "Clinical summary" },
  { key: "investigation_request", label: "Investigation request" },
  { key: "follow_up_instructions", label: "Follow-up instructions" },
  { key: "medication_list", label: "Medication list" },
] as const;

export type PreviewKey = typeof PREVIEW_DOCUMENTS[number]["key"];

/**
 * ⚠ SECTION 4 ALSO ASKS FOR A CERTIFICATE PREVIEW, AND THERE IS NOT ONE.
 *
 * Certificates are section 5's eighth priority in CPR-DOC-AUTO-001 and CPR-DOC-AUTO-001 section 14
 * blocks them: a statutory document needs an approved controlled template before it may be generated,
 * and none exists. There is no certificate composer, so a certificate preview would be a mock-up of a
 * document this product cannot produce -- showing a practitioner how their branding looks on a form
 * they cannot generate, and implying they can.
 *
 * The seven above are every document type that actually exists. When a controlled template is approved
 * and a composer is built, it appears here by adding one line.
 */
export const CERTIFICATE_PREVIEW_ABSENT =
  "Certificates are not shown: they need an approved controlled template before this product will generate one.";

export function previewDocument(key: PreviewKey): ComposedDocument {
  switch (key) {
    case "referral_letter":
      return composeReferralLetter({
        ...base, recipient: RECIPIENT,
        reason: "Persistent cough and fever for eight days, not settling with first-line treatment.",
        requestedAction: "Grateful for your assessment and ongoing management.",
        facts: only("diagnosis", "treatment", "medication", "follow_up"),
      });

    case "consultation_summary":
      return composeVisitSummary({
        ...base, visitDate: "2026-08-18",
        facts: only("diagnosis", "treatment", "investigation", "follow_up"),
      });

    case "patient_instructions":
      return composePatientInstructions({
        ...base,
        instructions: "Take the antibiotic after food, three times a day, and finish the full course.\nCome back sooner if your breathing gets worse or the fever returns.",
        facts: only("treatment", "medication", "follow_up"),
      });

    case "clinical_summary":
      return composeClinicalSummary({
        ...base, recipient: RECIPIENT,
        purpose: "Summary of care for continuity, at the patient's request.",
        periodFrom: "2026-01-01", periodTo: "2026-08-24",
        facts: FACTS,
      });

    case "investigation_request":
      return composeInvestigationRequest({
        ...base, recipient: { ...RECIPIENT, kind: "facility", displayName: "Kampala Imaging Centre" },
        clinicalIndication: "Persistent cough and fever, query consolidation.",
        facts: only("investigation", "diagnosis"),
      });

    case "follow_up_instructions":
      return composeFollowUpInstructions({
        ...base,
        instructions: "Please bring this letter and your medicines to the appointment.",
        facts: only("follow_up"),
      });

    case "medication_list":
      return composeMedicationList({ ...base, facts: only("medication", "treatment") });
  }
}
