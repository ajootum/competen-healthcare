// CPR-V5-006 -- the shapes this screen renders, declared client-side.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ WHY THESE ARE MIRRORED HERE RATHER THAN IMPORTED FROM THE ENGINE.
//
// patient-workspace.ts imports access.ts, which imports next/headers. A "use client" file that imports
// ANYTHING from it -- a function, a constant, even a type -- pulls the module into the browser graph and
// breaks the build in a way neither tsc nor eslint reports. So the payload shapes are declared here,
// structurally, with no import of any kind.
//
// THE MIRROR IS CHECKED, NOT TRUSTED. page.tsx is a server component: it holds the engine's own return
// values and assigns them to these types on the way into the client tree. If the engine's shape changes
// under this file, that assignment stops compiling -- which is the whole reason the props are typed at
// all rather than being `any`.
// ────────────────────────────────────────────────────────────────────────────────────────────────────

/** null means "the read happened and worked". The other two are the two ways it did not. */
export type Unavailable = null | "capability" | "read_failed";

/** One read, with its own honesty. `count` is NEVER 0 because something failed. */
export type Probe<T = Record<string, unknown>> = {
  rows: T[];
  count: number | null;
  unavailable: boolean;
  reason: Unavailable;
  /** The database's own words. Rendered verbatim, never paraphrased into reassurance. */
  error: string | null;
  limit: number;
  truncated: boolean;
};

export type Age = { years: number; months: number; days: number; label: string } | null;

export type IdentifierRow = {
  id: string;
  type: string;
  value: string;
  issuer: string | null;
  facilityId: string | null;
  facilityName: string | null;
  live: boolean;
};

export type IdentifierSet = {
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  otherIdentifiers: IdentifierRow[];
  all: IdentifierRow[];
};

export type Refusal = { key: string; label: string; detail: string };

// ── Worklists ────────────────────────────────────────────────────────────────────────────────────────

export type WorklistRowView = {
  id: string;
  patientId: string | null;
  /** null when the caller lacks patient.view. Never a placeholder that reads like a name. */
  patientName: string | null;
  deIdentified: boolean;
  note: string;
  when: string | null;
};

export type WorklistView = {
  key: string;
  title: string;
  note: string;
  /** Where the engine says this list lives when it lives somewhere else (follow-ups, the inbox). */
  href: string;
  count: number | null;
  atLeast: boolean;
  rows: WorklistRowView[];
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  limit: number;
  truncated: boolean;
  patientIds: string[];
};

export type WorklistsView = {
  today: string;
  timezone: string;
  worklists: WorklistView[];
  blindSpots: { key: string; title: string; reason: Unavailable; error: string | null }[];
  pendingResultsBoundary: string;
  refuses: readonly Refusal[];
};

// ── The cohort ───────────────────────────────────────────────────────────────────────────────────────

/** A PLACE, never a care setting. Practice stores no outpatient/ward distinction -- see PLACE_BOUNDARY. */
export type Place = {
  locationId: string | null;
  locationName: string | null;
  /** practice_location.type: the kind of place. NOT a care setting. */
  locationType: string | null;
  facilityId: string | null;
  facilityName: string | null;
  activityType: string | null;
  activityTitle: string | null;
  encounterMode: string | null;
  careSettingStored: false;
};

export type FollowUpRef = { id: string; dueOn: string; reason: string; status: string; overdue: boolean };

export type CohortRowView = {
  patientId: string;
  name: string | null;
  deIdentified: boolean;
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  lastSeen: string | null;
  /** FALSE means "could not see far enough to say", which is not "never seen". */
  lastSeenKnown: boolean;
  nextFollowUp: FollowUpRef | null;
  nextFollowUpKnown: boolean;
  currentStatus: { code: string; label: string };
  location: Place & { source: "encounter" | null };
  recordStatus: string;
};

/** Mirrors the engine's CohortSort: one token carries the column and the direction. */
export type CohortSortView =
  | "registered" | "registered_oldest"
  | "name" | "name_desc"
  | "last_seen" | "last_seen_oldest"
  | "next_review" | "next_review_latest";

export type CohortView = {
  rows: CohortRowView[];
  page: number;
  pageSize: number;
  hasMore: boolean;
  total: number | null;
  scope: "practice" | "mine";
  /** The sort ACTUALLY applied -- a derived sort that degraded reports "registered" here. */
  sort: CohortSortView;
  sortOptions: { key: string; label: string; available: boolean; note?: string }[];
  /** Set when a requested ordering could not be honoured; says what happened instead. */
  sortNote: string | null;
  today: string;
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  enrichment: Record<string, { ok: boolean; error: string | null; truncated: boolean }>;
};

// ── Universal search ─────────────────────────────────────────────────────────────────────────────────

