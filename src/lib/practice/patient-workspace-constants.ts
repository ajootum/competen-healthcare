// CPR-V5-006 PATIENTS WORKSPACE -- the client-safe half.
//
// Nothing here imports a server module, a database client or `next/headers`, so a client component can
// render the worklist titles, the identifier taxonomy and the refusals without dragging the engine (and
// the service-role client it takes) into a browser bundle. Same split as follow-up-constants.ts and
// encounter-constants.ts.

/** The six operational worklists CPR-V5-006 names, in the order they cost most to ignore. */
export const WORKLIST_KEYS = [
  "waiting", "dueFollowUps", "pendingResults", "walkIns", "recentPatients", "newRegistrations",
] as const;
export type WorklistKey = (typeof WORKLIST_KEYS)[number];

/**
 * What each worklist IS, in the words a practitioner would use, and where clicking it goes.
 *
 * THE NOTE IS PART OF THE CONTRACT, not decoration. "Pending Results" in particular means something
 * narrower here than the phrase usually does, and the tile has to say so where it is read rather than
 * in a document nobody opens -- see PENDING_RESULTS_BOUNDARY and the REFUSES entry beside it.
 */
// ⚠ THE PARAMETER IS `list`, AND IT USED TO BE `worklist` HERE AND `list` IN THE SIDEBAR.
//
// Two names for one thing, in two files, neither wrong on its own. Nothing broke only because the page
// happened to accept both -- so the disagreement was invisible and would have stayed that way until
// somebody wrote a third reader and picked one. `list` wins because it is the one already SHIPPED in
// navigation.ts and asserted by the nav harness (9f-b), and a URL in a user's sidebar is the hardest of
// the two to change.
//
// The constant below is now the only place the string is built. A harness assertion holds it against
// navigation.ts, so the two cannot drift apart again in silence.
/**
 * How many days back "recently seen" reaches.
 *
 * ⚠ IT USED TO REACH FOREVER. The encounter read had no window, so the figure was "patients among the
 * most recent N encounters ever" -- neither a period nor a total, and meaningless in any practice past
 * the read limit. Thirty days is the comp's own label ("In last 30 days") and is now the query as well.
 */
export const RECENT_WINDOW_DAYS = 30;

export const WORKLIST_META: Record<WorklistKey, { title: string; note: string; href: string; capability: string; rowNoun: string }> = {
  waiting: {
    title: "Waiting patients",
    note: "In the building now: queued at the desk, ready, in consultation or paused.",
    href: "/practice/patients?list=waiting",
    capability: "practice.calendar.view",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "queue entries",
  },
  dueFollowUps: {
    title: "Due follow-ups",
    note: "Open obligations whose due date has arrived or passed, measured against this practice's today.",
    href: "/practice/follow-ups",
    capability: "followup.view",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "obligations",
  },
  pendingResults: {
    title: "Pending results",
    note: "Results and letters that ARRIVED and nobody has reviewed. Not investigations somebody ordered -- this product has no order register.",
    href: "/practice/communication?tab=incoming",
    capability: "inbox.record",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "documents",
  },
  walkIns: {
    title: "Walk-ins today",
    note: "People seen today without a booking: queued at the desk with no appointment behind them, or booked in as a walk-in.",
    href: "/practice/patients?list=walkIns",
    capability: "practice.calendar.view",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "arrivals",
  },
  recentPatients: {
    title: "Recent patients",
    note: "Whose consultation was most recently started, newest first.",
    href: "/practice/patients?list=recentPatients",
    capability: "encounter.list",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "consultations",
  },
  newRegistrations: {
    title: "Registered today",
    note: "Patient records created today, in this practice's calendar.",
    href: "/practice/patients?list=newRegistrations",
    capability: "patient.list",
    // What a ROW is here. The card counts patients; this names what sits behind that figure.
    rowNoun: "records",
  },
};

/**
 * The identifier types that are HOSPITAL NUMBERS -- the ones CPR-V5-006 insists are surfaced beside the
 * practice ID rather than "hidden in demographics".
 *
 * Taken from migration 222's check constraint, which widened migration 193's list. `hospital_mrn` is
 * kept because 193 issued it and records written then still carry it.
 */
