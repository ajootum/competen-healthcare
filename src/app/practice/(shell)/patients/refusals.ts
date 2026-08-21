// CPR-PAT-002 -- what THIS SCREEN will not claim, over and above the engine's own REFUSES.
//
// ──────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THERE ARE TWO REFUSAL LISTS AND NOT ONE.
//
// patient-workspace-constants.ts REFUSES belongs to the ENGINE: it is what the payload cannot contain,
// and it travels with the payload wherever it is consumed. What is here is what the comp asks for that
// this screen will not draw. They are different lists because they answer to different documents, and
// merging them would make an engine refusal look like a design decision or the reverse.
//
// EVERY ENTRY IS RENDERED. None of these is a silent omission -- an omission reads as "there is nothing
// there", which is the failure this whole workspace is written against.
//
// ⚠ CPR-HFE-REF-001 SPLIT EVERY ENTRY IN TWO, AND THE SPLIT IS THE POINT. Each refusal now carries a
// practitioner half (state, title, reason) and an `internal` half (reason code, spec reference,
// source, technical detail). The old single `detail` string was shown to practitioners and read like
// this: "worklists() reads practice_queue_entry.status and folds IN_CONSULTATION into the single
// Waiting patients figure." A function name, a table and a database constant, on a clinical screen.
//
// NOTHING WAS DELETED. Every word of that prose is preserved under `internal.technicalDetail`, because
// s11 requires Product Director and Engineering to keep the provenance -- it is how anybody answers
// "why is this refused" later. It is simply no longer the sentence a doctor reads.
//
// This file is client-safe: no engine, no next/headers.
// ──────────────────────────────────────────────────────────────────────────────────────────────────

import type { Refusal } from "@/lib/practice/refusal-presentation";

export type ScreenRefusal = Refusal;

