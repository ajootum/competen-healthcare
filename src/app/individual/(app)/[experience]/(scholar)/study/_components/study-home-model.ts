import type { SessionHit } from "@/lib/individual/scholar/learn-search";

// SCH-HFE-01: what the Study Home says, worked out from existing records. Pure. No percentage is made from steps, and no
// figure or state stands in for one that was not recorded.

/** The most recent session the learner can actually go back to. Only active sessions with lessons left to open count. */
export function resumableOf(hits: readonly SessionHit[]): { session: SessionHit | null; blocked: boolean } {
  const active = hits.filter(h => h.status === "active");
  const session = active.find(h => h.steps > 0) ?? null;
  return { session, blocked: !session && active.length > 0 };
}

/** "Step 1 of 8": the session's own position, kept in range. Null where it has no lessons. */
export function stepOf(s: Pick<SessionHit, "steps" | "currentStep">): { step: number; of: number; label: string } | null {
  if (s.steps <= 0) return null;
  const step = Math.min(Math.max(s.currentStep, 0) + 1, s.steps);
  return { step, of: s.steps, label: `Step ${step} of ${s.steps}` };
}

/** Too many steps to draw as segments: the words alone say it. */
export const STEP_MARKS_MAX = 16;

/** "PowerPoint (.pptx)" as a short file type. */
export const fileTypeOf = (label: string) => label.replace(/\s*\(.*\)\s*$/, "").trim();

export type MaterialState = { label: string; ready: boolean };

/** What is true of a material now, in the Library's words. There is no background processing: extraction finishes during the upload. */
export function materialState(m: { chunkCount: number; emptyUnits: number }): MaterialState {
  if (m.chunkCount <= 0) return { label: "No readable text", ready: false };
  return m.emptyUnits > 0 ? { label: "Partly read", ready: true } : { label: "Ready", ready: true };
}

/** One line for a session's last use. UTC, so the server and the browser agree. */
export const lastActive = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `Last active ${d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`;
};