export const HOSPITAL_IDENTIFIER_TYPES = [
  "hospital_number", "hospital_mrn", "clinic_number", "outpatient_number", "inpatient_number",
] as const;

/** The identifier types a person is searched by, per CPR-V5-006's Universal Search list. */
export const SEARCHABLE_IDENTIFIER_TYPES = [
  "practice_id", "national_id", "passport", "insurance", "qr_code", "custom", "other",
  ...HOSPITAL_IDENTIFIER_TYPES,
] as const;

export const IDENTIFIER_LABELS: Record<string, string> = {
  practice_id: "Practice ID",
  hospital_number: "Hospital number",
  hospital_mrn: "Hospital MRN",
  clinic_number: "Clinic number",
  outpatient_number: "Outpatient number",
  inpatient_number: "Inpatient number",
  national_id: "National ID",
  passport: "Passport",
  insurance: "Insurance",
  phone: "Phone",
  email: "Email",
  qr_code: "QR code",
  custom: "Custom",
  other: "Other",
};

/**
 * How a search hit was found. Ordered by confidence, highest first -- the same identity semantics
 * migration 193 and patients.ts already established, extended with the one route CPR-V5-006 adds.
 *
 * GUARDIAN PHONE RANKS BELOW A DIRECT MATCH AND ABOVE A PARTIAL NAME. It is a real, deliberate route to
 * a child who has no phone of their own; it is also indirect, because the number belongs to somebody
 * else. Putting it above an exact name match would let "ring the number on the card" outrank "this is
 * the person you typed".
 */
export const MATCH_RANK: Record<string, number> = {
  identifier: 100,
  phone: 90,
  email: 90,
  address: 85,
  name: 80,
  guardian_phone: 70,
  guardian_email: 65,
  name_partial: 40,
};

export const COHORT_STATUSES = [
  "in_consultation", "waiting", "encounter_open", "seen", "registered_not_seen", "archived", "merged",
] as const;
export type CohortStatus = (typeof COHORT_STATUSES)[number];

export const COHORT_STATUS_LABELS: Record<CohortStatus, string> = {
  in_consultation: "In consultation",
  waiting: "Waiting",
  encounter_open: "Encounter open",
  seen: "Seen",
  registered_not_seen: "Registered, not yet seen",
  archived: "Archived",
  merged: "Merged into another record",
};

/** Doctrine 10, as a number rather than a sentence in a page footer. */
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;
/** How many rows any one worklist returns behind its count. */
export const WORKLIST_ROW_LIMIT = 50;
/**
 * The ceiling on a single enrichment read (last seen, next follow-up) for one page of the cohort.
 *
 * PostgREST caps an unbounded select at 1000 rows, and a cap that is not stated is a cap that silently
 * turns "we could not see far enough" into "there is nothing there". So it is named, passed explicitly,
 * and when it bites the affected rows come back with `lastSeenKnown: false` rather than a null that
 * reads as "never seen".
 */
export const ENRICHMENT_ROW_CAP = 1000;

/**
 * What this workspace will not claim.
 *
 * Each entry is something CPR-V5-006, its review, or the comp asks for that the record cannot honestly
 * support. They are exported so the screen can SHOW them rather than quietly omitting the section --
 * an omission reads as "there is nothing", which is the failure this whole file is written against.
 */