export const SCREEN_REFUSES: readonly Refusal[] = [
  {
    key: "trajectory",
    state: "NOT_MEASURED",
    title: "Patient progress is not summarised",
    reason:
      "Competen Practice does not work out whether a patient is improving or deteriorating, so no progress label is shown. Read the timeline for what actually happened.",
    internal: {
      reasonCode: "NO_TRAJECTORY_MODEL",
      specReference: "CPR-PAT-002 s4",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "The Journey Snapshot trajectory chip — \"Stable\", \"Improving\", \"Monitor\"" + " -- " +
        "⚠ THIS IS THE MOST DANGEROUS THING IN THE COMP AND IT IS THE ONE THING HERE THAT IS NOT DRAWN. The design puts a green \"Stable\" or an amber \"Monitor\" chip beside a named child, in a column headed Journey Snapshot, on the same row as their problems and their medication. Read at a desk that is a CLINICAL ASSESSMENT of how that patient is doing. Nothing in Practice records one. There is no trajectory column, no clinical-status column, no severity, no scored observation over time, and no scale anywhere in the schema that could be reduced to those three words. Every way of producing the chip would be an invention: counting encounters says how often somebody attended, not whether they are getting better; an open problem says a problem is open, not that it is worsening. So the two figures that ARE real are shown — how many encounters this practice has recorded and how many procedures — and where the chip would sit the screen says that nobody assessed this patient.",
    },
  },
  {
    key: "current_treatments_column",
    state: "NOT_AVAILABLE_YET",
    title: "No list of what a patient is taking now",
    reason:
      "What is recorded is what was decided at each consultation, which is not the same as what the patient is taking today. Showing it as current would overstate what this record knows.",
    internal: {
      reasonCode: "NO_CURRENT_MEDICATION_STATE",
      specReference: "CPR-PAT-002 s4",
      source: "practice_treatment",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "\"Current Treatments\" as a column of what the patient is taking now" + " -- " +
        "CPR-PAT-002 s4 names the column \"Current Treatments\" and it cannot be built under that name. practice_treatment is a MedicationPlan — migration 194's own comment is \"NOT an administration chart... what the practitioner decided, not what a ward gave\" — and its `duration` is FREE TEXT ('5 days', 'until review', '1/12'). A course decided in March with duration '5 days' therefore cannot be known to have ended: there is no end date, no stop event, no reconciliation, and nothing recording what anybody else prescribed. The column is headed \"Treatments decided\" and carries that reason, because a column headed \"Current\" would be read as a medication list somebody could prescribe against.",
    },
  },
  {
    key: "tag_search_and_control",
    state: "NOT_AVAILABLE_YET",
    title: "Patient tags cannot be added or searched yet",
    reason:
      "Nothing in Competen Practice yet lets you put a tag on a patient, show one or search by it.",
    internal: {
      reasonCode: "NO_TAG_UI",
      specReference: "CPR-PAT-002 s5",
      source: "practice_patient.tags",
      // ⚠ THE STORE EXISTS. Migration 221 adds `practice_patient.tags text[]` WITH A GIN INDEX for
      // searching -- so the old reason code NO_TAG_STORAGE and the sentence "tags are not currently
      // stored" were both false. Nothing reads or writes the column: no engine, no screen. The refusal
      // stands, its reason does not. Renamed NO_TAG_UI so somebody diagnosing this is not sent looking
      // for a migration that already ran.
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "The Tags button, and searching by tag or free keyword" + " -- " +
        "CPR-PAT-002 s5 asks for search by tag and by keyword, and the comp draws a Tags button beside the filters. universalSearch() searches Practice ID, hospital numbers, national ID, passport, insurance, name, phone, email and a parent or guardian's phone and email — and nothing else. It does not read practice_patient.tags, and it does not do free-text search over diagnoses, treatments or notes. A Tags button that opened an empty panel, or a search box that silently ignored a tag somebody typed, would both tell the user their tag had been searched and found nothing. So the control is not drawn and the box says exactly what it searched.",
    },
  },
  {
    key: "search_by_clinical_content",
    state: "NOT_AVAILABLE_YET",
    title: "Search does not reach diagnoses or treatments",
    reason:
      "Search covers names, phone numbers and identifiers. It does not yet look inside diagnoses, treatments or the hospital a patient was seen in.",
    internal: {
      reasonCode: "SEARCH_SCOPE_LIMITED",
      specReference: "CPR-PAT-002 s5",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "Search by diagnosis, treatment or hospital" + " -- " +
        "Also s5. practice_diagnosis.label, practice_treatment.label and practice_facility.name all exist and are all readable — this is a gap in the search engine, not in the record. universalSearch() does not query them, so they are named here as absent rather than left for somebody to discover by typing an epilepsy code and being told nobody matches.",
    },
  },
  {
    key: "patient_photographs",
    state: "NOT_AVAILABLE_YET",
    title: "No patient photographs",
    reason:
      "There is nowhere to put a photograph on a patient's record, so the register shows names and identifiers. Images can still be filed as documents.",
    internal: {
      reasonCode: "NO_PATIENT_PHOTO_FIELD",
      // ⚠ "DOES NOT STORE IMAGES" WAS FALSE. The practice-attachments bucket exists (migration 336)
      // and the document library has a camera capture that writes to it. What does not exist is a
      // photograph on the PATIENT RECORD -- practice_patient has no photo column in any migration.
      // The refusal stands; the reason it gave did not.
      specReference: "CPR-PAT-002 s4",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "Patient photographs in the register" + " -- " +
        "The comp shows a photograph of every child. There is no file storage in this product and no photo column on practice_patient; CPR-REG-002's registration workspace already refused the same thing for the same reason. The register draws initials, which are derived from the name that is actually stored.",
    },
  },
  {
    key: "rates_and_deltas",
    state: "NOT_MEASURED",
    title: "No percentages or change arrows",
    reason:
      "A percentage needs a denominator this record does not hold, and a change arrow needs a comparable earlier period. Rather than print a figure that cannot be checked, neither is shown.",
    internal: {
      reasonCode: "NO_BASELINE_FOR_RATE",
      specReference: "CPR-PAT-002 s6",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "The Patient insights percentages and their period-over-period arrows" + " -- " +
        "The comp's insights panel reads \"Follow-ups kept 87% ↑6%\", \"New patients 8 ↑14%\", \"Overdue reviews 14 ↓3%\". Two separate refusals. FIRST, a rate is not shown as a rate: 87% hides both its numerator and its denominator, and a percentage of a small clinic's week is a number that moves violently for reasons that are not clinical. Counts are shown, with what they count. SECOND, the arrows are period-over-period and there is no prior window to compare against: patientsWorkspace() returns one snapshot of now — today's registrations, the current queue, the open follow-up backlog — with no history and no window parameter, so there is no earlier value in the payload at all. A delta computed from nothing is not a small error, it is a fabricated trend beside a clinical figure.",
    },
  },
  {
    key: "insights_sparkline",
    state: "NOT_MEASURED",
    title: "No trend chart",
    reason:
      "A trend line needs a value for each day or week, and nothing here is recorded that way yet.",
    internal: {
      reasonCode: "NO_TIME_SERIES",
      specReference: "CPR-PAT-002 s6",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "The insights sparkline" + " -- " +
        "The comp draws a small line chart above the insight figures. It needs a series — a value per day or per week — and nothing on this screen has one. Every figure here is a single count of the present.",
    },
  },
  {
    key: "ai_generated_brief",
    state: "NOT_AVAILABLE_YET",
    title: "This panel is not written by the assistant",
    reason:
      "What you see here is counted directly from your own record. It is not generated text, and it is not labelled as though it were.",
    internal: {
      reasonCode: "PANEL_IS_RULE_BASED",
      specReference: "CPR-PAT-002 s6",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "The assistant panel as AI-generated text" + " -- " +
        "The comp labels the bottom-right panel \"AI Practice Assistant\" with an AI badge. Its content — \"You have 3 patients with overdue follow-ups and 2 unreviewed results\" — is ARITHMETIC over the cards above it, and it is shown for that reason: it is true and it is useful. It is not labelled AI, because no model produced it. command-centre.ts renders the same kind of line with aiGenerated: false, and this follows it.",
    },
  },
  {
    key: "care_setting_tabs",
    state: "NOT_AVAILABLE_YET",
    title: "No \"active care\" or \"inactive\" tabs",
    reason:
      "Competen Practice does not record whether a patient is under active care, so the register cannot split them that way. Filter by when they were last seen instead.",
    internal: {
      reasonCode: "NO_CARE_STATE",
      specReference: "CPR-PAT-002 s4",
      // The label this refusal used to show a practitioner, kept as provenance.
      technicalDetail:
        "\"Active care\" and \"Inactive\" as register tabs" + " -- " +
        "The comp's tab strip reads All patients / Active care / Follow-ups due / Recently seen / Inactive. \"Active care\" is not a state this record holds — there is no episode of care, no caseload and no named responsible clinician, and inferring one from having an open follow-up would put a label on the patient rather than on the follow-up. The tabs that survive are the ones backed by a worklist the engine actually answers, plus the record's own archived flag, which is a different and much narrower fact than \"inactive\".",
    },
  },
  // "bulk_import" LEFT THIS LIST 2026-08-11: CPR-IMP-001 built the import at /practice/patients/import,
  // through the registration engines themselves -- the refusal's own condition ("through the path that
  // runs duplicate detection") is exactly what got built, so the entry retired rather than soured.
] as const;

