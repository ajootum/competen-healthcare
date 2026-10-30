/* eslint-disable @typescript-eslint/no-explicit-any */
// ── OSCE PRACTICE, SERVER SIDE ── SCHOLAR-PRACTICE-EXAMS-01 (720) ─────────────────────────────────────────────────
//
// The gate every OSCE route and page asks first, and the reads the pages share. Policy (scholar_osce, default on) and
// the schema (720, detected once by store.ts osceSchema) are both server facts: the browser never decides either.
// Where 720 is absent the answer is "unavailable" with a plain reason (OSCE_UNAVAILABLE), never an error page.

import { NextResponse } from "next/server";
import { loadIndividualPolicy, type ScholarOscePolicy } from "../policy";
import { osceSchema, type OsceStationRow } from "./store";
import { OSCE_OFF, OSCE_UNAVAILABLE, type OsceItem } from "./osce";

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

/** What the browser is given of a station. Grounding quotes stay server side except as the item's source line. */
export function stationView(s: OsceStationRow) {
  return {
    id: s.id, title: s.title, scenario: s.scenario, candidateInstructions: s.candidateInstructions, durationMinutes: s.durationMinutes,
    sections: s.sections, source: s.source, contentStatus: s.contentStatus,
    checklist: s.checklist.map((i: OsceItem) => ({ id: i.id, text: i.text, critical: i.critical, outcome: i.outcome ?? null, quote: i.quote ?? null })),
  };
}
export type OsceStationView = ReturnType<typeof stationView>;
