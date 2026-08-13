/**
 * What a diary regeneration DID, in words, for the three screens that can trigger one.
 *
 * ⚠ THIS FILE IMPORTS NOTHING, ON PURPOSE. Every caller is a "use client" component, and importing a
 * single value from a module that reaches the server drags the whole chain -- access.ts, next/headers
 * -- into the browser bundle. tsc passes, eslint passes, and only `next build` says otherwise. The
 * structural type below is a local copy for that reason, not an oversight.
 *
 * ⚠ AND IT EXISTS BECAUSE THE NOTICE USED TO SAY ONLY "n slots generated". A run that moved six
 * windows and refused to move a seventh reported the same sentence as one that did nothing at all --
 * so the outcome that most needed a person was the one the screen never mentioned. A summary that
 * names only its happy number reads as the whole story.
 */

export type MistimedWindowLike = {
  slotId: string; date: string;
  currentStart: string; currentEnd: string;
  templateStart: string; templateEnd: string;
  reason: "booked" | "unreadable";
};

export type GenerationReportLike = {
  slotsCreated?: number;
  slotsRetimed?: number;
  windowsNeedingAHuman?: MistimedWindowLike[];
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The clock face of an instant, in the reader's own locale. Dates are shown by the caller. */
export function hhmmOf(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "??:??"
    : `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * One sentence for a notice strip. Silent about what did not happen, EXCEPT the part a person has to
 * act on -- that is stated even though it makes the sentence longer.
 */
export function generationSummary(g: GenerationReportLike | null | undefined): string {
  if (!g) return "";
  const parts: string[] = [];
  if (g.slotsCreated) parts.push(`${plural(g.slotsCreated, "slot")} generated`);
  if (g.slotsRetimed) parts.push(`${plural(g.slotsRetimed, "window")} moved to match the session`);
  const stuck = g.windowsNeedingAHuman ?? [];
  if (stuck.length > 0)
    parts.push(`${plural(stuck.length, "window")} left where it is because somebody is booked in`);
  if (parts.length === 0) return " Nothing changed.";
  return ` ${parts.join(", ")}.`;
}

/**
 * The two outcomes a per-session save must not stay silent about, appended to that screen's own
 * sentence. Empty when neither happened, so the common case reads exactly as it did before.
 *
 * ⚠ EDITING A SESSION'S HOURS IS WHAT CAUSES THIS, so the screen where that edit happens is the one
 * that has to say it. Reporting it only on the Availability console would tell the right thing to
 * somebody who did not do it, at a moment they were not looking.
 */
export function retimingClause(g: GenerationReportLike | null | undefined): string {
  if (!g) return "";
  const moved = g.slotsRetimed ?? 0;
  const stuck = (g.windowsNeedingAHuman ?? []).length;
  let s = "";
  if (moved) s += ` ${plural(moved, "existing window")} moved to the new time.`;
  if (stuck)
    s += ` ${plural(stuck, "window")} could NOT be moved, because somebody is booked in --`
      + ` ${stuck === 1 ? "it is" : "they are"} still at the old time and nobody has been told.`
      + ` Availability lists which.`;
  return s;
}

/**
 * The heading for the panel that lists them. Separated from the sentence above because a count in a
 * notice disappears on the next action, and this one has to stay until a person deals with it.
 */
export function mistimedHeading(windows: MistimedWindowLike[]): string {
  const unreadable = windows.filter(w => w.reason === "unreadable").length;
  // ⚠ NEVER FOLDED TOGETHER. "could not be read" is not "booked": one is a fact about a patient, the
  // other is a fact about a query, and stating the second as the first invents the patient.
  if (unreadable === windows.length && unreadable > 0)
    return `${plural(windows.length, "window")} could not be checked for bookings, so ${windows.length === 1 ? "it was" : "they were"} left alone`;
  if (unreadable > 0)
    return `${plural(windows.length, "window")} still at the old time (${unreadable} because the appointment list could not be read)`;
  return `${plural(windows.length, "window")} still at the old time because somebody is booked in`;
}