/**
 * The three worklist cards this screen cannot fill.
 *
 * Practitioner-facing reasons; the query-level detail that somebody extending patient-workspace.ts
 * needs is under `internal`, where it always should have been.
 */
export const UNSUPPLIED_CARD: readonly Refusal[] = [
  {
    key: "inConsultation",
    state: "NOT_AVAILABLE_YET",
    reason:
      "Patients in consultation are counted inside the waiting figure rather than separately.",
    internal: {
      reasonCode: "CONSULTATION_COUNT_FOLDED",
      specReference: "CPR-PAT-002 s4",
      source: "practice_queue_entry",
      technicalDetail:
        "worklists() reads practice_queue_entry.status and folds IN_CONSULTATION into the single \"Waiting patients\" figure. A separate count needs that status (plus practice_encounter rows in status ACTIVE, which is the other way somebody is in the room) returned as its own worklist.",
    },
  },
  {
    key: "followUpsToday",
    state: "NOT_AVAILABLE_YET",
    reason:
      "Follow-ups due today are counted inside the overdue-and-due figure rather than on their own.",
    internal: {
      reasonCode: "NO_DUE_TODAY_SPLIT",
      specReference: "CPR-PAT-002 s4",
      source: "practice_follow_up",
      technicalDetail:
        "worklists() asks practice_follow_up for status OPEN and due_on <= today, and returns that as one number. Today's follow-ups are due_on = today exactly; the backlog is due_on < today. Both are one predicate away and neither is returned separately.",
    },
  },
  {
    key: "urgentReviews",
    state: "NOT_AVAILABLE_YET",
    reason:
      "Follow-up priority is recorded but is not yet counted separately, so urgent reviews have no figure of their own.",
    internal: {
      reasonCode: "PRIORITY_NOT_RETURNED",
      specReference: "CPR-PAT-002 s4",
      source: "practice_follow_up",
      technicalDetail:
        "practice_follow_up.priority is real and worklists() already SELECTS it — it is simply not returned. The card needs a count of status OPEN with priority in ('soon','urgent'), which the engine can answer from the query it is already running.",
    },
  },
] as const;

