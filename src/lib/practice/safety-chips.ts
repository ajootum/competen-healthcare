// The four safety facts the owner's comp puts on every treatment card AND in the right rail, derived
// once.
//
// ⚠ THIS FILE EXISTS BECAUSE THE SAME FOUR FACTS ARE NOW DRAWN IN THREE PLACES -- the encounter's top
// strip, each treatment card, and the Patient safety rail. Three screens counting open alerts their own
// way is the drift this codebase has already been bitten by: command-centre.ts and session.ts each
// computed follow-up counts and disagreed about what "overdue" meant, on two screens a click apart,
// and nothing failed because each was correct against itself. One function, one answer.
//
// ⚠ IT IMPORTS TYPES ONLY, so it is safe from a "use client" component. parameters.ts reaches the
// database; a value imported from it would drag the whole module into the browser bundle, which tsc
// and eslint both wave through and only `next build` catches.

import type { EncounterCollection, EncounterParameter } from "@/lib/practice/parameters";

/**
 * ⚠ THREE STATES, NOT TWO, AND THE MIDDLE ONE IS THE POINT. "No alerts" printed over a collection that
 * could not be read is the reassurance this product must never give. Not permitted, unreadable, and
 * genuinely nothing monitored are three different sentences and none of them is "clear".
 */
export type SafetyChip = { tone: "ok" | "warn" | "unknown"; text: string };

export type SafetyChips = {
  vitals: SafetyChip;
  alerts: SafetyChip;
  /** Everything the two chips were derived from, for a caller that wants to say more. */
  readable: boolean;
  monitoredCount: number;
  alertCount: number;
  alerting: string[];
};

export function safetyChips(col: EncounterCollection): SafetyChips {
  const readable = col.permitted && !col.unavailable;
  const all: EncounterParameter[] = readable
    ? [...col.priority, ...col.optional, ...col.additions] : [];
  const vitalParams = all.filter(p => p.category === "vital_sign");
  const vitalsToday = vitalParams.filter(p => p.recordedThisEncounter != null).length;
  const alertCount = all.reduce((n, p) => n + p.openAlerts, 0);
  const alerting = all.filter(p => p.openAlerts > 0).map(p => p.label);

  // ⚠ UNKNOWN IS GREY, NEVER AMBER (CPR-TRT-UI-002 s10). Missing optional data must not look like a
  // warning: "vitals not recorded" is the ordinary state of most consultations, and an amber chip on
  // every card would teach a practitioner to stop seeing amber -- which is what the real alert uses.
  const vitals: SafetyChip = !readable
    ? { tone: "unknown", text: col.permitted ? "Could not be read" : "Not permitted" }
    : vitalParams.length === 0 ? { tone: "unknown", text: "None monitored" }
      : vitalsToday === 0 ? { tone: "unknown", text: "Not recorded" }
        : { tone: "ok", text: `${vitalsToday} recorded today` };

  const alerts: SafetyChip = !readable
    ? { tone: "unknown", text: col.permitted ? "Could not be read" : "Not permitted" }
    : all.length === 0 ? { tone: "unknown", text: "Nothing monitored" }
      : alertCount === 0 ? { tone: "ok", text: "No alerts" }
        : { tone: "warn", text: `${alertCount} alert${alertCount === 1 ? "" : "s"}` };

  return { vitals, alerts, readable, monitoredCount: all.length, alertCount, alerting };
}
