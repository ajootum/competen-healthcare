// CPR-PAT-002 -- what THIS SCREEN will not claim, over and above the engine's own REFUSES.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// WHY THERE ARE TWO REFUSAL LISTS AND NOT ONE.
//
// patient-workspace-constants.ts REFUSES belongs to the ENGINE: it is what the payload cannot contain,
// and it travels with the payload wherever it is consumed. What is here is what the CPR-PAT-002 COMP
// asks for that this screen will not draw. They are different lists because they answer to different
// documents, and merging them would make an engine refusal look like a design decision or the reverse.
//
// EVERY ENTRY IS RENDERED. None of these is a silent omission -- an omission reads as "there is nothing
// there", which is the failure this whole workspace is written against.
//
// This file is client-safe: no imports, no engine, no next/headers.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

export type ScreenRefusal = { key: string; label: string; detail: string };

export const SCREEN_REFUSES: readonly ScreenRefusal[] = [
  {
    key: "trajectory",
    label: "The Journey Snapshot trajectory chip — \"Stable\", \"Improving\", \"Monitor\"",
    detail:
      "⚠ THIS IS THE MOST DANGEROUS THING IN THE COMP AND IT IS THE ONE THING HERE THAT IS NOT DRAWN. The design puts a green \"Stable\" or an amber \"Monitor\" chip beside a named child, in a column headed Journey Snapshot, on the same row as their problems and their medication. Read at a desk that is a CLINICAL ASSESSMENT of how that patient is doing. Nothing in Practice records one. There is no trajectory column, no clinical-status column, no severity, no scored observation over time, and no scale anywhere in the schema that could be reduced to those three words. Every way of producing the chip would be an invention: counting encounters says how often somebody attended, not whether they are getting better; an open problem says a problem is open, not that it is worsening. So the two figures that ARE real are shown — how many encounters this practice has recorded and how many procedures — and where the chip would sit the screen says that nobody assessed this patient.",
  },
  {
    key: "current_treatments_column",
    label: "\"Current Treatments\" as a column of what the patient is taking now",
    detail:
      "CPR-PAT-002 s4 names the column \"Current Treatments\" and it cannot be built under that name. practice_treatment is a MedicationPlan — migration 194's own comment is \"NOT an administration chart... what the practitioner decided, not what a ward gave\" — and its `duration` is FREE TEXT ('5 days', 'until review', '1/12'). A course decided in March with duration '5 days' therefore cannot be known to have ended: there is no end date, no stop event, no reconciliation, and nothing recording what anybody else prescribed. The column is headed \"Treatments decided\" and carries that reason, because a column headed \"Current\" would be read as a medication list somebody could prescribe against.",
  },
  {
    key: "tag_search_and_control",
    label: "The Tags button, and searching by tag or free keyword",
    detail:
      "CPR-PAT-002 s5 asks for search by tag and by keyword, and the comp draws a Tags button beside the filters. universalSearch() searches Practice ID, hospital numbers, national ID, passport, insurance, name, phone, email and a parent or guardian's phone and email — and nothing else. It does not read practice_patient.tags, and it does not do free-text search over diagnoses, treatments or notes. A Tags button that opened an empty panel, or a search box that silently ignored a tag somebody typed, would both tell the user their tag had been searched and found nothing. So the control is not drawn and the box says exactly what it searched.",
  },
  {
    key: "search_by_clinical_content",
    label: "Search by diagnosis, treatment or hospital",
    detail:
      "Also s5. practice_diagnosis.label, practice_treatment.label and practice_facility.name all exist and are all readable — this is a gap in the search engine, not in the record. universalSearch() does not query them, so they are named here as absent rather than left for somebody to discover by typing an epilepsy code and being told nobody matches.",
  },
  {
    key: "patient_photographs",
    label: "Patient photographs in the register",
    detail:
      "The comp shows a photograph of every child. There is no file storage in this product and no photo column on practice_patient; CPR-REG-002's registration workspace already refused the same thing for the same reason. The register draws initials, which are derived from the name that is actually stored.",
  },
  {
    key: "rates_and_deltas",
    label: "The Patient insights percentages and their period-over-period arrows",
    detail:
      "The comp's insights panel reads \"Follow-ups kept 87% ↑6%\", \"New patients 8 ↑14%\", \"Overdue reviews 14 ↓3%\". Two separate refusals. FIRST, a rate is not shown as a rate: 87% hides both its numerator and its denominator, and a percentage of a small clinic's week is a number that moves violently for reasons that are not clinical. Counts are shown, with what they count. SECOND, the arrows are period-over-period and there is no prior window to compare against: patientsWorkspace() returns one snapshot of now — today's registrations, the current queue, the open follow-up backlog — with no history and no window parameter, so there is no earlier value in the payload at all. A delta computed from nothing is not a small error, it is a fabricated trend beside a clinical figure.",
  },
  {
    key: "insights_sparkline",
    label: "The insights sparkline",
    detail:
      "The comp draws a small line chart above the insight figures. It needs a series — a value per day or per week — and nothing on this screen has one. Every figure here is a single count of the present.",
  },
  {
    key: "ai_generated_brief",
    label: "The assistant panel as AI-generated text",
    detail:
      "The comp labels the bottom-right panel \"AI Practice Assistant\" with an AI badge. Its content — \"You have 3 patients with overdue follow-ups and 2 unreviewed results\" — is ARITHMETIC over the cards above it, and it is shown for that reason: it is true and it is useful. It is not labelled AI, because no model produced it. command-centre.ts renders the same kind of line with aiGenerated: false, and this follows it.",
  },
  {
    key: "care_setting_tabs",
    label: "\"Active care\" and \"Inactive\" as register tabs",
    detail:
      "The comp's tab strip reads All patients / Active care / Follow-ups due / Recently seen / Inactive. \"Active care\" is not a state this record holds — there is no episode of care, no caseload and no named responsible clinician, and inferring one from having an open follow-up would put a label on the patient rather than on the follow-up. The tabs that survive are the ones backed by a worklist the engine actually answers, plus the record's own archived flag, which is a different and much narrower fact than \"inactive\".",
  },
  // "bulk_import" LEFT THIS LIST 2026-08-11: CPR-IMP-001 built the import at /practice/patients/import,
  // through the registration engines themselves — the refusal's own condition ("through the path that
  // runs duplicate detection") is exactly what got built, so the entry retired rather than soured.
] as const;

