/* eslint-disable @typescript-eslint/no-explicit-any */
// ── OSCE PRACTICE, SERVER SIDE ── SCHOLAR-PRACTICE-EXAMS-01 (720) ─────────────────────────────────────────────────
//
// The gate every OSCE route and page asks first, and the reads the pages share. Policy (scholar_osce, default on) and
// the schema (720, detected once by store.ts osceSchema) are both server facts: the browser never decides either.
// Where 720 is absent the answer is "unavailable" with a plain reason (OSCE_UNAVAILABLE), never an error page.

import { NextResponse } from "next/server";
import { loadIndividualPolicy, type ScholarOscePolicy } from "../policy";
import { osceSchema, type OsceStationRow } from "./store";
import { OSCE_GUIDELINES_NOTE, OSCE_OFF, OSCE_UNAVAILABLE, type OsceItem, type OsceSnapshot } from "./osce";

export type OsceAvailability = { state: "off" } | { state: "unavailable" } | { state: "on"; policy: ScholarOscePolicy };

/** Whether OSCE practice is offered (policy) and installed (720) here. */
export async function osceAvailability(admin: any, userId: string): Promise<OsceAvailability> {
  const policy = (await loadIndividualPolicy(admin)).scholarOsce;
  if (!policy.enabled) return { state: "off" };
  if (!(await osceSchema(admin, userId))) return { state: "unavailable" };
  return { state: "on", policy };
}

/** For a route: the OSCE policy, or the refusal to return (403 not offered, 409 not installed here). */
export async function osceGate(admin: any, userId: string): Promise<ScholarOscePolicy | NextResponse> {
  const a = await osceAvailability(admin, userId);
  if (a.state === "off") return NextResponse.json({ error: OSCE_OFF }, { status: 403 });
  if (a.state === "unavailable") return NextResponse.json({ error: OSCE_UNAVAILABLE, unavailable: true }, { status: 409 });
  return a.policy;
}

/**
 * What the browser is given of a station for the BRIEF and the run: the definition a candidate may see (profession,
 * programme, topic, objectives, instructions, scenario, duration, sections) and the checklist for the self-check.
 * Guidance and expected activities are NOT here: they are given only after a run (resultExtras), never before or during.
 * The checklist given is the one the run is marked against: the attempt snapshot where there is one.
 */
export function stationView(s: OsceStationRow, checklist: readonly OsceItem[] = s.checklist) {
  return {
    id: s.id, title: s.title, scenario: s.scenario, candidateInstructions: s.candidateInstructions, durationMinutes: s.durationMinutes,
    sections: s.sections, source: s.source, contentStatus: s.contentStatus, version: s.version,
    profession: s.profession, programmeLabel: s.programmeLabel, topic: s.topic, bodySystem: s.bodySystem, difficulty: s.difficulty, objectives: s.objectives,
    checklist: checklist.map((i: OsceItem) => ({ id: i.id, text: i.text, critical: i.critical, outcome: i.outcome ?? null, quote: i.quote ?? null })),
  };
}
export type OsceStationView = ReturnType<typeof stationView>;

/** The station's snapshot fallback: what a run started before 721 (no snapshot) is marked against. */
export const stationSnapshot = (s: OsceStationRow): OsceSnapshot => ({
  version: s.version, title: s.title, scenario: s.scenario, candidateInstructions: s.candidateInstructions, durationMinutes: s.durationMinutes,
  sections: s.sections, checklist: s.checklist, guidance: s.guidance, expectedActivities: s.expectedActivities,
});

/** What only a finished run may see: the assessment guidance, suggested responses and expected activities. */
export function resultExtras(snap: OsceSnapshot) {
  return { guidance: snap.guidance, expectedActivities: snap.expectedActivities, guidelinesNote: OSCE_GUIDELINES_NOTE };
}
