import { findPatientIdentifiers } from "@/lib/privacy/patient-identifiers";
import type { ScholarPlanSettings } from "../learning-plan/types";
import { SESSION_LIMITS, sessionMinutesOf } from "./plan-settings";

// ── THE WEEKLY REFLECTION ── PLP-01..04 (owner GO 2 Nov 2026), design section 8 ──────────────────────────────────
//
// Pure, no AI. Once a week the learner may say whether the workload was manageable, too demanding or too light, with an
// optional private note (500 characters at most, refused if it looks like it identifies a patient). The answer is kept as a plan
// event (kind reflection, ref the ISO week). It may produce an OFFER to change the session length. An offer is NEVER applied: the
// learner accepts it by saving their settings, or ignores it.

export const WORKLOADS = ["manageable", "too_demanding", "too_light"] as const;
export type Workload = (typeof WORKLOADS)[number];
export const REFLECTION_NOTE_MAX = 500;

/** ISO 8601 week of a YYYY-MM-DD day, as `YYYY-Www`. */
export function isoWeek(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;            // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow + 3);          // the Thursday of this week
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d.getTime() - jan4.getTime()) / 86_400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, "0")}`;
}
export const isIsoWeek = (x: unknown): x is string => typeof x === "string" && /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/.test(x);

export type CleanReflection = { week: string; workload: Workload; note: string | null };
export function cleanReflection(body: unknown, thisWeek: string): { ok: true; value: CleanReflection } | { ok: false; message: string; identifier?: boolean } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (!isIsoWeek(b.week)) return { ok: false, message: "That week could not be found." };
  if (b.week > thisWeek) return { ok: false, message: "You can reflect on this week or an earlier one." };
  if (typeof b.workload !== "string" || !(WORKLOADS as readonly string[]).includes(b.workload)) return { ok: false, message: "Choose manageable, too demanding or too light." };
  let note: string | null = null;
  if (b.note !== undefined && b.note !== null && b.note !== "") {
    note = typeof b.note === "string" ? b.note.replace(/\s+/g, " ").trim() : "";
    if (!note) note = null;
    else if (note.length > REFLECTION_NOTE_MAX) return { ok: false, message: `Keep your note to ${REFLECTION_NOTE_MAX} characters.` };
    else if (findPatientIdentifiers(note).length) return { ok: false, message: "That looks like it identifies a patient. Remove it and save again.", identifier: true };
  }
  return { ok: true, value: { week: b.week, workload: b.workload as Workload, note } };
}

export type ReflectionOffer = {
  kind: "session_minutes";
  workload: Workload;
  currentSessionMinutes: number;
  proposedSessionMinutes: number;
  weeklyMinutesAfter: number;
  /** In plain words. */
  message: string;
  /** Always false: an offer is only ever applied by the learner saving their settings. */
  applied: false;
};

const round5 = (n: number) => Math.round(n / 5) * 5;
/**
 * Pure. The offer a reflection leads to, or null. Too demanding: shorter sessions (about three quarters, at least 10 minutes).
 * Too light: longer sessions (about a quarter more) within `scholar_plan_max_weekly_minutes` and 240 minutes. Manageable: none.
 * Needs the learner's saved settings: with none there is nothing to adjust.
 */
export function reflectionOffer(workload: Workload, settings: Pick<ScholarPlanSettings, "sessionMinutes" | "weeklyMinutes" | "daysPerWeek"> | null, maxWeeklyMinutes: number): ReflectionOffer | null {
  if (!settings || workload === "manageable") return null;
  const current = sessionMinutesOf(settings);
  const days = Math.max(1, settings.daysPerWeek);
  if (workload === "too_demanding") {
    const proposed = Math.max(SESSION_LIMITS.minMinutes, round5(current * 0.75));
    if (proposed >= current || proposed * days < 30) return null;
    return { kind: "session_minutes", workload, currentSessionMinutes: current, proposedSessionMinutes: proposed, weeklyMinutesAfter: proposed * days, applied: false,
      message: `You found the week too demanding. Would shorter sessions help? ${proposed} minutes instead of ${current}, ${days === 1 ? "one day" : `${days} days`} a week. Nothing changes unless you save it.` };
  }
  const cap = Math.min(SESSION_LIMITS.maxMinutes, Math.floor(maxWeeklyMinutes / days / 5) * 5);
  const proposed = Math.min(cap, round5(current * 1.25));
  if (proposed <= current) return null;
  return { kind: "session_minutes", workload, currentSessionMinutes: current, proposedSessionMinutes: proposed, weeklyMinutesAfter: proposed * days, applied: false,
    message: `You found the week too light. Would longer sessions suit you? ${proposed} minutes instead of ${current}, ${days === 1 ? "one day" : `${days} days`} a week, within the ${maxWeeklyMinutes} minutes a week your plan allows. Nothing changes unless you save it.` };
}