/**
 * What the ENGINE would have to return for the three cards this screen cannot fill.
 *
 * Kept as data next to the cards that need it, so the card can print its own reason rather than showing
 * an unexplained dash. Each string names the table, the filter and the field -- the point is that
 * somebody extending patient-workspace.ts can act on it without re-deriving anything.
 */
export const UNSUPPLIED_REASON: Record<string, string> = {
  inConsultation:
    "worklists() reads practice_queue_entry.status and folds IN_CONSULTATION into the single \"Waiting patients\" figure. A separate count needs that status (plus practice_encounter rows in status ACTIVE, which is the other way somebody is in the room) returned as its own worklist.",
  followUpsToday:
    "worklists() asks practice_follow_up for status OPEN and due_on <= today, and returns that as one number. Today's follow-ups are due_on = today exactly; the backlog is due_on < today. Both are one predicate away and neither is returned separately.",
  urgentReviews:
    "practice_follow_up.priority is real and worklists() already SELECTS it — it is simply not returned. The card needs a count of status OPEN with priority in ('soon','urgent'), which the engine can answer from the query it is already running.",
};

/**
 * What the REGISTER would need for the three CPR-PAT-002 s4 columns myPatients() does not fill.
 *
 * ⚠ ONE OF THESE IS ALREADY IN THE ENGINE AND IS THROWN AWAY. myPatients() fetches every encounter for
 * the page (`encByPatient`) and uses it only to find the latest; the per-patient COUNT is sitting in that
 * map. The other three need one batched read each, in exactly the shape the enrichment reads beside them
 * already take.
 */
export const UNSUPPLIED_COLUMN: Record<string, string> = {
  activeProblems:
    "practice_problem, batched: .select(\"id, patient_id, label, status\").in(\"patient_id\", ids) — the same shape as the identifiers/followUps enrichment reads, gated on encounter.list as patientSummary() gates it. Needs activeProblems[] and activeProblemsKnown on CohortRow, so a failed read is not rendered as a patient with no problems.",
  treatmentsDecided:
    "practice_treatment, batched: .eq(\"treatment_type\", \"medication\").in(\"patient_id\", ids) ordered created_at desc. NOT filtered to planned/in_progress — patientSummary() deliberately does not filter it, because with a free-text duration no course can be known to be running. Needs treatmentsDecided[] and treatmentsKnown.",
  journeySnapshot:
    "Encounter count: ALREADY FETCHED. myPatients() builds encByPatient for the page and reads only encs[0]; encs.length is the count, and lastSeenKnown already carries whether the read was complete. Procedure count: practice_procedure, batched: .select(\"id, patient_id\").in(\"patient_id\", ids). Both need to be on CohortRow with their own *Known flag.",
};