export type SearchMatchView = {
  patientId: string;
  displayName: string;
  practiceId: string | null;
  hospitalNumbers: IdentifierRow[];
  birthDate: string | null;
  age: Age;
  ageEstimateYears: number | null;
  sex: string;
  status: string;
  matchedBy: string;
  /** GUARDIAN means the query matched somebody else's number recorded against this patient. */
  matchedVia: "direct" | "guardian";
  matchedGuardian: { name: string; relationshipType: string; relationshipLabel: string } | null;
  rank: number;
};

export type SearchView = {
  query: string;
  /** False when the box was empty: an empty box has not searched and has not found nothing. */
  ran: boolean;
  results: SearchMatchView[];
  limit: number;
  truncated: boolean;
  /** False whenever any probe failed or was capped -- "no results" is then not a claim to make. */
  complete: boolean;
  probes: Record<string, { unavailable: boolean; reason: Unavailable; error: string | null; truncated: boolean }>;
  unavailable: boolean;
  reason: Unavailable;
  searchedBy: string[];
};

// ── The banner, the summary and the family ───────────────────────────────────────────────────────────

export type BannerView = {
  patientId: string;
  name: string;
  practiceId: string | null;
  age: Age;
  ageEstimateYears: number | null;
  ageBasis: "birth_date" | "estimate" | "unknown";
  sex: string;
  hospitalNumbers: IdentifierRow[];
  lastSeen: string | null;
  lastSeenKnown: boolean;
  activeFollowUp: FollowUpRef | null;
  activeFollowUpKnown: boolean;
  outstanding: { key: string; label: string; count: number | null; reason: Unavailable; error: string | null }[];
  recentDiagnoses: { id: string; label: string; certainty: string; recordedAt: string }[];
  recentDiagnosesKnown: boolean;
  place: Place & { label: string; basis: string; known: boolean };
  recordStatus: string;
  mergedIntoPatientId: string | null;
};

export type SummaryView = {
  patient: {
    id: string; displayName: string; givenName: string | null; middleName: string | null;
    familyName: string | null; sex: string; birthDate: string | null; ageEstimateYears: number | null;
    status: string; mergedIntoPatientId: string | null; createdAt: string;
    preferredContactMethod: string | null; preferredLanguage: string | null; tags: string[] | null;
  };
  today: string;
  age: Age;
  identifiers: IdentifierSet;
  identifiersProbe: { ok: boolean; error: string | null; truncated: boolean };
  contacts: Probe;
  relationships: Probe;
  relationshipExpectation:
    | { required: "guardian" | "next_of_kin" | "unknown"; satisfied: boolean; fromEstimate?: boolean; reason: string }
    | null;
  recentEncounters: Probe;
  activeFollowUps: Probe;
  pendingResults: Probe;
  pendingResultsBoundary: string;
  recordedInvestigations: Probe;
  /** NOT a current-medication list. `duration` is free text, so no course has a computable end. */
  medicationsDecided: Probe;
  isCurrentMedicationList: false;
  medicationNotCurrentReason: string;
  medicationBoundary: string;
  diagnoses: Probe;
  problems: Probe;
  procedures: Probe;
  documents: Probe;
  banner: BannerView;
  refuses: readonly Refusal[];
};

export type FamilyMemberView = {
  relationshipId: string;
  fullName: string;
  relationshipType: string;
  relationshipLabel: string;
  phone: string | null;
  email: string | null;
  isLegalGuardian: boolean;
  mayReceiveInformation: boolean;
  isPrimary: boolean;
  /** ALWAYS null: nothing in this database links a named person to a patient record. */
  patientRecordId: null;
};

export type FamilyView = {
  patientId: string;
  today: string;
  parents: FamilyMemberView[];
  guardians: FamilyMemberView[];
  namedSiblings: FamilyMemberView[];
  inferredSiblings: {
    patientId: string;
    name: string | null;
    deIdentified: boolean;
    sharedGuardian: { fullName: string; relationshipType: string; phone: string | null };
    basis: string;
  }[];
  otherRelationships: FamilyMemberView[];
  unavailable: boolean;
  reason: Unavailable;
  error: string | null;
  inference: { ok: boolean; error: string | null; truncated: boolean; note: string };
  refuses: readonly Refusal[];
};

/** What the screen may do, computed server-side from the capability table. Never inferred in the browser. */
export type ScreenCapabilities = {
  mayList: boolean;
  mayView: boolean;
  mayCreate: boolean;
  maySearch: boolean;
  /** encounter.create -- the gate on "Register and start the consultation" and "Start consultation". */
  mayStartEncounter: boolean;
  /** appointment.manage -- the gate on CP-SCHED-001's registration scheduling card. */
  mayBook: boolean;
};
