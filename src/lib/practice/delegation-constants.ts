// CPR-310's delegation areas, in a module with NO server imports so the console and the engine read the
// same list.
//
// ────────────────────────────────────────────────────────────────────────────────────────────────────
// AN AREA IS WHAT A PRACTITIONER ACTUALLY DECIDES.
//
// "Mary handles my diary" is the decision. "Mary holds appointment.manage, practice.calendar.view and
// queue.manage until the 30th" is the implementation. The capability-level delegation that already
// existed is correct and stays; this is the vocabulary above it, which is the one CPR-310's comp shows
// as "24 Areas" and its Delegated Access Summary lists.
//
// THE AREAS ARE FIXED IN CODE, NOT A TABLE, because an area IS a mapping to capabilities: a
// practice-defined area would be one whose capabilities nobody had defined. What a practice may define
// is a ROLE TEMPLATE -- a named bundle of these areas -- which is a table.
// ────────────────────────────────────────────────────────────────────────────────────────────────────
//
// NOTHING CLINICAL IS DELEGABLE HERE, AND THAT IS THE POINT OF THE MODULE. CPR-310 s5: only
// practitioners sign clinical records. So no area grants encounter.sign, document.sign,
// diagnosis.record or treatment.record. A delegate can prepare, file, book and chase; the clinical
// judgement and the signature stay with the clinician. `document.author` appears under Documentation
// because a secretary typing a referral is normal practice -- but the document arrives as a DRAFT and
// only a practitioner can sign it, which is exactly the division the specification describes.

export const DELEGATION_AREAS = [
  {
    code: "scheduling",
    label: "Scheduling and appointments",
    detail: "Book, move and cancel; run the day list and the waiting queue.",
    capabilities: ["practice.calendar.view", "appointment.manage", "queue.manage", "patient.list", "search.use"],
  },
  {
    code: "registration",
    label: "Patient registration",
    detail: "Register new patients and keep their details current.",
    capabilities: ["patient.list", "patient.view", "patient.create", "patient.edit", "search.use"],
  },
  {
    code: "documentation",
    label: "Documentation and letters",
    detail: "Prepare letters and certificates as drafts. Signing stays with the practitioner.",
    capabilities: ["document.view", "document.author", "template.manage", "patient.list", "patient.view"],
  },
  {
    code: "communication",
    label: "Communications",
    detail: "The inbox, internal messages, and recording contact with patients.",
    capabilities: ["message.use", "inbox.review", "inbox.record", "comm.record", "patient.list"],
  },
  {
    code: "tasks",
    label: "Tasks and follow-up chasing",
    detail: "Keep the task board and chase overdue follow-ups. Closing a follow-up still needs words.",
    capabilities: ["task.view", "task.manage", "followup.view", "patient.list"],
  },
  {
    code: "reports",
    label: "Reports and data entry",
    detail: "Run practice reports. Counts only, and de-identified without patient access.",
    capabilities: ["report.view", "search.use"],
  },
] as const;

export const areaByCode = (code: string) => DELEGATION_AREAS.find(a => a.code === code) ?? null;

/** Every capability any area can grant. Used to prove, in the harness, that none of them is clinical. */
export const DELEGABLE_CAPABILITIES = [...new Set(DELEGATION_AREAS.flatMap(a => [...a.capabilities]))];

/**
 * What may never be delegated, whatever an area says.
 *
 * A SECOND, INDEPENDENT STATEMENT OF THE RULE, checked at grant time rather than trusted to the lists
 * above. If somebody adds document.sign to an area in a hurry, this refuses it and the harness fails --
 * which is the difference between a rule and a convention.
 */
export const NEVER_DELEGABLE = [
  "encounter.sign", "document.sign", "diagnosis.record", "treatment.record",
  "procedure.record", "encounter.create", "encounter.edit",
  "patient.merge", "practice.members.manage", "practice.settings.manage", "access.review", "data.export",
] as const;

export const APPROVAL_SUBJECTS = [
  ["document", "A document"],
  ["patient", "A patient record"],
  ["appointment", "An appointment"],
  ["task", "A task"],
  ["incoming_document", "Something received"],
  ["other", "Something else"],
] as const;