export const REFUSES = [
  {
    key: "orders_placed",
    label: "Pending investigations, as orders placed",
    detail:
      "The specification lists 'Orders & Procedures' and 'Results'; the comp shows 'Outstanding: MRI Brain, CBC'. There is no order register in this product -- nothing records that a test was requested, transmitted to a lab, and is awaited. What exists is practice_treatment rows of type 'investigation', which are the practitioner's RECORDED INTENTION inside a consultation, and practice_incoming_document, which is what ARRIVED. Both are shown, under their own names. An 'outstanding orders' list would be a count of intentions dressed as a count of requests.",
  },
  {
    key: "results_linked_to_requests",
    label: "A result matched back to the investigation that asked for it",
    detail:
      "practice_incoming_document has no link to practice_treatment, so nothing can say this CBC answers that request. Pairing them on the label would be a guess presented as a chain of custody.",
  },
  {
    key: "current_medications",
    label: "Current medications",
    detail:
      "CPR-V5-006's longitudinal record lists 'Current medications'. It cannot be built, and the reason is stronger than 'this is an intention rather than a list'. practice_treatment.duration is FREE TEXT -- '5 days', 'until review', '1/12'. There is no end date and none is computable, so a course decided in March cannot be known to have ended. There is also no stop event, no reconciliation, no other prescriber and no adherence. 'Current' is therefore not derivable at all, not merely unreliable. What is shown instead is every medication DECIDED AT THIS PRACTICE, newest first, each with the encounter and date that decided it and the status somebody set. No 'active' subset is computed, because computing one would mean parsing those duration strings and presenting the guess as a fact.",
  },
  {
    key: "asserted_family_links",
    label: "Family relationships between two registered patients",
    detail:
      "practice_patient_relationship names a person (full name, phone) against one patient; it has no related_patient_id. So a mother's own record and her child's are not joined by anything. The family view therefore reports what IS recorded -- the parents and guardians named on each child -- plus siblings INFERRED from a shared live guardian (same normalised name and phone), labelled as an inference with its basis. It never asserts a link the record does not hold.",
  },
  {
    key: "care_setting",
    label: "Care setting -- \"Outpatient\", \"Ward\"",
    detail:
      "The comp shows \"Outpatient / C-Care IHK\" and \"Ward / AKUH\". The PLACE is real and is shown: practice_encounter.location_id gives the location, and the activity the encounter was opened inside (migration 232) gives the facility. The CARE SETTING is not stored anywhere in Practice. practice_location.type is (hospital, clinic, outreach, teleconsultation, independent) -- the kind of place, not whether somebody was seen as an outpatient or on a ward -- and mapping one onto the other would be an invention. A care_setting column exists only in the hospital platform's taxonomy, which is a different tenant boundary and is not read from here. So the place is shown and the setting is not, and careSettingStored says so in the payload.",
  },
  {
    key: "place_beyond_this_practice",
    label: "Where the patient is, when they are somewhere this practice does not run",
    detail:
      "The place in the banner comes from this practice's own encounters. If a patient is admitted to a hospital this practice has no part in, nothing here knows. It reports where THIS practice last had them, and says that is what it is.",
  },
  {
    key: "photo_and_scanned_id",
    label: "Patient photograph and scanned identity documents",
    detail:
      "There is no file storage in this product. CPR-REG-002's workspace already refused both for the same reason and it has not changed.",
  },
] as const;

/**
 * The one sentence that has to travel with every 'Pending results' figure, wherever it is rendered.
 * Kept as a constant so the tile, the summary block and the API response cannot drift apart.
 */
export const PENDING_RESULTS_BOUNDARY =
  "This product knows what came back, not what was requested. Pending results are documents that arrived and have not been reviewed; there is no register of investigations awaiting a result.";

/**
 * The sentence that has to travel with the medication block, wherever it is rendered.
 *
 * NOT "current medications". practice_treatment.duration is free text, so no course has a computable
 * end and nothing can be known to still be running. This is what was decided here, and saying anything
 * more would be a guess wearing a clinical label.
 */
export const MEDICATION_BOUNDARY =
  "Medications decided at this practice, newest first. This is NOT a current-medication list: duration is free text, so no course has a computable end date, and there is no stop event, no reconciliation and no record of anything prescribed elsewhere.";

/** Why "current" is not derivable, in one field, for a payload consumer that needs the reason. */
export const MEDICATION_NOT_CURRENT_REASON =
  "practice_treatment.duration is free text ('5 days', 'until review'), so a course decided in the past cannot be known to have ended.";

/** What the place block is, and is not. The comp asks for a care setting; the record has no such column. */
export const PLACE_BOUNDARY =
  "Where this practice last saw the patient: the encounter's location, and the facility of the activity it was opened inside. This is a PLACE, not a care setting -- Practice stores no outpatient/ward distinction, and inferring one from the kind of location would be an invention.";
