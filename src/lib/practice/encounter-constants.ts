// PEN-003's state tables, in a module with NO server imports so the consultation UI can derive its
// buttons from the same source the engine enforces.
//
// This split exists to kill a specific bug class: a client component that hard-codes "show Sign when
// COMPLETED" drifts silently the day the engine's table changes, and the drift shows up as a button
// that 422s rather than as a failing check. Here the buttons ARE the table -- EncounterConsole maps
// ENCOUNTER_TRANSITIONS[status] through ACTION_FOR_STATUS, so an illegal action cannot be rendered.

/** DM-001 s8.1's eight states and the moves the engine allows between them. */
export const ENCOUNTER_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["PAUSED", "COMPLETED", "CANCELLED"],
  PAUSED: ["ACTIVE", "COMPLETED", "CANCELLED"],
  COMPLETED: ["SIGNED", "ACTIVE"],          // reopening a completed-but-unsigned encounter is allowed
  SIGNED: ["AMENDED", "ENTERED_IN_ERROR"],  // governed post-signature states only
  AMENDED: ["SIGNED", "ENTERED_IN_ERROR"],
  CANCELLED: [],
  ENTERED_IN_ERROR: [],
};

/** After these, the clinical content is locked (DM-001 s16). */
export const LOCKED_STATUSES = ["SIGNED", "AMENDED", "ENTERED_IN_ERROR"];
export const LIVE_STATUSES = ["DRAFT", "ACTIVE", "PAUSED"];

export const NOTE_TYPES = ["subjective", "objective", "assessment", "plan", "narrative"] as const;

/** The API's action vocabulary. One action name per target status; the UI reads it in reverse. */
export const ENCOUNTER_ACTIONS: Record<string, string> = {
  start: "ACTIVE", pause: "PAUSED", resume: "ACTIVE", complete: "COMPLETED",
  sign: "SIGNED", amend: "AMENDED", cancel: "CANCELLED", entered_in_error: "ENTERED_IN_ERROR",
};

/**
 * Which action name to send to move FROM a status TO a status. `start` and `resume` both target ACTIVE,
 * so the choice depends on where you are -- resuming a PAUSED consultation and starting a DRAFT one are
 * the same transition wearing different words at the bedside.
 */
export function actionFor(from: string, to: string): string | null {
  if (to === "ACTIVE") return from === "PAUSED" || from === "COMPLETED" ? "resume" : "start";
  const entry = Object.entries(ENCOUNTER_ACTIONS).find(([name, target]) => target === to && name !== "start" && name !== "resume");
  return entry ? entry[0] : null;
}

/** Button copy, in the words a practitioner would use. ACTIVE reads differently depending on where you are. */
export function labelFor(from: string, to: string): string {
  if (to === "ACTIVE") return from === "PAUSED" ? "Resume" : from === "COMPLETED" ? "Reopen" : "Start consultation";
  return ({
    PAUSED: "Pause",
    COMPLETED: "Complete",
    SIGNED: "Sign and lock",
    AMENDED: "Amend",
    CANCELLED: "Cancel encounter",
    ENTERED_IN_ERROR: "Mark entered in error",
  } as Record<string, string>)[to] ?? to;
}
