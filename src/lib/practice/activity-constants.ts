// CPR-V3-001's eight activity types, and their labels.
//
// ⚠ THEY LIVE HERE RATHER THAN IN activity.ts BECAUSE A CLIENT COMPONENT NEEDS THEM.
//
// activity.ts is a server engine: it imports metrics.ts, which imports access.ts, which imports
// `next/headers`. A "use client" component importing so much as a string constant from it drags that
// whole chain into the browser bundle and the BUILD FAILS -- which is what happened the moment
// sessionSummary started reading the metric engine for its patient figures. The dev server reported it
// as a 500 on pages that had not been touched, and only `next build` named the real import trace:
//
//   access.ts <- metrics.ts <- activity.ts <- StartYourDay.tsx [Client Component Browser]
//
// This mirrors encounter-constants.ts, which exists for exactly the same reason. The rule is worth
// stating plainly: A CONSTANT A SCREEN NEEDS DOES NOT BELONG IN A FILE THAT TOUCHES THE DATABASE.
// activity.ts re-exports both so server callers are unaffected and nothing has two definitions.

export const ACTIVITY_TYPES = [
  "outpatient_clinic", "ward_round", "theatre", "emergency_consult",
  "virtual_clinic", "telephone_review", "administration", "teaching",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_LABEL: Record<ActivityType, string> = {
  outpatient_clinic: "Outpatient Clinic",
  ward_round: "Ward Round",
  theatre: "Theatre",
  emergency_consult: "Emergency Consult",
  virtual_clinic: "Virtual Clinic",
  telephone_review: "Telephone Review",
  administration: "Administration",
  teaching: "Teaching",
};