/** The three register columns myPatients() does not fill. Same split, same reason. */
export const UNSUPPLIED_COLUMN_REFUSALS: readonly Refusal[] = [
  {
    key: "activeProblems",
    state: "NOT_AVAILABLE_YET",
    reason:
      "The number of open problems is not shown in the register. Open a patient to see their problems.",
    internal: {
      reasonCode: "PROBLEMS_NOT_BATCHED",
      specReference: "CPR-PAT-002 s4",
      source: "practice_problem",
      technicalDetail:
        "practice_problem, batched: .select(\"id, patient_id, label, status\").in(\"patient_id\", ids) — the same shape as the identifiers/followUps enrichment reads, gated on encounter.list as patientSummary() gates it. Needs activeProblems[] and activeProblemsKnown on CohortRow, so a failed read is not rendered as a patient with no problems.",
    },
  },
  {
    key: "treatmentsDecided",
    state: "NOT_AVAILABLE_YET",
    reason:
      "Treatments decided are not counted in the register. Open a patient to see them.",
    internal: {
      reasonCode: "TREATMENTS_NOT_BATCHED",
      specReference: "CPR-PAT-002 s4",
      source: "practice_treatment",
      technicalDetail:
        "practice_treatment, batched: .eq(\"treatment_type\", \"medication\").in(\"patient_id\", ids) ordered created_at desc. NOT filtered to planned/in_progress — patientSummary() deliberately does not filter it, because with a free-text duration no course can be known to be running. Needs treatmentsDecided[] and treatmentsKnown.",
    },
  },
  {
    key: "journeySnapshot",
    state: "NOT_AVAILABLE_YET",
    reason:
      "The register does not show a per-patient visit count. The patient record shows the full timeline.",
    internal: {
      reasonCode: "JOURNEY_NOT_ASSEMBLED",
      specReference: "CPR-PAT-002 s4",
      source: "practice_encounter",
      technicalDetail:
        "Encounter count: ALREADY FETCHED. myPatients() builds encByPatient for the page and reads only encs[0]; encs.length is the count, and lastSeenKnown already carries whether the read was complete. Procedure count: practice_procedure, batched: .select(\"id, patient_id\").in(\"patient_id\", ids). Both need to be on CohortRow with their own *Known flag.",
    },
  },
] as const;

/** Lookup helpers, so a card or a column can find its own refusal by key. */
export const cardRefusal = (key: string): Refusal | undefined =>
  UNSUPPLIED_CARD.find(r => r.key === key);
export const columnRefusal = (key: string): Refusal | undefined =>
  UNSUPPLIED_COLUMN_REFUSALS.find(r => r.key === key);
